// shared/plugins/theme.js — cosmetic theme variables (DESIGN §34.14, docs/PLUGINS.md §9.1).
// A cosmetic (or trusted) plugin may set design tokens on this player's screen only. The allowlist is the
// custom properties :root defines in public/css/theme.css whose defaults are a colour, a time or an easing.
// [ASSUMED] Fonts (--cjk-faces, --font-*), z-index (--z-*), the text scale (--t), bracket lengths (--bk-l,
// --bk-w), safe-area (--sa-*) and --tap-min are not settable: they are not those kinds, and quotes / var() /
// env() / calc() would fail this grammar or move layout. --bk-c is a colour (the plugin writes a colour
// literal, not var()). Properties that are not on :root (--ewheel-*, --ebubble-*, --ewb-w) are not tokens.
// No Node builtin: the manifest check, the registry, the studio and the page share this file.

/** [ASSUMED] At most this many variables on one plugin. */
export const THEME_VAR_LIMIT = 64;
/** [ASSUMED] Bound raw strings before trimming or parsing; the Forge workshop also caps values at 400. */
const THEME_VALUE_LIMIT = 400;

/** @typedef {'colour' | 'time' | 'easing'} ThemeKind */

/** @type {Readonly<Record<string, ThemeKind>>} token name → the grammar its value must match */
export const THEME_TOKENS = Object.freeze({
  '--bg-0': 'colour', '--bg-1': 'colour', '--bg-2': 'colour', '--bg-3': 'colour', '--bg-4': 'colour', '--bg-glass': 'colour',
  '--line': 'colour', '--line-2': 'colour', '--line-3': 'colour',
  '--mint-500': 'colour', '--mint-400': 'colour', '--mint-600': 'colour', '--mint-glow': 'colour',
  '--mint-700': 'colour', '--mint-800': 'colour', '--mint-900': 'colour',
  '--mint-a10': 'colour', '--mint-a20': 'colour', '--mint-a35': 'colour',
  '--gold': 'colour', '--gold-2': 'colour', '--gold-a20': 'colour',
  '--amber': 'colour', '--amber-a20': 'colour',
  '--orange': 'colour', '--orange-hi': 'colour', '--orange-a20': 'colour',
  '--red': 'colour', '--red-abyss': 'colour', '--red-premium': 'colour', '--red-a20': 'colour',
  '--ice': 'colour', '--ice-a20': 'colour', '--ice-900': 'colour',
  '--text-hi': 'colour', '--text-md': 'colour', '--text-lo': 'colour', '--text-dim': 'colour', '--text-on-mint': 'colour',
  '--diff-funny': 'colour', '--diff-normal': 'colour', '--diff-hard': 'colour', '--diff-abyss': 'colour',
  '--tier-1': 'colour', '--tier-2': 'colour', '--tier-3': 'colour', '--tier-4': 'colour', '--tier-5': 'colour', '--tier-6': 'colour',
  '--lv-1': 'colour', '--lv-2': 'colour', '--lv-3': 'colour', '--lv-4': 'colour', '--lv-5': 'colour', '--lv-6': 'colour',
  '--bk-c': 'colour',
  '--ease-out': 'easing', '--ease-in-out': 'easing',
  '--t-fast': 'time', '--t-med': 'time', '--t-slow': 'time',
});

const EASING = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);
// [ASSUMED] Decimal numbers only (no exponents or explicit plus); whitespace is CSS ASCII whitespace.
const NUM = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const NUM_RE = new RegExp(`^${NUM}$`);
const COMP_RE = new RegExp(`^${NUM}%?$`);
const PCT_RE = new RegExp(`^${NUM}%$`);
const HEX_RE = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})$/;
const TIME_RE = new RegExp(`^(${NUM})(ms|s)$`);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A string that names a URL (rejected even when the token name is also unknown). */
const hasUrl = (s) => /url\s*\(|:\/\//i.test(s);
/** Quotes, backslash, statement/markup characters, or an expression. [ASSUMED] lowercase function names only. */
const hasForbidden = (s) => /['"\\;{}<>]|var\s*\(|expression\s*\(|calc\s*\(|env\s*\(|max\s*\(|min\s*\(/i.test(s);

/**
 * @param {string} inner
 * @returns {{ parts: string[], alpha: string | null } | null}
 */
function colourArgs(inner) {
  const slash = inner.trim().split('/');
  if (slash.length > 2) return null;
  const head = slash[0].trim();
  let alpha = slash.length === 2 ? slash[1].trim() : null;
  /** @type {string[]} */
  let parts;
  if (head.includes(',')) {
    if (slash.length !== 1) return null; // commas and slash belong to different CSS colour syntaxes
    parts = head.split(',').map((x) => x.trim());
    if (alpha == null && parts.length === 4) alpha = parts.pop() ?? null;
  } else parts = head.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !p)) return null;
  return { parts, alpha };
}

