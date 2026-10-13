// test/ui/changelog.test.js — public/js/ui/changelog.js: 更新说明, the release notes of the version this page runs,
// shown once after an update.
//
// The contract this pins:
//   * an install is not an update: a browser that never answered a prompt is never prompted (it has no stored row);
//   * once there is a row, a different version prompts — and so does the same version under a different build tag,
//     which is what a client-only deploy looks like (ui/buildGuard.js reloads the page for it);
//   * an unreadable /healthz (build null) never prompts on its own: a restarting server is not an update;
//   * the notes of several releases come out of ONE file (CHANGELOG.md) split by its own headings, so no per-version
//     file has to be generated or kept in step; and
//   * the markdown renderer degrades to plain text instead of throwing when either vendored library is unusable —
//     which is the state in Node (DOMPurify builds itself against window).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = () => import(pathToFileURL(path.join(ROOT, 'public', 'js', 'ui', 'changelog.js')).href);

/** In-memory localStorage: loadPref/savePref (store.js) read globalThis.localStorage directly. */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** Run `fn` with a fresh localStorage installed, and restore whatever was there (awaits, so an async fn is covered too). */
async function withStorage(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = had ? globalThis.localStorage : undefined;
  globalThis.localStorage = memStorage();
  try {
    return await fn();
  } finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

const quiet = async (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = w; }
};

// ---- versions ---------------------------------------------------------------------------------------

describe('changelog: versions', () => {
  test('normalizeVersion drops a -dev suffix so a dev build reads its release\'s notes', async () => {
    const { normalizeVersion } = await mod();
    assert.equal(normalizeVersion('0.2.6-dev'), '0.2.6');
    assert.equal(normalizeVersion('0.2.6'), '0.2.6');
    assert.equal(normalizeVersion(null), '');
    assert.equal(normalizeVersion(undefined), '');
    assert.equal(normalizeVersion(25), '25');
  });

  test('currentIndex finds the release this page runs, and falls back to the newest', async () => {
    const { currentIndex } = await mod();
    const notes = [{ version: '0.3.0' }, { version: '0.2.6' }, { version: '0.2.5' }];
    assert.equal(currentIndex(notes, '0.2.5'), 2);
    assert.equal(currentIndex(notes, '0.2.6-dev'), 1, 'a dev build reads the release it heads for');
    assert.equal(currentIndex(notes, '0.3.0'), 0);
    assert.equal(currentIndex(notes, '9.9.9'), 0, 'a build between two releases reads the newest notes');
    assert.equal(currentIndex([], '0.2.5'), 0);
    assert.equal(currentIndex(null, '0.2.5'), 0);
  });
});

// ---- parseNotes -------------------------------------------------------------------------------------

