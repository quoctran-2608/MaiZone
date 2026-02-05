/**
 * MaiZone Browser Extension
 * State Management: Centralized state handling in background
 * @feature f05 - State Management
 */

import { messageActions } from './actions.js';
import { DEFAULT_STATE, computeNextState, diffState, getDefaultState, sanitizeStoredState } from './state_core.js';
import { STATE_KEYS, UI_ALLOWED_UPDATE_KEYS, UNTRUSTED_STATE_KEYS } from './state_contract.js';

const UI_ALLOWED_UPDATE_KEYS_SET = new Set(UI_ALLOWED_UPDATE_KEYS);
const STATE_KEYS_SET = new Set(Object.keys(DEFAULT_STATE));

// Non-state storage keys/prefixes that should not be deleted on init.
const NON_STATE_STORAGE_KEYS = new Set(['intentGateReasonLog']);
const NON_STATE_STORAGE_PREFIXES = ['intentGateTab_', 'intentGatePending_'];

/**
 * Check whether a storage key should be preserved (state or feature storage).
 * @param {string} key - Storage key
 * @returns {boolean}
 */
function isAllowedStorageKey(key) {
  if (STATE_KEYS_SET.has(key)) return true;
  if (NON_STATE_STORAGE_KEYS.has(key)) return true;
  return NON_STATE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// In-memory state snapshot (hydrated lazily for MV3 reliability).
let state = getDefaultState();

// MV3 service worker can wake for events before async init finishes.
let initPromise = null;
let hasInitialized = false;

// Serialize state updates to avoid race conditions (popup + alarms + webNavigation).
let updateChain = Promise.resolve();

/***** INTERNAL SUBSCRIBERS (SERVICE WORKER) *****/

const stateDeltaSubscribers = new Set();

/**
 * Subscribe to state delta updates (internal to the service worker only).
 * @param {Function} fn - Subscriber (nextState, delta)
 * @returns {Function} Unsubscribe function
 */
export function onStateDelta(fn) {
  if (typeof fn !== 'function') return () => {};
  stateDeltaSubscribers.add(fn);
  return () => stateDeltaSubscribers.delete(fn);
}

/**
 * Notify internal subscribers about a state delta.
 * @param {Object} nextState - Next full state (snapshot)
 * @param {Object} delta - Delta object
 * @returns {void}
 */
function notifyStateDeltaSubscribers(nextState, delta) {
  if (!delta || typeof delta !== 'object' || !Object.keys(delta).length) return;

  const snapshot = nextState && typeof nextState === 'object' ? { ...nextState } : getState();
  stateDeltaSubscribers.forEach((fn) => {
    try {
      fn(snapshot, delta);
    } catch (error) {
      console.error('🌸🌸🌸 Error in state subscriber:', error);
    }
  });
}

/***** INITIALIZATION (MV3-SAFE) *****/

let hasRegisteredStorageReconcile = false;

/**
 * Compare two arrays of strings by value.
 * @param {any} a - Array A
 * @param {any} b - Array B
 * @returns {boolean}
 */
function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare state values by value (supports primitives + string arrays).
 * @param {any} a - Value A
 * @param {any} b - Value B
 * @returns {boolean}
 */
function areStateValuesEqual(a, b) {
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray || bIsArray) return areStringArraysEqual(a, b);
  return a === b;
}

/**
 * Create a safe state summary for logs (privacy-first: avoid task/sites details).
 * @param {Object} s - State object
 * @returns {Object}
 */
function summarizeStateForLog(s) {
  const stateObj = s && typeof s === 'object' ? s : state;
  return {
    intentGateEnabled: !!stateObj.intentGateEnabled,
    isInFlow: !!stateObj.isInFlow,
    breakReminderEnabled: !!stateObj.breakReminderEnabled,
    exerciseReminderEnabled: !!stateObj.exerciseReminderEnabled,
    distractingSitesCount: Array.isArray(stateObj.distractingSites) ? stateObj.distractingSites.length : 0,
    deepWorkBlockedSitesCount: Array.isArray(stateObj.deepWorkBlockedSites) ? stateObj.deepWorkBlockedSites.length : 0,
    hasTask: !!(stateObj.currentTask && String(stateObj.currentTask).trim())
  };
}

/**
 * Broadcast a state delta safely (guard Promise support across environments).
 * @param {Object} delta - Partial state delta
 * @returns {void}
 */
