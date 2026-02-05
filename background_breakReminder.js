/**
 * MaiZone Browser Extension
 * Break Reminder Module: Manages break reminders and MV3-safe timers via chrome.alarms
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode (timer integration)
 */

import { ensureInitialized, getState, onStateDelta, updateState } from './background_state.js';
import { BREAK_REMINDER_INTERVAL, BREAK_REMINDER_MESSAGES } from './constants.js';
import { messageActions } from './actions.js';

/***** ALARM NAMES *****/

const BREAK_REMINDER_END_ALARM = 'maizone_breakReminderEnd';
const BREAK_REMINDER_BADGE_ALARM = 'maizone_breakReminderBadgeTick';
const BADGE_TICK_INTERVAL_MS = 1000;
const OPERA_BADGE_PORT_NAME = 'maizoneBreakReminderBadgeTicker';
const OPERA_BADGE_PORT_TICK_INTERVAL_MS = 1000;
const OPERA_SW_BADGE_TICK_INTERVAL_MS = 1000;

// Runtime flag (best-effort): when true, badge is expected to be updated by offscreen.
let hasOffscreenBadgeTicker = false;

let unsubscribeStateDelta = null;
let hasRegisteredOperaBadgePortListener = false;
const operaBadgePorts = new Set();
let operaBadgeTickerIntervalId = null;
let operaSwBadgeTickTimeoutId = null;

/***** OFFSCREEN (BADGE HIGH-PRECISION) *****/

const CLIPMD_OFFSCREEN_URL = 'clipmd_offscreen.html';

/**
 * Ensure offscreen document exists (used for ClipMD conversion + badge ticking).
 * @returns {Promise<boolean>} True if offscreen is ready
 */
async function ensureOffscreenDocument() {
  try {
    if (!chrome?.offscreen?.createDocument) return false;

    const hasDocument = await chrome.offscreen.hasDocument?.();
    if (hasDocument) return true;

    await chrome.offscreen.createDocument({
      url: CLIPMD_OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Convert selected element HTML to Markdown and update Deep Work badge timer'
    });

    return true;
  } catch (error) {
    const message = error?.message || String(error);
    if (/existing/i.test(message)) return true;
    return false;
  }
}

/***** TRUSTED SENDER (DEFENSE-IN-DEPTH) *****/

/**
 * Check whether the message sender is a trusted UI extension page (popup/options).
 * @param {chrome.runtime.MessageSender} sender - Sender info
 * @returns {boolean}
 */
function isTrustedUiSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  // Content scripts provide sender.tab; extension pages do not.
  if (sender.tab) return false;
  const senderUrl = typeof sender.url === 'string' ? sender.url : '';
  return senderUrl.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/***** OPERA DETECTION (BEST-EFFORT) *****/

/**
 * Detect Opera via UA marker (best-effort).
 * @returns {boolean}
 */
function isOperaBrowser() {
  try {
    const ua = typeof navigator?.userAgent === 'string' ? navigator.userAgent : '';
    return /\bOPR\//.test(ua);
  } catch {
    return false;
  }
}

/***** CONTENT SCRIPT INJECTION (BEST-EFFORT) *****/

/**
 * Ensure content scripts exist on at least one http/https tab (best-effort).
 * Helps browsers that don't inject into existing tabs until reload (and enables Port-based keepalive).
 * @returns {Promise<void>}
 */
async function ensureContentScriptsInjectedIntoAnyHttpTab() {
  try {
    if (!chrome?.tabs?.query || !chrome?.scripting?.executeScript) return;

    const tryInject = async (tabId) => {
      if (typeof tabId !== 'number') return;
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
    };

    const activeTab = await new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
      } catch {
        resolve(null);
      }
    });

    const activeUrl = typeof activeTab?.url === 'string' ? activeTab.url : '';
    if (typeof activeTab?.id === 'number' && (activeUrl.startsWith('http://') || activeUrl.startsWith('https://'))) {
      await tryInject(activeTab.id);
      return;
    }

    const windowTabs = await new Promise((resolve) => {
      try {
        chrome.tabs.query({ currentWindow: true }, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
      } catch {
        resolve([]);
      }
    });

    const fallback = (windowTabs || []).find((tab) => {
      const tabId = tab?.id;
      const url = typeof tab?.url === 'string' ? tab.url : '';
      if (typeof tabId !== 'number') return false;
      return url.startsWith('http://') || url.startsWith('https://');
    });

    if (typeof fallback?.id === 'number') {
      await tryInject(fallback.id);
    }
  } catch {
    // ignore
  }
}

