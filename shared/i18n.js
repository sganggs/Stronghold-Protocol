// Display translation (English UI). Pure ESM shared by the server and the browser.
//
// The game data (data/*.json) stays Chinese: the battle simulation reads mechanics out of the official description
// texts (server/sim/content/generic.js …), on the server and in the browser alike. What players SEE is translated
// with a dictionary { zh: en } (public/i18n/en.json, built by tools/i18n/build.mjs): exact whole-string matches only,
// so ids, numbers and anything not in the dictionary pass through unchanged.

const CJK = /[㐀-鿿豈-﫿]/;

/**
 * A translator over a { zh: en } dictionary. `tr(s)` returns the English text of a known string, else `s`.
 * @param {Record<string, string> | null | undefined} dict
 * @returns {((s: any) => any) & { size: number }}
 */
export function createTranslator(dict) {
  const map = new Map(dict && typeof dict === 'object' ? Object.entries(dict).filter(([, v]) => typeof v === 'string') : []);
  const tr = (s) => (typeof s === 'string' && map.size && CJK.test(s) ? (map.get(s) ?? s) : s);
  tr.size = map.size;
  return tr;
}

/**
 * A copy of a JSON value with every string passed through `tr` (object keys untouched). Values without any change
 * are returned as is, so an untranslated object keeps its identity. `opts.skip(path, parent)` keeps the subtree at
 * `path` (an array of keys / indices from the root) as is when it returns true; `parent` is the object holding it.
 * @template T
 * @param {T} value
 * @param {(s: string) => string} tr
 * @param {{ skip?: (path: (string|number)[], parent: any) => boolean }} [opts]
 * @returns {T}
 */
export function translateDeep(value, tr, opts) {
  return walkTranslate(value, tr, typeof opts?.skip === 'function' ? opts.skip : null, [], null);
}

function walkTranslate(value, tr, skip, path, parent) {
  if (skip && path.length && skip(path, parent)) return value;
  if (typeof value === 'string') return tr(value);
  if (!value || typeof value !== 'object' || typeof tr !== 'function') return value;
  if (Array.isArray(value)) {
    let out = null;
    for (let i = 0; i < value.length; i++) {
      const v = walkTranslate(value[i], tr, skip, skip ? [...path, i] : path, value);
      if (v !== value[i]) (out ??= value.slice())[i] = v;
    }
    return out ?? value;
  }
  let out = null;
  for (const k of Object.keys(value)) {
    const v = walkTranslate(value[k], tr, skip, skip ? [...path, k] : path, value);
    if (v !== value[k]) (out ??= { ...value })[k] = v;
  }
  return out ?? value;
}

// ---- player names: never translated (a nickname may equal an operator name: 能天使 must not become "Exusiai").
// The one exception: the server's own AI teammate names, shown translated when the seat is a bot.

/** Display names for AI teammates (the tutorial NPCs first, then a few familiar faces), assigned by server/lobby.js. */
export const BOT_NAMES = Object.freeze(['AI·华法琳', 'AI·阿米娅', 'AI·惊蛰', 'AI·杜宾', 'AI·凯尔希', 'AI·可露希尔']);
const BOT_NAME_SET = new Set(BOT_NAMES);

/**
 * A player's display name: as typed, except one of BOT_NAMES on a bot seat, which goes through `tr`.
 * @param {any} name
 * @param {boolean} isBot
 * @param {(s: string) => string} tr
 */
export function playerName(name, isBot, tr) {
  const s = name == null ? '' : String(name);
  return isBot && BOT_NAME_SET.has(s) ? String(tr(s)) : s;
}

/**
 * The paths of a server message that hold player names (per message type, so a data record's `name` elsewhere is
 * still translated): room.state seats[].name, m.public / m.result players[].name.
 */
const PLAYER_NAME_LISTS = { 'room.state': 'seats', 'm.public': 'players', 'm.result': 'players' };

/**
 * translateDeep `skip` for one message type: keeps the player-name fields, letting a bot's BOT_NAMES name through.
 * @param {string} type message type (`t`)
 * @returns {((path: (string|number)[], parent: any) => boolean) | null}
 */
export function playerNameSkip(type) {
  const list = PLAYER_NAME_LISTS[type];
  if (!list) return null;
  return (path, parent) => path.length === 3 && path[0] === list && typeof path[1] === 'number' && path[2] === 'name'
    && !(parent && parent.isBot === true && BOT_NAME_SET.has(parent.name));
}

