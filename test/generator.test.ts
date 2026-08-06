import assert from 'node:assert/strict';
import test from 'node:test';
import { synchronizeAndGenerate } from '../src/generator.js';
import { createEmptyData, hashText } from '../src/model.js';

test('synchronizes an auto excerpt and emits deterministic generated TeX', () => {
  const source = String.raw`\begin{document}
\section{Introduction}
\PaperNoteBegin{intro:sample}Selected 50\% text.\PaperNoteEnd{intro:sample}
\end{document}`;
  const data = createEmptyData();
  data.notes.push({
    id: 'intro:sample',
    documentId: 'main',
    sourceFile: data.project.rootFile,
    title: '示例',
    sectionTitle: 'Old',
    sourceSnapshot: '',
    sourceHash: hashText(''),
    sourceSelector: {
      exact: '',
      prefix: '',
      suffix: '',
      normalizedHash: hashText(''),
      previousOffset: 0
    },
    excerptMode: 'auto',
    excerpt: '',
    items: [{ id: 'item-1', type: 'thought', format: 'markdown', content: '这里有 $x_i$。' }],
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z'
  });
  const generated = synchronizeAndGenerate(data, source);
  assert.equal(generated.data.notes[0]?.sectionTitle, 'Introduction');
  assert.equal(generated.data.notes[0]?.excerpt, 'Selected 50% text.');
  assert.match(generated.tex, /data-sha256=[a-f0-9]{64}/);
  assert.match(generated.tex, /\\SourceExcerpt\{Selected 50\\% text\.\}/);
  assert.doesNotMatch(generated.tex, /\\SourceExcerpt\{[^}]*\\par/);
  assert.match(generated.tex, /这里有 \$x_i\$/);
});

test('emits translation and custom type declarations without altering legacy LaTeX bodies', () => {
  const source = String.raw`\documentclass{article}
\begin{document}\PaperNoteBegin{body:types}Text.\PaperNoteEnd{body:types}\end{document}`;
  const data = createEmptyData();
  const customId = '11111111-1111-4111-8111-111111111111';
  data.customTypes.push({
    id: customId,
    name: 'Key idea ! @ | "',
    color: '#FFE66D',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  });
  data.notes.push({
    id: 'body:types', documentId: 'main', sourceFile: 'main.tex', title: 'Types', sectionTitle: 'Body',
    sourceSnapshot: 'Text.', sourceHash: hashText('Text.'),
    sourceSelector: { exact: 'Text.', prefix: '', suffix: '', normalizedHash: hashText('Text.'), previousOffset: 0 },
    excerptMode: 'auto', excerpt: 'Text.',
    items: [
      { id: 'translation', type: 'translation', format: 'markdown', content: '手工译文。' },
      { id: 'custom', type: 'custom', customTypeId: customId, format: 'latex-legacy', content: String.raw`\begin{quote}Keep \alpha exactly.\end{quote}` }
    ],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  const generated = synchronizeAndGenerate(data, source);
  assert.match(generated.tex, /\\DeclarePaperNoteCustomType\{11111111-1111-4111-8111-111111111111\}/);
  assert.match(generated.tex, /\\NoteItem\{translation\}/);
  assert.match(generated.tex, /\\CustomNoteItem\{11111111-1111-4111-8111-111111111111\}/);
  assert.match(generated.tex, /\\begin\{quote\}Keep \\alpha exactly\.\\end\{quote\}/);
});