function broadcastStateDelta(delta) {
  try {
    const maybePromise = chrome.runtime.sendMessage({
      action: messageActions.stateUpdated,
      delta,
      // Backward compatible field name (deprecated): older listeners used message.state.
      state: delta
    });

    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {
        // Ignore errors from no listeners / SW lifecycle
      });
    }
  } catch (error) {
    // Ignore broadcast errors during invalidation
  }
}

/**
 * Reconcile in-memory state when something else writes to storage.
 * - Prevents drift when UI falls back to storage writes while SW is alive.
 * - Applies sanitize/invariants (via computeNextState) and persists derived deltas back to storage.
 * @returns {void}
 */
function setupStorageReconcileListener() {
  if (hasRegisteredStorageReconcile) return;
  hasRegisteredStorageReconcile = true;

  if (!chrome?.storage?.onChanged) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!hasInitialized) return;
    if (!changes || typeof changes !== 'object') return;

    const rawUpdates = {};
    Object.entries(changes).forEach(([key, change]) => {
      // Only reconcile keys that UI fallback is allowed to write.
      if (!UI_ALLOWED_UPDATE_KEYS_SET.has(key)) return;
      rawUpdates[key] = change?.newValue;
    });

    if (!Object.keys(rawUpdates).length) return;

    // If storage change matches our current in-memory state, skip to avoid queue amplification.
    const matchesCurrentState = Object.entries(rawUpdates).every(([key, value]) => areStateValuesEqual(state[key], value));
    if (matchesCurrentState) return;

    updateChain = updateChain
      .then(async () => {
        // Ensure state is hydrated (extra safe; should already be true if hasInitialized).
        await ensureInitialized();

        const nextState = computeNextState(state, rawUpdates);
        const delta = diffState(state, nextState);
        if (!Object.keys(delta).length) return;

        state = nextState;

        // Persist only derived/canonical differences (avoid rewriting the same rawUpdates again).
        const deltaToPersist = {};
        Object.entries(delta).forEach(([key, value]) => {
          if (!(key in rawUpdates)) {
            deltaToPersist[key] = value;
            return;
          }
          if (!areStateValuesEqual(rawUpdates[key], value)) deltaToPersist[key] = value;
        });

        if (Object.keys(deltaToPersist).length) {
          await new Promise((resolve) => chrome.storage.local.set(deltaToPersist, () => resolve()));
        }

        notifyStateDeltaSubscribers(state, delta);
        broadcastStateDelta(delta);
      })
      .catch((error) => {
        console.error('🌸🌸🌸 Error reconciling storage change:', error);
      });
  });
}

/**
 * Check whether sender is a trusted extension page (popup/options).
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @returns {boolean}
 */
function isTrustedExtensionSender(sender) {
  const runtimeId = chrome.runtime?.id;
  if (!runtimeId) return false;
  if (sender?.id !== runtimeId) return false;

  const senderUrl = typeof sender?.url === 'string' ? sender.url : '';
  const extensionOrigin = `chrome-extension://${runtimeId}/`;
  return !!(senderUrl && senderUrl.startsWith(extensionOrigin));
}

/**
 * Filter payload keys by allowlist to avoid unintended/unsafe updates.
 * @param {Object} payload - Raw payload
 * @param {Array<string>|Set<string>} allowedKeys - Key allowlist
 * @returns {Object}
 */
function filterPayloadKeys(payload, allowedKeys) {
  if (!payload || typeof payload !== 'object') return {};
  const filtered = {};

  Object.keys(payload).forEach((key) => {
    const isAllowed =
      allowedKeys instanceof Set ? allowedKeys.has(key) : Array.isArray(allowedKeys) ? allowedKeys.includes(key) : false;
    if (!isAllowed) return;
    filtered[key] = payload[key];
  });

  return filtered;
}

/**
 * Ensure state is hydrated before any logic relies on it (MV3 init race safe).
 * @feature f05 - State Management
 * @returns {Promise<Object>} Current hydrated state snapshot
 */