/** A colour literal, or null. [ASSUMED] no named colours; function names are lowercase. */
export function acceptColour(raw) {
  if (typeof raw !== 'string' || raw.length > THEME_VALUE_LIMIT) return null;
  const v = raw.trim();
  if (/[^\x20-\x7e\t\r\n\f]/.test(v)) return null;
  if (HEX_RE.test(v)) return v;
  const fn = /^(rgb|rgba|hsl|hsla)\(([^)]*)\)$/.exec(v);
  if (!fn || fn[0] !== v) return null;
  const args = colourArgs(fn[2]);
  if (!args || args.parts.length !== 3) return null;
  if (args.alpha != null && !COMP_RE.test(args.alpha)) return null;
  if (fn[1] === 'rgb' || fn[1] === 'rgba') {
    if (!args.parts.every((p) => COMP_RE.test(p))) return null;
    if (fn[2].includes(',') && !args.parts.every((p) => p.endsWith('%') === args.parts[0].endsWith('%'))) return null;
    return v;
  }
  if (!NUM_RE.test(args.parts[0]) || !PCT_RE.test(args.parts[1]) || !PCT_RE.test(args.parts[2])) return null;
  return v;
}

/** A time in 0–2000ms or 0–2s, or null. */
export function acceptTime(raw) {
  if (typeof raw !== 'string' || raw.length > THEME_VALUE_LIMIT) return null;
  const v = raw.trim();
  const m = TIME_RE.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  if (m[2] === 'ms' && n <= 2000) return v;
  if (m[2] === 's' && n <= 2) return v;
  return null;
}

/**
 * An easing keyword or cubic-bezier(), or null.
 * [ASSUMED] keywords are lowercase; cubic-bezier x is 0–1 and y is any finite number.
 */
export function acceptEasing(raw) {
  if (typeof raw !== 'string' || raw.length > THEME_VALUE_LIMIT) return null;
  const v = raw.trim();
  if (EASING.has(v)) return v;
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(v);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());
  if (parts.length !== 4) return null;
  const nums = parts.map((s) => (NUM_RE.test(s) ? Number(s) : NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums[0] < 0 || nums[0] > 1 || nums[2] < 0 || nums[2] > 1) return null;
  return v;
}

/**
 * The value a token may take, trimmed, or null when the name or the value is refused.
 * The page calls this again before setProperty, so a catalogue that was edited in transit cannot inject a URL.
 * @param {unknown} name @param {unknown} value
 * @returns {string | null}
 */
export function acceptThemeValue(name, value) {
  const kind = typeof name === 'string' ? THEME_TOKENS[name] : null;
  if (!kind || typeof value !== 'string' || value.length > THEME_VALUE_LIMIT || hasUrl(value) || hasForbidden(value)) return null;
  if (kind === 'colour') return acceptColour(value);
  if (kind === 'time') return acceptTime(value);
  if (kind === 'easing') return acceptEasing(value);
  return null;
}

/** Whether any string in a bad declaration names a URL. */
function treeHasUrl(v) {
  const stack = [v];
  for (let i = 0; i < stack.length; i++) {
    const x = stack[i];
    if (typeof x === 'string') { if (hasUrl(x)) return true; continue; }
    if (x && typeof x === 'object') for (const y of Object.values(x)) stack.push(y);
    if (stack.length > 10000) return true;
  }
  return false;
}

