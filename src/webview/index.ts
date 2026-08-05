import MarkdownIt from 'markdown-it';
import renderMathInElement from 'katex/contrib/auto-render';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import {
  NavigationHistory,
  isNavigationRoute,
  type NavigationRoute,
  type NavigationSnapshot,
  type PdfViewState
} from '../navigation.js';
import { parsePdfLinkTarget } from '../pdf-links.js';
import 'katex/dist/katex.min.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import './style.css';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type NoteType = 'thought' | 'example' | 'question' | 'todo';
type NoteFormat = 'markdown' | 'latex-legacy';
type PanelTab = 'notes' | 'notesPdf' | 'annotatedPdf';
type PdfTab = Exclude<PanelTab, 'notes'>;
const PDF_TO_CSS_UNITS = 96 / 72;

interface NoteItem {
  id: string;
  type: NoteType;
  format: NoteFormat;
  content: string;
}

interface PanelNote {
  id: string;
  documentId: 'main';
  sourceFile: string;
  title: string;
  sectionTitle: string;
  sourceSnapshot: string;
  sourceHash: string;
  sourceSelector: {
    exact: string;
    prefix: string;
    suffix: string;
    normalizedHash: string;
    previousOffset: number;
  };
  excerptMode: 'auto' | 'manual';
  excerpt: string;
  items: NoteItem[];
  legacyPrelude?: string;
  legacyPostlude?: string;
  createdAt: string;
  updatedAt: string;
  revision?: number;
  markerStatus: 'linked' | 'orphan';
  sourceOrder: number;
}

interface AppState {
  notes: PanelNote[];
  currentId?: string;
  markerProblems: string[];
  annotatedPdf: PdfResource;
  notesPdf: PdfResource;
  workerUri: string;
  locale: 'zh-CN' | 'en';
  assetBaseUri: string;
  project?: { rootFile: string; sourceFiles: string[]; notesDir: string };
}

interface PdfResource {
  uri: string;
  available: boolean;
}

interface PdfSession {
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

interface PdfPoint {
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface PersistedPanelState {
  activeTab: PanelTab;
  currentId?: string;
  searchText: string;
  typeFilter: NoteType | 'all' | 'todo-only';
  pdf: Record<PdfTab, PdfViewState & { searchQuery: string }>;
  navigation: NavigationSnapshot;
}

const vscode = acquireVsCodeApi();
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const app = mustElement('app');
let state: AppState = {
  notes: [],
  markerProblems: [],
  annotatedPdf: { uri: '', available: false },
  notesPdf: { uri: '', available: false },
  workerUri: '',
  locale: 'zh-CN',
  assetBaseUri: ''
};
let activeTab: PanelTab = 'notes';
let searchText = '';
let typeFilter: NoteType | 'all' | 'todo-only' = 'all';
const saveTimers = new Map<string, number>();
const dirtyNotes = new Map<string, PanelNote>();
const sentRevisions = new Map<string, number>();
let activeTextarea: HTMLTextAreaElement | undefined;
const pdfSessions: Record<PdfTab, PdfSession> = {
  notesPdf: { loadedUri: '', page: 1, scale: 1.15, scrollTop: 0, scrollLeft: 0, searchQuery: '', viewToken: 0 },
  annotatedPdf: { loadedUri: '', page: 1, scale: 1.15, scrollTop: 0, scrollLeft: 0, searchQuery: '', viewToken: 0 }
};
let navigation = new NavigationHistory();
let restoredStateApplied = false;

const messages = {
  'zh-CN': {
    appTitle: '论文伴随笔记', subtitle: 'LaTeX 源码联动笔记', notes: '笔记', notesPdf: '笔记 PDF', annotatedPdf: '批注论文',
    back: '返回上一位置', forward: '前往下一位置', quickBuild: '快速编译', fullBuild: '完整构建', validate: '验证锚点', ready: '就绪',
    noteCount: '条笔记', search: '搜索标题、摘录和内容…', all: '全部', thought: '感想', example: '例子', question: '疑问', todo: '待修改',
    noMatches: '没有匹配的笔记', linked: '已关联源码', orphan: '源码标记缺失', source: '原文摘录', auto: '自动同步', manual: '手动摘录',
    viewLatex: '查看当前 LaTeX 选区', items: '批注条目', locateSource: '定位源码', relink: '重新关联当前选区', delete: '删除',
    markdown: 'Markdown + 数学', legacy: '旧 LaTeX · 无损模式', placeholder: '写下你的想法。公式可用 $...$ 或 $$...$$。',
    saved: '已保存', editing: '正在编辑…', saving: '正在保存…', imageDescription: '图片说明', previewEmpty: '预览会显示在这里',
    timeUnknown: '时间未知', updated: '更新', itemUnit: '项', sourceStart: '从论文原文开始',
    sourceHelp: '在 LaTeX 中选中一句话、段落或完整公式，然后右键“为选区添加论文笔记”。',
    pdfSearch: '在 PDF 中搜索', previousPage: '上一页', nextPage: '下一页', fitWidth: '适宽', reload: '重新载入', compiledNotes: '编译笔记'
  },
  en: {
    appTitle: 'LaTeX Paper Notes', subtitle: 'Source-linked academic notebook', notes: 'Notes', notesPdf: 'Notes PDF', annotatedPdf: 'Annotated paper',
    back: 'Go back', forward: 'Go forward', quickBuild: 'Quick build', fullBuild: 'Full build', validate: 'Validate markers', ready: 'Ready',
    noteCount: 'notes', search: 'Search titles, excerpts, and content…', all: 'All', thought: 'Thought', example: 'Example', question: 'Question', todo: 'To revise',
    noMatches: 'No matching notes', linked: 'Linked to source', orphan: 'Source markers missing', source: 'Source excerpt', auto: 'Auto-sync', manual: 'Manual excerpt',
    viewLatex: 'View current LaTeX selection', items: 'Annotation items', locateSource: 'Locate source', relink: 'Relink current selection', delete: 'Delete',
    markdown: 'Markdown + math', legacy: 'Legacy LaTeX · lossless', placeholder: 'Write your note. Use $...$ or $$...$$ for math.',
    saved: 'Saved', editing: 'Editing…', saving: 'Saving…', imageDescription: 'Image description', previewEmpty: 'Preview appears here',
    timeUnknown: 'Unknown time', updated: 'Updated', itemUnit: 'items', sourceStart: 'Start from the paper source',
    sourceHelp: 'Select a sentence, paragraph, or complete formula in LaTeX, then choose “Add Paper Note from Selection”.',
    pdfSearch: 'Search PDF', previousPage: 'Previous page', nextPage: 'Next page', fitWidth: 'Fit width', reload: 'Reload', compiledNotes: 'Compiled notes'
  }
} as const;

type MessageKey = keyof typeof messages.en;
function t(key: MessageKey): string {
  return messages[state.locale][key];
}

applyPersistedState(vscode.getState());

window.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
  const message = event.data;
  switch (message.type) {
    case 'state':
      {
      const incomingNotes = (message.notes as PanelNote[]) ?? [];
      const mergedNotes = incomingNotes.map((note) => {
        const local = dirtyNotes.get(note.id);
        return local && (local.revision ?? 0) > (note.revision ?? 0) ? local : note;
      });
      state = {
        notes: mergedNotes,
        currentId: message.currentId as string | undefined,
        markerProblems: (message.markerProblems as string[]) ?? [],
        annotatedPdf: parsePdfResource(message.annotatedPdf),
        notesPdf: parsePdfResource(message.notesPdf),
        workerUri: String(message.workerUri ?? ''),
        locale: message.locale === 'en' ? 'en' : 'zh-CN',
        assetBaseUri: String(message.assetBaseUri ?? ''),
        project: message.project as AppState['project']
      };
      if (!restoredStateApplied) {
        applyPersistedState(message.restoredState);
      }
      if (isPanelTab(message.tab)) {
        activeTab = message.tab;
      }
      if (!navigation.current) {
        navigation.push({ surface: 'noteEditor', noteId: state.currentId });
      }
      render();
      break;
      }
    case 'focusNote':
      navigateToRoute({ surface: 'noteEditor', noteId: String(message.id ?? '') });
      break;
    case 'showPdf':
      navigateToRoute(makePdfRoute(
        message.tab === 'notesPdf' ? 'notesPdf' : 'annotatedPdf',
        typeof message.destination === 'string' ? message.destination : undefined,
        state.currentId
      ), true, true);
      break;
    case 'showPdfPoint': {
      const point = parsePdfPoint(message.point);
      if (point) {
        const session = pdfSessions.annotatedPdf;
        session.destination = undefined;
        session.requestedDestination = undefined;
        session.requestedPoint = point;
        navigateToRoute({
          surface: 'annotatedPdf',
          pdf: { ...pdfViewState(session), page: point.page },
          noteId: typeof message.id === 'string' ? message.id : state.currentId
        });
      }
      break;
    }
    case 'sourceLocated': {
      const source = parseSourcePosition(message.source);
      if (source) {
        const route: NavigationRoute = { surface: 'latexSource', source, noteId: state.currentId };
        if (navigation.current?.surface === 'latexSource' && navigation.current.noteId === state.currentId) {
          navigation.replace(route);
        } else {
          navigation.push(route);
        }
        persistPanelState();
        render();
      }
      break;
    }
    case 'saved':
      {
      const id = String(message.id ?? '');
      const revision = Number(message.revision ?? 0);
      const local = dirtyNotes.get(id);
      if (!local || revision >= (local.revision ?? 0)) {
        dirtyNotes.delete(id);
        sentRevisions.delete(id);
      }
      showSaveState(t('saved'), 'ok');
      break;
      }
    case 'error':
      toast(String(message.message ?? '未知错误'), true);
      showSaveState('保存失败', 'error');
      break;
    case 'imageImported':
      insertAtActiveTextarea(`![${t('imageDescription')}](${String(message.markdownPath ?? '')})`);
      break;
    case 'flushPending':
      flushPendingSaves();
      vscode.postMessage({ type: 'flushComplete', token: message.token });
      break;
    default:
      break;
  }
});

