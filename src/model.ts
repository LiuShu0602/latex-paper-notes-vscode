import { createHash, randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

export type NoteType = 'thought' | 'example' | 'question' | 'todo';
export type NoteFormat = 'markdown' | 'latex-legacy';
export type ExcerptMode = 'auto' | 'manual';
export type PaperEngine = 'pdflatex' | 'xelatex' | 'lualatex';
export type NotesEngine = 'xelatex' | 'lualatex';
export type BuildMode = 'builtin' | 'legacy-script';

export interface NoteItem {
  id: string;
  type: NoteType;
  format: NoteFormat;
  content: string;
}

export interface SourceSelector {
  exact: string;
  prefix: string;
  suffix: string;
  normalizedHash: string;
  /** UTF-16 offset relative to sourceFile, matching VS Code document offsets. */
  previousOffset: number;
}

export interface PaperNote {
  id: string;
  documentId: 'main';
  sourceFile: string;
  title: string;
  sectionTitle: string;
  sourceSnapshot: string;
  sourceHash: string;
  sourceSelector: SourceSelector;
  excerptMode: ExcerptMode;
  excerpt: string;
  items: NoteItem[];
  legacyPrelude?: string;
  legacyPostlude?: string;
  createdAt: string;
  updatedAt: string;
  /** Monotonic editor revision used to reject late Webview saves. */
  revision?: number;
}

export interface PaperNotesBuild {
  mode: BuildMode;
  quickScript?: string;
  fullScript?: string;
}

export interface PaperNotesProject {
  rootFile: string;
  sourceFiles: string[];
  paperEngine: PaperEngine;
  notesEngine: NotesEngine;
  notesDir: string;
  generatedNotesFile: string;
  annotatedWrapper: string;
  annotatedPdf: string;
  notesPdf: string;
  build: PaperNotesBuild;
}

export interface PaperNotesData {
  schemaVersion: 3;
  project: PaperNotesProject;
  notes: PaperNote[];
}

export interface MigrationOptions {
  legacyRootFile?: string;
  markerOwners?: ReadonlyMap<string, string> | Record<string, string>;
  legacyQuickScript?: string;
  legacyFullScript?: string;
}

export const DEFAULT_PROJECT: PaperNotesProject = {
  rootFile: 'main.tex',
  sourceFiles: ['main.tex'],
  paperEngine: 'pdflatex',
  notesEngine: 'xelatex',
  notesDir: 'notes',
  generatedNotesFile: 'notes/main_notes.tex',
  annotatedWrapper: 'notes/paper_annotated.tex',
  annotatedPdf: 'notes/paper_annotated.pdf',
  notesPdf: 'notes/paper_notes.pdf',
  build: { mode: 'builtin' }
};

const noteTypes = new Set<NoteType>(['thought', 'example', 'question', 'todo']);
const noteFormats = new Set<NoteFormat>(['markdown', 'latex-legacy']);
const paperEngines = new Set<PaperEngine>(['pdflatex', 'xelatex', 'lualatex']);
const notesEngines = new Set<NotesEngine>(['xelatex', 'lualatex']);

export function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createNoteItem(type: NoteType = 'thought', content = ''): NoteItem {
  return { id: randomUUID(), type, format: 'markdown', content };
}

export function createEmptyData(project: Partial<PaperNotesProject> = {}): PaperNotesData {
  const merged: PaperNotesProject = {
    ...DEFAULT_PROJECT,
    ...project,
    build: { ...DEFAULT_PROJECT.build, ...(project.build ?? {}) }
  };
  if (!project.sourceFiles) {
    merged.sourceFiles = [merged.rootFile];
  }
  return { schemaVersion: 3, project: merged, notes: [] };
}

export function noteLabel(id: string): string {
  return `note.main.${id}`;
}

export function paperLabel(id: string): string {
  return `pnote.main.${id}`;
}

/** Convert a project path to the only on-disk representation accepted by schema v3. */
export function normalizeRelativePosixPath(value: string, label = 'path'): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('\0') || posix.isAbsolute(trimmed) || win32.isAbsolute(trimmed)) {
    throw new Error(`${label} must be a relative project path.`);
  }
  const normalized = posix.normalize(trimmed).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} must stay inside the project folder.`);
  }
  return normalized;
}

export function assertValidData(value: unknown): asserts value is PaperNotesData {
  if (!value || typeof value !== 'object') {
    throw new Error('Paper Notes data must be a JSON object.');
  }
  const data = value as Partial<PaperNotesData>;
  if (data.schemaVersion !== 3 || !data.project || !Array.isArray(data.notes)) {
    throw new Error('Unsupported Paper Notes schema or missing project/notes.');
  }
  assertValidProject(data.project);

  const ids = new Set<string>();
  for (const candidate of data.notes) {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('The notes array contains an invalid record.');
    }
    const note = candidate as Partial<PaperNote>;
    if (!note.id || !isValidSemanticId(note.id)) {
      throw new Error(`Invalid note ID: ${String(note.id)}`);
    }
    if (ids.has(note.id)) {
      throw new Error(`Duplicate note ID: ${note.id}`);
    }
    ids.add(note.id);
    if (note.documentId !== 'main' || typeof note.title !== 'string' || !Array.isArray(note.items)) {
      throw new Error(`Note ${note.id} has an invalid document, title, or item list.`);
    }
    normalizeRelativePosixPath(String(note.sourceFile ?? ''), `sourceFile for ${note.id}`);
    if (!isValidSourceSelector(note.sourceSelector)) {
      throw new Error(`Note ${note.id} has an invalid source selector.`);
    }
    if (note.revision !== undefined && (!Number.isInteger(note.revision) || note.revision < 0)) {
      throw new Error(`Note ${note.id} has an invalid revision.`);
    }
    for (const item of note.items) {
      if (!item || typeof item.id !== 'string' || !noteTypes.has(item.type) || !noteFormats.has(item.format)) {
        throw new Error(`Note ${note.id} contains an invalid item.`);
      }
    }
  }
}

export function assertValidProject(project: PaperNotesProject): void {
  const paths: Array<[string, string]> = [
    ['rootFile', project.rootFile],
    ['notesDir', project.notesDir],
    ['generatedNotesFile', project.generatedNotesFile],
    ['annotatedWrapper', project.annotatedWrapper],
    ['annotatedPdf', project.annotatedPdf],
    ['notesPdf', project.notesPdf]
  ];
  for (const [label, value] of paths) {
    normalizeRelativePosixPath(value, label);
  }
  if (!Array.isArray(project.sourceFiles) || project.sourceFiles.length === 0) {
    throw new Error('project.sourceFiles must contain at least the root file.');
  }
  const sources = new Set(project.sourceFiles.map((path) => normalizeRelativePosixPath(path, 'sourceFiles entry')));
  if (!sources.has(normalizeRelativePosixPath(project.rootFile))) {
    throw new Error('project.sourceFiles must include project.rootFile.');
  }
  if (!paperEngines.has(project.paperEngine) || !notesEngines.has(project.notesEngine)) {
    throw new Error('Unsupported LaTeX engine in project settings.');
  }
  if (!project.build || (project.build.mode !== 'builtin' && project.build.mode !== 'legacy-script')) {
    throw new Error('Unsupported project build mode.');
  }
  for (const [label, value] of [['quickScript', project.build.quickScript], ['fullScript', project.build.fullScript]] as const) {
    if (value !== undefined) {
      normalizeRelativePosixPath(value, label);
    }
  }
}

export function migratePaperNotesData(value: unknown, options: MigrationOptions = {}): { data: PaperNotesData; migrated: boolean } {
  if (!value || typeof value !== 'object') {
    throw new Error('Paper Notes data must be a JSON object.');
  }
  const input = structuredClone(value) as Record<string, unknown>;
  if (input.schemaVersion === 3) {
    assertValidData(input);
    return { data: input, migrated: false };
  }
  if ((input.schemaVersion !== 1 && input.schemaVersion !== 2) || !input.project || !Array.isArray(input.notes)) {
    throw new Error('Unsupported Paper Notes schema or missing project/notes.');
  }

  const legacyProject = input.project as Record<string, unknown>;
  const rootFile = normalizeRelativePosixPath(
    stringOr(legacyProject.mainFile, options.legacyRootFile ?? DEFAULT_PROJECT.rootFile),
    'rootFile'
  );
  const sourceFiles = [rootFile];
  const owners = options.markerOwners;
  const ownerFor = (id: string): string | undefined => {
    if (!owners) {
      return undefined;
    }
    if (typeof (owners as ReadonlyMap<string, string>).get === 'function') {
      return (owners as ReadonlyMap<string, string>).get(id);
    }
    return (owners as Record<string, string>)[id];
  };

  const notes = (input.notes as Array<Record<string, unknown>>).map((legacy) => {
    const exact = stringOr(legacy.sourceSnapshot, '');
    const existingSelector = legacy.sourceSelector as Partial<SourceSelector> | undefined;
    const sourceFile = normalizeRelativePosixPath(ownerFor(String(legacy.id)) ?? rootFile, 'sourceFile');
    if (!sourceFiles.includes(sourceFile)) {
      sourceFiles.push(sourceFile);
    }
    return {
      ...legacy,
      documentId: 'main',
      sourceFile,
      sourceSelector: input.schemaVersion === 2 && isValidSourceSelector(existingSelector)
        ? existingSelector
        : {
            exact,
            prefix: '',
            suffix: '',
            normalizedHash: stringOr(legacy.sourceHash, hashText(exact)),
            previousOffset: 0
          },
      revision: typeof legacy.revision === 'number' ? Math.max(0, Math.trunc(legacy.revision)) : 0
    } satisfies Record<string, unknown>;
  }) as unknown as PaperNote[];

  const quickScript = options.legacyQuickScript ?? 'notes/build_main_notes_preview.ps1';
  const fullScript = options.legacyFullScript ?? 'notes/build_notes.ps1';
  const project: PaperNotesProject = {
    rootFile,
    sourceFiles,
    paperEngine: 'pdflatex',
    notesEngine: 'xelatex',
    notesDir: 'notes',
    generatedNotesFile: normalizeRelativePosixPath(stringOr(legacyProject.generatedNotesFile, 'notes/main_notes.tex')),
    annotatedWrapper: inferLegacyWrapper(rootFile),
    annotatedPdf: normalizeRelativePosixPath(stringOr(legacyProject.annotatedPdf, 'notes/main_annotated.pdf')),
    notesPdf: 'notes/paper_notes.pdf',
    build: {
      mode: 'legacy-script',
      quickScript: normalizeRelativePosixPath(quickScript),
      fullScript: normalizeRelativePosixPath(fullScript)
    }
  };
  const migrated: PaperNotesData = { schemaVersion: 3, project, notes };
  assertValidData(migrated);
  return { data: migrated, migrated: true };
}

function inferLegacyWrapper(rootFile: string): string {
  const stem = rootFile.toLowerCase().endsWith('.tex') ? rootFile.slice(0, -4) : rootFile;
  return normalizeRelativePosixPath(`${stem}_annotated.tex`);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function isValidSourceSelector(value: unknown): value is SourceSelector {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const selector = value as Partial<SourceSelector>;
  return typeof selector.exact === 'string'
    && typeof selector.prefix === 'string'
    && typeof selector.suffix === 'string'
    && typeof selector.normalizedHash === 'string'
    && /^[a-f0-9]{64}$/i.test(selector.normalizedHash)
    && typeof selector.previousOffset === 'number'
    && Number.isInteger(selector.previousOffset)
    && selector.previousOffset >= 0;
}

export function isValidSemanticId(id: string): boolean {
  return /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/.test(id);
}
