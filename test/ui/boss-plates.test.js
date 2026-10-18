// The leader rounds' plates and the run's end (ui/bossPlates.js, css/screens/boss-plates.css): which ending a moment
// calls for — only inside the server's last pause before RESULT, so the settlement is never delayed —, the 最终攻势
// rows, the official sprites drawn, the wiring in screens/game.js and the stylesheet's rules. In a browser:
// test/ui/boss-plates.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const B = await import('../../public/js/ui/bossPlates.js');

const boss = (o = {}) => ({ deadline: Date.now() + 60000, bossHp: { hp: 500, max: 1000 }, fields: [{ live: true }, { live: true }],
  players: [{ playerId: 'a', alive: true, lp: 20 }, { playerId: 'b', alive: true, lp: 12 }], ...o });

test('bossRoundOver: the leader at 0 HP, or the countdown zeroed with every field stopped (the server\'s pause)', () => {
  assert.equal(B.bossRoundOver(boss()), false, 'fighting');
  assert.equal(B.bossRoundOver(boss({ bossHp: { hp: 0, max: 1000 } })), true);
  assert.equal(B.bossRoundOver(boss({ deadline: 0, fields: [{ live: false }, { live: false }] })), true);
  assert.equal(B.bossRoundOver(boss({ deadline: 0, fields: [{ live: false }, { live: true }] })), false, 'a field still fighting');
  assert.equal(B.bossRoundOver(boss({ deadline: 0, fields: [] })), false, 'no fields yet');
  assert.equal(B.bossRoundOver({ deadline: 0, fields: [{ live: false }] }), false, 'not a leader round');
});

test('endPlateOf: the hidden round over → all cleared / core held; the 最终攻势 lost or everyone eliminated → 模拟中断', () => {
  const over = { deadline: 0, fields: [{ live: false }] };
  assert.equal(B.endPlateOf(PHASE.HIDDEN_CORE, boss()), null, 'still fighting');
  assert.equal(B.endPlateOf(PHASE.HIDDEN_CORE, boss({ bossHp: { hp: 0, max: 9 } })), 'allClear');
  assert.equal(B.endPlateOf(PHASE.HIDDEN_CORE, boss(over)), 'coreFail');
  assert.equal(B.endPlateOf(PHASE.FINAL_ASSAULT, boss(over)), 'abort');
  assert.equal(B.endPlateOf(PHASE.FINAL_ASSAULT, boss({ bossHp: { hp: 0, max: 9 } })), null, 'won: the hidden round or the settlement follows');
  assert.equal(B.endPlateOf(PHASE.SETTLE, boss()), null, 'a settlement with survivors');
  assert.equal(B.endPlateOf(PHASE.SETTLE, boss({ players: [{ alive: false }, { alive: false }] })), 'abort');
  for (const ph of [PHASE.PREP, PHASE.COMBAT, PHASE.RESULT]) assert.equal(B.endPlateOf(ph, boss({ players: [{ alive: false }] })), null, ph);
});

test('finalPlateRows / finalRowsY: the survivors and the LP they bring into the merged pool; rows centred on the node', () => {
  const pub = { players: [{ playerId: 'a', seat: 0, alive: true, lp: 24 }, { playerId: 'b', seat: 1, alive: false, lp: 0 }, { playerId: 'c', seat: 2, alive: true, lp: 22 }] };
  const r = B.finalPlateRows(pub);
  assert.deepEqual(r.rows.map((x) => [x.player.playerId, x.lp]), [['a', 24], ['c', 22]]);
  assert.equal(r.total, 46, 'the sum before teamLp arrives');
  assert.equal(B.finalPlateRows({ ...pub, teamLp: 92 }).total, 92);
  assert.deepEqual(B.finalRowsY(4), [46, 150, 254, 358]);
  assert.deepEqual(B.finalRowsY(1), [202]);
  const ten = B.finalRowsY(10);
  assert.ok(ten[0] >= 45 && ten[9] <= 360, 'a 10-seat room stays inside the plate');
});

test('the official sprites, all in the asset list; no drawn stand-ins; not ready without them', () => {
  const ui = JSON.parse(read('data/assets.json')).ui;
  const js = read('public/js/ui/bossPlates.js');
  const keys = js.match(/const ART = \[([^\]]+)\]/)[1].match(/'([A-Za-z_0-9/]+)'/g).map((s) => s.slice(1, -1));
  for (const k of keys) assert.ok(k in ui, k);
  for (const m of js.matchAll(/["'](settle|hudPanel)\/([A-Za-z_0-9]+)["']/g)) assert.ok(keys.includes(`${m[1]}/${m[2]}`), m[0]);
  assert.doesNotMatch(js, /<path d=|<polygon|<rect /, 'no drawn crest');
  assert.equal(B.bossPlateArtReady(), false, 'in Node (no Image) it never turns ready');
});

test('screens/game.js: the plates once their art is in, else the banners; the endings only in the pause before RESULT', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /if \(phase === PHASE\.FINAL_ASSAULT && bossPlateArtReady\(\)\) \{ setBanner\(null\); setBossPlate\(\{ kind: 'final', \.\.\.finalPlateRows\(pub\), key: phaseKey \}\); \}/);
  assert.match(g, /else if \(phase === PHASE\.HIDDEN_CORE && bossPlateArtReady\(\)\) \{ setBanner\(null\); setBossPlate\(\{ kind: 'core', key: phaseKey \}\); \}\n\s+else if [\s\S]*?else if \(b\) setBanner/);
  assert.match(g, /const endKind = bossPlateArtReady\(\) \? endPlateOf\(phase, pub\) : null;/);
  assert.match(g, /setResultBox\(null\);\n\s+setBossPlate\(\{ kind: 'end', end: endKind, key: `end:\$\{phaseKey\}` \}\);/);
  assert.doesNotMatch(g, /END_PLATE_MS/, 'the settlement is not held back for the plate');
});

test('the stylesheet: every keyframe it uses is defined, no clicks caught, reduced motion stops it, the project\'s rules, loaded', () => {
  const css = read('public/css/screens/boss-plates.css');
  const used = new Set([...css.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/)[0]).filter((n) => n !== 'none'));
  for (const n of used) assert.match(css, new RegExp(`@keyframes ${n} \\{`), n);
  assert.ok(used.size >= 12, [...used].join(','));
  assert.match(css, /\.bpl \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.bpl, \.bpl \*/);
  assert.doesNotMatch(css, /!important|:has\(|--t\s*:/);
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) assert.match(read(page), /href="\/css\/screens\/boss-plates\.css"/, page);
});
