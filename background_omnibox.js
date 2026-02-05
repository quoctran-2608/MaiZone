/**
 * MaiZone Browser Extension
 * Omnibox Commands: "mai" keyword → address bar quick commands
 * @feature f11 - Omnibox Commands
 * @feature f13 - Intent Gate for Distracting Sites (integration)
 * @feature f04 - Deep Work Mode (integration)
 * @feature f06 - ClipMD (integration)
 * @feature f08 - Mindfulness Reminders (integration)
 */

import { messageActions } from './actions.js';
import { startClipmdMarkdownPicker } from './background_clipmd.js';
import { ensureInitialized, getState, updateState } from './background_state.js';
import { BREAK_REMINDER_INTERVAL } from './constants.js';
import { sendMessageToTabSafely } from './messaging.js';

/***** CONFIG *****/

const DEFAULT_DEEPWORK_TASK = 'Deep Work';
const DEFAULT_DEEPWORK_MINUTES = Math.round(BREAK_REMINDER_INTERVAL / 60000) || 40;
const MIN_DEEPWORK_MINUTES = 1;
const MAX_DEEPWORK_MINUTES = 24 * 60;

/***** UTILS *****/

/**
 * Normalize omnibox input (trim + collapse whitespace).
 * @param {string} input - Raw omnibox text (after keyword)
 * @returns {string}
 */
