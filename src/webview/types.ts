import type { CustomNoteType, NoteItem, PaperNote, PaperNotesProject } from '../model.js';
import type { NavigationSnapshot, PdfViewState } from '../navigation.js';
import type { NoteType } from '../note-types.js';

export type PanelTab = 'notes' | 'notesPdf' | 'annotatedPdf';
export type PdfTab = Exclude<PanelTab, 'notes'>;
export type TypeFilter = 'all' | 'todo-only' | NoteType | `custom:${string}`;

export interface PanelNote extends PaperNote {
  markerStatus: 'linked' | 'orphan';
  sourceOrder: number;
}

export interface PdfResource {
  uri: string;
  available: boolean;
}

export interface ProjectStatus {
  extensionVersion: string;
  schemaVersion: number;
  styleVersion?: string;
  expectedStyleVersion: string;
  styleCompatible: boolean;
  styleKind: 'compatible' | 'stock-old' | 'modified-old' | 'missing';
  styleDetail: string;
  buildMode: 'builtin' | 'legacy-script';
}

export interface AppState {
  notes: PanelNote[];
  customTypes: CustomNoteType[];
  currentId?: string;
  markerProblems: string[];
  annotatedPdf: PdfResource;
  notesPdf: PdfResource;
  workerUri: string;
  locale: 'zh-CN' | 'en';
  assetBaseUri: string;
  project?: PaperNotesProject;
  projectStatus?: ProjectStatus;
}

export interface PersistedPanelState {
  activeTab: PanelTab;
  currentId?: string;
  searchText: string;
  typeFilter: TypeFilter;
  mobileDetail: boolean;
  pdf: Record<PdfTab, PdfViewState & { searchQuery: string }>;
  navigation: NavigationSnapshot;
}

export interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export type { CustomNoteType, NoteItem, NoteType };
