/**
 * MaiZone Browser Extension
 * ClipMD Module: Pick an element -> HTML to Markdown -> copy to clipboard
 * @feature f06 - ClipMD (Clipboard to Markdown)
 */

import { messageActions } from './actions.js';
import { CLIPMD_POPUP_PORT_NAME } from './constants.js';
import { sendMessageToTabSafely } from './messaging.js';

/***** HELPERS *****/

/**
 * Sleep helper.
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure main content scripts are injected into a tab (best-effort).
 * Useful right after extension install/reload where existing tabs may not have content scripts yet.
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

/***** INSPECT PICKER (CDP via chrome.debugger) *****/

const CLIPMD_DEBUGGER_PROTOCOL_VERSION = '1.3';
const CLIPMD_INSPECT_TIMEOUT_MS = 45_000;

const CLIPMD_HIGHLIGHT_CONFIG = Object.freeze({
  borderColor: { r: 255, g: 143, b: 171, a: 0.9 }, // Mai pink
  contentColor: { r: 255, g: 143, b: 171, a: 0.35 },
  showInfo: true
});

const clipmdSessions = new Map();
let hasRegisteredClipmdDebuggerListeners = false;
let hasRegisteredClipmdPopupPortListener = false;

const CLIPMD_POPUP_CLOSE_CANCEL_DELAY_MS = 1200;

/**
 * Send a CDP command through chrome.debugger.
 * @param {{tabId:number}} debuggee - Debuggee object
 * @param {string} method - CDP method
 * @param {Object} [params] - CDP params
 * @returns {Promise<any>}
 */