vscode.postMessage({ type: 'ready' });
renderLoading();
window.addEventListener('beforeunload', flushPendingSaves);

function render(): void {
  detachPdfViews();
  app.replaceChildren();
  app.append(buildHeader());
  const main = element('main', 'workspace');
  if (activeTab === 'notes') {
    main.append(buildNotesWorkspace());
  } else {
    main.append(buildPdfWorkspace());
  }
  app.append(main, buildToastRegion());
}

function buildHeader(): HTMLElement {
  const header = element('header', 'masthead');
  const brand = element('div', 'brand');
  brand.innerHTML = `<span class="folio">MARGINALIA / 01</span><strong>${t('appTitle')}</strong><small>${t('subtitle')}</small>`;

  const tabs = element('nav', 'tabs');
  tabs.setAttribute('aria-label', t('appTitle'));
  tabs.append(
    tabButton('notes', t('notes'), '$(notebook)'),
    tabButton('notesPdf', t('notesPdf'), '$(book)'),
    tabButton('annotatedPdf', t('annotatedPdf'), '$(file-pdf)')
  );

  const actions = element('div', 'masthead-actions');
  const back = iconButton('←', t('back'), () => navigateHistory('back'));
  back.disabled = !navigation.canGoBack;
  const forward = iconButton('→', t('forward'), () => navigateHistory('forward'));
  forward.disabled = !navigation.canGoForward;
  actions.append(
    back,
    forward,
    actionButton(t('quickBuild'), 'primary', () => postBuild('quick')),
    actionButton(t('fullBuild'), 'quiet', () => postBuild('full')),
    iconButton('✓', t('validate'), () => vscode.postMessage({ type: 'validate' }))
  );
  const save = element('span', 'save-state');
  save.id = 'save-state';
  save.textContent = t('ready');
  actions.append(save);
  header.append(brand, tabs, actions);
  return header;
}

function buildNotesWorkspace(): HTMLElement {
  const wrapper = element('section', 'notes-layout');
  wrapper.append(buildNoteRail(), buildNoteDetail());
  return wrapper;
}

