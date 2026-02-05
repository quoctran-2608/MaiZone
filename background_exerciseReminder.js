/**
 * MaiZone Browser Extension
 * Exercise Reminder Module: Force exercise gate every 45 minutes (paused during Deep Work)
 * @feature f14 - Exercise Reminder
 */

import { ensureInitialized, getState, onStateDelta, updateState } from './background_state.js';
import { messageActions } from './actions.js';

/***** CONFIG *****/

const EXERCISE_INTERVAL_DEFAULT_MS = 45 * 60 * 1000;

const EXERCISE_ALARM = 'maizone_exerciseReminder';
const EXERCISE_GATE_URL = 'exercise_gate.html';

/***** INTERNAL *****/

let unsubscribeStateDelta = null;

let gateTabId = null;
let gateWindowId = null;
let gateActive = false;
let gateTabMutex = null;

/**
 * Check if exercise gate tab is currently open (query-based, survives SW restart)
 */
async function isGateTabOpen() {
  const url = chrome.runtime.getURL(EXERCISE_GATE_URL);
  try {
    const tabs = await chrome.tabs.query({ url });
    return tabs && tabs.length > 0;
  } catch {
    return false;
  }
}

function todayKey() {
  // YYYY-MM-DD in local time
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clampPositiveInt(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, v);
}

/**
 * Ensures exactly one gate tab exists. Uses mutex to prevent race conditions.
 */
async function ensureGateTab() {
  // Mutex: wait for any in-flight ensureGateTab call to finish
  if (gateTabMutex) {
    await gateTabMutex;
    return;
  }

  let resolve;
  gateTabMutex = new Promise((r) => { resolve = r; });

  try {
    await ensureGateTabInternal();
  } finally {
    gateTabMutex = null;
    resolve();
  }
}

async function ensureGateTabInternal() {
  const url = chrome.runtime.getURL(EXERCISE_GATE_URL);

  // First, check if we already have a valid gate tab
  try {
    if (typeof gateTabId === 'number') {
      const tab = await chrome.tabs.get(gateTabId).catch(() => null);
      if (tab && tab.id === gateTabId) {
        gateWindowId = typeof tab.windowId === 'number' ? tab.windowId : gateWindowId;
        if (tab.url !== url) {
          await chrome.tabs.update(gateTabId, { url });
        }
        return; // Already have a valid gate tab
      }
    }
  } catch {
    // ignore
  }

  // Search for any existing exercise_gate.html tabs (in case gateTabId was lost after SW restart)
  try {
    const existingTabs = await chrome.tabs.query({ url });
    if (existingTabs && existingTabs.length > 0) {
      // Use the first one, close duplicates
      const firstTab = existingTabs[0];
      gateTabId = firstTab.id;
      gateWindowId = typeof firstTab.windowId === 'number' ? firstTab.windowId : null;

      // Close any duplicate tabs
      for (let i = 1; i < existingTabs.length; i++) {
        try {
          await chrome.tabs.remove(existingTabs[i].id);
        } catch {
          // ignore
        }
      }
      return;
    }
  } catch {
    // ignore
  }

  // No existing tab found, create a new one
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    if (typeof tab?.id === 'number') {
      gateTabId = tab.id;
      gateWindowId = typeof tab.windowId === 'number' ? tab.windowId : null;
    }
  } catch {
    // ignore
  }
}

/**
 * Recover gate state from existing tabs (survives SW restart).
 * Sets gateActive, gateTabId, gateWindowId if gate tab exists.
 */
