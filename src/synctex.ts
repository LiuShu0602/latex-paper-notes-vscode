import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

export interface SyncTeXForwardResult {
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface SyncTeXReverseResult {
  input: string;
  line: number;
  column: number;
}

export class SyncTeXService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly executable: () => string,
    private readonly annotatedPdf: () => string
  ) {}

  async forward(inputFile: string, line: number, column: number): Promise<SyncTeXForwardResult> {
    const pdf = resolve(this.workspaceRoot, this.annotatedPdf());
    await assertSyncFiles(pdf);
    const output = await runSyncTeX(
      this.executable(),
      buildSyncTeXViewArgs(inputFile, line, column, pdf),
      this.workspaceRoot
    );
    const result = parseSyncTeXForward(output);
    if (!result) {
      throw new Error('SyncTeX 没有返回 PDF 位置；请先保存源码并重新执行快速编译。');
    }
    return result;
  }

  async reverse(page: number, x: number, y: number): Promise<SyncTeXReverseResult> {
    const pdf = resolve(this.workspaceRoot, this.annotatedPdf());
    await assertSyncFiles(pdf);
    const output = await runSyncTeX(
      this.executable(),
      buildSyncTeXEditArgs(pdf, page, x, y),
      this.workspaceRoot
    );
    const result = parseSyncTeXReverse(output);
    if (!result) {
      throw new Error('SyncTeX 没有找到对应的 LaTeX 行；请尝试单击正文字符附近。');
    }
    const input = isAbsolute(result.input) ? resolve(result.input) : resolve(this.workspaceRoot, result.input);
    const relativePath = relative(this.workspaceRoot, input);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('SyncTeX 返回了工作区之外的文件，扩展已拒绝打开。');
    }
    return { ...result, input };
  }
}

export function buildSyncTeXViewArgs(inputFile: string, line: number, column: number, pdf: string): string[] {
  return ['view', '-i', `${line}:${column}:${inputFile}`, '-o', pdf];
}

export function buildSyncTeXEditArgs(pdf: string, page: number, x: number, y: number): string[] {
  return ['edit', '-o', `${page}:${x.toFixed(3)}:${y.toFixed(3)}:${pdf}`];
}

export function parseSyncTeXForward(output: string): SyncTeXForwardResult | undefined {
  const fields = parseFields(output);
  const page = numberField(fields, 'Page');
  const x = numberField(fields, 'h') ?? numberField(fields, 'x');
  const y = numberField(fields, 'v') ?? numberField(fields, 'y');
  if (page === undefined || x === undefined || y === undefined) {
    return undefined;
  }
  const width = numberField(fields, 'W') ?? numberField(fields, 'Width');
  const height = numberField(fields, 'H') ?? numberField(fields, 'Height');
  return {
    page: Math.max(1, Math.trunc(page)),
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: width === undefined ? undefined : Math.max(0, width),
    height: height === undefined ? undefined : Math.max(0, height)
  };
}

export function parseSyncTeXReverse(output: string): SyncTeXReverseResult | undefined {
  const fields = parseFields(output);
  const input = fields.get('Input')?.[0]?.trim();
  const line = numberField(fields, 'Line');
  const column = numberField(fields, 'Column') ?? 1;
  if (!input || line === undefined) {
    return undefined;
  }
  return {
    input,
    line: Math.max(1, Math.trunc(line)),
    column: Math.max(1, Math.trunc(column))
  };
}

async function assertSyncFiles(pdf: string): Promise<void> {
  try {
    await access(pdf, constants.R_OK);
  } catch {
    throw new Error(`找不到批注 PDF：${pdf}。请先执行“快速编译”。`);
  }
  const sidecar = pdf.replace(/\.pdf$/i, '.synctex.gz');
  try {
    await access(sidecar, constants.R_OK);
  } catch {
    throw new Error(`找不到 ${sidecar}。请用 0.2.0 构建脚本重新执行“快速编译”。`);
  }
}

async function runSyncTeX(executable: string, args: string[], cwd: string): Promise<string> {
  const command = executable.trim();
  if (!command || command.includes('\0')) {
    throw new Error('paperNotes.synctexExecutable 配置无效。');
  }
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('SyncTeX 超过 15 秒未返回，进程已终止。'));
    }, 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1_000_000) {
        child.kill();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动 SyncTeX（${command}）：${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const decodedStdout = decodeSyncTeXOutput(Buffer.concat(stdout));
      const decodedStderr = decodeSyncTeXOutput(Buffer.concat(stderr));
      if (code !== 0) {
        reject(new Error(`SyncTeX 执行失败（退出码 ${code ?? 'unknown'}）：${decodedStderr.trim() || decodedStdout.trim()}`));
        return;
      }
      resolvePromise(decodedStdout);
    });
  });
}

export function decodeSyncTeXOutput(value: Buffer): string {
  const utf8 = value.toString('utf8');
  if (process.platform !== 'win32' || !utf8.includes('\uFFFD')) {
    return utf8;
  }
  try {
    return new TextDecoder('gbk').decode(value);
  } catch {
    return utf8;
  }
}

function parseFields(output: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^([A-Za-z]+):(.*)$/.exec(line.trim());
    if (!match?.[1]) {
      continue;
    }
    const values = fields.get(match[1]) ?? [];
    values.push(match[2] ?? '');
    fields.set(match[1], values);
  }
  return fields;
}

function numberField(fields: Map<string, string[]>, name: string): number | undefined {
  const raw = fields.get(name)?.[0];
  if (raw === undefined) {
    return undefined;
  }
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}
