$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$exampleRoot = Join-Path $projectRoot 'example'
$paperOut = Join-Path $exampleRoot 'notes\build\paper'
$notesOut = Join-Path $exampleRoot 'notes\build\notes'
$annotatedOut = Join-Path $exampleRoot 'notes\build\annotated'
New-Item -ItemType Directory -Force -Path $paperOut, $notesOut, $annotatedOut | Out-Null

Push-Location $exampleRoot
try {
  & latexmk -pdf -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 "-outdir=$paperOut" main.tex
  if ($LASTEXITCODE -ne 0) { throw "Clean example build failed: $LASTEXITCODE" }
  & latexmk -xelatex -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 "-outdir=$notesOut" notes/paper_notes.tex
  if ($LASTEXITCODE -ne 0) { throw "Notes example build failed: $LASTEXITCODE" }
  $index = Join-Path $notesOut 'notetypes.idx'
  if (Test-Path -LiteralPath $index) {
    & makeindex -o 'notes/build/notes/notetypes.ind' 'notes/build/notes/notetypes.idx'
    if ($LASTEXITCODE -ne 0) { throw "Example index build failed: $LASTEXITCODE" }
    & latexmk -xelatex -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 "-outdir=$notesOut" notes/paper_notes.tex
    if ($LASTEXITCODE -ne 0) { throw "Notes example rebuild failed: $LASTEXITCODE" }
  }
  & latexmk -pdf -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 "-outdir=$annotatedOut" notes/paper_annotated.tex
  if ($LASTEXITCODE -ne 0) { throw "Annotated example build failed: $LASTEXITCODE" }
} finally {
  Pop-Location
}

& node (Join-Path $PSScriptRoot 'audit-pdfs.mjs') `
  (Join-Path $annotatedOut 'paper_annotated.pdf') `
  (Join-Path $notesOut 'paper_notes.pdf') `
  'method:offset-correction'
if ($LASTEXITCODE -ne 0) { throw "Example PDF link audit failed: $LASTEXITCODE" }