/***** INITIALIZATION *****/

/**
 * Initialize break reminder module.
 * @returns {void}
 */
export function initBreakReminder() {
  setupMessageListeners();
  setupAlarmListeners();
  setupOperaBadgePortListeners();
  setupInternalStateSubscription();
  ensureInitialized()
    .then(() => initializeBreakReminderIfEnabled())
    .catch((error) => {
      console.error('🌸🌸🌸 Error initializing break reminder:', error);
      initializeBreakReminderIfEnabled();
    });
}

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

/***** MESSAGING *****/

/**
 * Setup message listeners for break reminder commands.
 * @returns {void}
 */
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.resetBreakReminder) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({ success: false, error: 'Forbidden' });
        return true;
      }
      resetBreakReminder(message.data, sendResponse);
      return true;
    }

    if (message.action === messageActions.getBreakReminderState) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({
          enabled: false,
          startTime: null,
          interval: BREAK_REMINDER_INTERVAL,
          expectedEndTime: null
        });
        return true;
      }
      getBreakReminderState(sendResponse);
      return true;
    }

    // [f03] Some browsers (notably Opera) may throttle alarms/offscreen updates.
    // A content-script ticker can send this action every second to keep the badge fresh.
    if (message.action === messageActions.breakReminderBadgeTick) {
      ensureInitialized()
        .then(async () => {
          try {
            const {
              breakReminderEnabled,
              isInFlow,
              currentTask,
              reminderExpectedEndTime,
              reminderStartTime,
              reminderInterval
            } = getState();

            const isActive = !!(breakReminderEnabled && isInFlow && currentTask);
            if (!isActive) {
              try {
                chrome.action?.setBadgeText({ text: '' });
              } catch {
                // ignore
              }
              sendResponse?.({ ok: true, active: false });
              return;
            }

            let expectedEndTime = null;
            if (typeof reminderExpectedEndTime === 'number' && Number.isFinite(reminderExpectedEndTime)) {
              expectedEndTime = reminderExpectedEndTime;
            } else if (
              typeof reminderStartTime === 'number' &&
              Number.isFinite(reminderStartTime) &&
              typeof reminderInterval === 'number' &&
              Number.isFinite(reminderInterval)
            ) {
              expectedEndTime = reminderStartTime + reminderInterval;
            }

            if (typeof expectedEndTime === 'number' && Number.isFinite(expectedEndTime) && Date.now() >= expectedEndTime) {
              await handleBreakReminderEnd();
              sendResponse?.({ ok: true, active: false, ended: true });
              return;
            }

            updateBadgeWithTimerDisplay();
            sendResponse?.({ ok: true, active: true });
          } catch (error) {
            sendResponse?.({ ok: false, error: error?.message || String(error) });
          }
        })
        .catch((error) => {
          sendResponse?.({ ok: false, error: error?.message || String(error) });
        });

      return true;
    }

    return false;
  });
}

/***** OPERA PORT TICKER (BADGE) *****/

/**
 * Setup Opera-friendly badge ticker via long-lived Port.
 * Some browsers throttle alarms; a Port can keep SW active during Deep Work.
 * @returns {void}
 */
