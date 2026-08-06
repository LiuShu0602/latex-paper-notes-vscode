# Changelog

## 0.4.1

- Fixed standalone note links so the `PaperNote` document argument selects `main-` or `supp-` targets instead of always using `main-`.
- Upgraded untouched v0.4.0 project styles automatically while preserving locally modified styles.
- Made failed builds state explicitly that published PDF tabs still show the last successful build.

## 0.4.0

- Promoted extensible Translation and custom annotation types to the stable release after 55 unit tests, VS Code integration tests, light/dark/high-contrast browser tests, and full TeX Live example builds.
- Kept the custom-type dialog and native annotation selector readable across VS Code light, dark, and high-contrast themes.
- Made the public example build script ASCII-safe so Windows PowerShell 5.1 cannot misdecode its Chinese index checks.
- Made newly initialized notes PDFs use the portable Fandol CJK font set instead of requiring Windows system fonts such as SimHei.
- Verified clean-paper pixel identity and all three semantic PDF navigation directions.

## 0.4.0-beta.2

- Isolated Paper Notes dialogs from PDF.js' global `.dialog` styles, fixing dark-on-dark and light-on-light text in the custom-type editor.
- Applied VS Code dropdown/input colors and explicit light/dark color schemes to native selects, options, inputs, previews, and dialog headings.
- Added browser contrast checks for custom-type dialogs and annotation-type selectors in both light and dark themes.

## 0.4.0-beta.1

- Added the manual-only Translation annotation and reusable project-level custom types with stable IDs, names, and colors.
- Upgraded project data to schema v4 with lossless v1/v2/v3 migration and schema-numbered backups.
- Added accessible color normalization plus PDF-safe colors, custom type declarations/items, and grouped type indices.
- Rebuilt the Webview as a theme-adaptive macOS Notes × VS Code interface with one annotation menu, type management, responsive single-pane navigation, Codicons, keyboard menus, high-contrast support, and reduced motion.
- Added project-style version/hash checks, safe automatic upgrades for untouched v0.3 styles, and a backup-first manual upgrade path for customized styles.
- Split Webview state, note filtering, PDF session helpers, type registry, and common components into focused modules.
- Fixed MiKTeX CI package installation to install and verify one package at a time.

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
