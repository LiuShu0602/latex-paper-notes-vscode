# Migration to v0.3.x

## From v0.2.x

1. Commit or back up your project.
2. Install the latest v0.3.x VSIX and manually run **Developer: Reload Window**.
3. Open the existing project. The extension reads schema v2, locates every existing marker, and writes schema v3.
4. Confirm that `notes/legacy/paper-notes.schema2.bak.json` exists.
5. Run **Paper Notes Project Diagnostics**, **Validate Paper Notes Markers**, and your existing full build.

Migration preserves note IDs, content, timestamps, excerpts, source selectors, and the PDF destinations `note.main.<id>` and `pnote.main.<id>`. The existing scripts are recorded as `build.mode: "legacy-script"`; this deliberately preserves private or supplement-specific build behavior.

No supplement source or `supplement_notes.tex` is modified.

## Moving to another computer

Copy or clone the paper project including `notes/paper-notes.json`, `notes/main_notes.tex`, the two `.sty` files, the wrapper, and note assets. Do not copy `notes/build`, PDFs, SyncTeX files, or executable settings. Install TeX Live or MiKTeX and configure machine-scoped executable settings only if the tools are not on `PATH`.

Run **Paper Notes Project Diagnostics** on the new computer before building.
