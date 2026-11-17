// test/ui/match-topbar.test.js — the match's top bar centre as in the event (PR #643 / #827, video 8:01): [🔍] in a
// bracket frame · + · one long band (回合 N | the phase capsule as a bevelled plate | the LP tower) under the official deco
// type · + · [🔍▶▶] in a bracket frame; and its 进场 (the maintainer's decision of 2026-10-21): the HUD waits hidden only
// while 协议启动！ shows and comes in as soon as it leaves (screens/game.js `hudIn`, css/screens/game.css .gm__hud.is-wait
// / .is-enter), the capsule scene of a change meanwhile waiting for it. Source checks; the browser side:
// test/ui/match-topbar.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** The stylesheet's 顶部中栏 block (to the narrow-screen rule's end) and its 进场 block (to its reduced-motion rule's end). */
function blocks() {
  const css = read('public/css/screens/game.css');
  const a = css.indexOf('/* 顶部中栏 (PR #643');
  const aEnd = css.indexOf('/* the two official 🔍 buttons', a);
  const b = css.indexOf('/* ---- 进场 (PR #827');
  const bReduce = css.indexOf('@media (prefers-reduced-motion: reduce)', b);
  const bEnd = css.indexOf('\n}\n', bReduce) + 3;
  assert.ok(a > 0 && aEnd > a && b > aEnd && bReduce > b && bEnd > bReduce, 'both blocks');
  return { css, centre: css.slice(a, aEnd), entry: css.slice(b, bEnd) };
}

