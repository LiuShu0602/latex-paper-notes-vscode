import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import * as vscode from 'vscode';
import type { PaperEngine, PaperNotesProject } from './model.js';
import { parseFlsInputs, resolveInsideProject } from './project.js';

export type BuildKind = 'quick' | 'full';

export interface ToolExecutables {
  latexmk: string;
  pdflatex: string;
  xelatex: string;
  lualatex: string;
  makeindex: string;
  synctex: string;
  kpsewhich: string;
}

export interface ToolCheck {
  name: keyof ToolExecutables | `package:${string}`;
  executable?: string;
  ok: boolean;
  detail: string;
}

export interface ToolchainReport {
  distribution: 'TeX Live' | 'MiKTeX' | 'unknown';
  checks: ToolCheck[];
  ready: boolean;
}

export interface BuildResult {
  ok: boolean;
  flsInputs: string[];
}

export class BuildManager implements vscode.Disposable {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly output = vscode.window.createOutputChannel('LaTeX Paper Notes');
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('paper-notes-build');
  private cancelled = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly project: () => PaperNotesProject,
    private readonly executables: () => ToolExecutables,
    private readonly onSuccess: (kind: BuildKind, result: BuildResult) => Promise<void>
  ) {}

  get running(): boolean {
    return Boolean(this.child);
  }

  async diagnose(): Promise<ToolchainReport> {
    const tools = this.executables();
    const project = this.project();
    const required = new Set<keyof ToolExecutables>([
      'latexmk', project.paperEngine, project.notesEngine, 'makeindex', 'synctex', 'kpsewhich'
    ]);
    const checks: ToolCheck[] = [];
    let distribution: ToolchainReport['distribution'] = 'unknown';
    for (const name of required) {
      const executable = tools[name];
      const result = await runProbe(executable, ['--version'], this.workspaceRoot);
      const combined = `${result.stdout}\n${result.stderr}`;
      if (/MiKTeX/i.test(combined)) {
        distribution = 'MiKTeX';
      } else if (/TeX Live|kpathsea/i.test(combined) && distribution === 'unknown') {
        distribution = 'TeX Live';
      }
      checks.push({
        name,
        executable,
        ok: result.code === 0,
        detail: result.code === 0 ? firstUsefulLine(combined) : executableHint(name, distribution, result.error)
      });
    }
    const packages = ['hyperref.sty', 'xr-hyper.sty', 'ctexart.cls', 'tcolorbox.sty', 'imakeidx.sty'];
    for (const packageName of packages) {
      const result = await runProbe(tools.kpsewhich, [packageName], this.workspaceRoot);
      checks.push({
        name: `package:${packageName}`,
        executable: tools.kpsewhich,
        ok: result.code === 0 && Boolean(result.stdout.trim()),
        detail: result.stdout.trim() || packageHint(packageName, distribution)
      });
    }
    return { distribution, checks, ready: checks.every((check) => check.ok) };
  }

  async run(kind: BuildKind): Promise<boolean> {
    if (this.child) {
      void vscode.window.showWarningMessage('A Paper Notes build is already running.');
      return false;
    }
    this.cancelled = false;
    this.output.clear();
    this.output.show(true);
    this.diagnostics.clear();
    this.output.appendLine(kind === 'quick' ? '== Quick annotated preview ==' : '== Full Paper Notes build ==');

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: kind === 'quick' ? 'Building annotated paper notes' : 'Building and validating LaTeX Paper Notes',
        cancellable: true
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => void this.cancelProcessTree());
        try {
          const project = this.project();
          const result = project.build.mode === 'legacy-script'
            ? await this.runLegacy(kind, project)
            : await this.runBuiltin(project);
          if (!result.ok) {
            if (!this.cancelled) {
              void vscode.window.showErrorMessage('Paper Notes build failed. Open the “LaTeX Paper Notes” output for details.');
            }
            return false;
          }
          await this.onSuccess(kind, result);
          this.output.appendLine('\nBuild completed successfully.');
          void vscode.window.showInformationMessage('Paper Notes PDFs were updated.');
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.output.appendLine(`\nERROR: ${message}`);
          if (!this.cancelled) {
            void vscode.window.showErrorMessage(`Paper Notes build failed: ${message}`);
          }
          return false;
        }
      }
    );
  }

  dispose(): void {
    void this.cancelProcessTree();
    this.output.dispose();
    this.diagnostics.dispose();
  }

  private async runLegacy(kind: BuildKind, project: PaperNotesProject): Promise<BuildResult> {
    const configured = kind === 'quick' ? project.build.quickScript : project.build.fullScript;
    if (!configured) {
      throw new Error(`The legacy ${kind} build script is not configured.`);
    }
    const script = await resolveInsideProject(this.workspaceRoot, configured, false);
    this.output.appendLine(`Legacy script: ${script}`);
    const run = await this.spawnLogged('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]);
    return { ok: run.code === 0, flsInputs: [] };
  }

  private async runBuiltin(project: PaperNotesProject): Promise<BuildResult> {
    const report = await this.diagnose();
    for (const check of report.checks) {
      this.output.appendLine(`${check.ok ? '[OK]' : '[MISSING]'} ${check.name}: ${check.detail}`);
    }
    if (!report.ready) {
      throw new Error(`The LaTeX toolchain is incomplete (${report.distribution}). Run “Paper Notes: Project Diagnostics” for installation hints.`);
    }
    const tools = this.executables();
    const notesDir = await resolveInsideProject(this.workspaceRoot, project.notesDir, true);
    const buildRoot = resolve(notesDir, 'build');
    const paperOut = resolve(buildRoot, 'paper');
    const notesOut = resolve(buildRoot, 'notes');
    const annotatedOut = resolve(buildRoot, 'annotated');
    await Promise.all([paperOut, notesOut, annotatedOut].map((path) => mkdir(path, { recursive: true })));

    this.output.appendLine('\n[1/4] Clean paper and dependency recorder');
    const paper = await this.runLatexmk(project.paperEngine, project.rootFile, paperOut, tools);
    if (!paper) {
      return { ok: false, flsInputs: [] };
    }
    const rootStem = basename(project.rootFile, extname(project.rootFile));
    const flsPath = resolve(paperOut, `${rootStem}.fls`);
    const flsInputs = await exists(flsPath)
      ? parseFlsInputs(await readFile(flsPath, 'utf8'), this.workspaceRoot)
      : [];

    this.output.appendLine('\n[2/4] Standalone notes PDF and note-type index');
    const notesRoot = `${project.notesDir}/paper_notes.tex`;
    if (!(await this.runLatexmk(project.notesEngine, notesRoot, notesOut, tools))) {
      return { ok: false, flsInputs };
    }
    const indexPath = resolve(notesOut, 'notetypes.idx');
    if (await exists(indexPath)) {
      const indexRun = await this.spawnLogged(tools.makeindex, [
        '-o', relative(this.workspaceRoot, resolve(notesOut, 'notetypes.ind')).replace(/\\/g, '/'),
        relative(this.workspaceRoot, indexPath).replace(/\\/g, '/')
      ]);
      if (indexRun.code !== 0 || !(await this.runLatexmk(project.notesEngine, notesRoot, notesOut, tools))) {
        return { ok: false, flsInputs };
      }
    }

    this.output.appendLine('\n[3/4] Annotated paper');
    if (!(await this.runLatexmk(project.paperEngine, project.annotatedWrapper, annotatedOut, tools))) {
      return { ok: false, flsInputs };
    }

    this.output.appendLine('\n[4/4] Link validation and atomic publication');
    const notesSource = resolve(notesOut, 'paper_notes.pdf');
    const wrapperStem = basename(project.annotatedWrapper, extname(project.annotatedWrapper));
    const annotatedSource = resolve(annotatedOut, `${wrapperStem}.pdf`);
    if (!(await exists(notesSource)) || !(await exists(annotatedSource))) {
      throw new Error('A successful engine run did not produce both expected PDFs.');
    }
    await this.validateLogs([paperOut, notesOut, annotatedOut]);
    await atomicCopy(notesSource, await resolveInsideProject(this.workspaceRoot, project.notesPdf, true));
    await atomicCopy(annotatedSource, await resolveInsideProject(this.workspaceRoot, project.annotatedPdf, true));
    for (const [sourcePdf, targetPdf] of [[notesSource, project.notesPdf], [annotatedSource, project.annotatedPdf]] as const) {
      const sidecar = sourcePdf.replace(/\.pdf$/i, '.synctex.gz');
      if (await exists(sidecar)) {
        await atomicCopy(sidecar, (await resolveInsideProject(this.workspaceRoot, targetPdf, true)).replace(/\.pdf$/i, '.synctex.gz'));
      }
    }
    return { ok: true, flsInputs };
  }

  private async runLatexmk(engine: PaperEngine, root: string, output: string, tools: ToolExecutables): Promise<boolean> {
    const mode = engine === 'pdflatex' ? '-pdf' : engine === 'xelatex' ? '-xelatex' : '-lualatex';
    const run = await this.spawnLogged(tools.latexmk, [
      mode,
      '-interaction=nonstopmode',
      '-file-line-error',
      '-halt-on-error',
      '-synctex=1',
      `-outdir=${output}`,
      root
    ]);
    return run.code === 0;
  }

  private async validateLogs(directories: string[]): Promise<void> {
    const warnings: string[] = [];
    for (const directory of directories) {
      const candidates = await import('node:fs/promises').then((fs) => fs.readdir(directory, { withFileTypes: true }));
      for (const candidate of candidates) {
        if (!candidate.isFile() || extname(candidate.name).toLowerCase() !== '.log') {
          continue;
        }
        const content = await readFile(resolve(directory, candidate.name), 'utf8');
        for (const pattern of [/LaTeX Warning: There were undefined references/i, /multiply defined/i, /destination with the same identifier/i]) {
          if (pattern.test(content)) {
            warnings.push(`${candidate.name}: ${pattern.source}`);
          }
        }
      }
    }
    if (warnings.length > 0) {
      throw new Error(`Link validation failed:\n${warnings.join('\n')}`);
    }
  }

  private async spawnLogged(executable: string, args: string[]): Promise<{ code: number | null; lines: string[] }> {
    this.output.appendLine(`> ${quoteCommand(executable, args)}`);
    const child = spawn(executable, args, {
      cwd: this.workspaceRoot,
      windowsHide: true,
      shell: false,
      env: { ...process.env, max_print_line: '1000' }
    });
    this.child = child;
    const lines: string[] = [];
    const stdout = new LineDecoder((line) => { this.output.appendLine(line); lines.push(line); });
    const stderr = new LineDecoder((line) => { this.output.appendLine(line); lines.push(line); });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', resolveExit);
    }).finally(() => {
      stdout.end();
      stderr.end();
      this.child = undefined;
    });
    await this.publishDiagnostics(lines);
    return { code, lines };
  }

  private async cancelProcessTree(): Promise<void> {
    const child = this.child;
    if (!child?.pid) {
      return;
    }
    this.cancelled = true;
    if (process.platform === 'win32') {
      await new Promise<void>((resolveDone) => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, shell: false });
        killer.once('close', () => resolveDone());
        killer.once('error', () => { child.kill(); resolveDone(); });
      });
    } else {
      child.kill('SIGTERM');
    }
  }

  private async publishDiagnostics(lines: string[]): Promise<void> {
    const grouped = new Map<string, vscode.Diagnostic[]>();
    const pattern = /^(.+?\.tex):(\d+):(?:(\d+):)?\s*(.+)$/i;
    for (const line of lines) {
      const match = pattern.exec(line.trim());
      if (!match) {
        continue;
      }
      const rawPath = match[1] ?? '';
      const lineNumber = Math.max(0, Number.parseInt(match[2] ?? '1', 10) - 1);
      const column = Math.max(0, Number.parseInt(match[3] ?? '1', 10) - 1);
      const message = match[4]?.trim() || 'LaTeX build error';
      const path = isAbsolute(rawPath) ? rawPath : resolve(this.workspaceRoot, rawPath);
      const uri = vscode.Uri.file(path);
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(lineNumber, column, lineNumber, column + 1),
        message,
        vscode.DiagnosticSeverity.Error
      );
      const current = grouped.get(uri.toString()) ?? [];
      current.push(diagnostic);
      grouped.set(uri.toString(), current);
    }
    for (const [key, diagnostics] of grouped) {
      this.diagnostics.set(vscode.Uri.parse(key), diagnostics);
    }
  }
}

