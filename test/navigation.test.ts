import assert from 'node:assert/strict';
import test from 'node:test';
import { NavigationHistory } from '../src/navigation.js';

test('navigation history deduplicates routes and supports back and forward', () => {
  const history = new NavigationHistory();
  history.push({ surface: 'noteEditor', noteId: 'intro:one' });
  history.push({ surface: 'notesPdf', noteId: 'intro:one', pdf: { page: 2, scale: 1.2, scrollTop: 80, scrollLeft: 0 } });
  history.push({ surface: 'notesPdf', noteId: 'intro:one', pdf: { page: 2, scale: 1.4, scrollTop: 120, scrollLeft: 0 } });
  assert.equal(history.snapshot().entries.length, 2);
  assert.equal(history.back()?.surface, 'noteEditor');
  assert.equal(history.forward()?.pdf?.scale, 1.4);
});

test('navigation history drops the forward branch and enforces its limit', () => {
  const history = new NavigationHistory(undefined, 3);
  history.push({ surface: 'noteEditor', noteId: 'intro:one' });
  history.push({ surface: 'noteEditor', noteId: 'intro:two' });
  history.push({ surface: 'noteEditor', noteId: 'intro:three' });
  history.back();
  history.push({ surface: 'annotatedPdf', pdf: { page: 4, scale: 1, scrollTop: 0, scrollLeft: 0 } });
  history.push({ surface: 'latexSource', source: { file: 'main.tex', line: 12, column: 3 } });
  const snapshot = history.snapshot();
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.entries.some((route) => route.noteId === 'intro:three'), false);
  assert.equal(history.canGoForward, false);
});