async function recoverGateState() {
  const url = chrome.runtime.getURL(EXERCISE_GATE_URL);
  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs && tabs.length > 0) {
      gateActive = true;
      gateTabId = tabs[0].id;
      gateWindowId = typeof tabs[0].windowId === 'number' ? tabs[0].windowId : null;
      // Close duplicates
      for (let i = 1; i < tabs.length; i++) {
        try {
          await chrome.tabs.remove(tabs[i].id);
        } catch {
          // ignore
        }
      }
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function focusGateTab() {
  if (!gateActive) {
    // Try to recover state after SW restart
    const recovered = await recoverGateState();
    if (!recovered) return;
  }
  if (typeof gateTabId !== 'number') {
    // gateActive but no tabId - recover
    const recovered = await recoverGateState();
    if (!recovered || typeof gateTabId !== 'number') return;
  }

  try {
    if (typeof gateWindowId === 'number') {
      await chrome.windows.update(gateWindowId, { focused: true });
    }
  } catch {
    // ignore
  }

  try {
    await chrome.tabs.update(gateTabId, { active: true });
  } catch {
    // ignore
  }
}

export async function triggerExerciseGateNow() {
  // Always run through gate logic, but respect Deep Work priority.
  const s = getState();
  if (!s.exerciseReminderEnabled) return false;
  if (s.isInFlow) return false;

  // Already active (in-memory or existing tab): just focus existing tab
  if (gateActive || await isGateTabOpen()) {
    gateActive = true;
    await ensureGateTab(); // will find existing tab and set gateTabId
    await focusGateTab();
    return true;
  }

  gateActive = true;
  await ensureGateTab();
  await focusGateTab();
  return true;
}

async function startGateIfNeeded() {
  const s = getState();

  if (!s.exerciseReminderEnabled) return;
  if (s.isInFlow) return;

  // Already active (in-memory or existing tab): just focus existing tab
  if (gateActive || await isGateTabOpen()) {
    gateActive = true;
    await ensureGateTab(); // will find existing tab and set gateTabId
    await focusGateTab();
    return;
  }

  gateActive = true;
  await ensureGateTab();
  await focusGateTab();
}

async function stopGate() {
  gateActive = false;
  gateTabId = null;
  gateWindowId = null;

  try {
    await chrome.alarms.clear(EXERCISE_ALARM);
  } catch {
    // ignore
  }

  // Close all exercise gate tabs (query-based to survive SW restart)
  const url = chrome.runtime.getURL(EXERCISE_GATE_URL);
  try {
    const tabs = await chrome.tabs.query({ url });
    for (const tab of tabs) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

async function scheduleExerciseAlarm(expectedAt) {
  if (typeof expectedAt !== 'number' || !Number.isFinite(expectedAt)) return;

  const delayMs = Math.max(0, expectedAt - Date.now());
  const delayMinutes = delayMs / 60000;

  await chrome.alarms.create(EXERCISE_ALARM, { delayInMinutes: Math.max(0, delayMinutes) });
}

async function ensureExerciseSchedule() {
  const s = getState();

  if (!s.exerciseReminderEnabled) {
    await chrome.alarms.clear(EXERCISE_ALARM);
    // Keep exerciseIntervalMs so timer restarts correctly when re-enabled
    await updateState({
      exerciseExpectedAt: null,
      exerciseRemainingMs: null
    });
    return;
  }

  // Deep Work has highest priority: pause schedule while in flow.
  if (s.isInFlow) {
    // Snapshot remaining time once.
    if (typeof s.exerciseRemainingMs !== 'number' || !Number.isFinite(s.exerciseRemainingMs)) {
      if (typeof s.exerciseExpectedAt === 'number' && Number.isFinite(s.exerciseExpectedAt)) {
        const remainingMs = Math.max(0, s.exerciseExpectedAt - Date.now());
        await updateState({ exerciseRemainingMs: remainingMs });
      } else {
        await updateState({ exerciseRemainingMs: EXERCISE_INTERVAL_DEFAULT_MS });
      }
    }

    await chrome.alarms.clear(EXERCISE_ALARM);
    return;
  }

  // Gate is active (waiting for user to complete exercise): pause timer, no new alarms.
  if (gateActive || await isGateTabOpen()) {
    gateActive = true;
    await chrome.alarms.clear(EXERCISE_ALARM);
    return;
  }

  // Not in flow: resume from remaining if present.
  let expectedAt = null;
  if (typeof s.exerciseRemainingMs === 'number' && Number.isFinite(s.exerciseRemainingMs)) {
    expectedAt = Date.now() + Math.max(0, s.exerciseRemainingMs);
    await updateState({ exerciseExpectedAt: expectedAt, exerciseRemainingMs: null });
  } else if (typeof s.exerciseExpectedAt === 'number' && Number.isFinite(s.exerciseExpectedAt)) {
    expectedAt = s.exerciseExpectedAt;
  } else {
    const interval = typeof s.exerciseIntervalMs === 'number' && Number.isFinite(s.exerciseIntervalMs)
      ? s.exerciseIntervalMs
      : EXERCISE_INTERVAL_DEFAULT_MS;
    expectedAt = Date.now() + interval;
    await updateState({ exerciseIntervalMs: interval, exerciseExpectedAt: expectedAt });
  }

  if (Date.now() >= expectedAt) {
    await startGateIfNeeded();
    return;
  }

  await chrome.alarms.clear(EXERCISE_ALARM);
  await scheduleExerciseAlarm(expectedAt);
}

async function addExerciseCounts(counts) {
  const s = getState();
  const date = todayKey();

  let push = clampPositiveInt(counts?.pushUps);
  let sit = clampPositiveInt(counts?.sitUps);
  let squat = clampPositiveInt(counts?.squats);

  // At least one rep required.
  if (push + sit + squat <= 0) return false;

  let next = {
    exerciseStatsDate: s.exerciseStatsDate,
    exerciseStatsPushUps: s.exerciseStatsPushUps,
    exerciseStatsSitUps: s.exerciseStatsSitUps,
    exerciseStatsSquats: s.exerciseStatsSquats
  };

  if (s.exerciseStatsDate !== date) {
    next.exerciseStatsDate = date;
    next.exerciseStatsPushUps = 0;
    next.exerciseStatsSitUps = 0;
    next.exerciseStatsSquats = 0;
  }

  next.exerciseStatsPushUps = clampPositiveInt(next.exerciseStatsPushUps) + push;
  next.exerciseStatsSitUps = clampPositiveInt(next.exerciseStatsSitUps) + sit;
  next.exerciseStatsSquats = clampPositiveInt(next.exerciseStatsSquats) + squat;

  await updateState(next);
  return true;
}

/***** MESSAGING *****/

function isTrustedUiSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;

  const origin = `chrome-extension://${chrome.runtime.id}/`;
  const senderUrl = typeof sender.url === 'string' ? sender.url : '';
  if (senderUrl.startsWith(origin)) return true;

  const tabUrl = typeof sender?.tab?.url === 'string' ? sender.tab.url : '';
  return tabUrl.startsWith(origin);
}

function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || typeof message.action !== 'string') return false;

    if (message.action === messageActions.exerciseGetState) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({ enabled: false, expectedAt: null, remainingMs: null, paused: false });
        return true;
      }

      ensureInitialized()
        .then(() => {
          const s = getState();
          const now = Date.now();

          const todayStats = s.exerciseStatsDate === todayKey()
            ? { pushUps: clampPositiveInt(s.exerciseStatsPushUps), sitUps: clampPositiveInt(s.exerciseStatsSitUps), squats: clampPositiveInt(s.exerciseStatsSquats) }
            : { pushUps: 0, sitUps: 0, squats: 0 };

          if (!s.exerciseReminderEnabled) {
            sendResponse?.({ enabled: false, expectedAt: null, remainingMs: null, paused: false, todayStats });
            return;
          }

          if (s.isInFlow) {
            const remaining = typeof s.exerciseRemainingMs === 'number' && Number.isFinite(s.exerciseRemainingMs)
              ? Math.max(0, s.exerciseRemainingMs)
              : null;
            sendResponse?.({ enabled: true, expectedAt: null, remainingMs: remaining, paused: true, todayStats });
            return;
          }

          const expectedAt = typeof s.exerciseExpectedAt === 'number' && Number.isFinite(s.exerciseExpectedAt)
            ? s.exerciseExpectedAt
            : null;
          const remaining = expectedAt === null ? null : Math.max(0, expectedAt - now);

          sendResponse?.({ enabled: true, expectedAt, remainingMs: remaining, paused: false, todayStats });
        })
        .catch(() => {
          sendResponse?.({ enabled: false, expectedAt: null, remainingMs: null, paused: false });
        });

      return true;
    }

    if (message.action === messageActions.exerciseSubmit) {
      if (!isTrustedUiSender(sender)) {
        sendResponse?.({ success: false, error: 'Forbidden' });
        return true;
      }

      ensureInitialized()
        .then(async () => {
          const ok = await addExerciseCounts(message.data);
          if (!ok) {
            sendResponse?.({ success: false, error: 'Invalid counts' });
            return;
          }

          // Complete gate + reschedule next reminder.
          await stopGate();

          const s = getState();
          const interval = typeof s.exerciseIntervalMs === 'number' && Number.isFinite(s.exerciseIntervalMs)
            ? s.exerciseIntervalMs
            : EXERCISE_INTERVAL_DEFAULT_MS;
          await updateState({ exerciseIntervalMs: interval, exerciseExpectedAt: Date.now() + interval, exerciseRemainingMs: null });
          await ensureExerciseSchedule();

          sendResponse?.({ success: true });
        })
        .catch(() => {
          sendResponse?.({ success: false, error: 'Internal error' });
        });

      return true;
    }

    return false;
  });
}

