import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBuild } from '../src/build-policy.js';

test('panel builds do not request a flush from their own serial message queue', async () => {
  const calls: string[] = [];
  await prepareBuild('panel', {
    flushPanel: async () => { throw new Error('self-deadlock'); },
    saveWorkspace: async () => { calls.push('workspace'); },
    saveStore: async () => { calls.push('store'); }
  });
  assert.deepEqual(calls, ['workspace', 'store']);
});

test('command builds flush Webview edits before saving and building', async () => {
  const calls: string[] = [];
  await prepareBuild('command', {
    flushPanel: async () => { calls.push('flush'); },
    saveWorkspace: async () => { calls.push('workspace'); },
    saveStore: async () => { calls.push('store'); }
  });
  assert.deepEqual(calls, ['flush', 'workspace', 'store']);
});
