import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyInitializationPlan, planInitialization } from '../src/initializer.js';
import { discoverSourceGraph } from '../src/project.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-pixel-'));
  try {
    const source = String.raw`\documentclass[11pt]{article}
\usepackage[a4paper,margin=28mm]{geometry}
\begin{document}
\section{Synthetic baseline}
The clean paper must have exactly the same visible pixels before and after initialization.
\end{document}
`;
    await writeFile(join(root, 'main.tex'), source, 'utf8');
    await compile(root, 'before');
    const graph = await discoverSourceGraph(root, 'main.tex');
    const plan = await planInitialization(root, {
      rootFile: 'main.tex', sourceGraph: graph, paperEngine: 'pdflatex', notesEngine: 'xelatex'
    });
    await applyInitializationPlan(root, plan);
    await compile(root, 'after');
    await rm(join(root, 'notes'), { recursive: true, force: true });
    await compile(root, 'without-notes');

    for (const name of ['before', 'after', 'without-notes']) {
      run('pdftoppm', [
        '-png', '-singlefile', '-r', '144',
        join(root, name, 'main.pdf'), join(root, name, 'page')
      ], root);
    }
    const before = await readFile(join(root, 'before', 'page.png'));
    assert.deepEqual(await readFile(join(root, 'after', 'page.png')), before,
      'The initialized clean paper changed visible pixels.');
    assert.deepEqual(await readFile(join(root, 'without-notes', 'page.png')), before,
      'Deleting notes/ changed visible pixels or broke the clean-paper fallback.');
    console.log('Clean-paper pixel identity passed before initialization, after initialization, and after deleting notes/.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function compile(root: string, outputName: string): Promise<void> {
  const output = join(root, outputName);
  await mkdir(output, { recursive: true });
  for (let pass = 1; pass <= 3; pass += 1) {
    run('pdflatex', [
      '-interaction=nonstopmode', '-file-line-error', '-halt-on-error', '-recorder',
      `-output-directory=${output}`, 'main.tex'
    ], root);
  }
}

function run(executable: string, args: string[], cwd: string): void {
  const result = spawnSync(executable, args, { cwd, windowsHide: true, shell: false, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
