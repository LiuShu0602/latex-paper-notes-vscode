import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashText, type PaperNotesProject } from './model.js';
import { PROJECT_STYLE_VERSION, renderNotesStylePackage } from './initializer.js';
import { resolveInsideProject } from './project.js';

export type ProjectStyleKind = 'compatible' | 'stock-old' | 'modified-old' | 'missing';

export interface ProjectStyleStatus {
  kind: ProjectStyleKind;
  compatible: boolean;
  installedVersion?: string;
  expectedVersion: string;
  actualHash?: string;
  templateHash: string;
  relativePath: string;
  detail: string;
}

export interface ProjectStyleUpgradeResult {
  status: ProjectStyleStatus;
  upgraded: boolean;
  backupFile?: string;
}

export async function inspectProjectStyle(
  workspaceRoot: string,
  project: PaperNotesProject
): Promise<ProjectStyleStatus> {
  const relativePath = `${project.notesDir}/paper-notes-style.sty`;
  const absolutePath = await resolveInsideProject(workspaceRoot, relativePath, true);
  const expected = renderNotesStylePackage(project.notesDir);
  const templateHash = extractTemplateHash(expected)!;
  if (!(await exists(absolutePath))) {
    return {
      kind: 'missing', compatible: false, expectedVersion: PROJECT_STYLE_VERSION,
      templateHash, relativePath, detail: 'The project notes style file is missing.'
    };
  }
  const content = await readFile(absolutePath, 'utf8');
  const installedVersion = extractStyleVersion(content);
  const actualHash = hashText(normalizeNewlines(content));
  if (installedVersion === PROJECT_STYLE_VERSION) {
    return {
      kind: 'compatible', compatible: true, installedVersion, expectedVersion: PROJECT_STYLE_VERSION,
      actualHash, templateHash, relativePath,
      detail: verifyEmbeddedTemplateHash(content)
        ? 'Project style matches the v0.4 template.'
        : 'Project style is v0.4-compatible and contains local modifications.'
    };
  }
  const stockVersion = knownStockV03Version(content, project.notesDir);
  if (stockVersion) {
    return {
      kind: 'stock-old', compatible: false, installedVersion: stockVersion,
      expectedVersion: PROJECT_STYLE_VERSION, actualHash, templateHash, relativePath,
      detail: `Unmodified v${stockVersion} project style can be upgraded safely.`
    };
  }
  return {
    kind: 'modified-old', compatible: false, installedVersion, expectedVersion: PROJECT_STYLE_VERSION,
    actualHash, templateHash, relativePath,
    detail: 'The project style is older or locally modified; it will not be overwritten automatically.'
  };
}

export async function upgradeProjectStyle(
  workspaceRoot: string,
  project: PaperNotesProject,
  options: { force?: boolean } = {}
): Promise<ProjectStyleUpgradeResult> {
  const before = await inspectProjectStyle(workspaceRoot, project);
  if (before.compatible) {
    return { status: before, upgraded: false };
  }
  if (before.kind === 'modified-old' && !options.force) {
    return { status: before, upgraded: false };
  }
  const target = await resolveInsideProject(workspaceRoot, before.relativePath, true);
  let backupFile: string | undefined;
  if (await exists(target)) {
    const version = before.installedVersion?.replace(/[^a-z0-9.-]+/gi, '-') || 'custom';
    backupFile = `${project.notesDir}/legacy/paper-notes-style.v${version}.bak.sty`;
    const backup = await resolveInsideProject(workspaceRoot, backupFile, true);
    if (!(await exists(backup))) {
      await atomicWrite(backup, await readFile(target, 'utf8'));
    }
  }
  const previous = await readOptional(target);
  try {
    await atomicWrite(target, renderNotesStylePackage(project.notesDir));
    const status = await inspectProjectStyle(workspaceRoot, project);
    if (!status.compatible) {
      throw new Error('The upgraded project style did not pass its version/hash check.');
    }
    return { status, upgraded: true, backupFile };
  } catch (error) {
    if (previous === undefined) {
      await rm(target, { force: true });
    } else {
      await atomicWrite(target, previous);
    }
    throw error;
  }
}

export function extractStyleVersion(content: string): string | undefined {
  return /project-style-version:\s*([^\s]+)/i.exec(content)?.[1]
    ?? /\\ProvidesPackage\{[^}]+\}\[[^\]]*\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(content)?.[1];
}

export function extractTemplateHash(content: string): string | undefined {
  return /template-sha256:\s*([a-f0-9]{64})/i.exec(content)?.[1]?.toLowerCase();
}

export function verifyEmbeddedTemplateHash(content: string): boolean {
  const embedded = extractTemplateHash(content);
  if (!embedded) {
    return false;
  }
  const normalized = normalizeNewlines(content).replace(
    /template-sha256:\s*[a-f0-9]{64}/i,
    'template-sha256: __PAPER_NOTES_TEMPLATE_HASH__'
  );
  return hashText(normalized) === embedded;
}

function knownStockV03Version(content: string, notesDir: string): string | undefined {
  const normalized = normalizeNewlines(content);
  for (const version of ['0.3.0', '0.3.1', '0.3.2']) {
    if (normalized === normalizeNewlines(renderStockNotesStyleV03(notesDir, version))) {
      return version;
    }
  }
  return undefined;
}

/** Exact public v0.3.x template, retained solely for non-destructive upgrades. */
export function renderStockNotesStyleV03(notesDir = 'notes', version = '0.3.2'): string {
  return String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{${notesDir}/paper-notes-style}[2026/08/06 v${version} Companion paper notes]
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

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

async function readOptional(path: string): Promise<string | undefined> {
  return await exists(path) ? readFile(path, 'utf8') : undefined;
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
