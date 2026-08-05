import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  discoverSourceGraph,
  extractTexRootDirective,
  parseFlsInputs,
  parseLatexDependencies,
  resolveInsideProject
} from '../src/project.js';

test('discovers recursive LaTeX sources, ignores comments/verbatim, and reports cycles', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-graph-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'sections'), { recursive: true });
  await writeFile(join(root, 'main.tex'), String.raw`\documentclass{article}
% \input{ignored}
\begin{document}
\input{sections/intro}
\begin{verbatim}
\input{also-ignored}
\end{verbatim}
\end{document}`, 'utf8');
  await writeFile(join(root, 'sections', 'intro.tex'), String.raw`Intro. \subfile{details}`, 'utf8');
  await writeFile(join(root, 'sections', 'details.tex'), String.raw`Details. \input{../main}`, 'utf8');

  const graph = await discoverSourceGraph(root, 'main.tex');
  assert.deepEqual(graph.sourceFiles, ['main.tex', 'sections/intro.tex', 'sections/details.tex']);
  assert.ok(graph.diagnostics.some((item) => item.kind === 'cycle'));
  assert.ok(!graph.diagnostics.some((item) => item.target?.includes('ignored')));
});

test('parses import commands and flags macro paths as dynamic', () => {
  const dependencies = parseLatexDependencies(String.raw`
\import{chapters/}{one}
\subimport{appendix/}{two.tex}
\input{\chaptername}
\InputIfFileExists{optional}{yes}{no}`, 'main.tex');
  assert.equal(dependencies[0]?.path, 'chapters/one.tex');
  assert.equal(dependencies[1]?.path, 'appendix/two.tex');
  assert.equal(dependencies[2]?.dynamic, true);
  assert.equal(dependencies[3]?.path, 'optional.tex');
});

test('rejects outside paths and keeps .fls inputs inside the project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-notes-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => resolveInsideProject(root, '../outside.tex', true), /inside the project/i);
  const fls = `INPUT ${join(root, 'main.tex')}\nINPUT ${join(root, 'sections', 'a.tex')}\nINPUT C:\\texlive\\texmf-dist\\tex\\latex\\base\\article.cls\n`;
  assert.deepEqual(parseFlsInputs(fls, root), ['main.tex', 'sections/a.tex']);
});

test('extracts a TeX root directive', () => {
  assert.equal(extractTexRootDirective('% !TeX root = ../main.tex\nText'), '../main.tex');
});
