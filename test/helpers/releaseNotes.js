import { APP_VERSION } from '../../shared/constants.js';

/** Unrelated browser flows use a returning player; release-notes.e2e.test.js covers first-run and update prompts. */
export function seedReleaseRead(page) {
  return page.evaluateOnNewDocument((version) => {
    if (window.top !== window) return; // plugin sandbox frames do not have access to the host's storage
    localStorage.setItem(`sp.pref.release-seen.${version}`, '1');
  }, APP_VERSION);
}
