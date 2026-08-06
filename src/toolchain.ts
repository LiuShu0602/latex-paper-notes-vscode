import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { PaperEngine } from './model.js';

export const TOOL_NAMES = [
  'latexmk', 'pdflatex', 'xelatex', 'lualatex', 'makeindex', 'synctex', 'kpsewhich'
] as const;

export type ToolName = typeof TOOL_NAMES[number];

export interface ToolExecutables {
  latexmk: string;
  pdflatex: string;
  xelatex: string;
  lualatex: string;
  makeindex: string;
  synctex: string;
  kpsewhich: string;
}

export type TeXDistribution = 'TeX Live' | 'MiKTeX' | 'unknown';

export interface ProcessProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
}

export interface ExecutableGroup {
  id: string;
  distribution: TeXDistribution;
  label: string;
  preference: number;
}

export interface ToolsetSelection {
  executables: ToolExecutables;
  distribution: TeXDistribution;
  distributionDetail: string;
  coherent: boolean;
  coherenceDetail: string;
}

export function probeArguments(name: ToolName): string[] {
  switch (name) {
    case 'latexmk':
      return ['-v'];
    case 'makeindex':
      // makeindex deliberately has no portable --version option.  Both TeX
      // Live and MiKTeX print their usage for -h, commonly with exit code 1.
      return ['-h'];
    case 'synctex':
      return ['help'];
    default:
      return ['--version'];
  }
}

export function probeSucceeded(name: ToolName, result: ProcessProbeResult): boolean {
  if (result.error || result.timedOut) {
    return false;
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  switch (name) {
    case 'makeindex':
      return result.code === 0 || /usage:\s*makeindex/i.test(combined);
    case 'synctex':
      return result.code === 0 || /(?:synctex|synchronize texnology).*usage|usage:\s*synctex/i.test(combined);
    case 'latexmk':
      return result.code === 0 && !/perl interpreter could not be found|perl[^\r\n]*not found/i.test(combined);
    default:
      return result.code === 0;
  }
}

export function probeFailureReason(name: ToolName, result: ProcessProbeResult): string | undefined {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.timedOut) {
    return 'the probe timed out';
  }
  if (result.error) {
    return result.error;
  }
  if (name === 'latexmk' && /perl interpreter could not be found|perl[^\r\n]*not found/i.test(combined)) {
    return 'latexmk is installed but cannot start because Perl is unavailable';
  }
  return firstUsefulLine(combined);
}

export function probeSuccessSummary(name: ToolName, result: ProcessProbeResult): string {
  const combined = `${result.stdout}\n${result.stderr}`;
  const lines = combined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (name === 'makeindex') {
    return 'makeindex usage probe succeeded';
  }
  if (name === 'latexmk') {
    return lines.find((line) => /latexmk.*version/i.test(line)) ?? 'latexmk is available';
  }
  if (name === 'synctex') {
    return lines.find((line) => /synctex.*version/i.test(line)) ?? 'SyncTeX is available';
  }
  return lines[0] ?? `${name} is available`;
}

