import { randomUUID } from 'node:crypto';
import { createEmptyData, hashText, type NoteItem, type PaperNote, type PaperNotesData } from './model.js';
import { buildSourceSelector } from './source-selector.js';

export interface LegacyMigration {
  data: PaperNotesData;
  matches: Array<{ id: string; start: number; end: number }>;
}

interface GroupRead {
  value: string;
  end: number;
}

export function parseLegacyNotes(legacyTex: string, mainSource: string, now = new Date().toISOString()): LegacyMigration {
  const data = createEmptyData();
  const matches: Array<{ id: string; start: number; end: number }> = [];
  const begin = '\\begin{PaperNote}';
  const end = '\\end{PaperNote}';
  let cursor = 0;

  while (true) {
    const blockStart = legacyTex.indexOf(begin, cursor);
    if (blockStart < 0) {
      break;
    }
    let argumentCursor = blockStart + begin.length;
    const sourceGroup = readNextGroup(legacyTex, argumentCursor);
    argumentCursor = sourceGroup.end;
    const idGroup = readNextGroup(legacyTex, argumentCursor);
    argumentCursor = idGroup.end;
    const titleGroup = readNextGroup(legacyTex, argumentCursor);
    argumentCursor = titleGroup.end;
    const blockEnd = legacyTex.indexOf(end, argumentCursor);
    if (blockEnd < 0) {
      throw new Error(`旧笔记 ${idGroup.value} 缺少 \\end{PaperNote}。`);
    }
    cursor = blockEnd + end.length;
    if (sourceGroup.value.trim() !== 'main') {
      continue;
    }

    const body = legacyTex.slice(argumentCursor, blockEnd);
    const excerptCall = findMacroCall(body, 'SourceExcerpt', 1, 0);
    if (!excerptCall) {
      throw new Error(`旧笔记 ${idGroup.value} 缺少 SourceExcerpt。`);
    }
    const itemCalls = findAllNoteItems(body, excerptCall.end);
    const firstItemStart = itemCalls[0]?.start ?? body.length;
    const lastItemEnd = itemCalls.at(-1)?.end ?? excerptCall.end;
    const prelude = body.slice(excerptCall.end, firstItemStart);
    const postlude = body.slice(lastItemEnd);
    const excerpt = excerptCall.groups[0]?.value.trim() ?? '';
    const selection = findUniqueNormalizedExcerpt(mainSource, excerpt);
    if (!selection) {
      throw new Error(`无法在主文中唯一定位旧笔记 ${idGroup.value} 的原文摘录。`);
    }

    const items: NoteItem[] = itemCalls.map((call) => ({
      id: randomUUID(),
      type: normalizeNoteType(call.groups[0]?.value ?? ''),
      format: 'latex-legacy',
      content: call.groups[1]?.value ?? ''
    }));
    const sectionTitle = nearestLegacySection(legacyTex, blockStart);
    const note: PaperNote = {
      id: idGroup.value.trim(),
      documentId: 'main',
      sourceFile: data.project.rootFile,
      title: titleGroup.value.trim(),
      sectionTitle,
      sourceSnapshot: mainSource.slice(selection.start, selection.end),
      sourceHash: hashText(mainSource.slice(selection.start, selection.end)),
      sourceSelector: buildSourceSelector(mainSource, selection.start, selection.end),
      excerptMode: 'manual',
      excerpt,
      items,
      createdAt: now,
      updatedAt: now
    };
    if (prelude.trim()) {
      note.legacyPrelude = prelude;
    }
    if (postlude.trim()) {
      note.legacyPostlude = postlude;
    }
    data.notes.push(note);
    matches.push({ id: note.id, ...selection });
  }

  return { data, matches };
}