function buildNoteRail(): HTMLElement {
  const rail = element('aside', 'note-rail');
  const top = element('div', 'rail-top');
  const count = element('span', 'count');
  count.textContent = `${state.notes.length} ${t('noteCount')}`;
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('search');
  search.value = searchText;
  search.setAttribute('aria-label', t('search'));
  search.addEventListener('input', () => {
    searchText = search.value;
    renderNoteList(list);
    schedulePersistState();
  });
  top.append(count, search);

  const filters = element('div', 'filters');
  const filterDefinitions: Array<[typeof typeFilter, string]> = [
    ['all', t('all')],
    ['thought', t('thought')],
    ['example', t('example')],
    ['question', t('question')],
    ['todo-only', t('todo')]
  ];
  for (const [value, label] of filterDefinitions) {
    const button = actionButton(label, value === typeFilter ? 'filter active' : 'filter', () => {
      typeFilter = value;
      persistPanelState();
      render();
    });
    filters.append(button);
  }

  const list = element('div', 'note-list');
  list.setAttribute('role', 'listbox');
  renderNoteList(list);
  rail.append(top, filters);
  if (state.markerProblems.length > 0) {
    const warning = element('button', 'validation-banner');
    warning.textContent = `⚠ ${state.markerProblems.length} 个锚点问题`;
    warning.addEventListener('click', () => vscode.postMessage({ type: 'validate' }));
    rail.append(warning);
  }
  rail.append(list);
  return rail;
}

function renderNoteList(list: HTMLElement): void {
  list.replaceChildren();
  const query = searchText.trim().toLowerCase();
  const notes = state.notes.filter((note) => {
    const typeMatches = typeFilter === 'all'
      || (typeFilter === 'todo-only' ? note.items.some((item) => item.type === 'todo') : note.items.some((item) => item.type === typeFilter));
    const text = `${note.title} ${note.id} ${note.excerpt} ${note.items.map((item) => item.content).join(' ')}`.toLowerCase();
    return typeMatches && (!query || text.includes(query));
  });
  if (notes.length === 0) {
    const empty = element('div', 'empty-list');
    empty.innerHTML = `<span>∅</span><p>${t('noMatches')}</p>`;
    list.append(empty);
    return;
  }
  notes.forEach((note, index) => {
    const button = element('button', `note-row${note.id === state.currentId ? ' selected' : ''}`);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(note.id === state.currentId));
    const number = element('span', 'note-number');
    number.textContent = String(index + 1).padStart(2, '0');
    const text = element('span', 'note-row-text');
    const title = element('strong');
    title.textContent = note.title;
    const meta = element('small');
    meta.textContent = `${note.sectionTitle} · ${note.sourceFile} · ${note.items.length} ${t('itemUnit')} · ${shortDate(note.updatedAt)}`;
    text.append(title, meta);
    const status = element('span', `link-status ${note.markerStatus}`);
    status.title = note.markerStatus === 'linked' ? t('linked') : t('orphan');
    status.textContent = note.markerStatus === 'linked' ? '●' : '!';
    button.append(number, text, status);
    button.addEventListener('click', () => {
      flushPendingSaves();
      state.currentId = note.id;
      openSourceForNote(note.id);
    });
    list.append(button);
  });
}

function buildNoteDetail(): HTMLElement {
  const detail = element('article', 'note-detail');
  const note = currentNote();
  if (!note) {
    const empty = element('div', 'empty-detail');
    empty.innerHTML = `<div class="empty-glyph">¶</div><h2>${t('sourceStart')}</h2><p>${t('sourceHelp')}</p><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>N</kbd>`;
    detail.append(empty);
    return detail;
  }

  const heading = element('div', 'detail-heading');
  const eyebrow = element('span', 'eyebrow');
  eyebrow.textContent = `${note.sectionTitle} / ${note.sourceFile} / ${note.id} / ${t('updated')} ${longDate(note.updatedAt)}`;
  const title = document.createElement('input');
  title.className = 'title-input';
  title.value = note.title;
  title.setAttribute('aria-label', '笔记标题');
  title.addEventListener('input', () => {
    note.title = title.value;
    scheduleSave(note);
  });
  const detailActions = element('div', 'detail-actions');
  if (note.markerStatus === 'orphan') {
    detailActions.append(actionButton(t('relink'), 'primary', () => vscode.postMessage({ type: 'relink', id: note.id })));
  } else {
    detailActions.append(
      actionButton(t('locateSource'), 'quiet', () => openSourceForNote(note.id)),
      actionButton(t('notesPdf'), 'quiet', () => navigateToRoute(makePdfRoute('notesPdf', `note.main.${note.id}`, note.id), true, true)),
      actionButton(t('annotatedPdf'), 'quiet', () => navigateToRoute(makePdfRoute('annotatedPdf', `pnote.main.${note.id}`, note.id), true, true))
    );
  }
  detailActions.append(actionButton(t('delete'), 'danger', () => vscode.postMessage({ type: 'deleteNote', id: note.id })));
  heading.append(eyebrow, title, detailActions);

  const source = element('section', 'source-card');
  const sourceHeader = element('div', 'source-header');
  const sourceTitle = element('strong');
  sourceTitle.textContent = t('source');
  const mode = document.createElement('button');
  mode.className = 'mode-toggle';
  mode.textContent = note.excerptMode === 'auto' ? t('auto') : t('manual');
  mode.addEventListener('click', () => {
    note.excerptMode = note.excerptMode === 'auto' ? 'manual' : 'auto';
    render();
    scheduleSave(note);
  });
  sourceHeader.append(sourceTitle, mode);
  const excerpt = document.createElement('textarea');
  excerpt.value = note.excerpt;
  excerpt.readOnly = note.excerptMode === 'auto';
  excerpt.rows = 3;
  excerpt.setAttribute('aria-label', '原文摘录');
  excerpt.addEventListener('input', () => {
    note.excerpt = excerpt.value;
    scheduleSave(note);
  });
  const sourceCode = element('details', 'source-code');
  const summary = document.createElement('summary');
  summary.textContent = t('viewLatex');
  const pre = document.createElement('pre');
  pre.textContent = note.sourceSnapshot;
  sourceCode.append(summary, pre);
  source.append(sourceHeader, excerpt, sourceCode);

  const itemsHeader = element('div', 'items-header');
  const itemsTitle = document.createElement('h2');
  itemsTitle.textContent = t('items');
  const addMenu = element('div', 'add-menu');
  for (const type of ['thought', 'example', 'question', 'todo'] as NoteType[]) {
    addMenu.append(actionButton(`＋${typeLabel(type)}`, `add ${type}`, () => {
      note.items.push({ id: crypto.randomUUID(), type, format: 'markdown', content: '' });
      render();
      scheduleSave(note);
    }));
  }
  itemsHeader.append(itemsTitle, addMenu);

  const items = element('div', 'items');
  note.items.forEach((item, index) => items.append(buildItemEditor(note, item, index)));
  detail.append(heading, source, itemsHeader, items);
  return detail;
}

