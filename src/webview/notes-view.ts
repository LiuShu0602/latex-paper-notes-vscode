import type { CustomNoteType, PanelNote, TypeFilter } from './types.js';

export function noteMatches(
  note: PanelNote,
  filter: TypeFilter,
  queryValue: string,
  customTypes: readonly CustomNoteType[]
): boolean {
  if (!matchesTypeFilter(note, filter)) {
    return false;
  }
  const query = queryValue.trim().toLocaleLowerCase();
  if (!query) {
    return true;
  }
  const customNames = note.items
    .filter((item) => item.type === 'custom')
    .map((item) => customTypes.find((type) => type.id === item.customTypeId)?.name ?? '')
    .join(' ');
  const text = `${note.title} ${note.id} ${note.excerpt} ${customNames} ${note.items.map((item) => item.content).join(' ')}`
    .toLocaleLowerCase();
  return text.includes(query);
}

export function matchesTypeFilter(note: PanelNote, filter: TypeFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'todo-only') {
    return note.items.some((item) => item.type === 'todo');
  }
  if (filter.startsWith('custom:')) {
    const id = filter.slice('custom:'.length);
    return note.items.some((item) => item.type === 'custom' && item.customTypeId === id);
  }
  return note.items.some((item) => item.type === filter);
}

export function countCustomTypeUsage(notes: readonly PanelNote[], id: string): number {
  return notes.reduce(
    (count, note) => count + note.items.filter((item) => item.type === 'custom' && item.customTypeId === id).length,
    0
  );
}
