/**
 * MaiZone Browser Extension
 * State Core: Schema + normalization + invariants (pure functions)
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 */

import { DEFAULT_DISTRACTING_SITES, DEFAULT_DEEPWORK_BLOCKED_SITES } from './constants.js';

/***** DEFAULT STATE *****/

export const DEFAULT_STATE = Object.freeze({
  currentTask: '',
  isInFlow: false,
  intentGateEnabled: true,
  breakReminderEnabled: false,
  mindfulnessReminderEnabled: false,
  hasSeenOnboarding: false,
  distractingSites: Object.freeze([...DEFAULT_DISTRACTING_SITES]),
  deepWorkBlockedSites: Object.freeze([...DEFAULT_DEEPWORK_BLOCKED_SITES]),
  reminderStartTime: null,
  reminderInterval: null,
  reminderExpectedEndTime: null,
  mindfulnessLastShownAt: null,

  // Exercise reminder (paused during Deep Work)
  exerciseReminderEnabled: true,
  exerciseIntervalMs: null,
  exerciseExpectedAt: null,
  exerciseRemainingMs: null,

  // Daily exercise stats (YYYY-MM-DD)
  exerciseStatsDate: null,
  exerciseStatsPushUps: 0,
  exerciseStatsSitUps: 0,
  exerciseStatsSquats: 0
});

/**
 * Tạo default state mới (clone arrays để tránh mutation theo reference).
 * @returns {Object}
 */
export function getDefaultState() {
  return {
    ...DEFAULT_STATE,
    distractingSites: [...DEFAULT_STATE.distractingSites],
    deepWorkBlockedSites: [...DEFAULT_STATE.deepWorkBlockedSites]
  };
}

/***** NORMALIZATION HELPERS *****/

/**
 * Chuẩn hoá boolean (chỉ nhận đúng kiểu boolean).
 * @param {any} value - Giá trị cần normalize
 * @param {boolean} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Chuẩn hoá string (chỉ nhận đúng kiểu string).
 * @param {any} value - Giá trị cần normalize
 * @param {string} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {string}
 */
function normalizeString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Chuẩn hoá mảng domain (lowercase, strip protocol/path, strip www, dedupe, sort).
 * @param {any} value - Giá trị cần normalize
 * @param {Array<string>} fallback - Giá trị mặc định nếu không hợp lệ
 * @param {Object} [options]
 * @param {number} [options.maxItems=200] - Số lượng tối đa
 * @returns {Array<string>}
 */
function normalizeDomainList(value, fallback, { maxItems = 200 } = {}) {
  if (!Array.isArray(value)) return fallback;

  const out = [];
  const seen = new Set();

  for (const rawValue of value) {
    if (typeof rawValue !== 'string') continue;

    const raw = rawValue.trim().toLowerCase();
    if (!raw) continue;

    const withoutProtocol = raw.replace(/^https?:\/\//, '');
    const hostname = withoutProtocol
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .replace(/^www\./, '');

    if (!hostname) continue;
    if (hostname.length > 253) continue;
    if (!hostname.includes('.')) continue;
    if (hostname.startsWith('.') || hostname.endsWith('.')) continue;
    if (hostname.includes('..')) continue;
    if (/\s/.test(hostname)) continue;
    if (!/^[a-z0-9.-]+$/.test(hostname)) continue;

    if (seen.has(hostname)) continue;
    seen.add(hostname);
    out.push(hostname);

    if (out.length >= maxItems) break;
  }

  out.sort();
  return out;
}

/**
 * Chuẩn hoá number hoặc null.
 * @param {any} value - Giá trị cần normalize
 * @param {number|null} fallback - Giá trị mặc định nếu không hợp lệ
 * @returns {number|null}
 */
function normalizeNumberOrNull(value, fallback) {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/***** DOMAIN LISTS *****/

const MAX_SITE_LIST_ITEMS = 200;

/***** TIMER NORMALIZATION *****/

const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

const EXERCISE_DEFAULT_INTERVAL_MS = 45 * 60 * 1000;

/**
 * Chuẩn hoá interval ms (giới hạn khoảng hợp lý).
 * @param {any} value - Raw value
 * @param {number|null} fallback - Fallback
 * @returns {number|null}
 */
function normalizeIntervalMs(value, fallback) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < MIN_INTERVAL_MS || value > MAX_INTERVAL_MS) return fallback;
  return value;
}