describe('changelog: parseNotes', () => {
  test('splits releases on `## <version> — <date>` and keeps `### …` sections with their release', async () => {
    const { parseNotes } = await mod();
    const md = [
      '## 0.2.5 — 2026-10-12',
      '',
      '### 新功能',
      '- one',
      '### 界面',
      '- two',
      '',
      '## 0.2.4 — 2026-10-11',
      '',
      '### 规则（按官方）',
      '- three',
      '',
    ].join('\n');
    const notes = parseNotes(md);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].version, '0.2.5');
    assert.equal(notes[0].date, '2026-10-12');
    assert.match(notes[0].markdown, /### 新功能/);
    assert.match(notes[0].markdown, /### 界面/);
    assert.ok(!notes[0].markdown.includes('0.2.4'), 'the next release is not part of this one');
    assert.equal(notes[1].version, '0.2.4');
    assert.match(notes[1].markdown, /### 规则（按官方）/);
  });

  test('tolerates a heading without a date, CRLF, `#`/`###` lines and an empty document', async () => {
    const { parseNotes } = await mod();
    assert.deepEqual(parseNotes(''), []);
    assert.deepEqual(parseNotes(null), []);
    assert.deepEqual(parseNotes(undefined), []);
    assert.deepEqual(parseNotes('# CHANGELOG\n\nno release here'), [], 'a `#` title is not a release');
    assert.deepEqual(parseNotes('### 新功能\n- a'), [], 'a `###` section outside a release is not one');
    const [only] = parseNotes('## 1.0.0\n- a\r\n- b\r\n');
    assert.equal(only.version, '1.0.0');
    assert.equal(only.date, '');
    assert.match(only.markdown, /- b/);
    // a `-` (hyphen) date separator must not be eaten out of the version itself
    const [hyphen] = parseNotes('## 1.0.0-dev - 2026-01-02\n- x');
    assert.equal(hyphen.version, '1.0.0-dev');
    assert.equal(hyphen.date, '2026-01-02');
  });

  test('the repository\'s own CHANGELOG.md parses into one non-empty record per release, newest first', async () => {
    const { parseNotes } = await mod();
    const notes = parseNotes(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
    assert.ok(notes.length >= 5, `expected the shipped release notes to parse (got ${notes.length})`);
    const seen = new Set();
    for (const n of notes) {
      assert.match(n.version, /^\d+\.\d+\.\d+/, `${n.version} looks like a version`);
      assert.ok(n.markdown.length > 0, `${n.version} has a body`);
      assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/, `${n.version} carries its release date`);
      assert.ok(!seen.has(n.version), `${n.version} appears once`);
      seen.add(n.version);
    }
    // the dialog's first page is notes[0], so the file must be newest-first: every version is ≥ the next one
    const rank = (v) => v.split('.').map((x) => parseInt(x, 10));
    for (let i = 1; i < notes.length; i++) {
      const [a, b] = [rank(notes[i - 1].version), rank(notes[i].version)];
      assert.ok(a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2]))),
        `${notes[i - 1].version} comes before ${notes[i].version}`);
    }
    // …and the version this build ships has to be one of them, or the dialog would open on an older release
    const { APP_VERSION } = await import('../../shared/constants.js');
    const { normalizeVersion, currentIndex } = await mod();
    const want = normalizeVersion(APP_VERSION);
    assert.equal(notes[currentIndex(notes, APP_VERSION)].version, seen.has(want) ? want : notes[0].version,
      `${want} is in CHANGELOG.md (or the newest release is shown)`);
  });
});

// ---- shouldPrompt -----------------------------------------------------------------------------------

describe('changelog: shouldPrompt', () => {
  test('a fresh install IS prompted: nothing acknowledged yet means everything is new', async () => {
    const { shouldPrompt } = await mod();
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: null }), true);
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: undefined }), true);
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: 'nonsense' }), true, 'a corrupt row is no answer');
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: {} }), true, 'a row with nothing in it says nothing');
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { build: 'aaa' } }), true, 'the version is what is acknowledged');
  });

  test('the version this browser acknowledged is not shown again', async () => {
    const { shouldPrompt } = await mod();
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { build: 'aaa', version: '0.2.5' } }), false);
    assert.equal(shouldPrompt({ version: '0.2.6-dev', lastSeen: { version: '0.2.6' } }), false, 'a -dev build is the release it heads for');
    assert.equal(shouldPrompt({ version: '0.2.6', lastSeen: { version: '0.2.6-dev' } }), false, 'and back again');
  });

  test('a different version is prompted', async () => {
    const { shouldPrompt } = await mod();
    assert.equal(shouldPrompt({ version: '0.2.6', lastSeen: { build: 'aaa', version: '0.2.5' } }), true);
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { build: null, version: '0.2.4' } }), true,
      'an unreadable /healthz is irrelevant: the version decides');
  });

  test('the build tag never decides on its own — the notes are keyed by version', async () => {
    const { shouldPrompt } = await mod();
    // Every deploy moves the tag; prompting on it would re-show byte-identical notes after each one, and — since the
    // answered row records the build the page ran at the time — the prompt could never settle.
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { build: 'aaa', version: '0.2.5' } }), false);
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { build: 'old', version: '0.2.5' } }), false);
    assert.equal(shouldPrompt({ version: '0.2.5', lastSeen: { version: '0.2.5' } }), false);
  });
});

