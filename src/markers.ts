import { maskCommentsAndVerbatim } from './project.js';

export interface MarkerRange {
  id: string;
  beginStart: number;
  contentStart: number;
  contentEnd: number;
  endEnd: number;
}

export interface MarkerProblem {
  message: string;
  start: number;
  end: number;
  code: 'duplicate' | 'nested' | 'orphan-begin' | 'orphan-end' | 'mismatch' | 'empty';
}

export interface MarkerScanResult {
  ranges: MarkerRange[];
  problems: MarkerProblem[];
}

export interface SelectionValidation {
  ok: boolean;
  start: number;
  end: number;
  existingId?: string;
  error?: string;
}

const MARKER_TOKEN = /\\PaperNote(Begin|End)\{([^{}]+)\}/g;
const DISPLAY_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'aligned',
  'gather',
  'gather*',
  'multline',
  'multline*'
]);
const DISALLOWED_SELECTION = /\\(?:part|chapter|section|subsection|subsubsection)\*?\s*\{|\\begin\s*\{(?:table\*?|figure\*?)\}/;

export function scanMarkers(source: string): MarkerScanResult {
  const ranges: MarkerRange[] = [];
  const problems: MarkerProblem[] = [];
  const seen = new Map<string, MarkerRange>();
  let open: { id: string; beginStart: number; contentStart: number; tokenEnd: number } | undefined;

  const searchable = maskCommentsAndVerbatim(source);
  MARKER_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_TOKEN.exec(searchable)) !== null) {
    const kind = match[1];
    const id = match[2] ?? '';
    const tokenStart = match.index;
    const tokenEnd = MARKER_TOKEN.lastIndex;
    if (kind === 'Begin') {
      if (open) {
        problems.push({
          message: `笔记 ${id} 嵌套在尚未结束的笔记 ${open.id} 中；v1 不允许交叉或嵌套选区。`,
          start: tokenStart,
          end: tokenEnd,
          code: 'nested'
        });
      } else {
        open = { id, beginStart: tokenStart, contentStart: tokenEnd, tokenEnd };
      }
      continue;
    }

    if (!open) {
      problems.push({
        message: `发现没有对应开始标记的 PaperNoteEnd{${id}}。`,
        start: tokenStart,
        end: tokenEnd,
        code: 'orphan-end'
      });
      continue;
    }
    if (open.id !== id) {
      problems.push({
        message: `笔记开始 ID ${open.id} 与结束 ID ${id} 不一致。`,
        start: open.beginStart,
        end: tokenEnd,
        code: 'mismatch'
      });
      open = undefined;
      continue;
    }

    const range: MarkerRange = {
      id,
      beginStart: open.beginStart,
      contentStart: open.contentStart,
      contentEnd: tokenStart,
      endEnd: tokenEnd
    };
    if (range.contentStart === range.contentEnd) {
      problems.push({
        message: `笔记 ${id} 的论文选区为空。`,
        start: range.beginStart,
        end: range.endEnd,
        code: 'empty'
      });
    }
    const previous = seen.get(id);
    if (previous) {
      problems.push({
        message: `笔记 ID ${id} 在主文中出现多次。`,
        start: range.beginStart,
        end: range.endEnd,
        code: 'duplicate'
      });
    } else {
      seen.set(id, range);
    }
    ranges.push(range);
    open = undefined;
  }

  if (open) {
    problems.push({
      message: `PaperNoteBegin{${open.id}} 缺少对应的结束标记。`,
      start: open.beginStart,
      end: open.tokenEnd,
      code: 'orphan-begin'
    });
  }

  return { ranges, problems };
}

