import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * NOTE: Some browsers (notably Opera) disallow dynamic `import()` inside MV3 service workers.
 * To prevent regressions, keep service-worker modules free of dynamic import usage.
 */

const SERVICE_WORKER_MODULES = [
  'actions.js',
  'background.js',
  'background_breakReminder.js',
  'background_clipmd.js',
  'background_contextMenus.js',
  'background_intentGate.js',
  'background_mindfulnessReminder.js',
  'background_omnibox.js',
  'background_state.js',
  'constants.js',
  'distraction_matcher.js',
  'intent_gate_helpers.js',
  'messaging.js',
  'state_contract.js',
  'state_core.js'
];

/**
 * Best-effort comment stripper to reduce false positives from docs/comments.
 * @param {string} source - JS source
 * @returns {string}
 */
function stripJsComments(source) {
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

test('MV3 service worker modules must not use dynamic import()', () => {
  const repoRoot = process.cwd();

  for (const filename of SERVICE_WORKER_MODULES) {
    const fullPath = path.resolve(repoRoot, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const stripped = stripJsComments(raw);

    assert.ok(!/\bimport\s*\(/.test(stripped), `${filename} must not contain dynamic import()`);
  }
});
