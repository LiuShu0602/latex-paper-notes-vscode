import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeAndGenerate } from '../src/generator.js';
import { createEmptyData, hashText, type PaperNote } from '../src/model.js';

function note(id: string, sourceFile: string): PaperNote {
  return {
    id, documentId: 'main', sourceFile, title: id, sectionTitle: 'Old', sourceSnapshot: '', sourceHash: hashText(''),
    sourceSelector: { exact: '', prefix: '', suffix: '', normalizedHash: hashText(''), previousOffset: 0 },
    excerptMode: 'auto', excerpt: '', items: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

test('orders notes by recursive source order and inherits the preceding section', () => {
  const data = createEmptyData({ rootFile: 'main.tex', sourceFiles: ['main.tex', 'chapters/a.tex', 'chapters/b.tex'] });
  data.notes.push(note('body:second', 'chapters/b.tex'), note('intro:first', 'chapters/a.tex'));
  const generated = synchronizeAndGenerate(data, new Map([
    ['main.tex', '\\documentclass{article}\n\\begin{document}\\section{Introduction}\\input{chapters/a}\\section{Results}\\input{chapters/b}\\end{document}'],
    ['chapters/a.tex', '\\PaperNoteBegin{intro:first}First passage.\\PaperNoteEnd{intro:first}'],
    ['chapters/b.tex', '\\PaperNoteBegin{body:second}Second passage.\\PaperNoteEnd{body:second}']
  ]));
  assert.deepEqual(generated.data.notes.map((item) => item.id), ['intro:first', 'body:second']);
  assert.equal(generated.data.notes[0]?.sectionTitle, 'Introduction');
  assert.equal(generated.data.notes[1]?.sectionTitle, 'Results');
  assert.equal(generated.data.notes[1]?.sourceSelector.previousOffset, '\\PaperNoteBegin{body:second}'.length);
});
