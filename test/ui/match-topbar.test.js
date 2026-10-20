// test/ui/match-topbar.test.js — the match's top bar centre as in the event (PR #643, video 7:49): [🔍] in a bracket frame ·
// + · one long band (回合 N | the phase capsule as a bevelled plate | the LP tower) · + · [🔍▶▶] in a bracket frame; and its
// 进场 (video 7:43–7:47): the HUD waits under 协议启动！ and the first round's plate, then comes in (screens/game.js
// `hudIn`, css/screens/game.css .gm__hud.is-wait / .is-enter). Source checks; the browser side runs in the match e2e tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('ui/hud.js TopBar: frame · + · band (round | capsule | LP) · + · frame, the two check buttons keep their test ids', () => {
  const hud = read('public/js/ui/hud.js');
  const at = (s) => { const i = hud.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = ['<div class="gtop__center">', 'gtop__frame gtop__frame--l', 'testid="check-player"', 'gtop__plus gtop__plus--l', '<div class="gtop__band">',
    'gtop__half gtop__half--l', 'class="roundbox"', "cx('gtop__cap'", '<${PhaseCapsule}', 'gtop__half gtop__half--r', '<${LpTower}',
    'gtop__plus gtop__plus--r', 'gtop__frame gtop__frame--r', 'testid="check-enemy"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in the event\'s order');
  // the round number flips when it changes (a keyed element replays gtop-flip)
  assert.match(hud, /<b class="roundbox__num num" key=\$\{roundText\}>\$\{roundText\}<\/b>/);
});

test('css/screens/game.css: the centre and its 进场 — 文字大小 sizes, every keyframe defined, reduced motion still', () => {
  const css = read('public/css/screens/game.css');
  const a = css.indexOf('/* 顶部中栏 (PR #643'); const b = css.indexOf('/* ---- 进场 (PR #643');
  assert.ok(a > 0 && b > a, 'both blocks');
  const mine = css.slice(a, css.indexOf('\n', css.indexOf('@keyframes gtop-flip', a))) + css.slice(b);
  for (const m of mine.matchAll(/font-size:\s*([^;}]+)/g)) assert.match(m[1], /var\(--t\)/, m[1]);
  assert.doesNotMatch(mine, /!important|:has\(/);
  const used = new Set([...mine.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/)[0]).filter((n) => n.startsWith('gtop-')));
  assert.ok(used.size >= 8, [...used].join(','));
  for (const n of used) assert.match(css, new RegExp(`@keyframes ${n} \\{`), n);
  assert.match(css, /\.gm__hud\.is-wait > \* \{ visibility: hidden; \}/);
  const reduce = mine.slice(mine.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const sel of ['.gm__hud.is-enter .gtop__cap', '.gm__hud.is-enter .gtop__half', '.gm__hud.is-enter .team', '.gm__hud.is-enter .shopbar']) {
    assert.ok(reduce.includes(sel), sel);
  }
});

test('screens/game.js: the HUD waits under 协议启动！ and the round plate (4 s at most), comes in for 1.2 s, never with reduced motion', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /const \[hudIn, setHudIn\] = useState\(\(\) => \(boot \? 'wait' : null\)\);/);
  assert.match(g, /useEffect\(\(\) => \{ if \(boot\) setHudIn\('wait'\); \}, \[!!boot\]\);/);
  assert.match(g, /if \(hudIn !== 'wait' \|\| boot\) return undefined;\n\s+if \(reducedMotion\(\)\) \{ setHudIn\(null\); return undefined; \}\n\s+if \(!roundPopShown\) \{ setHudIn\('enter'\); return undefined; \}\n\s+const id = setTimeout\(\(\) => setHudIn\('enter'\), 4000\);/);
  assert.match(g, /if \(hudIn !== 'enter'\) return undefined;\n\s+const id = setTimeout\(\(\) => setHudIn\(null\), 1200\);/);
  assert.match(g, /<div class=\$\{cx\('gm__hud', hudIn && `is-\$\{hudIn\}`\)\} ref=\$\{hudElRef\}>/);
});