function setupOperaBadgePortListeners() {
  if (hasRegisteredOperaBadgePortListener) return;
  if (!chrome?.runtime?.onConnect) return;
  hasRegisteredOperaBadgePortListener = true;

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== OPERA_BADGE_PORT_NAME) return;

    operaBadgePorts.add(port);
    console.log('🌸 Opera badge port connected. Active ports:', operaBadgePorts.size);

    try {
      port.onDisconnect.addListener(() => {
        operaBadgePorts.delete(port);
        console.log('🌸 Opera badge port disconnected. Active ports:', operaBadgePorts.size);
        if (!operaBadgePorts.size) stopOperaBadgeTicker();
      });
    } catch {
      // ignore
    }

    try {
      port.onMessage.addListener((msg) => {
        const type = typeof msg?.type === 'string' ? msg.type : '';
        if (type === 'start' || type === 'keepalive') {
          startOperaBadgeTicker();
          return;
        }
        if (type === 'stop') {
          operaBadgePorts.delete(port);
          if (!operaBadgePorts.size) stopOperaBadgeTicker();
        }
      });
    } catch {
      // ignore
    }

    // Default: try to start immediately on connect.
    startOperaBadgeTicker();
  });
}

/**
 * Start per-second badge ticker in SW while at least one Port is connected.
 * @returns {void}
 */
function startOperaBadgeTicker() {
  if (operaBadgeTickerIntervalId) return;
  if (!operaBadgePorts.size) return;

  console.log('🌸 Starting Opera badge ticker (SW interval).');
  operaBadgeTickerIntervalId = setInterval(() => {
    tickOperaBadge().catch(() => {});
  }, OPERA_BADGE_PORT_TICK_INTERVAL_MS);

  tickOperaBadge().catch(() => {});
}

/**
 * Stop Opera badge ticker.
 * @returns {void}
 */
function stopOperaBadgeTicker() {
  if (operaBadgeTickerIntervalId) clearInterval(operaBadgeTickerIntervalId);
  operaBadgeTickerIntervalId = null;
  console.log('🌸 Stopped Opera badge ticker.');
}

/**
 * Tick: update badge or end cycle if time reached.
 * @returns {Promise<void>}
 */
async function tickOperaBadge() {
  await ensureInitialized();

  const {
    breakReminderEnabled,
    isInFlow,
    currentTask,
    reminderExpectedEndTime,
    reminderStartTime,
    reminderInterval
  } = getState();

  const isActive = !!(breakReminderEnabled && isInFlow && currentTask);
  if (!isActive) {
    try {
      chrome.action?.setBadgeText({ text: '' });
    } catch {
      // ignore
    }
    stopOperaBadgeTicker();
    return;
  }

  let expectedEndTime = null;
  if (typeof reminderExpectedEndTime === 'number' && Number.isFinite(reminderExpectedEndTime)) {
    expectedEndTime = reminderExpectedEndTime;
  } else if (
    typeof reminderStartTime === 'number' &&
    Number.isFinite(reminderStartTime) &&
    typeof reminderInterval === 'number' &&
    Number.isFinite(reminderInterval)
  ) {
    expectedEndTime = reminderStartTime + reminderInterval;
  }

  if (typeof expectedEndTime === 'number' && Number.isFinite(expectedEndTime) && Date.now() >= expectedEndTime) {
    await handleBreakReminderEnd();
    stopOperaBadgeTicker();
    return;
  }

  try {
    updateBadgeWithTimerDisplay();
  } catch {
    // ignore
  }
}

/***** OPERA SW TIMER TICKER (BADGE) *****/

/**
 * Start a SW timer loop to keep badge updating even when alarms are throttled.
 * NOTE: This keeps the SW active while Deep Work is running; only used as fallback when offscreen isn't available.
 * @returns {void}
 */
