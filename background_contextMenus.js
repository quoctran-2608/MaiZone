/**
 * MaiZone Browser Extension
 * Context Menus: Quick actions via right-click menu (toggle intent gate list + copy Markdown helpers)
 * @feature f10 - Context Menu Quick Actions
 * @feature f13 - Intent Gate for Distracting Sites (integration)
 * @feature f06 - ClipMD (integration-lite)
 */

import { ensureInitialized, getState, updateState } from './background_state.js';
import { messageActions } from './actions.js';
import { sendMessageToTabSafely } from './messaging.js';

/***** MENU IDS *****/

const MAI_MENU_ROOT_ID = 'mai_root';
const MAI_MENU_TOGGLE_BLOCK_SITE_ID = 'mai_toggle_block_site';
const MAI_MENU_COPY_SELECTION_MD_ID = 'mai_copy_selection_markdown';
const MAI_MENU_COPY_LINK_MD_ID = 'mai_copy_link_markdown';
const MAI_MENU_COPY_IMAGE_MD_ID = 'mai_copy_image_markdown';

/***** HELPERS *****/

/**
 * Check whether a URL is a regular http/https URL.
 * @param {string} url - Full URL
 * @returns {boolean}
 */
function isHttpUrl(url) {
  if (typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Get a normalized hostname from a URL.
 * @param {string} url - Full URL
 * @returns {string} Hostname (lowercase, no www) or empty string
 */
function getHostname(url) {
  try {
    if (!isHttpUrl(url)) return '';
    const parsed = new URL(url);
    return (parsed.hostname || '').toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
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
 * Show a small Mai toast on a specific tab (best-effort).
 * @param {number} tabId - Target tab id
 * @param {string} text - Toast text
 * @returns {Promise<boolean>} True if delivered
 */
async function sendMaiToastToTab(tabId, text) {
  const message = typeof text === 'string' ? text : '';
  if (!message) return false;
  if (typeof tabId !== 'number') return false;

  const reply = await sendMessageToTabSafely(
    tabId,
    { action: messageActions.maiToast, data: { text: message } },
    { timeoutMs: 1200 }
  );

  if (reply?.ok) return true;

  // Best-effort: content scripts may be missing (existing tabs after reload). Inject and retry once.
  await ensureContentScriptsInjected(tabId);
  const retry = await sendMessageToTabSafely(
    tabId,
    { action: messageActions.maiToast, data: { text: message } },
    { timeoutMs: 1200 }
  );
  return !!retry?.ok;
}

/**
 * Write text to clipboard within the tab (best-effort).
 * @param {number} tabId - Target tab
 * @param {string} text - Clipboard text
 * @returns {Promise<boolean>} True if executed without runtime error
 */
async function writeTextToTab(tabId, text) {
  if (!chrome?.scripting?.executeScript) return false;
  if (typeof tabId !== 'number') return false;
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
        () => resolve(!chrome.runtime.lastError)
      );
    } catch {
      resolve(false);
    }
  });
}

/**
 * Build Markdown for a link URL.
 * @param {string} url - Link URL
 * @returns {string}
 */
function buildLinkMarkdown(url) {
  const raw = typeof url === 'string' ? url : '';
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const label = (parsed.hostname || 'link').toLowerCase().replace(/^www\./, '');
    return `[${label}](${parsed.href})`;
  } catch {
    return `[link](${raw})`;
  }
}

/**
 * Build Markdown for an image URL.
 * @param {string} url - Image URL
 * @returns {string}
 */
function buildImageMarkdown(url) {
  const raw = typeof url === 'string' ? url : '';
  if (!raw) return '';
  return `![](${raw})`;
}

/***** MENU SETUP *****/

let hasInitializedContextMenus = false;
let hasRegisteredContextMenuListeners = false;

/**
 * Create (or recreate) context menu items (idempotent).
 * @returns {Promise<void>}
 */
