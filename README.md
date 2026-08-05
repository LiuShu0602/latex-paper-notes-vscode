# LaTeX Paper Notes

LaTeX Paper Notes is a local-first VS Code extension for keeping structured research notes next to a paper. Select a sentence, paragraph, or complete display-math environment in LaTeX; the extension inserts stable semantic markers, stores the note as JSON, and produces an annotated paper PDF plus a standalone notes PDF with bidirectional links.

[中文说明](README.zh-CN.md)

## What it does

- Initializes an existing paper only after showing the root file, engines, managed source tree, and every proposed file change.
- Manages one root file plus recursive `\input`, `\include`, `\subfile`, `\import`, `\subimport`, and literal `\InputIfFileExists` dependencies.
- Adds notes from selections in any confirmed managed source file.
- Keeps thoughts, examples, questions, and revision tasks as Markdown with LaTeX math. Legacy LaTeX note blocks remain lossless.
- Generates a clean paper, annotated paper, and standalone notes PDF with stable `pnote.main.<id>` and `note.main.<id>` destinations.
- Provides continuous PDF.js viewing, PDF search, navigation history, and forward/reverse SyncTeX.
- Runs locally with no telemetry, cloud synchronization, or background network request.

PDF text-selection annotation is not part of v0.3.x. Create notes from the LaTeX source editor.

## Requirements

- Windows desktop VS Code 1.114 or newer.
- TeX Live or MiKTeX with `latexmk`, the selected paper engine, XeLaTeX or LuaLaTeX for notes, `makeindex`, `synctex`, and `kpsewhich`.
- TeX packages: `hyperref`, `xr-hyper`, `ctex`, `tcolorbox`, and `imakeidx`.

LaTeX Workshop is optional. The extension has its own build and PDF workflow.

## Install the VSIX

1. Download `latex-paper-notes-0.3.1.vsix` and its SHA-256 file.
2. In VS Code, run **Extensions: Install from VSIX...**.
3. Select the VSIX, then manually run **Developer: Reload Window**.

Command-line alternative:

```powershell
code --install-extension .\latex-paper-notes-0.3.1.vsix
```

## Initialize a paper

1. Open the paper's folder in VS Code. One workspace folder represents one paper.
2. Run **Paper Notes: Initialize LaTeX Paper Notes Project**.
3. Confirm the detected root file. Detection considers `% !TeX root`, the active file, and files containing both `\documentclass` and `\begin{document}`.
4. Confirm the paper and notes engines.
5. Review the recursive source tree, warnings, and exact create/modify list.
6. Choose **Initialize**.

The root file is backed up as `<root>.paper-notes.bak`. The inserted integration block is explicitly delimited and uses `\IfFileExists`; if the entire `notes/` directory is removed, the clean paper still compiles and the note commands become empty fallbacks. Running initialization twice does not duplicate anything.

## Daily workflow

1. In any managed `.tex` file, select one complete sentence, paragraph, or display-math environment.
2. Right-click **Add Paper Note from Selection**, or press `Ctrl+Alt+N`.
3. Enter a title and confirm the suggested semantic ID, such as `introduction:sensor-calibration`.
4. Edit structured items in the Paper Notes panel. Changes save automatically; switching notes, closing the panel, building, and extension shutdown flush pending edits.
5. Choose **Quick Build** to regenerate the clean paper, notes PDF, and annotated paper. **Full Build** is equivalent for built-in projects and can remain a larger custom workflow for migrated legacy projects.

The source receives only:

```tex
\PaperNoteBegin{introduction:sensor-calibration}
Selected paper text.
\PaperNoteEnd{introduction:sensor-calibration}
```

The clean PDF has no visible note color or marker. The annotated PDF colors the selected span blue and appends `[N#]`.

## Navigation

- Annotated paper `[N#]` → matching destination in the notes PDF.
- Notes PDF page link → matching source destination in the annotated paper.
- Notes PDF editor link → matching structured note in VS Code.
- Panel **Locate source** → selects the text between source markers, including in child files.
- **Locate Cursor in Annotated PDF** → forward SyncTeX.
- `Ctrl+click` a non-link point in the annotated PDF → reverse SyncTeX to the workspace-local source file.

Some external PDF readers restrict cross-file links. The standalone notes PDF also prints the paper page and source excerpt as a fallback.

## Project data

`notes/paper-notes.json` is schema v3 and is the authoritative structured data. `notes/main_notes.tex` is deterministic generated output and should not be edited manually. Both are intended for Git. Generated PDFs, SyncTeX files, LaTeX auxiliaries, `notes/build/`, `node_modules/`, `dist/`, and VSIX files are ignored.

All stored project paths are relative POSIX paths. Absolute paths, `..` escapes, and symbolic links resolving outside the workspace folder are rejected. Executable locations are machine-scoped VS Code settings and never written into the project.

## Diagnostics and recovery

- **Paper Notes Project Diagnostics** checks executables and required TeX packages without installing anything.
- **Rescan Managed LaTeX Files** previews changes before accepting newly discovered dependencies. `.fls` discoveries also require confirmation.
- **Validate Paper Notes Markers** reports incomplete pairs, nesting, overlap, duplicate IDs across files, source-only markers, and orphan JSON records.
- **Relink Orphan Note to Selection** can use a manual selection or one of at most three confirmed exact/context candidates; fuzzy matches are never applied silently.
- **Repair Paper Notes Integration** restores the delimited root block without touching paper prose.
- Transactional saves retain `.last-good`; schema migration retains `notes/legacy/paper-notes.schema2.bak.json`.

## Legacy v0.2 migration

Opening a schema v2 project performs a lossless v2→v3 migration. IDs, timestamps, content, excerpts, source selectors, and PDF destination names are preserved. Existing project build scripts migrate to `legacy-script` mode, so a private supplement workflow can continue unchanged. See [MIGRATION.md](MIGRATION.md).

## Privacy and scope

The packaged extension contains no paper, note database, local path, credential, or compiled research PDF. It starts only configured local processes with argument arrays and `shell: false`. Source writes and builds are disabled in untrusted workspaces.

This release manages the main paper only. Supplement management, PDF-selection note creation, object-level table/figure annotation, collaboration, and cloud sync are out of scope.

## Development

```powershell
npm.cmd ci --registry=https://registry.npmmirror.com
npm.cmd run test:all
npm.cmd run package
```

Packaging includes the real headless Playwright click smoke test. See `THIRD_PARTY_NOTICES.md` for PDF.js, KaTeX, and Markdown-It notices.

License: MIT.
