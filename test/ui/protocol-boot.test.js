// The pre-game screens (ui/protocolBoot.js 协议启动！, ui/turnBanner.js 请选择策略, css/screens/protocol-boot.css): the
// card layout, the official sprites they draw, the wiring (screens/game.js: the screen once its art is in, else the
// 0.3.0 banner, fading when BATTLE_CHECK ends; screens/bandDraft.js: the band) and the stylesheet's rules. In a browser:
// test/ui/protocol-boot.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const B = await import('../../public/js/ui/protocolBoot.js');

test('bootLayout: 01 / 03 left, 02 / 04 right with a line each into the ship; a solo run one card in the middle', () => {
  const four = B.bootLayout(4);
  assert.deepEqual(four.map((s) => s.side), ['l', 'r', 'l', 'r']);
  assert.deepEqual(four.map((s) => [s.x, s.y]), [[172, 414], [1233, 414], [172, 580], [1233, 580]]);
  for (const s of four) {
    assert.equal(s.from[1], s.y + 63, 'the line leaves the card at its middle');
    assert.ok(s.to[0] > 880 && s.to[0] < 1040 && s.to[1] > 480 && s.to[1] < 640, 'into the ship');
  }
  assert.deepEqual(B.bootLayout(1), [{ x: 703, y: 645, side: 'c' }]);
  assert.equal(B.bootLayout(3).length, 3);
  assert.equal(B.bootLayout(0).length, 1);
});

test('the official sprites, all in the asset list; no drawn stand-ins; not ready without them', () => {
  const ui = JSON.parse(read('data/assets.json')).ui;
  const js = read('public/js/ui/protocolBoot.js');
  const keys = js.match(/const ART = \[([^\]]+)\]/)[1].match(/'([A-Za-z_0-9/]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(keys.sort(), ['battleReady/bg_mountain1', 'battleReady/bg_mountain2', 'battleReady/bg_ring', 'battleReady/bg_terrain',
    'battleReady/rhodes', 'battleReady/rhodes_outline', 'roundStartDialog/round_emoji_head', 'settle/common_logo']);
  for (const k of keys) assert.ok(k in ui, k);
  const banner = read('public/js/ui/turnBanner.js');
  for (const src of [js, banner]) for (const m of src.matchAll(/<\$\{Art\} k="([^"]+)"/g)) assert.ok(keys.includes(m[1]), m[1]);
  assert.doesNotMatch(banner, /<svg/, 'no drawn mark');
  assert.doesNotMatch(js, /<svg[^>]*>\s*<path/, 'no drawn logo');
  assert.equal(B.bootArtReady(), false, 'in Node (no Image) it never turns ready');
});

test('screens/game.js: the screen at BATTLE_CHECK once its art is in, else the banner; at least BOOT_MIN_MS, it fades, then goes', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /useEffect\(\(\) => \{ if \(gd\.ready\) preloadBootArt\(\); \}, \[gd\.ready\]\);/);
  assert.match(g, /if \(phase === PHASE\.BATTLE_CHECK && bootArtReady\(\)\) \{ setBanner\(null\); setBoot\(\(b\) => \(b && b\.key === phaseKey \? b : \{ key: phaseKey, at: Date\.now\(\) \}\)\); \}\n\s+else if [\s\S]*?else if \(b\) setBanner/);
  // from the match screen's first frame when it opens in BATTLE_CHECK (after the held draft screen): the board never shows first
  assert.match(g, /const \[boot, setBoot\] = useState\(\(\) => \(pub\?\.phase === PHASE\.BATTLE_CHECK && bootArtReady\(\) \? \{ key: `\$\{pub\.phase\}:\$\{pub\.round\}`, at: Date\.now\(\) \} : null\)\);/);
  assert.match(g, /<\$\{ProtocolBoot\} key=\$\{boot\.key\} players=\$\{players\} myId=\$\{myId\} leaving=\$\{bootLeaving\} \/>/);
  assert.match(g, /setBootLeaving\(true\);\n\s+out = setTimeout\(\(\) => \{ setBoot\(null\); setBootLeaving\(false\); \}, BOOT_LEAVE_MS\);\n\s+\}, Math\.max\(0, \(boot\.at \|\| 0\) \+ BOOT_MIN_MS - Date\.now\(\)\)\);/);
  // the round plate waits for it
  assert.match(g, /\$\{roundPop && !hasOffers && !boot \? html`<\$\{RoundPopup\}/);
});

test('screens/bandDraft.js: the 请选择策略 band (solo too, PR #643) once the art is in — waiting for it — with the 轮到你 sound in co-op, never with reduced motion', () => {
  const d = read('public/js/screens/bandDraft.js');
  assert.match(d, /if \(!myTurn\) return undefined;\n\s+setPeek\(null\);\n\s+if \(!solo\) audio\.sfx\('yourTurn'\);\n\s+if \(reducedMotion\(\)\) return undefined;\n\s+return onBootArt\(\(\) => setTurnBanner\(\(n\) => n \+ 1\)\);/);
  const boot = read('public/js/ui/protocolBoot.js');
  assert.match(boot, /export function onBootArt\(fn\) \{/);
  assert.match(d, /<\$\{TurnBanner\} key=\$\{turnBanner\} onDone=\$\{\(\) => setTurnBanner\(0\)\} \/>/);
});

test('the stylesheet: every keyframe it uses is defined, reduced motion stops it, the project\'s rules, loaded', () => {
  const css = read('public/css/screens/protocol-boot.css');
  const used = new Set([...css.matchAll(/animation:\s*([^;]+);/g)].flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+/)[0])).filter((n) => n.startsWith('pboot-')));
  for (const n of used) assert.match(css, new RegExp(`@keyframes ${n} \\{`), n);
  assert.ok(used.size >= 10, [...used].join(','));
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /--t\s*:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.pboot, \.pboot \*, \.pboot \*::after \{ animation: none; \}/);
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) assert.match(read(page), /href="\/css\/screens\/protocol-boot\.css"/, page);
});
