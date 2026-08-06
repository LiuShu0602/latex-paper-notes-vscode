import {
  BUILTIN_NOTE_TYPES,
  accessibleAccent,
  builtinNoteType,
  normalizeHexColor,
  type BuiltinNoteType,
  type CustomNoteType,
  type NoteType
} from '../note-types.js';

export { BUILTIN_NOTE_TYPES, normalizeHexColor };

export function typeLabel(
  type: NoteType,
  customTypeId: string | undefined,
  customTypes: readonly CustomNoteType[],
  locale: 'zh-CN' | 'en'
): string {
  if (type !== 'custom') {
    return builtinNoteType(type).label[locale];
  }
  return customTypes.find((candidate) => candidate.id === customTypeId)?.name
    ?? (locale === 'zh-CN' ? '未找到的自定义类型' : 'Missing custom type');
}

export function typeColor(
  type: NoteType,
  customTypeId: string | undefined,
  customTypes: readonly CustomNoteType[],
  background: string
): string {
  const color = type === 'custom'
    ? customTypes.find((candidate) => candidate.id === customTypeId)?.color ?? '#6E7781'
    : builtinNoteType(type).color;
  return accessibleAccent(color, background, 3);
}

export function isBuiltinId(value: string): value is BuiltinNoteType {
  return BUILTIN_NOTE_TYPES.some((definition) => definition.id === value);
}
