/**
 * MaiZone Browser Extension
 * State Helpers: Safe get/update state with fallbacks
 * @feature f05 - State Management
 */

import { sendMessageSafely } from './messaging.js';
import { messageActions } from './actions.js';
import { computeNextState, diffState, sanitizeStoredState } from './state_core.js';
import { UI_ALLOWED_UPDATE_KEYS } from './state_contract.js';

const UI_ALLOWED_UPDATE_KEYS_SET = new Set(UI_ALLOWED_UPDATE_KEYS);

/***** GET STATE *****/

/**
 * Lấy state an toàn (ưu tiên background, fallback qua chrome.storage.local).
 * @param {string|Array<string>|null} keyOrKeys - Key, list keys, hoặc null để lấy toàn bộ
 * @returns {Promise<Object>} Object state tương ứng (partial hoặc full)
 */
export async function getStateSafely(keyOrKeys = null) {
  const request = { action: messageActions.getState };
  if (Array.isArray(keyOrKeys)) request.keys = keyOrKeys;
  else if (typeof keyOrKeys === 'string') request.key = keyOrKeys;

  const state = await sendMessageSafely(request);
  if (state) return state;

  const storedState = await new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });

  const sanitized = sanitizeStoredState(storedState);

  if (Array.isArray(keyOrKeys)) {
    const subset = {};
    keyOrKeys.forEach((k) => {
      subset[k] = sanitized[k];
    });
    return subset;
  }

  if (typeof keyOrKeys === 'string') {
    return { [keyOrKeys]: sanitized[keyOrKeys] };
  }

  return sanitized;
}

/***** UPDATE STATE *****/

/**
 * Cập nhật state an toàn (ưu tiên background, fallback qua chrome.storage.local).
 * @param {Object} payload - Partial state update
 * @returns {Promise<boolean>} True nếu cập nhật thành công (kể cả qua fallback)
 */
export async function updateStateSafely(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const filteredPayload = {};
  Object.keys(payload).forEach((key) => {
    if (!UI_ALLOWED_UPDATE_KEYS_SET.has(key)) return;
    filteredPayload[key] = payload[key];
  });

  if (!Object.keys(filteredPayload).length) return false;

  const response = await sendMessageSafely(
    { action: messageActions.updateState, payload: filteredPayload },
    { timeoutMs: 6000 }
  );

  // Background replied: do NOT fall back to storage write (avoid drift).
  if (response !== null) return !!response?.success;

  const storedState = await new Promise((resolve) => {
    chrome.storage.local.get(null, (data) => resolve(data || {}));
  });

  const currentState = sanitizeStoredState(storedState);
  const nextState = computeNextState(currentState, filteredPayload);
  const delta = diffState(currentState, nextState);

  if (!Object.keys(delta).length) return true;

  await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));
  return true;
}
