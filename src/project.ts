import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { normalizeRelativePosixPath, type PaperEngine, type PaperNotesProject } from './model.js';

export interface SourceDependency {
  command: 'input' | 'include' | 'subfile' | 'import' | 'subimport' | 'InputIfFileExists';
  raw: string;
  path?: string;
  offset: number;
  dynamic: boolean;
}

export interface SourceGraphDiagnostic {
  kind: 'cycle' | 'missing' | 'dynamic' | 'outside' | 'read-error';
  sourceFile: string;
  target?: string;
  message: string;
}

export interface SourceGraph {
  rootFile: string;
  sourceFiles: string[];
  dependencies: Map<string, SourceDependency[]>;
  diagnostics: SourceGraphDiagnostic[];
}

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'LVerbatim', 'lstlisting',
  'minted', 'comment', 'filecontents', 'filecontents*'
]);

export function extractTexRootDirective(source: string): string | undefined {
  const match = /^\s*%\s*!TeX\s+root\s*=\s*(.+?)\s*$/im.exec(source.slice(0, 12_000));
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

export function looksLikeRootDocument(source: string): boolean {
  const cleaned = maskCommentsAndVerbatim(source);
  return /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(cleaned)
    && /\\begin\s*\{document\}/.test(cleaned);
}

export function inferPaperEngine(source: string): PaperEngine {
  const directive = /^\s*%\s*!TeX\s+program\s*=\s*([^\s]+)\s*$/im.exec(source.slice(0, 12_000))?.[1]?.toLowerCase();
  if (directive?.includes('xelatex')) {
    return 'xelatex';
  }
  if (directive?.includes('lualatex')) {
    return 'lualatex';
  }
  if (directive?.includes('pdflatex')) {
    return 'pdflatex';
  }
  if (/\\usepackage(?:\[[^\]]*\])?\{(?:fontspec|xeCJK)\}|\\setmainfont\b/.test(source)) {
    return 'xelatex';
  }
  if (/\\directlua\b|\\usepackage(?:\[[^\]]*\])?\{luacode\}/.test(source)) {
    return 'lualatex';
  }
  return 'pdflatex';
}

export function parseLatexDependencies(source: string, sourceFile: string): SourceDependency[] {
  const masked = maskCommentsAndVerbatim(source);
  const dependencies: SourceDependency[] = [];
  const simple = /\\(input|include|subfile|InputIfFileExists)\s*\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = simple.exec(masked)) !== null) {
    const raw = source.slice(match.index, simple.lastIndex);
    const argument = source.slice(match.index, simple.lastIndex).match(/\{([^{}]*)\}/)?.[1]?.trim() ?? '';
    const command = match[1] as SourceDependency['command'];
    const dynamic = !isLiteralIncludePath(argument);
    dependencies.push({
      command,
      raw,
      path: dynamic ? undefined : resolveIncludePath(sourceFile, argument),
      offset: match.index,
      dynamic
    });
  }

  const imports = /\\(import|subimport)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
  while ((match = imports.exec(masked)) !== null) {
    const folder = match[2]?.trim() ?? '';
    const file = match[3]?.trim() ?? '';
    const combined = `${folder}/${file}`.replace(/\/{2,}/g, '/');
    const dynamic = !isLiteralIncludePath(folder) || !isLiteralIncludePath(file);
    dependencies.push({
      command: match[1] as 'import' | 'subimport',
      raw: source.slice(match.index, imports.lastIndex),
      path: dynamic ? undefined : resolveIncludePath(sourceFile, combined),
      offset: match.index,
      dynamic
    });
  }
  return dependencies.sort((left, right) => left.offset - right.offset);
}

export async function discoverSourceGraph(workspaceRoot: string, rootFileValue: string): Promise<SourceGraph> {
  const rootFile = normalizeRelativePosixPath(ensureTexExtension(rootFileValue), 'rootFile');
  const sourceFiles: string[] = [];
  const dependencies = new Map<string, SourceDependency[]>();
  const diagnostics: SourceGraphDiagnostic[] = [];
  const visited = new Set<string>();
  const active: string[] = [];

  const visit = async (sourceFile: string): Promise<void> => {
    if (active.includes(sourceFile)) {
      diagnostics.push({
        kind: 'cycle', sourceFile: active.at(-1) ?? rootFile, target: sourceFile,
        message: `Cyclic LaTeX include: ${[...active, sourceFile].join(' -> ')}`
      });
      return;
    }
    if (visited.has(sourceFile)) {
      return;
    }
    visited.add(sourceFile);
    sourceFiles.push(sourceFile);
    active.push(sourceFile);
    let absolute: string;
    try {
      absolute = await resolveInsideProject(workspaceRoot, sourceFile, false);
    } catch (error) {
      diagnostics.push({ kind: 'outside', sourceFile, message: errorMessage(error) });
      active.pop();
      return;
    }
    let source: string;
    try {
      source = await readFile(absolute, 'utf8');
    } catch (error) {
      diagnostics.push({ kind: 'read-error', sourceFile, message: `Cannot read ${sourceFile}: ${errorMessage(error)}` });
      active.pop();
      return;
    }
    const parsed = parseLatexDependencies(source, sourceFile);
    dependencies.set(sourceFile, parsed);
    for (const dependency of parsed) {
      if (dependency.dynamic || !dependency.path) {
        diagnostics.push({
          kind: 'dynamic', sourceFile, message: `Dynamic include requires confirmation: ${dependency.raw}`
        });
        continue;
      }
      try {
        const target = normalizeRelativePosixPath(dependency.path);
        const targetAbsolute = await resolveInsideProject(workspaceRoot, target, true);
        if (!(await exists(targetAbsolute))) {
          diagnostics.push({ kind: 'missing', sourceFile, target, message: `Included file does not exist: ${target}` });
          continue;
        }
        await visit(target);
      } catch (error) {
        diagnostics.push({
          kind: 'outside', sourceFile, target: dependency.path,
          message: `Rejected include ${dependency.path}: ${errorMessage(error)}`
        });
      }
    }
    active.pop();
  };

  await visit(rootFile);
  return { rootFile, sourceFiles, dependencies, diagnostics };
}

