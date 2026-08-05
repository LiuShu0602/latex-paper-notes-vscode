import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyInitializationPlan, planInitialization } from '../src/initializer.js';
import { createNoteItem, hashText, type PaperNote } from '../src/model.js';
import { scanMarkers, latexToPlainText, nearestSectionTitle } from '../src/markers.js';
import { discoverSourceGraph } from '../src/project.js';
import { buildSourceSelector } from '../src/source-selector.js';
import { defaultStorePaths, PaperNotesStore } from '../src/store.js';

async function main(): Promise<void> {
const root = resolve('example');
await mkdir(resolve(root, 'sections'), { recursive: true });
await mkdir(resolve(root, 'notes', 'assets'), { recursive: true });
await writeFile(resolve(root, 'main.tex'), String.raw`% !TeX program = pdflatex
\documentclass[11pt]{article}
\usepackage[a4paper,margin=28mm]{geometry}
\usepackage{amsmath}
\title{A Synthetic Paper on Temperature Sensor Calibration}
\author{Example Author}
\begin{document}
\maketitle
\input{sections/introduction}
\input{sections/method}
\end{document}
`, 'utf8');
await writeFile(resolve(root, 'sections', 'introduction.tex'), String.raw`\section{Introduction}
This fictional paper compares readings from two hypothetical temperature sensors under a simple offset calibration.
`, 'utf8');
await writeFile(resolve(root, 'sections', 'method.tex'), String.raw`\section{Method}
Let $r$ and $c$ denote the raw and calibrated temperature readings.

\PaperNoteBegin{method:offset-correction}Subtracting a fixed offset corrects the reading while preserving the order of observations.\PaperNoteEnd{method:offset-correction}

For example, the calibration rule $c=r-2$ lowers every raw reading by two degrees.
`, 'utf8');
await writeFile(resolve(root, 'notes', 'assets', 'concept-map.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220"><rect width="640" height="220" rx="18" fill="#f4f7fb"/><path d="M190 110h260" stroke="#2367b1" stroke-width="4"/><path d="m430 94 24 16-24 16" fill="none" stroke="#2367b1" stroke-width="4"/><rect x="45" y="62" width="145" height="96" rx="12" fill="#fff" stroke="#607d8b"/><rect x="450" y="62" width="145" height="96" rx="12" fill="#fff" stroke="#607d8b"/><text x="117" y="118" text-anchor="middle" font-family="Georgia" font-size="22" fill="#18324b">raw reading</text><text x="522" y="118" text-anchor="middle" font-family="Georgia" font-size="20" fill="#18324b">calibrated</text></svg>`, 'utf8');

const graph = await discoverSourceGraph(root, 'main.tex');
const plan = await planInitialization(root, {
  rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
});
await applyInitializationPlan(root, plan);

const store = new PaperNotesStore(root, defaultStorePaths());
await store.initialize();
const sourceFile = 'sections/method.tex';
const source = await import('node:fs/promises').then((fs) => fs.readFile(resolve(root, sourceFile), 'utf8'));
const marker = scanMarkers(source).ranges[0];
if (!marker) {
  throw new Error('Synthetic example marker is missing.');
}
const selected = source.slice(marker.contentStart, marker.contentEnd);
const now = '2026-08-05T00:00:00.000Z';
const note: PaperNote = {
  id: marker.id,
  documentId: 'main',
  sourceFile,
  title: 'Why an offset preserves ordering',
  sectionTitle: nearestSectionTitle(source, marker.beginStart),
  sourceSnapshot: selected,
  sourceHash: hashText(selected),
  sourceSelector: buildSourceSelector(source, marker.contentStart, marker.contentEnd, marker.beginStart, marker.endEnd),
  excerptMode: 'auto',
  excerpt: latexToPlainText(selected),
  items: [
    { ...createNoteItem('thought', 'The sentence distinguishes numerical correction from changes in measurement order.'), id: 'example-thought' },
    { ...createNoteItem('example', 'If $r_1<r_2$, then $r_1-2<r_2-2$.'), id: 'example-example' },
    { ...createNoteItem('todo', 'Add the assumed temperature unit.'), id: 'example-todo' }
  ],
  createdAt: now,
  updatedAt: now,
  revision: 0
};
await store.addNote(note);
await store.dispose();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
