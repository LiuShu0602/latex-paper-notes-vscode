import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { DebouncedAction } from '../src/debounce.js';

test('coalesces rapid PDF reload notifications', async () => {
  let runs = 0;
  const action = new DebouncedAction(20, () => {
    runs += 1;
  });

  action.schedule();
  action.schedule();
  action.schedule();
  await wait(45);

  assert.equal(runs, 1);
  action.dispose();
});

test('cancels a pending PDF reload when disposed', async () => {
  let runs = 0;
  const action = new DebouncedAction(20, () => {
    runs += 1;
  });

  action.schedule();
  action.dispose();
  await wait(35);

  assert.equal(runs, 0);
});