function buildItemEditor(note: PanelNote, item: NoteItem, index: number): HTMLElement {
  const card = element('section', `item-card type-${item.type}`);
  const header = element('div', 'item-header');
  const ordinal = element('span', 'item-ordinal');
  ordinal.textContent = String(index + 1).padStart(2, '0');
  const type = document.createElement('select');
  type.setAttribute('aria-label', '条目类型');
  for (const value of ['thought', 'example', 'question', 'todo'] as NoteType[]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = typeLabel(value);
    option.selected = value === item.type;
    type.append(option);
  }
  type.addEventListener('change', () => {
    item.type = type.value as NoteType;
    card.className = `item-card type-${item.type}`;
    scheduleSave(note);
  });
  const format = element('span', 'format-badge');
  format.textContent = item.format === 'latex-legacy' ? t('legacy') : t('markdown');
  const remove = iconButton('×', '删除此条目', () => {
    note.items.splice(index, 1);
    render();
    scheduleSave(note);
  });
  header.append(ordinal, type, format, remove);

  const toolbar = element('div', `format-toolbar${item.format === 'latex-legacy' ? ' hidden' : ''}`);
  const textarea = document.createElement('textarea');
  textarea.className = item.format === 'latex-legacy' ? 'note-editor legacy' : 'note-editor';
  textarea.value = item.content;
  textarea.rows = Math.max(7, Math.min(22, item.content.split('\n').length + 3));
  textarea.placeholder = t('placeholder');
  textarea.setAttribute('aria-label', `${typeLabel(item.type)}内容`);
  textarea.addEventListener('focus', () => {
    activeTextarea = textarea;
  });
  textarea.addEventListener('input', () => {
    item.content = textarea.value;
    if (item.format === 'markdown') {
      renderMarkdownPreview(preview, item.content);
    }
    scheduleSave(note);
  });

  const tools: Array<[string, string, () => void]> = [
    ['B', '粗体', () => wrapSelection(textarea, '**', '**', '重点')],
    ['∑', '行内公式', () => wrapSelection(textarea, '$', '$', 'x')],
    ['≡', '列表', () => insertText(textarea, '- 条目一\n- 条目二')],
    ['❝', '引文', () => insertText(textarea, '> 引文')],
    ['▦', '表格', () => insertText(textarea, '| 项目 | 说明 |\n|---|---|\n| A | 内容 |')],
    ['▧', '图片', () => {
      activeTextarea = textarea;
      vscode.postMessage({ type: 'importImage', id: note.id });
    }]
  ];
  for (const [label, title, action] of tools) {
    toolbar.append(iconButton(label, title, action));
  }

  const preview = element('div', 'markdown-preview');
  if (item.format === 'markdown') {
    renderMarkdownPreview(preview, item.content);
  } else {
    preview.innerHTML = '<p class="legacy-hint">该条目来自旧笔记，保存时原样写回 LaTeX。可直接编辑，但不会作为 Markdown 渲染。</p>';
  }
  card.append(header, toolbar, textarea, preview);
  return card;
}

function buildPdfWorkspace(): HTMLElement {
  const tab = currentPdfTab();
  if (!tab) {
    return element('section', 'pdf-workspace');
  }
  const session = pdfSessions[tab];
  const resource = pdfResource(tab);
  const wrapper = element('section', 'pdf-workspace');
  const toolbar = element('div', 'pdf-toolbar');
  const search = document.createElement('input');
  search.id = 'pdf-search-input';
  search.className = 'pdf-search-input';
  search.type = 'search';
  search.placeholder = t('pdfSearch');
  search.value = session.searchQuery;
  search.setAttribute('aria-label', t('pdfSearch'));
  search.addEventListener('input', () => {
    session.searchQuery = search.value;
    dispatchPdfSearch(tab, '');
    persistPanelState();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dispatchPdfSearch(tab, 'again', event.shiftKey);
    }
  });
  const searchCount = elementWithText('span', 'pdf-search-count', '');
  searchCount.id = 'pdf-search-count';
  toolbar.append(
    elementWithText('span', 'pdf-kind', tab === 'notesPdf' ? t('compiledNotes') : t('annotatedPdf')),
    iconButton('‹', t('previousPage'), () => changePdfPage(tab, -1)),
    pageControl(tab),
    iconButton('›', t('nextPage'), () => changePdfPage(tab, 1)),
    actionButton('－', 'quiet', () => changePdfScale(tab, -0.15)),
    elementWithText('span', 'zoom-label', `${Math.round(session.scale * 100)}%`),
    actionButton('＋', 'quiet', () => changePdfScale(tab, 0.15)),
    actionButton(t('fitWidth'), 'quiet compact', () => fitPdfWidth(tab)),
    search,
    iconButton('↑', '上一个搜索结果', () => dispatchPdfSearch(tab, 'again', true)),
    iconButton('↓', '下一个搜索结果', () => dispatchPdfSearch(tab, 'again', false)),
    searchCount,
    actionButton(t('reload'), 'quiet', () => {
      const previous = session.document;
      session.document = undefined;
      session.loadedUri = '';
      void previous?.destroy();
      render();
    })
  );
  const stageShell = element('div', 'pdf-stage-shell');
  const stage = element('div', 'pdf-stage pdfViewerContainer');
  stage.id = 'pdf-stage';
  stage.tabIndex = 0;
  if (!resource.available) {
    stage.innerHTML = tab === 'notesPdf'
      ? '<div class="pdf-empty"><div>PDF</div><h2>尚未生成编译笔记</h2><p>点击“快速编译”，扩展会编译 <code>paper_notes.tex</code> 并在这里显示。</p></div>'
      : '<div class="pdf-empty"><div>PDF</div><h2>尚未生成批注论文</h2><p>点击“快速编译”，扩展会生成主文批注版并在这里显示。</p></div>';
  } else {
    const viewer = element('div', 'pdfViewer');
    viewer.id = 'pdf-viewer';
    stage.append(viewer);
    queueMicrotask(() => void attachPdfViewer(tab, stage, viewer));
  }
  stageShell.append(stage);
  wrapper.append(toolbar, stageShell);
  return wrapper;
}

