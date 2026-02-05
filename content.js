/**
 * MaiZone Browser Extension
 * Content Script: Monitors text input fields, displays UI elements
 * @feature f00 - Text Input Detection
 * @feature f03 - Break Reminder (badge ticker fallback)
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @feature f07 - ChatGPT Zen Hotkeys (chatgpt.com)
 * @feature f08 - Mindfulness Reminders (toast)
 * @feature f10 - Context Menu Quick Actions (toast)
 * @feature f15 - YouTube Auto Skip Ads (youtube.com)
 * @feature f16 - Gemini Zen Hotkeys (gemini.google.com)
 * @feature f17 - X.com Status Cleanup
 */

// Content scripts can be programmatically injected multiple times (install/update, retries).
// Wrap in an IIFE so repeated injections don't crash on top-level re-declarations.
(() => {

/******************************************************************************
 * MESSAGING (COMPAT LAYER)
 ******************************************************************************/

// Some browsers/versions may treat content scripts as classic scripts (no static `import`).
// Keep a local safe messaging helper to avoid module import issues entirely.

/**
 * Check whether extension context is still valid.
 * @returns {boolean} True if safe to call chrome.runtime APIs
 */
function isExtensionContextValid() {
  return !!(globalThis?.chrome?.runtime && chrome.runtime.id !== undefined);
}

/**
 * Send a message to the background script safely (timeout + invalidation handling).
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=2000] - Timeout in ms
 * @returns {Promise<any|null>} Response object or null on failure/timeout
 */
async function sendMessageSafely(message, { timeoutMs = 2000 } = {}) {
  try {
    if (!isExtensionContextValid()) return null;

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (reply) => {
          clearTimeout(timeoutId);

          const lastError = chrome.runtime.lastError;
          if (lastError) {
            resolve(null);
            return;
          }

          resolve(reply);
        });
      } catch (innerError) {
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) return null;
    return null;
  }
}

/******************************************************************************
 * VARIABLES AND CONFIGURATION
 ******************************************************************************/

// Constants specific to content.js
const TYPING_INTERVAL = 500; // Typing detection interval (ms)

// [f07] ChatGPT helpers (domain-scoped; safe no-op elsewhere).
const CHATGPT_HOST_SUFFIX = 'chatgpt.com';
const CHATGPT_ZEN_STORAGE_KEY = 'chatgptZenMode';
const CHATGPT_ZEN_SELECTORS = Object.freeze(['.cursor-pointer', '#page-header', '#thread-bottom', '#full_editor']);
const CHATGPT_TEMPLATE = "You are very smart, intellectually curious, empathetic, patient, nurturing, and engaging. You proceed in small steps, asking if the user understands and has completed a step, and waiting for their answer before continuing. You should be concise, direct, and without unnecessary explanations or summaries. Avoid giving unnecessary details or deviating from the user's request, focusing solely on the specific question at hand. Trình bày output text dưới dạng văn xuôi, dễ hiểu, ít gạch đầu dòng. Các lệnh tắt cần ghi nhớ: `vx`: là lệnh cho bạn viết lại phản hồi gần nhất dưới dạng văn xuôi. `vd`: là lệnh cho bạn cho thêm ví dụ minh hoạ cho phản hồi gần nhất.";

// [f16] Gemini Zen (default OFF): hide clutter on gemini.google.com
const GEMINI_HOST_SUFFIX = 'gemini.google.com';
const GEMINI_ZEN_STORAGE_KEY = 'geminiZenMode';
const GEMINI_ZEN_SELECTORS = Object.freeze([
  'input-container',
  'hallucination-disclaimer',
  'top-bar-actions',
  'div[data-test-id="chat-app"].side-nav-menu-button',
  'div.desktop-ogb-buffer',
  'bard-sidenav'
]);

// [f12] arXiv Zen (default ON): hide clutter on arxiv.org/html/*
const ARXIV_HOST = 'arxiv.org';
const ARXIV_ZEN_STORAGE_KEY = 'arxivZenMode';
const ARXIV_ZEN_HIDE_SELECTORS = Object.freeze([
  'header.mob_header',
  'header.desktop_header',
  'button#openForm',
  'footer#footer',
  'nav.ltx_TOC'
]);

// [f15] YouTube auto-skip ads.
const YOUTUBE_HOST_SUFFIX = 'youtube.com';
const YOUTUBE_SKIP_AD_SELECTORS = Object.freeze([
  'button.ytp-skip-ad-button.ytp-ad-component--clickable',
  'button.ytp-skip-ad-button'
]);
const YOUTUBE_SKIP_CLICK_COOLDOWN_MS = 800;

// [f17] X.com status cleanup (hide right-rail container on status pages).
const X_HOST_SUFFIX = 'x.com';
const X_STATUS_PATH_REGEX = /^\/[^/]+\/status\/\d+(?:\/|$)/i;
const X_STATUS_HIDE_SELECTORS = Object.freeze([
  '#react-root main div[data-testid="sidebarColumn"]',
  '#react-root > div > div > div.css-175oi2r.r-1f2l425.r-13qz1uu.r-417010.r-18u37iz > main > div > div > div > div.css-175oi2r.r-14lw9ot.r-jxzhtn.r-1ua6aaf.r-th6na.r-1phboty.r-16y2uox.r-184en5c.r-1abdc3e.r-1lg4w6u.r-f8sm7e.r-13qz1uu.r-1ye8kvj > div > div.css-175oi2r.r-aqfbo4.r-gtdqiz.r-1gn8etr.r-4zbufd.r-1g40b8q',
  '#react-root > div > div > div.css-175oi2r.r-1f2l425.r-13qz1uu.r-417010.r-18u37iz > main > div > div > div > div.css-175oi2r.r-aqfbo4.r-1l8l4mf.r-1hycxz'
]);
const X_STATUS_APPLY_DEBOUNCE_MS = 180;
const X_STATUS_POLL_INTERVAL_MS = 5000;

// [f03] Opera badge tick fallback: keep badge updated per-second by keeping the SW active via a Port.
const OPERA_BADGE_PORT_NAME = 'maizoneBreakReminderBadgeTicker';
const OPERA_BADGE_PORT_KEEPALIVE_MS = 25_000;

// Message actions (prefer shared global injected via `actions_global.js`).
const messageActions = globalThis.MAIZONE_ACTIONS || Object.freeze({
  maiToast: 'maiToast',
  mindfulnessToast: 'mindfulnessToast',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  breakReminderBadgeTick: 'breakReminderBadgeTick',
  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});

// Global variables
let currentElement = null;
let lastContentLength = 0;
let typingTimer = null;
let domListenersAttached = false;

// [f03] Opera badge tick fallback state
let operaBadgePort = null;
let operaBadgePortKeepaliveIntervalId = null;

// [f07] ChatGPT helpers state
let isChatgptZenModeEnabled = false;
let chatgptZenObserver = null;
let chatgptZenApplyTimeoutId = null;
let chatgptToastTimeoutId = null;

// [f16] Gemini Zen state
let isGeminiZenModeEnabled = false;
let geminiZenObserver = null;
let geminiZenApplyTimeoutId = null;

// [f12] arXiv Zen state
let isArxivZenModeEnabled = true; // default ON
let arxivZenObserver = null;
let arxivZenApplyTimeoutId = null;

// [f15] YouTube auto-skip state
let youtubeSkipObserver = null;
let youtubeSkipApplyTimeoutId = null;
let lastYoutubeSkipClickAt = 0;

// [f17] X.com status cleanup state
let xStatusObserver = null;
let xStatusApplyTimeoutId = null;
let isXStatusCleanupActive = false;
let xStatusPollIntervalId = null;

let mindfulnessToastTimeoutId = null;
let mindfulnessToastFadeTimeoutId = null;
let mindfulnessAudioContext = null;
let mindfulnessAudioUnlocked = false;
let hasRegisteredMindfulnessAudioUnlock = false;

