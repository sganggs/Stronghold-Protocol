// test/ui/shop-fonts.test.js — the font families the theme documents name (ui/prefab/shopDocs.js).
// Add-only: sub-prefabs and the prefabs map are part of the documents, so their text fonts must be
// waited on before the first canvas bake (Novecentowide level text, SourceHanSansCN-Bold labels).
// The @font-face sheet is written from an untrusted manifest: a family/URL that would end the declaration is
// refused, only the faces of the families the documents draw are loaded, and the host's dispose removes the sheet.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  documentFontFamilies, installThemeFontFaces, loadDocumentFonts, uninstallThemeFontFaces,
} from '../../public/js/ui/prefab/shopDocs.js';

const text = (font) => ({ text: { font, size: 19 }, children: [] });

const FACES = Object.freeze([
  { family: 'NotoSansHans-Medium', url: '/assets/local/fonts/NotoSansHans-Medium.ttf', weight: 500 },
  { family: 'Novecentowide-Normal', url: '/assets/local/fonts/Novecentowide-Normal.otf', weight: 400 },
]);

/** The smallest document the two functions touch: head.append, createElement('style'), getElementById. */
function fakeDocument() {
  const nodes = [];
  const head = { append(child) { nodes.push(child); } };
  return {
    head,
    documentElement: head,
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        id: '',
        textContent: '',
        remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); },
      };
    },
    getElementById(id) { return nodes.find((node) => node.id === id) || null; },
  };
}

test('walks root, children, sub-prefabs and the prefabs map', () => {
  const docs = {
    root: text('SourceHanSansCN-Heavy'),
    children: [text('NotoSansHans-Medium')],
    sub: {
      frame_lv6_obj: { root: text('Novecentowide-Medium') },
    },
    prefabs: {
      panel_shop_main: { root: text('SourceHanSansCN-Bold') },
    },
  };
  assert.deepEqual(
    documentFontFamilies(docs).sort(),
    ['NotoSansHans-Medium', 'Novecentowide-Medium', 'SourceHanSansCN-Bold', 'SourceHanSansCN-Heavy'].sort(),
  );
});

test('deduplicates families across docs and ignores unrelated objects', () => {
  const a = { root: text('Novecentowide-Medium'), materials: { m: { shader: 'x' } } };
  const b = { sub: { cost_view: { root: text('Novecentowide-Medium') } } };
  assert.deepEqual(documentFontFamilies(a, b), ['Novecentowide-Medium']);
});

test('cycles are harmless', () => {
  const doc = { root: text('NotoSansHans-Medium'), children: [] };
  doc.children.push(doc);
  assert.deepEqual(documentFontFamilies(doc), ['NotoSansHans-Medium']);
});

test('installThemeFontFaces: one @font-face per manifest face, font-display swap, one sheet', () => {
  const doc = fakeDocument();
  assert.equal(installThemeFontFaces(FACES, doc), true);
  const style = doc.getElementById('shop-theme-fonts');
  assert.ok(style, 'the sheet is added');
  const rules = style.textContent.split('\n');
  assert.equal(rules.length, 2);
  assert.equal(rules[0], "@font-face { font-family: 'NotoSansHans-Medium'; src: url('/assets/local/fonts/NotoSansHans-Medium.ttf') format('truetype'); font-weight: 500; font-display: swap; }");
  assert.equal(rules[1], "@font-face { font-family: 'Novecentowide-Normal'; src: url('/assets/local/fonts/Novecentowide-Normal.otf') format('opentype'); font-weight: 400; font-display: swap; }");
  // installed once: the same sheet is rewritten, not duplicated
  assert.equal(installThemeFontFaces(FACES, doc), true);
  assert.equal(doc.getElementById('shop-theme-fonts'), style);
  assert.equal(installThemeFontFaces([], doc), false);
  assert.equal(installThemeFontFaces(FACES, null), false);
});