async function attachPdfViewer(tab: PdfTab, container: HTMLDivElement, viewerElement: HTMLDivElement): Promise<void> {
  const resource = pdfResource(tab);
  const session = pdfSessions[tab];
  if (!resource.available || !resource.uri || !state.workerUri) {
    return;
  }
  const token = ++session.viewToken;
  try {
    GlobalWorkerOptions.workerSrc = state.workerUri;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, ignoreDestinationZoom: true });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1,
      annotationMode: 2,
      removePageBorders: false
    });
    linkService.setViewer(viewer);
    session.viewer = viewer;
    session.linkService = linkService;
    session.findController = findController;
    session.eventBus = eventBus;
    session.container = container;
    installPdfInteractionHandlers(tab, container);
    installPdfEvents(tab, token);

    if (!session.document || session.loadedUri !== resource.uri) {
      const previous = session.document;
      const loaded = await getDocument({ url: resource.uri }).promise;
      if (token !== session.viewToken || activeTab !== tab) {
        await loaded.destroy();
        return;
      }
      session.document = loaded;
      session.loadedUri = resource.uri;
      session.page = Math.min(session.page, loaded.numPages);
      void previous?.destroy();
    }
    linkService.setDocument(session.document, null);
    findController.setDocument(session.document);
    viewer.setDocument(session.document);
  } catch (error) {
    const stage = document.getElementById('pdf-stage');
    if (stage && activeTab === tab && token === session.viewToken) {
      stage.innerHTML = `<div class="pdf-empty"><div>!</div><h2>PDF 加载失败</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`;
    }
  }
}

function installPdfEvents(tab: PdfTab, token: number): void {
  const session = pdfSessions[tab];
  const eventBus = session.eventBus;
  if (!eventBus) {
    return;
  }
  eventBus.on('pagesinit', async () => {
    if (token !== session.viewToken || !session.viewer || !session.linkService || activeTab !== tab) {
      return;
    }
    session.viewer.currentScale = session.scale;
    if (session.requestedDestination) {
      const destination = session.requestedDestination;
      session.requestedDestination = undefined;
      await session.linkService.goToDestination(destination);
    } else if (session.requestedPoint) {
      const point = session.requestedPoint;
      session.requestedPoint = undefined;
      scrollToSyncTexPoint(tab, point);
      showSyncTexIndicator(tab, point);
    } else {
      session.viewer.currentPageNumber = Math.max(1, Math.min(session.page, session.viewer.pagesCount));
      requestAnimationFrame(() => {
        if (session.container) {
          session.container.scrollTop = session.scrollTop;
          session.container.scrollLeft = session.scrollLeft;
        }
      });
    }
    if (session.searchQuery) {
      dispatchPdfSearch(tab, '');
    }
    updatePdfToolbar(tab);
  });
  eventBus.on('pagechanging', (event: { pageNumber?: number }) => {
    if (token !== session.viewToken || !event.pageNumber) {
      return;
    }
    session.page = event.pageNumber;
    updatePdfToolbar(tab);
    updateCurrentPdfRoute(tab);
    schedulePersistState();
  });
  eventBus.on('scalechanging', (event: { scale?: number }) => {
    if (token !== session.viewToken || !event.scale) {
      return;
    }
    session.scale = event.scale;
    updatePdfToolbar(tab);
    updateCurrentPdfRoute(tab);
    schedulePersistState();
  });
  eventBus.on('updateviewarea', (event: { location?: { pageNumber?: number } }) => {
    if (token !== session.viewToken) {
      return;
    }
    session.page = event.location?.pageNumber ?? session.page;
    if (session.container) {
      session.scrollTop = session.container.scrollTop;
      session.scrollLeft = session.container.scrollLeft;
    }
    schedulePersistState(tab);
  });
  eventBus.on('updatefindmatchescount', (event: { matchesCount?: { current?: number; total?: number } }) => {
    const target = document.getElementById('pdf-search-count');
    if (target && activeTab === tab) {
      const current = event.matchesCount?.current ?? 0;
      const total = event.matchesCount?.total ?? 0;
      target.textContent = total > 0 ? `${current}/${total}` : '';
    }
  });
  eventBus.on('annotationlayerrendered', (event: { pageNumber?: number }) => {
    if (token === session.viewToken && event.pageNumber) {
      void installSemanticAnnotationLinks(tab, event.pageNumber, token);
    }
  });
}

async function installSemanticAnnotationLinks(tab: PdfTab, pageNumber: number, token: number): Promise<void> {
  const session = pdfSessions[tab];
  const pdfDocument = session.document;
  if (!pdfDocument || !session.viewer || !session.container) {
    return;
  }
  const pdfPage = await pdfDocument.getPage(pageNumber);
  const annotations = await pdfPage.getAnnotations({ intent: 'display' });
  if (token !== session.viewToken || activeTab !== tab) {
    return;
  }
  const pageElement = session.container.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
  const annotationLayer = pageElement?.querySelector<HTMLElement>('.annotationLayer');
  if (!annotationLayer) {
    return;
  }
  // PDF.js still creates a linkAnnotation section for unsafe cross-file links,
  // but intentionally leaves that section without an anchor. Reuse that
  // section whenever possible: a second, overlapping section can sit below the
  // native one and never receive a real pointer click.
  annotationLayer.querySelectorAll('.paper-notes-semantic-overlay').forEach((element) => element.remove());
  const viewport = pdfPage.getViewport({
    scale: (session.viewer.currentScale || session.scale) * PDF_TO_CSS_UNITS,
    rotation: pdfPage.rotate
  });
  for (const annotation of annotations) {
    const record = annotation as unknown as Record<string, unknown>;
    const target = parsePdfLinkTarget(record);
    const rectangle = Array.isArray(record.rect) ? record.rect : undefined;
    if (!target || rectangle?.length !== 4 || !rectangle.every((value) => typeof value === 'number')) {
      continue;
    }
    const annotationId = typeof record.id === 'string' ? record.id : undefined;
    let linkSection = annotationId
      ? Array.from(annotationLayer.querySelectorAll<HTMLElement>('section[data-annotation-id]'))
          .find((element) => element.dataset.annotationId === annotationId)
      : undefined;

    if (!linkSection) {
      const converted = viewport.convertToViewportRectangle(rectangle as number[]);
      linkSection = document.createElement('section');
      linkSection.className = 'linkAnnotation paper-notes-semantic-link paper-notes-semantic-overlay';
      linkSection.style.left = `${Math.min(converted[0], converted[2])}px`;
      linkSection.style.top = `${Math.min(converted[1], converted[3])}px`;
      linkSection.style.width = `${Math.max(1, Math.abs(converted[0] - converted[2]))}px`;
      linkSection.style.height = `${Math.max(1, Math.abs(converted[1] - converted[3]))}px`;
      annotationLayer.append(linkSection);
    } else {
      linkSection.classList.add('paper-notes-semantic-link');
    }

    const anchor = linkSection.querySelector<HTMLAnchorElement>('a') ?? document.createElement('a');
    anchor.href = '#';
    anchor.dataset.paperNotesTarget = semanticPdfTarget(target);
    anchor.title = target.kind === 'noteEditor' ? '在结构化笔记中打开' : '打开对应的论文笔记位置';
    if (!anchor.parentElement) {
      linkSection.append(anchor);
    }
  }
}

