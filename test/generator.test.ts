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
