/**
 * MaiZone Browser Extension
 * Intent Gate UI: Require reason before accessing distracting sites
 * @feature f13 - Intent Gate for Distracting Sites
 */

import { sendMessageSafely } from './messaging.js';
import { messageActions } from './actions.js';

/***** CONFIG *****/

const MIN_CHARS = 5;

/***** ELEMENTS *****/

const textarea = document.getElementById('reason');
const counter = document.getElementById('counter');
const submitBtn = document.getElementById('submit');
const historyToggle = document.getElementById('historyToggle');
const historyList = document.getElementById('historyList');

const urlParams = new URLSearchParams(window.location.search);
const tabId = Number(urlParams.get('tabId'));

/***** UTILITIES *****/

/**
 * Count non-whitespace characters in a string.
 * @param {string} value - Raw input
 * @returns {number}
 */
function countNonWhitespace(value) {
  if (typeof value !== 'string') return 0;
  return value.replace(/\s/g, '').length;
}

/**
 * Update the character counter UI.
 * @returns {void}
 */
function updateCounter() {
  const count = countNonWhitespace(textarea?.value || '');
  const isValid = count >= MIN_CHARS;

  if (counter) {
    counter.textContent = `${count} / ${MIN_CHARS} ký tự`;
    counter.classList.toggle('valid', isValid);
  }

  if (submitBtn) submitBtn.disabled = !isValid;
}

/**
 * Escape HTML to avoid injection in history view.
 * @param {string} text - Raw string
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format timestamp in Vietnamese.
 * @param {number} timestamp - Epoch ms
 * @returns {string}
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) {
    return `Hôm nay lúc ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Hôm qua lúc ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} lúc ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

/**
 * Render reason history.
 * @param {Array<{reason:string,timestamp:number}>} log - Reason log
 * @returns {void}
 */
function renderHistory(log) {
  if (!historyList) return;

  if (!Array.isArray(log) || !log.length) {
    historyList.innerHTML = '<p class="history-empty">Chưa có lý do nào.</p>';
    return;
  }

  historyList.innerHTML = log
    .map(
      (entry) => `
        <div class="history-item">
          <div class="history-reason">${escapeHtml(entry.reason || '')}</div>
          <div class="history-time">${formatTime(entry.timestamp || Date.now())}</div>
        </div>
      `
    )
    .join('');
}

/***** EVENTS *****/

textarea?.addEventListener('input', updateCounter);

submitBtn?.addEventListener('click', () => {
  const reason = typeof textarea?.value === 'string' ? textarea.value.trim() : '';
  const count = countNonWhitespace(reason);
  if (count < MIN_CHARS) return;

  if (!Number.isFinite(tabId)) {
    submitBtn.textContent = 'Không tìm thấy tab';
    submitBtn.disabled = true;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang mở...';

  sendMessageSafely(
    {
      action: messageActions.intentGateAllowAccess,
      data: { tabId, reason }
    },
    { timeoutMs: 6000 }
  )
    .then((response) => {
      if (!response?.success) {
        submitBtn.textContent = 'Thử lại';
        submitBtn.disabled = false;
      }
    })
    .catch(() => {
      submitBtn.textContent = 'Lỗi kết nối';
      submitBtn.disabled = false;
    });
});

textarea?.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    if (!submitBtn?.disabled) submitBtn.click();
  }
});

historyToggle?.addEventListener('click', () => {
  const isOpen = historyToggle.classList.toggle('open');
  historyList?.classList.toggle('visible', isOpen);

  if (!isOpen) return;

  sendMessageSafely({ action: messageActions.intentGateGetReasonLog }, { timeoutMs: 4000 })
    .then((response) => {
      if (response?.success) {
        renderHistory(response.log || []);
        return;
      }
      renderHistory([]);
    })
    .catch(() => renderHistory([]));
});

/***** INIT *****/

updateCounter();
