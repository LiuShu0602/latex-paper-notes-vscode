import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEmptyData } from '../src/model.js';
import { PROJECT_STYLE_VERSION } from '../src/initializer.js';
import {
  inspectProjectStyle,
  renderStockNotesStyleV03,
  upgradeProjectStyle,
  verifyEmbeddedTemplateHash
} from '../src/style-upgrade.js';

test('backs up and atomically upgrades an unmodified v0.3 style', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-style-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'notes'), { recursive: true });
  await writeFile(join(root, 'notes', 'paper-notes-style.sty'), renderStockNotesStyleV03(), 'utf8');
  const project = createEmptyData().project;
  const before = await inspectProjectStyle(root, project);
  assert.equal(before.kind, 'stock-old');
  const result = await upgradeProjectStyle(root, project);
  assert.equal(result.upgraded, true);
  assert.equal(result.status.installedVersion, PROJECT_STYLE_VERSION);
  const upgraded = await readFile(join(root, 'notes', 'paper-notes-style.sty'), 'utf8');
  assert.equal(verifyEmbeddedTemplateHash(upgraded), true);
  assert.equal(
    await readFile(join(root, 'notes', 'legacy', 'paper-notes-style.v0.3.2.bak.sty'), 'utf8'),
    renderStockNotesStyleV03()
  );
});

test('does not overwrite a locally modified old style without explicit force', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-style-custom-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'notes'), { recursive: true });
  const custom = `${renderStockNotesStyleV03()}% local customization\n`;
  await writeFile(join(root, 'notes', 'paper-notes-style.sty'), custom, 'utf8');
  const project = createEmptyData().project;
  const status = await inspectProjectStyle(root, project);
  assert.equal(status.kind, 'modified-old');
  const result = await upgradeProjectStyle(root, project);
  assert.equal(result.upgraded, false);
  assert.equal(await readFile(join(root, 'notes', 'paper-notes-style.sty'), 'utf8'), custom);
});
