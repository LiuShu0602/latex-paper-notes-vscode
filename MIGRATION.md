# Migration

## From v0.4.0 to v0.4.1

1. Install the v0.4.1 VSIX and manually run **Developer: Reload Window**.
2. Open the paper project. An untouched public v0.4.0 style is backed up and upgraded automatically; a locally modified style remains protected.
3. Run a quick or full build. If validation fails, the extension now states that the PDF tabs still contain the last successful build rather than newly generated output.

This patch does not change schema v4, note IDs, content, source markers, or PDF destination names. It corrects document routing for projects whose notes use both `main` and `supp` sources.

## From v0.3.x or v0.4.0 beta to v0.4.0

1. Commit or back up the paper project, then install the v0.4.0 VSIX and manually run **Developer: Reload Window**.
2. Open the project. Schema v3 data is migrated to schema v4, adding an empty `customTypes` list without changing notes.
3. Confirm that `notes/legacy/paper-notes.schema3.bak.json` exists.
4. Untouched public v0.3.x and v0.4.0 beta styles are backed up and upgraded automatically. A locally modified style is not overwritten; use **Upgrade Paper Notes Project Components** after reviewing the warning.
5. Run diagnostics, marker validation, and a full build.

Existing note IDs, timestamps, content, source selectors, and PDF destinations remain unchanged. Translation is manual-only and the extension performs no translation request or background network access.

## From v0.2.x to v0.3.x

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