export function classifyExecutablePath(path: string): ExecutableGroup {
  const normalized = path.replace(/\//g, '\\');
  const lower = normalized.toLowerCase();
  const texLive = /^(.*\\texlive\\(\d{4}))\\bin\\/.exec(lower);
  if (texLive) {
    const year = Number.parseInt(texLive[2] ?? '0', 10);
    return {
      id: texLive[1] ?? lower,
      distribution: 'TeX Live',
      label: year ? `TeX Live ${year}` : 'TeX Live',
      preference: 20_000 + year
    };
  }
  const miktex = /^(.*\\miktex)\\bin(?:\\x64)?\\/.exec(lower);
  if (miktex) {
    return {
      id: miktex[1] ?? lower,
      distribution: 'MiKTeX',
      label: 'MiKTeX',
      preference: 10_000
    };
  }
  const directory = dirname(normalized).toLowerCase();
  return {
    id: directory || lower,
    distribution: 'unknown',
    label: directory || 'unknown',
    preference: 0
  };
}

export function selectCoherentToolset(
  configured: ToolExecutables,
  candidates: Record<ToolName, string[]>,
  required: ToolName[]
): ToolsetSelection {
  const primary = required[0];
  if (!primary) {
    throw new Error('At least one required TeX executable is needed.');
  }
  const allCandidates = (name: ToolName): string[] => {
    const values = candidates[name].filter(Boolean);
    return values.length > 0 ? values : [configured[name]];
  };
  const primaryCandidates = allCandidates(primary);
  const explicitPrimary = isPathLike(configured[primary]);
  let anchor = classifyExecutablePath(primaryCandidates[0] ?? configured[primary]);
  if (!explicitPrimary) {
    const groups = new Map<string, ExecutableGroup>();
    for (const candidate of primaryCandidates) {
      const group = classifyExecutablePath(candidate);
      groups.set(group.id, group);
    }
    anchor = [...groups.values()].sort((left, right) => {
      const leftCoverage = required.filter((name) => allCandidates(name).some((path) => classifyExecutablePath(path).id === left.id)).length;
      const rightCoverage = required.filter((name) => allCandidates(name).some((path) => classifyExecutablePath(path).id === right.id)).length;
      return rightCoverage - leftCoverage || right.preference - left.preference;
    })[0] ?? anchor;
  }

  const selected = {} as ToolExecutables;
  for (const name of TOOL_NAMES) {
    const values = allCandidates(name);
    if (isPathLike(configured[name])) {
      selected[name] = values[0] ?? configured[name];
      continue;
    }
    selected[name] = values.find((path) => classifyExecutablePath(path).id === anchor.id) ?? values[0] ?? configured[name];
  }

  const requiredGroups = new Map(required.map((name) => [name, classifyExecutablePath(selected[name])]));
  const coherent = [...requiredGroups.values()].every((group) => group.id === anchor.id);
  const coherenceDetail = coherent
    ? `Using ${anchor.label} from one executable directory.`
    : `Required tools resolve to different TeX installations: ${required.map((name) => `${name}=${selected[name]}`).join('; ')}. Put one TeX bin directory first on PATH or configure matching paperNotes.*Executable paths.`;
  return {
    executables: selected,
    distribution: anchor.distribution,
    distributionDetail: anchor.label,
    coherent,
    coherenceDetail
  };
}

export async function resolveToolset(
  configured: ToolExecutables,
  required: ToolName[],
  cwd: string
): Promise<ToolsetSelection> {
  const entries = await Promise.all(TOOL_NAMES.map(async (name) => [
    name,
    await executableCandidates(configured[name], cwd)
  ] as const));
  return selectCoherentToolset(configured, Object.fromEntries(entries) as Record<ToolName, string[]>, required);
}

export async function runToolProbe(name: ToolName, executable: string, cwd: string): Promise<ProcessProbeResult> {
  return runProcessProbe(executable, probeArguments(name), cwd);
}

export function latexmkEngineOption(engine: PaperEngine, executable: string): string {
  const option = engine === 'pdflatex' ? '-pdflatex' : engine === 'xelatex' ? '-pdfxelatex' : '-pdflualatex';
  const normalized = executable.replace(/\\/g, '/');
  const command = /\s/.test(normalized) ? `"${normalized.replace(/"/g, '\\"')}"` : normalized;
  return `${option}=${command}`;
}

export function toolchainProcessEnvironment(
  tools: ToolExecutables,
  engine: PaperEngine,
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(base).find((key) => key.toLowerCase() === 'path') ?? (process.platform === 'win32' ? 'Path' : 'PATH');
  const orderedTools: ToolName[] = [engine, 'kpsewhich', 'makeindex', 'synctex', 'latexmk'];
  const directories = orderedTools
    .map((name) => tools[name])
    .filter((path) => isAbsolute(path))
    .map((path) => dirname(path));
  const unique = [...new Map(directories.map((path) => [path.toLowerCase(), path])).values()];
  const separator = process.platform === 'win32' ? ';' : ':';
  const existing = base[pathKey] ?? '';
  return {
    ...base,
    [pathKey]: [...unique, existing].filter(Boolean).join(separator)
  };
}

export async function runProcessProbe(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 8_000
): Promise<ProcessProbeResult> {
  return new Promise((resolveProbe) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    const finish = (value: ProcessProbeResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolveProbe(value);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]); });
    child.once('error', (error) => finish({ code: null, stdout: '', stderr: '', error: error.message }));
    child.once('close', (code) => finish({
      code,
      stdout: decodeCommandOutput(stdout),
      stderr: decodeCommandOutput(stderr),
      timedOut
    }));
    child.stdin.end();
  });
}

export function decodeCommandOutput(buffer: Buffer): string {
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

async function executableCandidates(executable: string, cwd: string): Promise<string[]> {
  if (isPathLike(executable)) {
    return [isAbsolute(executable) ? executable : resolve(cwd, executable)];
  }
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const args = process.platform === 'win32' ? [executable] : ['-a', executable];
  const result = await runProcessProbe(locator, args, cwd, 5_000);
  const values = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : [executable];
}

function isPathLike(value: string): boolean {
  return isAbsolute(value) || /[\\/]/.test(value);
}

function firstUsefulLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}
