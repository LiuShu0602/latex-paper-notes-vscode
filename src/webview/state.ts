import type { NoteType } from '../note-types.js';
import type { PanelNote, PanelTab, PdfResource, TypeFilter } from './types.js';

export function mergeIncomingNotes(incoming: readonly PanelNote[], dirty: ReadonlyMap<string, PanelNote>): PanelNote[] {
  return incoming.map((note) => {
    const local = dirty.get(note.id);
    return local && (local.revision ?? 0) > (note.revision ?? 0) ? local : note;
  });
}

export function isPanelTab(value: unknown): value is PanelTab {
  return value === 'notes' || value === 'notesPdf' || value === 'annotatedPdf';
}

export function isTypeFilter(value: unknown): value is TypeFilter {
  return value === 'all' || value === 'todo-only'
    || value === 'thought' || value === 'example' || value === 'question' || value === 'todo'
    || value === 'translation' || value === 'custom'
    || (typeof value === 'string' && value.startsWith('custom:') && value.length > 'custom:'.length);
}

export function parsePdfResource(value: unknown): PdfResource {
  if (!value || typeof value !== 'object') {
    return { uri: '', available: false };
  }
  const candidate = value as Record<string, unknown>;
  return { uri: String(candidate.uri ?? ''), available: Boolean(candidate.available) };
}

export function parseSourcePosition(value: unknown): { file: string; line: number; column: number } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as { file?: unknown; line?: unknown; column?: unknown };
  if (typeof source.file !== 'string' || typeof source.line !== 'number' || typeof source.column !== 'number') {
    return undefined;
  }
  return { file: source.file, line: Math.max(0, Math.trunc(source.line)), column: Math.max(0, Math.trunc(source.column)) };
}

export function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function asNoteType(value: string): NoteType | undefined {
  return value === 'thought' || value === 'example' || value === 'question'
    || value === 'todo' || value === 'translation' || value === 'custom'
    ? value : undefined;
}
