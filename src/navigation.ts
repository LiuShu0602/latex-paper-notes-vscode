export type NavigationSurface = 'noteEditor' | 'notesPdf' | 'annotatedPdf' | 'latexSource';

export interface PdfViewState {
  page: number;
  scale: number;
  scrollTop: number;
  scrollLeft: number;
  destination?: string;
}

export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

export interface NavigationRoute {
  surface: NavigationSurface;
  noteId?: string;
  pdf?: PdfViewState;
  source?: SourcePosition;
}

export interface NavigationSnapshot {
  entries: NavigationRoute[];
  index: number;
}

export class NavigationHistory {
  private entries: NavigationRoute[];
  private index: number;

  constructor(snapshot?: NavigationSnapshot, private readonly limit = 100) {
    const restored = sanitizeSnapshot(snapshot, limit);
    this.entries = restored.entries;
    this.index = restored.index;
  }

  get current(): NavigationRoute | undefined {
    return this.entries[this.index];
  }

  get canGoBack(): boolean {
    return this.index > 0;
  }

  get canGoForward(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  push(route: NavigationRoute): NavigationRoute {
    const normalized = sanitizeRoute(route);
    if (sameRoute(this.current, normalized)) {
      this.entries[this.index] = normalized;
      return normalized;
    }
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(normalized);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    this.index = this.entries.length - 1;
    return normalized;
  }

  replace(route: NavigationRoute): NavigationRoute {
    const normalized = sanitizeRoute(route);
    if (this.index < 0) {
      return this.push(normalized);
    }
    this.entries[this.index] = normalized;
    return normalized;
  }

  back(): NavigationRoute | undefined {
    if (!this.canGoBack) {
      return undefined;
    }
    this.index -= 1;
    return this.current;
  }

  forward(): NavigationRoute | undefined {
    if (!this.canGoForward) {
      return undefined;
    }
    this.index += 1;
    return this.current;
  }

  snapshot(): NavigationSnapshot {
    return { entries: structuredClone(this.entries), index: this.index };
  }
}

export function isNavigationRoute(value: unknown): value is NavigationRoute {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const route = value as Partial<NavigationRoute>;
  if (!route.surface || !['noteEditor', 'notesPdf', 'annotatedPdf', 'latexSource'].includes(route.surface)) {
    return false;
  }
  return route.noteId === undefined || typeof route.noteId === 'string';
}

function sanitizeSnapshot(snapshot: NavigationSnapshot | undefined, limit: number): NavigationSnapshot {
  if (!snapshot || !Array.isArray(snapshot.entries)) {
    return { entries: [], index: -1 };
  }
  const entries = snapshot.entries.filter(isNavigationRoute).map(sanitizeRoute).slice(-limit);
  const index = entries.length === 0
    ? -1
    : Math.max(0, Math.min(entries.length - 1, Number.isInteger(snapshot.index) ? snapshot.index : entries.length - 1));
  return { entries, index };
}

function sanitizeRoute(route: NavigationRoute): NavigationRoute {
  const copy = structuredClone(route);
  if (copy.pdf) {
    copy.pdf.page = positive(copy.pdf.page, 1);
    copy.pdf.scale = positive(copy.pdf.scale, 1.15);
    copy.pdf.scrollTop = nonNegative(copy.pdf.scrollTop);
    copy.pdf.scrollLeft = nonNegative(copy.pdf.scrollLeft);
  }
  if (copy.source) {
    copy.source.line = nonNegativeInteger(copy.source.line);
    copy.source.column = nonNegativeInteger(copy.source.column);
  }
  return copy;
}

function sameRoute(left: NavigationRoute | undefined, right: NavigationRoute): boolean {
  if (!left || left.surface !== right.surface || left.noteId !== right.noteId) {
    return false;
  }
  if (left.surface === 'notesPdf' || left.surface === 'annotatedPdf') {
    return left.pdf?.destination === right.pdf?.destination
      && left.pdf?.page === right.pdf?.page;
  }
  if (left.surface === 'latexSource') {
    return left.source?.file === right.source?.file
      && left.source?.line === right.source?.line
      && left.source?.column === right.source?.column;
  }
  return true;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeInteger(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
