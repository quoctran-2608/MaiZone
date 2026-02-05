/**
 * MaiZone Browser Extension
 * Onboarding Page: Gentle 3-card quick start for new users
 * @feature f09 - Onboarding
 * @feature f05 - State Management
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @feature f08 - Mindfulness Reminders
 */

import { getStateSafely, updateStateSafely } from './state_helpers.js';
import { sendMessageSafely, sendMessageToTabSafely } from './messaging.js';
import { messageActions } from './actions.js';
import { MINDFULNESS_QUOTES, MINDFULNESS_STRETCH_REMINDERS } from './constants.js';

/***** ELEMENT REFERENCES *****/

const intentToggle = document.getElementById('onb-intent-toggle');
const openOptionsBtn = document.getElementById('onb-open-options');
const intentStatusEl = document.getElementById('onb-intent-status');

const taskInput = document.getElementById('onb-task-input');
const startDeepWorkBtn = document.getElementById('onb-start-deepwork');
const endDeepWorkBtn = document.getElementById('onb-end-deepwork');
const deepWorkStatusEl = document.getElementById('onb-deepwork-status');

const mindfulnessToggle = document.getElementById('onb-mindfulness-toggle');
const testMindfulnessBtn = document.getElementById('onb-test-mindfulness');
const mindfulnessStatusEl = document.getElementById('onb-mindfulness-status');

const finishBtn = document.getElementById('onb-finish');

/***** LOCAL UI STATE *****/

let currentState = {
  intentGateEnabled: true,
  mindfulnessReminderEnabled: false,
  isInFlow: false,
  currentTask: ''
};

/***** INIT *****/

document.addEventListener('DOMContentLoaded', initOnboarding);

/**
 * Initialize onboarding page.
 * @returns {void}
 */
function initOnboarding() {
  bindEvents();
  loadState();

  // Listen for background state updates (delta broadcast).
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== messageActions.stateUpdated) return;
    handleStateDelta(message.delta || message.state);
  });
}

/***** EVENTS *****/

/**
 * Bind UI events.
 * @returns {void}
 */
function bindEvents() {
  intentToggle?.addEventListener('change', () => {
    updateStateSafely({ intentGateEnabled: !!intentToggle.checked });
    setStatus(intentStatusEl, intentToggle.checked ? 'Đã bật.' : 'Đã tắt.', intentToggle.checked ? 'ok' : '');
  });

  openOptionsBtn?.addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch {
      // ignore
    }
  });

  mindfulnessToggle?.addEventListener('change', () => {
    updateStateSafely({ mindfulnessReminderEnabled: !!mindfulnessToggle.checked });
    setStatus(
      mindfulnessStatusEl,
      mindfulnessToggle.checked ? 'Đã bật (Mai sẽ không nhắc khi Deep Work).' : 'Đã tắt.',
      mindfulnessToggle.checked ? 'ok' : ''
    );
  });

  testMindfulnessBtn?.addEventListener('click', () => {
    testMindfulnessToast().catch(() => {});
  });

  startDeepWorkBtn?.addEventListener('click', () => {
    startDeepWorkFromInput().catch(() => {});
  });

  taskInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    startDeepWorkFromInput().catch(() => {});
  });

  endDeepWorkBtn?.addEventListener('click', () => {
    endDeepWork().catch(() => {});
  });

  finishBtn?.addEventListener('click', () => {
    markOnboardingDone({ closeTab: true }).catch(() => {});
  });
}

/***** STATE LOAD/SYNC *****/

/**
 * Load state needed for onboarding UI.
 * @returns {void}
 */
function loadState() {
  getStateSafely(['intentGateEnabled', 'mindfulnessReminderEnabled', 'isInFlow', 'currentTask'])
    .then((state) => {
      currentState = { ...currentState, ...(state || {}) };
      applyStateToUi(currentState);
    })
    .catch(() => {
      applyStateToUi(currentState);
    });
}

/**
 * Handle state delta from background broadcast.
 * @param {Object} delta - Partial state delta
 * @returns {void}
 */
function handleStateDelta(delta) {
  if (!delta || typeof delta !== 'object') return;
  currentState = { ...currentState, ...delta };
  applyStateToUi(currentState);
}

/**
 * Apply state to onboarding UI.
 * @param {Object} state - Partial state
 * @returns {void}
 */
