import assert from 'node:assert/strict';
import test from 'node:test';

import { messageActions } from '../actions.js';
import '../actions_global.js';

test('actions.js and actions_global.js stay aligned', () => {
  const globalActions = globalThis.MAIZONE_ACTIONS;
  assert.ok(globalActions && typeof globalActions === 'object');

  assert.deepEqual(globalActions, messageActions);
});