function startOperaSwBadgeTicker() {
  if (operaSwBadgeTickTimeoutId) return;
  if (hasOffscreenBadgeTicker) return;

  console.log('🌸 Starting SW badge ticker fallback (1s).');

  const tick = async () => {
    operaSwBadgeTickTimeoutId = null;

    try {
      await ensureInitialized();

      const {
        breakReminderEnabled,
        isInFlow,
        currentTask,
        reminderExpectedEndTime,
        reminderStartTime,
        reminderInterval
      } = getState();

      const isActive = !!(breakReminderEnabled && isInFlow && currentTask);
      if (!isActive) {
        stopOperaSwBadgeTicker();
        return;
      }

      let expectedEndTime = null;
      if (typeof reminderExpectedEndTime === 'number' && Number.isFinite(reminderExpectedEndTime)) {
        expectedEndTime = reminderExpectedEndTime;
      } else if (
        typeof reminderStartTime === 'number' &&
        Number.isFinite(reminderStartTime) &&
        typeof reminderInterval === 'number' &&
        Number.isFinite(reminderInterval)
      ) {
        expectedEndTime = reminderStartTime + reminderInterval;
      }

      if (typeof expectedEndTime === 'number' && Number.isFinite(expectedEndTime) && Date.now() >= expectedEndTime) {
        await handleBreakReminderEnd();
        stopOperaSwBadgeTicker();
        return;
      }

      updateBadgeWithTimerDisplay();
    } catch {
      // ignore
    } finally {
      // Reschedule only if still active.
      const { breakReminderEnabled, isInFlow, currentTask } = getState();
      if (breakReminderEnabled && isInFlow && currentTask && !hasOffscreenBadgeTicker) {
        operaSwBadgeTickTimeoutId = setTimeout(() => {
          tick().catch(() => {});
        }, OPERA_SW_BADGE_TICK_INTERVAL_MS);
      }
    }
  };

  // Kick immediately.
  tick().catch(() => {});
}

/**
 * Stop Opera SW timer ticker.
 * @returns {void}
 */
function stopOperaSwBadgeTicker() {
  if (operaSwBadgeTickTimeoutId) clearTimeout(operaSwBadgeTickTimeoutId);
  operaSwBadgeTickTimeoutId = null;
}

/**
 * Handle state updates broadcasted by background_state.
 * @param {Object} updates - Partial state
 * @returns {void}
 */
function handleStateUpdated(updates) {
  if (!updates || typeof updates !== 'object') return;

  const shouldSync =
    'breakReminderEnabled' in updates ||
    'isInFlow' in updates ||
    'currentTask' in updates ||
    'reminderStartTime' in updates ||
    'reminderInterval' in updates ||
    'reminderExpectedEndTime' in updates;

  if (!shouldSync) return;

  const shouldStop =
    ('breakReminderEnabled' in updates && !updates.breakReminderEnabled) ||
    ('isInFlow' in updates && !updates.isInFlow) ||
    ('currentTask' in updates && !updates.currentTask);

  if (shouldStop) {
    stopBreakReminder();
    return;
  }

  // If something relevant changed and we didn't stop, ensure alarms/badge reflect current state.
  ensureInitialized()
    .then(() => initializeBreakReminderIfEnabled())
    .catch((error) => console.error('🌸🌸🌸 Error syncing break reminder after state update:', error));
}

/***** ALARMS *****/

/**
 * Setup alarm listeners (MV3-safe timers).
 * @returns {void}
 */
function setupAlarmListeners() {
  if (!chrome?.alarms?.onAlarm) {
    console.warn('🌸🌸🌸 chrome.alarms API unavailable; break reminders may be unreliable.');
    return;
  }

  if (!chrome.alarms.onAlarm.hasListener(handleAlarm)) {
    chrome.alarms.onAlarm.addListener(handleAlarm);
  }
}

/**
 * Alarm event handler.
 * @param {chrome.alarms.Alarm} alarm - Alarm object
 * @returns {void}
 */
async function handleAlarm(alarm) {
  if (!alarm?.name) return;

  await ensureInitialized();

  if (alarm.name === BREAK_REMINDER_BADGE_ALARM) {
    updateBadgeWithTimerDisplay();

    // If offscreen is unavailable, keep scheduling 1-second ticks via one-shot alarms.
    // NOTE: This wakes the SW every second during Deep Work; use only as fallback.
    if (!hasOffscreenBadgeTicker) {
      startOperaSwBadgeTicker();
      ensureContentScriptsInjectedIntoAnyHttpTab().catch(() => {});
      scheduleNextBadgeTickAlarm();
    }
    return;
  }

  if (alarm.name === BREAK_REMINDER_END_ALARM) {
    await handleBreakReminderEnd();
  }
}

/**
 * Schedule end + badge alarms for the current session.
 * @param {number} expectedEndTime - Epoch ms timestamp
 * @returns {Promise<boolean>} True if high-precision badge is handled by offscreen
 */
