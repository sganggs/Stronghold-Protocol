// aldus/i18n/translator.js — the text side of the i18n layer: a catalog and a source string in, the localized string out.
//
// The client of the original project has its interface text in its source, in Chinese, and this fork does not change
// that source. So the source text itself is the message id (the gettext convention): a catalog maps each source string
// to its translation, and a string without one stays as it is. Pure code, no DOM: runtime.js applies it to the page,
// i18n.test.js runs it under Node.
//
// A catalog (locales/<locale>.json):
//   messages   { "<source string>": "<translation>" }      exact match of a whole string
//   patterns   [ ["<regular expression>", "<replacement>"] ] for a string with a value in it ("第 3 回合" → "Round 3")
//
// translate(text) tries, in this order:
//   1. the whole string in `messages`;
//   2. the first pattern that matches (names inside the match are then looked up too);
//   3. the string cut into known messages: every Chinese part must be a message, or nothing is changed. A sentence that
//      is half translated reads worse than the original, so it is all or nothing.
// Leading and trailing white space is kept. A string with Chinese text and no translation is recorded in `missing`.

/** Chinese text (CJK ideographs). */
export const CJK = /[㐀-鿿]/;

/** Full-width punctuation the source uses, as the translation writes it. */
const PUNCTUATION = [['，', ', '], ['。', '. '], ['：', ': '], ['；', '; '], ['（', ' ('], ['）', ') '], ['「', '“'], ['」', '”'], ['！', '! '], ['？', '? '], ['、', ', '], ['【', '['], ['】', ']']];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Punctuation and spacing of a string that was put together from parts. */
export function tidy(text) {
  let out = text;
  for (const [from, to] of PUNCTUATION) out = out.split(from).join(to);
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:!?)\]”])/g, '$1').replace(/([([“]) /g, '$1').trim();
}

/** The locales a tag may mean, most specific first: "en-US" → ["en-us", "en"]. */
const candidates = (tag) => { const t = String(tag || '').toLowerCase(); return t.includes('-') ? [t, t.split('-')[0]] : [t]; };

/**
 * Which locale to show. The order is: the `lang` parameter of the address, the saved choice, the default.
 * @param {{ query?: string|null, saved?: string|null, available: string[], source: string, fallback: string }} o
 * `available`: the locales that have a catalog; `source`: the language of the source text; `fallback`: the default.
 * @returns {string} `source`, or a locale of `available`
 */
export function negotiate({ query = null, saved = null, available, source, fallback }) {
  const resolve = (tag) => {
    for (const c of candidates(tag)) {
      if (c === source || c === source.split('-')[0]) return source;
      if (available.includes(c)) return c;
    }
    return null;
  };
  return resolve(query) || resolve(saved) || resolve(fallback) || source;
}

/**
 * @param {{ messages?: Record<string, string>, patterns?: Array<[string, string]> }} catalog
 * @returns {{ translate: (text: string) => string|null, missing: Set<string>, size: number }}
 */
export function createTranslator(catalog) {
  const messages = (catalog && catalog.messages) || {};
  const patterns = ((catalog && catalog.patterns) || []).map(([re, to]) => [new RegExp(re), to]);
  // the parts a string may be cut into: two characters or more (one character is a word only when it stands alone)
  const parts = Object.keys(messages).filter((k) => CJK.test(k) && [...k].length >= 2).sort((a, b) => b.length - a.length);
  const cut = parts.length ? new RegExp(parts.map(escapeRe).join('|'), 'g') : null;
  const cache = new Map();
  const missing = new Set();
  // each part becomes a word of its own: the source writes its words with no space between them
  const known = (s) => (cut ? s.replace(cut, (k) => ` ${messages[k]} `) : s);

  function core(text) {
    if (Object.hasOwn(messages, text)) return messages[text];
    for (const [re, to] of patterns) if (re.test(text)) return tidy(known(text.replace(re, to)));
    const out = known(text);
    return CJK.test(out) ? null : tidy(out);
  }

  /** The translation of `text`, or null when it has none (or no Chinese text at all). */
  function translate(text) {
    if (typeof text !== 'string' || !CJK.test(text)) return null;
    if (cache.has(text)) return cache.get(text);
    const lead = /^\s*/.exec(text)[0];
    const body = text.slice(lead.length).replace(/\s+$/, '');
    const trail = text.slice(lead.length + body.length);
    const out = core(body);
    if (out == null) missing.add(body);
    const res = out == null ? null : lead + out + trail;
    cache.set(text, res);
    return res;
  }

  return { translate, missing, size: Object.keys(messages).length };
}
