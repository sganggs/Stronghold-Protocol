// public/js/ui/changelog.js — 更新说明: the release notes of the version this page runs, shown once per version.
//
// WHY: nothing in the game says what a build contains. A player who updates has no way of knowing what changed, and a
// player who just installed has no way of knowing what they installed. The notes are CHANGELOG.md at the repository
// root, which is not part of the game; this dialog brings them into the client.
//
// HOW IT IS DECIDED. The signal is APP_VERSION (shared/constants.js) and only that. The
// notes are organised BY VERSION, so a version that has not moved has nothing new to read — and every deploy moves the
// /healthz build tag (server/http/buildTag.js) whether or not the version moved, which would re-show the same text
// after each one. boot() still passes the build tag it reads, because the answered row records it for a bug report;
// it never decides whether to open. The answer is one row per browser in localStorage (`sp.pref.changelog.seen`,
// store.js loadPref/savePref) — this MUST survive a reload, unlike buildGuard's tag, which deliberately must not (that
// one describes the modules one page loaded).
//   * no row for this version → opened. A FRESH INSTALL IS INCLUDED: the notes of the version being installed are as
//     worth reading as the notes of the version an update brought, and a brand-new player is exactly who benefits from
//     knowing what the build contains.
//   * a row for this version → not opened again. 设置 opens it on demand whatever the row says.
// A browser that cannot keep the row at all (private mode, storage blocked) is never prompted: it would forget every
// answer and reopen on every page load (canRemember).
//
// WHAT IT SHOWS. /changelog.md — server/http/static.js serves the repository root's CHANGELOG.md, the only file of the
// repository any mount exposes — split by the file's own `## <version> — <date>` headings (parseNotes), so a single
// file carries every release and no per-version file has to be generated or kept in step. The notes are written in
// Chinese only (the maintainers' file is the source); the dialog says so for a player reading another language.
//
// RENDERING. marked (markdown) and DOMPurify (sanitising) are vendored by tools/vendor.mjs and imported LAZILY, only
// when the dialog actually opens — a page that never opens it pays nothing. Both entries are optional in vendor.mjs (a
// checkout installed without them): the dialog then shows the notes as plain text instead of failing.
//
// PLACEMENT. Mounted once beside the other hosts (main.js App). It refuses to open over a match (the router's 'game'
// route) — a battle on screen is never covered by a dialog, the same rule buildGuard follows for its reload — and
// opens by itself once the player is back in the lobby.

import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, MicroLabel } from './components.js';
import { createStore, useStore, loadPref, savePref, selectRoute } from '../store.js';
import { t, getLang, DEFAULT_LANG } from '../../../shared/i18n.js';
import { APP_VERSION } from '../../../shared/constants.js';

/** localStorage key (store.js adds the `sp.pref.` prefix): the version this browser already read the notes of. */
const SEEN_KEY = 'changelog.seen';

/**
 * The dialog's own state. Its own store — this is local UI, not app state the router reads.
 * `build`: the /healthz tag of the page, kept only to record it in the answered row (boot supplies it).
 */
export const changelogStore = createStore({ open: false, build: null });

// ---------------------------------------------------------------------------------------------------
// Deciding whether to open
// ---------------------------------------------------------------------------------------------------

/**
 * The version two sides are compared by: a `-dev` suffix is dropped, so a dev build reads the notes of the release it
 * is heading for (APP_VERSION `0.2.6-dev` finds the `## 0.2.6` heading).
 * @param {unknown} v
 */
export const normalizeVersion = (v) => String(v ?? '').replace(/-dev$/, '');

/**
 * Whether these notes should be shown: once per version, per browser — the very first visit included. A fresh install
 * has acknowledged nothing, and the notes of the version being installed are exactly as worth reading as the notes of
 * the version an update brought.
 *
 * The build tag deliberately plays no part. The notes are keyed by version, so a version that has not moved has the
 * same text to show, while every deploy moves the tag (server/http/buildTag.js) — prompting on the tag would re-show
 * identical notes after each one, and, because the answered row records the build the page ran at the time, it could
 * never settle.
 *
 * @param {{ version?: string, lastSeen?: any }} [o]
 * @returns {boolean}
 */
