/**
 * MaiZone Browser Extension
 * Intent Gate Helpers: Pure helpers for distracting sites intention gate
 * @feature f13 - Intent Gate for Distracting Sites
 */

import { getHostnameFromUrl, isHostnameInList } from './distraction_matcher.js';

/***** MATCHING *****/

/**
 * Compute whether a URL should trigger intent gate.
 * @param {string} url - Full URL
 * @param {Object} state - Current state snapshot
 * @returns {{hostname: string, shouldGate: boolean, isDeepWorkBlocked: boolean}}
 */
export function getIntentGateMatch(url, state) {
  const s = state && typeof state === 'object' ? state : {};
  const hostname = getHostnameFromUrl(url);
  if (!hostname) return { hostname: '', shouldGate: false, isDeepWorkBlocked: false };

  const distractingSites = Array.isArray(s.distractingSites) ? s.distractingSites : [];
  const deepWorkBlockedSites = Array.isArray(s.deepWorkBlockedSites) ? s.deepWorkBlockedSites : [];
  const isInFlow = !!s.isInFlow;

  const isStandardDistracting = isHostnameInList(hostname, distractingSites);
  const isDeepWorkBlocked = isInFlow && isHostnameInList(hostname, deepWorkBlockedSites);

  return {
    hostname,
    shouldGate: isStandardDistracting || isDeepWorkBlocked,
    isDeepWorkBlocked
  };
}
