import assert from 'node:assert/strict';
import test from 'node:test';

import { computeNextState, diffState, getDefaultState, sanitizeStoredState } from '../state_core.js';

test('sanitizeStoredState uses safe defaults', () => {
  const state = sanitizeStoredState({});
  assert.equal(state.intentGateEnabled, true);
  assert.equal(state.isInFlow, false);
  assert.ok(Array.isArray(state.distractingSites));
  assert.ok(state.distractingSites.includes('facebook.com'));
});

test('sanitizeStoredState normalizes distractingSites URLs to hostnames', () => {
  const state = sanitizeStoredState({
    distractingSites: ['https://WWW.FACEBOOK.COM/some/path?x=1', 'facebook.com', 'www.facebook.com']
  });
  assert.deepEqual(state.distractingSites, ['facebook.com']);
});

test('diffState ignores array reference differences when values are equal', () => {
  const prev = { ...getDefaultState(), distractingSites: ['facebook.com'] };
  const next = { ...getDefaultState(), distractingSites: ['facebook.com'] };
  assert.deepEqual(diffState(prev, next), {});
});

test('computeNextState clears timer when exiting flow', () => {
  const current = {
    ...getDefaultState(),
    isInFlow: true,
    currentTask: 'Test task',
    breakReminderEnabled: true,
    reminderStartTime: Date.now(),
    reminderInterval: 1000,
    reminderExpectedEndTime: Date.now() + 1000
  };

  const next = computeNextState(current, { isInFlow: false });
  assert.equal(next.isInFlow, false);
  assert.equal(next.breakReminderEnabled, false);
  assert.equal(next.reminderStartTime, null);
  assert.equal(next.reminderInterval, null);
  assert.equal(next.reminderExpectedEndTime, null);
});

test('computeNextState enforces: isInFlow requires a task', () => {
  const current = getDefaultState();
  const next = computeNextState(current, { isInFlow: true, currentTask: '' });
  assert.equal(next.isInFlow, false);
});