test('installThemeFontFaces: a family or URL that would end the declaration is refused', () => {
  const doc = fakeDocument();
  const refused = [
    { family: "Evil'); } body { background: red }", url: '/assets/local/fonts/a.ttf', weight: 400 },
    { family: 'Evil\nBody { color: red }', url: '/assets/local/fonts/a.ttf', weight: 400 },
    { family: 'Evil; display: none', url: '/assets/local/fonts/a.ttf', weight: 400 },
    { family: 'Evil}', url: '/assets/local/fonts/a.ttf', weight: 400 },
    { family: '', url: '/assets/local/fonts/a.ttf', weight: 400 },
    { family: 'Good', url: "'); } body { background: red } .x { font-family: ('", weight: 400 },
    { family: 'Good', url: '/assets/local/fonts/a b.ttf', weight: 400 },
    { family: 'Good', url: 'https://cdn.example/fonts/a.ttf', weight: 400 },
    { family: 'Good', url: 'javascript:alert(1)', weight: 400 },
  ];
  for (const face of refused) {
    assert.equal(installThemeFontFaces([face], doc), false, JSON.stringify(face));
    assert.equal(doc.getElementById('shop-theme-fonts'), null);
  }
  // an unusable weight is not a breakout: the face still installs at 400
  assert.equal(installThemeFontFaces([{ family: 'Good', url: '/assets/local/fonts/a.ttf', weight: Number.NaN }], doc), true);
  assert.match(doc.getElementById('shop-theme-fonts').textContent, /font-weight: 400;/);
});

test('uninstallThemeFontFaces removes the sheet and is idempotent', () => {
  const doc = fakeDocument();
  assert.equal(uninstallThemeFontFaces(doc), false, 'nothing installed');
  installThemeFontFaces(FACES, doc);
  assert.ok(doc.getElementById('shop-theme-fonts'));
  assert.equal(uninstallThemeFontFaces(doc), true);
  assert.equal(doc.getElementById('shop-theme-fonts'), null);
  assert.equal(uninstallThemeFontFaces(doc), false, 'already removed');
  assert.equal(uninstallThemeFontFaces(null), false);
});

test('loadDocumentFonts waits for the faces of the families the documents draw, not every manifest face', async (t) => {
  const real = globalThis.document;
  const calls = [];
  globalThis.document = { fonts: { load(query) { calls.push(query); return Promise.resolve([]); } } };
  t.after(() => { globalThis.document = real; });

  const faces = FACES.concat({ family: 'SourceHanSansCN-Bold', url: '/assets/local/fonts/SourceHanSansCN-Bold.otf', weight: 700 });
  const families = ['NotoSansHans-Medium'];
  assert.deepEqual(await loadDocumentFonts(families, 50, faces), families);
  assert.deepEqual(calls.sort(), ['500 1em "NotoSansHans-Medium"', '1em "NotoSansHans-Medium"'].sort(),
    'only the drawn family’s face is loaded, plus the family itself');

  calls.length = 0;
  await loadDocumentFonts(['Bad")'], 10, []);
  assert.deepEqual(calls, [], 'a family that would end the query string is not loaded');
});

test('loadDocumentFonts resolves when a face never loads (timeout), when one rejects, and without document.fonts', async (t) => {
  const real = globalThis.document;
  t.after(() => { globalThis.document = real; });
  // A hung face must not hold the mount: the timeout wins and the families are returned for the bake.
  globalThis.document = { fonts: { load: () => new Promise(() => {}) } };
  const started = Date.now();
  assert.deepEqual(await loadDocumentFonts(['Hanging'], 25, []), ['Hanging'], 'the timeout wins over a hung face');
  assert.ok(Date.now() - started < 2000, 'the mount is not held for a hung font');
  // A rejected face is swallowed (the browser falls back to the next family) rather than failing the mount.
  globalThis.document = { fonts: { load: () => Promise.reject(new Error('404')) } };
  assert.deepEqual(await loadDocumentFonts(['Broken'], 50, []), ['Broken'], 'a rejected face does not fail the mount');
  // No Font Loading API at all: nothing to wait for.
  globalThis.document = undefined;
  assert.deepEqual(await loadDocumentFonts(['Nowhere'], 10, []), [], 'no document.fonts: nothing to wait for');
});