// Generic Mai toast (non-mindfulness)
let maiToastTimeoutId = null;
let maiToastFadeTimeoutId = null;

// (reserved for future feature flags)

/******************************************************************************
 * INITIALIZATION
 ******************************************************************************/

/**
 * Initialize content script
 */
function initialize() {
  // Prevent double-initialization if this file gets programmatically injected.
  if (globalThis.__MAIZONE_CONTENT_SCRIPT_INITIALIZED) return;
  globalThis.__MAIZONE_CONTENT_SCRIPT_INITIALIZED = true;

  console.log('🌸 Mai content script initialized');

  // Load settings early so we can avoid unnecessary work for disabled features
  chrome.storage.local.get(
    [CHATGPT_ZEN_STORAGE_KEY, GEMINI_ZEN_STORAGE_KEY, ARXIV_ZEN_STORAGE_KEY, 'isInFlow', 'breakReminderEnabled', 'currentTask'],
    (result) => {
      const rawChatgptZenMode = result?.[CHATGPT_ZEN_STORAGE_KEY];
      isChatgptZenModeEnabled = typeof rawChatgptZenMode === 'boolean' ? rawChatgptZenMode : false;

      const rawGeminiZenMode = result?.[GEMINI_ZEN_STORAGE_KEY];
      isGeminiZenModeEnabled = typeof rawGeminiZenMode === 'boolean' ? rawGeminiZenMode : false;

      // arXiv Zen defaults to true
      const rawArxivZenMode = result?.[ARXIV_ZEN_STORAGE_KEY];
      isArxivZenModeEnabled = typeof rawArxivZenMode === 'boolean' ? rawArxivZenMode : true;

      syncContentScriptActiveState();
      syncOperaBadgeTickFallback(result || {});
    }
  );
  
  // Listen for messages from background script (attach once; will ignore when disabled)
  chrome.runtime.onMessage.addListener(handleBackgroundMessages);

  // [f04c] Listen for deep work status changes and settings
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[CHATGPT_ZEN_STORAGE_KEY]) {
      const nextValue = changes[CHATGPT_ZEN_STORAGE_KEY]?.newValue;
      isChatgptZenModeEnabled = typeof nextValue === 'boolean' ? nextValue : false;
      syncChatgptHelperActiveState();
    }

    if (changes[GEMINI_ZEN_STORAGE_KEY]) {
      const nextValue = changes[GEMINI_ZEN_STORAGE_KEY]?.newValue;
      isGeminiZenModeEnabled = typeof nextValue === 'boolean' ? nextValue : false;
      syncGeminiZenActiveState();
    }

    if (changes[ARXIV_ZEN_STORAGE_KEY]) {
      const nextValue = changes[ARXIV_ZEN_STORAGE_KEY]?.newValue;
      isArxivZenModeEnabled = typeof nextValue === 'boolean' ? nextValue : true;
      syncArxivZenActiveState();
    }

    if (changes.isInFlow) {
      console.log('🌸 Deep Work status changed:', changes.isInFlow.newValue);
    }

    // [f03] Opera badge tick fallback: sync on any timer-related change.
    if (
      changes.isInFlow ||
      changes.breakReminderEnabled ||
      changes.currentTask ||
      changes.reminderStartTime ||
      changes.reminderInterval ||
      changes.reminderExpectedEndTime
    ) {
      syncOperaBadgeTickFallback();
    }
  });
}

/**
 * Attach DOM listeners only when extension is enabled.
 * @returns {void}
 */
function attachDomListeners() {
  if (domListenersAttached) return;

  console.log('🌸 Attaching DOM listeners (keydown, etc.)');
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('click', handleClick);
  document.addEventListener('visibilitychange', () => {
    syncOperaBadgeTickFallback();
  });
  setupMindfulnessAudioUnlockListeners();

  domListenersAttached = true;
}

/**
 * Sync features based on current settings.
 * @returns {void}
 */
function syncContentScriptActiveState() {
  attachDomListeners();

  syncChatgptHelperActiveState();
  syncGeminiZenActiveState();
  syncArxivZenActiveState();
  syncYoutubeSkipAdActiveState();
  syncXStatusCleanupActiveState();
}

/******************************************************************************
 * OPERA BADGE TICK FALLBACK [f03]
 ******************************************************************************/

/**
 * Check whether the browser is Opera (best-effort via UA marker).
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

/**
 * Determine whether Deep Work timer is active (privacy-first: no task content logging).
 * @param {Object} data - Storage snapshot
 * @returns {boolean}
 */
function isDeepWorkTimerActive(data) {
  const isInFlow = !!data?.isInFlow;
  const breakReminderEnabled = !!data?.breakReminderEnabled;
  const hasTask = !!(data?.currentTask && String(data.currentTask).trim());
  return !!(isInFlow && breakReminderEnabled && hasTask);
}

/**
 * Start per-second ticker that wakes SW to update badge.
 * @returns {void}
 */
function startOperaBadgeTickFallback() {
  if (operaBadgePort) return;

  try {
    operaBadgePort = chrome.runtime.connect({ name: OPERA_BADGE_PORT_NAME });
  } catch {
    operaBadgePort = null;
    return;
  }

  try {
    operaBadgePort.onDisconnect.addListener(() => {
      operaBadgePort = null;
      if (operaBadgePortKeepaliveIntervalId) clearInterval(operaBadgePortKeepaliveIntervalId);
      operaBadgePortKeepaliveIntervalId = null;
      syncOperaBadgeTickFallback();
    });
  } catch {
    // ignore
  }

  // Keepalive: some browsers may still stop the SW if no events arrive.
  operaBadgePortKeepaliveIntervalId = setInterval(() => {
    try {
      operaBadgePort?.postMessage?.({ type: 'keepalive' });
    } catch {
      // ignore
    }
  }, OPERA_BADGE_PORT_KEEPALIVE_MS);

  // Ask background to start per-second badge ticker (best-effort).
  try {
    operaBadgePort.postMessage({ type: 'start' });
  } catch {
    // ignore
  }

  // Also kick a one-off tick message for immediate update on some browsers.
  sendMessageSafely({ action: messageActions.breakReminderBadgeTick }, { timeoutMs: 800 }).catch(() => {});
}

/**
 * Stop Opera badge tick fallback.
 * @returns {void}
 */
function stopOperaBadgeTickFallback() {
  if (operaBadgePortKeepaliveIntervalId) clearInterval(operaBadgePortKeepaliveIntervalId);
  operaBadgePortKeepaliveIntervalId = null;

  try {
    operaBadgePort?.postMessage?.({ type: 'stop' });
  } catch {
    // ignore
  }

  try {
    operaBadgePort?.disconnect?.();
  } catch {
    // ignore
  }

  operaBadgePort = null;
}

/**
 * Sync Opera badge tick fallback with current timer state (only runs on Opera).
 * @param {Object} [prefetched] - Optional storage snapshot to avoid extra reads
 * @returns {void}
 */
function syncOperaBadgeTickFallback(prefetched) {
  if (!isOperaBrowser()) return;

  const syncWithData = (data) => {
    const shouldRun = isDeepWorkTimerActive(data);
    if (shouldRun) startOperaBadgeTickFallback();
    else stopOperaBadgeTickFallback();
  };

  if (prefetched && typeof prefetched === 'object') {
    syncWithData(prefetched);
    return;
  }

  try {
    chrome.storage.local.get(['isInFlow', 'breakReminderEnabled', 'currentTask'], (data) => syncWithData(data || {}));
  } catch {
    stopOperaBadgeTickFallback();
  }
}


/******************************************************************************
 * EVENT HANDLERS
 ******************************************************************************/