export function shouldPrompt({ version = APP_VERSION, lastSeen = null } = {}) {
  const seenVersion = lastSeen && typeof lastSeen === 'object' && typeof lastSeen.version === 'string' ? lastSeen.version : null;
  if (!seenVersion) return true; // never acknowledged — including a row that is missing, empty or corrupt
  return normalizeVersion(seenVersion) !== normalizeVersion(version);
}

/**
 * Whether an acknowledgement can actually be kept. A browser that refuses localStorage (some private modes, a
 * cookie-blocked origin) would forget every answer, so the dialog would reopen on every page load — asking there is
 * worse than not asking, so it is not asked at all (设置 still opens it on demand).
 * @returns {boolean}
 */
export function canRemember() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    const probe = 'sp.pref.changelog.probe';
    ls.setItem(probe, '1');
    const kept = ls.getItem(probe) === '1';
    ls.removeItem(probe);
    return kept;
  } catch {
    return false;
  }
}

/**
 * Remember that this browser read the notes of `version` under `build`. The build is diagnostics only (it names the
 * deployment the player was on when they dismissed the notes, which is what a bug report needs) — shouldPrompt ignores
 * it.
 * @param {{ build?: string|null, version?: string, now?: number }} [o]
 */
export function rememberSeen({ build = null, version = APP_VERSION, now = Date.now() } = {}) {
  savePref(SEEN_KEY, { build: typeof build === 'string' ? build : null, version, at: now });
}

/**
 * Read the answered prompt back: `{ build, version, at }`, or null when this browser never answered one.
 * @returns {{ build: string|null, version: string|null, at: number } | null}
 */
export function lastSeen() {
  const v = loadPref(SEEN_KEY, null);
  return v && typeof v === 'object' ? v : null;
}

/**
 * Open the notes when this browser has not acknowledged the version this page runs — the first install included.
 * Called by boot() with the build tag it read.
 * Opening is all this does: ChangelogHost refuses to render over a match, so a restored match is never covered.
 * @param {{ build?: string|null, version?: string }} [o]
 * @returns {boolean} whether the dialog was opened
 */
export function maybePromptChangelog({ build = null, version = APP_VERSION } = {}) {
  // Keep the page's build whatever the answer, so closing the dialog can record it (diagnostics, see rememberSeen).
  if (typeof build === 'string' && build) changelogStore.set({ build });
  if (!canRemember()) return false; // nowhere to keep the answer: asking would repeat on every page load
  if (!shouldPrompt({ version, lastSeen: lastSeen() })) return false;
  changelogStore.set({ open: true });
  return true;
}

// ---------------------------------------------------------------------------------------------------
// The notes themselves
// ---------------------------------------------------------------------------------------------------

/**
 * Split CHANGELOG.md into one record per release, newest first.
 *
 * The shape is the maintainers' own file: a release starts at `## <version> — <date>`, and every following `### …`
 * section belongs to the release above it. A `### …` section cannot be mistaken for a release heading — the pattern
 * needs whitespace after exactly two hashes. The separator accepts an em dash (what the file writes), an en dash or a
 * plain hyphen, and is harmless to the version: `\S+` already took `1.0.0-dev` whole, because the separator only
 * matches after whitespace. The file carries no fenced code block, so nothing has to be skipped.
 *
 * @param {string} md
 * @returns {{ version: string, date: string, markdown: string }[]}
 */
export function parseNotes(md) {
  if (typeof md !== 'string' || !md) return [];
  /** @type {{ version: string, date: string, lines: string[] }[]} */
  const out = [];
  /** @type {{ version: string, date: string, lines: string[] } | null} */
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^##[ \t]+(\S+)[ \t]*(?:[—–-][ \t]*(.*?))?[ \t]*$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { version: m[1], date: (m[2] || '').trim(), lines: [] };
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) out.push(cur);
  return out.map((n) => ({ version: n.version, date: n.date, markdown: n.lines.join('\n').trim() }));
}