function semanticPdfTarget(target: ReturnType<typeof parsePdfLinkTarget> & {}): string {
  if (target.kind === 'paper') {
    return `pnote.main.${target.id}`;
  }
  if (target.kind === 'note') {
    return `note.main.${target.id}`;
  }
  return `paper-notes-editor:main:${target.id}`;
}

function installPdfInteractionHandlers(tab: PdfTab, container: HTMLDivElement): void {
  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : undefined;
    const anchor = target?.closest('a');
    if (!anchor) {
      return;
    }
    const linkTarget = parsePdfLinkTarget({
      href: anchor.getAttribute('href'),
      title: anchor.getAttribute('title'),
      dataset: { ...(anchor as HTMLElement).dataset }
    });
    if (linkTarget) {
      event.preventDefault();
      event.stopPropagation();
      state.currentId = linkTarget.id;
      if (linkTarget.kind === 'paper') {
        navigateToRoute(makePdfRoute('annotatedPdf', `pnote.main.${linkTarget.id}`, linkTarget.id), true, true);
      } else if (linkTarget.kind === 'note') {
        navigateToRoute(makePdfRoute('notesPdf', `note.main.${linkTarget.id}`, linkTarget.id), true, true);
      } else {
        navigateToRoute({ surface: 'noteEditor', noteId: linkTarget.id });
      }
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      vscode.postMessage({ type: 'openExternal', url: href });
    }
  }, true);

  if (tab === 'annotatedPdf') {
    container.addEventListener('click', (event) => {
      if (!event.ctrlKey || event.button !== 0) {
        return;
      }
      const target = event.target instanceof Element ? event.target : undefined;
      if (target?.closest('a, button, input')) {
        return;
      }
      const pageElement = target?.closest<HTMLElement>('.page[data-page-number]');
      const session = pdfSessions[tab];
      if (!pageElement || !session.viewer) {
        return;
      }
      event.preventDefault();
      const rectangle = pageElement.getBoundingClientRect();
      const scale = session.viewer.currentScale || session.scale;
      vscode.postMessage({
        type: 'reverseSync',
        tab,
        page: Number.parseInt(pageElement.dataset.pageNumber ?? '1', 10),
        x: Math.max(0, (event.clientX - rectangle.left) / (scale * PDF_TO_CSS_UNITS)),
        y: Math.max(0, (event.clientY - rectangle.top) / (scale * PDF_TO_CSS_UNITS))
      });
    });
  }

  container.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      document.getElementById('pdf-search-input')?.focus();
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      changePdfPage(tab, 1);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      changePdfPage(tab, -1);
    }
  });
}

function showSyncTexIndicator(tab: PdfTab, point: PdfPoint): void {
  requestAnimationFrame(() => {
    const session = pdfSessions[tab];
    const page = session.container?.querySelector<HTMLElement>(`.page[data-page-number="${point.page}"]`);
    if (!page || !session.viewer) {
      return;
    }
    const indicator = element('div', 'synctex-indicator');
    const scale = session.viewer.currentScale || session.scale;
    const cssScale = scale * PDF_TO_CSS_UNITS;
    indicator.style.left = `${Math.max(0, point.x * cssScale)}px`;
    indicator.style.top = `${Math.max(0, point.y * cssScale - 10)}px`;
    indicator.style.width = `${Math.max(34, (point.width ?? 90) * cssScale)}px`;
    indicator.style.height = `${Math.max(18, (point.height ?? 14) * cssScale)}px`;
    page.append(indicator);
    window.setTimeout(() => indicator.remove(), 2200);
  });
}

function scrollToSyncTexPoint(tab: PdfTab, point: PdfPoint): void {
  const session = pdfSessions[tab];
  const page = session.container?.querySelector<HTMLElement>(`.page[data-page-number="${point.page}"]`);
  if (!page || !session.viewer || !session.container) {
    return;
  }
  session.viewer.currentPageNumber = Math.max(1, Math.min(point.page, session.viewer.pagesCount));
  const scale = (session.viewer.currentScale || session.scale) * PDF_TO_CSS_UNITS;
  const targetTop = page.offsetTop + point.y * scale - session.container.clientHeight * 0.28;
  session.container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
}

function pageControl(tab: PdfTab): HTMLElement {
  const session = pdfSessions[tab];
  const group = element('label', 'page-control');
  const input = document.createElement('input');
  input.id = 'pdf-page-input';
  input.type = 'number';
  input.min = '1';
  input.value = String(session.page);
  input.addEventListener('change', () => {
    if (!session.viewer) {
      return;
    }
    session.viewer.currentPageNumber = Math.max(
      1,
      Math.min(session.viewer.pagesCount, Number.parseInt(input.value, 10) || 1)
    );
  });
  const total = element('span');
  total.id = 'pdf-page-total';
  total.textContent = session.document ? `/ ${session.document.numPages}` : '/ –';
  group.append(input, total);
  return group;
}

