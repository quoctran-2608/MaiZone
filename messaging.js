/**
 * MaiZone Browser Extension
 * Messaging Helpers: Safe message passing with timeouts
 * @feature f05 - State Management
 */

/***** INTERNALS *****/

/**
 * Check whether extension context is still valid.
 * @returns {boolean} True if safe to call chrome.runtime APIs
 */
function isExtensionContextValid() {
  return !!(globalThis?.chrome?.runtime && chrome.runtime.id !== undefined);
}

/***** RUNTIME MESSAGING *****/

/**
 * Send a message to the background script safely (timeout + invalidation handling).
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=2000] - Timeout in ms
 * @returns {Promise<any|null>} Response object or null on failure/timeout
 */
export async function sendMessageSafely(message, { timeoutMs = 2000 } = {}) {
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

/**
 * Send a message to a specific tab safely (timeout + invalidation handling).
 * @param {number} tabId - Chrome tab id
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=2000] - Timeout in ms
 * @returns {Promise<any|null>} Response object or null on failure/timeout
 */
export async function sendMessageToTabSafely(tabId, message, { timeoutMs = 2000 } = {}) {
  try {
    if (!isExtensionContextValid()) return null;
    if (typeof tabId !== 'number') return null;

    return await new Promise((resolve) => {
      const timeoutId = setTimeout(() => resolve(null), timeoutMs);

      try {
        chrome.tabs.sendMessage(tabId, message, (reply) => {
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