// ---- the stored row ---------------------------------------------------------------------------------

describe('changelog: the stored row', () => {
  test('rememberSeen / lastSeen round-trip through localStorage, and garbage reads back as null', async () => {
    await withStorage(async () => {
      const { rememberSeen, lastSeen } = await mod();
      assert.equal(lastSeen(), null, 'nothing answered yet');
      rememberSeen({ build: 'aaa', version: '0.2.6', now: 1234 });
      assert.deepEqual(lastSeen(), { build: 'aaa', version: '0.2.6', at: 1234 });
      rememberSeen({ build: null, version: '0.2.7' });
      assert.equal(lastSeen().build, null, 'an unreadable build is stored as null, not dropped');
      globalThis.localStorage.setItem('sp.pref.changelog.seen', '"a string"');
      assert.equal(lastSeen(), null);
      globalThis.localStorage.setItem('sp.pref.changelog.seen', '{broken');
      assert.equal(lastSeen(), null);
    });
  });

  test('maybePromptChangelog opens on a fresh install, stays shut for an acknowledged version, opens for a new one', async () => {
    await withStorage(async () => {
      const { maybePromptChangelog, changelogStore, rememberSeen } = await mod();
      // a brand-new browser: no answer yet, so the notes of the version being installed are shown
      assert.equal(maybePromptChangelog({ build: 'aaa', version: '0.2.5' }), true);
      assert.equal(changelogStore.get().open, true);
      assert.equal(changelogStore.get().build, 'aaa', 'the page build is kept for the answered row');
      // the player closes the dialog: the version is acknowledged
      changelogStore.set({ open: false });
      rememberSeen({ build: 'aaa', version: '0.2.5' });
      assert.equal(maybePromptChangelog({ build: 'aaa', version: '0.2.5' }), false);
      assert.equal(changelogStore.get().open, false);
      // a later deploy of the same version does not reopen it (the build tag is no trigger)
      assert.equal(maybePromptChangelog({ build: 'zzz', version: '0.2.5' }), false);
      // the version moved: shown again
      assert.equal(maybePromptChangelog({ build: 'bbb', version: '0.2.6' }), true);
      assert.equal(changelogStore.get().open, true);
      changelogStore.set({ open: false });
    });
  });

  test('canRemember is false without storage, and then nothing is asked at all', async () => {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const prev = had ? globalThis.localStorage : undefined;
    try {
      delete globalThis.localStorage;
      const { canRemember, maybePromptChangelog, changelogStore } = await mod();
      assert.equal(canRemember(), false);
      assert.equal(maybePromptChangelog({ build: 'aaa', version: '0.2.5' }), false,
        'every load would forget the answer and reopen: worse than not asking');
      assert.equal(changelogStore.get().open, false);
      assert.equal(changelogStore.get().build, 'aaa', 'the build is still recorded for a report');
    } finally {
      if (had) globalThis.localStorage = prev;
    }
  });

  test('canRemember is false when writes silently do not stick (private mode), and true when they do', async () => {
    await withStorage(async () => {
      const { canRemember } = await mod();
      assert.equal(canRemember(), true);
    });
    // a storage that accepts the write and drops it (quota-exceeded private modes behave like this)
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const prev = had ? globalThis.localStorage : undefined;
    globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    try {
      const { canRemember } = await mod();
      assert.equal(canRemember(), false, 'a write that does not read back is not storage');
    } finally {
      if (had) globalThis.localStorage = prev;
      else delete globalThis.localStorage;
    }
    // a storage that throws on write (Safari private mode)
    globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    try {
      const { canRemember } = await mod();
      assert.equal(canRemember(), false);
    } finally {
      if (had) globalThis.localStorage = prev;
      else delete globalThis.localStorage;
    }
  });
});

