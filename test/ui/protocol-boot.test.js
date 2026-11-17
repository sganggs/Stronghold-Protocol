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
  // the round plate comes in as it starts to leave (under it: z-index), inside 回合开始's 2 s
  // (and with the HUD's entry: never over the hidden top bar — PR #827, the maintainer's decision 5)
  assert.match(g, /\$\{roundPop && !hasOffers && \(!boot \|\| bootLeaving\) && hudIn !== 'wait' \? html`<\$\{RoundPopup\}/);
});

test('the pre-game end fits the official 3 s BATTLE_CHECK: the held draft + 协议启动！\'s minimum, its animation whole, the fade with the hold', () => {
  const g = read('public/js/screens/game.js');
  const num = (name) => Number(g.match(new RegExp(`export const ${name} = (\\d+);`))[1]);
  const hold = num('DRAFT_HOLD_MS');
  const min = num('BOOT_MIN_MS');
  // activity_table autoChessData.enterStepList BATTLE_CHECK (协议启动) time 3 → data/config.json timers.battleCheck
  const config = JSON.parse(read('data/config.json'));
  assert.equal(config.timers.battleCheck, 3);
  assert.deepEqual(config.timers.enterSteps.find((s) => s.step === 'BATTLE_CHECK'), { step: 'BATTLE_CHECK', time: 3, hint: 0, title: '协议启动' });
  assert.ok(hold + min <= config.timers.battleCheck * 1000, `${hold} + ${min} ms inside BATTLE_CHECK`);
  assert.ok(hold >= 500, 'the last pick still lands on screen');
  // BOOT_MIN_MS covers the whole entrance: the last element's delay + duration (正在连接…, pboot-in 200ms 1900ms)
  const css = read('public/css/screens/protocol-boot.css');
  const ends = [...css.matchAll(/animation: pboot-[a-z-]+ (\d+)ms (?:calc\()?(\d+)ms/g)].map((m) => Number(m[1]) + Number(m[2]));
  assert.ok(ends.length >= 6, ends.join(','));
  assert.ok(Math.max(...ends) <= min, `the entrance ends by ${Math.max(...ends)} ms, BOOT_MIN_MS ${min}`);
  // the draft screen's fade to black ends with the hold
  const draft = read('public/css/screens/draft.css');
  const [, dur, delay] = draft.match(/\.draft\.is-held \{ pointer-events: none; animation: pg-out (\d+)ms ease-in (\d+)ms forwards; \}/);
  assert.equal(Number(dur) + Number(delay), hold);
  // the held screen is only to look at
  assert.match(read('public/js/screens/bandDraft.js'), /inert=\$\{held \? true : undefined\}/);
});

test('screens/bandDraft.js: the 请选择策略 band and the 轮到你 sound, co-op and solo alike (the maintainer, 2026-10-21), once the art is in — at most TURN_BANNER_LATE_MS late — never with reduced motion', () => {
  const d = read('public/js/screens/bandDraft.js');
  // (§35.18's leftover: a cold cache skipped the solo band at 1 s — the sprites are fetched early, the band waits for them)
  assert.match(d, /useEffect\(\(\) => \{ preloadBootArt\(\); \}, \[\]\);\n\s+const \[turnBanner, setTurnBanner\] = useState\(0\);/, 'fetched as the draft mounts');
  assert.match(d, /if \(!myTurn\) return undefined;\n\s+setPeek\(null\);\n\s+audio\.sfx\('yourTurn'\);\n\s+if \(reducedMotion\(\)\) return undefined;\n\s+const since = Date\.now\(\);\n\s+return onBootArt\(\(\) => \{ if \(Date\.now\(\) - since <= TURN_BANNER_LATE_MS\) setTurnBanner\(\(n\) => n \+ 1\); \}\);/);
  assert.doesNotMatch(d, /if \(!solo\) audio\.sfx\('yourTurn'\)/, 'no co-op-only sound');
  const banner = read('public/js/ui/turnBanner.js');
  assert.match(banner, /export const TURN_BANNER_LATE_MS = 5000;/, 'a bounded wait [ASSUMED], not the 1 s that skipped a cold cache');
  assert.match(banner, /pointer-events none/);
  // the band never takes a click while it plays late over a turn under way
  assert.match(read('public/css/screens/protocol-boot.css'), /\.tbanner \{[^}]*pointer-events: none;/);
  assert.doesNotMatch(banner, /co-op only/);
  assert.match(banner, /\[ASSUMED\] for solo/);
  const boot = read('public/js/ui/protocolBoot.js');
  assert.match(boot, /export function onBootArt\(fn\) \{/);
  // an early call before the art list is in starts nothing and leaves the next call free to start it
  assert.match(boot, /if \(bootArt !== null \|\| typeof Image !== 'function'\) return;\n\s+const assets = data\.get\('assets'\);\n\s+if \(!assets\) return;[^\n]*\n\s+bootArt = false;/);
  // main.js: a room entered (a match is near) starts them once the art list is in
  assert.match(read('public/js/main.js'), /data\.loadAll\(GAME_FILES\)\.then\(\(\) => preloadBootArt\(\), \(\) => \{\}\);/);
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