function updatePdfToolbar(tab: PdfTab): void {
  const session = pdfSessions[tab];
  const input = document.getElementById('pdf-page-input') as HTMLInputElement | null;
  const total = document.getElementById('pdf-page-total');
  if (input) {
    input.value = String(session.page);
    input.max = String(session.viewer?.pagesCount ?? session.document?.numPages ?? 1);
  }
  if (total) {
    total.textContent = `/ ${session.viewer?.pagesCount ?? session.document?.numPages ?? '–'}`;
  }
  const zoom = document.querySelector<HTMLElement>('.zoom-label');
  if (zoom) {
    zoom.textContent = `${Math.round(session.scale * 100)}%`;
  }
}

function changePdfPage(tab: PdfTab, delta: number): void {
  const session = pdfSessions[tab];
  if (!session.viewer) {
    return;
  }
  session.viewer.currentPageNumber = Math.max(
    1,
    Math.min(session.viewer.pagesCount, session.viewer.currentPageNumber + delta)
  );
}

function changePdfScale(tab: PdfTab, delta: number): void {
  const viewer = pdfSessions[tab].viewer;
  if (!viewer) {
    return;
  }
  viewer.currentScale = Math.max(0.55, Math.min(2.5, Math.round((viewer.currentScale + delta) * 100) / 100));
}

function fitPdfWidth(tab: PdfTab): void {
  const viewer = pdfSessions[tab].viewer;
  if (viewer) {
    viewer.currentScaleValue = 'page-width';
  }
}

function dispatchPdfSearch(tab: PdfTab, type: '' | 'again', findPrevious = false): void {
  const session = pdfSessions[tab];
  if (!session.eventBus || !session.searchQuery.trim()) {
    return;
  }
  session.eventBus.dispatch('find', {
    source: window,
    type,
    query: session.searchQuery,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious
  });
}

function makePdfRoute(tab: PdfTab, destination?: string, noteId?: string): NavigationRoute {
  const session = pdfSessions[tab];
  const pdf = pdfViewState(session);
  if (destination !== undefined) {
    pdf.destination = destination;
  }
  return {
    surface: tab,
    noteId,
    pdf
  };
}

function pdfViewState(session: PdfSession): PdfViewState {
  return {
    page: session.page,
    scale: session.scale,
    scrollTop: session.scrollTop,
    scrollLeft: session.scrollLeft,
    destination: session.destination
  };
}

function navigateToRoute(route: NavigationRoute, push = true, activateDestination = false): void {
  const target = push ? navigation.push(route) : route;
  if (target.noteId) {
    state.currentId = target.noteId;
    vscode.postMessage({ type: 'setCurrentNote', id: target.noteId });
  }
  if (target.surface === 'noteEditor') {
    activeTab = 'notes';
    vscode.postMessage({ type: 'selectTab', tab: activeTab });
    render();
  } else if (target.surface === 'notesPdf' || target.surface === 'annotatedPdf') {
    activeTab = target.surface;
    const session = pdfSessions[activeTab];
    if (target.pdf) {
      session.page = target.pdf.page;
      session.scale = target.pdf.scale;
      session.scrollTop = target.pdf.scrollTop;
      session.scrollLeft = target.pdf.scrollLeft;
      session.destination = target.pdf.destination;
      session.requestedDestination = activateDestination ? target.pdf.destination : undefined;
    }
    vscode.postMessage({ type: 'selectTab', tab: activeTab });
    render();
  } else {
    vscode.postMessage({ type: 'navigateSource', id: target.noteId, source: target.source });
    render();
  }
  persistPanelState();
}

function openSourceForNote(id: string): void {
  navigateToRoute({ surface: 'latexSource', noteId: id });
}

function navigateHistory(direction: 'back' | 'forward'): void {
  const route = direction === 'back' ? navigation.back() : navigation.forward();
  if (route) {
    navigateToRoute(route, false);
  }
}

function updateCurrentPdfRoute(tab: PdfTab): void {
  if (navigation.current?.surface !== tab) {
    return;
  }
  navigation.replace({
    surface: tab,
    noteId: state.currentId,
    pdf: pdfViewState(pdfSessions[tab])
  });
}

let persistTimer: number | undefined;

function schedulePersistState(tab?: PdfTab): void {
  if (tab) {
    updateCurrentPdfRoute(tab);
  }
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => persistPanelState(), 180);
}

function persistPanelState(): void {
  const persisted: PersistedPanelState = {
    activeTab,
    currentId: state.currentId,
    searchText,
    typeFilter,
    pdf: {
      notesPdf: { ...pdfViewState(pdfSessions.notesPdf), searchQuery: pdfSessions.notesPdf.searchQuery },
      annotatedPdf: { ...pdfViewState(pdfSessions.annotatedPdf), searchQuery: pdfSessions.annotatedPdf.searchQuery }
    },
    navigation: navigation.snapshot()
  };
  vscode.setState(persisted);
  vscode.postMessage({ type: 'persistState', panelState: persisted });
}

function applyPersistedState(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }
  const persisted = value as Partial<PersistedPanelState>;
  if (isPanelTab(persisted.activeTab)) {
    activeTab = persisted.activeTab;
  }
  if (typeof persisted.currentId === 'string') {
    state.currentId = persisted.currentId;
  }
  if (typeof persisted.searchText === 'string') {
    searchText = persisted.searchText;
  }
  if (isTypeFilter(persisted.typeFilter)) {
    typeFilter = persisted.typeFilter;
  }
  for (const tab of ['notesPdf', 'annotatedPdf'] as const) {
    const saved = persisted.pdf?.[tab];
    if (!saved) {
      continue;
    }
    const session = pdfSessions[tab];
    session.page = positiveNumber(saved.page, 1);
    session.scale = positiveNumber(saved.scale, 1.15);
    session.scrollTop = nonNegativeNumber(saved.scrollTop);
    session.scrollLeft = nonNegativeNumber(saved.scrollLeft);
    session.searchQuery = typeof saved.searchQuery === 'string' ? saved.searchQuery : '';
    session.destination = typeof saved.destination === 'string' ? saved.destination : undefined;
  }
  if (persisted.navigation && Array.isArray(persisted.navigation.entries)) {
    navigation = new NavigationHistory({
      entries: persisted.navigation.entries.filter(isNavigationRoute),
      index: persisted.navigation.index
    });
  }
  restoredStateApplied = true;
}

