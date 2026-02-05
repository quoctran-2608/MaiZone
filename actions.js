/**
 * MaiZone Browser Extension
 * Message Actions: Centralized action names for runtime messaging
 * @feature f05 - State Management
 * @feature f08 - Mindfulness Reminders
 * @feature f10 - Context Menu Quick Actions
 */

/***** ACTION NAMES *****/

export const messageActions = Object.freeze({
  maiToast: 'maiToast',
  mindfulnessToast: 'mindfulnessToast',
  clipmdStart: 'clipmdStart',
  clipmdConvertMarkdown: 'clipmdConvertMarkdown',
  resetBreakReminder: 'resetBreakReminder',
  getBreakReminderState: 'getBreakReminderState',
  breakReminderBadgeTick: 'breakReminderBadgeTick',
  triggerMindfulnessToast: 'triggerMindfulnessToast',
  triggerBreakReminder: 'triggerBreakReminder',
  triggerExerciseReminder: 'triggerExerciseReminder',
  intentGateAllowAccess: 'intentGateAllowAccess',
  intentGateGetReasonLog: 'intentGateGetReasonLog',

  exerciseGetState: 'exerciseGetState',
  exerciseSubmit: 'exerciseSubmit',

  getState: 'getState',
  updateState: 'updateState',
  stateUpdated: 'stateUpdated'
});