const defaultFetch = (...a) => globalThis.fetch(...a);

/**
 * Fetch and split the release notes. Never throws: an unreachable /changelog.md (a static host that does not serve it)
 * comes back as null, and the dialog says so.
 * @param {typeof fetch} [doFetch]
 * @returns {Promise<{ version: string, date: string, markdown: string }[] | null>}
 */
export async function fetchNotes(doFetch = defaultFetch) {
  try {
    const res = await doFetch('/changelog.md', { cache: 'no-cache' });
    if (!res || !res.ok) return null;
    return parseNotes(await res.text());
  } catch {
    return null;
  }
}

/**
 * The index of the release this page runs, or 0 (the newest) when the file has no heading for it — a build between two
 * releases reads the newest notes rather than nothing.
 * @param {{ version: string }[]} notes
 * @param {string} version
 */
export function currentIndex(notes, version = APP_VERSION) {
  if (!Array.isArray(notes) || !notes.length) return 0;
  const want = normalizeVersion(version);
  const i = notes.findIndex((n) => normalizeVersion(n.version) === want);
  return i >= 0 ? i : 0;
}

// ---------------------------------------------------------------------------------------------------
// The markdown renderer (vendored, optional, loaded on first use)
// ---------------------------------------------------------------------------------------------------

/** @type {Promise<((md: string) => string) | null> | null} */
let renderer = null;

/**
 * Build the markdown → HTML function out of the two vendored modules, or null when either is unusable.
 *
 * Kept apart from loadRenderer so the composition is testable without a DOM: DOMPurify builds itself against `window`
 * and has no `sanitize` in Node (it reports isSupported false), which is exactly the branch a checkout installed
 * without the vendored files hits in a browser too — the dialog then shows the notes as plain text.
 *
 * DOMPurify runs LAST, over marked's output: the notes are maintainer-authored, but they are still a document this
 * page injects, and a stray tag in a release note must never become script in a player's page.
 *
 * @param {any} markedMod the marked module namespace (it exports `marked` — callable, carrying .parse — and `parse`)
 * @param {any} purifyMod the DOMPurify module namespace (a default export)
 * @returns {((md: string) => string) | null}
 */
export function composeRenderer(markedMod, purifyMod) {
  // marked exports the callable as both `marked` and `parse` (the same function), and older builds used a default.
  const marked = markedMod?.marked ?? markedMod?.parse ?? markedMod?.default ?? null;
  const purify = purifyMod?.default ?? purifyMod ?? null;
  if (!marked || typeof purify?.sanitize !== 'function') return null;
  const opts = { gfm: true, breaks: false };
  const toHtml = typeof marked === 'function' ? (md) => marked(md, opts) : (md) => marked.parse(md, opts);
  return (md) => purify.sanitize(toHtml(md));
}

/**
 * marked + DOMPurify, imported once and only when the dialog opens. Both are vendored by tools/vendor.mjs but optional
 * there: without them (or without a DOM) this resolves to null and the dialog falls back to the raw text.
 * @returns {Promise<((md: string) => string) | null>}
 */
export function loadRenderer() {
  if (!renderer) {
    renderer = (async () => {
      try {
        const [markedMod, purifyMod] = await Promise.all([
          import('../../vendor/marked.esm.js'),
          import('../../vendor/purify.es.mjs'),
        ]);
        const render = composeRenderer(markedMod, purifyMod);
        if (!render) console.warn('[changelog] markdown renderer unavailable, showing the notes as plain text');
        return render;
      } catch (err) {
        console.warn('[changelog] markdown renderer unavailable, showing the notes as plain text', err);
        return null;
      }
    })();
  }
  return renderer;
}

// ---------------------------------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------------------------------