test('ui/hud.js TopBar: frame · + · band (deco type, round | capsule | LP) · + · frame, the two check buttons keep their test ids', () => {
  const hud = read('public/js/ui/hud.js');
  const at = (s) => { const i = hud.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = ['<div class="gtop__center">', 'gtop__frame gtop__frame--l', 'testid="check-player"', 'gtop__plus gtop__plus--l', '<div class="gtop__band">',
    '<${DecoType} k="txt1"', '<${DecoType} k="txt2"', '<${DecoType} k="txt3"',
    'gtop__half gtop__half--l', 'class="roundbox"', "cx('gtop__cap'", '<${PhaseCapsule}', 'gtop__half gtop__half--r', '<${LpTower}',
    'gtop__plus gtop__plus--r', 'gtop__frame gtop__frame--r', 'testid="check-enemy"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'in the event\'s order');
  // the round number flips when it changes (a keyed element replays gtop-flip)
  assert.match(hud, /<b class="roundbox__num num" key=\$\{roundText\}>\$\{roundText\}<\/b>/);
});

test('the deco type is the official hudPanel/frame_deco_txt* sprites (aria-hidden), the same words as text without them', () => {
  const hud = read('public/js/ui/hud.js');
  const ui = JSON.parse(read('data/assets.json')).ui;
  for (const k of ['txt1', 'txt2', 'txt3']) assert.ok(`hudPanel/frame_deco_${k}` in ui, k);
  const deco = hud.slice(hud.indexOf('function DecoType'), hud.indexOf('export function OvertimeWarning'));
  assert.match(deco, /aria-hidden="true"/);
  assert.match(deco, /<\$\{Sprite\} k=\$\{`hudPanel\/frame_deco_\$\{k\}`\}/);
  assert.match(hud, /<\$\{DecoType\} k="txt1" text="RHODES ISLAND TERMINAL SERVICE" side="l" \/>/);
  assert.match(hud, /<\$\{DecoType\} k="txt2" text="STRONGHOLD PROTOCOL" side="c" \/>/);
  assert.match(hud, /<\$\{DecoType\} k="txt3" text="RHODES ISLAND TERMINAL SERVICE" side="r" \/>/);
  const { css } = blocks();
  for (const src of [hud, css]) assert.doesNotMatch(src, /STRONGHOLD TERMINAL SERVICE/, 'in no official art');
  assert.doesNotMatch(css, /\.gtop__band::(before|after)/, 'no CSS-generated words (a screen reader read them twice)');
  // the text stand-in, wider than its sprites, ran into itself over a narrow screen's band (§35.18): it gives way there
  assert.match(css, /@media \(max-width: 767px\) \{\n\s+\.gtop__band \{ grid-template-columns: minmax\(1\.2rem, auto\) auto minmax\(1\.2rem, auto\); \}\n\s+\.gtop__half \{ padding: 0 \.14rem; \}\n\s+\.gtop__decotxt \{ display: none; \}\n\}/);
  assert.doesNotMatch(css, /\.gtop__decoimg[^{]*\{[^}]*display: none/, 'the official sprites stay');
});

test('css/screens/game.css: the centre and its 进场 — fixed HUD sizes, the pending red kept, the scene inside the plate, the shop once', () => {
  const { css, centre, entry } = blocks();
  // the round chip and the LP: plain rem, HUD chrome in fixed boxes (test/ui/text-scale.test.js NOT_SCALED); the deco
  // text at its sprite's size
  assert.match(centre, /\.gtop__half \.roundbox__label \{ font-size: \.2rem;/);
  assert.match(centre, /\.gtop__half \.roundbox__num \{[^}]*font-size: \.28rem;/);
  assert.match(centre, /\.gtop__half \.lp--lg \{ font-size: \.32rem;/);
  assert.match(centre, /\.gtop__decotxt \{[^}]*font-size: \.085rem;/);
  for (const m of (centre + entry).matchAll(/font-size:\s*([^;}]+)/g)) assert.doesNotMatch(m[1], /var\(--t\)/, `a fixed HUD size: ${m[1]}`);
  // the white LP never overrides the pending-leak red (GitHub #479, PLAYING.md), the low-LP red or the team colour
  assert.match(centre, /\.gtop__half \.lp--lg:not\(\.lp--danger\):not\(\.lp--team\):not\(\.is-pending\) \.lp__val \{ color: #eef2f2; \}/);
  assert.match(css, /\.lp\.is-pending \.lp__val \{ color: var\(--red-premium\);/);
  // the capsule scenes inside the plate's padding (.gtop__cap padding .08rem .13rem)
  assert.match(css, /\.gtop__cap \{[^}]*padding: \.08rem \.13rem;/);
  assert.match(css, /\.gtop__cap > \.capfx \{ inset: calc\(\.08rem \+ 2px\) calc\(\.13rem \+ 2px\); \}/);
  // the shop bar keeps its own shop-up in the list while it rises in, so it does not start again when .is-enter goes
  assert.match(entry, /\.gm__hud\.is-enter \.shopbar \{ animation: shop-up var\(--t-slow\) var\(--ease-out\), gtop-rise /);
  assert.match(read('public/css/screens/game-shop.css'), /animation: shop-up var\(--t-slow\) var\(--ease-out\);/);
  // a narrow screen lowers the halves' minimum (a boss round's capsule on phone landscape)
  assert.match(centre, /@media \(max-width: 767px\) \{\n\s+\.gtop__band \{ grid-template-columns: minmax\(1\.2rem, auto\) auto minmax\(1\.2rem, auto\); \}/);
  assert.doesNotMatch(centre + entry, /!important|:has\(|@container|@layer/);
  const used = new Set([...(centre + entry).matchAll(/animation:\s*([^;]+);/g)]
    .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+/)[0])).filter((n) => n.startsWith('gtop-')));
  assert.ok(used.size >= 8, [...used].join(','));
  for (const n of used) assert.match(css, new RegExp(`@keyframes ${n} \\{`), n);
  assert.match(entry, /\.gm__hud\.is-wait > \* \{ visibility: hidden; \}/);
  const reduce = entry.slice(entry.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const sel of ['.gm__hud.is-enter .gtop__cap', '.gm__hud.is-enter .gtop__half', '.gm__hud.is-enter .gtop__deco', '.gm__hud.is-enter .team']) {
    assert.ok(reduce.includes(sel), sel);
  }
  assert.match(reduce, /\.gm__hud\.is-enter \.shopbar \{ animation: shop-up var\(--t-slow\) var\(--ease-out\); \}/);
});

test('screens/game.js: the HUD waits only while 协议启动！ shows, comes in as it leaves (no wait for the plate), 1.2 s, never with reduced motion', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /const bootShown = !!boot && !hasOffers && !bootLeaving;/);
  assert.match(g, /const \[hudIn, setHudIn\] = useState\(\(\) => \(bootShown && !reducedMotion\(\) \? 'wait' : null\)\);/);
  // once per 协议启动！ (its boot.key): a plugin window's close re-shows it for the fade, and the HUD stays in
  assert.match(g, /useEffect\(\(\) => \{\n\s+if \(bootShown\) \{ if \(!reducedMotion\(\) && hudCame\.current !== boot\.key\) setHudIn\('wait'\); return; \}\n\s+if \(boot\) hudCame\.current = boot\.key;\n\s+setHudIn\(\(s\) => \(s === 'wait' \? 'enter' : s\)\);\n\s+\}, \[bootShown\]\);/);
  assert.match(g, /if \(hudIn !== 'enter'\) return undefined;\n\s+const id = setTimeout\(\(\) => setHudIn\(null\), 1200\);/);
  assert.doesNotMatch(g, /roundPopShown|setHudIn\('enter'\), 4000/, 'no wait for the round plate, no 4 s cap');
  assert.match(g, /<div class=\$\{cx\('gm__hud', hudIn && `is-\$\{hudIn\}`\)\} ref=\$\{hudElRef\}>/);
  assert.match(g, /held=\$\{hudIn === 'wait'\} \/>/);
});

test('ui/hud.js useCapsuleFx: a phase change while the HUD is held waits and plays when it comes in', () => {
  const hud = read('public/js/ui/hud.js');
  assert.match(hud, /function useCapsuleFx\(phase, round, held = false\) \{/);
  assert.match(hud, /if \(s\.key !== key && !\(held && s\.key !== null\)\) \{/);
  assert.match(hud, /const fx = useCapsuleFx\(phase, pub\?\.round, held\);/);
  assert.match(hud, /onRemoveSpectator = null, room = null, held = false \}\) \{/);
});
