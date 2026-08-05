import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceSelector, findRelinkCandidates, normalizeSourceText } from '../src/source-selector.js';

test('builds a context selector and ranks the matching occurrence near its context', () => {
  const selected = 'The calibrated sensor records one observation every ten seconds.';
  const first = `Earlier context. ${selected} First ending.`;
  const source = `${first}\n\nPreferred context about temperature logs. ${selected} Preferred ending.`;
  const start = source.lastIndexOf(selected);
  const selector = buildSourceSelector(source, start, start + selected.length);
  const withoutMarkers = source.replace(selected, 'A different sentence appears here.');
  const candidates = findRelinkCandidates(withoutMarkers, selector);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.kind, 'exact');
  assert.equal(withoutMarkers.slice(candidates[0]?.start, candidates[0]?.end), selected);
  assert.match(selector.normalizedHash, /^[a-f0-9]{64}$/);
});

test('offers a fuzzy candidate when the selected sentence was lightly rewritten', () => {
  const original = 'The sensor stores a temperature sample every ten seconds.';
  const source = `Calibration context before. ${original} Daily summary context after.`;
  const start = source.indexOf(original);
  const selector = buildSourceSelector(source, start, start + original.length);
  const rewritten = source.replace(
    original,
    'The temperature sensor stores a sample every ten seconds.'
  );
  const candidates = findRelinkCandidates(rewritten, selector);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0]?.kind, 'fuzzy');
  assert.match(candidates[0]?.preview ?? '', /temperature sensor|ten seconds/);
});

test('normalization ignores comments, whitespace, and paper-note markers', () => {
  const source = String.raw`A% hidden
  \PaperNoteBegin{intro:test} sentence \PaperNoteEnd{intro:test} here.`;
  assert.equal(normalizeSourceText(source), 'A sentence here.');
});