/**
 * The variable map of a theme declaration.
 * Canonical shape is `{ vars: { "--token": "value" } }`. [ASSUMED] A flat map whose every key starts with `--`
 * is the same thing (hand-written plugins and the 0.3.0 fixtures). Anything else, including `vars` mixed with
 * other keys, is refused. An empty object applies nothing.
 * @param {unknown} raw
 * @param {{ drop?: boolean }} [opts]
 *   drop: keep the valid names (Forge import). Otherwise any problem refuses the whole declaration (`vars` null).
 * @returns {{ vars: Record<string, string> | null, problems: { code: string, text: string, at: string[], name: string }[] }}
 */
export function readThemeDeclaration(raw, { drop = false } = {}) {
  /** @type {{ code: string, text: string, at: string[], name: string }[]} */
  const problems = [];
  const push = (code, text, at, name = '') => problems.push({ code, text, at, name });
  let map = null;
  if (!isObj(raw)) map = null;
  else {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    const keys = Object.keys(obj);
    if (!keys.length) map = {};
    else if (keys.length === 1 && keys[0] === 'vars') map = isObj(obj.vars) ? /** @type {Record<string, unknown>} */ (obj.vars) : null;
    else if (keys.every((k) => k.startsWith('--'))) map = obj;
  }
  if (!map) {
    if (treeHasUrl(raw)) push('PLUGIN_THEME_URL', '"theme" names a URL (a theme sets colours, times and easings)', ['theme']);
    push('PLUGIN_THEME_SHAPE', '"theme" is not { "vars": { "--token": "value" } } or a flat map of --tokens', ['theme']);
    return { vars: null, problems };
  }
  const names = Object.keys(map);
  if (names.length > THEME_VAR_LIMIT) push('PLUGIN_THEME_LIMIT', '"theme" sets more than 64 variables', ['theme']);
  const considered = drop ? names.slice(0, THEME_VAR_LIMIT) : names;
  /** @type {Record<string, string>} */
  const vars = {};
  for (const name of considered) {
    const value = map[name];
    const at = ['theme', 'vars', name];
    if (typeof value === 'string' && value.length > THEME_VALUE_LIMIT) {
      push('PLUGIN_THEME_VALUE', '"theme" has a value this token does not allow', at, name);
      continue;
    }
    if (typeof value === 'string' && hasUrl(value)) {
      push('PLUGIN_THEME_URL', '"theme" names a URL (a theme sets colours, times and easings)', at, name);
      continue;
    }
    if (!Object.hasOwn(THEME_TOKENS, name)) {
      push('PLUGIN_THEME_NAME', '"theme" names a variable that is not a design token of this installation', at, name);
      continue;
    }
    const ok = acceptThemeValue(name, value);
    if (!ok) {
      push('PLUGIN_THEME_VALUE', '"theme" has a value this token does not allow', at, name);
      continue;
    }
    vars[name] = ok;
  }
  if (!drop && problems.length) return { vars: null, problems };
  return { vars, problems };
}

/**
 * The variables of the switched-on plugins, in plugin-id order. [ASSUMED] The later id wins a shared token.
 * A value that fails the grammar is left out (the page never writes it).
 * @param {{ id: string, vars?: Record<string, unknown> | null }[]} plugins
 * @returns {{ name: string, value: string, pluginId: string }[]}
 */
export function resolveThemeVars(plugins) {
  const list = (Array.isArray(plugins) ? plugins : []).filter((p) => p && typeof p.id === 'string');
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** @type {Map<string, { name: string, value: string, pluginId: string }>} */
  const won = new Map();
  for (const p of list) {
    if (!isObj(p.vars)) continue;
    for (const name of Object.keys(p.vars)) {
      const value = acceptThemeValue(name, p.vars[name]);
      if (!value) continue;
      won.set(name, { name, value, pluginId: p.id });
    }
  }
  return [...won.values()];
}

/**
 * The catalogue entry's theme variables, re-checked, or null when it sets none.
 * @param {any} entry
 * @returns {Record<string, string> | null}
 */
export function themeVarsOf(entry) {
  const raw = entry?.theme?.vars;
  if (!isObj(raw)) return null;
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of Object.keys(raw)) {
    const value = acceptThemeValue(name, raw[name]);
    if (value) out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}
