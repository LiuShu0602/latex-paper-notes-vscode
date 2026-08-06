import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PdfViewState } from '../navigation.js';
import type { PdfTab } from './types.js';

export interface PdfPoint {
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface PdfSession {
  document?: PDFDocumentProxy;
  viewer?: PDFViewer;
  linkService?: PDFLinkService;
  findController?: PDFFindController;
  eventBus?: EventBus;
  container?: HTMLDivElement;
  loadedUri: string;
  page: number;
  scale: number;
  scrollTop: number;
  scrollLeft: number;
  searchQuery: string;
  destination?: string;
  requestedDestination?: string;
  requestedPoint?: PdfPoint;
  viewToken: number;
}

export function createPdfSessions(): Record<PdfTab, PdfSession> {
  return {
    notesPdf: createSession(),
    annotatedPdf: createSession()
  };
}

export function pdfViewState(session: PdfSession): PdfViewState {
  return {
    page: session.page,
    scale: session.scale,
    scrollTop: session.scrollTop,
    scrollLeft: session.scrollLeft,
    destination: session.destination
  };
}

export function parsePdfPoint(value: unknown): PdfPoint | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const point = value as Partial<PdfPoint>;
  if (!Number.isFinite(point.page) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return undefined;
  }
  return {
    page: Math.max(1, Math.trunc(point.page ?? 1)),
    x: Math.max(0, point.x ?? 0),
    y: Math.max(0, point.y ?? 0),
    width: Number.isFinite(point.width) ? Math.max(0, point.width ?? 0) : undefined,
    height: Number.isFinite(point.height) ? Math.max(0, point.height ?? 0) : undefined
  };
}

function createSession(): PdfSession {
  return { loadedUri: '', page: 1, scale: 1.15, scrollTop: 0, scrollLeft: 0, searchQuery: '', viewToken: 0 };
}