function sendDebuggerCommand(debuggee, method, params = {}) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.sendCommand(debuggee, method, params, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Attach chrome.debugger to a tab.
 * @param {{tabId:number}} debuggee - Debuggee
 * @returns {Promise<void>}
 */
function attachDebugger(debuggee) {
  return new Promise((resolve, reject) => {
    try {
      chrome.debugger.attach(debuggee, CLIPMD_DEBUGGER_PROTOCOL_VERSION, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || String(lastError)));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Detach chrome.debugger safely.
 * @param {{tabId:number}} debuggee - Debuggee
 * @returns {Promise<void>}
 */
async function detachDebugger(debuggee) {
  try {
    await sendDebuggerCommand(debuggee, 'Overlay.setInspectMode', { mode: 'none' });
  } catch {
    // ignore
  }

  await new Promise((resolve) => {
    try {
      chrome.debugger.detach(debuggee, () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Remove a session and detach the debugger.
 * @param {number} tabId - Tab id
 * @returns {Promise<void>}
 */
async function cleanupClipmdSession(tabId) {
  const session = clipmdSessions.get(tabId);
  if (!session) return;
  clipmdSessions.delete(tabId);

  clearTimeout(session.timeoutId);
  clearTimeout(session.cancelOnPopupCloseTimeoutId);

  try {
    await detachDebugger(session.debuggee);
  } catch {
    // ignore
  }
}

/***** POPUP CLOSE -> CANCEL (BEST-EFFORT) *****/

/**
 * If the popup closes shortly after starting ClipMD (and user didn't pick any element),
 * cancel inspect mode to avoid leaving "is debugging this tab" running.
 * @param {number} tabId - Target tab id
 * @returns {void}
 */
function scheduleCancelClipmdFromPopupClose(tabId) {
  const session = clipmdSessions.get(tabId);
  if (!session) return;
  if (session.source !== 'popupOpen') return;

  clearTimeout(session.cancelOnPopupCloseTimeoutId);
  session.cancelOnPopupCloseTimeoutId = setTimeout(() => {
    const current = clipmdSessions.get(tabId);
    if (!current) return;
    if (current.source !== 'popupOpen') return;
    if (current.didInspectRequest) return;
    cleanupClipmdSession(tabId).catch(() => {});
  }, CLIPMD_POPUP_CLOSE_CANCEL_DELAY_MS);
}

/**
 * Setup a popup lifecycle Port listener so we can detect "popup closed" reliably.
 * @returns {void}
 */
function setupClipmdPopupPortListeners() {
  if (hasRegisteredClipmdPopupPortListener) return;
  if (!chrome?.runtime?.onConnect) return;
  hasRegisteredClipmdPopupPortListener = true;

  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== CLIPMD_POPUP_PORT_NAME) return;

    let tabId = null;

    try {
      port.onMessage.addListener((msg) => {
        const nextTabId = msg?.tabId;
        if (typeof nextTabId === 'number') tabId = nextTabId;
      });
    } catch {
      // ignore
    }

    try {
      port.onDisconnect.addListener(() => {
        if (typeof tabId === 'number') {
          scheduleCancelClipmdFromPopupClose(tabId);
          return;
        }

        // Fallback: popup can close very fast; best-effort guess by current active tab.
        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTabId = tabs?.[0]?.id;
            if (typeof activeTabId !== 'number') return;
            scheduleCancelClipmdFromPopupClose(activeTabId);
          });
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  });
}

/**
 * Write text to clipboard within the tab (best-effort).
 * @param {number} tabId - Target tab
 * @param {string} text - Clipboard text
 * @returns {Promise<boolean>} True if executed without runtime error
 */
async function writeTextToTab(tabId, text) {
  if (!chrome?.scripting?.executeScript) return false;
  const content = typeof text === 'string' ? text : '';
  if (!content) return false;

  return await new Promise((resolve) => {
    try {
      chrome.scripting.executeScript(
        {
          target: { tabId },
          args: [content],
          func: async (clipboardText) => {
            await navigator.clipboard.writeText(clipboardText);
          }
        },
        () => {
          const lastError = chrome.runtime.lastError;
          resolve(!lastError);
        }
      );
    } catch {
      resolve(false);
    }
  });
}

/***** OFFSCREEN CONVERSION *****/

const CLIPMD_OFFSCREEN_URL = 'clipmd_offscreen.html';
const CLIPMD_OFFSCREEN_MESSAGE_TYPE = 'clipmdConvertMarkdown';

/**
 * Ensure the offscreen document exists for Turndown conversion.
 * @returns {Promise<boolean>} True if offscreen is ready
 */
async function ensureClipmdOffscreen() {
  try {
    if (!chrome?.offscreen?.createDocument) return false;

    const hasDocument = await chrome.offscreen.hasDocument?.();
    if (hasDocument) return true;

    await chrome.offscreen.createDocument({
      url: CLIPMD_OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Convert selected element HTML to Markdown for clipboard copy'
    });
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    if (/existing/i.test(message)) return true;
    console.error('🌸🌸🌸 Error creating ClipMD offscreen document:', error);
    return false;
  }
}

/**
 * Convert HTML -> Markdown using the offscreen document.
 * @param {string} html - Raw outerHTML
 * @returns {Promise<{ok: boolean, markdown?: string, error?: string}>}
 */
async function convertHtmlToMarkdown(html) {
  const ready = await ensureClipmdOffscreen();
  if (!ready) return { ok: false, error: 'Offscreen not available' };

  return await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: CLIPMD_OFFSCREEN_MESSAGE_TYPE, html }, (reply) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, error: lastError.message || String(lastError) });
          return;
        }
        resolve(reply || { ok: false, error: 'No response' });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });
}

/***** PICKER ENTRYPOINTS *****/

/**
 * Start ClipMD pick mode using the native inspect overlay (debugger/CDP).
 * @param {number} tabId - Target tab id
 * @param {string} source - Trigger source for session bookkeeping
 * @returns {Promise<boolean>} True if inspect mode was started
 */
async function startClipmdMarkdownPickerViaDebugger(tabId, source) {
  try {
    if (!chrome?.debugger?.attach || !chrome?.debugger?.sendCommand) return false;
    if (typeof tabId !== 'number') return false;
    if (clipmdSessions.has(tabId)) return true;

    const ready = await ensureClipmdOffscreen();
    if (!ready) return false;

    const sourceLabel = typeof source === 'string' ? source : 'unknown';

    const debuggee = { tabId };
    await attachDebugger(debuggee);

    await sendDebuggerCommand(debuggee, 'DOM.enable');
    await sendDebuggerCommand(debuggee, 'Overlay.enable');

    const timeoutId = setTimeout(() => {
      cleanupClipmdSession(tabId).catch(() => {});
    }, CLIPMD_INSPECT_TIMEOUT_MS);

    clipmdSessions.set(tabId, {
      debuggee,
      mode: 'markdown',
      timeoutId,
      source: sourceLabel,
      didInspectRequest: false,
      cancelOnPopupCloseTimeoutId: null
    });

    await sendDebuggerCommand(debuggee, 'Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: CLIPMD_HIGHLIGHT_CONFIG
    });

    return true;
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD inspect mode:', error);
    if (typeof tabId === 'number') await cleanupClipmdSession(tabId);
    return false;
  }
}

/**
 * Start ClipMD pick mode using the legacy content-script click capture (fallback).
 * @param {number} tabId - Target tab id
 * @param {string} source - Trigger source for logs
 * @returns {Promise<boolean>} True if receiver acknowledged
 */
async function startClipmdMarkdownPickerViaContentScript(tabId, source) {
  try {
    if (typeof tabId !== 'number') return false;

    // Best-effort: make sure content scripts exist on this tab (important after reload/install).
    await ensureContentScriptsInjected(tabId);

    // Retry: the content script may not be ready yet (run_at=document_idle).
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const reply = await sendMessageToTabSafely(
        tabId,
        { action: messageActions.clipmdStart, data: { mode: 'markdown', source, attempt } },
        { timeoutMs: 900 }
      );

      if (reply?.received) return true;
      if (attempt === 2) await ensureContentScriptsInjected(tabId);
      await sleep(250 + attempt * 200);
    }

    return false;
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD (content script):', error);
    return false;
  }
}