/**
 * [f00] Xử lý sự kiện khi người dùng focus vào một text input element
 * Phần cốt lõi của tính năng f00 - nhận diện khi text input elem được focus
 * @param {FocusEvent} event - The focus event object
 * @returns {void}
 */
function handleFocusIn(event) {
  try {
    const element = event.target;
    if (isTextInput(element)) {
      setCurrentElement(element);
      console.log('🌸 Text field focused:', {
        tag: element.tagName.toLowerCase(),
        id: element.id || 'no-id',
        class: element.className || 'no-class',
        placeholder: element.placeholder || ''
      });
    }
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) {
      // Extension was updated or reloaded - quietly fail
      console.warn('🌸🌸🌸 Extension context invalidated during focus handling');
      return;
    }
    console.warn('🌸🌸🌸 Error in handleFocusIn:', error);
  }
}

/**
 * Handle click on text input elements
 */
function handleClick(event) {
  try {
    const element = event.target;
    if (isTextInput(element) && element !== currentElement) {
      setCurrentElement(element);
    }
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('Extension context invalidated')) {
      // Extension was updated or reloaded - quietly fail
      console.warn('🌸🌸🌸 Extension context invalidated during click handling');
      return;
    }
    console.warn('🌸🌸🌸 Error in handleClick:', error);
  }
}

/**
 * Handle typing events (shared by keydown and keyup)
 */
function handleTypingEvent(event) {
  if (!currentElement) return;
  
  clearTimeout(typingTimer);

  if (event?.key === 'Enter' && !event.shiftKey) {
    captureCurrentContent();
    return;
  }

  typingTimer = setTimeout(() => captureCurrentContent(), TYPING_INTERVAL);
}

/**
 * Handle keydown events
 */
function handleKeyDown(event) {
  // Debug: log Alt key presses
  if (event?.altKey && !event.repeat) {
    console.log('🌸 Alt keydown detected:', event.key);
  }
  if (handleBreakReminderHotkey(event)) return;
  if (handleMindfulnessHotkey(event)) return;
  if (handleChatgptHotkeys(event)) return;
  if (handleGeminiHotkeys(event)) return;
  if (handleClipmdHotkey(event)) return;
  handleTypingEvent(event);
}

/**
 * Handle keyup events
 */
function handleKeyUp(event) {
  handleTypingEvent(event);
}

/******************************************************************************
 * CLIPMD HOTKEY (IN-PAGE FALLBACK) [f06]
 ******************************************************************************/

/**
 * Fallback hotkey handler for ClipMD when Chrome shortcuts are not configured.
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleClipmdHotkey(event) {
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== 'q') return false;

  event.preventDefault?.();
  event.stopPropagation?.();

  // Prefer the "native" inspect overlay flow (background), fallback to in-page picker.
  (async () => {
    const reply = await sendMessageSafely(
      { action: messageActions.clipmdStart, data: { mode: 'markdown', source: 'contentHotkey' } },
      { timeoutMs: 2500 }
    );

    if (reply?.success) return;
    startClipmdPickMode();
  })();

  return true;
}

/******************************************************************************
 * MINDFULNESS / BREAK HOTKEY FALLBACK [f08] [f03]
 ******************************************************************************/

/**
 * Fallback hotkey handler for mindfulness toast (Alt+A).
 * @feature f08 - Mindfulness Reminders
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleMindfulnessHotkey(event) {
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== 'a') return false;

  event.preventDefault?.();
  event.stopPropagation?.();

  sendMessageSafely({ action: messageActions.triggerMindfulnessToast }, { timeoutMs: 4000 }).catch(() => {});
  return true;
}

/**
 * Fallback hotkey handler for exercise reminder (Alt+Shift+A).
 * @feature f14 - Exercise Reminder
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleBreakReminderHotkey(event) {
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (!event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== 'a') return false;

  event.preventDefault?.();
  event.stopPropagation?.();

  sendMessageSafely({ action: messageActions.triggerExerciseReminder }, { timeoutMs: 2000 }).catch(() => {});
  return true;
}

/******************************************************************************
 * CHATGPT ZEN HOTKEYS (chatgpt.com) [f07]
 ******************************************************************************/

/**
 * Check whether current page is chatgpt.com (or subdomain).
 * @returns {boolean}
 */
function isChatgptHost() {
  const host = (window.location?.hostname || '').toLowerCase();
  return host === CHATGPT_HOST_SUFFIX || host.endsWith(`.${CHATGPT_HOST_SUFFIX}`);
}

/**
 * Sync ChatGPT helper effects with current enabled state.
 * @returns {void}
 */
function syncChatgptHelperActiveState() {
  if (!isChatgptHost()) return;

  if (isChatgptZenModeEnabled) {
    applyChatgptZenMode(true, { scope: 'all' });
    startChatgptZenObserver();
    return;
  }

  stopChatgptZenObserver();
  restoreAllChatgptZenHiddenElements();
}

/**
 * Handle ChatGPT-only hotkeys.
 * - Alt+Z: toggle "Zen" (hide/show selected UI blocks)
 * - Alt+S: paste a prompt template into the current editor
 * @feature f07 - ChatGPT Zen Hotkeys (chatgpt.com)
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleChatgptHotkeys(event) {
  if (!isChatgptHost()) return false;
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

  if (key === 'z') {
    toggleChatgptZenMode();
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  if (key === 's') {
    const ok = pasteChatgptTemplate();
    if (!ok) showChatgptToast('🌸 Không tìm thấy ô để dán. Click vào ô nhập trước nhé.');
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  }

  return false;
}

/**
 * Toggle Zen mode and persist to storage.
 * @returns {void}
 */
function toggleChatgptZenMode() {
  isChatgptZenModeEnabled = !isChatgptZenModeEnabled;
  syncChatgptHelperActiveState();

  try {
    chrome.storage.local.set({ [CHATGPT_ZEN_STORAGE_KEY]: isChatgptZenModeEnabled });
  } catch {
    // ignore (context may be invalidated)
  }

  showChatgptToast(isChatgptZenModeEnabled ? '🌸 Zen mode: ON (Alt+Z để tắt)' : '🌸 Zen mode: OFF (Alt+Z để bật)');
}

/**
 * Apply or restore Zen mode for known selectors.
 * @param {boolean} enable - True to hide, false to restore
 * @param {Object} [options]
 * @param {'all'|'observed'} [options.scope='all'] - Apply to all selectors or only "stable" observed selectors
 * @returns {void}
 */
function applyChatgptZenMode(enable, { scope = 'all' } = {}) {
  const selectors =
    scope === 'observed' ? CHATGPT_ZEN_SELECTORS.filter((s) => typeof s === 'string' && s.trim().startsWith('#')) : CHATGPT_ZEN_SELECTORS;

  if (!enable) {
    restoreAllChatgptZenHiddenElements();
    return;
  }

  selectors.forEach((selector) => {
    if (typeof selector !== 'string') return;
    const el = document.querySelector(selector);
    if (!el) return;
    hideElementForZen(el);
  });
}

/**
 * Hide an element and remember its previous inline display.
 * @param {Element} el - DOM element
 * @returns {void}
 */
function hideElementForZen(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneZenHidden === '1') return;

  const prevDisplay = el.style.display;
  const prevPriority = el.style.getPropertyPriority?.('display') || '';

  el.dataset.maizoneZenHidden = '1';
  el.dataset.maizoneZenPrevDisplay = prevDisplay;
  el.dataset.maizoneZenPrevDisplayPriority = prevPriority;

  try {
    el.style.setProperty('display', 'none', 'important');
  } catch {
    el.style.display = 'none';
  }
}

/**
 * Restore all elements hidden by Zen mode.
 * @returns {void}
 */
function restoreAllChatgptZenHiddenElements() {
  try {
    const hiddenEls = document.querySelectorAll('[data-maizone-zen-hidden="1"]');
    hiddenEls.forEach((el) => restoreElementFromZen(el));
  } catch {
    // ignore
  }
}

