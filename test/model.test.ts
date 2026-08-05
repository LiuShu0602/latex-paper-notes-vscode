import assert from 'node:assert/strict';
import test from 'node:test';
import { hashText, migratePaperNotesData } from '../src/model.js';

test('migrates schema 1 note data to schema 3 source selectors and source files', () => {
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
  assert.equal(migrated.data.schemaVersion, 3);
  assert.equal(migrated.data.project.rootFile, 'main.tex');
  assert.equal(migrated.data.project.build.mode, 'legacy-script');
  assert.equal(migrated.data.notes[0]?.sourceFile, 'main.tex');
  assert.equal(migrated.data.notes[0]?.sourceSelector.exact, 'Selected source.');
  assert.equal(migrated.data.notes[0]?.sourceSelector.previousOffset, 0);
});
