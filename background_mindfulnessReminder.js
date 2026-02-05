/**
 * MaiZone Browser Extension
 * Mindfulness Reminders: Periodic gentle toasts (MV3-safe timers via chrome.alarms)
 * @feature f08 - Mindfulness Reminders
 */

import { ensureInitialized, getState, onStateDelta, updateState } from './background_state.js';
import {
  MINDFULNESS_QUOTES,
  MINDFULNESS_REMINDER_INTERVAL_MINUTES,
  MINDFULNESS_STRETCH_REMINDERS
} from './constants.js';
import { sendMessageToTabSafely } from './messaging.js';
import { messageActions } from './actions.js';

/***** ALARM NAME *****/

const MINDFULNESS_REMINDER_ALARM = 'maizone_mindfulnessReminderTick';

/***** COOLDOWN (ANTI-SPAM) *****/

const MINDFULNESS_COOLDOWN_MS = 60 * 1000;

let unsubscribeStateDelta = null;

/***** INTERNAL SUBSCRIPTION *****/

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

/***** INITIALIZATION *****/

/**
 * Initialize mindfulness reminders module.
 * @returns {void}
 */
export function initMindfulnessReminder() {
  setupAlarmListeners();
  setupInternalStateSubscription();

  ensureInitialized()
    .then(() => syncMindfulnessReminder())
    .catch((error) => {
      console.error('🌸🌸🌸 Error initializing mindfulness reminders:', error);
      syncMindfulnessReminder();
    });
}

/***** MANUAL TEST (COMMAND) *****/

/**
 * Trigger a mindfulness toast immediately (best-effort).
 * - Bypasses cooldown (for quick testing).
 * @feature f08 - Mindfulness Reminders
 * @param {Object} [options]
 * @param {boolean} [options.allowDuringDeepWork=true] - If true, allow manual toast during Deep Work
 * @returns {Promise<{ok:boolean, skipped?:string}>}
 */
export async function sendMindfulnessToast({ allowDuringDeepWork = true } = {}) {
  await ensureInitialized();

  const { isInFlow } = getState();
  if (isInFlow && !allowDuringDeepWork) return { ok: false, skipped: 'inFlow' };

  const text = pickMindfulnessMessage();
  if (!text) return { ok: false, skipped: 'noMessage' };

  const ok = await showMindfulnessToastOnActiveTab(text);
  if (!ok) return { ok: false, skipped: 'noActiveTab' };

  await updateState({ mindfulnessLastShownAt: Date.now() });
  return { ok: true };
}

/***** STATE SYNC *****/

/**
 * Handle state updates broadcasted by background_state.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdated(updates) {
  if (!updates || typeof updates !== 'object') return;
  if ('mindfulnessReminderEnabled' in updates) {
    syncMindfulnessReminder().catch(() => {});
  }
}

/**
 * Ensure alarm registration matches current state.
 * @feature f08 - Mindfulness Reminders
 * @returns {Promise<void>}
 */
async function syncMindfulnessReminder() {
  await ensureInitialized();

  const { mindfulnessReminderEnabled } = getState();
  const shouldEnable = !!mindfulnessReminderEnabled;

  if (!chrome?.alarms) return;

  if (shouldEnable) {
    startMindfulnessReminderAlarm();
  } else {
    stopMindfulnessReminderAlarm();
  }
}

/***** ALARMS *****/

/**
 * Setup alarm listeners (MV3-safe timers).
 * @returns {void}
 */
function setupAlarmListeners() {
  if (!chrome?.alarms?.onAlarm) {
    console.warn('🌸🌸🌸 chrome.alarms API unavailable; mindfulness reminders may be unreliable.');
    return;
  }

  if (!chrome.alarms.onAlarm.hasListener(handleAlarm)) {
    chrome.alarms.onAlarm.addListener(handleAlarm);
  }
}

/**
 * Start repeating mindfulness reminder alarm.
 * @returns {void}
 */
