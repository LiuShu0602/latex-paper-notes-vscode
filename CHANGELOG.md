# Changelog

## 0.3.1

- Fixed a panel-triggered build deadlock that reported `Timed out while flushing pending note edits` before LaTeX started.
- Kept command-palette builds flushing pending Webview edits while preserving serial save ordering for panel builds.

## 0.3.0

- Added one-click, preview-first initialization for arbitrary Windows LaTeX projects.
- Added schema v3, recursive multi-file source management, safe relative paths, and lossless v0.2 migration.
- Added built-in TeX Live/MiKTeX builds, toolchain diagnostics, `.fls` discovery, transactional saves, and per-note revisions.
- Made LaTeX Workshop optional and added English/Chinese extension and Webview localization.
- Preserved PDF.js, SyncTeX, semantic PDF links, legacy-script projects, and stable destination names.
- Added a sanitized example, public CI/release workflows, VSIX privacy auditing, and MIT licensing.