/***** TASK NORMALIZATION *****/

const MAX_TASK_LENGTH = 120;

/**
 * Chuẩn hoá task string (trim + giới hạn độ dài).
 * @param {any} value - Raw value
 * @param {string} fallback - Fallback
 * @returns {string}
 */
function normalizeTask(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_TASK_LENGTH ? trimmed.slice(0, MAX_TASK_LENGTH) : trimmed;
}

/***** VALIDITY INVARIANTS *****/

/**
 * Enforce validity invariants to keep state consistent.
 * @param {Object} nextState - State sau merge/sanitize/policy
 * @returns {Object} State đã được chỉnh theo invariants
 */
function enforceStateValidity(nextState) {
  const sanitized = { ...nextState };

  // Ensure task is always a string.
  if (!sanitized.currentTask) sanitized.currentTask = '';

  // Validity: in-flow requires a non-empty task.
  if (sanitized.isInFlow && !sanitized.currentTask) {
    sanitized.isInFlow = false;
  }

  // Validity: no flow => no Deep Work timer.
  if (!sanitized.isInFlow || !sanitized.currentTask) {
    sanitized.isInFlow = false;
    sanitized.breakReminderEnabled = false;
    sanitized.reminderStartTime = null;
    sanitized.reminderInterval = null;
    sanitized.reminderExpectedEndTime = null;
  }

  // Exercise reminder defaults
  if (sanitized.exerciseReminderEnabled && (sanitized.exerciseIntervalMs === null || sanitized.exerciseIntervalMs === undefined)) {
    sanitized.exerciseIntervalMs = EXERCISE_DEFAULT_INTERVAL_MS;
  }

  // Deep Work is highest priority: pause exercise reminder while in flow.
  if (sanitized.isInFlow) {
    // Keep schedule fields around for resume; runtime module handles snapshotting remainingMs.
  }

  // Keep exercise stats in a sane range.
  sanitized.exerciseStatsPushUps = Math.max(0, Number.isFinite(sanitized.exerciseStatsPushUps) ? sanitized.exerciseStatsPushUps : 0);
  sanitized.exerciseStatsSitUps = Math.max(0, Number.isFinite(sanitized.exerciseStatsSitUps) ? sanitized.exerciseStatsSitUps : 0);
  sanitized.exerciseStatsSquats = Math.max(0, Number.isFinite(sanitized.exerciseStatsSquats) ? sanitized.exerciseStatsSquats : 0);

  return sanitized;
}

/**
 * Apply policy + validity invariants (compat wrapper).
 * @param {Object} nextState - State sau merge/sanitize
 * @returns {Object} State đã được chỉnh theo policy + invariants
 */
function enforceStateInvariants(nextState) {
  return enforceStateValidity(nextState);
}

/***** PURE TRANSITIONS *****/

/**
 * Sanitize state load từ storage (loại bỏ kiểu sai và set defaults).
 * @param {Object} storedState - Raw state từ chrome.storage.local
 * @returns {Object} State đã sanitize
 */