async function scheduleBreakReminderAlarms(expectedEndTime) {
  if (!chrome?.alarms) return false;
  if (typeof expectedEndTime !== 'number' || !Number.isFinite(expectedEndTime)) return false;

  try {
    chrome.alarms.create(BREAK_REMINDER_END_ALARM, { when: expectedEndTime });

    hasOffscreenBadgeTicker = await ensureOffscreenDocument();

    // Badge tick:
    // - Prefer offscreen (ticks every second without waking SW).
    // - If offscreen is unavailable, fall back to alarms ticking every second (wakes SW).
    if (hasOffscreenBadgeTicker) {
      chrome.alarms.create(BREAK_REMINDER_BADGE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    } else {
      startOperaSwBadgeTicker();
      ensureContentScriptsInjectedIntoAnyHttpTab().catch(() => {});
      scheduleNextBadgeTickAlarm();
    }

    return hasOffscreenBadgeTicker;
  } catch (error) {
    console.error('🌸🌸🌸 Error scheduling break reminder alarms:', error);
  }

  return false;
}

/**
 * Schedule the next 1-second badge tick using a one-shot alarm.
 * @returns {void}
 */
function scheduleNextBadgeTickAlarm() {
  try {
    const { breakReminderEnabled, isInFlow, currentTask, reminderExpectedEndTime, reminderStartTime, reminderInterval } = getState();
    if (!breakReminderEnabled || !isInFlow || !currentTask) return;

    // Stop ticking after the expected end time.
    let expectedEndTime = null;
    if (typeof reminderExpectedEndTime === 'number' && Number.isFinite(reminderExpectedEndTime)) {
      expectedEndTime = reminderExpectedEndTime;
    } else if (
      typeof reminderStartTime === 'number' &&
      Number.isFinite(reminderStartTime) &&
      typeof reminderInterval === 'number' &&
      Number.isFinite(reminderInterval)
    ) {
      expectedEndTime = reminderStartTime + reminderInterval;
    }

    if (typeof expectedEndTime === 'number' && Number.isFinite(expectedEndTime)) {
      if (Date.now() >= expectedEndTime) return;
    }

    chrome.alarms.create(BREAK_REMINDER_BADGE_ALARM, { when: Date.now() + BADGE_TICK_INTERVAL_MS });
  } catch {
    // ignore
  }
}

/**
 * Clear all break reminder alarms.
 * @returns {void}
 */
function stopBreakReminder() {
  try {
    chrome.alarms?.clear(BREAK_REMINDER_END_ALARM);
    chrome.alarms?.clear(BREAK_REMINDER_BADGE_ALARM);
  } catch (error) {
    console.warn('🌸🌸🌸 Error clearing break reminder alarms:', error);
  }

  hasOffscreenBadgeTicker = false;
  stopOperaSwBadgeTicker();
  stopOperaBadgeTicker();

  // Defensive: if Opera ports are still open, close them to avoid keeping SW alive.
  try {
    operaBadgePorts.forEach((port) => {
      try {
        port.disconnect();
      } catch {
        // ignore
      }
    });
    operaBadgePorts.clear();
  } catch {
    // ignore
  }

  try {
    chrome.action?.setBadgeText({ text: '' });
  } catch (error) {
    console.warn('🌸🌸🌸 Error clearing break reminder badge:', error);
  }
}

/***** TIMER CORE *****/

/**
 * Initialize break reminder if enabled (service worker restart safe).
 * @returns {void}
 */
async function initializeBreakReminderIfEnabled() {
  const {
    breakReminderEnabled,
    isInFlow,
    currentTask,
    reminderStartTime,
    reminderInterval,
    reminderExpectedEndTime
  } = getState();

  if (!breakReminderEnabled || !isInFlow || !currentTask) {
    stopBreakReminder();
    return;
  }

  const interval = reminderInterval || BREAK_REMINDER_INTERVAL;
  const startTime = reminderStartTime || Date.now();
  const expectedEndTime = reminderExpectedEndTime || (startTime + interval);
  let expectedEndTimeForAlarms = expectedEndTime;

  if (Date.now() >= expectedEndTime) {
    await handleBreakReminderEnd();
    return;
  }

  if (!reminderStartTime || !reminderExpectedEndTime || !reminderInterval) {
    await updateState({
      reminderStartTime: startTime,
      reminderInterval: interval,
      reminderExpectedEndTime: expectedEndTime
    });

    // After awaited work, re-check state to avoid scheduling orphan alarms.
    const refreshed = getState();
    if (!refreshed.breakReminderEnabled || !refreshed.isInFlow || !refreshed.currentTask) {
      stopBreakReminder();
      return;
    }
    if (typeof refreshed.reminderExpectedEndTime === 'number' && Number.isFinite(refreshed.reminderExpectedEndTime)) {
      expectedEndTimeForAlarms = refreshed.reminderExpectedEndTime;
    }
  }

  await scheduleBreakReminderAlarms(expectedEndTimeForAlarms);
  updateBadgeWithTimerDisplay();
}

/**
 * Update badge with timer display.
 * @returns {void}
 */
function updateBadgeWithTimerDisplay() {
  const { breakReminderEnabled, reminderStartTime, reminderInterval, reminderExpectedEndTime, isInFlow } = getState();

  if (!isInFlow || !breakReminderEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let expectedEndTime = reminderExpectedEndTime;
  if (typeof expectedEndTime !== 'number' || !Number.isFinite(expectedEndTime)) {
    if (typeof reminderStartTime !== 'number' || !Number.isFinite(reminderStartTime)) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    if (typeof reminderInterval !== 'number' || !Number.isFinite(reminderInterval)) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    expectedEndTime = reminderStartTime + reminderInterval;
  }

  const remainingMs = expectedEndTime - Date.now();
  if (remainingMs <= 0) {
    chrome.action.setBadgeText({ text: '00:00' });
    return;
  }

  const safeMs = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  chrome.action.setBadgeText({ text: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` });
}

/**
 * Start break reminder timer (MV3-safe via alarms).
 * @param {number} [customInterval] - Custom interval in ms
 * @returns {void}
 */
async function startBreakReminder(customInterval) {
  stopBreakReminder();

  const { isInFlow, currentTask, breakReminderEnabled } = getState();
  if (!isInFlow || !currentTask || !breakReminderEnabled) {
    return;
  }

  const interval =
    typeof customInterval === 'number' && Number.isFinite(customInterval) && customInterval > 0
      ? customInterval
      : BREAK_REMINDER_INTERVAL;

  const reminderStartTime = Date.now();
  const reminderExpectedEndTime = reminderStartTime + interval;

  await updateState({
    reminderStartTime,
    reminderInterval: interval,
    reminderExpectedEndTime
  });

  await scheduleBreakReminderAlarms(reminderExpectedEndTime);
  updateBadgeWithTimerDisplay();
}

/**
 * Handle timer end alarm (end Deep Work cycle + notify user).
 * @returns {void}
 */
async function handleBreakReminderEnd() {
  const { isInFlow, currentTask, breakReminderEnabled, reminderExpectedEndTime } = getState();

  // No longer valid -> just cleanup.
  if (!isInFlow || !currentTask || !breakReminderEnabled) {
    stopBreakReminder();
    return;
  }

  const now = Date.now();
  if (
    typeof reminderExpectedEndTime === 'number' &&
    Number.isFinite(reminderExpectedEndTime) &&
    now < reminderExpectedEndTime
  ) {
    // Alarm can fire early/late; reschedule if early.
    await scheduleBreakReminderAlarms(reminderExpectedEndTime);
    updateBadgeWithTimerDisplay();
    return;
  }

  console.log('🌸 Break time reached! Ending Deep Work cycle...');

  // End cycle first so popup resets deterministically.
  await updateState({
    isInFlow: false,
    currentTask: '',
    breakReminderEnabled: false
  });

  stopBreakReminder();

  showBreakReminderNotification();
}

/***** NOTIFICATIONS *****/

/**
 * Send break reminder notification (manual test entrypoint).
 * @feature f03 - Break Reminder
 * @returns {void}
 */
export function sendBreakReminder() {
  console.debug('🌸 Break reminder triggered');
  showBreakReminderNotification();
}

/**
 * Show break reminder notification.
 * @returns {void}
 */
function showBreakReminderNotification() {
  const randomMessage = BREAK_REMINDER_MESSAGES[Math.floor(Math.random() * BREAK_REMINDER_MESSAGES.length)];
  console.log('🌸 Selected random message:', randomMessage);

  const options = {
    type: 'basic',
    iconUrl: 'icon.png',
    title: '🌸 Nghỉ xíu nhỉ! ✨',
    message: randomMessage,
    priority: 2
  };

  try {
    chrome.notifications.create('break-reminder-notification', options, () => {
      if (!chrome.runtime.lastError) return;

      console.error('🌸🌸🌸 Error creating notification:', chrome.runtime.lastError);
      chrome.notifications.create('break-reminder-notification-alt', options);
    });

    console.info('🌸 Break reminder sent');
  } catch (error) {
    console.error('🌸🌸🌸 Error in sendBreakReminder:', error);
  }
}

/***** PUBLIC ACTIONS *****/

/**
 * Reset break reminder timer with new task.
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @param {Object} data - Payload from popup
 * @param {Function} sendResponse - Chrome response callback
 * @returns {void}
 */
function resetBreakReminder(data, sendResponse) {
  ensureInitialized()
    .then(async () => {
      try {
        const task = typeof data?.task === 'string' ? data.task.trim() : '';
        if (!task) {
          sendResponse?.({ success: false, error: 'Missing task' });
          return;
        }

        console.log('🌸 Resetting break reminder timer');

        stopBreakReminder();

        const interval = BREAK_REMINDER_INTERVAL;
        const reminderStartTime = Date.now();
        const reminderExpectedEndTime = reminderStartTime + interval;

        await updateState({
          currentTask: task,
          isInFlow: true,
          breakReminderEnabled: true,
          reminderStartTime,
          reminderInterval: interval,
          reminderExpectedEndTime
        });

        await scheduleBreakReminderAlarms(reminderExpectedEndTime);
        updateBadgeWithTimerDisplay();

        sendResponse?.({ success: true });
      } catch (error) {
        console.error('🌸🌸🌸 Error in resetBreakReminder:', error);
        sendResponse?.({ success: false, error: error?.message || String(error) });
      }
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error ensuring state before resetBreakReminder:', error);
      sendResponse?.({ success: false, error: error?.message || String(error) });
    });
}

/**
 * Get current break reminder state.
 * @param {Function} sendResponse - Chrome response callback
 * @returns {void}
 */
function getBreakReminderState(sendResponse) {
  ensureInitialized()
    .then(async () => {
      const {
        breakReminderEnabled,
        reminderStartTime,
        reminderInterval,
        reminderExpectedEndTime,
        isInFlow,
        currentTask
      } = getState();

      const isActive = !!(isInFlow && currentTask && breakReminderEnabled);

      if (!isActive) {
        sendResponse({
          enabled: false,
          startTime: null,
          interval: BREAK_REMINDER_INTERVAL,
          expectedEndTime: null
        });
        return;
      }

      if (!reminderStartTime || !reminderExpectedEndTime) {
        await startBreakReminder(reminderInterval || BREAK_REMINDER_INTERVAL);
        const newState = getState();
        sendResponse({
          enabled: true,
          startTime: newState.reminderStartTime,
          interval: newState.reminderInterval || BREAK_REMINDER_INTERVAL,
          expectedEndTime: newState.reminderExpectedEndTime
        });
        return;
      }

      sendResponse({
        enabled: true,
        startTime: reminderStartTime,
        interval: reminderInterval || BREAK_REMINDER_INTERVAL,
        expectedEndTime: reminderExpectedEndTime
      });
    })
    .catch((error) => {
      console.error('🌸🌸🌸 Error ensuring state before getBreakReminderState:', error);
      sendResponse({
        enabled: false,
        startTime: null,
        interval: BREAK_REMINDER_INTERVAL,
        expectedEndTime: null
      });
    });
}
