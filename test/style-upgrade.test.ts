import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createEmptyData, hashText } from '../src/model.js';
import { PROJECT_STYLE_VERSION, renderNotesStylePackage } from '../src/initializer.js';
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

test('recognizes and upgrades an untouched v0.4 beta style', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-style-beta-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'notes'), { recursive: true });

  const betaWithPlaceholder = renderNotesStylePackage()
    .replace('project-style-version: 0.4.0', 'project-style-version: 0.4.0-beta.1')
    .replace('v0.4.0 Companion paper notes', 'v0.4.0-beta.1 Companion paper notes')
    .replace(/template-sha256: [a-f0-9]{64}/i, 'template-sha256: __PAPER_NOTES_TEMPLATE_HASH__');
  const beta = betaWithPlaceholder.replace(
    '__PAPER_NOTES_TEMPLATE_HASH__',
    hashText(betaWithPlaceholder.replace(/\r\n?/g, '\n')),
  );
  await writeFile(join(root, 'notes', 'paper-notes-style.sty'), beta, 'utf8');

  const project = createEmptyData().project;
  const before = await inspectProjectStyle(root, project);
  assert.equal(before.kind, 'stock-old');
  assert.equal(before.installedVersion, '0.4.0-beta.1');

  const result = await upgradeProjectStyle(root, project);
  assert.equal(result.upgraded, true);
  assert.equal(result.status.installedVersion, PROJECT_STYLE_VERSION);
  assert.equal(
    await readFile(join(root, 'notes', 'legacy', 'paper-notes-style.v0.4.0-beta.1.bak.sty'), 'utf8'),
    beta,
  );
});