// ---- fetchNotes -------------------------------------------------------------------------------------

describe('changelog: fetchNotes', () => {
  test('reads and splits /changelog.md', async () => {
    const { fetchNotes } = await mod();
    let seenUrl = null;
    let seenInit = null;
    const notes = await fetchNotes(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, status: 200, text: async () => '## 9.9.9 — 2030-01-01\n- one\n' };
    });
    assert.equal(seenUrl, '/changelog.md');
    assert.equal(seenInit.cache, 'no-cache');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].version, '9.9.9');
  });

  test('a 404 or an unreachable host is null, never a throw (a static host without the file)', async () => {
    const { fetchNotes } = await mod();
    assert.equal(await fetchNotes(async () => ({ ok: false, status: 404 })), null);
    assert.equal(await fetchNotes(async () => { throw new Error('offline'); }), null);
    assert.equal(await fetchNotes(async () => null), null);
  });
});

// ---- the renderer -----------------------------------------------------------------------------------

describe('changelog: the markdown renderer', () => {
  test('composeRenderer runs marked first and DOMPurify over its output', async () => {
    const { composeRenderer } = await mod();
    const order = [];
    const render = composeRenderer(
      { marked: (md, opts) => { order.push(`marked:${opts.gfm ? 'gfm' : '-'}`); return `<h3>${md}</h3><script>BAD</script>`; } },
      { default: { sanitize: (html) => { order.push('sanitize'); return html.replace(/<script>[\s\S]*?<\/script>/g, ''); } } },
    );
    assert.equal(typeof render, 'function');
    assert.equal(render('新功能'), '<h3>新功能</h3>');
    assert.deepEqual(order, ['marked:gfm', 'sanitize'], 'the sanitiser sees marked\'s output, never the raw markdown');
  });

  test('composeRenderer accepts marked\'s `parse` shape and a bare DOMPurify namespace', async () => {
    const { composeRenderer } = await mod();
    const render = composeRenderer(
      { parse: (md) => `<p>${md}</p>` },
      { sanitize: (h) => h },
    );
    assert.equal(render('x'), '<p>x</p>');
  });

  test('composeRenderer is null when either half is unusable — the plain-text fallback', async () => {
    const { composeRenderer } = await mod();
    const purify = { default: { sanitize: (h) => h } };
    assert.equal(composeRenderer(null, purify), null);
    assert.equal(composeRenderer({ marked: (md) => md }, null), null);
    assert.equal(composeRenderer({ marked: (md) => md }, {}), null, 'no sanitiser → do not inject HTML at all');
    assert.equal(composeRenderer({}, purify), null, 'no markdown parser → the same');
  });

  test('loadRenderer resolves to null here (no DOM) instead of rejecting, and is memoised', async () => {
    const { loadRenderer } = await mod();
    const first = await quiet(() => loadRenderer());
    assert.equal(first, null, 'DOMPurify cannot build without a window: the dialog shows plain text');
    assert.equal(loadRenderer(), loadRenderer(), 'one attempt per page, not one per open');
  });

  test('marked is vendored and does parse the notes once a DOM-backed sanitiser is supplied', async () => {
    const { composeRenderer } = await mod();
    const markedMod = await import(pathToFileURL(path.join(ROOT, 'public', 'vendor', 'marked.esm.js')).href);
    const render = composeRenderer(markedMod, { sanitize: (h) => h });
    assert.equal(typeof render, 'function', 'the vendored marked loads (run npm install → tools/vendor.mjs)');
    const html = render('### 新功能\n\n- a **bold** [link](https://example.com)\n');
    assert.match(html, /<h3[^>]*>新功能<\/h3>/);
    assert.match(html, /<li>a <strong>bold<\/strong> <a href="https:\/\/example\.com">link<\/a><\/li>/);
  });
});