function applyStateToUi(state) {
  const intentOn = !!state.intentGateEnabled;
  if (intentToggle) intentToggle.checked = intentOn;
  setStatus(intentStatusEl, intentOn ? 'Đang bật.' : 'Đang tắt.', intentOn ? 'ok' : '');

  const mindfulnessOn = !!state.mindfulnessReminderEnabled;
  if (mindfulnessToggle) mindfulnessToggle.checked = mindfulnessOn;
  setStatus(
    mindfulnessStatusEl,
    mindfulnessOn ? 'Đang bật (không nhắc khi Deep Work).' : 'Đang tắt.',
    mindfulnessOn ? 'ok' : ''
  );

  const inFlow = !!state.isInFlow;
  const task = typeof state.currentTask === 'string' ? state.currentTask.trim() : '';
  syncDeepWorkUi({ inFlow, task });
}

/***** CARD 2: DEEP WORK *****/

/**
 * Start Deep Work from the input field.
 * @feature f04 - Deep Work Mode
 * @returns {Promise<void>}
 */
async function startDeepWorkFromInput() {
  const task = typeof taskInput?.value === 'string' ? taskInput.value.trim() : '';
  if (!task) {
    setStatus(deepWorkStatusEl, 'Nhập 1 việc ngắn gọn trước nhé.', 'warn');
    taskInput?.focus?.();
    return;
  }

  setStatus(deepWorkStatusEl, 'Đang bắt đầu...', '');
  syncDeepWorkUi({ inFlow: true, task, optimistic: true });

  const response = await sendMessageSafely(
    {
      action: messageActions.resetBreakReminder,
      data: { task }
    },
    { timeoutMs: 4500 }
  );

  if (response?.success) {
    setStatus(deepWorkStatusEl, 'Đã vào flow. Cứ làm một việc thôi nhé 🌸', 'ok');
    return;
  }

  // Fallback: update state (background will sanitize/invariants).
  await updateStateSafely({
    currentTask: task,
    isInFlow: true,
    breakReminderEnabled: true
  });
  setStatus(deepWorkStatusEl, 'Đã vào flow. (Fallback)', 'ok');
}

/**
 * End Deep Work (exit flow).
 * @feature f04 - Deep Work Mode
 * @returns {Promise<void>}
 */
async function endDeepWork() {
  setStatus(deepWorkStatusEl, 'Đang kết thúc...', '');
  await updateStateSafely({ breakReminderEnabled: false, isInFlow: false, currentTask: '' });
  setStatus(deepWorkStatusEl, 'Đã kết thúc. Bạn có thể bắt đầu lại khi sẵn sàng.', 'ok');
}

/**
 * Sync Deep Work card UI.
 * @param {Object} data
 * @param {boolean} data.inFlow - Whether user is currently in flow
 * @param {string} data.task - Current task
 * @param {boolean} [data.optimistic=false] - Optimistic UI flag
 * @returns {void}
 */
function syncDeepWorkUi({ inFlow, task, optimistic = false }) {
  const safeTask = typeof task === 'string' ? task : '';
  const isActive = !!(inFlow && safeTask);

  if (!taskInput) return;
  if (!startDeepWorkBtn) return;
  if (!endDeepWorkBtn) return;

  taskInput.disabled = isActive;
  startDeepWorkBtn.disabled = isActive;
  endDeepWorkBtn.style.display = isActive ? 'inline-flex' : 'none';

  if (isActive && optimistic) return;
  if (!isActive) return;

  taskInput.value = safeTask;
}

/***** CARD 3: MINDFULNESS TEST *****/

/**
 * Pick a mindfulness message (quote or stretch).
 * @feature f08 - Mindfulness Reminders
 * @returns {string}
 */
function pickMindfulnessMessage() {
  const quotes = Array.isArray(MINDFULNESS_QUOTES) ? MINDFULNESS_QUOTES : [];
  const stretches = Array.isArray(MINDFULNESS_STRETCH_REMINDERS) ? MINDFULNESS_STRETCH_REMINDERS : [];
  const hasQuotes = quotes.length > 0;
  const hasStretches = stretches.length > 0;
  if (!hasQuotes && !hasStretches) return '🌸 Hít vào sâu. Thở ra chậm. Mỉm cười nhẹ.';

  const useQuote = hasQuotes && (!hasStretches || Math.random() < 0.5);
  const source = useQuote ? quotes : stretches;
  const message = source[Math.floor(Math.random() * source.length)];
  return typeof message === 'string' ? message : '';
}

