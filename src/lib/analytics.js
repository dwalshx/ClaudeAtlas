/**
 * ClaudeAtlas analytics — PostHog client loader + event helpers.
 *
 * Design goals:
 *   - Zero bundle cost when PUBLIC_POSTHOG_KEY is unset (no-op export)
 *   - Six specific events, no autocapture, no session recording
 *   - EU PostHog cloud to minimize GDPR exposure
 *   - Safe to import from client scripts — never throws, never blocks
 *
 * Events:
 *   - copy_install_command  — user clicks the copy button on a skill
 *   - click_github_link     — user clicks through to GitHub
 *   - search_query          — user typed a search query (debounced)
 *   - category_click        — user clicked a category chip
 *   - view_skill_detail     — automatic pageview on /skills/* (fired once on load)
 *   - badge_click           — page loaded with ?ref=badge (fired once on load)
 *
 * Wiring:
 *   Import { track } from '../lib/analytics.js' in any client <script> block
 *   and call track('event_name', optionalProps).
 *   Call initPosthog() once per page load (handled in BaseLayout).
 */

const POSTHOG_HOST = 'https://eu.i.posthog.com';
const POSTHOG_KEY = import.meta.env.PUBLIC_POSTHOG_KEY || '';
const ENABLED = Boolean(POSTHOG_KEY);

export const ANALYTICS_ENABLED = ENABLED;
export const ANALYTICS_HOST = POSTHOG_HOST;
export const ANALYTICS_KEY = POSTHOG_KEY;

export const EVENT_NAMES = /** @type {const} */ ({
  COPY_INSTALL: 'copy_install_command',
  CLICK_GITHUB: 'click_github_link',
  SEARCH_QUERY: 'search_query',
  CATEGORY_CLICK: 'category_click',
  VIEW_SKILL_DETAIL: 'view_skill_detail',
  BADGE_CLICK: 'badge_click',
});

/**
 * PostHog snippet loader (browser-only). Call once per page in BaseLayout.
 * No-op if PUBLIC_POSTHOG_KEY is not set.
 *
 * The snippet is adapted from PostHog's official JS-snippet loader but
 * stripped down to the parts we need. It sets up `window.posthog` as a
 * queue until the real SDK loads, so early track() calls aren't lost.
 */
export function buildPosthogSnippet() {
  if (!ENABLED) return '';
  // PostHog's stock queue-init snippet (trimmed). Loads `/static/array.js`
  // asynchronously from the EU host and then initializes with our key.
  return `(function(){var e,n,t,r,o=window;o.posthog||(e=o.posthog=[],e._i=[],e.init=function(i,s,a){function g(e,t){var n=t.split(".");2==n.length&&(e=e[n[0]],t=n[1]),e[t]=function(){e.push([t].concat(Array.prototype.slice.call(arguments,0)))}}(t=document.createElement("script")).type="text/javascript",t.async=!0,t.src=(s&&s.api_host||"${POSTHOG_HOST}")+"/static/array.js",(n=document.getElementsByTagName("script")[0]).parentNode.insertBefore(t,n);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(e){var n="posthog";return"posthog"!==a&&(n+="."+a),e||(n+=" (stub)"),n},u.people.toString=function(){return u.toString(1)+".people (stub)"},r="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys".split(" "),n=0;n<r.length;n++)g(u,r[n]);e._i.push([i,s,a])},e.__SV=1)})();
posthog.init(${JSON.stringify(POSTHOG_KEY)}, {
  api_host: ${JSON.stringify(POSTHOG_HOST)},
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,
  persistence: 'localStorage+cookie'
});`;
}