function detachPdfViews(): void {
  for (const tab of ['notesPdf', 'annotatedPdf'] as const) {
    const session = pdfSessions[tab];
    if (!session.viewer) {
      continue;
    }
    session.viewToken += 1;
    try {
      (session.viewer as unknown as { setDocument(document: null): void }).setDocument(null);
    } catch {
      // Removing the old Webview DOM is sufficient if PDF.js is already tearing down.
    }
    session.viewer = undefined;
    session.linkService = undefined;
    session.findController = undefined;
    session.eventBus = undefined;
    session.container = undefined;
  }
}

function parsePdfPoint(value: unknown): PdfPoint | undefined {
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

function parseSourcePosition(value: unknown): { file: string; line: number; column: number } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const source = value as { file?: unknown; line?: unknown; column?: unknown };
  if (typeof source.file !== 'string' || typeof source.line !== 'number' || typeof source.column !== 'number') {
    return undefined;
  }
  return {
    file: source.file,
    line: Math.max(0, Math.trunc(source.line)),
    column: Math.max(0, Math.trunc(source.column))
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isTypeFilter(value: unknown): value is typeof typeFilter {
  return value === 'all' || value === 'todo-only'
    || value === 'thought' || value === 'example' || value === 'question' || value === 'todo';
}

function currentPdfTab(): PdfTab | undefined {
  return activeTab === 'notesPdf' || activeTab === 'annotatedPdf' ? activeTab : undefined;
}

function pdfResource(tab: PdfTab): PdfResource {
  return tab === 'notesPdf' ? state.notesPdf : state.annotatedPdf;
}

function renderMarkdownPreview(target: HTMLElement, content: string): void {
  target.innerHTML = content.trim() ? markdown.render(content) : `<span class="preview-empty">${t('previewEmpty')}</span>`;
  renderMathInElement(target, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ],
    throwOnError: false,
    strict: false,
    trust: false
  });
  for (const link of target.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      vscode.postMessage({ type: 'openExternal', url: link.href });
    });
  }
  for (const image of target.querySelectorAll<HTMLImageElement>('img[src]')) {
    let source = image.getAttribute('src') ?? '';
    if (source && !/^(?:[a-z]+:|\/|#)/i.test(source)) {
      const notesDir = state.project?.notesDir ?? '';
      if (notesDir && source.startsWith(`${notesDir}/`)) {
        source = source.slice(notesDir.length + 1);
      }
      image.src = `${state.assetBaseUri}${source.replace(/^\.\//, '')}`;
    }
  }
}

function scheduleSave(note: PanelNote): void {
  note.revision = Math.max(0, note.revision ?? 0) + 1;
  dirtyNotes.set(note.id, note);
  showSaveState(t('editing'), 'pending');
  const existing = saveTimers.get(note.id);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  saveTimers.set(note.id, window.setTimeout(() => sendPendingSave(note.id), 500));
}

function sendPendingSave(id: string): void {
  const timer = saveTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    saveTimers.delete(id);
  }
  const note = dirtyNotes.get(id);
  if (!note) {
    return;
  }
  const revision = note.revision ?? 0;
  if ((sentRevisions.get(id) ?? -1) >= revision) {
    return;
  }
  sentRevisions.set(id, revision);
  showSaveState(t('saving'), 'pending');
  vscode.postMessage({ type: 'saveNote', note: structuredClone(note) });
}

function flushPendingSaves(): void {
  for (const id of [...dirtyNotes.keys()]) {
    sendPendingSave(id);
  }
}

function showSaveState(text: string, kind: 'ok' | 'pending' | 'error'): void {
  const target = document.getElementById('save-state');
  if (target) {
    target.textContent = text;
    target.className = `save-state ${kind}`;
  }
}

function postBuild(kind: 'quick' | 'full'): void {
  flushPendingSaves();
  vscode.postMessage({ type: 'build', kind });
}

function tabButton(tab: PanelTab, label: string, _icon: string): HTMLButtonElement {
  const button = actionButton(label, `tab${activeTab === tab ? ' active' : ''}`, () => {
    if (tab === 'notes') {
      navigateToRoute({ surface: 'noteEditor', noteId: state.currentId });
    } else {
      navigateToRoute(makePdfRoute(tab, undefined, state.currentId));
    }
  });
  button.setAttribute('aria-selected', String(activeTab === tab));
  return button;
}

function isPanelTab(value: unknown): value is PanelTab {
  return value === 'notes' || value === 'notesPdf' || value === 'annotatedPdf';
}

function parsePdfResource(value: unknown): PdfResource {
  if (!value || typeof value !== 'object') {
    return { uri: '', available: false };
  }
  const candidate = value as Record<string, unknown>;
  return {
    uri: String(candidate.uri ?? ''),
    available: Boolean(candidate.available)
  };
}

function currentNote(): PanelNote | undefined {
  return state.notes.find((note) => note.id === state.currentId) ?? state.notes[0];
}

function actionButton(label: string, className: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `button ${className}`;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function iconButton(label: string, title: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'icon-button';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', action);
  return button;
}

function wrapSelection(textarea: HTMLTextAreaElement, before: string, after: string, placeholder: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholder;
  textarea.setRangeText(`${before}${selected}${after}`, start, end, 'select');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function insertText(textarea: HTMLTextAreaElement, text: string): void {
  textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function insertAtActiveTextarea(text: string): void {
  if (!activeTextarea) {
    toast('请先把光标放入一个 Markdown 条目，再插入图片。', true);
    return;
  }
  insertText(activeTextarea, text);
}

function typeLabel(type: NoteType): string {
  return t(type);
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? t('timeUnknown')
    : new Intl.DateTimeFormat(state.locale === 'en' ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function longDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? t('timeUnknown')
    : new Intl.DateTimeFormat(state.locale === 'en' ? 'en-US' : 'zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function renderLoading(): void {
  app.innerHTML = `<div class="boot"><span></span><strong>${state.locale === 'en' ? 'Preparing marginal notes…' : '正在整理页边笔记…'}</strong></div>`;
}

function buildToastRegion(): HTMLElement {
  const region = element('div', 'toast-region');
  region.id = 'toast-region';
  return region;
}

function toast(message: string, error = false): void {
  const region = document.getElementById('toast-region');
  if (!region) {
    return;
  }
  const item = element('div', `toast${error ? ' error' : ''}`);
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 5000);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) {
    result.className = className;
  }
  return result;
}

function elementWithText<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const result = element(tag, className);
  result.textContent = text;
  return result;
}

function mustElement(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) {
    throw new Error(`Missing #${id}`);
  }
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char] ?? char);
}