/***** ALARMS + ENFORCEMENT *****/

function setupAlarmListener() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== EXERCISE_ALARM) return;

    ensureInitialized()
      .then(async () => {
        const s = getState();
        if (!s.exerciseReminderEnabled) return;
        if (s.isInFlow) return;
        await startGateIfNeeded();
      })
      .catch(() => {
        // ignore
      });
  });
}

function setupEnforcementListeners() {
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    if (typeof tabId !== 'number') return;

    ensureInitialized()
      .then(async () => {
        // Recover gate state if needed (SW restart)
        if (!gateActive) {
          const recovered = await recoverGateState();
          if (!recovered) return;
        }
        if (tabId === gateTabId) return;
        const s = getState();
        if (!gateActive || !s.exerciseReminderEnabled || s.isInFlow) return;
        await focusGateTab();
      })
      .catch(() => {});
  });

  chrome.tabs.onCreated.addListener((tab) => {
    const tabId = tab?.id;
    if (typeof tabId !== 'number') return;

    ensureInitialized()
      .then(async () => {
        // Recover gate state if needed (SW restart)
        if (!gateActive) {
          const recovered = await recoverGateState();
          if (!recovered) return;
        }
        if (tabId === gateTabId) return;
        const s = getState();
        if (!gateActive || !s.exerciseReminderEnabled || s.isInFlow) return;
        await focusGateTab();
      })
      .catch(() => {});
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (typeof tabId !== 'number') return;

    ensureInitialized()
      .then(async () => {
        // Check if the removed tab was a gate tab
        const url = chrome.runtime.getURL(EXERCISE_GATE_URL);
        const remainingTabs = await chrome.tabs.query({ url }).catch(() => []);
        
        // If no gate tabs remain but we should have one, reopen
        if (remainingTabs.length === 0) {
          // Was this our gate tab or did user close it?
          if (tabId === gateTabId || gateActive) {
            const s = getState();
            if (!s.exerciseReminderEnabled || s.isInFlow) {
              gateActive = false;
              gateTabId = null;
              gateWindowId = null;
              return;
            }
            // Reopen gate
            gateTabId = null;
            gateWindowId = null;
            gateActive = true;
            await ensureGateTab();
            await focusGateTab();
          }
        } else {
          // Update gateTabId to remaining tab
          gateTabId = remainingTabs[0].id;
          gateWindowId = typeof remainingTabs[0].windowId === 'number' ? remainingTabs[0].windowId : null;
        }
      })
      .catch(() => {});
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    const tabId = details?.tabId;
    if (typeof tabId !== 'number') return;

    ensureInitialized()
      .then(async () => {
        // Recover gate state if needed (SW restart)
        if (!gateActive) {
          const recovered = await recoverGateState();
          if (!recovered) return;
        }
        if (tabId === gateTabId) return;
        const s = getState();
        if (!gateActive || !s.exerciseReminderEnabled || s.isInFlow) return;
        await focusGateTab();
      })
      .catch(() => {});
  });
}

function setupInternalStateSubscription() {
  if (unsubscribeStateDelta) return;
  unsubscribeStateDelta = onStateDelta((nextState, delta) => {
    void handleStateUpdated(delta);
  });
}

async function handleStateUpdated(delta) {
  const relevant =
    'exerciseReminderEnabled' in delta ||
    'isInFlow' in delta ||
    'exerciseExpectedAt' in delta ||
    'exerciseRemainingMs' in delta ||
    'exerciseIntervalMs' in delta;

  if (!relevant) return;

  // If deepwork turns on, stop gate immediately.
  if ('isInFlow' in delta && delta.isInFlow) {
    await stopGate();
  }

  // Best-effort resync schedule.
  await ensureExerciseSchedule();
}

/***** INITIALIZATION *****/

export function initExerciseReminder() {
  setupMessageListeners();
  setupAlarmListener();
  setupEnforcementListeners();
  setupInternalStateSubscription();

  ensureInitialized()
    .then(() => ensureExerciseSchedule())
    .catch(() => ensureExerciseSchedule());
}
