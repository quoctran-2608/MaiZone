/**
 * MaiZone Browser Extension
 * Background Script: Central coordinator for all extension features
 * @feature f03 - Break Reminder
 * @feature f04 - Deep Work Mode
 * @feature f05 - State Management
 * @feature f06 - ClipMD (Clipboard to Markdown)
 * @feature f08 - Mindfulness Reminders
 * @feature f09 - Onboarding
 * @feature f10 - Context Menu Quick Actions
 * @feature f11 - Omnibox Commands
 * @feature f13 - Intent Gate for Distracting Sites
 */

import { ensureInitialized, setupStateListeners, updateState } from './background_state.js';
import { initBreakReminder, sendBreakReminder } from './background_breakReminder.js';
import { initExerciseReminder, triggerExerciseGateNow } from './background_exerciseReminder.js';
import { initMindfulnessReminder, sendMindfulnessToast } from './background_mindfulnessReminder.js';
import { initClipmd, startClipmdMarkdownPicker } from './background_clipmd.js';
import { initContextMenus } from './background_contextMenus.js';
import { initOmnibox } from './background_omnibox.js';
import { initIntentGate } from './background_intentGate.js';
import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';
import { messageActions } from './actions.js';

/**
 * Summarize state for logs (privacy-first).
 * @param {Object} state - Full state object
 * @returns {Object}
 */
function summarizeStateForLog(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    intentGateEnabled: !!s.intentGateEnabled,
    isInFlow: !!s.isInFlow,
    breakReminderEnabled: !!s.breakReminderEnabled,
    mindfulnessReminderEnabled: !!s.mindfulnessReminderEnabled
  };
}

/**
 * Initialize background script
 */
function initBackgroundScript() {
  console.info('🌸 Mai background script initializing...');
  
  try {
    // MV3 reliability: register listeners synchronously (avoid missing wake events).
    setupStateListeners();
    
    // Initialize feature modules
    initIntentGate();
    initBreakReminder();
    initExerciseReminder();
    initMindfulnessReminder();
    initClipmd();
    initContextMenus();
    initOmnibox();
    
    // Set up event listeners
    setupEventListeners();
    
    // Hydrate state after listeners are ready (safe with MV3 service worker lifecycle).
    ensureInitialized()
      .then((state) => console.info('🌸 State ready:', summarizeStateForLog(state)))
      .catch((error) => console.error('🌸🌸🌸 Error hydrating state:', error));

    console.info('🌸 Mai background script loaded successfully');
  } catch (error) {
    console.error('🌸🌸🌸 Error initializing background script:', error);
  }
}

/**
 * Set up various event listeners
 */
function setupEventListeners() {
  // Handle extension installation or update
  chrome.runtime.onInstalled.addListener(onInstalledListener);
  
  // Handle keyboard commands
  chrome.commands.onCommand.addListener(handleCommand);

  // Hotkey fallback from content scripts (Alt+A / Alt+Shift+A).
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.triggerMindfulnessToast) {
      (async () => {
        const result = await sendMindfulnessToast({ allowDuringDeepWork: true });
        sendResponse({ ok: !!result?.ok, skipped: result?.skipped });
      })().catch((error) => {
        console.error('🌸🌸🌸 Error triggering mindfulness toast:', error);
        sendResponse({ ok: false, error: 'Internal error' });
      });

      return true;
    }

    if (message.action === messageActions.triggerBreakReminder) {
      try {
        sendBreakReminder();
        sendResponse({ ok: true });
      } catch (error) {
        console.error('🌸🌸🌸 Error triggering break reminder:', error);
        sendResponse({ ok: false, error: 'Internal error' });
      }
      return true;
    }

    if (message.action === messageActions.triggerExerciseReminder) {
      (async () => {
        try {
          await ensureInitialized();
          const ok = await triggerExerciseGateNow();
          sendResponse({ ok: !!ok });
        } catch (error) {
          console.error('🌸🌸🌸 Error triggering exercise gate:', error);
          sendResponse({ ok: false, error: 'Internal error' });
        }
      })();

      return true;
    }

    return false;
  });
}

/**
 * Handle keyboard commands
 */
function showNotification(title, message) {
  try {
    if (!chrome?.notifications?.create) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: typeof title === 'string' ? title : 'MaiZone',
      message: typeof message === 'string' ? message : ''
    });
  } catch {
    // ignore
  }
}

/**
 * Handle keyboard commands
 */
