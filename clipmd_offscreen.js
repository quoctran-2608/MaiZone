/**
 * MaiZone Browser Extension
 * ClipMD Offscreen: HTML -> Markdown conversion worker (Turndown)
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @feature f03 - Break Reminder (badge ticker helper)
 */

/***** TURNDOWN WORKER *****/

const CLIPMD_OFFSCREEN_MESSAGE_TYPE = 'clipmdConvertMarkdown';

// [f03] Badge ticker (high precision while Deep Work is active)
const BADGE_TICK_INTERVAL_MS = 1000;
let badgeTickIntervalId = null;
let lastBadgeText = null;

/**
 * Convert HTML string to Markdown (pure conversion inside offscreen document).
 * @param {string} html - Raw HTML
 * @returns {{ok: boolean, markdown?: string, error?: string}}
 */
function convertMarkdown(html) {
  try {
    const td = new TurndownService({ codeBlockStyle: 'fenced' });
    const markdown = td.turndown(html || '');
    return { ok: true, markdown };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CLIPMD_OFFSCREEN_MESSAGE_TYPE) return false;

  const html = typeof message?.html === 'string' ? message.html : '';
  const response = convertMarkdown(html);
  sendResponse(response);

  return true;
});

/***** BADGE TICKER (OFFSCREEN) *****/

/**
 * Read timer state from storage (privacy-first: no task content logging).
 * @returns {Promise<{
 *  isInFlow: boolean,
 *  breakReminderEnabled: boolean,
 *  hasTask: boolean,
 *  expectedEndTime: number|null,
 * }>}
 */
async function readTimerStateFromStorage() {
  const data = await new Promise((resolve) => {
    try {
      chrome.storage.local.get(
        ['isInFlow', 'breakReminderEnabled', 'currentTask', 'reminderStartTime', 'reminderInterval', 'reminderExpectedEndTime'],
        (result) => resolve(result || {})
      );
    } catch {
      resolve({});
    }
  });

  const isInFlow = !!data.isInFlow;
  const breakReminderEnabled = !!data.breakReminderEnabled;
  const hasTask = !!(data.currentTask && String(data.currentTask).trim());

  const expectedEndTimeRaw = data.reminderExpectedEndTime;
  const startTimeRaw = data.reminderStartTime;
  const intervalRaw = data.reminderInterval;

  let expectedEndTime = null;
  if (typeof expectedEndTimeRaw === 'number' && Number.isFinite(expectedEndTimeRaw)) {
    expectedEndTime = expectedEndTimeRaw;
  } else if (
    typeof startTimeRaw === 'number' &&
    Number.isFinite(startTimeRaw) &&
    typeof intervalRaw === 'number' &&
    Number.isFinite(intervalRaw)
  ) {
    expectedEndTime = startTimeRaw + intervalRaw;
  }

  return { isInFlow, breakReminderEnabled, hasTask, expectedEndTime };
}

/**
 * Format remaining time as mm:ss.
 * @param {number} remainingMs - Remaining milliseconds
 * @returns {string}
 */
function formatRemaining(remainingMs) {
  const safeMs = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Set badge text with dedupe to avoid unnecessary calls.
 * @param {string|null} text - Badge text
 * @returns {void}
 */
function setBadgeText(text) {
  const next = typeof text === 'string' ? text : '';
  if (next === lastBadgeText) return;
  lastBadgeText = next;
  try {
    chrome.action.setBadgeText({ text: next });
  } catch {
    // ignore
  }
}

/**
 * Tick: update badge if Deep Work timer is active, otherwise stop.
 * @returns {Promise<void>}
 */
async function tickBadge() {
  const { isInFlow, breakReminderEnabled, hasTask, expectedEndTime } = await readTimerStateFromStorage();

  const isActive = !!(isInFlow && breakReminderEnabled && hasTask && typeof expectedEndTime === 'number');
  if (!isActive) {
    stopBadgeTicker();
    return;
  }

  const remainingMs = expectedEndTime - Date.now();
  if (remainingMs <= 0) {
    setBadgeText('00:00');
    return;
  }

  setBadgeText(formatRemaining(remainingMs));
}

/**
 * Start per-second badge ticker.
 * @returns {void}
 */
function startBadgeTicker() {
  if (badgeTickIntervalId) return;
  badgeTickIntervalId = setInterval(() => {
    tickBadge().catch(() => {});
  }, BADGE_TICK_INTERVAL_MS);

  tickBadge().catch(() => {});
}

/**
 * Stop badge ticker and clear badge.
 * @returns {void}
 */
function stopBadgeTicker() {
  if (badgeTickIntervalId) clearInterval(badgeTickIntervalId);
  badgeTickIntervalId = null;
  setBadgeText('');
}

/**
 * Debounced storage change handler.
 * @returns {void}
 */
function handleStorageChanged() {
  tickBadge()
    .then(async () => {
      const { isInFlow, breakReminderEnabled, hasTask, expectedEndTime } = await readTimerStateFromStorage();
      const isActive = !!(isInFlow && breakReminderEnabled && hasTask && typeof expectedEndTime === 'number');
      if (isActive) startBadgeTicker();
      else stopBadgeTicker();
    })
    .catch(() => {});
}

try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes || typeof changes !== 'object') return;

    const relevantKeys = new Set([
      'isInFlow',
      'breakReminderEnabled',
      'currentTask',
      'reminderStartTime',
      'reminderInterval',
      'reminderExpectedEndTime'
    ]);

    const hasRelevantChange = Object.keys(changes).some((key) => relevantKeys.has(key));
    if (!hasRelevantChange) return;

    handleStorageChanged();
  });
} catch {
  // ignore
}

// Kick once on load in case Deep Work is already active.
handleStorageChanged();