export function parseFlsInputs(fls: string, workspaceRoot: string): string[] {
  const root = resolve(workspaceRoot);
  const found = new Set<string>();
  for (const line of fls.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('INPUT ')) {
      continue;
    }
    const raw = line.slice(6).trim().replace(/^"|"$/g, '');
    if (!raw || extname(raw).toLowerCase() !== '.tex') {
      continue;
    }
    const absolute = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
      continue;
    }
    found.add(normalizeRelativePosixPath(rel));
  }
  return [...found];
}

export async function resolveInsideProject(workspaceRoot: string, projectPath: string, allowMissing: boolean): Promise<string> {
  const normalized = normalizeRelativePosixPath(projectPath);
  const rootResolved = resolve(workspaceRoot);
  const candidate = resolve(rootResolved, ...normalized.split('/'));
  assertLexicallyInside(rootResolved, candidate);

  const rootReal = await realpath(rootResolved);
  if (await exists(candidate)) {
    const targetReal = await realpath(candidate);
    assertLexicallyInside(rootReal, targetReal);
    return candidate;
  }
  if (!allowMissing) {
    throw new Error(`Project file does not exist: ${normalized}`);
  }
  let ancestor = candidate;
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error(`Cannot resolve a safe parent for ${normalized}.`);
    }
    ancestor = parent;
  }
  const ancestorReal = await realpath(ancestor);
  assertLexicallyInside(rootReal, ancestorReal);
  return candidate;
}

export async function assertProjectFilesSafe(workspaceRoot: string, project: PaperNotesProject): Promise<void> {
  const values = new Set([
    project.rootFile,
    ...project.sourceFiles,
    project.notesDir,
    project.generatedNotesFile,
    project.annotatedWrapper,
    project.annotatedPdf,
    project.notesPdf,
    project.build.quickScript,
    project.build.fullScript
  ].filter((value): value is string => Boolean(value)));
  for (const value of values) {
    await resolveInsideProject(workspaceRoot, value, true);
  }
}

export function maskCommentsAndVerbatim(source: string): string {
  const chars = [...source];
  const replaceRange = (start: number, end: number): void => {
    for (let index = start; index < end; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') {
        chars[index] = ' ';
      }
    }
  };
  const environment = /\\(begin|end)\s*\{([^{}]+)\}/g;
  const stack: Array<{ name: string; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = environment.exec(source)) !== null) {
    const name = match[2] ?? '';
    if (!VERBATIM_ENVIRONMENTS.has(name)) {
      continue;
    }
    if (match[1] === 'begin') {
      stack.push({ name, start: match.index });
    } else {
      const openIndex = stack.map((item) => item.name).lastIndexOf(name);
      if (openIndex >= 0) {
        const open = stack[openIndex]!;
        stack.splice(openIndex, 1);
        replaceRange(open.start, environment.lastIndex);
      }
    }
  }
  for (const open of stack) {
    replaceRange(open.start, source.length);
  }
  for (let lineStart = 0; lineStart < source.length;) {
    let lineEnd = source.indexOf('\n', lineStart);
    if (lineEnd < 0) {
      lineEnd = source.length;
    }
    for (let index = lineStart; index < lineEnd; index += 1) {
      if (source[index] === '%' && !isEscaped(source, index)) {
        replaceRange(index, lineEnd);
        break;
      }
    }
    lineStart = lineEnd + 1;
  }
  return chars.join('');
}

function resolveIncludePath(sourceFile: string, argument: string): string {
  const withExtension = ensureTexExtension(argument.replace(/\\/g, '/'));
  return posix.normalize(`${posix.dirname(sourceFile)}/${withExtension}`).replace(/^\.\//, '');
}

function ensureTexExtension(value: string): string {
  return extname(value) ? value : `${value}.tex`;
}

function isLiteralIncludePath(value: string): boolean {
  return Boolean(value) && !/[\\{}#$]/.test(value);
}

function assertLexicallyInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (!rel || rel === '.') {
    return;
  }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes the project folder: ${target}`);
  }
}

function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let cursor = position - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