function normalizeInput(input) {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Check whether a URL is http/https.
 * @param {string} url - Full URL
 * @returns {boolean}
 */
function isHttpUrl(url) {
  if (typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Best-effort show a system notification (fallback when toast can't be delivered).
 * @param {string} message - Notification message (Vietnamese)
 * @returns {void}
 */
function showNotification(message) {
  try {
    if (!chrome?.notifications?.create) return;
    const text = typeof message === 'string' ? message : '';
    if (!text) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'MaiZone',
      message: text
    });
  } catch {
    // ignore
  }
}

/**
 * Get active tab (best-effort).
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function getActiveTab() {
  try {
    if (!chrome?.tabs?.query) return null;
    return await new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

/**
 * Ensure main content scripts exist on a tab (best-effort).
 * Useful after extension reload where existing tabs may not have them yet.
 * @param {number} tabId - Target tab id
 * @returns {Promise<boolean>} True if injected (or already present)
 */
async function ensureContentScriptsInjected(tabId) {
  try {
    if (!chrome?.scripting?.executeScript) return false;
    if (typeof tabId !== 'number') return false;

    return await new Promise((resolve) => {
      try {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['actions_global.js', 'content.js']
          },
          () => resolve(!chrome.runtime.lastError)
        );
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

/**
 * Show a small Mai toast on the active http/https tab (best-effort).
 * @param {string} text - Toast text
 * @returns {Promise<boolean>} True if delivered
 */
async function showMaiToastOnActiveTab(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return false;

  const tab = await getActiveTab();
  const tabId = tab?.id;
  const url = typeof tab?.url === 'string' ? tab.url : '';

  if (typeof tabId !== 'number') return false;
  if (!isHttpUrl(url)) return false;

  const reply = await sendMessageToTabSafely(
    tabId,
    { action: messageActions.maiToast, data: { text: message } },
    { timeoutMs: 1200 }
  );

  if (reply?.ok) return true;

  await ensureContentScriptsInjected(tabId);
  const retry = await sendMessageToTabSafely(
    tabId,
    { action: messageActions.maiToast, data: { text: message } },
    { timeoutMs: 1200 }
  );
  return !!retry?.ok;
}

/***** PARSING *****/

/**
 * @typedef {Object} OmniboxCommand
 * @property {'toggleBlock'|'toggleMind'|'startDeepWork'|'stopDeepWork'|'clip'|'help'|'noop'|'unknown'} kind
 * @property {boolean} [enabled]
 * @property {number|null} [minutes]
 * @property {string} [task]
 */

/**
 * Parse omnibox input into a command object.
 * @param {string} rawInput - Raw input after keyword
 * @returns {OmniboxCommand}
 */
function parseOmniboxCommand(rawInput) {
  const normalized = normalizeInput(rawInput);
  if (!normalized) return { kind: 'noop' };

  const tokens = normalized.split(' ');
  const head = (tokens[0] || '').toLowerCase();

  if (head === 'help' || head === '?') return { kind: 'help' };

  if (head === 'on') return { kind: 'toggleBlock', enabled: true };
  if (head === 'off') return { kind: 'toggleBlock', enabled: false };

  if (head === 'stop' || head === 'end' || head === 'cancel') return { kind: 'stopDeepWork' };

  if (head === 'clip' || head === 'clipmd') return { kind: 'clip' };

  if (head === 'mind' || head === 'mindfulness') {
    const mode = (tokens[1] || '').toLowerCase();
    if (mode === 'on') return { kind: 'toggleMind', enabled: true };
    if (mode === 'off') return { kind: 'toggleMind', enabled: false };
    return { kind: 'unknown' };
  }

  if (head === 'deepwork' || head === 'deep' || head === 'dw' || head === 'focus') {
    const second = (tokens[1] || '').toLowerCase();
    if (second === 'stop' || second === 'end' || second === 'cancel' || second === 'off') return { kind: 'stopDeepWork' };

    let minutes = null;
    let taskParts = [];

    const maybeMinutes = Number.parseInt(tokens[1], 10);
    if (Number.isFinite(maybeMinutes) && maybeMinutes > 0) {
      minutes = maybeMinutes;
      taskParts = tokens.slice(2);
    } else {
      taskParts = tokens.slice(1);
    }

    const task = taskParts.join(' ').trim();
    return { kind: 'startDeepWork', minutes, task };
  }

  return { kind: 'unknown' };
}

/***** SUGGESTIONS *****/

/**
 * Build a single omnibox suggestion entry.
 * @param {string} content - What gets inserted when user selects the suggestion
 * @param {string} description - Human-readable description (supports <match>/<dim>)
 * @returns {chrome.omnibox.SuggestResult}
 */
function suggestion(content, description) {
  return { content, description };
}

/**
 * Build omnibox suggestions based on current input + state.
 * @param {string} rawInput - Raw omnibox text after keyword
 * @param {Object} state - Current state snapshot (hydrated)
 * @returns {Array<chrome.omnibox.SuggestResult>}
 */
function buildSuggestions(rawInput, state) {
  const normalized = normalizeInput(rawInput).toLowerCase();
  const firstToken = normalized.split(' ')[0] || '';

  const s = state && typeof state === 'object' ? state : {};
  const gateOn = !!s.intentGateEnabled;
  const mindOn = !!s.mindfulnessReminderEnabled;
  const inFlow = !!(s.isInFlow && String(s.currentTask || '').trim());

  const statusGate = gateOn ? 'đang bật' : 'đang tắt';
  const statusMind = mindOn ? 'đang bật' : 'đang tắt';
  const statusFlow = inFlow ? 'đang Deep Work' : 'chưa Deep Work';

  const suggestions = [];

  const push = (content, title, meta) => {
    const extra = meta ? ` <dim>(${meta})</dim>` : '';
    suggestions.push(suggestion(content, `<match>${content}</match> <dim>${title}</dim>${extra}`));
  };

  // Order by current state (suggest the "next likely action" first).
  if (!firstToken || 'on'.startsWith(firstToken) || 'off'.startsWith(firstToken)) {
    if (gateOn) {
      push('off', 'Tắt hỏi lý do khi mở web sao nhãng', statusGate);
      push('on', 'Bật hỏi lý do khi mở web sao nhãng', statusGate);
    } else {
      push('on', 'Bật hỏi lý do khi mở web sao nhãng', statusGate);
      push('off', 'Tắt hỏi lý do khi mở web sao nhãng', statusGate);
    }
  }

  if (!firstToken || 'deepwork'.startsWith(firstToken) || 'dw'.startsWith(firstToken) || 'focus'.startsWith(firstToken)) {
    if (inFlow) {
      push('stop', 'Dừng Deep Work (reset task + timer)', statusFlow);
    } else {
      push(`deepwork ${DEFAULT_DEEPWORK_MINUTES}`, `Bắt đầu Deep Work ${DEFAULT_DEEPWORK_MINUTES} phút`, statusFlow);
      push(`deepwork ${DEFAULT_DEEPWORK_MINUTES} viết báo cáo`, 'Ví dụ: thêm task sau phút', 'tự sửa task tuỳ ý');
    }
  }

  if (!firstToken || 'stop'.startsWith(firstToken)) {
    push('stop', 'Dừng Deep Work (reset task + timer)', statusFlow);
  }

  if (!firstToken || 'mind'.startsWith(firstToken) || 'mindfulness'.startsWith(firstToken)) {
    if (mindOn) {
      push('mind off', 'Tắt nhắc mindfulness', statusMind);
      push('mind on', 'Bật nhắc mindfulness', statusMind);
    } else {
      push('mind on', 'Bật nhắc mindfulness', statusMind);
      push('mind off', 'Tắt nhắc mindfulness', statusMind);
    }
  }

  if (!firstToken || 'clip'.startsWith(firstToken)) {
    push('clip', 'ClipMD: chọn element → copy Markdown', 'tab hiện tại');
  }

  if (!firstToken || 'help'.startsWith(firstToken) || firstToken === '?') {
    push('help', 'Xem danh sách lệnh nhanh', 'gợi ý trong omnibox');
  }

  // If user typed something, filter by prefix (keep results relevant).
  if (normalized) {
    const filtered = suggestions.filter((item) => item.content.toLowerCase().startsWith(normalized));
    // If strict prefix filter yields nothing, fall back to first-token filter.
    if (filtered.length) return filtered.slice(0, 8);
  }

  return suggestions.slice(0, 8);
}

/***** EXECUTION *****/

/**
 * Start Deep Work with optional minutes + task.
 * @feature f04 - Deep Work Mode
 * @param {Object} options
 * @param {number|null} options.minutes - Minutes (1..1440) or null for default
 * @param {string} options.task - Task (optional)
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function startDeepWork({ minutes, task }) {
  const safeMinutes =
    typeof minutes === 'number' && Number.isFinite(minutes) ? Math.trunc(minutes) : DEFAULT_DEEPWORK_MINUTES;

  if (safeMinutes < MIN_DEEPWORK_MINUTES || safeMinutes > MAX_DEEPWORK_MINUTES) {
    return { ok: false, message: `Thời lượng không hợp lệ. Hãy dùng ${MIN_DEEPWORK_MINUTES}–${MAX_DEEPWORK_MINUTES} phút.` };
  }

  const intervalMs = safeMinutes * 60 * 1000;
  const rawTask = typeof task === 'string' ? task.trim() : '';

  // Best-effort: if user didn't provide a task, use a safe default.
  const nextTask = rawTask || DEFAULT_DEEPWORK_TASK;

  await updateState({
    currentTask: nextTask,
    isInFlow: true,
    breakReminderEnabled: true,
    reminderInterval: intervalMs,
    reminderStartTime: null,
    reminderExpectedEndTime: null
  });

  return { ok: true, message: `Bắt đầu Deep Work ${safeMinutes} phút. Gõ “mai stop” để dừng nhé.` };
}

/**
 * Stop Deep Work and clear timer/task.
 * @feature f04 - Deep Work Mode
 * @returns {Promise<{ok:boolean, message:string}>}
 */
async function stopDeepWork() {
  await updateState({
    isInFlow: false,
    currentTask: '',
    breakReminderEnabled: false
  });
  return { ok: true, message: 'Đã dừng Deep Work.' };
}

/**
 * Handle omnibox command execution.
 * @param {string} text - Input after keyword
 * @param {chrome.omnibox.OnInputEnteredDisposition} disposition - Where to open (unused for now)
 * @returns {Promise<void>}
 */
async function handleOmniboxInputEntered(text, disposition) {
  const command = parseOmniboxCommand(text);

  if (command.kind === 'noop') return;

  // MV3 reliability: omnibox can wake SW; hydrate state before relying on it.
  try {
    await ensureInitialized();
  } catch (error) {
    console.warn('🌸🌸🌸 Omnibox: ensureInitialized failed:', error);
  }

  try {
    if (command.kind === 'toggleBlock') {
      await updateState({ intentGateEnabled: !!command.enabled });
      const note = command.enabled
        ? 'Đã bật hỏi lý do khi mở web sao nhãng.'
        : 'Đã tắt hỏi lý do khi mở web sao nhãng.';
      const ok = await showMaiToastOnActiveTab(`🌸 ${note}`);
      if (!ok) showNotification(note);
      return;
    }

    if (command.kind === 'toggleMind') {
      await updateState({ mindfulnessReminderEnabled: !!command.enabled });
      const note = command.enabled ? 'Đã bật nhắc mindfulness.' : 'Đã tắt nhắc mindfulness.';
      const ok = await showMaiToastOnActiveTab(`🌸 ${note}`);
      if (!ok) showNotification(note);
      return;
    }

    if (command.kind === 'startDeepWork') {
      const result = await startDeepWork({ minutes: command.minutes ?? null, task: command.task || '' });
      const ok = await showMaiToastOnActiveTab(`🌸 ${result.message}`);
      if (!ok) showNotification(result.message);
      return;
    }

    if (command.kind === 'stopDeepWork') {
      const result = await stopDeepWork();
      const ok = await showMaiToastOnActiveTab(`🌸 ${result.message}`);
      if (!ok) showNotification(result.message);
      return;
    }

    if (command.kind === 'clip') {
      const okStart = await startClipmdMarkdownPicker({ source: 'omnibox' });
      if (okStart) {
        const ok = await showMaiToastOnActiveTab('🌸 ClipMD đã bật. Bạn click chọn element để copy Markdown nhé.');
        if (!ok) showNotification('ClipMD đã bật. Click chọn element để copy Markdown nhé.');
        return;
      }

      const ok = await showMaiToastOnActiveTab('🌸 Mai chưa bật được ClipMD trên tab này. Hãy mở trang http/https và thử lại nhé.');
      if (!ok) showNotification('Mai chưa bật được ClipMD trên tab này. Hãy mở trang http/https và thử lại nhé.');
      return;
    }

    if (command.kind === 'help') {
      const helpText = 'Lệnh: on/off • deepwork 40 [task] • stop • mind on/off • clip';
      const ok = await showMaiToastOnActiveTab(`🌸 ${helpText}`);
      if (!ok) showNotification(helpText);
      return;
    }

    // Unknown input: show gentle help.
    const ok = await showMaiToastOnActiveTab('🌸 Mai không hiểu lệnh này. Gõ “mai help” để xem danh sách lệnh nhé.');
    if (!ok) showNotification('Mai không hiểu lệnh này. Gõ “mai help” để xem danh sách lệnh nhé.');
  } catch (error) {
    console.error('🌸🌸🌸 Omnibox command error:', error);
    showNotification('Mai gặp lỗi khi xử lý lệnh. Thử lại giúp Mai nhé.');
  }
}

/***** PUBLIC INIT *****/

let hasInitializedOmnibox = false;

/**
 * Initialize omnibox handlers (idempotent).
 * @feature f11 - Omnibox Commands
 * @returns {void}
 */
export function initOmnibox() {
  if (hasInitializedOmnibox) return;
  hasInitializedOmnibox = true;

  if (!chrome?.omnibox?.onInputChanged || !chrome?.omnibox?.onInputEntered) {
    console.warn('🌸 Omnibox API unavailable; skipping omnibox init.');
    return;
  }

  try {
    chrome.omnibox.setDefaultSuggestion({
      description: 'MaiZone: gõ <match>on</match>/<match>off</match>, <match>deepwork 40</match>, <match>stop</match>, <match>mind on</match>/<match>mind off</match>, <match>clip</match>'
    });
  } catch {
    // ignore
  }

  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    (async () => {
      try {
        await ensureInitialized();
        const state = getState();
        suggest(buildSuggestions(text, state));
      } catch {
        suggest(buildSuggestions(text, null));
      }
    })();
  });

  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    // Fire-and-forget; Chrome doesn't await this handler.
    handleOmniboxInputEntered(text, disposition).catch((error) => {
      console.error('🌸🌸🌸 Omnibox handler crashed:', error);
    });
  });

  console.log('🌸 Omnibox commands ready (keyword: "mai")');
}
