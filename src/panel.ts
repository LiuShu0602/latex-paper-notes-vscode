import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as vscode from 'vscode';
import type { PaperNote } from './model.js';
import type { PaperNotesStore } from './store.js';
import { scanMarkers } from './markers.js';
import type { BuildRequestOrigin } from './build-policy.js';

export interface PanelActions {
  selectNote(id: string): Promise<void>;
  selectSourcePosition(source: { file: string; line: number; column: number }): Promise<void>;
  reverseSync(page: number, x: number, y: number): Promise<void>;
  saveNote(note: PaperNote): Promise<void>;
  deleteNote(id: string): Promise<void>;
  build(kind: 'quick' | 'full', origin?: BuildRequestOrigin): Promise<void>;
  validate(): Promise<boolean>;
  relink(id?: string): Promise<void>;
  importImage(noteId: string): Promise<string | undefined>;
  openExternal(url: string): Promise<void>;
}

interface IncomingMessage {
  type: string;
  token?: string;
  id?: string;
  note?: PaperNote;
  kind?: 'quick' | 'full';
  tab?: PanelTab;
  url?: string;
  panelState?: unknown;
  source?: { file?: string; line?: number; column?: number };
  page?: number;
  x?: number;
  y?: number;
}

type PanelTab = 'notes' | 'notesPdf' | 'annotatedPdf';