/**
 * Fill a template's `{0}`, `{1}`… slots with `args` (a missing argument leaves an empty slot). Without args the
 * template is returned as is, so a text that merely contains braces is safe.
 * @param {any} tpl
 * @param {readonly any[]} [args]
 */
export function formatText(tpl, args) {
  if (typeof tpl !== 'string' || !args || !args.length) return tpl;
  return tpl.replace(/\{(\d)\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));
}

// ---- server texts (m.toast / m.ticker): a Chinese template + arguments, shown in each client's language.
// An argument is a string / number (game data: translated), { list: [...] } (data names joined by 、 in Chinese,
// ", " in English), or a player name — { name, bot? } / { names: [{ name, bot? }…] } — never translated except a
// bot's BOT_NAMES name (playerName). Build them with nameArg / namesArg.

/** Separator of a { list } / { names } argument per display language. */
const LIST_SEP = { zh: '、', en: ', ' };

/** A player-name template argument (server side): `nameArg(ps)` or `nameArg(name, isBot)`. */
export function nameArg(who, isBot = false) {
  if (who && typeof who === 'object') return { name: String(who.name ?? ''), bot: !!who.isBot };
  return { name: String(who ?? ''), bot: !!isBot };
}

/** A list of player names as one template argument (joined like { list }). */
export const namesArg = (players) => ({ names: (players || []).map((p) => nameArg(p)) });

const isNameArg = (a) => a && typeof a === 'object' && typeof a.name === 'string';

/** One argument as display text: data texts through `tr`, player names as typed (bot names excepted), lists joined. */
function argText(a, tr, sep) {
  if (a && typeof a === 'object') {
    if (Array.isArray(a.list)) return a.list.map((x) => String(tr(String(x)))).join(sep);
    if (Array.isArray(a.names)) return a.names.map((n) => (isNameArg(n) ? playerName(n.name, n.bot === true, tr) : String(n ?? ''))).join(sep);
    if (isNameArg(a)) return playerName(a.name, a.bot === true, tr);
  }
  return a == null ? '' : String(tr(String(a)));
}

/** JSON-safe copy of one name argument. */
const cleanName = (n) => (isNameArg(n) ? { name: n.name, bot: n.bot === true } : { name: n == null ? '' : String(n), bot: false });

/** JSON-safe copy of the args (strings, finite numbers, { list } of strings, player names). */
function cleanArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.slice(0, 10).map((a) => {
    if (a && typeof a === 'object') {
      if (Array.isArray(a.list)) return { list: a.list.map(String) };
      if (Array.isArray(a.names)) return { names: a.names.map(cleanName) };
      if (isNameArg(a)) return cleanName(a);
    }
    return typeof a === 'number' && Number.isFinite(a) ? a : a == null ? '' : String(a);
  });
}

/**
 * The text fields of a server message: `{ text, tpl, args }` — `text` the filled Chinese line (older clients, logs,
 * tests), `tpl` + `args` what a client formats in its own language (formatMsg). Without args only `text` is sent.
 * @param {string} tpl Chinese template with {0}, {1}… slots
 * @param {any[]} [args]
 */
export function textMsg(tpl, args) {
  const a = cleanArgs(args);
  const text = formatText(String(tpl ?? ''), a.map((x) => argText(x, (s) => s, LIST_SEP.zh)));
  return a.length ? { text, tpl: String(tpl), args: a } : { text };
}

/**
 * The display text of a server message in a client's language: its `tpl` + `args` through `tr`, else its `text`.
 * @param {{ text?: any, tpl?: any, args?: any }} msg
 * @param {(s: string) => string} tr
 * @param {'zh'|'en'} [lang]
 */
export function formatMsg(msg, tr, lang = 'zh') {
  if (!msg || typeof msg !== 'object') return '';
  const sep = LIST_SEP[lang] || LIST_SEP.zh;
  if (typeof msg.tpl === 'string' && Array.isArray(msg.args)) {
    return formatText(String(tr(msg.tpl)), msg.args.map((a) => argText(a, tr, sep)));
  }
  return typeof msg.text === 'string' ? String(tr(msg.text)) : '';
}