export function defaultExecutables(configuration: vscode.WorkspaceConfiguration): ToolExecutables {
  const get = (name: keyof ToolExecutables): string => configuration.get<string>(`${name}Executable`, name);
  return {
    latexmk: get('latexmk'), pdflatex: get('pdflatex'), xelatex: get('xelatex'),
    lualatex: get('lualatex'), makeindex: get('makeindex'), synctex: get('synctex'), kpsewhich: get('kpsewhich')
  };
}

class LineDecoder {
  private pending = Buffer.alloc(0);
  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    let newline = this.pending.indexOf(0x0a);
    while (newline >= 0) {
      let line = this.pending.subarray(0, newline);
      if (line.at(-1) === 0x0d) {
        line = line.subarray(0, -1);
      }
      this.onLine(decodeBuildOutput(line));
      this.pending = this.pending.subarray(newline + 1);
      newline = this.pending.indexOf(0x0a);
    }
  }

  end(): void {
    if (this.pending.length > 0) {
      this.onLine(decodeBuildOutput(this.pending));
      this.pending = Buffer.alloc(0);
    }
  }
}

export function decodeBuildOutput(buffer: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const replacementRatio = (utf8.match(/\uFFFD/g) ?? []).length / Math.max(1, utf8.length);
  if (replacementRatio < 0.005) {
    return utf8;
  }
  try {
    return new TextDecoder('gbk', { fatal: false }).decode(buffer);
  } catch {
    return utf8;
  }
}