async function handleCommand(command) {
  console.log('🌸 Command received:', command);

  // MV3 reliability: wake handlers should hydrate state (even if this handler doesn't always need it).
  try {
    await ensureInitialized();
  } catch (error) {
    // ignore (ClipMD/Break reminder can still run without state)
  }

  if (command === 'test-mindfulness-toast') {
    try {
      const result = await sendMindfulnessToast({ allowDuringDeepWork: true });
      if (result?.ok) {
        console.log('🌸 Mindfulness toast triggered');
        return;
      }
      console.warn('🌸🌸🌸 Mindfulness toast not delivered:', result?.skipped || 'unknown');
    } catch (error) {
      console.error('🌸🌸🌸 Error sending mindfulness toast:', error);
    }
    return;
  }

  if (command === 'test-break-reminder') {
    sendBreakReminder();
    console.log('🌸 Break reminder sent successfully');
    return;
  }

  // Compat: some users may already have Alt+Shift+A mapped to the old break reminder command.
  if (command === 'triggerBreakReminder') {
    try {
      const ok = await triggerExerciseGateNow();
      if (!ok) {
        console.warn('🌸🌸🌸 Exercise gate not triggered (disabled or Deep Work active)');
      }
    } catch (error) {
      console.error('🌸🌸🌸 Error triggering exercise gate:', error);
    }
    return;
  }

  if (command === 'test-exercise-reminder') {
    try {
      const ok = await triggerExerciseGateNow();
      if (!ok) {
        console.warn('🌸🌸🌸 Exercise gate not triggered (disabled or Deep Work active)');
      }
    } catch (error) {
      console.error('🌸🌸🌸 Error triggering exercise gate:', error);
    }
    return;
  }

  if (command === 'clipmd-markdown') {
    try {
      const ok = await startClipmdMarkdownPicker();
      if (!ok) {
        showNotification('MaiZone', 'Không thể bật ClipMD trên tab này. Hãy mở trang http/https và thử lại nhé.');
      }
    } catch (error) {
      console.error('🌸🌸🌸 Error starting ClipMD:', error);
      showNotification('MaiZone', 'ClipMD gặp lỗi khi khởi chạy. Thử reload trang và bấm Alt+Q lại nhé.');
    }
  }
}

/**
 * Handle extension installation or update
 */
async function onInstalledListener(details) {
  console.info('🌸 Mai extension installed or updated:', details.reason);

  if (details.reason === 'install') {
    // Set default settings on first install
    await setupDefaultSettings();

    // Show gentle onboarding once on first install.
    openOnboardingIfNeeded().catch(() => {});
  }

  // Best-effort: inject content scripts into existing http/https tabs so features work
  // without requiring manual reload after install/update (notably on Opera).
  injectContentScriptsIntoExistingTabs().catch(() => {});
}

/**
 * Open onboarding tab on first install (best-effort, non-blocking).
 * @feature f09 - Onboarding
 * @returns {Promise<void>}
 */
async function openOnboardingIfNeeded() {
  try {
    const state = await ensureInitialized();
    if (state?.hasSeenOnboarding) return;

    const url = chrome.runtime.getURL('onboarding.html');
    chrome.tabs.create({ url });
  } catch {
    // ignore
  }
}

/**
 * Inject content scripts into existing http/https tabs (best-effort).
 * @returns {Promise<void>}
 */
async function injectContentScriptsIntoExistingTabs() {
  try {
    if (!chrome?.tabs?.query || !chrome?.scripting?.executeScript) return;

    const tabs = await new Promise((resolve) => {
      try {
        chrome.tabs.query({}, (results) => resolve(Array.isArray(results) ? results : []));
      } catch {
        resolve([]);
      }
    });

    const eligibleTabs = (tabs || []).filter((tab) => {
      const tabId = tab?.id;
      const url = typeof tab?.url === 'string' ? tab.url : '';
      if (typeof tabId !== 'number') return false;
      return url.startsWith('http://') || url.startsWith('https://');
    });

    if (!eligibleTabs.length) return;

    // Run sequentially to avoid flooding the browser.
    for (const tab of eligibleTabs) {
      await new Promise((resolve) => {
        try {
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              files: ['actions_global.js', 'content.js']
            },
            () => resolve()
          );
        } catch {
          resolve();
        }
      });
    }
  } catch {
    // ignore
  }
}

/**
 * Setup default settings on first install
 */
async function setupDefaultSettings() {
  try {
    await updateState({
      intentGateEnabled: true,
      breakReminderEnabled: false,
      exerciseReminderEnabled: true,
      distractingSites: DEFAULT_DISTRACTING_SITES,
      deepWorkBlockedSites: DEFAULT_DEEPWORK_BLOCKED_SITES
    });
    
    console.info('🌸 Default settings initialized on install');
  } catch (error) {
    console.error('🌸🌸🌸 Error setting up default settings:', error);
  }
}

// Start initialization
initBackgroundScript();
