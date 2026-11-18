import { APP_VERSION } from '../../shared/constants.js';

/**
 * Unrelated browser flows use a returning player; release-notes.e2e.test.js covers first-run and update prompts.
 * The entry film (public/js/ui/entryFilm.js: over the title on every page load once the art is installed) is off as
 * well — it would take the suite's first clicks; `{ film: true }` keeps it (test/e2e/client.mjs Client.open plays and
 * skips it like a player, passEntryFilm).
 * @param {any} page
 * @param {{ film?: boolean }} [o]
 */
export async function seedReleaseRead(page, { film = false } = {}) {
  if (!film) await skipEntryFilm(page);
  return page.evaluateOnNewDocument((version) => {
    if (window.top !== window) return; // plugin sandbox frames do not have access to the host's storage
    // Firefox BiDi also runs preloads in its initial opaque document, before the HTTP navigation.
    if (!/^https?:$/.test(location.protocol)) return;
    localStorage.setItem(`sp.pref.release-seen.${version}`, '1');
  }, APP_VERSION);
}

/**
 * No entry film on this page's loads (globalThis.__SP_ENTRY_FILM__ = 'off' before every document, reloads included).
 * entry-film.test.js covers the film itself; Client.open goes through it.
 * @param {any} page
 */
export function skipEntryFilm(page) {
  return page.evaluateOnNewDocument(() => { globalThis.__SP_ENTRY_FILM__ = 'off'; });
}