/**
 * Restore a single element that was hidden by Zen mode.
 * @param {Element} el - DOM element
 * @returns {void}
 */
function restoreElementFromZen(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneZenHidden !== '1') return;

  const prevDisplay = typeof el.dataset.maizoneZenPrevDisplay === 'string' ? el.dataset.maizoneZenPrevDisplay : '';
  const prevPriority = typeof el.dataset.maizoneZenPrevDisplayPriority === 'string' ? el.dataset.maizoneZenPrevDisplayPriority : '';

  if (prevDisplay) {
    try {
      el.style.setProperty('display', prevDisplay, prevPriority || '');
    } catch {
      el.style.display = prevDisplay;
    }
  } else {
    try {
      el.style.removeProperty('display');
    } catch {
      el.style.display = '';
    }
  }

  delete el.dataset.maizoneZenHidden;
  delete el.dataset.maizoneZenPrevDisplay;
  delete el.dataset.maizoneZenPrevDisplayPriority;
}

/**
 * Start a lightweight observer to re-apply Zen for stable selectors on SPA DOM changes.
 * NOTE: Only re-applies ID selectors to avoid creeping hides on broad class selectors.
 * @returns {void}
 */
function startChatgptZenObserver() {
  if (!isChatgptHost()) return;
  if (!isChatgptZenModeEnabled) return;
  if (chatgptZenObserver) return;

  const root = document.documentElement;
  if (!root) return;

  chatgptZenObserver = new MutationObserver(() => scheduleChatgptZenObservedApply());
  chatgptZenObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Stop Zen observer.
 * @returns {void}
 */
function stopChatgptZenObserver() {
  try {
    chatgptZenObserver?.disconnect?.();
  } catch {
    // ignore
  }
  chatgptZenObserver = null;

  clearTimeout(chatgptZenApplyTimeoutId);
  chatgptZenApplyTimeoutId = null;
}

/**
 * Debounce observed Zen re-apply to keep overhead low on streaming UIs.
 * @returns {void}
 */
function scheduleChatgptZenObservedApply() {
  if (!isChatgptHost()) return;
  if (!isChatgptZenModeEnabled) return;
  if (chatgptZenApplyTimeoutId) return;

  chatgptZenApplyTimeoutId = setTimeout(() => {
    chatgptZenApplyTimeoutId = null;
    applyChatgptZenMode(true, { scope: 'observed' });
  }, 180);
}

/**
 * Paste the prompt template into the active editor (or ChatGPT composer as fallback).
 * @returns {boolean} True if paste succeeded
 */
function pasteChatgptTemplate() {
  const active = document.activeElement;
  if (setEditableText(active, CHATGPT_TEMPLATE)) {
    showChatgptToast('🌸 Đã dán prompt mẫu (Alt+S).');
    return true;
  }

  const fallback = findChatgptComposerElement();
  if (fallback && setEditableText(fallback, CHATGPT_TEMPLATE)) {
    showChatgptToast('🌸 Đã dán prompt mẫu (Alt+S).');
    return true;
  }

  return false;
}

/**
 * Attempt to locate ChatGPT composer textarea for convenience.
 * @returns {HTMLElement|null}
 */
function findChatgptComposerElement() {
  const candidates = [
    'textarea#prompt-textarea',
    'textarea[name="prompt"]',
    'form textarea',
    'textarea'
  ];

  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (!el || !(el instanceof HTMLElement)) continue;
    if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) continue; // hidden
    return el;
  }

  return null;
}

/**
 * Set text for an editable element and dispatch input events so React/Vue can detect changes.
 * @param {Element|null} el - Target element
 * @param {string} text - Text to set
 * @returns {boolean} True if updated
 */
function setEditableText(el, text) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const nextText = typeof text === 'string' ? text : '';

  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (inputType === 'password') return false;
    el.focus?.();
    el.value = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    el.dispatchEvent?.(new Event('change', { bubbles: true }));
    try {
      el.setSelectionRange?.(nextText.length, nextText.length);
    } catch {
      // ignore
    }
    return true;
  }

  if (tag === 'textarea') {
    el.focus?.();
    el.value = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    el.dispatchEvent?.(new Event('change', { bubbles: true }));
    try {
      el.setSelectionRange?.(nextText.length, nextText.length);
    } catch {
      // ignore
    }
    return true;
  }

  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    el.focus?.();
    el.textContent = nextText;
    el.dispatchEvent?.(new Event('input', { bubbles: true }));
    return true;
  }

  return false;
}

/**
 * Show a minimal toast on ChatGPT to confirm actions.
 * @param {string} text - Toast text
 * @returns {void}
 */
function showChatgptToast(text) {
  if (!isChatgptHost()) return;
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  let el = document.getElementById('mai-chatgpt-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-chatgpt-toast';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: '92vw',
      padding: '10px 12px',
      borderRadius: '12px',
      backgroundColor: 'rgba(0,0,0,0.85)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '13px',
      lineHeight: '1.25',
      boxShadow: '0 6px 18px rgba(0,0,0,0.28)'
    });
    document.documentElement.appendChild(el);
  }

  el.textContent = message;

  clearTimeout(chatgptToastTimeoutId);
  chatgptToastTimeoutId = setTimeout(() => {
    removeChatgptToast();
  }, 1200);
}

/**
 * Remove ChatGPT toast (if any).
 * @returns {void}
 */
function removeChatgptToast() {
  clearTimeout(chatgptToastTimeoutId);
  chatgptToastTimeoutId = null;
  document.getElementById('mai-chatgpt-toast')?.remove?.();
}

/******************************************************************************
 * GEMINI ZEN HOTKEYS (gemini.google.com) [f16]
 ******************************************************************************/

/**
 * Check whether current page is gemini.google.com (or subdomain).
 * @returns {boolean}
 */
function isGeminiHost() {
  const host = (window.location?.hostname || '').toLowerCase();
  return host === GEMINI_HOST_SUFFIX || host.endsWith(`.${GEMINI_HOST_SUFFIX}`);
}

/**
 * Sync Gemini Zen effects with current enabled state.
 * @returns {void}
 */
function syncGeminiZenActiveState() {
  if (!isGeminiHost()) return;

  if (isGeminiZenModeEnabled) {
    applyGeminiZenMode(true);
    startGeminiZenObserver();
    return;
  }

  stopGeminiZenObserver();
  restoreAllGeminiZenHiddenElements();
}

/**
 * Handle Gemini-only hotkeys.
 * - Alt+Z: toggle "Zen" (hide/show selected UI blocks)
 * @feature f16 - Gemini Zen Hotkeys (gemini.google.com)
 * @param {KeyboardEvent} event - Keyboard event
 * @returns {boolean} True if handled
 */
function handleGeminiHotkeys(event) {
  if (!isGeminiHost()) return false;
  if (!event?.isTrusted) return false;
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.shiftKey) return false;
  if (event.repeat) return false;

  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== 'z') return false;

  toggleGeminiZenMode();
  event.preventDefault?.();
  event.stopPropagation?.();
  return true;
}

/**
 * Toggle Gemini Zen mode and persist to storage.
 * @returns {void}
 */
function toggleGeminiZenMode() {
  isGeminiZenModeEnabled = !isGeminiZenModeEnabled;
  syncGeminiZenActiveState();

  try {
    chrome.storage.local.set({ [GEMINI_ZEN_STORAGE_KEY]: isGeminiZenModeEnabled });
  } catch {
    // ignore (context may be invalidated)
  }

  if (isGeminiZenModeEnabled) {
    showMaiToast('🌸 Gemini Zen mode: ON (Alt+Z để tắt)');
  } else {
    showMaiToast('🌸 Gemini Zen mode: OFF (Alt+Z để bật)');
  }
}

