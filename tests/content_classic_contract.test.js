import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('content.js must stay classic (no top-level import/export)', () => {
  const contentPath = path.resolve(process.cwd(), 'content.js');
  const text = fs.readFileSync(contentPath, 'utf8');

  // Keep this conservative: we only look for actual statements at line start.
  // Also ignore obvious comment lines.
  const importStmt = /^[ \t]*(?!\/\/)(?!\/\*)(?!\*)import\s+[\w*{]/m;
  const exportStmt = /^[ \t]*(?!\/\/)(?!\/\*)(?!\*)export\s+[\w{]/m;

  assert.equal(importStmt.test(text), false, 'content.js must not have top-level import');
  assert.equal(exportStmt.test(text), false, 'content.js must not have top-level export');
});

