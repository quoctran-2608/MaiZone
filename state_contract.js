/**
 * MaiZone Browser Extension
 * State Contract: Shared allowlists for state access/mutations across contexts
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 */

import { DEFAULT_STATE } from './state_core.js';

/***** STATE KEYS *****/

export const STATE_KEYS = Object.freeze(Object.keys(DEFAULT_STATE));

/***** ALLOWLISTS *****/

// Keys that UI (popup/options) is allowed to mutate via runtime messaging / fallback storage.
export const UI_ALLOWED_UPDATE_KEYS = Object.freeze([
  'intentGateEnabled',
  'breakReminderEnabled',
  'mindfulnessReminderEnabled',
  'hasSeenOnboarding',
  'currentTask',
  'isInFlow',
  'distractingSites',
  'deepWorkBlockedSites',

  // Exercise reminder
  'exerciseReminderEnabled'
]);

// Minimal subset exposed to untrusted senders (e.g., content scripts).
export const UNTRUSTED_STATE_KEYS = Object.freeze(['isInFlow']);
