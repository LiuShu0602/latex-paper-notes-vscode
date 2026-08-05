import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyInitializationPlan, planInitialization, INTEGRATION_BEGIN } from '../src/initializer.js';
import { discoverSourceGraph } from '../src/project.js';

test('initialization previews and applies an idempotent removable integration', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-init-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clean = '\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n';
  await writeFile(join(root, 'main.tex'), clean, 'utf8');
  const graph = await discoverSourceGraph(root, 'main.tex');
  const plan = await planInitialization(root, {
    rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
  });
  assert.ok(plan.changes.some((change) => change.path === 'notes/paper-notes.json' && change.action === 'create'));
  await applyInitializationPlan(root, plan);
  const integrated = await readFile(join(root, 'main.tex'), 'utf8');
  assert.match(integrated, new RegExp(INTEGRATION_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(integrated, /\\IfFileExists\{notes\/paper-notes-paper\.sty\}/);
  assert.equal(await readFile(join(root, 'main.tex.paper-notes.bak'), 'utf8'), clean);

  const second = await planInitialization(root, {
    rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
  });
  assert.ok(second.changes.every((change) => change.action === 'unchanged'));
});

test('initialization refuses a file changed after preview without touching later files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-init-race-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n\\begin{document}x\\end{document}\n', 'utf8');
  const graph = await discoverSourceGraph(root, 'main.tex');
  const plan = await planInitialization(root, {
    rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
  });
  await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n% user edit\n\\begin{document}x\\end{document}\n', 'utf8');
  await assert.rejects(() => applyInitializationPlan(root, plan), /changed after the initialization preview/);
  await assert.rejects(() => readFile(join(root, 'notes', 'paper-notes.json'), 'utf8'));
  await assert.rejects(() => readFile(join(root, 'main.tex.paper-notes.bak'), 'utf8'));
});