export function validateSelection(source: string, rawStart: number, rawEnd: number): SelectionValidation {
  let start = Math.min(rawStart, rawEnd);
  let end = Math.max(rawStart, rawEnd);
  while (start < end && /\s/.test(source[start] ?? '')) {
    start += 1;
  }
  while (end > start && /\s/.test(source[end - 1] ?? '')) {
    end -= 1;
  }
  if (start === end) {
    return { ok: false, start, end, error: '请先选中一句话、一段正文或一个完整公式环境。' };
  }

  const searchable = maskCommentsAndVerbatim(source);
  const documentStart = searchable.indexOf('\\begin{document}');
  const documentEnd = searchable.lastIndexOf('\\end{document}');
  if (documentStart < 0 || documentEnd < 0 || start <= documentStart || end >= documentEnd) {
    return { ok: false, start, end, error: '只能给 document 环境中的论文正文添加笔记。' };
  }

  const markerScan = scanMarkers(source);
  for (const range of markerScan.ranges) {
    if (start === range.contentStart && end === range.contentEnd) {
      return { ok: true, start, end, existingId: range.id };
    }
    const overlaps = start < range.endEnd && end > range.beginStart;
    if (overlaps) {
      return {
        ok: false,
        start,
        end,
        error: `当前选区与已有笔记 ${range.id} 重叠。请打开原笔记添加条目。`
      };
    }
  }

  const selected = source.slice(start, end);
  const searchableSelection = searchable.slice(start, end);
  if (selectionTouchesMaskedRegion(source, searchable, start, end)) {
    return { ok: false, start, end, error: '不能在注释或 verbatim 类环境中创建论文笔记。' };
  }
  if (DISALLOWED_SELECTION.test(searchableSelection)) {
    return { ok: false, start, end, error: '本版不支持直接选择章节标题、表格或图片环境。' };
  }
  if (/\\PaperNote(?:Begin|End|Anchor)\s*\{/.test(selected)) {
    return { ok: false, start, end, error: '选区中不能包含已有论文笔记标记。' };
  }
  if (splitsControlWord(source, start) || splitsControlWord(source, end)) {
    return { ok: false, start, end, error: '选区边界截断了 LaTeX 命令名称。请扩大或缩小选区。' };
  }

  const balanceError = validateBalancedLatex(searchableSelection);
  if (balanceError) {
    return { ok: false, start, end, error: balanceError };
  }

  const activeEnvironment = innermostEnvironmentAt(searchable, start);
  if (activeEnvironment && DISPLAY_ENVIRONMENTS.has(activeEnvironment) && !selected.trimStart().startsWith(`\\begin{${activeEnvironment}}`)) {
    return { ok: false, start, end, error: `公式笔记必须完整选择 ${activeEnvironment} 环境。` };
  }

  const mathError = validateMathBoundaries(searchable, start, end);
  if (mathError) {
    return { ok: false, start, end, error: mathError };
  }

  return { ok: true, start, end };
}

export function generateSemanticId(source: string, selectionStart: number, selected: string, existingIds: Iterable<string>): string {
  const section = nearestSectionSlug(source, selectionStart);
  const words = plainWords(selected).filter((word) => !STOP_WORDS.has(word));
  const tail = words.slice(0, 3).join('-') || 'note';
  const base = `${section}:${tail}`;
  const used = new Set(existingIds);
  if (!used.has(base)) {
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function nearestSectionTitle(source: string, position: number): string {
  const prefix = source.slice(0, position);
  const regex = /\\section\*?\s*\{([^{}]+)\}/g;
  let title = 'Main Paper';
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prefix)) !== null) {
    title = match[1]?.trim() || title;
  }
  return title;
}

export function latexToPlainText(source: string): string {
  return source
    .replace(/(?<!\\)%[^\r\n]*/g, '')
    .replace(/\\(?:label|PaperNoteBegin|PaperNoteEnd|PaperNoteAnchor)\s*\{[^{}]*\}/g, '')
    .replace(/\\(?:cite|ref|eqref|autoref)\s*\{([^{}]*)\}/g, '[$1]')
    .replace(/\\begin\s*\{([^{}]+)\}|\\end\s*\{([^{}]+)\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?\s*/g, '')
    .replace(/\\([#$%&_{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateBalancedLatex(selected: string): string | undefined {
  let depth = 0;
  let inComment = false;
  for (let index = 0; index < selected.length; index += 1) {
    const char = selected[index] ?? '';
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      continue;
    }
    if (char === '%' && !isEscaped(selected, index)) {
      inComment = true;
      continue;
    }
    if (char === '{' && !isEscaped(selected, index)) {
      depth += 1;
    } else if (char === '}' && !isEscaped(selected, index)) {
      depth -= 1;
      if (depth < 0) {
        return '选区包含没有对应左花括号的 }。';
      }
    }
  }
  if (depth !== 0) {
    return '选区中的 LaTeX 花括号不平衡。';
  }

  const environmentStack: string[] = [];
  const environmentRegex = /\\(begin|end)\s*\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = environmentRegex.exec(stripComments(selected))) !== null) {
    const kind = match[1];
    const environment = match[2] ?? '';
    if (!DISPLAY_ENVIRONMENTS.has(environment)) {
      return `v1 不能为 ${environment} 环境整体添加选区笔记。`;
    }
    if (kind === 'begin') {
      environmentStack.push(environment);
    } else if (environmentStack.pop() !== environment) {
      return `选区中的 ${environment} 环境没有完整配对。`;
    }
  }
  if (environmentStack.length > 0) {
    return `选区中的 ${environmentStack.at(-1)} 环境没有完整结束。`;
  }

  const openDisplay = (stripComments(selected).match(/\\\[/g) ?? []).length;
  const closeDisplay = (stripComments(selected).match(/\\\]/g) ?? []).length;
  if (openDisplay !== closeDisplay) {
    return '选区中的 \\[ ... \\] 公式没有完整配对。';
  }
  const openInline = (stripComments(selected).match(/\\\(/g) ?? []).length;
  const closeInline = (stripComments(selected).match(/\\\)/g) ?? []).length;
  if (openInline !== closeInline) {
    return '选区中的 \\( ... \\) 公式没有完整配对。';
  }
  let singleDollars = 0;
  let doubleDollars = 0;
  for (let index = 0; index < selected.length; index += 1) {
    if (selected[index] !== '$' || isEscaped(selected, index)) {
      continue;
    }
    if (selected[index + 1] === '$') {
      doubleDollars += 1;
      index += 1;
    } else {
      singleDollars += 1;
    }
  }
  if (singleDollars % 2 !== 0 || doubleDollars % 2 !== 0) {
    return '选区中的 $...$ 或 $$...$$ 公式没有完整配对。';
  }
  return undefined;
}

function selectionTouchesMaskedRegion(source: string, masked: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const original = source[index] ?? '';
    if (!/\s/.test(original) && masked[index] === ' ') {
      return true;
    }
  }
  return false;
}

