import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import * as vscode from 'vscode';
import { BuildManager, defaultExecutables, type BuildKind, type BuildResult } from './build.js';
import { prepareBuild, type BuildRequestOrigin } from './build-policy.js';
import { DebouncedAction } from './debounce.js';
import { integrationBlock, planInitialization, applyInitializationPlan, rollbackInitializationPlan, upsertIntegrationBlock } from './initializer.js';
import { containsRawHtml } from './markdown.js';
import {
  createNoteItem,
  hashText,
  isValidSemanticId,
  normalizeRelativePosixPath,
  type NoteFormat,
  type NoteType,
  type PaperEngine,
  type PaperNote
} from './model.js';
import {
  generateSemanticId,
  latexToPlainText,
  nearestSectionTitle,
  scanMarkers,
  validateSelection
} from './markers.js';
import { NotesPanel, type PanelActions } from './panel.js';
import {
  discoverSourceGraph,
  extractTexRootDirective,
  inferPaperEngine,
  looksLikeRootDocument,
  resolveInsideProject
} from './project.js';
import { buildSourceSelector, findRelinkCandidates } from './source-selector.js';
import { defaultStorePaths, PaperNotesStore } from './store.js';
import { SyncTeXService } from './synctex.js';

let application: PaperNotesApplication | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  application = new PaperNotesApplication(context);
  await application.start();
  context.subscriptions.push(application);
}

export async function deactivate(): Promise<void> {
  await application?.disposeAsync();
  application = undefined;
}

