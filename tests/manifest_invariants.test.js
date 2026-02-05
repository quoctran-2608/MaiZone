import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('manifest invariants (MV3 + content script order)', () => {
  const manifestPath = path.resolve(process.cwd(), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(manifest.background?.type, 'module');
  assert.equal(manifest.omnibox?.keyword, 'mai', 'omnibox keyword must be "mai"');

  const contentScripts = manifest.content_scripts;
  assert.ok(Array.isArray(contentScripts) && contentScripts.length >= 1, 'content_scripts must exist');

  const contentEntry = contentScripts.find((entry) => Array.isArray(entry?.js) && entry.js.includes('content.js'));
  assert.ok(contentEntry, 'content_scripts entry must include content.js');

  assert.deepEqual(
    contentEntry.js,
    ['actions_global.js', 'content.js'],
    'content script order must be stable (actions_global.js before content.js)'
  );

  assert.deepEqual(
    contentEntry.matches,
    ['http://*/*', 'https://*/*'],
    'content matches must be http/https only'
  );
});
