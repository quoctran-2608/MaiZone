import assert from 'node:assert/strict';
import test from 'node:test';

import * as constants from '../constants.js';

test('constants.js exports required ClipMD constants', () => {
  assert.equal(typeof constants.CLIPMD_POPUP_PORT_NAME, 'string');
  assert.ok(constants.CLIPMD_POPUP_PORT_NAME.length > 0);
});

