/**
 * MaiZone Browser Extension
 * Intent Gate Module: Require intention before accessing distracting sites
 * @feature f13 - Intent Gate for Distracting Sites
 */

import { ensureInitialized, getState, onStateDelta } from './background_state.js';
import { messageActions } from './actions.js';
import { getIntentGateMatch } from './intent_gate_helpers.js';

/***** CONFIG *****/

const INTENT_GATE_ALLOW_MINUTES = 5;
const INTENT_GATE_ALLOW_MS = INTENT_GATE_ALLOW_MINUTES * 60 * 1000;
const INTENT_GATE_MIN_REASON_CHARS = 5;
const INTENT_GATE_LOG_LIMIT = 50;

const STORAGE_ALLOW_PREFIX = 'intentGateTab_';
const STORAGE_PENDING_PREFIX = 'intentGatePending_';
const STORAGE_REASON_LOG = 'intentGateReasonLog';
const ALARM_PREFIX = 'maizone_intentGateExpire_';

let unsubscribeStateDelta = null;

/***** KEY HELPERS *****/

/**
 * Build storage key for per-tab allow entries.
 * @param {number} tabId - Chrome tab id
 * @returns {string}
 */
function getAllowKey(tabId) {
  return `${STORAGE_ALLOW_PREFIX}${tabId}`;
}

/**
 * Build storage key for per-tab pending URLs.
 * @param {number} tabId - Chrome tab id
 * @returns {string}
 */
function getPendingKey(tabId) {
  return `${STORAGE_PENDING_PREFIX}${tabId}`;
}

/**
 * Build alarm name for a tab expiration.
 * @param {number} tabId - Chrome tab id
 * @returns {string}
 */
function getAlarmName(tabId) {
  return `${ALARM_PREFIX}${tabId}`;
}

/***** UTILITIES *****/

/**
 * Count non-whitespace characters in a string.
 * @param {string} value - Raw input
 * @returns {number}
 */
function countNonWhitespace(value) {
  if (typeof value !== 'string') return 0;
  return value.replace(/\s/g, '').length;
}

/**
 * Check whether intent gate is enabled in state.
 * @param {Object} state - Current state snapshot
 * @returns {boolean}
 */
function isIntentGateEnabled(state) {
  return !!state?.intentGateEnabled;
}

/**
 * Check whether sender is a trusted extension page.
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @returns {boolean}
 */
function isTrustedExtensionSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const senderUrl = typeof sender.url === 'string' ? sender.url : '';
  return senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/***** STORAGE *****/

/**
 * Check if a tab is still within its allowed window.
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<boolean>}
 */
async function isTabAllowed(tabId) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return false;

  const key = getAllowKey(tabId);
  const result = await chrome.storage.local.get(key);
  const entry = result?.[key];

  if (entry && typeof entry.expiresAt === 'number') {
    if (Date.now() < entry.expiresAt) return true;

    await chrome.storage.local.remove(key);
    await chrome.alarms.clear(getAlarmName(tabId));
  }

  return false;
}

/**
 * Store allow window for a tab and schedule expiration.
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<void>}
 */
async function allowTabForWindow(tabId) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;

  const key = getAllowKey(tabId);
  await chrome.storage.local.set({
    [key]: {
      allowed: true,
      expiresAt: Date.now() + INTENT_GATE_ALLOW_MS
    }
  });

  await chrome.alarms.create(getAlarmName(tabId), {
    delayInMinutes: INTENT_GATE_ALLOW_MINUTES
  });
}

/**
 * Store a pending URL for a tab.
 * @param {number} tabId - Chrome tab id
 * @param {string} url - Pending URL
 * @returns {Promise<void>}
 */
async function setPendingUrl(tabId, url) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
  if (typeof url !== 'string' || !url) return;
  await chrome.storage.local.set({ [getPendingKey(tabId)]: url });
}

/**
 * Clear per-tab allow/pending storage and alarms.
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<void>}
 */
async function clearTabIntentGate(tabId) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;

  await chrome.storage.local.remove([getAllowKey(tabId), getPendingKey(tabId)]);
  await chrome.alarms.clear(getAlarmName(tabId));
}

/**
 * Clear all per-tab intent gate storage (allow/pending) when disabled.
 * @returns {Promise<void>}
 */
async function clearAllTabIntentGateData() {
  try {
    const stored = await new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => resolve(data || {}));
    });

    const keysToRemove = Object.keys(stored).filter(
      (key) => key.startsWith(STORAGE_ALLOW_PREFIX) || key.startsWith(STORAGE_PENDING_PREFIX)
    );

    if (keysToRemove.length) {
      await new Promise((resolve) => chrome.storage.local.remove(keysToRemove, () => resolve()));
    }

    const alarms = await chrome.alarms.getAll();
    await Promise.all(
      alarms
        .filter((alarm) => alarm?.name?.startsWith(ALARM_PREFIX))
        .map((alarm) => chrome.alarms.clear(alarm.name))
    );
  } catch {
    // ignore
  }
}

