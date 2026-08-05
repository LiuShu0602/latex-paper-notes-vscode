import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdfLinkTarget } from '../src/pdf-links.js';

test('recognizes annotated-paper links to a compiled note', () => {
  assert.deepEqual(
    parsePdfLinkTarget({ unsafeUrl: 'paper_notes.pdf#note.main.intro:sensor-calibration' }),
    { kind: 'note', id: 'intro:sensor-calibration' }
  );
});

test('recognizes compiled-note links back to the annotated paper', () => {
  assert.deepEqual(
    parsePdfLinkTarget({ unsafeUrl: 'main_annotated.pdf#pnote.main.intro:sensor-calibration' }),
    { kind: 'paper', id: 'intro:sensor-calibration' }
  );
});

test('recognizes compiled-note links to the corresponding structured editor', () => {
  assert.deepEqual(
    parsePdfLinkTarget({ unsafeUrl: 'paper-notes-editor:main:intro%3Asensor-calibration' }),
    { kind: 'noteEditor', id: 'intro:sensor-calibration' }
  );
});

test('ignores ordinary external links', () => {
  assert.equal(parsePdfLinkTarget({ url: 'https://example.com/article' }), undefined);
});