export function sanitizeStoredState(storedState) {
  const base = getDefaultState();
  const stored = storedState || {};

  const merged = {
    currentTask: normalizeTask(stored.currentTask, base.currentTask),
    isInFlow: normalizeBoolean(stored.isInFlow, base.isInFlow),
    intentGateEnabled: normalizeBoolean(stored.intentGateEnabled, base.intentGateEnabled),
    breakReminderEnabled: normalizeBoolean(stored.breakReminderEnabled, base.breakReminderEnabled),
    mindfulnessReminderEnabled: normalizeBoolean(stored.mindfulnessReminderEnabled, base.mindfulnessReminderEnabled),
    hasSeenOnboarding: normalizeBoolean(stored.hasSeenOnboarding, base.hasSeenOnboarding),
    distractingSites: normalizeDomainList(stored.distractingSites, base.distractingSites, { maxItems: MAX_SITE_LIST_ITEMS }),
    deepWorkBlockedSites: normalizeDomainList(stored.deepWorkBlockedSites, base.deepWorkBlockedSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    }),
    reminderStartTime: normalizeNumberOrNull(stored.reminderStartTime, base.reminderStartTime),
    reminderInterval: normalizeIntervalMs(stored.reminderInterval, base.reminderInterval),
    reminderExpectedEndTime: normalizeNumberOrNull(stored.reminderExpectedEndTime, base.reminderExpectedEndTime),
    mindfulnessLastShownAt: normalizeNumberOrNull(stored.mindfulnessLastShownAt, base.mindfulnessLastShownAt),

    exerciseReminderEnabled: normalizeBoolean(stored.exerciseReminderEnabled, base.exerciseReminderEnabled),
    exerciseIntervalMs: normalizeIntervalMs(stored.exerciseIntervalMs, base.exerciseIntervalMs),
    exerciseExpectedAt: normalizeNumberOrNull(stored.exerciseExpectedAt, base.exerciseExpectedAt),
    exerciseRemainingMs: normalizeNumberOrNull(stored.exerciseRemainingMs, base.exerciseRemainingMs),

    exerciseStatsDate: normalizeString(stored.exerciseStatsDate, base.exerciseStatsDate),
    exerciseStatsPushUps: normalizeNumberOrNull(stored.exerciseStatsPushUps, base.exerciseStatsPushUps) ?? base.exerciseStatsPushUps,
    exerciseStatsSitUps: normalizeNumberOrNull(stored.exerciseStatsSitUps, base.exerciseStatsSitUps) ?? base.exerciseStatsSitUps,
    exerciseStatsSquats: normalizeNumberOrNull(stored.exerciseStatsSquats, base.exerciseStatsSquats) ?? base.exerciseStatsSquats
  };

  return enforceStateInvariants({ ...base, ...merged });
}

/**
 * Apply partial updates -> next full state (sanitize + invariants).
 * @param {Object} currentState - Current full state
 * @param {Object} updates - Partial updates
 * @returns {Object} Next full state
 */
