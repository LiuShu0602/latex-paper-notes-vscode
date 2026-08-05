import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSemanticId, scanMarkers, validateSelection } from '../src/markers.js';

const documentSource = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}\label{sec:introduction}
This is a sentence about sensor calibration.
\begin{equation}
x+y=1.
\end{equation}
\end{document}`;

test('validates a prose selection and generates a stable semantic id', () => {
  const start = documentSource.indexOf('This is');
  const end = documentSource.indexOf('\n\\begin{equation}');
  const result = validateSelection(documentSource, start, end);
  assert.equal(result.ok, true);
  assert.equal(
    generateSemanticId(documentSource, start, documentSource.slice(start, end), []),
    'introduction:sentence-about-sensor'
  );
});

test('accepts a complete formula environment and rejects a partial one', () => {
  const start = documentSource.indexOf('\\begin{equation}');
  const end = documentSource.indexOf('\\end{equation}') + '\\end{equation}'.length;
  assert.equal(validateSelection(documentSource, start, end).ok, true);
  const partialStart = documentSource.indexOf('x+y');
  const partialEnd = partialStart + 'x+y=1.'.length;
  const partial = validateSelection(documentSource, partialStart, partialEnd);
  assert.equal(partial.ok, false);
  assert.match(partial.error ?? '', /完整选择/);
});

test('detects duplicate, nested, orphan and empty marker structures', () => {
  const source = String.raw`\PaperNoteBegin{intro:first}\PaperNoteEnd{intro:first}
\PaperNoteBegin{intro:first}x\PaperNoteEnd{intro:first}
\PaperNoteEnd{intro:orphan}`;
  const scan = scanMarkers(source);
  assert.equal(scan.ranges.length, 2);
  assert.ok(scan.problems.some((problem) => problem.code === 'empty'));
  assert.ok(scan.problems.some((problem) => problem.code === 'duplicate'));
  assert.ok(scan.problems.some((problem) => problem.code === 'orphan-end'));
});

test('returns an existing note for an exact marked selection and rejects overlap', () => {
  const source = String.raw`\begin{document}
Before \PaperNoteBegin{intro:marked}selected text\PaperNoteEnd{intro:marked} after.
\end{document}`;
  const scan = scanMarkers(source);
  const range = scan.ranges[0];
  assert.ok(range);
  const exact = validateSelection(source, range.contentStart, range.contentEnd);
  assert.equal(exact.existingId, 'intro:marked');
  const overlap = validateSelection(source, range.contentStart - 2, range.contentEnd);
  assert.equal(overlap.ok, false);
  assert.match(overlap.error ?? '', /重叠/);
});

test('ignores markers in comments and verbatim and rejects partial inline math', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
% \PaperNoteBegin{fake:comment}x\PaperNoteEnd{fake:comment}
\begin{verbatim}\PaperNoteBegin{fake:verbatim}x\PaperNoteEnd{fake:verbatim}\end{verbatim}
Text with $x+y$ inline.
\end{document}`;
  assert.equal(scanMarkers(source).ranges.length, 0);
  const start = source.indexOf('x+y');
  const validation = validateSelection(source, start, start + 3);
  assert.equal(validation.ok, false);
  assert.match(validation.error ?? '', /公式内部/);
});
