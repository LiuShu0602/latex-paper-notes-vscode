import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import { createEmptyData, hashText, normalizeRelativePosixPath, type NotesEngine, type PaperEngine, type PaperNotesProject } from './model.js';
import { resolveInsideProject, type SourceGraph } from './project.js';

export const INTEGRATION_BEGIN = '% >>> LaTeX Paper Notes integration >>>';
export const INTEGRATION_END = '% <<< LaTeX Paper Notes integration <<<';

export interface InitializationOptions {
  rootFile: string;
  sourceGraph: SourceGraph;
  paperEngine: PaperEngine;
  notesEngine: NotesEngine;
  notesDir?: string;
}

export interface PlannedFileChange {
  path: string;
  action: 'create' | 'modify' | 'unchanged';
  description: string;
  before?: string;
  after: string;
}

export interface InitializationPlan {
  project: PaperNotesProject;
  changes: PlannedFileChange[];
  warnings: string[];
}

export async function planInitialization(workspaceRoot: string, options: InitializationOptions): Promise<InitializationPlan> {
  const rootFile = normalizeRelativePosixPath(options.rootFile, 'rootFile');
  const notesDir = normalizeRelativePosixPath(options.notesDir ?? 'notes', 'notesDir');
  const project: PaperNotesProject = {
    rootFile,
    sourceFiles: options.sourceGraph.sourceFiles,
    paperEngine: options.paperEngine,
    notesEngine: options.notesEngine,
    notesDir,
    generatedNotesFile: `${notesDir}/main_notes.tex`,
    annotatedWrapper: `${notesDir}/paper_annotated.tex`,
    annotatedPdf: `${notesDir}/paper_annotated.pdf`,
    notesPdf: `${notesDir}/paper_notes.pdf`,
    build: { mode: 'builtin' }
  };
  const rootPath = await resolveInsideProject(workspaceRoot, rootFile, false);
  const rootSource = await readFile(rootPath, 'utf8');
  const integratedRoot = upsertIntegrationBlock(rootSource, integrationBlock(project));
  const files = new Map<string, { content: string; description: string }>([
    [rootFile, { content: integratedRoot, description: 'Insert the optional Paper Notes integration block' }],
    [`${notesDir}/paper-notes-paper.sty`, { content: renderPaperIntegrationPackage(project), description: 'Paper-side stable anchors and annotated links' }],
    [`${notesDir}/paper-notes-style.sty`, { content: renderNotesStylePackage(notesDir), description: 'Standalone notes PDF style' }],
    [project.annotatedWrapper, { content: renderAnnotatedWrapper(project), description: 'Annotated-paper wrapper' }],
    [`${notesDir}/paper_notes.tex`, { content: renderNotesRoot(project), description: 'Standalone notes PDF root' }],
    [project.generatedNotesFile, { content: renderEmptyGeneratedNotes(), description: 'Generated structured-note fragment' }],
    [`${notesDir}/paper-notes.json`, { content: `${JSON.stringify(createEmptyData(project), null, 2)}\n`, description: 'Structured note data (schema v3)' }],
    [`${notesDir}/README.md`, { content: renderProjectReadme(), description: 'Project-local usage and recovery guide' }]
  ]);
  const ignorePath = '.gitignore';
  const existingIgnore = await readOptional(workspaceRoot, ignorePath);
  files.set(ignorePath, {
    content: upsertIgnoreBlock(existingIgnore ?? ''),
    description: 'Ignore only generated Paper Notes build artifacts'
  });

  const backupPath = `${rootFile}.paper-notes.bak`;
  const existingBackup = await readOptional(workspaceRoot, backupPath);
  const changes: PlannedFileChange[] = [{
    path: backupPath,
    action: existingBackup === undefined ? 'create' : 'unchanged',
    description: 'One-time backup of the root file before integration',
    before: existingBackup,
    after: existingBackup ?? rootSource
  }];
  for (const [path, file] of files) {
    const before = await readOptional(workspaceRoot, path);
    changes.push({
      path,
      action: before === undefined ? 'create' : before === file.content ? 'unchanged' : 'modify',
      description: file.description,
      before,
      after: file.content
    });
  }
  const warnings = options.sourceGraph.diagnostics.map((diagnostic) => diagnostic.message);
  return { project, changes, warnings };
}

