/**
 * MaiZone Browser Extension
 * Distraction Matcher: Pure helpers for URL/hostname matching (no chrome APIs)
 * @feature f13 - Intent Gate for Distracting Sites
 * @feature f04c - Deep Work Mode Integration
 */

/***** NORMALIZATION *****/

/**
 * Normalize a hostname for comparison (lowercase, strip leading www.).
 * @param {string} hostname - Hostname string
 * @returns {string} Normalized hostname or empty string
 */
export function normalizeHostnameForComparison(hostname) {
  if (typeof hostname !== 'string') return '';
  return hostname.trim().toLowerCase().replace(/^www\./, '');
}

/**
 * Extract and normalize hostname from a URL (http/https only).
 * @param {string} url - Full URL
 * @returns {string} Normalized hostname or empty string
 */
export function getHostnameFromUrl(url) {
  try {
    if (typeof url !== 'string') return '';
    if (!url.startsWith('http://') && !url.startsWith('https://')) return '';
    const { hostname } = new URL(url);
    return normalizeHostnameForComparison(hostname);
  } catch {
    return '';
  }
}

/***** MATCHING *****/

/**
 * Check whether a hostname matches a site allowlist/blocklist entry.
 * - Exact match: host === site
 * - Subdomain match: host endsWith('.' + site)
 * @param {string} hostname - Normalized hostname
 * @param {Array<string>} sites - List of hostnames (ideally normalized)
 * @returns {boolean}
 */
export function isHostnameInList(hostname, sites) {
  const host = normalizeHostnameForComparison(hostname);
  if (!host) return false;
  if (!Array.isArray(sites) || !sites.length) return false;

  return sites.some((site) => {
    const s = normalizeHostnameForComparison(site);
    if (!s) return false;
    return host === s || host.endsWith('.' + s);
  });
}