export function upgradeLegacyAnchor(source: string, match: { id: string; start: number; end: number }): string {
  const anchorPattern = new RegExp(`\\\\PaperNoteAnchor\\{${escapeRegExp(match.id)}\\}`);
  const afterSelection = source.slice(match.end);
  const anchorMatch = anchorPattern.exec(afterSelection);
  if (!anchorMatch || anchorMatch.index > 120) {
    throw new Error(`旧锚点 ${match.id} 不在原文摘录之后，未修改主文。`);
  }
  const anchorStart = match.end + anchorMatch.index;
  const anchorEnd = anchorStart + anchorMatch[0].length;
  const before = source.slice(0, match.start);
  const selected = source.slice(match.start, match.end);
  const between = source.slice(match.end, anchorStart).replace(/%?\s*$/, '');
  const after = source.slice(anchorEnd);
  return `${before}\\PaperNoteBegin{${match.id}}${selected}\\PaperNoteEnd{${match.id}}${between}${after}`;
}

export function findUniqueNormalizedExcerpt(source: string, excerpt: string): { start: number; end: number } | undefined {
  const haystack = normalizeWithMap(source);
  const needle = normalizeWithMap(excerpt).text;
  if (!needle) {
    return undefined;
  }
  const first = haystack.text.indexOf(needle);
  if (first < 0 || haystack.text.indexOf(needle, first + 1) >= 0) {
    return undefined;
  }
  const start = haystack.map[first];
  const lastMap = haystack.map[first + needle.length - 1];
  if (start === undefined || lastMap === undefined) {
    return undefined;
  }
  return { start, end: lastMap + 1 };
}

function normalizeWithMap(value: string): { text: string; map: number[] } {
  const output: string[] = [];
  const map: number[] = [];
  let pendingSpace: number | undefined;
  let inComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      continue;
    }
    if (char === '%' && !isEscaped(value, index)) {
      inComment = true;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace ??= index;
      continue;
    }
    if (pendingSpace !== undefined && output.length > 0) {
      output.push(' ');
      map.push(pendingSpace);
    }
    pendingSpace = undefined;
    output.push(char);
    map.push(index);
  }
  return { text: output.join('').trim(), map };
}

function findAllNoteItems(body: string, start: number): MacroCall[] {
  const calls: MacroCall[] = [];
  let cursor = start;
  while (true) {
    const call = findMacroCall(body, 'NoteItem', 2, cursor);
    if (!call) {
      return calls;
    }
    calls.push(call);
    cursor = call.end;
  }
}

interface MacroCall {
  start: number;
  end: number;
  groups: GroupRead[];
}

function findMacroCall(source: string, name: string, groupCount: number, from: number): MacroCall | undefined {
  const marker = `\\${name}`;
  const start = source.indexOf(marker, from);
  if (start < 0) {
    return undefined;
  }
  let cursor = start + marker.length;
  const groups: GroupRead[] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const group = readNextGroup(source, cursor);
    groups.push(group);
    cursor = group.end;
  }
  return { start, end: cursor, groups };
}

function readNextGroup(source: string, from: number): GroupRead {
  let cursor = from;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  if (source[cursor] !== '{') {
    throw new Error(`位置 ${cursor} 应为 LaTeX 花括号参数。`);
  }
  const contentStart = cursor + 1;
  let depth = 1;
  let inComment = false;
  cursor += 1;
  while (cursor < source.length) {
    const char = source[cursor] ?? '';
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      cursor += 1;
      continue;
    }
    if (char === '%' && !isEscaped(source, cursor)) {
      inComment = true;
    } else if (char === '{' && !isEscaped(source, cursor)) {
      depth += 1;
    } else if (char === '}' && !isEscaped(source, cursor)) {
      depth -= 1;
      if (depth === 0) {
        return { value: source.slice(contentStart, cursor), end: cursor + 1 };
      }
    }
    cursor += 1;
  }
  throw new Error(`从位置 ${from} 开始的 LaTeX 参数没有闭合。`);
}

function nearestLegacySection(source: string, position: number): string {
  const prefix = source.slice(0, position);
  const regex = /\\section\*?\s*\{([^{}]+)\}/g;
  let title = 'Main Paper';
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prefix)) !== null) {
    title = match[1]?.trim() || title;
  }
  return title;
}

function normalizeNoteType(value: string): NoteItem['type'] {
  if (value === 'example' || value === 'question' || value === 'todo') {
    return value;
  }
  return 'thought';
}

function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let cursor = position - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