/**
 * Append a reason entry to local log.
 * @param {string} reason - User reason (trimmed)
 * @returns {Promise<void>}
 */
async function logReason(reason) {
  if (typeof reason !== 'string') return;
  if (countNonWhitespace(reason) < INTENT_GATE_MIN_REASON_CHARS) return;

  const result = await chrome.storage.local.get(STORAGE_REASON_LOG);
  const log = Array.isArray(result?.[STORAGE_REASON_LOG]) ? result[STORAGE_REASON_LOG] : [];

  log.unshift({
    reason,
    timestamp: Date.now()
  });

  if (log.length > INTENT_GATE_LOG_LIMIT) {
    log.length = INTENT_GATE_LOG_LIMIT;
  }

  await chrome.storage.local.set({ [STORAGE_REASON_LOG]: log });
}

/***** BLOCKING FLOW *****/

/**
 * Navigate the tab to the intent gate page.
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<void>}
 */
async function blockTab(tabId) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;

  const blockUrl = `${chrome.runtime.getURL('intent_gate.html')}?tabId=${tabId}`;
  try {
    await chrome.tabs.update(tabId, { url: blockUrl });
  } catch (error) {
    console.info('🌸 Could not open intent gate for tab:', tabId);
  }
}

/**
 * Handle navigation events and trigger the intent gate when needed.
 * @param {chrome.webNavigation.WebNavigationOnBeforeNavigateEventDetails} details - Navigation details
 * @returns {Promise<void>}
 */
async function handleBeforeNavigate(details) {
  if (!details || details.frameId !== 0) return;
  if (!details.url) return;

  await ensureInitialized();
  const state = getState();
  if (!isIntentGateEnabled(state)) return;

  const tabId = details.tabId;
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;

  const match = getIntentGateMatch(details.url, state);
  if (!match.shouldGate) return;

  const allowed = await isTabAllowed(tabId);
  if (allowed) return;

  await setPendingUrl(tabId, details.url);
  await blockTab(tabId);
}

/***** MESSAGE HANDLERS *****/

/**
 * Handle allow access request from intent gate UI.
 * @param {Object} message - Incoming message
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @param {Function} sendResponse - Response callback
 * @returns {boolean}
 */
function handleAllowAccess(message, sender, sendResponse) {
  if (!isTrustedExtensionSender(sender)) {
    sendResponse({ success: false, error: 'Forbidden' });
    return true;
  }

  const data = message?.data || {};
  const tabId = Number(data?.tabId);
  const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';

  if (!Number.isFinite(tabId)) {
    sendResponse({ success: false, error: 'Invalid tab' });
    return true;
  }

  if (countNonWhitespace(reason) < INTENT_GATE_MIN_REASON_CHARS) {
    sendResponse({ success: false, error: 'Reason too short' });
    return true;
  }

  (async () => {
    await ensureInitialized();
    await logReason(reason);

    await allowTabForWindow(tabId);

    const pendingKey = getPendingKey(tabId);
    const result = await chrome.storage.local.get(pendingKey);
    const pendingUrl = typeof result?.[pendingKey] === 'string' ? result[pendingKey] : 'https://example.com/';

    await chrome.storage.local.remove(pendingKey);

    try {
      await chrome.tabs.update(tabId, { url: pendingUrl });
    } catch {
      // ignore
    }

    sendResponse({ success: true });
  })().catch((error) => {
    console.error('🌸🌸🌸 Error allowing intent gate access:', error);
    sendResponse({ success: false, error: 'Internal error' });
  });

  return true;
}

/**
 * Handle request to fetch recent reasons.
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @param {Function} sendResponse - Response callback
 * @returns {boolean}
 */
function handleGetReasonLog(sender, sendResponse) {
  if (!isTrustedExtensionSender(sender)) {
    sendResponse({ success: false, error: 'Forbidden' });
    return true;
  }

  (async () => {
    const result = await chrome.storage.local.get(STORAGE_REASON_LOG);
    const log = Array.isArray(result?.[STORAGE_REASON_LOG]) ? result[STORAGE_REASON_LOG] : [];
    sendResponse({ success: true, log });
  })().catch(() => {
    sendResponse({ success: false, log: [] });
  });

  return true;
}

/***** ALARMS *****/

/**
 * Handle alarm events for intent gate expiry.
 * @param {chrome.alarms.Alarm} alarm - Alarm data
 * @returns {Promise<void>}
 */
