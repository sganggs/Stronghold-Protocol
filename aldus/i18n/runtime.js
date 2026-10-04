// aldus/i18n/runtime.js — the page side of the i18n layer: it shows the interface in the chosen locale.
//
// aldus/build.mjs puts this module in the page before the game's own module, with catalog.js (every locale of
// locales/, plus the operator names the game data already carries) beside it. The game's source is not changed: this
// module watches the page and replaces each text node, and the `placeholder` / `title` / `aria-label` / `alt` of each
// element, with its translation (translator.js). Text that has none stays as the game wrote it.
//
// The locale: `?lang=<locale>` in the address (it is then remembered), else the remembered choice, else DEFAULT_LOCALE.
// `zh` is the source: nothing is replaced. A small button on the title screen changes the locale and reloads.
//
// The game keeps writing its own text into the page (Preact sets the text of a node when a value changes). So for each
// node the last text the GAME wrote is kept as its source, apart from what this module wrote over it; a node whose text
// is not what this module wrote was changed by the game, and is translated again.
//
// The game data (/data/*.json) is never translated: the simulation reads Chinese text in it for its rules
// (shared/loadoutRecord.js), and the browser's battle must equal the server's. Only what is drawn is localized.

import catalogs from './catalog.js';
import { createTranslator, negotiate, CJK } from './translator.js';

/** The language of the game's source text. */
const SOURCE = 'zh';
/** The locale of a first visit. */
const DEFAULT_LOCALE = 'en';
const STORE_KEY = 'sp.lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

const read = (fn) => { try { return fn(); } catch { return null; } };
const query = read(() => new URLSearchParams(location.search).get('lang'));
const saved = read(() => localStorage.getItem(STORE_KEY));
const available = Object.keys(catalogs);
const locale = negotiate({ query, saved, available, source: SOURCE, fallback: DEFAULT_LOCALE });
if (query) read(() => localStorage.setItem(STORE_KEY, locale));

const translator = locale === SOURCE ? null : createTranslator(catalogs[locale]);
const translate = translator ? translator.translate : () => null;

/** text node → the last text the game wrote into it */
const sources = new WeakMap();
/** text node → the text this module wrote into it */
const written = new WeakMap();
/** element → { attribute: [source, written] } */
const attrs = new WeakMap();

const skipped = (el) => {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
    if (SKIP_TAGS.has(e.tagName) || e.hasAttribute('data-i18n-skip') || e.isContentEditable) return true;
  }
  return false;
};

function sourceOf(node) {
  const now = node.data;
  if (written.get(node) === now && sources.has(node)) return sources.get(node);
  sources.set(node, now);
  written.delete(node);
  return now;
}

function write(node, text) {
  written.set(node, text);
  if (node.data !== text) node.data = text;
}

/** Translate the text of `parent`: as one string when it holds text only, else node by node. */
function localize(parent) {
  if (!parent || parent.nodeType !== 1 || skipped(parent)) return;
  const kids = parent.childNodes;
  let textOnly = kids.length > 1;
  for (let i = 0; i < kids.length && textOnly; i++) if (kids[i].nodeType !== 3) textOnly = false;
  if (textOnly) {
    const parts = [];
    for (let i = 0; i < kids.length; i++) parts.push(sourceOf(kids[i]));
    const whole = translate(parts.join(''));
    if (whole != null) {
      // the whole sentence goes into the first node; the game still owns each node and may change one later
      write(kids[0], whole);
      for (let i = 1; i < kids.length; i++) write(kids[i], '');
      return;
    }
    for (let i = 0; i < kids.length; i++) write(kids[i], translate(parts[i]) ?? parts[i]);
    return;
  }
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType !== 3) continue;
    const src = sourceOf(n);
    const out = translate(src);
    if (out != null) write(n, out);
  }
}

function localizeAttr(el, name) {
  if (skipped(el)) return;
  const now = el.getAttribute(name);
  if (now == null) return;
  let state = attrs.get(el);
  if (!state) attrs.set(el, (state = {}));
  const [src, mine] = state[name] || [];
  const source = mine === now && src != null ? src : now;
  if (!CJK.test(source)) { state[name] = [source, now]; return; }
  const out = translate(source);
  if (out == null) { state[name] = [source, now]; return; }
  state[name] = [source, out];
  if (now !== out) el.setAttribute(name, out);
}

function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { localize(root.parentNode); return; }
  if (root.nodeType !== 1 || skipped(root)) return;
  const seen = new Set();
  const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = root; n; n = it.nextNode()) {
    if (n.nodeType === 3) { if (!seen.has(n.parentNode)) { seen.add(n.parentNode); localize(n.parentNode); } continue; }
    for (const a of ATTRS) if (n.hasAttribute(a)) localizeAttr(n, a);
  }
}

/** The button of the title screen that changes the locale. */
function switcher() {
  const other = locale === SOURCE ? (available.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : available[0]) : SOURCE;
  if (!other) return;
  const label = other === SOURCE ? '中文' : (catalogs[other].name || other);
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('data-i18n-skip', '');
  b.setAttribute('aria-label', label);
  b.style.cssText = 'position:fixed;top:10px;right:12px;z-index:2147483000;padding:5px 12px;border-radius:14px;'
    + 'border:1px solid rgba(255,255,255,.35);background:rgba(12,15,14,.72);color:#e8eeeb;font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;display:none';
  b.addEventListener('click', () => {
    read(() => localStorage.setItem(STORE_KEY, other));
    const url = new URL(location.href);
    url.searchParams.delete('lang');
    location.replace(url.href);
  });
  document.body.appendChild(b);
  const show = () => { b.style.display = document.querySelector('.title-screen') ? '' : 'none'; };
  new MutationObserver(show).observe(document.body, { childList: true, subtree: true });
  show();
}

function start() {
  document.documentElement.lang = locale === SOURCE ? 'zh-CN' : locale;
  if (translator) {
    walk(document.documentElement);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') localize(m.target.parentNode);
        else if (m.type === 'attributes') localizeAttr(m.target, m.attributeName);
        else {
          for (const n of m.addedNodes) walk(n);
          // a node that came or went can change what its neighbours mean together
          localize(m.target);
        }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) switcher();
  else document.addEventListener('DOMContentLoaded', switcher, { once: true });
}

/** For a person who looks for text without a translation: `spI18n.missing()` in the console. */
globalThis.spI18n = {
  locale,
  locales: [SOURCE, ...available],
  missing: () => (translator ? [...translator.missing].sort() : []),
};

start();