/**
 * The 更新说明 dialog. Mounted once beside the other hosts (main.js App); it renders nothing until it is opened.
 * @param {{ class?: string }} props
 */
export function ChangelogHost({ class: cls }) {
  const { open, build } = useStore((s) => s, Object.is, changelogStore);
  // Never over a battle: a match on screen is covered by no dialog (the buildGuard rule).
  const inMatch = useStore((s) => selectRoute(s) === 'game');
  /** null while loading, [] when /changelog.md could not be read. */
  const [notes, setNotes] = useState(/** @type {any[] | null} */ (null));
  /** The release the pager picked; null follows the version this page runs. */
  const [picked, setPicked] = useState(/** @type {number | null} */ (null));
  /** The shown release: { html } from the markdown renderer, or { text } from the plain-text fallback. */
  const [body, setBody] = useState(/** @type {{ html?: string, text?: string } | null} */ (null));

  useEffect(() => {
    if (!open || notes) return undefined;
    let alive = true;
    fetchNotes().then((r) => { if (alive) setNotes(r || []); });
    return () => { alive = false; };
  }, [open, notes]);

  const base = useMemo(() => currentIndex(notes || [], APP_VERSION), [notes]);
  const i = notes?.length ? Math.min(Math.max(0, picked ?? base), notes.length - 1) : 0;
  const note = notes?.length ? notes[i] : null;

  useEffect(() => {
    if (!open || !note) return undefined;
    let alive = true;
    setBody(null);
    (async () => {
      const render = await loadRenderer();
      if (alive) setBody(render ? { html: render(note.markdown) } : { text: note.markdown });
    })();
    return () => { alive = false; };
  }, [open, note]);

  const close = () => {
    // Closing is the acknowledgement: remember this page's version so this browser is not prompted for the same update
    // again. The build tag rides along as diagnostics only (see shouldPrompt).
    rememberSeen({ build, version: APP_VERSION });
    changelogStore.set({ open: false });
    setPicked(null);
  };

  if (!open || inMatch) return null;

  const label = note ? `v${note.version}${note.date ? ` · ${note.date}` : ''}` : '';
  return html`<${Modal} open=${true} onClose=${close} class=${cls ? `changelog ${cls}` : 'changelog'}
      title=${t('更新说明')} micro="CHANGELOG // STRONGHOLD PROTOCOL"
      actions=${html`<${Button} variant="primary" icon="check" onClick=${close}>${t('知道了')}<//>`}>
    <div class="changelog__body">
      ${!notes
        ? html`<p class="changelog__state">${t('正在加载更新说明…')}</p>`
        : !notes.length
          ? html`<p class="changelog__state">${t('无法加载更新说明，请稍后重试')}</p>`
          : html`<div class="changelog__bar">
              <${Button} variant="ghost" size="sm" icon="chevronLeft" disabled=${i <= 0}
                onClick=${() => setPicked(i - 1)}>${t('更新版本')}<//>
              <span class="changelog__ver num">${label}</span>
              <${Button} variant="ghost" size="sm" icon="chevronRight" disabled=${i >= notes.length - 1}
                onClick=${() => setPicked(i + 1)}>${t('更早版本')}<//>
            </div>
            ${getLang() !== DEFAULT_LANG
              ? html`<p class="changelog__note"><${MicroLabel}>NOTE<//> ${t('更新说明只有中文版本')}</p>` : null}
            ${body
              ? (body.html != null
                  ? html`<div class="changelog__md" dangerouslySetInnerHTML=${{ __html: body.html }}></div>`
                  : html`<pre class="changelog__md changelog__md--plain">${body.text}</pre>`)
              : html`<p class="changelog__state">${t('正在加载更新说明…')}</p>`}`}
    </div>
  <//>`;
}

/**
 * Open the notes from anywhere (设置's 更新说明 row). Unlike the automatic prompt this ignores what this browser has
 * seen — asking for the notes is a reason to show them.
 */
export function openChangelog() {
  changelogStore.set({ open: true });
}