function startMindfulnessReminderAlarm() {
  try {
    chrome.alarms.create(MINDFULNESS_REMINDER_ALARM, {
      delayInMinutes: MINDFULNESS_REMINDER_INTERVAL_MINUTES,
      periodInMinutes: MINDFULNESS_REMINDER_INTERVAL_MINUTES
    });
  } catch (error) {
    console.error('🌸🌸🌸 Error starting mindfulness alarm:', error);
  }
}

/**
 * Stop mindfulness reminder alarm.
 * @returns {void}
 */
function stopMindfulnessReminderAlarm() {
  try {
    chrome.alarms.clear(MINDFULNESS_REMINDER_ALARM);
  } catch {
    // ignore
  }
}

/**
 * Alarm event handler.
 * @param {chrome.alarms.Alarm} alarm - Alarm object
 * @returns {Promise<void>}
 */
async function handleAlarm(alarm) {
  if (!alarm?.name) return;
  if (alarm.name !== MINDFULNESS_REMINDER_ALARM) return;

  await ensureInitialized();

  const { mindfulnessReminderEnabled, isInFlow, mindfulnessLastShownAt } = getState();
  if (!mindfulnessReminderEnabled) {
    stopMindfulnessReminderAlarm();
    return;
  }

  // Skip during Deep Work to avoid breaking focus.
  if (isInFlow) return;

  const now = Date.now();
  if (
    typeof mindfulnessLastShownAt === 'number' &&
    Number.isFinite(mindfulnessLastShownAt) &&
    now - mindfulnessLastShownAt < MINDFULNESS_COOLDOWN_MS
  ) {
    return;
  }

  const text = pickMindfulnessMessage();
  if (!text) return;

  const ok = await showMindfulnessToastOnActiveTab(text);
  if (!ok) return;

  await updateState({ mindfulnessLastShownAt: now });
}

/***** MESSAGE PICKER *****/

/**
 * Pick a gentle reminder message (quote or stretch).
 * @feature f08 - Mindfulness Reminders
 * @returns {string}
 */
function pickMindfulnessMessage() {
  const quotes = Array.isArray(MINDFULNESS_QUOTES) ? MINDFULNESS_QUOTES : [];
  const stretches = Array.isArray(MINDFULNESS_STRETCH_REMINDERS) ? MINDFULNESS_STRETCH_REMINDERS : [];

  const hasQuotes = quotes.length > 0;
  const hasStretches = stretches.length > 0;
  if (!hasQuotes && !hasStretches) return '';

  const useQuote = hasQuotes && (!hasStretches || Math.random() < 0.5);
  const source = useQuote ? quotes : stretches;

  const message = source[Math.floor(Math.random() * source.length)];
  return typeof message === 'string' ? message : '';
}

/***** TOAST DELIVERY (ACTIVE TAB) *****/

/**
 * Best-effort: inject content scripts into an existing tab (helps after extension reload).
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<boolean>} True if injection attempted without immediate error
 */
async function ensureContentScriptsInjected(tabId) {
  try {
    if (!chrome?.scripting?.executeScript) return false;
    if (typeof tabId !== 'number') return false;

    await new Promise((resolve) => {
      try {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['actions_global.js', 'content.js']
          },
          () => resolve()
        );
      } catch {
        resolve();
      }
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Show mindfulness toast on the active tab (best-effort).
 * @param {string} text - Toast text
 * @returns {Promise<boolean>} True if delivered to a tab with an active content script
 */
async function showMindfulnessToastOnActiveTab(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return false;

  if (!chrome?.tabs?.query) return false;

  const activeTab = await new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs?.[0] || null));
    } catch {
      resolve(null);
    }
  });

  const tabId = activeTab?.id;
  const url = typeof activeTab?.url === 'string' ? activeTab.url : '';
  if (typeof tabId !== 'number') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  const payload = { action: messageActions.mindfulnessToast, data: { text: message } };

  const reply = await sendMessageToTabSafely(tabId, payload, { timeoutMs: 1500 });
  if (reply?.ok) return true;

  // Retry once after a best-effort injection (covers "existing tab after reload" cases).
  await ensureContentScriptsInjected(tabId);
  const replyAfterInject = await sendMessageToTabSafely(tabId, payload, { timeoutMs: 2000 });
  return !!replyAfterInject?.ok;
}
