import assert from 'node:assert/strict';
import test from 'node:test';
import { findUniqueNormalizedExcerpt, parseLegacyNotes, upgradeLegacyAnchor } from '../src/migration.js';

const excerpt = 'The sensor records one temperature reading every minute.';
const source = String.raw`\documentclass{article}
\newcommand{\PaperNoteAnchor}[1]{}
\begin{document}
\section{Introduction}
The sensor records one temperature
reading every minute.%
\PaperNoteAnchor{intro:sampling-interval}
\end{document}`;
const legacy = String.raw`\part{Main notes}
\section{Introduction}
\begin{PaperNote}{main}{intro:sampling-interval}{Sampling interval}
\SourceExcerpt{The sensor records one temperature reading every minute.}
\NoteItem{thought}{Contains \textbf{nested braces} and inline math \(t_{i}=1\).}
\NoteItem{question}{Should the time unit be stated?}
Related text follows.
\end{PaperNote}`;

test('finds a unique excerpt across source line breaks', () => {
  const match = findUniqueNormalizedExcerpt(source, excerpt);
  assert.ok(match);
  assert.equal(
    source.slice(match.start, match.end).replace(/\s+/g, ' '),
    'The sensor records one temperature reading every minute.'
  );
});

test('imports nested legacy LaTeX without flattening item content', () => {
  const migration = parseLegacyNotes(legacy, source, '2026-08-05T00:00:00.000Z');
  assert.equal(migration.data.notes.length, 1);
  const note = migration.data.notes[0];
  assert.equal(note?.id, 'intro:sampling-interval');
  assert.equal(note?.items.length, 2);
  assert.match(note?.items[0]?.content ?? '', /\\textbf\{nested braces}/);
  assert.match(note?.legacyPostlude ?? '', /Related text follows\./);
});

test('upgrades a legacy end anchor to paired selection markers', () => {
  const migration = parseLegacyNotes(legacy, source);
  const upgraded = upgradeLegacyAnchor(source, migration.matches[0]!);
  assert.match(upgraded, /\\PaperNoteBegin\{intro:sampling-interval\}The sensor records/);
  assert.match(upgraded, /minute\.\\PaperNoteEnd\{intro:sampling-interval\}/);
  assert.doesNotMatch(upgraded, /\\PaperNoteAnchor\{intro:sampling-interval\}/);
});