/**
 * Apply or restore Gemini Zen mode.
 * @param {boolean} enable - True to hide, false to restore
 * @returns {void}
 */
function applyGeminiZenMode(enable) {
  if (!enable) {
    restoreAllGeminiZenHiddenElements();
    return;
  }

  GEMINI_ZEN_SELECTORS.forEach((selector) => {
    if (typeof selector !== 'string') return;
    const nodes = document.querySelectorAll(selector);
    nodes.forEach((el) => hideElementForZen(el));
  });
}

/**
 * Restore all elements hidden by Gemini Zen mode.
 * @returns {void}
 */
function restoreAllGeminiZenHiddenElements() {
  try {
    const hiddenEls = document.querySelectorAll('[data-maizone-zen-hidden="1"]');
    hiddenEls.forEach((el) => restoreElementFromZen(el));
  } catch {
    // ignore
  }
}

/**
 * Start a lightweight observer to re-apply Zen on DOM changes.
 * @returns {void}
 */
function startGeminiZenObserver() {
  if (!isGeminiHost()) return;
  if (!isGeminiZenModeEnabled) return;
  if (geminiZenObserver) return;

  const root = document.documentElement;
  if (!root) return;

  geminiZenObserver = new MutationObserver(() => scheduleGeminiZenApply());
  geminiZenObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Stop Gemini Zen observer.
 * @returns {void}
 */
function stopGeminiZenObserver() {
  try {
    geminiZenObserver?.disconnect?.();
  } catch {
    // ignore
  }
  geminiZenObserver = null;
  clearTimeout(geminiZenApplyTimeoutId);
  geminiZenApplyTimeoutId = null;
}

/**
 * Debounce Gemini Zen re-apply to keep overhead low.
 * @returns {void}
 */
function scheduleGeminiZenApply() {
  if (!isGeminiHost()) return;
  if (!isGeminiZenModeEnabled) return;
  if (geminiZenApplyTimeoutId) return;

  geminiZenApplyTimeoutId = setTimeout(() => {
    geminiZenApplyTimeoutId = null;
    applyGeminiZenMode(true);
  }, 180);
}

/******************************************************************************
 * ARXIV ZEN MODE [f12]
 ******************************************************************************/

/**
 * Check if current page is arxiv.org/html/*
 * @returns {boolean}
 */
function isArxivHtmlPage() {
  const host = (window.location?.hostname || '').toLowerCase();
  const path = window.location?.pathname || '';
  return host === ARXIV_HOST && path.startsWith('/html/');
}

// [f12] arXiv Zen activation delay (wait for page to fully load)
const ARXIV_ZEN_ACTIVATION_DELAY_MS = 3000;
let arxivZenActivationTimeoutId = null;

/**
 * Sync arXiv Zen effects with current enabled state.
 * @returns {void}
 */
function syncArxivZenActiveState() {
  if (!isArxivHtmlPage()) return;

  if (isArxivZenModeEnabled) {
    // Delay activation to wait for page to fully load
    if (!arxivZenActivationTimeoutId) {
      arxivZenActivationTimeoutId = setTimeout(() => {
        arxivZenActivationTimeoutId = null;
        applyArxivZenMode(true);
        startArxivZenObserver();
      }, ARXIV_ZEN_ACTIVATION_DELAY_MS);
    }
    return;
  }

  // Cancel pending activation if disabling
  if (arxivZenActivationTimeoutId) {
    clearTimeout(arxivZenActivationTimeoutId);
    arxivZenActivationTimeoutId = null;
  }
  stopArxivZenObserver();
  restoreArxivZenElements();
}

/**
 * Apply or restore arXiv Zen mode.
 * @param {boolean} enable - True to apply, false to restore
 * @returns {void}
 */
function applyArxivZenMode(enable) {
  if (!enable) {
    restoreArxivZenElements();
    return;
  }

  // Hide headers and footer
  ARXIV_ZEN_HIDE_SELECTORS.forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) hideElementForZen(el);
  });

  // Remove 'active' class from TOC
  const toc = document.querySelector(ARXIV_TOC_SELECTOR);
  if (toc && toc.classList.contains('active')) {
    toc.dataset.maizoneZenTocWasActive = '1';
    toc.classList.remove('active');
  }
}

/**
 * Restore arXiv elements hidden by Zen mode.
 * @returns {void}
 */
function restoreArxivZenElements() {
  // Restore hidden elements
  ARXIV_ZEN_HIDE_SELECTORS.forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) restoreElementFromZen(el);
  });

  // Restore TOC active class if it was removed
  const toc = document.querySelector(ARXIV_TOC_SELECTOR);
  if (toc && toc.dataset?.maizoneZenTocWasActive === '1') {
    toc.classList.add('active');
    delete toc.dataset.maizoneZenTocWasActive;
  }
}

/**
 * Start observer to re-apply Zen on DOM changes (SPA-like behavior).
 * @returns {void}
 */
function startArxivZenObserver() {
  if (!isArxivHtmlPage()) return;
  if (!isArxivZenModeEnabled) return;
  if (arxivZenObserver) return;

  const root = document.documentElement;
  if (!root) return;

  arxivZenObserver = new MutationObserver(() => scheduleArxivZenApply());
  arxivZenObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Stop arXiv Zen observer.
 * @returns {void}
 */
function stopArxivZenObserver() {
  try {
    arxivZenObserver?.disconnect?.();
  } catch {
    // ignore
  }
  arxivZenObserver = null;
  clearTimeout(arxivZenApplyTimeoutId);
  arxivZenApplyTimeoutId = null;
}

/**
 * Debounce arXiv Zen re-apply.
 * @returns {void}
 */
function scheduleArxivZenApply() {
  if (!isArxivHtmlPage()) return;
  if (!isArxivZenModeEnabled) return;
  if (arxivZenApplyTimeoutId) return;

  arxivZenApplyTimeoutId = setTimeout(() => {
    arxivZenApplyTimeoutId = null;
    applyArxivZenMode(true);
  }, 180);
}

/******************************************************************************
 * YOUTUBE AUTO SKIP ADS [f15]
 ******************************************************************************/

/**
 * Check whether current page is youtube.com (or subdomain).
 * @returns {boolean}
 */
function isYoutubeHost() {
  const host = (window.location?.hostname || '').toLowerCase();
  return host === YOUTUBE_HOST_SUFFIX || host.endsWith(`.${YOUTUBE_HOST_SUFFIX}`);
}

/**
 * Sync YouTube auto-skip behavior.
 * @returns {void}
 */
function syncYoutubeSkipAdActiveState() {
  if (!isYoutubeHost()) return;
  startYoutubeSkipObserver();
  scheduleYoutubeSkipCheck();
}

/**
 * Start observer to detect skip button render.
 * @returns {void}
 */
function startYoutubeSkipObserver() {
  if (!isYoutubeHost()) return;
  if (youtubeSkipObserver) return;

  const root = document.documentElement;
  if (!root) return;

  youtubeSkipObserver = new MutationObserver(() => scheduleYoutubeSkipCheck());
  youtubeSkipObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Debounce skip button checks to reduce overhead.
 * @returns {void}
 */
function scheduleYoutubeSkipCheck() {
  if (!isYoutubeHost()) return;
  if (youtubeSkipApplyTimeoutId) return;

  youtubeSkipApplyTimeoutId = setTimeout(() => {
    youtubeSkipApplyTimeoutId = null;
    tryClickYoutubeSkipAdButton();
  }, 120);
}

/**
 * Find and click YouTube skip ad button if available.
 * @returns {void}
 */
function tryClickYoutubeSkipAdButton() {
  if (!isYoutubeHost()) return;

  const now = Date.now();
  if (now - lastYoutubeSkipClickAt < YOUTUBE_SKIP_CLICK_COOLDOWN_MS) return;

  const button = findYoutubeSkipAdButton();
  if (!button) return;
  if (button.disabled) return;
  if (!isElementVisible(button)) return;

  try {
    button.click();
    lastYoutubeSkipClickAt = now;
    console.log('🌸 YouTube auto-skip: clicked Skip Ad button');
  } catch {
    // ignore
  }
}

/**
 * Locate the first visible YouTube skip ad button.
 * @returns {HTMLButtonElement|null}
 */
function findYoutubeSkipAdButton() {
  for (const selector of YOUTUBE_SKIP_AD_SELECTORS) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLButtonElement)) continue;
      if (!isElementVisible(node)) continue;
      return node;
    }
  }
  return null;
}

