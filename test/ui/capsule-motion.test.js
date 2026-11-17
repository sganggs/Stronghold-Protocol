// The top bar's phase capsule scenes (ui/hud.js capsuleFxKind / CapsuleScene, css/screens/game.css .capfx): which phase
// change plays which scene, the official hudPanel/trans_* sprites they draw, the wiring in TopBar and the stylesheet's
// rules. The scenes in a browser: test/ui/capsule-motion.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const { capsuleFxKind } = await import('../../public/js/ui/hud.js');

test('capsuleFxKind: kettles at 回合开始, rest right after it, the clash at 作战, the 联防 scene, the rest rises in', () => {
  assert.equal(capsuleFxKind(PHASE.ROUND_START, PHASE.SETTLE), 'wait');
  assert.equal(capsuleFxKind(PHASE.ROUND_START, null), 'wait');
  assert.equal(capsuleFxKind(PHASE.PREP, PHASE.ROUND_START), 'rest');
  assert.equal(capsuleFxKind(PHASE.SP_DRAFT, PHASE.ROUND_START), 'rest');
  assert.equal(capsuleFxKind(PHASE.PREP, PHASE.SP_DRAFT), 'enter');
  assert.equal(capsuleFxKind(PHASE.COMBAT, PHASE.PREP), 'clash');
  assert.equal(capsuleFxKind(PHASE.UNITE, PHASE.COMBAT), 'unite');
  for (const ph of [PHASE.SETTLE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.BATTLE_CHECK]) assert.equal(capsuleFxKind(ph, PHASE.PREP), 'enter', ph);
  assert.equal(capsuleFxKind(PHASE.RESULT, PHASE.SETTLE), null);
  assert.equal(capsuleFxKind(undefined, PHASE.SETTLE), null);
});

test('the scenes draw the official hudPanel/trans_* sprites, all in the asset list, no drawn stand-ins', () => {
  const ui = JSON.parse(read('data/assets.json')).ui;
  const js = read('public/js/ui/hud.js');
  const names = js.match(/const CAP_ART = \[([^\]]+)\]/)[1].match(/'([a-z0-9]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(names, ['cup', 'batte1', 'batte2', 'coop1', 'coop2', 'coop3', 'coop4', 'worm1', 'worm2']);
  for (const n of names) assert.ok(`hudPanel/trans_${n}` in ui, n);
  const scene = js.slice(js.indexOf('function CapsuleScene'), js.indexOf('export function missTip'));
  for (const m of scene.matchAll(/trans\(([^,)]+)/g)) assert.match(m[1], /^'(cup|coop[34]|worm[12])'$|^`\$\{c\}[12]`$|^unite \? 'worm2' : 'worm1'$/, m[1]);
  assert.doesNotMatch(js, /PixBot|pixbots/, 'official art, no redrawn robots');
  assert.match(js, /capsuleArt !== true \? 'enter' : kind/, 'without the loaded art every change only rises in');
});

test('TopBar: the capsule in its scene box, re-keyed per change; the sprites fetched when the match screen opens', () => {
  const js = read('public/js/ui/hud.js');
  assert.match(js, /const fx = useCapsuleFx\(phase, pub\?\.round, held\);\n\s+useEffect\(\(\) => \{ preloadCapsuleArt\(\); \}, \[\]\);/);
  assert.match(js, /<div class=\$\{cx\('gtop__cap', fx\.kind && `is-fx-\$\{fx\.kind\}`\)\} key=\$\{`cap\$\{fx\.seq\}`\}>\n\s+<\$\{PhaseCapsule\}/);
  assert.match(js, /\$\{fx\.kind && fx\.kind !== 'enter' \? html`<\$\{CapsuleScene\} kind=\$\{fx\.kind\} \/>` : null\}/);
  assert.match(js, /s\.key === null \|\| reducedMotion\(\) \? null/, 'nothing on the first render or with reduced motion');
});

test('the stylesheet: every keyframe it uses is defined, reduced motion turns the scenes off, the project\'s rules', () => {
  const css = read('public/css/screens/game.css');
  const block = css.slice(css.indexOf('/* phase capsule scenes'), css.indexOf('.bossbar {'));
  assert.ok(block.length > 1000);
  const used = new Set([...block.matchAll(/animation(?:-name)?:\s*([^;]+);/g)].flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+/)[0])).filter((n) => n.startsWith('capfx-')));
  for (const n of used) assert.match(block, new RegExp(`@keyframes ${n} \\{`), n);
  assert.ok(used.size >= 12, [...used].join(','));
  assert.doesNotMatch(block, /!important/);
  assert.doesNotMatch(block, /:has\(/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.capfx \{ display: none; \}/);
});

test('开始作战 / 联防开始 are translated', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const j = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const k of ['开始作战', '联防开始']) assert.ok(j[k], `${lang} ${k}`);
  }
});
