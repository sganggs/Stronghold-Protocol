// Rich-text description formatting (pure, no DOM / Preact — unit-tested in Node).
//
// Official descriptions (data/*.json `descRaw`, DATA.md §0) carry Arknights markup:
//   <@ba.vup>+15%</>        styled span (class `ba.vup`: value-up highlight)
//   <$ba.stun>晕眩</>        term span (a status keyword with a glossary entry)
//   <@autochess.dgreen>3</> autochess-specific colours
// Tags nest. Anything else that looks like a tag — `<获得时>`, `<在场6名不同【炎】干员>` — is literal
// text and is kept verbatim (its closing `>` included). `\n` (real newline or the two-char escape)
// is a line break.
//
// API:
//   parseRichText(src)            → Seg[]  where Seg = { text, cls: string[], term: boolean } | { br: true }
//   richTextPlain(src)            → string (markup stripped, newlines kept)
//   rtClassName(cls)              → CSS class for an official style id ('ba.vup' → 'rt-vup')
//   formatBondEffect(bond, layers)→ bond `effectDescRaw` with its `{i:fmt}` placeholders resolved
//   formatPlaceholder(value, fmt) → '15%' / '3' for the official number formats ('0%', '0.0%', '0', '0.0')
//   fillPlaceholders(src, values) → replace `{i:fmt}` / `{i}` by values[i] (unknown indexes kept)

/** Official style id → our CSS modifier (css/screens/game-panels.css `.rt-*`). */
const STYLE_CLASS = {
  'ba.vup': 'rt-vup',
  'ba.vdown': 'rt-vdown',
  'ba.rem': 'rt-rem',
  'ba.acrem': 'rt-note',
  'ba.kw': 'rt-kw',
  'ba.talpu': 'rt-vup',
  'autochess.gray': 'rt-note',
  'autochess.dgreen': 'rt-mint',
  'autochess.green': 'rt-mint',
  'autochess.red': 'rt-vdown',
  'autochess.yellow': 'rt-rem',
  'eb.key': 'rt-kw',
  'eb.danger': 'rt-vdown',
};

/**
 * CSS class for an official style id. Term tags (`$…`) map to `rt-term`, unknown styles to `rt-hl`.
 * @param {string} cls style id without the sigil, e.g. 'ba.vup'
 * @param {boolean} [term]
 * @returns {string}
 */
export function rtClassName(cls, term = false) {
  if (term) return 'rt-term';
  return STYLE_CLASS[cls] || 'rt-hl';
}

const TAG_OPEN = /^<([@$])([A-Za-z0-9_.\-]{1,48})>/;
const TAG_CLOSE = '</>';

/**
 * Parse official rich text into flat styled segments.
 * @param {any} src
 * @returns {Array<{ text: string, cls: string[], term: boolean } | { br: true }>}
 */
export function parseRichText(src) {
  if (src == null) return [];
  const s = String(src).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  /** @type {Array<{ cls: string, term: boolean }>} */
  const stack = [];
  const out = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const cls = stack.map((t) => t.cls);
    const term = stack.some((t) => t.term);
    const prev = out[out.length - 1];
    // merge with the previous segment when styles are identical
    if (prev && !prev.br && prev.term === term && prev.cls.length === cls.length && prev.cls.every((c, i) => c === cls[i])) {
      prev.text += buf;
    } else {
      out.push({ text: buf, cls, term });
    }
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') {
      flush();
      out.push({ br: true });
      i += 1;
      continue;
    }
    if (ch === '<') {
      if (s.startsWith(TAG_CLOSE, i)) {
        if (stack.length) {
          flush();
          stack.pop();
        } else {
          buf += TAG_CLOSE; // stray closer: keep literally
        }
        i += TAG_CLOSE.length;
        continue;
      }
      const m = TAG_OPEN.exec(s.slice(i, i + 52));
      if (m) {
        flush();
        stack.push({ cls: m[2], term: m[1] === '$' });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/**
 * Markup-free text (newlines kept).
 * @param {any} src
 * @returns {string}
 */
export function richTextPlain(src) {
  return parseRichText(src).map((seg) => (seg.br ? '\n' : seg.text)).join('');
}

/**
 * Format a number with an official format string.
 * '0%' → rounded percent, '0.0%' → 1 decimal percent, '0' → integer, '0.0' → 1 decimal. Unknown → trimmed number.
 * @param {number} value
 * @param {string} [fmt]
 * @returns {string}
 */
export function formatPlaceholder(value, fmt = '0') {
  const v = Number(value);
  if (!Number.isFinite(v)) return '?';
  const f = typeof fmt === 'string' ? fmt : '0';
  const pct = f.endsWith('%');
  const core = pct ? f.slice(0, -1) : f;
  const dot = core.indexOf('.');
  const decimals = dot >= 0 ? Math.min(4, core.length - dot - 1) : 0;
  const n = pct ? v * 100 : v;
  const fixed = n.toFixed(decimals);
  // avoid "-0"
  const clean = Number(fixed) === 0 ? (0).toFixed(decimals) : fixed;
  return pct ? `${clean}%` : clean;
}

/**
 * Replace `{i:fmt}` / `{i}` placeholders with values (unknown indexes are kept as-is).
 * @param {string} src
 * @param {Array<number|string|null|undefined>} values
 * @param {string[]} [formats] optional per-index format override
 * @returns {string}
 */
export function fillPlaceholders(src, values, formats = []) {
  if (src == null) return '';
  return String(src).replace(/\{(\d{1,2})(?::([^{}]{1,12}))?\}/g, (whole, idx, fmt) => {
    const i = Number(idx);
    const v = Array.isArray(values) ? values[i] : undefined;
    if (v == null) return whole;
    if (typeof v === 'string') return v;
    return formatPlaceholder(v, formats[i] || fmt || '0');
  });
}

/**
 * The bond's in-battle effect text with its layer-dependent numbers resolved (DATA.md §3:
 * `{i:fmt}` = `bb[base] + bb[perStack] × layers`).
 * @param {any} bond bonds.json record
 * @param {number} [layers]
 * @returns {string} rich text (markup kept)
 */
export function formatBondEffect(bond, layers = 0) {
  if (!bond || typeof bond !== 'object') return '';
  const src = bond.effectDescRaw || bond.effectDesc || '';
  const params = Array.isArray(bond.effectDescParams) ? bond.effectDescParams : [];
  const bb = bond.bb && typeof bond.bb === 'object' ? bond.bb : {};
  const L = Number.isFinite(Number(layers)) ? Math.max(0, Number(layers)) : 0;
  const values = [];
  const formats = [];
  for (const p of params) {
    if (!p || !Number.isInteger(p.index)) continue;
    const base = Number(bb[p.base]) || 0;
    const per = Number(bb[p.perStack]) || 0;
    // a layer-scaled chance (迅捷 / 不屈 base_prob + prob_per_stack, 奇迹 baseprob + prob) stops at 100 % like the sim's
    // min(1, …) (bonds/addon procChance, meta.js 奇迹) — the card read 124 % at 266 layers (GitHub #108)
    const chance = /prob/i.test(`${p.base}|${p.perStack}`);
    let v = chance ? Math.max(0, Math.min(1, base + per * L)) : base + per * L;
    // 规程's own cap of the number (effectDescParamDataDict descParamMax: 萨尔贡's 60 %, the chances' 100 %, §37.208)
    if (Number(p.max) > 0) v = Math.min(v, Number(p.max));
    values[p.index] = v;
    formats[p.index] = p.format || '0';
  }
  return fillPlaceholders(src, values, formats);
}