/**
 * Basic visibility check for clickable elements.
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isElementVisible(el) {
  if (!el) return false;
  if (typeof el.getBoundingClientRect !== 'function') return false;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  } catch {
    // ignore
  }

  return true;
}

/******************************************************************************
 * X.COM STATUS CLEANUP [f17]
 ******************************************************************************/

/**
 * Check whether current page is x.com (or subdomain).
 * @returns {boolean}
 */
function isXHost() {
  const host = (window.location?.hostname || '').toLowerCase();
  return host === X_HOST_SUFFIX || host.endsWith(`.${X_HOST_SUFFIX}`);
}

/**
 * Check whether current path matches /:user/status/:id
 * @returns {boolean}
 */
function isXStatusPage() {
  const path = window.location?.pathname || '';
  return X_STATUS_PATH_REGEX.test(path);
}

/**
 * Sync X.com status cleanup.
 * @returns {void}
 */
function syncXStatusCleanupActiveState() {
  if (!isXHost()) return;
  startXStatusObserver();
  startXStatusPolling();
  scheduleXStatusCleanupApply();
}

/**
 * Start observer to re-apply cleanup on SPA DOM changes.
 * @returns {void}
 */
function startXStatusObserver() {
  if (!isXHost()) return;
  if (xStatusObserver) return;

  const root = document.documentElement;
  if (!root) return;

  xStatusObserver = new MutationObserver(() => scheduleXStatusCleanupApply());
  xStatusObserver.observe(root, { childList: true, subtree: true });
}

/**
 * Start a lightweight polling loop as a fallback for late-loaded elements.
 * @returns {void}
 */
function startXStatusPolling() {
  if (!isXHost()) return;
  if (xStatusPollIntervalId) return;

  xStatusPollIntervalId = setInterval(() => {
    applyXStatusCleanup();
  }, X_STATUS_POLL_INTERVAL_MS);
}

/**
 * Debounce cleanup re-apply.
 * @returns {void}
 */
function scheduleXStatusCleanupApply() {
  if (!isXHost()) return;
  if (xStatusApplyTimeoutId) return;

  xStatusApplyTimeoutId = setTimeout(() => {
    xStatusApplyTimeoutId = null;
    applyXStatusCleanup();
  }, X_STATUS_APPLY_DEBOUNCE_MS);
}

/**
 * Apply or restore X.com status cleanup based on current URL.
 * @returns {void}
 */
function applyXStatusCleanup() {
  if (!isXHost()) return;

  if (!isXStatusPage()) {
    if (isXStatusCleanupActive) restoreXStatusHiddenElements();
    isXStatusCleanupActive = false;
    return;
  }

  isXStatusCleanupActive = true;
  hideXStatusElements();
}

/**
 * Hide targeted elements on X status pages.
 * @returns {void}
 */
function hideXStatusElements() {
  X_STATUS_HIDE_SELECTORS.forEach((selector) => {
    if (typeof selector !== 'string' || !selector.trim()) return;
    const nodes = document.querySelectorAll(selector);
    nodes.forEach((el) => hideElementForXStatus(el));
  });
}

/**
 * Hide an element while storing its previous display.
 * @param {Element} el
 * @returns {void}
 */
function hideElementForXStatus(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneXStatusHidden === '1') return;

  const prevDisplay = el.style.display;
  const prevPriority = el.style.getPropertyPriority?.('display') || '';

  el.dataset.maizoneXStatusHidden = '1';
  el.dataset.maizoneXStatusPrevDisplay = prevDisplay;
  el.dataset.maizoneXStatusPrevDisplayPriority = prevPriority;

  try {
    el.style.setProperty('display', 'none', 'important');
  } catch {
    el.style.display = 'none';
  }
}

/**
 * Restore elements hidden by X status cleanup.
 * @returns {void}
 */
function restoreXStatusHiddenElements() {
  try {
    const hiddenEls = document.querySelectorAll('[data-maizone-x-status-hidden="1"]');
    hiddenEls.forEach((el) => restoreElementFromXStatus(el));
  } catch {
    // ignore
  }
}

/**
 * Restore a single element hidden by X status cleanup.
 * @param {Element} el
 * @returns {void}
 */
function restoreElementFromXStatus(el) {
  if (!el || !(el instanceof HTMLElement)) return;
  if (el.dataset?.maizoneXStatusHidden !== '1') return;

  const prevDisplay = typeof el.dataset.maizoneXStatusPrevDisplay === 'string' ? el.dataset.maizoneXStatusPrevDisplay : '';
  const prevPriority = typeof el.dataset.maizoneXStatusPrevDisplayPriority === 'string' ? el.dataset.maizoneXStatusPrevDisplayPriority : '';

  if (prevDisplay) {
    try {
      el.style.setProperty('display', prevDisplay, prevPriority || '');
    } catch {
      el.style.display = prevDisplay;
    }
  } else {
    try {
      el.style.removeProperty('display');
    } catch {
      el.style.display = '';
    }
  }

  delete el.dataset.maizoneXStatusHidden;
  delete el.dataset.maizoneXStatusPrevDisplay;
  delete el.dataset.maizoneXStatusPrevDisplayPriority;
}

/******************************************************************************
 * MAI TOAST (GENERIC) [f10]
 ******************************************************************************/

const MAI_TOAST_VISIBLE_MS = 2200;
const MAI_TOAST_FADE_MS = 320;

/**
 * Show a small Mai toast (site-agnostic, no chime).
 * @feature f10 - Context Menu Quick Actions
 * @param {string} text - Toast text
 * @returns {void}
 */
function showMaiToast(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  ensureMaiToastStyles();

  let el = document.getElementById('mai-generic-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-generic-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: 'min(560px, 92vw)',
      padding: '10px 12px',
      borderRadius: '12px',
      backgroundColor: 'rgba(0,0,0,0.86)',
      border: '1px solid rgba(255, 143, 171, 0.55)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '1.25',
      boxShadow: '0 10px 24px rgba(0,0,0,0.28), 0 0 0 5px rgba(255, 143, 171, 0.06)',
      textAlign: 'center',
      letterSpacing: '0.1px',
      pointerEvents: 'none',
      opacity: '1',
      transition: `opacity ${MAI_TOAST_FADE_MS}ms ease, transform ${MAI_TOAST_FADE_MS}ms ease`,
      willChange: 'transform, opacity',
      animation: 'maiGenericToastIn 220ms ease-out'
    });

    document.documentElement.appendChild(el);
  }

  el.textContent = message;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0px)';

  clearTimeout(maiToastTimeoutId);
  clearTimeout(maiToastFadeTimeoutId);

  maiToastTimeoutId = setTimeout(() => {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(6px)';

    maiToastFadeTimeoutId = setTimeout(() => {
      removeMaiToast();
    }, MAI_TOAST_FADE_MS + 60);
  }, MAI_TOAST_VISIBLE_MS);
}

/**
 * Ensure CSS keyframes for generic toast exist.
 * @feature f10 - Context Menu Quick Actions
 * @returns {void}
 */
