import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyInitializationPlan, planInitialization } from '../src/initializer.js';
import { createEmptyData, hashText, type PaperNote } from '../src/model.js';
import { scanMarkers } from '../src/markers.js';
import { discoverSourceGraph } from '../src/project.js';
import { buildSourceSelector } from '../src/source-selector.js';
import { defaultStorePaths, PaperNotesStore } from '../src/store.js';

test('serializes note writes, rejects stale revisions, and retains last-good files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = '\\documentclass{article}\n\\begin{document}\\PaperNoteBegin{body:sample}Selected text.\\PaperNoteEnd{body:sample}\\end{document}\n';
  await writeFile(join(root, 'main.tex'), source, 'utf8');
  const graph = await discoverSourceGraph(root, 'main.tex');
  await applyInitializationPlan(root, await planInitialization(root, {
    rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
  }));
  const store = new PaperNotesStore(root, defaultStorePaths());
  await store.initialize();
  const managed = await readFile(join(root, 'main.tex'), 'utf8');
  const marker = scanMarkers(managed).ranges[0]!;
  const selected = managed.slice(marker.contentStart, marker.contentEnd);
  const note: PaperNote = {
    id: marker.id, documentId: 'main', sourceFile: 'main.tex', title: 'Sample', sectionTitle: 'Main Paper',
    sourceSnapshot: selected, sourceHash: hashText(selected),
    sourceSelector: buildSourceSelector(managed, marker.contentStart, marker.contentEnd),
    excerptMode: 'auto', excerpt: selected,
    items: [{ id: 'item', type: 'thought', format: 'markdown', content: 'first' }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 0
  };
  await store.addNote(note);
  const current = structuredClone(store.data.notes[0]!);
  current.revision = 1;
  current.items[0]!.content = 'newest';
  await store.updateNote(current);
  const stale = structuredClone(current);
  stale.revision = 0;
  stale.items[0]!.content = 'stale';
  await assert.rejects(() => store.updateNote(stale), /stale save/i);
  assert.equal(store.data.notes[0]?.items[0]?.content, 'newest');
  assert.equal(JSON.parse(await readFile(join(root, 'notes', 'paper-notes.json'), 'utf8')).notes[0].items[0].content, 'newest');
  assert.ok((await readFile(join(root, 'notes', 'paper-notes.json.last-good'), 'utf8')).includes('first'));
  const customTypeId = '11111111-1111-4111-8111-111111111111';
  await store.addCustomType({
    id: customTypeId, name: 'Definition', color: '#6A67CE',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  });
  const customNote = structuredClone(store.data.notes[0]!);
  customNote.items[0]!.type = 'custom';
  customNote.items[0]!.customTypeId = customTypeId;
  await store.updateNote(customNote);
  await assert.rejects(() => store.deleteCustomType(customTypeId), /choose a replacement/i);
  await store.deleteCustomType(customTypeId, { type: 'translation' });
  assert.equal(store.data.customTypes.length, 0);
  assert.equal(store.data.notes[0]?.items[0]?.type, 'translation');
  assert.equal(store.data.notes[0]?.items[0]?.customTypeId, undefined);
  await store.dispose();
});

test('backs up schema 3 data with a schema-numbered filename before v4 migration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-schema3-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}x\\end{document}\n', 'utf8');
  const current = createEmptyData();
  const legacy = { ...current, schemaVersion: 3 } as Record<string, unknown>;
  delete legacy.customTypes;
  await (await import('node:fs/promises')).mkdir(join(root, 'notes'), { recursive: true });
  const raw = `${JSON.stringify(legacy, null, 2)}\n`;
  await writeFile(join(root, 'notes', 'paper-notes.json'), raw, 'utf8');
  const store = new PaperNotesStore(root, defaultStorePaths());
  const initialized = await store.initialize();
  assert.equal(initialized.migrated, true);
  assert.equal(initialized.notes.schemaVersion, 4);
  assert.equal(await readFile(join(root, 'notes', 'legacy', 'paper-notes.schema3.bak.json'), 'utf8'), raw);
  await store.dispose();
});