export class NotesPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private currentId: string | undefined;
  private currentTab: PanelTab = 'notes';
  private persistedState: unknown;
  private messageTail: Promise<void> = Promise.resolve();
  private readonly flushWaiters = new Map<string, () => void>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string,
    private readonly store: PaperNotesStore,
    private readonly annotatedPdfRelative: () => string,
    private readonly notesPdfRelative: () => string,
    private readonly workspaceState: vscode.Memento,
    private readonly actions: PanelActions
  ) {
    this.persistedState = workspaceState.get('paperNotes.panelState');
    if (this.persistedState && typeof this.persistedState === 'object') {
      const restored = this.persistedState as { currentId?: unknown; activeTab?: unknown };
      if (typeof restored.currentId === 'string') {
        this.currentId = restored.currentId;
      }
      if (restored.activeTab === 'notes' || restored.activeTab === 'notesPdf' || restored.activeTab === 'annotatedPdf') {
        this.currentTab = restored.activeTab;
      }
    }
  }

  async show(id?: string, tab: PanelTab = 'notes'): Promise<void> {
    if (id) {
      this.currentId = id;
    }
    this.currentTab = tab;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'paperNotes.panel',
        '论文伴随笔记',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: tab !== 'notes' },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.extensionUri, 'dist'),
            vscode.Uri.file(resolve(this.workspaceRoot, this.store.project.notesDir))
          ]
        }
      );
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, null, this.disposables);
      this.panel.webview.onDidReceiveMessage((message: IncomingMessage) => {
        this.messageTail = this.messageTail.then(() => this.handleMessage(message));
      }, null, this.disposables);
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, tab !== 'notes');
    }
    await this.sendState(tab);
  }

  async refresh(tab: PanelTab = this.currentTab): Promise<void> {
    if (this.panel) {
      await this.sendState(tab);
    }
  }

  async revealNote(id: string): Promise<void> {
    this.currentId = id;
    await this.show(id, 'notes');
    await this.post({ type: 'focusNote', id });
  }

  async showPdf(destination?: string): Promise<void> {
    await this.show(this.currentId, 'annotatedPdf');
    await this.post({ type: 'showPdf', tab: 'annotatedPdf', destination });
  }

  async showNotesPdf(destination?: string): Promise<void> {
    await this.show(this.currentId, 'notesPdf');
    await this.post({ type: 'showPdf', tab: 'notesPdf', destination });
  }

  async showPdfPoint(point: { page: number; x: number; y: number; width?: number; height?: number }, id?: string): Promise<void> {
    await this.show(id ?? this.currentId, 'annotatedPdf');
    await this.post({ type: 'showPdfPoint', point, id });
  }

  async sourceLocated(source: { file: string; line: number; column: number }): Promise<void> {
    await this.post({ type: 'sourceLocated', source });
  }

  async notifySaved(id: string): Promise<void> {
    const revision = this.store.data.notes.find((note) => note.id === id)?.revision ?? 0;
    await this.post({ type: 'saved', id, revision, savedAt: new Date().toISOString() });
  }

  async flushPending(timeoutMs = 3000): Promise<void> {
    if (!this.panel) {
      await this.messageTail;
      return;
    }
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const completed = new Promise<void>((resolveDone) => this.flushWaiters.set(token, resolveDone));
    await this.post({ type: 'flushPending', token });
    await Promise.race([
      completed,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timed out while flushing pending note edits.')), timeoutMs))
    ]).finally(() => this.flushWaiters.delete(token));
    await this.messageTail;
  }

  async notifyError(message: string): Promise<void> {
    await this.post({ type: 'error', message });
  }

  async imageImported(noteId: string, markdownPath: string): Promise<void> {
    await this.post({ type: 'imageImported', noteId, markdownPath });
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async sendState(tab: PanelTab = this.currentTab): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.currentTab = tab;
    const sources = await this.store.readSources();
    const markerIds = new Set<string>();
    const markerOrder = new Map<string, number>();
    const markerProblems: string[] = [];
    let order = 0;
    for (const sourceFile of this.store.project.sourceFiles) {
      const source = sources.get(sourceFile);
      if (source === undefined) {
        continue;
      }
      const scan = scanMarkers(source);
      for (const range of scan.ranges) {
        markerIds.add(range.id);
        if (!markerOrder.has(range.id)) {
          markerOrder.set(range.id, order);
        }
        order += 1;
      }
      markerProblems.push(...scan.problems.map((problem) => `${sourceFile}: ${problem.message}`));
    }
    const notes = this.store.data.notes.map((note) => ({
      ...note,
      markerStatus: markerIds.has(note.id) ? 'linked' : 'orphan',
      sourceOrder: markerOrder.get(note.id) ?? Number.MAX_SAFE_INTEGER
    })).sort((left, right) => left.sourceOrder - right.sourceOrder || left.id.localeCompare(right.id));
    if (!this.currentId || !notes.some((note) => note.id === this.currentId)) {
      this.currentId = notes[0]?.id;
    }

    const annotatedPdf = await this.pdfResource(this.annotatedPdfRelative());
    const notesPdf = await this.pdfResource(this.notesPdfRelative());
    const workerUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'pdf.worker.min.mjs')).toString();
    await this.post({
      type: 'state',
      tab,
      currentId: this.currentId,
      notes,
      markerProblems,
      annotatedPdf,
      notesPdf,
      workerUri,
      locale: vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
      project: this.store.project,
      assetBaseUri: `${this.panel.webview.asWebviewUri(vscode.Uri.file(resolve(this.workspaceRoot, this.store.project.notesDir))).toString()}/`,
      restoredState: this.persistedState
    });
  }

  private async pdfResource(relativePath: string): Promise<{ uri: string; available: boolean }> {
    if (!this.panel) {
      return { uri: '', available: false };
    }
    const pdfPath = resolve(this.workspaceRoot, relativePath);
    let version = 0;
    try {
      version = (await stat(pdfPath)).mtimeMs;
    } catch {
      // The Webview shows a build hint when this PDF has not been generated yet.
    }
    const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(pdfPath)).toString();
    return { uri: `${uri}?v=${version}`, available: version > 0 };
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.sendState(this.currentTab);
          break;
        case 'selectTab':
          if (message.tab) {
            this.currentTab = message.tab;
          }
          break;
        case 'setCurrentNote':
          if (message.id) {
            this.currentId = message.id;
          }
          break;
        case 'persistState':
          if (message.panelState && typeof message.panelState === 'object') {
            const serialized = JSON.stringify(message.panelState);
            if (serialized.length <= 200_000) {
              this.persistedState = message.panelState;
              await this.workspaceState.update('paperNotes.panelState', message.panelState);
            }
          }
          break;
        case 'navigateSource':
          if (message.id) {
            this.currentId = message.id;
            await this.actions.selectNote(message.id);
          } else if (message.source
            && typeof message.source.file === 'string'
            && typeof message.source.line === 'number'
            && typeof message.source.column === 'number') {
            await this.actions.selectSourcePosition({
              file: message.source.file,
              line: message.source.line,
              column: message.source.column
            });
          }
          break;
        case 'reverseSync':
          if (typeof message.page === 'number' && typeof message.x === 'number' && typeof message.y === 'number') {
            await this.actions.reverseSync(message.page, message.x, message.y);
          }
          break;
        case 'selectNote':
          if (message.id) {
            this.currentId = message.id;
            await this.actions.selectNote(message.id);
          }
          break;
        case 'saveNote':
          if (message.note) {
            await this.actions.saveNote(message.note);
            await this.notifySaved(message.note.id);
          }
          break;
        case 'flushComplete':
          if (message.token) {
            this.flushWaiters.get(message.token)?.();
          }
          break;
        case 'deleteNote':
          if (message.id) {
            await this.actions.deleteNote(message.id);
          }
          break;
        case 'build':
          if (message.kind) {
            await this.actions.build(message.kind, 'panel');
          }
          break;
        case 'validate':
          await this.actions.validate();
          break;
        case 'relink':
          await this.actions.relink(message.id);
          break;
        case 'locatePdf':
          if (message.id) {
            this.currentId = message.id;
            await this.showPdf(`pnote.main.${message.id}`);
          }
          break;
        case 'locateNotesPdf':
          if (message.id) {
            this.currentId = message.id;
            await this.showNotesPdf(`note.main.${message.id}`);
          }
          break;
        case 'pdfNoteLink':
          if (message.id) {
            this.currentId = message.id;
            await this.showNotesPdf(`note.main.${message.id}`);
          }
          break;
        case 'pdfPaperLink':
          if (message.id) {
            this.currentId = message.id;
            await this.showPdf(`pnote.main.${message.id}`);
          }
          break;
        case 'pdfNoteEditorLink':
          if (message.id) {
            this.currentId = message.id;
            await this.revealNote(message.id);
          }
          break;
        case 'importImage':
          if (message.id) {
            const path = await this.actions.importImage(message.id);
            if (path) {
              await this.imageImported(message.id, path);
            }
          }
          break;
        case 'openExternal':
          if (message.url) {
            await this.actions.openExternal(message.url);
          }
          break;
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await this.notifyError(text);
      void vscode.window.showErrorMessage(text);
    }
  }

  private async post(value: unknown): Promise<void> {
    await this.panel?.webview.postMessage(value);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'));
    return `<!doctype html>
<html lang="${vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource};">
  <link rel="stylesheet" href="${style}">
  <title>LaTeX Paper Notes</title>
</head>
<body>
  <div id="app" aria-live="polite"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}