class PaperNotesApplication implements vscode.Disposable {
  private readonly controllers = new Map<string, PaperNotesController>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  private welcomePanel: vscode.WebviewPanel | undefined;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async start(): Promise<void> {
    this.registerCommands();
    this.statusBar.command = 'paperNotes.openPanel';
    this.statusBar.show();
    this.disposables.push(
      this.statusBar,
      vscode.window.onDidChangeActiveTextEditor(() => void this.updateContexts()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reloadControllers()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('paperNotes')) {
          void this.reloadControllers();
        }
      })
    );
    await this.reloadControllers();
  }

  dispose(): void {
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.welcomePanel?.dispose();
    for (const controller of this.controllers.values()) {
      await controller.disposeAsync();
    }
    this.controllers.clear();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private registerCommands(): void {
    const command = (id: string, handler: (...args: unknown[]) => Promise<unknown>): vscode.Disposable =>
      vscode.commands.registerCommand(id, (...args: unknown[]) => this.guard(() => handler(...args)));
    this.disposables.push(
      command('paperNotes.initializeProject', () => this.initializeProject()),
      command('paperNotes.projectDoctor', () => this.projectDoctor()),
      command('paperNotes.rescanSources', () => this.requireController().rescanSources(true)),
      command('paperNotes.repairIntegration', () => this.requireController().repairIntegration()),
      command('paperNotes.openPanel', async (id) => {
        const controller = this.controllerForActive();
        if (!controller) {
          this.showWelcome();
          return;
        }
        await controller.openPanel(typeof id === 'string' ? id : undefined);
      }),
      command('paperNotes.addFromSelection', () => this.requireController().addFromSelection()),
      command('paperNotes.quickBuild', () => this.requireController().build('quick')),
      command('paperNotes.fullBuild', () => this.requireController().build('full')),
      command('paperNotes.validate', () => this.requireController().validate(true)),
      command('paperNotes.relink', (id) => this.requireController().relink(typeof id === 'string' ? id : undefined)),
      command('paperNotes.syncFromCursor', () => this.requireController().syncFromCursor())
    );
  }

  private async initializeProject(): Promise<void> {
    this.assertWritableWorkspace();
    const folder = await this.pickWorkspaceFolder();
    if (!folder) {
      return;
    }
    if (this.controllers.has(folder.uri.fsPath.toLowerCase())) {
      void vscode.window.showInformationMessage('This workspace folder is already initialized for LaTeX Paper Notes.');
      return;
    }
    const rootFile = await chooseRootFile(folder);
    if (!rootFile) {
      return;
    }
    const rootSource = await readFile(resolve(folder.uri.fsPath, ...rootFile.split('/')), 'utf8');
    const inferredEngine = inferPaperEngine(rootSource);
    const paperEngine = await vscode.window.showQuickPick<EnginePick>([
      enginePick(inferredEngine, true),
      ...(['pdflatex', 'xelatex', 'lualatex'] as PaperEngine[])
        .filter((engine) => engine !== inferredEngine)
        .map((engine) => enginePick(engine, false))
    ], { title: 'Paper Notes: choose the paper engine', placeHolder: 'The detected engine is listed first.' });
    if (!paperEngine) {
      return;
    }
    const notesEngine = await vscode.window.showQuickPick<NotesEnginePick>([
      { label: 'XeLaTeX (Recommended)', description: 'Best default for Chinese and mixed-language notes.', engine: 'xelatex' },
      { label: 'LuaLaTeX', description: 'Use when your environment is standardized on LuaLaTeX.', engine: 'lualatex' }
    ], { title: 'Paper Notes: choose the notes engine' });
    if (!notesEngine) {
      return;
    }
    const graph = await discoverSourceGraph(folder.uri.fsPath, rootFile);
    const plan = await planInitialization(folder.uri.fsPath, {
      rootFile,
      sourceGraph: graph,
      paperEngine: paperEngine.engine,
      notesEngine: notesEngine.engine
    });
    const changed = plan.changes.filter((change) => change.action !== 'unchanged');
    const detail = [
      `Root: ${rootFile}`,
      `Managed sources: ${graph.sourceFiles.length}`,
      '',
      ...changed.map((change) => `${change.action === 'create' ? 'CREATE' : 'MODIFY'}  ${change.path}`),
      ...(plan.warnings.length ? ['', 'Review warnings:', ...plan.warnings.map((warning) => `• ${warning}`)] : [])
    ].join('\n');
    const confirmation = await vscode.window.showInformationMessage(
      'Initialize LaTeX Paper Notes with the changes shown below?',
      { modal: true, detail },
      'Initialize'
    );
    if (confirmation !== 'Initialize') {
      return;
    }
    const backup = await applyInitializationPlan(folder.uri.fsPath, plan);
    await this.loadFolder(folder);
    if (!this.controllers.has(folder.uri.fsPath.toLowerCase())) {
      await rollbackInitializationPlan(folder.uri.fsPath, plan);
      throw new Error('Initialization validation failed; every proposed file change was rolled back.');
    }
    await this.updateContexts();
    this.welcomePanel?.dispose();
    void vscode.window.showInformationMessage(`Paper Notes initialized. Root backup: ${backup}`);
    await this.controllers.get(folder.uri.fsPath.toLowerCase())?.openPanel();
  }

  private async projectDoctor(): Promise<void> {
    const controller = this.controllerForActive();
    if (controller) {
      await controller.projectDoctor();
      return;
    }
    const folder = await this.pickWorkspaceFolder();
    if (!folder) {
      return;
    }
    const rootFile = await chooseRootFile(folder);
    if (!rootFile) {
      return;
    }
    const source = await readFile(resolve(folder.uri.fsPath, ...rootFile.split('/')), 'utf8');
    const graph = await discoverSourceGraph(folder.uri.fsPath, rootFile);
    const preview = await planInitialization(folder.uri.fsPath, {
      rootFile,
      sourceGraph: graph,
      paperEngine: inferPaperEngine(source),
      notesEngine: 'xelatex'
    });
    const manager = new BuildManager(
      folder.uri.fsPath,
      () => preview.project,
      () => defaultExecutables(vscode.workspace.getConfiguration('paperNotes', folder.uri)),
      async () => undefined
    );
    try {
      const report = await manager.diagnose();
      await showToolchainReport(report.distribution, report.checks);
    } finally {
      manager.dispose();
    }
  }

  private async reloadControllers(): Promise<void> {
    for (const controller of this.controllers.values()) {
      await controller.flush();
      await controller.disposeAsync();
    }
    this.controllers.clear();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      await this.loadFolder(folder);
    }
    await this.updateContexts();
  }

  private async loadFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('paperNotes', folder.uri);
    const dataFile = configuration.get<string>('dataFile', 'notes/paper-notes.json');
    const dataPath = resolve(folder.uri.fsPath, ...normalizeRelativePosixPath(dataFile).split('/'));
    if (!(await fileExists(dataPath))) {
      return;
    }
    const store = new PaperNotesStore(folder.uri.fsPath, defaultStorePaths({
      dataFile,
      legacyRootFile: configuration.get<string>('mainFile') || undefined,
      legacyQuickScript: configuration.get<string>('quickBuildScript') || undefined,
      legacyFullScript: configuration.get<string>('fullBuildScript') || undefined
    }));
    try {
      const initialized = await store.initialize();
      const controller = new PaperNotesController(this.context, folder, store);
      controller.register();
      this.controllers.set(folder.uri.fsPath.toLowerCase(), controller);
      await controller.validate(false);
      if (initialized.migrated) {
        void vscode.window.showInformationMessage(`Migrated ${initialized.notes.notes.length} notes to schema v3 without changing their IDs or content.`);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Cannot load Paper Notes in ${folder.name}: ${errorMessage(error)}`);
      await store.dispose();
    }
  }

  private controllerForActive(): PaperNotesController | undefined {
    const editor = vscode.window.activeTextEditor;
    const folder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri) : undefined;
    if (folder) {
      return this.controllers.get(folder.uri.fsPath.toLowerCase());
    }
    return this.controllers.values().next().value as PaperNotesController | undefined;
  }

  private requireController(): PaperNotesController {
    this.assertWritableWorkspace();
    const controller = this.controllerForActive();
    if (!controller) {
      throw new Error('This folder is not initialized. Run “Initialize LaTeX Paper Notes Project” first.');
    }
    return controller;
  }

  private assertWritableWorkspace(): void {
    if (!vscode.workspace.isTrusted) {
      throw new Error('Paper Notes write and build commands are disabled in an untrusted workspace.');
    }
  }

  private async pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      throw new Error('Open a LaTeX project folder in VS Code first.');
    }
    if (folders.length === 1) {
      return folders[0];
    }
    const picked = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the folder containing one paper project.' });
    return picked;
  }

  private async updateContexts(): Promise<void> {
    const controller = this.controllerForActive();
    const active = vscode.window.activeTextEditor?.document;
    await Promise.all([
      vscode.commands.executeCommand('setContext', 'paperNotes.projectReady', Boolean(controller)),
      vscode.commands.executeCommand('setContext', 'paperNotes.isManagedTex', Boolean(controller && active && controller.isManagedDocument(active)))
    ]);
    this.statusBar.text = controller ? '$(notebook) Paper Notes' : '$(notebook) Initialize Paper Notes';
    this.statusBar.tooltip = controller
      ? 'Open the LaTeX Paper Notes panel'
      : 'Initialize this LaTeX project for Paper Notes';
  }

  private showWelcome(): void {
    if (!this.welcomePanel) {
      this.welcomePanel = vscode.window.createWebviewPanel(
        'paperNotes.welcome',
        'LaTeX Paper Notes',
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );
      this.welcomePanel.webview.html = welcomeHtml(vscode.env.language);
      this.welcomePanel.webview.onDidReceiveMessage((message: { type?: unknown }) => {
        if (message.type === 'initialize') {
          void this.guard(() => this.initializeProject());
        } else if (message.type === 'doctor') {
          void this.guard(() => this.projectDoctor());
        }
      });
      this.welcomePanel.onDidDispose(() => { this.welcomePanel = undefined; });
    } else {
      this.welcomePanel.reveal(vscode.ViewColumn.Beside);
    }
  }

  private async guard<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      void vscode.window.showErrorMessage(errorMessage(error));
      return undefined;
    }
  }
}

class PaperNotesController implements vscode.Disposable, PanelActions {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly markerDiagnostics = vscode.languages.createDiagnosticCollection('paper-notes-markers');
  private readonly codeLens: PaperNoteCodeLensProvider;
  private readonly panel: NotesPanel;
  private readonly buildManager: BuildManager;
  private readonly syncTeX: SyncTeXService;
  private readonly pdfRefresh: DebouncedAction;
  private readonly sourceRefresh: DebouncedAction;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly folder: vscode.WorkspaceFolder,
    private readonly store: PaperNotesStore
  ) {
    this.codeLens = new PaperNoteCodeLensProvider((document) => this.isManagedDocument(document));
    this.panel = new NotesPanel(
      context.extensionUri,
      folder.uri.fsPath,
      store,
      () => store.project.annotatedPdf,
      () => store.project.notesPdf,
      context.workspaceState,
      this
    );
    this.buildManager = new BuildManager(
      folder.uri.fsPath,
      () => store.project,
      () => defaultExecutables(this.configuration()),
      async (kind, result) => this.afterBuild(kind, result)
    );
    this.syncTeX = new SyncTeXService(
      folder.uri.fsPath,
      () => this.configuration().get<string>('synctexExecutable', 'synctex'),
      () => store.project.annotatedPdf
    );
    this.pdfRefresh = new DebouncedAction(350, () => { void this.panel.refresh(); });
    this.sourceRefresh = new DebouncedAction(250, () => { void this.synchronizeAfterSourceChange(); });
  }

  register(): void {
    this.disposables.push(
      this.markerDiagnostics,
      vscode.languages.registerCodeLensProvider({ language: 'latex' }, this.codeLens)
    );
    const texWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.folder, '**/*.tex'));
    const sourceChanged = (uri: vscode.Uri): void => {
      if (this.isManagedPath(uri.fsPath)) {
        this.sourceRefresh.schedule();
      }
    };
    texWatcher.onDidChange(sourceChanged);
    texWatcher.onDidCreate(sourceChanged);
    texWatcher.onDidDelete(sourceChanged);
    this.disposables.push(texWatcher);

    const dataWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.folder, this.store.paths.dataFile)
    );
    const reload = (): void => { void this.reloadData(); };
    dataWatcher.onDidChange(reload);
    dataWatcher.onDidCreate(reload);
    this.disposables.push(dataWatcher);

    const refreshPdf = (): void => this.pdfRefresh.schedule();
    for (const path of [this.store.project.annotatedPdf, this.store.project.notesPdf]) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.folder, path));
      watcher.onDidCreate(refreshPdf);
      watcher.onDidChange(refreshPdf);
      this.disposables.push(watcher);
    }
    this.codeLens.setTitles(this.store.data.notes);
  }

  dispose(): void {
    void this.disposeAsync();
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    try {
      await this.flush();
    } catch {
      // VS Code is shutting down; last-good files remain available.
    }
    this.pdfRefresh.dispose();
    this.sourceRefresh.dispose();
    this.panel.dispose();
    this.buildManager.dispose();
    this.codeLens.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    await this.store.dispose();
  }

  async flush(): Promise<void> {
    await this.panel.flushPending();
    await this.store.flush();
  }

  isManagedDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'latex' && this.isManagedPath(document.uri.fsPath);
  }

  async openPanel(id?: string): Promise<void> {
    await this.panel.show(id, 'notes');
  }

  async selectNote(id: string): Promise<void> {
    await this.revealSource(id);
  }

  async selectSourcePosition(source: { file: string; line: number; column: number }): Promise<void> {
    const target = await resolveInsideProject(this.folder.uri.fsPath, source.file, false);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    const position = new vscode.Position(
      Math.min(Math.max(0, source.line), Math.max(0, document.lineCount - 1)),
      Math.max(0, source.column)
    );
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async reverseSync(page: number, x: number, y: number): Promise<void> {
    const result = await this.syncTeX.reverse(page, x, y);
    const source = {
      file: normalizeRelativePosixPath(relative(this.folder.uri.fsPath, result.input)),
      line: Math.max(0, result.line - 1),
      column: Math.max(0, result.column - 1)
    };
    await this.selectSourcePosition(source);
    await this.panel.sourceLocated(source);
  }

  async syncFromCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isManagedDocument(editor.document)) {
      throw new Error('Put the cursor in a managed LaTeX source file first.');
    }
    if (editor.document.isDirty && !(await editor.document.save())) {
      throw new Error('The LaTeX file could not be saved; SyncTeX was cancelled.');
    }
    const position = editor.selection.active;
    const result = await this.syncTeX.forward(editor.document.uri.fsPath, position.line + 1, position.character + 1);
    await this.panel.showPdfPoint(result);
  }

  async saveNote(note: PaperNote): Promise<void> {
    const existing = this.store.data.notes.find((candidate) => candidate.id === note.id);
    if (!existing) {
      throw new Error(`Note ${note.id} no longer exists. Refresh the panel.`);
    }
    if (!note.title.trim() || !Array.isArray(note.items)) {
      throw new Error('A note needs a title and a valid item list.');
    }
    const allowedTypes = new Set<NoteType>(['thought', 'example', 'question', 'todo']);
    const allowedFormats = new Set<NoteFormat>(['markdown', 'latex-legacy']);
    for (const item of note.items) {
      if (!item.id || !allowedTypes.has(item.type) || !allowedFormats.has(item.format) || typeof item.content !== 'string') {
        throw new Error('The note contains an invalid item.');
      }
      if (item.format === 'markdown' && containsRawHtml(item.content)) {
        void vscode.window.showWarningMessage('Raw HTML is saved as plain text. Use Markdown or LaTeX math instead.');
      }
    }
    const sanitized: PaperNote = {
      ...existing,
      title: note.title.trim(),
      excerptMode: note.excerptMode === 'manual' ? 'manual' : 'auto',
      excerpt: String(note.excerpt ?? ''),
      items: note.items.map((item) => ({ id: item.id, type: item.type, format: item.format, content: item.content })),
      revision: note.revision ?? existing.revision ?? 0
    };
    await this.store.updateNote(sanitized);
    this.refreshCodeLens();
  }

  async deleteNote(id: string): Promise<void> {
    const note = this.store.data.notes.find((candidate) => candidate.id === id);
    if (!note) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      `Delete “${note.title}” and remove its source markers? The selected paper text is preserved.`,
      { modal: true },
      'Delete'
    );
    if (answer !== 'Delete') {
      return;
    }
    const document = await this.openSourceDocument(note.sourceFile);
    const source = document.getText();
    const range = scanMarkers(source).ranges.find((candidate) => candidate.id === id);
    if (range) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, offsetsToRange(document, range.beginStart, range.endEnd), source.slice(range.contentStart, range.contentEnd));
      if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
        throw new Error('VS Code could not remove the marker pair.');
      }
    }
    await this.store.deleteNote(id);
    await this.validate(false);
    this.refreshCodeLens();
    await this.panel.refresh('notes');
  }

  async build(kind: BuildKind, origin: BuildRequestOrigin = 'command'): Promise<void> {
    await prepareBuild(origin, {
      flushPanel: () => this.panel.flushPending(),
      saveWorkspace: async () => { await vscode.workspace.saveAll(false); },
      saveStore: async () => { await this.store.save(); }
    });
    if (!(await this.validate(false))) {
      throw new Error('Paper Notes has structural marker errors. The clean paper remains independently compilable.');
    }
    await this.buildManager.run(kind);
  }

  async validate(showMessage = true): Promise<boolean> {
    const sources = await this.store.readSources();
    const occurrences = new Map<string, Array<{ sourceFile: string; document: vscode.TextDocument; start: number; end: number }>>();
    let markerCount = 0;
    let errorCount = 0;
    this.markerDiagnostics.clear();
    for (const sourceFile of this.store.project.sourceFiles) {
      const document = await this.openSourceDocument(sourceFile);
      const source = sources.get(sourceFile) ?? document.getText();
      const scan = scanMarkers(source);
      markerCount += scan.ranges.length;
      const diagnostics = scan.problems.map((problem) => new vscode.Diagnostic(
        offsetsToRange(document, problem.start, problem.end), problem.message, vscode.DiagnosticSeverity.Error
      ));
      for (const range of scan.ranges) {
        const list = occurrences.get(range.id) ?? [];
        list.push({ sourceFile, document, start: range.beginStart, end: range.endEnd });
        occurrences.set(range.id, list);
      }
      errorCount += diagnostics.length;
      this.markerDiagnostics.set(document.uri, diagnostics);
    }
    const dataIds = new Set(this.store.data.notes.map((note) => note.id));
    for (const [id, locations] of occurrences) {
      if (locations.length > 1) {
        for (const location of locations) {
          const diagnostics = [...(this.markerDiagnostics.get(location.document.uri) ?? [])];
          diagnostics.push(new vscode.Diagnostic(
            offsetsToRange(location.document, location.start, location.end),
            `Note ID ${id} is duplicated across managed source files.`,
            vscode.DiagnosticSeverity.Error
          ));
          this.markerDiagnostics.set(location.document.uri, diagnostics);
          errorCount += 1;
        }
      }
      if (!dataIds.has(id)) {
        const location = locations[0]!;
        const diagnostics = [...(this.markerDiagnostics.get(location.document.uri) ?? [])];
        diagnostics.push(new vscode.Diagnostic(
          offsetsToRange(location.document, location.start, location.end),
          `Source marker ${id} has no structured note.`,
          vscode.DiagnosticSeverity.Error
        ));
        this.markerDiagnostics.set(location.document.uri, diagnostics);
        errorCount += 1;
      }
    }
    const rootDocument = await this.openSourceDocument(this.store.project.rootFile);
    const rootDiagnostics = [...(this.markerDiagnostics.get(rootDocument.uri) ?? [])];
    for (const note of this.store.data.notes) {
      if (!occurrences.has(note.id)) {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          `Note ${note.id} is orphaned. Select a new passage and run Relink Orphan Note.`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.code = note.id;
        rootDiagnostics.push(diagnostic);
      }
    }
    this.markerDiagnostics.set(rootDocument.uri, rootDiagnostics);
    if (showMessage) {
      if (errorCount === 0) {
        void vscode.window.showInformationMessage(`Paper Notes validation passed: ${markerCount} marker pairs in ${sources.size} files.`);
      } else {
        void vscode.window.showErrorMessage(`Paper Notes found ${errorCount} structural errors. See the Problems panel.`);
      }
    }
    await this.panel.refresh();
    return errorCount === 0;
  }

  async relink(requestedId?: string): Promise<void> {
    const sources = await this.store.readSources();
    const linked = new Set<string>();
    for (const source of sources.values()) {
      for (const range of scanMarkers(source).ranges) {
        linked.add(range.id);
      }
    }
    const orphans = this.store.data.notes.filter((note) => !linked.has(note.id));
    if (orphans.length === 0) {
      void vscode.window.showInformationMessage('There are no orphan notes to relink.');
      return;
    }
    let note = requestedId ? orphans.find((candidate) => candidate.id === requestedId) : undefined;
    if (!note) {
      const picked = await vscode.window.showQuickPick(
        orphans.map((candidate) => ({ label: candidate.title, description: candidate.id, note: candidate })),
        { placeHolder: 'Choose an orphan note to relink.' }
      );
      note = picked?.note;
    }
    if (!note) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isManagedDocument(activeEditor.document) && !activeEditor.selection.isEmpty) {
      await this.relinkToEditorSelection(note, activeEditor);
      return;
    }
    type CandidatePick = vscode.QuickPickItem & { sourceFile: string; start: number; end: number };
    const picks: CandidatePick[] = [];
    for (const sourceFile of this.store.project.sourceFiles) {
      const source = sources.get(sourceFile);
      if (source === undefined) {
        continue;
      }
      const document = await this.openSourceDocument(sourceFile);
      for (const candidate of findRelinkCandidates(source, note.sourceSelector, 3)) {
        const validation = validateSelection(source, candidate.start, candidate.end);
        if (!validation.ok || validation.existingId) {
          continue;
        }
        picks.push({
          label: candidate.kind === 'exact' ? '$(check) Exact match' : `$(search) Candidate ${Math.round(candidate.score * 100)}%`,
          description: `${sourceFile}:${document.positionAt(validation.start).line + 1}`,
          detail: candidate.preview,
          sourceFile,
          start: validation.start,
          end: validation.end
        });
      }
    }
    const picked = await vscode.window.showQuickPick(picks.slice(0, 3), {
      placeHolder: `Confirm a new source location for “${note.title}”. Fuzzy matches are never applied silently.`,
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (!picked) {
      const document = await this.openSourceDocument(note.sourceFile);
      const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
      const position = document.positionAt(Math.min(note.sourceSelector.previousOffset, document.getText().length));
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      void vscode.window.showInformationMessage('No candidate was selected. Select the new passage and run Relink again.');
      return;
    }
    const document = await this.openSourceDocument(picked.sourceFile);
    await this.wrapSelection(document, picked.start, picked.end, note.id);
    const next = structuredClone(this.store.data);
    const index = next.notes.findIndex((candidate) => candidate.id === note!.id);
    next.notes[index]!.sourceFile = picked.sourceFile;
    await this.store.save(next);
    await this.validate(false);
    this.refreshCodeLens();
    await this.panel.revealNote(note.id);
  }

  async importImage(_noteId: string): Promise<string | undefined> {
    const chosen = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { Images: ['png', 'jpg', 'jpeg', 'svg', 'pdf'] },
      title: 'Copy an image into the Paper Notes assets folder'
    });
    const source = chosen?.[0]?.fsPath;
    if (!source) {
      return undefined;
    }
    const assetDirectory = await resolveInsideProject(this.folder.uri.fsPath, `${this.store.project.notesDir}/assets`, true);
    await mkdir(assetDirectory, { recursive: true });
    const extension = extname(source).toLowerCase();
    const base = basename(source, extension).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'note-image';
    let target = resolve(assetDirectory, `${base}${extension}`);
    let suffix = 2;
    while (await fileExists(target)) {
      target = resolve(assetDirectory, `${base}-${suffix}${extension}`);
      suffix += 1;
    }
    await copyFile(source, target);
    return normalizeRelativePosixPath(relative(this.folder.uri.fsPath, target));
  }

  async openExternal(url: string): Promise<void> {
    const uri = vscode.Uri.parse(url);
    if (uri.scheme !== 'http' && uri.scheme !== 'https') {
      throw new Error('Only http/https links may be opened from note previews.');
    }
    await vscode.env.openExternal(uri);
  }

  async addFromSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isManagedDocument(editor.document)) {
      throw new Error('Select text in a managed LaTeX source file first.');
    }
    const sourceFile = this.relativeSource(editor.document.uri.fsPath);
    const source = editor.document.getText();
    const start = editor.document.offsetAt(editor.selection.start);
    const end = editor.document.offsetAt(editor.selection.end);
    const validation = validateSelection(source, start, end);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    if (validation.existingId) {
      await this.panel.revealNote(validation.existingId);
      return;
    }
    const selected = source.slice(validation.start, validation.end);
    const title = await vscode.window.showInputBox({
      title: 'Add Paper Note', prompt: 'Enter a short title for this passage.',
      validateInput: (value) => value.trim() ? undefined : 'The title cannot be empty.'
    });
    if (!title) {
      return;
    }
    const suggestedId = generateSemanticId(source, validation.start, selected, this.store.data.notes.map((note) => note.id));
    const id = await vscode.window.showInputBox({
      title: 'Confirm stable semantic ID',
      prompt: 'This ID remains stable when page numbers and titles change.',
      value: suggestedId,
      validateInput: (value) => !isValidSemanticId(value)
        ? 'Use a lowercase section:semantic-words ID.'
        : this.store.data.notes.some((note) => note.id === value) ? 'This ID already exists.' : undefined
    });
    if (!id) {
      return;
    }
    await this.wrapSelection(editor.document, validation.start, validation.end, id);
    const now = new Date().toISOString();
    const plainExcerpt = latexToPlainText(selected);
    const note: PaperNote = {
      id,
      documentId: 'main',
      sourceFile,
      title: title.trim(),
      sectionTitle: nearestSectionTitle(source, validation.start),
      sourceSnapshot: selected,
      sourceHash: hashText(selected),
      sourceSelector: buildSourceSelector(source, validation.start, validation.end),
      excerptMode: 'auto',
      excerpt: plainExcerpt.length > 480 ? `${plainExcerpt.slice(0, 477).trimEnd()}...` : plainExcerpt,
      items: [createNoteItem('thought')],
      createdAt: now,
      updatedAt: now,
      revision: 0
    };
    try {
      await this.store.addNote(note);
    } catch (error) {
      await this.removeMarkerPair(id, sourceFile);
      throw error;
    }
    await this.validate(false);
    this.refreshCodeLens();
    await this.panel.revealNote(id);
  }

  async rescanSources(showMessage: boolean): Promise<void> {
    const graph = await discoverSourceGraph(this.folder.uri.fsPath, this.store.project.rootFile);
    const changed = JSON.stringify(graph.sourceFiles) !== JSON.stringify(this.store.project.sourceFiles);
    if (!changed) {
      if (showMessage) {
        void vscode.window.showInformationMessage(`Managed source graph is current (${graph.sourceFiles.length} files).`);
      }
      return;
    }
    const detail = [
      'Proposed managed files:',
      ...graph.sourceFiles.map((file) => `• ${file}`),
      ...(graph.diagnostics.length ? ['', 'Warnings:', ...graph.diagnostics.map((item) => `• ${item.message}`)] : [])
    ].join('\n');
    const answer = await vscode.window.showInformationMessage(
      'Update the managed LaTeX source list?', { modal: true, detail }, 'Update'
    );
    if (answer !== 'Update') {
      return;
    }
    const project = structuredClone(this.store.project);
    project.sourceFiles = graph.sourceFiles;
    await this.store.updateProject(project);
    this.refreshCodeLens();
    await this.validate(false);
  }

  async repairIntegration(): Promise<void> {
    const document = await this.openSourceDocument(this.store.project.rootFile);
    if (document.isDirty && !(await document.save())) {
      throw new Error('Save the root document before repairing the integration block.');
    }
    const source = document.getText();
    const repaired = upsertIntegrationBlock(source, integrationBlock(this.store.project));
    if (repaired === source) {
      void vscode.window.showInformationMessage('The Paper Notes integration block is already correct.');
      return;
    }
    const backup = `${document.uri.fsPath}.paper-notes.bak`;
    if (!(await fileExists(backup))) {
      await copyFile(document.uri.fsPath, backup);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(source.length)), repaired);
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
      throw new Error('VS Code could not repair the integration block.');
    }
    void vscode.window.showInformationMessage('The optional Paper Notes integration block was repaired.');
  }

  async projectDoctor(): Promise<void> {
    const report = await this.buildManager.diagnose();
    await showToolchainReport(report.distribution, report.checks, this.store.project.sourceFiles);
  }

  private async afterBuild(_kind: BuildKind, result: BuildResult): Promise<void> {
    await this.panel.refresh();
    const current = new Set(this.store.project.sourceFiles);
    const additions = result.flsInputs.filter((file) => !current.has(file) && !file.startsWith(`${this.store.project.notesDir}/`));
    if (additions.length === 0) {
      return;
    }
    const answer = await vscode.window.showInformationMessage(
      `The .fls recorder found ${additions.length} new project-local TeX file(s). Add them to managed sources?`,
      { modal: true, detail: additions.join('\n') },
      'Add files'
    );
    if (answer === 'Add files') {
      const project = structuredClone(this.store.project);
      project.sourceFiles.push(...additions);
      await this.store.updateProject(project);
      this.refreshCodeLens();
    }
  }

  private async synchronizeAfterSourceChange(): Promise<void> {
    try {
      await this.store.save();
      await this.validate(false);
      this.refreshCodeLens();
      await this.panel.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage(`Cannot synchronize Paper Notes source markers: ${errorMessage(error)}`);
    }
  }

  private async reloadData(): Promise<void> {
    try {
      const before = JSON.stringify(this.store.data);
      await this.store.reload();
      if (JSON.stringify(this.store.data) !== before) {
        this.refreshCodeLens();
        await this.panel.refresh();
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Cannot reload paper-notes.json: ${errorMessage(error)}`);
    }
  }

  private async relinkToEditorSelection(note: PaperNote, editor: vscode.TextEditor): Promise<void> {
    const source = editor.document.getText();
    const validation = validateSelection(
      source,
      editor.document.offsetAt(editor.selection.start),
      editor.document.offsetAt(editor.selection.end)
    );
    if (!validation.ok || validation.existingId) {
      throw new Error(validation.error ?? 'The selected passage already belongs to another note.');
    }
    await this.wrapSelection(editor.document, validation.start, validation.end, note.id);
    const next = structuredClone(this.store.data);
    const index = next.notes.findIndex((candidate) => candidate.id === note.id);
    next.notes[index]!.sourceFile = this.relativeSource(editor.document.uri.fsPath);
    await this.store.save(next);
    await this.validate(false);
    this.refreshCodeLens();
    await this.panel.revealNote(note.id);
  }

  private async wrapSelection(document: vscode.TextDocument, start: number, end: number, id: string): Promise<void> {
    const selected = document.getText().slice(start, end);
    const wrapped = `\\PaperNoteBegin{${id}}${selected}\\PaperNoteEnd{${id}}`;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, offsetsToRange(document, start, end), wrapped);
    if (!(await vscode.workspace.applyEdit(edit)) || !(await document.save())) {
      throw new Error('VS Code could not save the Paper Notes marker pair.');
    }
  }

  private async removeMarkerPair(id: string, sourceFile: string): Promise<void> {
    const document = await this.openSourceDocument(sourceFile);
    const source = document.getText();
    const range = scanMarkers(source).ranges.find((candidate) => candidate.id === id);
    if (!range) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, offsetsToRange(document, range.beginStart, range.endEnd), source.slice(range.contentStart, range.contentEnd));
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  private async revealSource(id: string): Promise<void> {
    const note = this.store.data.notes.find((candidate) => candidate.id === id);
    if (!note) {
      throw new Error(`Note ${id} does not exist.`);
    }
    const document = await this.openSourceDocument(note.sourceFile);
    const range = scanMarkers(document.getText()).ranges.find((candidate) => candidate.id === id);
    if (!range) {
      throw new Error(`Source markers for ${id} are missing. Select the new passage and run Relink.`);
    }
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    editor.selection = new vscode.Selection(document.positionAt(range.contentStart), document.positionAt(range.contentEnd));
    editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async openSourceDocument(sourceFile: string): Promise<vscode.TextDocument> {
    const safe = await resolveInsideProject(this.folder.uri.fsPath, sourceFile, false);
    return vscode.workspace.openTextDocument(vscode.Uri.file(safe));
  }

  private isManagedPath(absolutePath: string): boolean {
    try {
      return this.store.project.sourceFiles.includes(this.relativeSource(absolutePath));
    } catch {
      return false;
    }
  }

  private relativeSource(absolutePath: string): string {
    const rel = relative(this.folder.uri.fsPath, absolutePath);
    if (!rel || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
      throw new Error('The source file is outside this Paper Notes project.');
    }
    return normalizeRelativePosixPath(rel);
  }

  private refreshCodeLens(): void {
    this.codeLens.setTitles(this.store.data.notes);
    this.codeLens.refresh();
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('paperNotes', this.folder.uri);
  }
}

class PaperNoteCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private titles = new Map<string, string>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly managed: (document: vscode.TextDocument) => boolean) {}

  setTitles(notes: PaperNote[]): void {
    this.titles = new Map(notes.map((note) => [note.id, note.title]));
  }

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.managed(document)) {
      return [];
    }
    return scanMarkers(document.getText()).ranges.map((marker) => {
      const position = document.positionAt(marker.beginStart);
      return new vscode.CodeLens(new vscode.Range(position, position), {
        title: `$(notebook) ${this.titles.get(marker.id) ?? marker.id}`,
        tooltip: 'Open the corresponding Paper Note',
        command: 'paperNotes.openPanel',
        arguments: [marker.id]
      });
    });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

interface EnginePick extends vscode.QuickPickItem { engine: PaperEngine }
interface NotesEnginePick extends vscode.QuickPickItem { engine: 'xelatex' | 'lualatex' }

function enginePick(engine: PaperEngine, recommended: boolean): EnginePick {
  return {
    label: `${engine}${recommended ? ' (Detected)' : ''}`,
    description: engine === 'pdflatex' ? 'Classic pdfLaTeX workflow' : `${engine} Unicode engine`,
    engine
  };
}

async function chooseRootFile(folder: vscode.WorkspaceFolder): Promise<string | undefined> {
  const candidates = new Map<string, { reason: string; priority: number }>();
  const active = vscode.window.activeTextEditor?.document;
  if (active?.languageId === 'latex' && vscode.workspace.getWorkspaceFolder(active.uri)?.uri.fsPath === folder.uri.fsPath) {
    const activeRelative = normalizeRelativePosixPath(relative(folder.uri.fsPath, active.uri.fsPath));
    const directive = extractTexRootDirective(active.getText());
    if (directive) {
      try {
        const directivePath = normalizeRelativePosixPath(relative(
          folder.uri.fsPath,
          resolve(dirname(active.uri.fsPath), directive)
        ));
        candidates.set(directivePath, { reason: '% !TeX root directive', priority: 100 });
      } catch {
        // An outside root directive is intentionally not offered.
      }
    }
    if (looksLikeRootDocument(active.getText())) {
      candidates.set(activeRelative, { reason: 'active root document', priority: 90 });
    }
  }
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/*.tex'),
    new vscode.RelativePattern(folder, '{**/node_modules/**,**/build/**,notes/**}'),
    200
  );
  for (const uri of files) {
    try {
      const source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      if (looksLikeRootDocument(source)) {
        const path = normalizeRelativePosixPath(relative(folder.uri.fsPath, uri.fsPath));
        if (!candidates.has(path)) {
          candidates.set(path, { reason: '\\documentclass + document environment', priority: 50 });
        }
      }
    } catch {
      // Unreadable candidates are omitted from the confirmation list.
    }
  }
  if (candidates.size === 0) {
    throw new Error('No LaTeX root candidate was found. Open the root .tex file and run Initialize again.');
  }
  const picks = [...candidates]
    .sort((left, right) => right[1].priority - left[1].priority || left[0].localeCompare(right[0]))
    .map(([path, metadata]) => ({ label: path, description: metadata.reason, path }));
  const picked = await vscode.window.showQuickPick(picks, {
    title: 'Paper Notes: confirm the root LaTeX file',
    placeHolder: 'The extension will not modify anything until the final preview is confirmed.'
  });
  return picked?.path;
}

async function showToolchainReport(
  distribution: string,
  checks: Array<{ name: string; ok: boolean; detail: string }>,
  sources: string[] = []
): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: [
      '# LaTeX Paper Notes diagnostics',
      '',
      `Detected distribution: **${distribution}**`,
      '',
      ...checks.map((check) => `- ${check.ok ? '✅' : '❌'} **${check.name}** — ${check.detail}`),
      ...(sources.length ? ['', '## Managed source files', '', ...sources.map((file) => `- \`${file}\``)] : []),
      '',
      'No package was installed and no network request was made.'
    ].join('\n')
  });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}

function offsetsToRange(document: vscode.TextDocument, start: number, end: number): vscode.Range {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function welcomeHtml(language: string): string {
  const zh = language.toLowerCase().startsWith('zh');
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>body{font:14px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:9vh 10%;line-height:1.6}main{max-width:760px;border-top:4px solid #2367b1;padding-top:28px}small{color:#4b91df;letter-spacing:.16em;text-transform:uppercase}h1{font:600 34px Georgia,serif;margin:.3em 0}p{max-width:620px;color:var(--vscode-descriptionForeground)}.actions{display:flex;gap:12px;margin-top:30px}button{padding:10px 18px;border:1px solid var(--vscode-button-border,#2367b1);border-radius:5px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}button.secondary{background:transparent;color:var(--vscode-foreground)}</style></head>
<body><main><small>Marginalia / Setup</small><h1>${zh ? '初始化论文伴随笔记' : 'Initialize LaTeX Paper Notes'}</h1>
<p>${zh ? '选择论文根文件和编译引擎，预览所有文件改动，再无损加入可删除的集成块。扩展不会联网，也不会自动安装 TeX 软件包。' : 'Choose the paper root and engines, review every file change, then add a removable integration block. The extension does not use the network or install TeX packages.'}</p>
<div class="actions"><button id="init">${zh ? '初始化项目' : 'Initialize project'}</button><button id="doctor" class="secondary">${zh ? '工具链诊断' : 'Toolchain diagnostics'}</button></div></main>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.getElementById('init').onclick=()=>vscode.postMessage({type:'initialize'});document.getElementById('doctor').onclick=()=>vscode.postMessage({type:'doctor'});</script></body></html>`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
