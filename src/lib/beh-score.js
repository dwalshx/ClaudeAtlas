/**
 * src/lib/beh-score.js — pure STRUCTURAL behavioral scorer
 * (quick-260905-fib, L4 behavioral beacon, BEH-01).
 *
 * Turns ~10 structural interaction aggregates (computed in the browser) into a
 * 0..1 automation-likelihood score and a conservative band:
 *
 *   'human-shaped' | 'uncertain' | 'automation-signature'
 *
 * This is the ONE agent class the log-based band cannot see: agentic browsers
 * (ChatGPT Atlas, Claude-in-Chrome, Perplexity Comet) that run real Chrome
 * from residential IPs but EXECUTE JS, so their INPUT-EVENT STRUCTURE betrays
 * automation. It COMPLEMENTS the log-based band (request_log) — it does not
 * replace it. See docs/agent-analytics-research/04-detection-sota.md §7 (L4).
 *
 * DESIGN DISCIPLINE (mirrors worker/asn-class.js):
 *   - Pure ESM: ZERO imports, ZERO I/O. Importable by the client bundle AND
 *     by plain `node --test`.
 *   - NEVER throws. Missing / NaN / non-finite fields are treated as 0 (or
 *     false for booleans). Score is always clamped to [0, 1].
 *
 * PRIVACY (PRIV-04, the biometric tripwire): keydown is consumed as a COUNT
 * scalar ONLY. This module never references per-key identity or per-key timing
 * — no such field is passed in, and none may ever be added. Keystroke DYNAMICS
 * (inter-key latency, dwell time, key identities) are biometric; a raw count is
 * not.
 *
 * CALIBRATION: the weights and thresholds below are conservative STARTING
 * values. They will be calibrated post-deploy against sessions the log-based
 * band already flagged (BEH-01, §04-detection-sota §1.4 minimal validated set
 * {mouse_event_rate, teleport_click_ratio, wheel absence}). The uncertain
 * middle deliberately absorbs ambiguity — we would rather under-call than
 * false-positive a human. Per §7's rule, a MISSING signal must NEVER become
 * evidence-of-automation.
 */

// Below this total interaction volume we cannot say anything: a human who read
// and left, or an assistive-tech / keyboard-only visitor, produces near-zero
// structural signal. Such sessions are ALWAYS 'uncertain', never automation.
const MIN_INTERACTION_FOR_VERDICT = 12;

// Band cutoffs on the 0..1 automation score (conservative — wide uncertain
// middle). >= HIGH → automation-signature; <= LOW → human-shaped; else
// uncertain.
const BAND_HIGH = 0.6;
const BAND_LOW = 0.4;

// Component weights (sum to 1.0). Each component is itself a 0..1 sub-signal.
const WEIGHTS = {
  lowMouseRateWithClicks: 0.3, // clicks happen but the pointer barely moved
  wheelAbsenceWithInteraction: 0.2, // no wheel at all despite real activity (Playwright has no scroll.wheel)
  highTeleportRatio: 0.25, // clicks appear with no approach movement before them
  lowPointerMoveWithInteraction: 0.15, // almost no pointermove events despite activity
  lowClickDurationSpread: 0.1, // press durations are unnaturally uniform
};

// Coerce any input to a finite number, defaulting to 0. Never throws.
function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v) {
  return v === true;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * scoreBehavior(features) → { score, band, signals }.
 *
 * `features` (all optional; missing → 0/false):
 *   mouse_event_rate      number   mousemove events / second over the session
 *   has_wheel             boolean  any wheel event seen
 *   wheel_count           number
 *   teleport_click_ratio  number   0..1; clicks with no approach movement ÷ clicks
 *   click_count           number
 *   pointer_move_count    number
 *   keydown_count         number   COUNT ONLY (the biometric tripwire)
 *   session_ms            number
 *   click_duration_spread number   std of mousedown→mouseup ms (aggregate only)
 *   interaction_total     number   sum of interaction events
 */
export function scoreBehavior(features) {
  const f = features && typeof features === 'object' ? features : {};

  const mouseRate = num(f.mouse_event_rate);
  const hasWheel = bool(f.has_wheel);
  const teleportRatio = clamp01(num(f.teleport_click_ratio));
  const clickCount = num(f.click_count);
  const pointerMoveCount = num(f.pointer_move_count);
  const clickDurationSpread = num(f.click_duration_spread);
  const interactionTotal = num(f.interaction_total);

  // --- Component sub-signals (each 0..1) ---------------------------------
  const hasClicks = clickCount > 0;

  // 1. Low mouse-event-rate WHILE clicking. A human who clicks moved the mouse
  //    to get there; a low rate with clicks present is the strongest tell.
  //    Only meaningful when clicks exist (no clicks → 0 contribution).
  const lowMouseRateWithClicks = hasClicks
    ? clamp01((5 - mouseRate) / 5) // rate 0 → 1.0, rate >=5/s → 0
    : 0;

  // 2. Wheel absence despite real interaction. Playwright/CDP have no
  //    scroll.wheel() → a session with meaningful activity and ZERO wheel is
  //    suspicious. Gated on interaction volume so read-and-left never trips it.
  const wheelAbsenceWithInteraction =
    !hasWheel && interactionTotal >= MIN_INTERACTION_FOR_VERDICT ? 1 : 0;

  // 3. High teleport-click ratio. Clicks materializing with no approach
  //    movement in the ~500ms / ~100px before them.
  const highTeleportRatio = hasClicks ? teleportRatio : 0;

  // 4. Almost no pointermove events despite interaction.
  const lowPointerMoveWithInteraction =
    interactionTotal >= MIN_INTERACTION_FOR_VERDICT
      ? clamp01((20 - pointerMoveCount) / 20) // 0 moves → 1.0, >=20 → 0
      : 0;

  // 5. Unnaturally uniform click press durations. Only meaningful with a few
  //    clicks to compare; a spread near 0 with multiple clicks is robotic.
  const lowClickDurationSpread =
    clickCount >= 2 ? clamp01((10 - clickDurationSpread) / 10) : 0;

  const signals = {
    lowMouseRateWithClicks,
    wheelAbsenceWithInteraction,
    highTeleportRatio,
    lowPointerMoveWithInteraction,
    lowClickDurationSpread,
  };

  const score = clamp01(
    signals.lowMouseRateWithClicks * WEIGHTS.lowMouseRateWithClicks +
      signals.wheelAbsenceWithInteraction * WEIGHTS.wheelAbsenceWithInteraction +
      signals.highTeleportRatio * WEIGHTS.highTeleportRatio +
      signals.lowPointerMoveWithInteraction * WEIGHTS.lowPointerMoveWithInteraction +
      signals.lowClickDurationSpread * WEIGHTS.lowClickDurationSpread,
  );

  // --- Band gating -------------------------------------------------------
  // GATE FIRST on interaction volume. Near-zero interaction (read-and-left,
  // assistive-tech, keyboard-only) is ALWAYS 'uncertain' — a missing signal
  // must never become evidence-of-automation (PRIV false-positive guard).
  let band;
  if (interactionTotal < MIN_INTERACTION_FOR_VERDICT) {
    band = 'uncertain';
  } else if (score >= BAND_HIGH) {
    band = 'automation-signature';
  } else if (score <= BAND_LOW) {
    band = 'human-shaped';
  } else {
    band = 'uncertain';
  }

  return { score, band, signals };
}