async function createContextMenus() {
  if (!chrome?.contextMenus?.removeAll || !chrome?.contextMenus?.create) return;

  await new Promise((resolve) => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });

  try {
    chrome.contextMenus.create({
      id: MAI_MENU_ROOT_ID,
      title: 'MaiZone',
      contexts: ['page', 'selection', 'link', 'image']
    });

    chrome.contextMenus.create({
      id: MAI_MENU_TOGGLE_BLOCK_SITE_ID,
      parentId: MAI_MENU_ROOT_ID,
      title: 'Hỏi lý do cho trang này',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: MAI_MENU_COPY_SELECTION_MD_ID,
      parentId: MAI_MENU_ROOT_ID,
      title: 'Copy đoạn bôi đen → Markdown',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: MAI_MENU_COPY_LINK_MD_ID,
      parentId: MAI_MENU_ROOT_ID,
      title: 'Copy link → Markdown',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: MAI_MENU_COPY_IMAGE_MD_ID,
      parentId: MAI_MENU_ROOT_ID,
      title: 'Copy ảnh → Markdown',
      contexts: ['image']
    });
  } catch (error) {
    // ignore (duplicate ids, invalid contexts, etc.)
  }
}

/**
 * Update intent gate toggle title right before the menu shows (best-effort).
 * @param {chrome.contextMenus.OnShownInfo} info - OnShown info
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {void}
 */
function handleContextMenusShown(info, tab) {
  if (!chrome?.contextMenus?.update || !chrome?.contextMenus?.refresh) return;

  (async () => {
    await ensureInitialized();

    const url = typeof tab?.url === 'string' ? tab.url : '';
    const hostname = getHostname(url);
    const enabled = !!hostname;

    const { distractingSites } = getState();
    const list = Array.isArray(distractingSites) ? distractingSites : [];
    const isBlocked = enabled ? list.includes(hostname) : false;

    const title = isBlocked ? 'Bỏ hỏi lý do cho trang này' : 'Hỏi lý do cho trang này';

    try {
      chrome.contextMenus.update(MAI_MENU_TOGGLE_BLOCK_SITE_ID, { title, enabled });
      chrome.contextMenus.refresh();
    } catch {
      // ignore
    }
  })().catch(() => {});
}

/**
 * Handle intent gate list toggle for a tab.
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<void>}
 */
async function handleToggleBlockSite(tab) {
  await ensureInitialized();

  const tabId = typeof tab?.id === 'number' ? tab.id : null;
  const url = typeof tab?.url === 'string' ? tab.url : '';
  const hostname = getHostname(url);

  if (typeof tabId !== 'number' || !hostname) return;

  const { distractingSites } = getState();
  const list = Array.isArray(distractingSites) ? distractingSites : [];
  const isBlocked = list.includes(hostname);

  const nextSites = isBlocked ? list.filter((h) => h !== hostname) : [...list, hostname];
  const ok = await updateState({ distractingSites: nextSites });

  if (!ok) {
    await sendMaiToastToTab(tabId, '🌸 Mai gặp lỗi khi cập nhật danh sách hỏi lý do.');
    return;
  }

  if (isBlocked) {
    await sendMaiToastToTab(tabId, `🌸 Đã bỏ hỏi lý do ${hostname}.`);
    return;
  }

  await sendMaiToastToTab(tabId, `🌸 Đã bật hỏi lý do cho ${hostname}.`);
}

/**
 * Handle "copy selection -> Markdown" menu click.
 * @param {chrome.contextMenus.OnClickData} info - Click info
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<void>}
 */