function validateMathBoundaries(source: string, start: number, end: number): string | undefined {
  const before = mathModeAt(source, start);
  const after = mathModeAt(source, end);
  if (before || after) {
    return '选区边界位于公式内部；请完整选择整个公式或把边界移到公式之外。';
  }
  return undefined;
}

function mathModeAt(source: string, position: number): '$' | '$$' | '\\(' | '\\[' | undefined {
  let mode: '$' | '$$' | '\\(' | '\\[' | undefined;
  for (let index = 0; index < position; index += 1) {
    if (source[index] === '$' && !isEscaped(source, index)) {
      const token: '$' | '$$' = source[index + 1] === '$' ? '$$' : '$';
      if (token === '$$') {
        index += 1;
      }
      mode = mode === token ? undefined : mode ? mode : token;
      continue;
    }
    const token = source.slice(index, index + 2);
    if (token === '\\(' && !mode) {
      mode = '\\(';
      index += 1;
    } else if (token === '\\)' && mode === '\\(') {
      mode = undefined;
      index += 1;
    } else if (token === '\\[' && !mode) {
      mode = '\\[';
      index += 1;
    } else if (token === '\\]' && mode === '\\[') {
      mode = undefined;
      index += 1;
    }
  }
  return mode;
}

function innermostEnvironmentAt(source: string, position: number): string | undefined {
  const stack: string[] = [];
  const regex = /\\(begin|end)\s*\{([^{}]+)\}/g;
  const prefix = stripComments(source.slice(0, position));
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prefix)) !== null) {
    const kind = match[1];
    const environment = match[2] ?? '';
    if (kind === 'begin') {
      stack.push(environment);
    } else {
      const index = stack.lastIndexOf(environment);
      if (index >= 0) {
        stack.splice(index, 1);
      }
    }
  }
  return stack.at(-1);
}

function splitsControlWord(source: string, position: number): boolean {
  const left = source[position - 1] ?? '';
  const right = source[position] ?? '';
  if (!/[A-Za-z@]/.test(left) || !/[A-Za-z@]/.test(right)) {
    return false;
  }
  let cursor = position - 1;
  while (cursor >= 0 && /[A-Za-z@]/.test(source[cursor] ?? '')) {
    cursor -= 1;
  }
  return source[cursor] === '\\';
}

function stripComments(source: string): string {
  return source.replace(/(?<!\\)%[^\r\n]*/g, '');
}

function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let cursor = position - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function nearestSectionSlug(source: string, position: number): string {
  const prefix = source.slice(0, position);
  const sectionRegex = /\\section\*?\s*\{([^{}]+)\}/g;
  let sectionTitle = 'main';
  let sectionIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(prefix)) !== null) {
    sectionTitle = match[1] ?? sectionTitle;
    sectionIndex = match.index;
  }
  const afterSection = prefix.slice(sectionIndex);
  const label = /\\label\s*\{sec:([^{}]+)\}/.exec(afterSection)?.[1];
  return slugify(label || sectionTitle) || 'main';
}

function plainWords(source: string): string[] {
  return latexToPlainText(source)
    .toLowerCase()
    .match(/[a-z][a-z0-9]*/g) ?? [];
}

function slugify(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'then', 'this', 'to',
  'under', 'was', 'were', 'when', 'which', 'with'
]);