export async function applyInitializationPlan(workspaceRoot: string, plan: InitializationPlan): Promise<string> {
  const changed = plan.changes.filter((change) => change.action !== 'unchanged');
  const backupPath = `${plan.project.rootFile}.paper-notes.bak`;
  const applied: PlannedFileChange[] = [];
  try {
    for (const change of changed) {
      // Detect edits made after the preview, before replacing anything.
      const current = await readOptional(workspaceRoot, change.path);
      if (current !== change.before) {
        throw new Error(`${change.path} changed after the initialization preview. No further files were modified.`);
      }
      const target = await resolveInsideProject(workspaceRoot, change.path, true);
      await atomicWrite(target, change.after);
      applied.push(change);
    }
  } catch (error) {
    for (const change of [...applied].reverse()) {
      const target = await resolveInsideProject(workspaceRoot, change.path, true);
      if (change.before === undefined) {
        await rm(target, { force: true });
      } else {
        await atomicWrite(target, change.before);
      }
    }
    throw error;
  }
  return backupPath;
}

export async function rollbackInitializationPlan(workspaceRoot: string, plan: InitializationPlan): Promise<void> {
  for (const change of plan.changes.filter((item) => item.action !== 'unchanged').reverse()) {
    const current = await readOptional(workspaceRoot, change.path);
    if (current !== change.after) {
      throw new Error(`Cannot roll back ${change.path} because it changed after initialization.`);
    }
    const target = await resolveInsideProject(workspaceRoot, change.path, true);
    if (change.before === undefined) {
      await rm(target, { force: true });
    } else {
      await atomicWrite(target, change.before);
    }
  }
}

export function integrationBlock(project: PaperNotesProject): string {
  const packagePath = `${project.notesDir}/paper-notes-paper`;
  return `${INTEGRATION_BEGIN}
% This block is optional for clean builds. Deleting ${project.notesDir}/ keeps the paper compilable.
\\IfFileExists{${packagePath}.sty}{%
  \\usepackage{${packagePath}}%
}{%
  \\providecommand{\\PaperNoteBegin}[1]{}%
  \\providecommand{\\PaperNoteEnd}[1]{}%
  \\providecommand{\\PaperNoteAnchor}[1]{}%
}%
${INTEGRATION_END}`;
}

export function upsertIntegrationBlock(source: string, block: string): string {
  const begin = source.indexOf(INTEGRATION_BEGIN);
  const end = source.indexOf(INTEGRATION_END);
  if (begin >= 0 || end >= 0) {
    if (begin < 0 || end < begin) {
      throw new Error('The Paper Notes integration block is incomplete; run Repair Integration.');
    }
    const afterEnd = end + INTEGRATION_END.length;
    return `${source.slice(0, begin)}${block}${source.slice(afterEnd)}`;
  }
  const documentClass = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^{}]+\}[^\r\n]*(?:\r?\n)?/.exec(source);
  if (!documentClass) {
    throw new Error('Cannot insert integration: the root file has no literal \\documentclass command.');
  }
  const offset = documentClass.index + documentClass[0].length;
  return `${source.slice(0, offset)}\n${block}\n${source.slice(offset)}`;
}