export function ensureInitialized() {
  if (hasInitialized) return Promise.resolve({ ...state });
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const storedState = await new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => resolve(data || {}));
      });

      // Remove unknown keys from storage to avoid stale/deprecated state lingering
      const deprecatedKeys = Object.keys(storedState || {}).filter((key) => !isAllowedStorageKey(key));

      if (deprecatedKeys.length) {
        await new Promise((resolve) => chrome.storage.local.remove(deprecatedKeys, () => resolve()));
      }

      const nextState = sanitizeStoredState(storedState);

      // Only persist when something actually needs to change (avoid write churn on MV3 restarts).
      const filteredStoredState = {};
      Object.keys(DEFAULT_STATE).forEach((key) => {
        if (key in (storedState || {})) filteredStoredState[key] = storedState[key];
      });
      const deltaToStore = diffState(filteredStoredState, nextState);

      if (Object.keys(deltaToStore).length) {
        await new Promise((resolve) => chrome.storage.local.set(deltaToStore, () => resolve()));
      }

      state = nextState;
      hasInitialized = true;

      console.log('🌸 State hydrated:', summarizeStateForLog(state));
      setupStorageReconcileListener();
      return { ...state };
    } catch (error) {
      console.error('🌸🌸🌸 Error hydrating state:', error);

      state = sanitizeStoredState(null);
      hasInitialized = true;
      setupStorageReconcileListener();
      return { ...state };
    } finally {
      // Allow GC of the init promise after completion.
      initPromise = null;
    }
  })();

  return initPromise;
}

// Load state from storage on initialization (legacy entrypoint)
/**
 * Initialize state from storage
 * @feature f05 - State Management
 */
export async function initState() {
  await ensureInitialized();
  return getState();
}

// Get entire state or specific properties
/**
 * Get entire state or specific properties
 * @feature f05 - State Management
 */
export function getState(key = null) {
  if (key) {
    return state[key];
  }
  return { ...state };
}

// Update state and persist to storage
/**
 * Update state and persist to storage
 * @feature f05 - State Management
 */
export async function updateState(updates) {
  if (!updates || typeof updates !== 'object') return false;

  updateChain = updateChain
    .then(async () => {
      await ensureInitialized();

      const nextState = computeNextState(state, updates);
      const delta = diffState(state, nextState);

      if (!Object.keys(delta).length) return true;

      // Update in-memory state
      state = nextState;

      // Persist to storage
      await new Promise((resolve) => chrome.storage.local.set(delta, () => resolve()));

      // Broadcast delta update to other parts of the extension
      notifyStateDeltaSubscribers(state, delta);
      broadcastStateDelta(delta);

      return true;
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error updating state:', error);
      return false;
    });

  return updateChain;
}

// Listen for state update requests
export function setupStateListeners() {
  setupStorageReconcileListener();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.getState) {
      (async () => {
        await ensureInitialized();

        const isTrusted = isTrustedExtensionSender(sender);
        const allowedKeys = isTrusted ? STATE_KEYS : UNTRUSTED_STATE_KEYS;

        if (Array.isArray(message.keys)) {
          const subset = {};
          message.keys.forEach((k) => {
            if (typeof k !== 'string' || !allowedKeys.includes(k)) return;
            subset[k] = state[k];
          });
          return subset;
        }

        if (typeof message.key === 'string') {
          if (!allowedKeys.includes(message.key)) return {};
          return { [message.key]: state[message.key] };
        }

        // Default: return full state only for trusted extension pages.
        if (isTrusted) return { ...state };

        const subset = {};
        allowedKeys.forEach((k) => {
          subset[k] = state[k];
        });
        return subset;
      })()
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('🌸🌸🌸 Error handling getState:', error);
          sendResponse({});
        });

      return true; // Keep channel open for async response
    } 
    else if (message.action === messageActions.updateState) {
      (async () => {
        await ensureInitialized();

        if (!message.payload || typeof message.payload !== 'object') {
          return { success: false, error: 'Invalid payload' };
        }

        const isTrusted = isTrustedExtensionSender(sender);
        if (!isTrusted) {
          return { success: false, error: 'Forbidden' };
        }

        const filteredPayload = filterPayloadKeys(message.payload, UI_ALLOWED_UPDATE_KEYS_SET);
        if (!Object.keys(filteredPayload).length) {
          return { success: false, error: 'No valid keys' };
        }

        const success = await updateState(filteredPayload);
        return { success: !!success };
      })()
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('🌸🌸🌸 Error handling updateState:', error);
          sendResponse({ success: false, error: error?.message || String(error) });
        });

      return true; // Keep channel open for async response
    }
    return false;
  });
}