async function handleCopySelectionMarkdown(info, tab) {
  const tabId = typeof tab?.id === 'number' ? tab.id : null;
  if (typeof tabId !== 'number') return;

  const selectionText = typeof info?.selectionText === 'string' ? info.selectionText : '';
  const trimmed = selectionText.trim();

  if (!trimmed) {
    await sendMaiToastToTab(tabId, '🌸 Không có đoạn bôi đen để copy.');
    return;
  }

  const ok = await writeTextToTab(tabId, trimmed);
  if (ok) {
    await sendMaiToastToTab(tabId, '🌸 Đã copy Markdown từ đoạn bôi đen.');
    return;
  }

  await sendMaiToastToTab(tabId, '🌸 Mai chưa copy được. Bạn thử lại giúp Mai nhé.');
}

/**
 * Handle "copy link -> Markdown" menu click.
 * @param {chrome.contextMenus.OnClickData} info - Click info
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<void>}
 */
async function handleCopyLinkMarkdown(info, tab) {
  const tabId = typeof tab?.id === 'number' ? tab.id : null;
  if (typeof tabId !== 'number') return;

  const markdown = buildLinkMarkdown(info?.linkUrl);
  if (!markdown) {
    await sendMaiToastToTab(tabId, '🌸 Mai không lấy được link để copy.');
    return;
  }

  const ok = await writeTextToTab(tabId, markdown);
  if (ok) {
    await sendMaiToastToTab(tabId, '🌸 Đã copy link Markdown.');
    return;
  }

  await sendMaiToastToTab(tabId, '🌸 Mai chưa copy được. Bạn thử lại giúp Mai nhé.');
}

/**
 * Handle "copy image -> Markdown" menu click.
 * @param {chrome.contextMenus.OnClickData} info - Click info
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {Promise<void>}
 */
async function handleCopyImageMarkdown(info, tab) {
  const tabId = typeof tab?.id === 'number' ? tab.id : null;
  if (typeof tabId !== 'number') return;

  const markdown = buildImageMarkdown(info?.srcUrl);
  if (!markdown) {
    await sendMaiToastToTab(tabId, '🌸 Mai không lấy được ảnh để copy.');
    return;
  }

  const ok = await writeTextToTab(tabId, markdown);
  if (ok) {
    await sendMaiToastToTab(tabId, '🌸 Đã copy ảnh Markdown.');
    return;
  }

  await sendMaiToastToTab(tabId, '🌸 Mai chưa copy được. Bạn thử lại giúp Mai nhé.');
}

/**
 * Handle context menu clicks.
 * @param {chrome.contextMenus.OnClickData} info - Click info
 * @param {chrome.tabs.Tab} tab - Current tab
 * @returns {void}
 */
function handleContextMenusClicked(info, tab) {
  const id = info?.menuItemId;
  if (typeof id !== 'string') return;

  if (id === MAI_MENU_TOGGLE_BLOCK_SITE_ID) {
    handleToggleBlockSite(tab).catch(() => {});
    return;
  }

  if (id === MAI_MENU_COPY_SELECTION_MD_ID) {
    handleCopySelectionMarkdown(info, tab).catch(() => {});
    return;
  }

  if (id === MAI_MENU_COPY_LINK_MD_ID) {
    handleCopyLinkMarkdown(info, tab).catch(() => {});
    return;
  }

  if (id === MAI_MENU_COPY_IMAGE_MD_ID) {
    handleCopyImageMarkdown(info, tab).catch(() => {});
  }
}

/**
 * Initialize context menus (create + register listeners once).
 * @feature f10 - Context Menu Quick Actions
 * @returns {void}
 */
export function initContextMenus() {
  if (!chrome?.contextMenus) return;

  if (!hasRegisteredContextMenuListeners) {
    hasRegisteredContextMenuListeners = true;

    try {
      chrome.contextMenus.onClicked.addListener(handleContextMenusClicked);
    } catch {
      // ignore
    }

    try {
      chrome.contextMenus.onShown.addListener(handleContextMenusShown);
    } catch {
      // ignore
    }
  }

  if (hasInitializedContextMenus) return;
  hasInitializedContextMenus = true;

  createContextMenus().catch(() => {});
}
