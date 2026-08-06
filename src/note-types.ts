export type BuiltinNoteType = 'thought' | 'example' | 'question' | 'todo' | 'translation';
export type NoteType = BuiltinNoteType | 'custom';

export interface CustomNoteType {
  /** Stable project-wide identifier. Renaming a type never changes this value. */
  id: string;
  name: string;
  /** Canonical six-digit RGB color, including the leading hash. */
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuiltinNoteTypeDefinition {
  id: BuiltinNoteType;
  order: number;
  label: { 'zh-CN': string; en: string };
  color: string;
  latexColor: string;
  indexKey: string;
}

export const BUILTIN_NOTE_TYPES: readonly BuiltinNoteTypeDefinition[] = [
  { id: 'thought', order: 1, label: { 'zh-CN': '感想', en: 'Thought' }, color: '#3276C3', latexColor: '2563A5', indexKey: '1-thought' },
  { id: 'example', order: 2, label: { 'zh-CN': '例子', en: 'Example' }, color: '#3D8B5B', latexColor: '2E7D32', indexKey: '2-example' },
  { id: 'question', order: 3, label: { 'zh-CN': '疑问', en: 'Question' }, color: '#C77918', latexColor: '9A5700', indexKey: '3-question' },
  { id: 'todo', order: 4, label: { 'zh-CN': '待修改', en: 'To revise' }, color: '#C64B45', latexColor: 'A52D27', indexKey: '4-todo' },
  { id: 'translation', order: 5, label: { 'zh-CN': '翻译', en: 'Translation' }, color: '#7B61B3', latexColor: '60428F', indexKey: '5-translation' }
] as const;

export const BUILTIN_NOTE_TYPE_IDS = new Set<NoteType>(BUILTIN_NOTE_TYPES.map((definition) => definition.id));

export const CUSTOM_COLOR_PALETTE = [
  '#3478C8', '#4B8F68', '#C07A24', '#C9504D', '#7A63B8', '#B04F86', '#397F86', '#6E7781'
] as const;

export function isBuiltinNoteType(value: unknown): value is BuiltinNoteType {
  return typeof value === 'string' && BUILTIN_NOTE_TYPES.some((definition) => definition.id === value);
}

export function isNoteType(value: unknown): value is NoteType {
  return value === 'custom' || isBuiltinNoteType(value);
}

export function builtinNoteType(value: BuiltinNoteType): BuiltinNoteTypeDefinition {
  const definition = BUILTIN_NOTE_TYPES.find((candidate) => candidate.id === value);
  if (!definition) {
    throw new Error(`Unknown built-in note type: ${value}`);
  }
  return definition;
}

export function normalizeCustomTypeName(value: string): string {
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > 32) {
    throw new Error('A custom note type name must contain 1–32 Unicode characters.');
  }
  if (/\p{Cc}|\p{Cf}/u.test(name)) {
    throw new Error('A custom note type name cannot contain control characters.');
  }
  return name;
}

export function customTypeNameKey(value: string): string {
  return normalizeCustomTypeName(value).normalize('NFKC').toLocaleLowerCase();
}

export function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  const expanded = /^#?([0-9a-f]{3})$/i.exec(trimmed);
  if (expanded) {
    const digits = expanded[1]!;
    return `#${digits.split('').map((digit) => `${digit}${digit}`).join('')}`.toUpperCase();
  }
  const exact = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  if (!exact) {
    throw new Error('A custom note type color must be a three- or six-digit hexadecimal RGB color.');
  }
  return `#${exact[1]!.toUpperCase()}`;
}

export function assertValidCustomTypes(types: readonly CustomNoteType[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const type of types) {
    if (!type || typeof type !== 'object' || typeof type.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(type.id)) {
      throw new Error('A custom note type has an invalid ID.');
    }
    if (ids.has(type.id)) {
      throw new Error(`Duplicate custom note type ID: ${type.id}`);
    }
    ids.add(type.id);
    const name = normalizeCustomTypeName(type.name);
    const key = customTypeNameKey(name);
    if (names.has(key)) {
      throw new Error(`Duplicate custom note type name: ${name}`);
    }
    names.add(key);
    if (normalizeHexColor(type.color) !== type.color) {
      throw new Error(`Custom note type ${name} must store its color as uppercase #RRGGBB.`);
    }
    if (!isIsoDate(type.createdAt) || !isIsoDate(type.updatedAt)) {
      throw new Error(`Custom note type ${name} has an invalid timestamp.`);
    }
  }
}

export function ensureUniqueCustomTypeName(
  types: readonly CustomNoteType[],
  nameValue: string,
  exceptId?: string
): string {
  const name = normalizeCustomTypeName(nameValue);
  const key = customTypeNameKey(name);
  const duplicate = types.find((candidate) => candidate.id !== exceptId && customTypeNameKey(candidate.name) === key);
  if (duplicate) {
    throw new Error(`A custom note type named “${name}” already exists.`);
  }
  return name;
}

/**
 * Derive a restrained accent that remains distinguishable against a theme
 * surface. This is used only for dots, thin rules, and status treatments.
 */
export function accessibleAccent(colorValue: string, backgroundValue: string, minimumContrast = 3): string {
  const color = parseHex(normalizeHexColor(colorValue));
  const background = parseHex(normalizeHexColor(backgroundValue));
  if (contrastRatio(color, background) >= minimumContrast) {
    return formatHex(color);
  }
  const target = relativeLuminance(background) > 0.45 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= minimumContrast) {
      return formatHex(candidate);
    }
  }
  return formatHex(target);
}

/** Return a PDF-safe version with WCAG AA contrast on white paper. */
export function pdfReadableColor(colorValue: string): string {
  return accessibleAccent(colorValue, '#FFFFFF', 4.5);
}

export function contrastRatio(firstValue: string | Rgb, secondValue: string | Rgb): number {
  const first = typeof firstValue === 'string' ? parseHex(normalizeHexColor(firstValue)) : firstValue;
  const second = typeof secondValue === 'string' ? parseHex(normalizeHexColor(secondValue)) : secondValue;
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

interface Rgb { r: number; g: number; b: number }

function parseHex(value: string): Rgb {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16)
  };
}

function formatHex(value: Rgb): string {
  return `#${[value.r, value.g, value.b]
    .map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function relativeLuminance(value: Rgb): number {
  const channel = (part: number): number => {
    const normalized = part / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(value.r) + 0.7152 * channel(value.g) + 0.0722 * channel(value.b);
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  return {
    r: first.r + (second.r - first.r) * amount,
    g: first.g + (second.g - first.g) * amount,
    b: first.b + (second.b - first.b) * amount
  };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}
