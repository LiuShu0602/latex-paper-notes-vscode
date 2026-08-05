import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSyncTeXEditArgs,
  buildSyncTeXViewArgs,
  decodeSyncTeXOutput,
  parseSyncTeXForward,
  parseSyncTeXReverse
} from '../src/synctex.js';

test('decodes GBK output emitted by SyncTeX on Windows', () => {
  const bytes = Buffer.concat([
    Buffer.from('Input:D:/', 'ascii'),
    Buffer.from([0xd1, 0xd0, 0xbe, 0xbf]),
    Buffer.from('/synthetic-paper/main.tex\r\n', 'ascii')
  ]);
  const decoded = decodeSyncTeXOutput(bytes);
  if (process.platform === 'win32') {
    assert.equal(decoded, 'Input:D:/研究/synthetic-paper/main.tex\r\n');
  }
});

test('builds shell-free SyncTeX arguments for a Chinese Windows path', () => {
  const source = 'D:\\研究\\synthetic-paper\\main.tex';
  const pdf = 'D:\\研究\\synthetic-paper\\notes\\paper_annotated.pdf';
  assert.deepEqual(buildSyncTeXViewArgs(source, 148, 3, pdf), [
    'view', '-i', `148:3:${source}`, '-o', pdf
  ]);
  assert.deepEqual(buildSyncTeXEditArgs(pdf, 1, 48.9, 699.7), [
    'edit', '-o', `1:48.900:699.700:${pdf}`
  ]);
});

test('parses a SyncTeX forward result', () => {
  const output = `SyncTeX result begin\nOutput:main_annotated.pdf\nPage:3\nx:121.5\ny:210\nh:118.2\nv:202.4\nW:174.8\nH:12.6\nSyncTeX result end\n`;
  assert.deepEqual(parseSyncTeXForward(output), {
    page: 3,
    x: 118.2,
    y: 202.4,
    width: 174.8,
    height: 12.6
  });
});

test('parses a SyncTeX reverse result with a Chinese Windows path', () => {
  const output = `SyncTeX result begin\nOutput:paper_annotated.pdf\nInput:D:\\研究\\synthetic-paper\\main.tex\nLine:149\nColumn:7\nSyncTeX result end\n`;
  assert.deepEqual(parseSyncTeXReverse(output), {
    input: 'D:\\研究\\synthetic-paper\\main.tex',
    line: 149,
    column: 7
  });
});