async function runProbe(executable: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveProbe) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    const finish = (value: { code: number | null; stdout: string; stderr: string; error?: string }): void => {
      if (!settled) {
        settled = true;
        resolveProbe(value);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]); });
    child.once('error', (error) => finish({ code: null, stdout: '', stderr: '', error: error.message }));
    child.once('close', (code) => finish({ code, stdout: decodeBuildOutput(stdout), stderr: decodeBuildOutput(stderr) }));
  });
}

async function atomicCopy(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}-${Date.now()}.tmp`;
  await copyFile(source, temp);
  try {
    await rename(temp, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }
    await rm(target, { force: true });
    await rename(temp, target);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function quoteCommand(executable: string, args: string[]): string {
  return [executable, ...args].map((value) => /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value).join(' ');
}

function firstUsefulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? 'available';
}

function executableHint(name: keyof ToolExecutables, distribution: ToolchainReport['distribution'], error?: string): string {
  const manager = distribution === 'MiKTeX' ? 'MiKTeX Console' : 'TeX Live Manager (tlmgr)';
  return `${name} was not found${error ? `: ${error}` : ''}. Install/enable it with ${manager}, then configure paperNotes.${name}Executable if it is not on PATH.`;
}

function packageHint(packageName: string, distribution: ToolchainReport['distribution']): string {
  return distribution === 'MiKTeX'
    ? `${packageName} is missing. Install it from MiKTeX Console (Packages).`
    : `${packageName} is missing. Install the corresponding TeX Live package with tlmgr.`;
}
