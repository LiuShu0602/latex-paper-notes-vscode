import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { synchronizeAndGenerate } from '../src/generator.js';
import {
  renderNotesStylePackage,
  renderPaperIntegrationPackage
} from '../src/initializer.js';
import { assertValidData, type PaperNotesData } from '../src/model.js';

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const dataPath = resolve(root, 'example', 'notes', 'paper-notes.json');
  const data = JSON.parse(await readFile(dataPath, 'utf8')) as PaperNotesData;
  assertValidData(data);
  const sources = new Map<string, string>();
  for (const sourceFile of data.project.sourceFiles) {
    sources.set(sourceFile, await readFile(resolve(root, 'example', ...sourceFile.split('/')), 'utf8'));
  }
  const generated = synchronizeAndGenerate(data, sources);
  await writeFile(dataPath, generated.json, 'utf8');
  await writeFile(resolve(root, 'example', ...data.project.generatedNotesFile.split('/')), generated.tex, 'utf8');
  await writeFile(
    resolve(root, 'example', data.project.notesDir, 'paper-notes-style.sty'),
    renderNotesStylePackage(data.project.notesDir),
    'utf8'
  );
  await writeFile(
    resolve(root, 'example', data.project.notesDir, 'paper-notes-paper.sty'),
    renderPaperIntegrationPackage(data.project),
    'utf8'
  );
}

void main();
