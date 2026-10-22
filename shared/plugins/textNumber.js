// One reader for numbers taken out of description text (DESIGN §32.5). Counts are capped. Percents and
// durations stay finite and are not forced down to the count floor.

import { dataBound } from './limits.js';
import { officialTextMax } from './officialBounds.js';

const CN_DIGIT = Object.freeze({
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});

function captured(text, re) {
  if (!(re instanceof RegExp)) return null;
  const copy = new RegExp(re.source, re.flags.replace(/g/g, ''));
  const m = copy.exec(text == null ? '' : String(text));
  return m && m[1] != null && m[1] !== '' ? m[1] : null;
}

function finiteFromCapture(raw, fallback) {
  if (raw == null) return fallback;
  if (Object.prototype.hasOwnProperty.call(CN_DIGIT, raw)) return CN_DIGIT[raw];
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const fb = Number(fallback);
  return Number.isFinite(fb) ? fb : 0;
}

/**
 * Finite number captured by `re`, or `fallback` when the text has no capture.
 * A non-finite capture (a run of nines that becomes Infinity) uses a finite fallback, or 0.
 * This does not apply the count cap.
 * @param {unknown} text
 * @param {RegExp} re
 * @param {unknown} fallback
 */
export function textFinite(text, re, fallback) {
  return finiteFromCapture(captured(text, re), fallback);
}

/**
 * Snapshot a pattern for repeated finite-number reads, without changing the caller's RegExp.
 * Global matching is disabled as in textFinite; sticky matching starts at zero on every read.
 * @param {RegExp} re
 * @returns {<T>(text: unknown, fallback: T) => number | T}
 */
export function createTextFiniteReader(re) {
  const copy = re instanceof RegExp ? new RegExp(re.source, re.flags.replace(/g/g, '')) : null;
  return (text, fallback) => {
    if (!copy) return fallback;
    const input = text == null ? '' : String(text);
    // Coercion may re-enter this reader, so reset after String(text), immediately before exec.
    copy.lastIndex = 0;
    const m = copy.exec(input);
    return finiteFromCapture(m && m[1] != null && m[1] !== '' ? m[1] : null, fallback);
  };
}

/**
 * A count read from description text. Capped at max(10 × the official maximum of `patternId`, 64).
 * An unregistered pattern uses 64. Official captures are at or below that maximum, so they do not change.
 * @param {unknown} text
 * @param {RegExp} re
 * @param {unknown} fallback
 * @param {string} patternId
 */
export function textCount(text, re, fallback, patternId) {
  const cap = dataBound(officialTextMax(patternId));
  const raw = captured(text, re);
  if (raw != null) {
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT, raw)) return Math.min(cap, CN_DIGIT[raw]);
    const n = Number(raw);
    // A matched run that is not finite (a string of nines) is still a count: clamp it, do not
    // fall through to the official fallback. [ASSUMED] DESIGN §32.5.
    if (!Number.isFinite(n)) return cap;
    if (n < 0) return 0;
    return Math.min(cap, n);
  }
  const fb = Number(fallback);
  const safe = Number.isFinite(fb) ? fb : 0;
  if (safe < 0) return 0;
  return Math.min(cap, safe);
}
