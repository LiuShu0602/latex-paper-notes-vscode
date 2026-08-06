# Changelog

## 0.3.2

- Fixed false `makeindex` missing reports by using its portable usage probe instead of unsupported `--version`.
- Resolved configured TeX executables to a coherent installation and preferred a complete modern TeX Live when an older MiKTeX also appears on `PATH`.
- Passed the configured pdfLaTeX, XeLaTeX, or LuaLaTeX path explicitly to `latexmk` and prepended the selected tool directory to the child process `PATH`.
- Made `latexmk` optional: when it cannot start because Perl is unavailable, the built-in builder performs three direct engine passes and still builds the notes index and annotated PDF.
- Added regression coverage for TeX Live/MiKTeX mixed paths, unsupported `makeindex --version`, missing Perl, and configured engine forwarding.

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
