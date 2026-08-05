import { hashText, type SourceSelector } from './model.js';

export interface RelinkCandidate {
  start: number;
  end: number;
  kind: 'exact' | 'fuzzy';
  score: number;
  preview: string;
}

interface NormalizedSource {
  text: string;
  map: number[];
}

interface Token {
  value: string;
  start: number;
  end: number;
}

const contextLength = 80;
const markerPattern = /^\\PaperNote(?:Begin|End|Anchor)\s*\{[^{}]*\}/;

export function buildSourceSelector(
  source: string,
  contentStart: number,
  contentEnd: number,
  markerStart = contentStart,
  markerEnd = contentEnd
): SourceSelector {
  const exact = source.slice(contentStart, contentEnd);
  return {
    exact,
    prefix: source.slice(Math.max(0, markerStart - contextLength), markerStart),
    suffix: source.slice(markerEnd, Math.min(source.length, markerEnd + contextLength)),
    normalizedHash: hashText(normalizeSourceText(exact)),
    previousOffset: contentStart
  };
}

export function normalizeSourceText(value: string): string {
  return normalizeWithMap(value).text;
}

export function findRelinkCandidates(source: string, selector: SourceSelector, limit = 3): RelinkCandidate[] {
  const haystack = normalizeWithMap(source);
  const needle = normalizeSourceText(selector.exact);
  if (!needle || haystack.text.length === 0) {
    return [];
  }

  const exactCandidates: RelinkCandidate[] = [];
  let cursor = 0;
  while (cursor <= haystack.text.length - needle.length) {
    const index = haystack.text.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    const mapped = mapNormalizedRange(haystack, index, index + needle.length);
    if (mapped) {
      const context = contextScore(source, mapped.start, mapped.end, selector);
      const distance = distanceScore(mapped.start, selector.previousOffset);
      exactCandidates.push({
        ...mapped,
        kind: 'exact',
        score: 0.9 + context * 0.09 + distance * 0.01,
        preview: makePreview(source, mapped.start, mapped.end)
      });
    }
    cursor = index + Math.max(1, needle.length);
  }
  if (exactCandidates.length > 0) {
    return rankAndDedupe(exactCandidates, limit);
  }

  const targetTokens = tokenize(needle);
  if (targetTokens.length < 3) {
    return [];
  }
  const sourceTokens = tokenize(haystack.text);
  const fuzzyCandidates: RelinkCandidate[] = [];
  const targetValues = targetTokens.map((token) => token.value);
  const windowSize = targetTokens.length;
  for (let index = 0; index + windowSize <= sourceTokens.length; index += 1) {
    const window = sourceTokens.slice(index, index + windowSize);
    const similarity = tokenDice(targetValues, window.map((token) => token.value));
    if (similarity < 0.5) {
      continue;
    }
    const normalizedStart = window[0]?.start;
    const normalizedEnd = window.at(-1)?.end;
    if (normalizedStart === undefined || normalizedEnd === undefined) {
      continue;
    }
    const mapped = mapNormalizedRange(haystack, normalizedStart, normalizedEnd);
    if (!mapped) {
      continue;
    }
    const context = contextScore(source, mapped.start, mapped.end, selector);
    const distance = distanceScore(mapped.start, selector.previousOffset);
    const score = similarity * 0.72 + context * 0.23 + distance * 0.05;
    if (score < 0.55) {
      continue;
    }
    fuzzyCandidates.push({
      ...mapped,
      kind: 'fuzzy',
      score,
      preview: makePreview(source, mapped.start, mapped.end)
    });
  }
  return rankAndDedupe(fuzzyCandidates, limit);
}

function normalizeWithMap(value: string): NormalizedSource {
  const output: string[] = [];
  const map: number[] = [];
  let pendingSpace: number | undefined;
  let inComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
        pendingSpace ??= index;
      }
      continue;
    }
    if (char === '%' && !isEscaped(value, index)) {
      inComment = true;
      continue;
    }
    if (char === '\\') {
      const marker = markerPattern.exec(value.slice(index));
      if (marker) {
        pendingSpace ??= index;
        index += marker[0].length - 1;
        continue;
      }
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

function mapNormalizedRange(source: NormalizedSource, start: number, end: number): { start: number; end: number } | undefined {
  const mappedStart = source.map[start];
  const mappedEnd = source.map[end - 1];
  if (mappedStart === undefined || mappedEnd === undefined) {
    return undefined;
  }
  return { start: mappedStart, end: mappedEnd + 1 };
}

function contextScore(source: string, start: number, end: number, selector: SourceSelector): number {
  const expectedPrefix = normalizeSourceText(selector.prefix).slice(-contextLength);
  const expectedSuffix = normalizeSourceText(selector.suffix).slice(0, contextLength);
  const actualPrefix = normalizeSourceText(source.slice(Math.max(0, start - contextLength * 3), start)).slice(-contextLength);
  const actualSuffix = normalizeSourceText(source.slice(end, Math.min(source.length, end + contextLength * 3))).slice(0, contextLength);
  const prefixScore = expectedPrefix ? commonSuffixRatio(expectedPrefix, actualPrefix) : 0.5;
  const suffixScore = expectedSuffix ? commonPrefixRatio(expectedSuffix, actualSuffix) : 0.5;
  return (prefixScore + suffixScore) / 2;
}

function commonPrefixRatio(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let matched = 0;
  while (matched < length && left[matched] === right[matched]) {
    matched += 1;
  }
  return matched / length;
}

function commonSuffixRatio(left: string, right: string): number {
  return commonPrefixRatio([...left].reverse().join(''), [...right].reverse().join(''));
}

function distanceScore(position: number, previousOffset: number): number {
  return 1 / (1 + Math.abs(position - previousOffset) / 1200);
}

function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+|\\[A-Za-z@]+|[^\s]/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push({ value: match[0].toLocaleLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function tokenDice(left: string[], right: string[]): number {
  const counts = new Map<string, number>();
  for (const token of left) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let intersection = 0;
  for (const token of right) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      intersection += 1;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * intersection) / (left.length + right.length);
}

function rankAndDedupe(candidates: RelinkCandidate[], limit: number): RelinkCandidate[] {
  const ranked = [...candidates].sort((left, right) => right.score - left.score || left.start - right.start);
  const accepted: RelinkCandidate[] = [];
  for (const candidate of ranked) {
    if (accepted.some((current) => Math.abs(current.start - candidate.start) < 12 || rangesOverlap(current, candidate))) {
      continue;
    }
    accepted.push(candidate);
    if (accepted.length >= limit) {
      break;
    }
  }
  return accepted;
}

function rangesOverlap(left: RelinkCandidate, right: RelinkCandidate): boolean {
  return left.start < right.end && right.start < left.end;
}

function makePreview(source: string, start: number, end: number): string {
  const selected = source.slice(start, end).replace(/\s+/g, ' ').trim();
  const clipped = selected.length > 150 ? `${selected.slice(0, 147)}...` : selected;
  return clipped || '(空选区)';
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
