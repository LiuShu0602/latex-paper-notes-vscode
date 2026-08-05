import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  legalComments: 'eof',
  sourcemap: true,
  logLevel: 'info',
  target: 'es2022'
};

const builds = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  },
  {
    ...shared,
    entryPoints: ['test/integration/suite.ts'],
    outfile: 'dist/integration-suite.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  },
  {
    ...shared,
    entryPoints: ['src/cli.ts'],
    outfile: 'dist/cli.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode']
  },
  {
    ...shared,
    entryPoints: ['src/webview/index.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    loader: {
      '.gif': 'dataurl',
      '.png': 'dataurl',
      '.svg': 'dataurl',
      '.woff2': 'file',
      '.woff': 'file',
      '.ttf': 'file'
    },
    assetNames: 'fonts/[name]-[hash]'
  }
];

await mkdir('dist', { recursive: true });

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching extension and webview sources...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  const workerSource = resolve('node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
  const workerTarget = resolve('dist/pdf.worker.min.mjs');
  await mkdir(dirname(workerTarget), { recursive: true });
  await copyFile(workerSource, workerTarget);
}