/**
 * Start ClipMD picker on a target tab (debugger first, fallback to content script).
 * @param {Object} [options]
 * @param {number} [options.tabId] - Optional tabId. If omitted, use active tab.
 * @param {string} [options.source='unknown'] - Trigger source for logs
 * @returns {Promise<boolean>} True if started
 */
export async function startClipmdMarkdownPicker({ tabId, source = 'unknown' } = {}) {
  try {
    const tab = await new Promise((resolve) => {
      try {
        if (typeof tabId === 'number') {
          chrome.tabs.get(tabId, (t) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) resolve(null);
            else resolve(t || null);
          });
          return;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0] || null));
      } catch {
        resolve(null);
      }
    });

    const targetTabId = tab?.id;
    const url = typeof tab?.url === 'string' ? tab.url : '';

    if (typeof targetTabId !== 'number') return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    const okDebugger = await startClipmdMarkdownPickerViaDebugger(targetTabId, source);
    if (okDebugger) return true;

    return await startClipmdMarkdownPickerViaContentScript(targetTabId, source);
  } catch (error) {
    console.error('🌸🌸🌸 Error starting ClipMD picker:', error);
    return false;
  }
}

/***** MESSAGE HANDLERS *****/

/**
 * Setup background listeners for ClipMD conversion requests.
 * @returns {void}
 */
export function initClipmd() {
  setupClipmdPopupPortListeners();

  if (chrome?.debugger?.onEvent && !hasRegisteredClipmdDebuggerListeners) {
    hasRegisteredClipmdDebuggerListeners = true;

    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (method !== 'Overlay.inspectNodeRequested') return;
      const backendNodeId = params?.backendNodeId;
      const tabId = source?.tabId;
      if (typeof tabId !== 'number' || typeof backendNodeId !== 'number') return;

      const session = clipmdSessions.get(tabId);
      if (!session) return;

      // Mark as "picked" so popup-close cancellation won't stop a real pick flow.
      session.didInspectRequest = true;
      clearTimeout(session.cancelOnPopupCloseTimeoutId);
      session.cancelOnPopupCloseTimeoutId = null;

      (async () => {
        try {
          const { outerHTML } = await sendDebuggerCommand(session.debuggee, 'DOM.getOuterHTML', { backendNodeId });
          const html = typeof outerHTML === 'string' ? outerHTML : '';
          if (!html) throw new Error('Empty outerHTML');

          const result = await convertHtmlToMarkdown(html);
          if (!result?.ok) throw new Error(result?.error || 'Convert failed');

          const markdown = typeof result.markdown === 'string' ? result.markdown : '';
          if (!markdown) throw new Error('Empty markdown');

          const wrote = await writeTextToTab(tabId, markdown);
          if (!wrote) throw new Error('Clipboard write failed');
        } catch (error) {
          console.error('🌸🌸🌸 ClipMD inspect failed:', error);
        } finally {
          await cleanupClipmdSession(tabId);
        }
      })();
    });

    chrome.debugger.onDetach.addListener((source) => {
      const tabId = source?.tabId;
      if (typeof tabId !== 'number') return;
      const session = clipmdSessions.get(tabId);
      if (!session) return;
      clearTimeout(session.timeoutId);
      clearTimeout(session.cancelOnPopupCloseTimeoutId);
      clipmdSessions.delete(tabId);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.clipmdStart) {
      (async () => {
        const mode = typeof message?.data?.mode === 'string' ? message.data.mode : 'markdown';
        if (mode !== 'markdown') return { success: false, error: 'Unsupported mode' };

        const sourceLabel = typeof message?.data?.source === 'string' ? message.data.source : 'runtime';
        const senderTabId = typeof sender?.tab?.id === 'number' ? sender.tab.id : undefined;
        const ok = await startClipmdMarkdownPicker({ tabId: senderTabId, source: sourceLabel });
        return { success: ok };
      })()
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('🌸🌸🌸 Error starting ClipMD:', error);
          sendResponse({ success: false, error: 'Internal error' });
        });

      return true;
    }

    if (message.action !== messageActions.clipmdConvertMarkdown) return false;

    (async () => {
      const rawHtml = typeof message?.data?.html === 'string' ? message.data.html : '';
      if (!rawHtml) return { success: false, error: 'No HTML provided' };

      // Basic safety bounds to prevent huge payloads from freezing the SW.
      const maxChars = 300_000;
      if (rawHtml.length > maxChars) {
        return { success: false, error: 'HTML too large' };
      }

      const result = await convertHtmlToMarkdown(rawHtml);
      if (!result?.ok) return { success: false, error: result?.error || 'Convert failed' };

      const markdown = typeof result.markdown === 'string' ? result.markdown : '';
      if (!markdown) return { success: false, error: 'Empty markdown' };

      return { success: true, markdown };
    })()
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('🌸🌸🌸 Error converting markdown:', error);
        sendResponse({ success: false, error: 'Internal error' });
      });

    return true;
  });
}
