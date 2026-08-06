$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$exampleRoot = Join-Path $projectRoot 'example'
$paperOut = Join-Path $exampleRoot 'notes\build\paper'
$notesOut = Join-Path $exampleRoot 'notes\build\notes'
$annotatedOut = Join-Path $exampleRoot 'notes\build\annotated'
New-Item -ItemType Directory -Force -Path $paperOut, $notesOut, $annotatedOut | Out-Null

Push-Location $exampleRoot
try {
  function Invoke-TeXPasses([string]$Engine, [string]$OutputDirectory, [string]$RootFile, [string]$Label) {
    for ($pass = 1; $pass -le 3; $pass++) {
      & $Engine -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 -recorder "-output-directory=$OutputDirectory" $RootFile
      if ($LASTEXITCODE -ne 0) { throw "$Label pass $pass failed: $LASTEXITCODE" }
    }
  }

  Invoke-TeXPasses 'pdflatex' $paperOut 'main.tex' 'Clean example build'
  Invoke-TeXPasses 'xelatex' $notesOut 'notes/paper_notes.tex' 'Notes example build'
  $index = Join-Path $notesOut 'notetypes.idx'
  if (Test-Path -LiteralPath $index) {
    & makeindex -o 'notes/build/notes/notetypes.ind' 'notes/build/notes/notetypes.idx'
    if ($LASTEXITCODE -ne 0) { throw "Example index build failed: $LASTEXITCODE" }
    $indexOutput = Get-Content -LiteralPath 'notes/build/notes/notetypes.ind' -Raw -Encoding UTF8
    if ($indexOutput -notmatch 'Translation / 翻译') { throw 'Translation type is missing from the example index.' }
    if ($indexOutput -notmatch 'Custom / 自定义') { throw 'Custom type is missing from the example index.' }
    if ($indexOutput -match 'hyperxindexformat') { throw 'A custom type name corrupted makeindex syntax.' }
    Invoke-TeXPasses 'xelatex' $notesOut 'notes/paper_notes.tex' 'Notes example rebuild'
  }
  Invoke-TeXPasses 'pdflatex' $annotatedOut 'notes/paper_annotated.tex' 'Annotated example build'
} finally {
  Pop-Location
}

& node (Join-Path $PSScriptRoot 'audit-pdfs.mjs') `
  (Join-Path $annotatedOut 'paper_annotated.pdf') `
  (Join-Path $notesOut 'paper_notes.pdf') `
  'method:offset-correction'
if ($LASTEXITCODE -ne 0) { throw "Example PDF link audit failed: $LASTEXITCODE" }