export function computeNextState(currentState, updates) {
  const current = currentState && typeof currentState === 'object' ? currentState : getDefaultState();
  if (!updates || typeof updates !== 'object') return { ...current };

  const sanitized = {};

  if ('currentTask' in updates) sanitized.currentTask = normalizeTask(updates.currentTask, current.currentTask);
  if ('isInFlow' in updates) sanitized.isInFlow = normalizeBoolean(updates.isInFlow, current.isInFlow);
  if ('intentGateEnabled' in updates) {
    sanitized.intentGateEnabled = normalizeBoolean(updates.intentGateEnabled, current.intentGateEnabled);
  }
  if ('breakReminderEnabled' in updates) {
    sanitized.breakReminderEnabled = normalizeBoolean(updates.breakReminderEnabled, current.breakReminderEnabled);
  }
  if ('mindfulnessReminderEnabled' in updates) {
    sanitized.mindfulnessReminderEnabled = normalizeBoolean(
      updates.mindfulnessReminderEnabled,
      current.mindfulnessReminderEnabled
    );
  }
  if ('hasSeenOnboarding' in updates) {
    sanitized.hasSeenOnboarding = normalizeBoolean(updates.hasSeenOnboarding, current.hasSeenOnboarding);
  }
  if ('distractingSites' in updates) {
    sanitized.distractingSites = normalizeDomainList(updates.distractingSites, current.distractingSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    });
  }
  if ('deepWorkBlockedSites' in updates) {
    sanitized.deepWorkBlockedSites = normalizeDomainList(updates.deepWorkBlockedSites, current.deepWorkBlockedSites, {
      maxItems: MAX_SITE_LIST_ITEMS
    });
  }

  if ('reminderStartTime' in updates) {
    sanitized.reminderStartTime = normalizeNumberOrNull(updates.reminderStartTime, current.reminderStartTime);
  }
  if ('reminderInterval' in updates) {
    sanitized.reminderInterval = normalizeIntervalMs(updates.reminderInterval, current.reminderInterval);
  }
  if ('reminderExpectedEndTime' in updates) {
    sanitized.reminderExpectedEndTime = normalizeNumberOrNull(updates.reminderExpectedEndTime, current.reminderExpectedEndTime);
  }

  if ('mindfulnessLastShownAt' in updates) {
    sanitized.mindfulnessLastShownAt = normalizeNumberOrNull(updates.mindfulnessLastShownAt, current.mindfulnessLastShownAt);
  }

  if ('exerciseReminderEnabled' in updates) {
    sanitized.exerciseReminderEnabled = normalizeBoolean(updates.exerciseReminderEnabled, current.exerciseReminderEnabled);
  }
  if ('exerciseIntervalMs' in updates) {
    sanitized.exerciseIntervalMs = normalizeIntervalMs(updates.exerciseIntervalMs, current.exerciseIntervalMs);
  }
  if ('exerciseExpectedAt' in updates) {
    sanitized.exerciseExpectedAt = normalizeNumberOrNull(updates.exerciseExpectedAt, current.exerciseExpectedAt);
  }
  if ('exerciseRemainingMs' in updates) {
    sanitized.exerciseRemainingMs = normalizeNumberOrNull(updates.exerciseRemainingMs, current.exerciseRemainingMs);
  }

  if ('exerciseStatsDate' in updates) {
    sanitized.exerciseStatsDate = normalizeString(updates.exerciseStatsDate, current.exerciseStatsDate);
  }
  if ('exerciseStatsPushUps' in updates) {
    sanitized.exerciseStatsPushUps = normalizeNumberOrNull(updates.exerciseStatsPushUps, current.exerciseStatsPushUps) ?? current.exerciseStatsPushUps;
  }
  if ('exerciseStatsSitUps' in updates) {
    sanitized.exerciseStatsSitUps = normalizeNumberOrNull(updates.exerciseStatsSitUps, current.exerciseStatsSitUps) ?? current.exerciseStatsSitUps;
  }
  if ('exerciseStatsSquats' in updates) {
    sanitized.exerciseStatsSquats = normalizeNumberOrNull(updates.exerciseStatsSquats, current.exerciseStatsSquats) ?? current.exerciseStatsSquats;
  }

  return enforceStateInvariants({ ...current, ...sanitized });
}

/***** DIFF *****/

/**
 * So sánh 2 mảng string theo giá trị.
 * @param {any} a - Array 1
 * @param {any} b - Array 2
 * @returns {boolean}
 */
function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Tạo delta giữa 2 states (so sánh theo value, không theo reference).
 * @param {Object} prevState - State trước
 * @param {Object} nextState - State sau
 * @returns {Object} Delta object chỉ chứa keys thay đổi
 */
export function diffState(prevState, nextState) {
  const prev = prevState && typeof prevState === 'object' ? prevState : {};
  const next = nextState && typeof nextState === 'object' ? nextState : getDefaultState();

  const delta = {};
  Object.keys(next).forEach((key) => {
    const prevValue = prev[key];
    const nextValue = next[key];

    if (Array.isArray(nextValue)) {
      if (!areStringArraysEqual(prevValue, nextValue)) delta[key] = nextValue;
      return;
    }

    if (prevValue !== nextValue) delta[key] = nextValue;
  });

  return delta;
}