/**
 * Get the active tab (http/https only).
 * @returns {Promise<{id:number, url:string}|null>}
 */
async function getActiveHttpTab() {
  if (!chrome?.tabs?.query) return null;

  const activeTab = await new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs?.[0] || null));
    } catch {
      resolve(null);
    }
  });

  const tabId = activeTab?.id;
  const url = typeof activeTab?.url === 'string' ? activeTab.url : '';
  if (typeof tabId !== 'number') return null;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;

  return { id: tabId, url };
}

/**
 * Best-effort: inject content scripts into a tab (helps existing tabs after reload).
 * @param {number} tabId - Chrome tab id
 * @returns {Promise<void>}
 */
async function ensureContentScriptsInjected(tabId) {
  if (!chrome?.scripting?.executeScript) return;
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
}

/**
 * Send a mindfulness toast to a tab (best-effort).
 * @param {number} tabId - Chrome tab id
 * @param {string} text - Toast text
 * @returns {Promise<boolean>}
 */
async function sendMindfulnessToastToTab(tabId, text) {
  const payload = {
    action: messageActions.mindfulnessToast,
    data: { text: typeof text === 'string' ? text : '' }
  };
  const reply = await sendMessageToTabSafely(tabId, payload, { timeoutMs: 1500 });
  return !!reply?.ok;
}

/**
 * Trigger a mindfulness toast immediately for testing.
 * @feature f08 - Mindfulness Reminders
 * @returns {Promise<void>}
 */
async function testMindfulnessToast() {
  setStatus(mindfulnessStatusEl, 'Đang gửi toast...', '');

  const tab = await getActiveHttpTab();
  if (!tab) {
    setStatus(mindfulnessStatusEl, 'Mở 1 trang web (http/https) để test nhé.', 'warn');
    return;
  }

  const text = pickMindfulnessMessage();
  if (!text) {
    setStatus(mindfulnessStatusEl, 'Không có câu nhắc để hiển thị.', 'warn');
    return;
  }

  const ok = await sendMindfulnessToastToTab(tab.id, text);
  if (ok) {
    setStatus(mindfulnessStatusEl, 'Đã gửi toast 🌸', 'ok');
    return;
  }

  await ensureContentScriptsInjected(tab.id);
  const okAfterInject = await sendMindfulnessToastToTab(tab.id, text);

  if (okAfterInject) {
    setStatus(mindfulnessStatusEl, 'Đã gửi toast 🌸', 'ok');
    return;
  }

  setStatus(mindfulnessStatusEl, 'Chưa gửi được toast (tab không hỗ trợ).', 'warn');
}

/***** FINISH / SKIP *****/

/**
 * Mark onboarding as done (so we can avoid showing it again by default).
 * @feature f09 - Onboarding
 * @param {Object} [options]
 * @param {boolean} [options.closeTab=false] - Close current tab best-effort
 * @returns {Promise<void>}
 */
async function markOnboardingDone({ closeTab = false } = {}) {
  await updateStateSafely({ hasSeenOnboarding: true });

  setStatus(intentStatusEl, intentToggle?.checked ? 'Đang bật.' : 'Đang tắt.', intentToggle?.checked ? 'ok' : '');
  setStatus(mindfulnessStatusEl, mindfulnessToggle?.checked ? 'Đang bật.' : 'Đang tắt.', mindfulnessToggle?.checked ? 'ok' : '');
  setStatus(deepWorkStatusEl, 'Xong rồi! Bạn có thể đóng tab này và mở popup để bắt đầu.', 'ok');

  if (!closeTab) return;

  try {
    // Works in most cases for tabs opened by the extension.
    window.close();
  } catch {
    // ignore
  }
}

/***** UI HELPERS *****/

/**
 * Set a small status message with optional type class.
 * @param {HTMLElement|null} el - Target element
 * @param {string} text - Status text
 * @param {'ok'|'warn'|''} kind - Status kind
 * @returns {void}
 */
function setStatus(el, text, kind = '') {
  if (!el) return;
  el.textContent = typeof text === 'string' ? text : '';
  el.classList.remove('ok', 'warn');
  if (kind) el.classList.add(kind);
}