function ensureMaiToastStyles() {
  const id = 'mai-generic-toast-styles';
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @keyframes maiGenericToastIn {
      from { opacity: 0; transform: translateX(-50%) translateY(8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0px); }
    }
  `;
  document.documentElement.appendChild(style);
}

/**
 * Remove generic toast (if any).
 * @feature f10 - Context Menu Quick Actions
 * @returns {void}
 */
function removeMaiToast() {
  clearTimeout(maiToastTimeoutId);
  clearTimeout(maiToastFadeTimeoutId);
  maiToastTimeoutId = null;
  maiToastFadeTimeoutId = null;
  document.getElementById('mai-generic-toast')?.remove?.();
}

/******************************************************************************
 * MINDFULNESS TOAST [f08]
 ******************************************************************************/

const MINDFULNESS_TOAST_VISIBLE_MS = 10_000;
const MINDFULNESS_TOAST_FADE_MS = 450;

/**
 * Show a gentle mindfulness toast (site-agnostic).
 * @feature f08 - Mindfulness Reminders
 * @param {string} text - Toast text
 * @returns {void}
 */
function showMindfulnessToast(text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return;

  ensureMindfulnessToastStyles();

  let el = document.getElementById('mai-mindfulness-toast');
  let labelEl = el?.querySelector?.('#mai-mindfulness-toast-label') || null;
  let prefixEl = el?.querySelector?.('#mai-mindfulness-toast-prefix') || null;
  let suffixEl = el?.querySelector?.('#mai-mindfulness-toast-suffix') || null;

  if (!el) {
    el = document.createElement('div');
    el.id = 'mai-mindfulness-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    Object.assign(el.style, {
      position: 'fixed',
      top: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999999',
      maxWidth: 'min(560px, 92vw)',
      padding: '12px 14px',
      borderRadius: '14px',
      backgroundColor: 'rgba(0,0,0,0.88)',
      border: '1px solid rgba(255, 143, 171, 0.55)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '14px',
      fontWeight: '600',
      lineHeight: '1.25',
      boxShadow: '0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08)',
      textAlign: 'center',
      letterSpacing: '0.1px',
      pointerEvents: 'none',
      willChange: 'transform, opacity'
    });

    prefixEl = document.createElement('span');
    prefixEl.id = 'mai-mindfulness-toast-prefix';
    prefixEl.textContent = '🌸';
    Object.assign(prefixEl.style, { marginRight: '8px' });

    labelEl = document.createElement('span');
    labelEl.id = 'mai-mindfulness-toast-label';
    labelEl.textContent = '';

    suffixEl = document.createElement('span');
    suffixEl.id = 'mai-mindfulness-toast-suffix';
    suffixEl.textContent = '🌸';
    Object.assign(suffixEl.style, { marginLeft: '8px' });

    el.appendChild(prefixEl);
    el.appendChild(labelEl);
    el.appendChild(suffixEl);

    document.documentElement.appendChild(el);
  }

  // Backward compatible: if toast exists from an older version, add missing prefix/suffix.
  if (el && !prefixEl) {
    prefixEl = document.createElement('span');
    prefixEl.id = 'mai-mindfulness-toast-prefix';
    prefixEl.textContent = '🌸';
    Object.assign(prefixEl.style, { marginRight: '8px' });
    try {
      el.insertBefore(prefixEl, el.firstChild);
    } catch {
      // ignore
    }
  }

  if (el && !suffixEl) {
    suffixEl = document.createElement('span');
    suffixEl.id = 'mai-mindfulness-toast-suffix';
    suffixEl.textContent = '🌸';
    Object.assign(suffixEl.style, { marginLeft: '8px' });
    try {
      el.appendChild(suffixEl);
    } catch {
      // ignore
    }
  }

  const cleanMessage = message.replace(/^\s*🌸\s*/u, '');
  if (labelEl) labelEl.textContent = cleanMessage;

  // Ensure fade transition exists even if the element was created by an older version.
  try {
    el.style.transition = `opacity ${MINDFULNESS_TOAST_FADE_MS}ms ease`;
    el.style.opacity = '1';
  } catch {
    // ignore
  }

  // Visual attention: restart entrance animation.
  try {
    el.classList.remove('mai-mindfulness-toast--show');
    // Force reflow to restart animation.
    el.offsetHeight;
    el.classList.add('mai-mindfulness-toast--show');
  } catch {
    // ignore
  }

  // Sound (best-effort): if blocked by autoplay policies, just ignore.
  playMindfulnessChime().catch(() => {});

  clearTimeout(mindfulnessToastTimeoutId);
  clearTimeout(mindfulnessToastFadeTimeoutId);

  mindfulnessToastFadeTimeoutId = setTimeout(() => {
    try {
      el.style.opacity = '0';
    } catch {
      // ignore
    }
  }, MINDFULNESS_TOAST_VISIBLE_MS);

  mindfulnessToastTimeoutId = setTimeout(() => {
    removeMindfulnessToast();
  }, MINDFULNESS_TOAST_VISIBLE_MS + MINDFULNESS_TOAST_FADE_MS);
}

/**
 * Ensure CSS (keyframes + reduced-motion handling) exists for the mindfulness toast.
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function ensureMindfulnessToastStyles() {
  const styleId = 'mai-mindfulness-toast-style';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    #mai-mindfulness-toast.mai-mindfulness-toast--show {
      animation: maiMindfulnessToastIn 260ms ease-out, maiMindfulnessToastPulse 1200ms ease-in-out 2;
    }

    @keyframes maiMindfulnessToastIn {
      0% { opacity: 0; transform: translateX(-50%) translateY(-10px) scale(0.985); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
    }

    @keyframes maiMindfulnessToastPulse {
      0% { box-shadow: 0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08); }
      50% { box-shadow: 0 18px 44px rgba(0,0,0,0.36), 0 0 0 10px rgba(255, 143, 171, 0.14); }
      100% { box-shadow: 0 14px 34px rgba(0,0,0,0.32), 0 0 0 6px rgba(255, 143, 171, 0.08); }
    }

    @media (prefers-reduced-motion: reduce) {
      #mai-mindfulness-toast.mai-mindfulness-toast--show {
        animation: none !important;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

/**
 * Unlock mindfulness audio after a user gesture (required by autoplay policies).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function setupMindfulnessAudioUnlockListeners() {
  if (hasRegisteredMindfulnessAudioUnlock) return;
  hasRegisteredMindfulnessAudioUnlock = true;

  const unlock = () => {
    mindfulnessAudioUnlocked = true;
    primeMindfulnessAudioContext();
  };

  // Capture + once: minimal overhead and counts as a user gesture on the page.
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true, once: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true, once: true });
}

/**
 * Create/resume AudioContext (must be called from a user gesture).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function primeMindfulnessAudioContext() {
  try {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    if (!mindfulnessAudioContext) mindfulnessAudioContext = new AudioCtx();
    mindfulnessAudioContext.resume?.().catch(() => {});
  } catch {
    // ignore
  }
}

/**
 * Play a short, gentle chime (best-effort).
 * NOTE: Some sites may block playback due to autoplay policies; we ignore failures.
 * @feature f08 - Mindfulness Reminders
 * @returns {Promise<boolean>} True if a chime was scheduled
 */
async function playMindfulnessChime() {
  try {
    if (!mindfulnessAudioUnlocked) return false;

    const ctx = mindfulnessAudioContext;
    if (!ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, now); // G5
    osc.frequency.setValueAtTime(988, now + 0.11); // B5
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.22);

    // Cleanup connections after the sound ends (avoid leaks).
    osc.onended = () => {
      try { osc.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
    };

    return true;
  } catch {
    return false;
  }
}

/**
 * Remove mindfulness toast (if any).
 * @feature f08 - Mindfulness Reminders
 * @returns {void}
 */
function removeMindfulnessToast() {
  clearTimeout(mindfulnessToastTimeoutId);
  mindfulnessToastTimeoutId = null;
  clearTimeout(mindfulnessToastFadeTimeoutId);
  mindfulnessToastFadeTimeoutId = null;
  document.getElementById('mai-mindfulness-toast')?.remove?.();
}

/******************************************************************************
 * CONTENT ANALYSIS
 ******************************************************************************/

/**
 * Capture and analyze current content
 */
function captureCurrentContent() {
  if (!currentElement) return;
  const currentLength = getCurrentElementContentLength();
  if (currentLength !== lastContentLength) {
    console.debug('🌸 Content updated (len):', currentLength);
    lastContentLength = currentLength;
  }
}

/**
 * Get content length from current element (avoid storing content for privacy).
 */
function getCurrentElementContentLength() {
  if (!currentElement) return 0;
  const tagName = currentElement.tagName.toLowerCase();
  if (tagName === 'textarea' || tagName === 'input') {
    return (currentElement.value || '').length;
  }
  if (currentElement.getAttribute('contenteditable') === 'true') {
    return (currentElement.innerText || '').length;
  }
  return 0;
}



/******************************************************************************
 * UTILITY FUNCTIONS
 ******************************************************************************/

/**
 * Check if element is a text input
 */
function isTextInput(element) {
  if (!element?.tagName) return false;
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === 'textarea') return true;
  if (tagName === 'input') {
    const inputType = element.type?.toLowerCase();
    // Never monitor password fields.
    return ['text', 'email', 'search', 'url', 'tel', 'number'].includes(inputType);
  }
  return element.getAttribute('contenteditable') === 'true';
}

/**
 * Set current focused element
 */
function setCurrentElement(element) {
  try {
    currentElement = element;
    lastContentLength = getCurrentElementContentLength();
  } catch (error) {
    console.warn('🌸🌸🌸 Error in setCurrentElement:', error);
    // Prevent further errors by resetting the current element
    currentElement = null;
  }
}

/******************************************************************************
 * MESSAGE HANDLING
 ******************************************************************************/

/**
 * Handle messages from background script
 */
function handleBackgroundMessages(message, sender, sendResponse) {
  if (message?.action === messageActions.maiToast) {
    const text = typeof message?.data?.text === 'string' ? message.data.text : '';
    showMaiToast(text);
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.action === messageActions.mindfulnessToast) {
    const text = typeof message?.data?.text === 'string' ? message.data.text : '';
    showMindfulnessToast(text);
    sendResponse?.({ ok: true });
    return true;
  }

  if (message?.action === messageActions.stateUpdated) {
    // [f03] Opera: ensure badge ticker fallback stays in sync with background state updates.
    syncOperaBadgeTickFallback();
    sendResponse?.({ received: true });
    return true;
  }

  if (message?.action === messageActions.clipmdStart) {
    startClipmdPickMode();
    sendResponse({ received: true });
    return true;
  }

  return false;
}

/******************************************************************************
 * CLIPMD (CLIPBOARD TO MARKDOWN) [f06]
 ******************************************************************************/

let isClipmdPickModeActive = false;
let clipmdHintEl = null;
let clipmdCleanupFn = null;

/**
 * Create a small hint UI for ClipMD pick mode.
 * @param {string} text - Hint text
 * @returns {HTMLDivElement}
 */
function createClipmdHint(text) {
  const hint = document.createElement('div');
  hint.id = 'mai-clipmd-hint';
  Object.assign(hint.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '99999999',
    backgroundColor: 'rgba(0,0,0,0.85)',
    color: 'white',
    padding: '10px 14px',
    borderRadius: '10px',
    fontFamily: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '92vw',
    boxShadow: '0 6px 18px rgba(0,0,0,0.3)'
  });

  const label = document.createElement('span');
  label.textContent = text;
  label.style.lineHeight = '1.2';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Hủy (ESC)';
  Object.assign(cancelBtn.style, {
    backgroundColor: 'transparent',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.6)',
    padding: '6px 10px',
    borderRadius: '999px',
    cursor: 'pointer',
    fontSize: '12px'
  });

  cancelBtn.addEventListener('click', (event) => {
    if (!event?.isTrusted) return;
    stopClipmdPickMode();
  });

  hint.appendChild(label);
  hint.appendChild(cancelBtn);

  return hint;
}

/**
 * Update hint text for ClipMD.
 * @param {string} text - New text
 * @returns {void}
 */
function setClipmdHintText(text) {
  try {
    const label = clipmdHintEl?.querySelector?.('span');
    if (!label) return;
    label.textContent = text;
  } catch {
    // ignore
  }
}

/**
 * Stop ClipMD pick mode and clean up listeners/UI.
 * @returns {void}
 */
function stopClipmdPickMode() {
  isClipmdPickModeActive = false;
  if (typeof clipmdCleanupFn === 'function') clipmdCleanupFn();
  clipmdCleanupFn = null;
}

/**
 * Start ClipMD pick mode: click an element to copy its Markdown.
 * @returns {void}
 */
function startClipmdPickMode() {
  try {
    if (isClipmdPickModeActive) return;
    isClipmdPickModeActive = true;

    document.getElementById('mai-clipmd-hint')?.remove?.();
    clipmdHintEl = createClipmdHint('🌸 Chọn phần bạn muốn copy Markdown (click vào element)');
    document.body.appendChild(clipmdHintEl);

    const onKeyDown = (event) => {
      if (event?.key === 'Escape') {
        event.preventDefault?.();
        stopClipmdPickMode();
      }
    };

    const onClickCapture = (event) => {
      if (!isClipmdPickModeActive) return;
      if (!event?.isTrusted) return;

      // Allow clicks on our hint (cancel button).
      if (clipmdHintEl && clipmdHintEl.contains(event.target)) return;

      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();

      isClipmdPickModeActive = false; // single pick
      setClipmdHintText('🌸 Đang tạo Markdown...');

      const el = event.target;
      const html = typeof el?.outerHTML === 'string' ? el.outerHTML : '';
      const maxChars = 300_000;
      if (!html || html.length > maxChars) {
        setClipmdHintText('🌸 Phần bạn chọn quá lớn. Hãy chọn một phần nhỏ hơn.');
        setTimeout(() => stopClipmdPickMode(), 1500);
        return;
      }

      sendMessageSafely(
        { action: messageActions.clipmdConvertMarkdown, data: { html } },
        { timeoutMs: 8000 }
      )
        .then(async (response) => {
          const markdown = typeof response?.markdown === 'string' ? response.markdown : '';
          if (!response?.success || !markdown) {
            setClipmdHintText('🌸 Không thể tạo Markdown lúc này. Thử lại nhé.');
            setTimeout(() => stopClipmdPickMode(), 1500);
            return;
          }

          try {
            await navigator.clipboard.writeText(markdown);
            setClipmdHintText('🌸 Đã copy Markdown! (Ctrl+V để dán)');
          } catch (error) {
            console.error('🌸🌸🌸 Error writing clipboard:', error);
            setClipmdHintText('🌸 Copy thất bại. Trang này có thể chặn clipboard.');
          }

          setTimeout(() => stopClipmdPickMode(), 1200);
        })
        .catch((error) => {
          console.error('🌸🌸🌸 Error converting markdown:', error);
          setClipmdHintText('🌸 Có lỗi khi tạo Markdown. Thử lại nhé.');
          setTimeout(() => stopClipmdPickMode(), 1500);
        });
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClickCapture, true);

    clipmdCleanupFn = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClickCapture, true);
      clipmdHintEl?.remove?.();
      clipmdHintEl = null;
    };
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD mode:', error);
    stopClipmdPickMode();
  }
}


/******************************************************************************
 * SCRIPT INITIALIZATION
 ******************************************************************************/

initialize();

})();