async function handleAlarm(alarm) {
  if (!alarm?.name || !alarm.name.startsWith(ALARM_PREFIX)) return;

  const tabId = Number(alarm.name.replace(ALARM_PREFIX, ''));
  if (!Number.isFinite(tabId)) return;

  await chrome.storage.local.remove(getAllowKey(tabId));

  try {
    await ensureInitialized();
    const state = getState();
    const tab = await chrome.tabs.get(tabId);
    const url = typeof tab?.url === 'string' ? tab.url : '';
    if (url && getIntentGateMatch(url, state).shouldGate) {
      await blockTab(tabId);
    }
  } catch {
    // ignore
  }
}

/***** STATE SYNC *****/

/**
 * Handle state updates for intent gate enable/disable.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdated(updates) {
  if (!updates || typeof updates !== 'object') return;

  const shouldRecheck =
    'intentGateEnabled' in updates ||
    'distractingSites' in updates ||
    'deepWorkBlockedSites' in updates ||
    'isInFlow' in updates;

  if (shouldRecheck) {
    ensureInitialized()
      .then(() => {
        const state = getState();
        if (!isIntentGateEnabled(state)) {
          clearAllTabIntentGateData().catch(() => {});
        } else {
          checkActiveTabForGate().catch(() => {});
        }
      })
      .catch(() => {});
  }
}

/**
 * If gate enabled, check active tab and block immediately if needed.
 * @returns {Promise<void>}
 */
async function checkActiveTabForGate() {
  if (!chrome?.tabs?.query) return;

  await ensureInitialized();
  const state = getState();
  if (!isIntentGateEnabled(state)) return;

  const activeTab = await new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
    } catch {
      resolve(null);
    }
  });

  const tabId = activeTab?.id;
  const url = typeof activeTab?.url === 'string' ? activeTab.url : '';
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
  if (!url) return;

  const match = getIntentGateMatch(url, state);
  if (!match.shouldGate) return;

  const allowed = await isTabAllowed(tabId);
  if (allowed) return;

  await setPendingUrl(tabId, url);
  await blockTab(tabId);
}

/**
 * Subscribe to internal state updates (service worker).
 * @returns {void}
 */
function setupInternalStateSubscription() {
  if (unsubscribeStateDelta) return;
  unsubscribeStateDelta = onStateDelta((nextState, delta) => {
    handleStateUpdated(delta);
  });
}

/***** LISTENERS *****/

/**
 * Setup runtime message listeners.
 * @returns {void}
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.intentGateAllowAccess) {
      return handleAllowAccess(message, sender, sendResponse);
    }

    if (message.action === messageActions.intentGateGetReasonLog) {
      return handleGetReasonLog(sender, sendResponse);
    }

    return false;
  });
}

/**
 * Setup alarm and tab lifecycle listeners.
 * @returns {void}
 */
function setupLifecycleListeners() {
  if (chrome?.alarms?.onAlarm && !chrome.alarms.onAlarm.hasListener(handleAlarm)) {
    chrome.alarms.onAlarm.addListener(handleAlarm);
  }

  if (chrome?.tabs?.onRemoved && !chrome.tabs.onRemoved.hasListener(clearTabIntentGate)) {
    chrome.tabs.onRemoved.addListener(clearTabIntentGate);
  }

  if (chrome?.tabs?.onReplaced && !chrome.tabs.onReplaced.hasListener(handleTabReplaced)) {
    chrome.tabs.onReplaced.addListener(handleTabReplaced);
  }
}

/**
 * Handle tab replacement (cleanup old tab state).
 * @param {number} addedTabId - New tab id
 * @param {number} removedTabId - Old tab id
 * @returns {void}
 */
function handleTabReplaced(addedTabId, removedTabId) {
  clearTabIntentGate(removedTabId);
}

/**
 * Setup webNavigation listener for gate.
 * @returns {void}
 */
function setupNavigationListener() {
  if (!chrome?.webNavigation?.onBeforeNavigate) return;
  if (!chrome.webNavigation.onBeforeNavigate.hasListener(handleBeforeNavigate)) {
    chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
  }
}

/***** INIT *****/

/**
 * Initialize intent gate module.
 * @returns {void}
 */
export function initIntentGate() {
  setupMessageListeners();
  setupLifecycleListeners();
  setupNavigationListener();
  setupInternalStateSubscription();

  ensureInitialized()
    .then(() => {
      const state = getState();
      if (!isIntentGateEnabled(state)) {
        clearAllTabIntentGateData().catch(() => {});
      } else {
        checkActiveTabForGate().catch(() => {});
      }
    })
    .catch(() => {});
}
