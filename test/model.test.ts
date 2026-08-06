import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertValidData,
  createCustomNoteType,
  createEmptyData,
  hashText,
  migratePaperNotesData,
  updateCustomNoteType
} from '../src/model.js';

test('migrates schema 1 note data to schema 4 source selectors and source files', () => {
  const legacy = {
    schemaVersion: 1,
    project: {
      mainFile: 'main.tex',
      annotatedPdf: 'notes/main.pdf',
      generatedNotesFile: 'notes/main_notes.tex'
    },
    notes: [{
      id: 'intro:sample',
      documentId: 'main',
      title: 'Sample',
      sectionTitle: 'Introduction',
      sourceSnapshot: 'Selected source.',
      sourceHash: hashText('Selected source.'),
      excerptMode: 'auto',
      excerpt: 'Selected source.',
      items: [],
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z'
    }]
  };
  const migrated = migratePaperNotesData(legacy);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.data.schemaVersion, 4);
  assert.deepEqual(migrated.data.customTypes, []);
  assert.equal(migrated.data.project.rootFile, 'main.tex');
  assert.equal(migrated.data.project.build.mode, 'legacy-script');
  assert.equal(migrated.data.notes[0]?.sourceFile, 'main.tex');
  assert.equal(migrated.data.notes[0]?.sourceSelector.exact, 'Selected source.');
  assert.equal(migrated.data.notes[0]?.sourceSelector.previousOffset, 0);
});

test('migrates schema 3 without changing note IDs, timestamps, or content', () => {
  const current = createEmptyData();
  const schema3 = {
    ...current,
    schemaVersion: 3,
    notes: [{
      id: 'intro:stable', documentId: 'main', sourceFile: 'main.tex', title: 'Stable', sectionTitle: 'Intro',
      sourceSnapshot: 'Text.', sourceHash: hashText('Text.'),
      sourceSelector: { exact: 'Text.', prefix: '', suffix: '', normalizedHash: hashText('Text.'), previousOffset: 12 },
      excerptMode: 'auto', excerpt: 'Text.',
      items: [{ id: 'item-1', type: 'question', format: 'markdown', content: 'Why?' }],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'
    }]
  };
  delete (schema3 as { customTypes?: unknown }).customTypes;
  const result = migratePaperNotesData(schema3);
  assert.equal(result.data.schemaVersion, 4);
  assert.equal(result.data.notes[0]?.id, 'intro:stable');
  assert.equal(result.data.notes[0]?.items[0]?.content, 'Why?');
  assert.equal(result.data.notes[0]?.createdAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(result.data.customTypes, []);
});

test('normalizes custom types and rejects duplicate names or dangling references', () => {
  const data = createEmptyData();
  const first = createCustomNoteType(data.customTypes, '  Definition  ', '#abc', '2026-01-01T00:00:00.000Z', '11111111-1111-4111-8111-111111111111');
  assert.equal(first.name, 'Definition');
  assert.equal(first.color, '#AABBCC');
  data.customTypes.push(first);
  assert.throws(
    () => createCustomNoteType(data.customTypes, 'definition', '#112233'),
    /already exists/i
  );
  const updated = updateCustomNoteType(data.customTypes, first.id, 'Key idea', '#123456', '2026-02-01T00:00:00.000Z');
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.updatedAt, '2026-02-01T00:00:00.000Z');
  data.customTypes[0] = updated;
  assertValidData(data);

  const invalid = structuredClone(data);
  invalid.notes.push({
    id: 'intro:dangling', documentId: 'main', sourceFile: 'main.tex', title: 'Dangling', sectionTitle: 'Intro',
    sourceSnapshot: '', sourceHash: hashText(''),
    sourceSelector: { exact: '', prefix: '', suffix: '', normalizedHash: hashText(''), previousOffset: 0 },
    excerptMode: 'auto', excerpt: '',
    items: [{ id: 'item', type: 'custom', customTypeId: '22222222-2222-4222-8222-222222222222', format: 'markdown', content: '' }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.throws(() => assertValidData(invalid), /no longer exists/i);
});