export function renderPaperIntegrationPackage(project: PaperNotesProject): string {
  return String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{${project.notesDir}/paper-notes-paper}[2026/08/06 v0.3.1 LaTeX Paper Notes integration]
\RequirePackage{xcolor}
\ifdefined\PaperNotesDraft
  \RequirePackage{xr-hyper}
\fi
\PassOptionsToPackage{hidelinks}{hyperref}
\RequirePackage{hyperref}
\makeatletter
\providecommand{\PaperNotesAuxBase}{${project.notesDir}/build/notes/paper_notes}
\providecommand{\PaperNotesPdfLink}{${posix.basename(project.notesPdf)}}
\ifdefined\PaperNotesDraft
  \externaldocument[notes-]{\PaperNotesAuxBase}[\PaperNotesPdfLink]
\fi
\newcommand{\PNMainNoteDestination}[1]{pnote.main.#1}
\newcommand{\PNMainNoteAnchor}[1]{%
  \Hy@raisedlink{\hyper@anchorstart{\PNMainNoteDestination{#1}}\hyper@anchorend}%
  \begingroup\edef\@currentHref{\PNMainNoteDestination{#1}}\label{pnote:#1}\endgroup}
\newcommand{\PNMainNoteMarker}[1]{%
  \allowbreak\textsuperscript{\hyperref[notes-note:main:#1]{%
    \textcolor{blue!70!black}{\scriptsize[N\ref*{notes-note:main:#1}]}}}}
\newcommand{\PaperNoteBegin}[1]{%
  \PNMainNoteAnchor{#1}%
  \ifdefined\PaperNotesDraft\begingroup\color{blue!70!black}\fi}
\newcommand{\PaperNoteEnd}[1]{%
  \ifdefined\PaperNotesDraft\PNMainNoteMarker{#1}\endgroup\fi}
\newcommand{\PaperNoteAnchor}[1]{%
  \PNMainNoteAnchor{#1}%
  \ifdefined\PaperNotesDraft\PNMainNoteMarker{#1}\fi}
\makeatother
`;
}

export function renderAnnotatedWrapper(project: PaperNotesProject): string {
  return `% !TeX program = ${project.paperEngine}\n% Generated wrapper: visible note spans and links.\n\\def\\PaperNotesDraft{1}\n\\input{${project.rootFile}}\n`;
}

export function renderNotesRoot(project: PaperNotesProject): string {
  const rootStem = posix.basename(project.rootFile, '.tex');
  return `% !TeX program = latexmk
\\documentclass[11pt,a4paper]{ctexart}
\\usepackage[margin=25mm]{geometry}
\\usepackage{amsmath,amssymb,mathtools,booktabs,tabularx,graphicx,xcolor,xurl}
\\usepackage{${project.notesDir}/paper-notes-style}
\\usepackage{xr-hyper}
\\usepackage[hidelinks]{hyperref}
\\externaldocument[main-]{${project.notesDir}/build/paper/${rootStem}}[${posix.basename(project.annotatedPdf)}]
\\hypersetup{colorlinks=true,linkcolor=blue!55!black,urlcolor=blue!55!black}
\\title{Paper Notes / 论文伴随笔记}
\\author{Research notes}
\\date{\\today}
\\begin{document}
\\maketitle
\\tableofcontents
\\clearpage
\\input{${project.generatedNotesFile.slice(0, -4)}}
\\clearpage
\\PrintNoteTypeIndex
\\end{document}
`;
}

export function renderNotesStylePackage(notesDir = 'notes'): string {
  return String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{${notesDir}/paper-notes-style}[2026/08/06 v0.3.1 Companion paper notes]
\RequirePackage{etoolbox}
\RequirePackage{xparse}
\RequirePackage[most]{tcolorbox}
\RequirePackage[noautomatic,quiet]{imakeidx}
\makeindex[name=notetypes,title={Note types / 按类型索引},columns=1,intoc]
\definecolor{PNThought}{HTML}{2563A5}
\definecolor{PNExample}{HTML}{2E7D32}
\definecolor{PNQuestion}{HTML}{B26A00}
\definecolor{PNTodo}{HTML}{B3261E}
\definecolor{PNFrame}{HTML}{607D8B}
\newcounter{papernote}[section]
\renewcommand{\thepapernote}{\thesection.\arabic{papernote}}
\makeatletter
\newcommand{\PN@writeindex}[1]{\index[notetypes]{#1}}
\newcommand{\PN@renderitem}[4]{%
  \edef\PN@indexentry{#1@#2!note-\thepapernote @Note\space\thepapernote}%
  \expandafter\PN@writeindex\expandafter{\PN@indexentry}%
  \par\medskip\noindent
  \tcbox[on line,colback=#3!10,colframe=#3,boxrule=.5pt,arc=1mm,boxsep=1pt,left=3pt,right=3pt,top=1pt,bottom=1pt]{\textcolor{#3}{\bfseries #2}}\hspace{.5em}#4\par}
\NewDocumentEnvironment{PaperNote}{m m m}{%
  \refstepcounter{papernote}%
  \Hy@raisedlink{\hyper@anchorstart{note.#1.#2}\hyper@anchorend}%
  \begingroup\edef\@currentHref{note.#1.#2}\label{note:#1:#2}\endgroup
  \addcontentsline{toc}{subsection}{\protect\numberline{\thepapernote}#3}%
  \begin{tcolorbox}[enhanced,breakable,colback=white,colframe=PNFrame,boxrule=.7pt,arc=1.5mm,title={Note~\thepapernote: #3},fonttitle=\bfseries,coltitle=white,colbacktitle=PNFrame,before skip=1.1em,after skip=1.1em]
  \small\noindent\textbf{Source / 来源:} main\quad
  \textbf{Page / 页码:} \hyperref[main-pnote:#2]{\pageref*{main-pnote:#2}}\quad
  \textbf{ID:} \texttt{\detokenize{#2}}\par\smallskip
  \textbf{Editor / 编辑:} \href{paper-notes-editor:main:#2}{Open in VS Code / 在 VS Code 中打开}\par\smallskip
}{\end{tcolorbox}}
\NewDocumentCommand{\SourceExcerpt}{+m}{\begin{tcolorbox}[colback=black!3,colframe=black!25,boxrule=.4pt,arc=1mm]\textbf{Excerpt / 原文摘录:}\enspace\emph{#1}\end{tcolorbox}}
\NewDocumentCommand{\NoteHeading}{m}{\par\medskip\noindent\textcolor{PNFrame}{\bfseries #1}\par\smallskip}
\NewDocumentCommand{\NoteItem}{m +m}{%
  \ifstrequal{#1}{thought}{\PN@renderitem{1-thought}{Thought / 感想}{PNThought}{#2}}{%
  \ifstrequal{#1}{example}{\PN@renderitem{2-example}{Example / 例子}{PNExample}{#2}}{%
  \ifstrequal{#1}{question}{\PN@renderitem{3-question}{Question / 疑问}{PNQuestion}{#2}}{%
  \ifstrequal{#1}{todo}{\PN@renderitem{4-todo}{To revise / 待修改}{PNTodo}{#2}}{\PackageError{paper-notes-style}{Unknown note type '#1'}{Use thought, example, question, or todo.}}}}}}
\NewDocumentCommand{\PaperRef}{m m m}{\hyperref[#1-#2]{#3}}
\NewDocumentCommand{\NoteRef}{m m}{\hyperref[note:#1]{#2}}
\NewDocumentCommand{\PrintNoteTypeIndex}{}{\printindex[notetypes]}
\makeatother
`;
}

function renderEmptyGeneratedNotes(): string {
  const data = createEmptyData();
  const hash = hashText(`${JSON.stringify(data, null, 2)}\n`);
  return `% !TeX root = paper_notes.tex\n% AUTO-GENERATED BY LaTeX Paper Notes; data-sha256=${hash}\n% Edit notes in the VS Code Paper Notes panel.\n\\part{Main paper notes / 主文笔记}\n`;
}

function renderProjectReadme(): string {
  return `# LaTeX Paper Notes project data

Edit structured notes through the VS Code panel. The extension deterministically regenerates \`main_notes.tex\` from \`paper-notes.json\`.

通过 VS Code 面板编辑结构化笔记。扩展会根据 \`paper-notes.json\` 确定性生成 \`main_notes.tex\`，请勿直接编辑生成文件。

Generated PDFs, SyncTeX files, indices, logs, and the \`build/\` directory are intentionally ignored by Git.
`;
}

function upsertIgnoreBlock(source: string): string {
  const begin = '# >>> LaTeX Paper Notes generated files >>>';
  const end = '# <<< LaTeX Paper Notes generated files <<<';
  const block = `${begin}
notes/build/
notes/*.pdf
notes/*.synctex.gz
notes/*.aux
notes/*.fdb_latexmk
notes/*.fls
notes/*.idx
notes/*.ilg
notes/*.ind
notes/*.log
notes/*.last-good
*.tex.paper-notes.bak
${end}`;
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start >= 0 && finish >= start) {
    return `${source.slice(0, start)}${block}${source.slice(finish + end.length)}`;
  }
  return `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${block}\n`;
}

async function readOptional(workspaceRoot: string, path: string): Promise<string | undefined> {
  const absolute = await resolveInsideProject(workspaceRoot, path, true);
  if (!(await exists(absolute))) {
    return undefined;
  }
  return readFile(absolute, 'utf8');
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temp = `${target}.${process.pid}-${Date.now()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, content, 'utf8');
  try {
    await rename(temp, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') {
      throw error;
    }
    await rm(target, { force: true });
    await rename(temp, target);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
