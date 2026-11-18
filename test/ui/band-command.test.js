import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandText, commandStatus, commandUnlock, aimPath, AIM_STEP } from '../../public/js/ui/bandCommand.js';
import { data } from '../../public/js/data.js';

const bands = JSON.parse(readFileSync(new URL('../../data/versions/act3autochess-v3_1/bands.json', import.meta.url), 'utf8'));

test('command rich text expands replacement clauses and unlock text without leaving placeholder tokens', t => {
  const get = data.get; data.get = file => file === 'bands' ? bands : get(file); t.after(() => { data.get = get; });
  for (const band of Object.values(bands)) for (const s of band.skills) assert.ok(!/\{@(?:tag|unlock)\}/.test(commandText(s)), s.effectId);
  assert.match(commandText(bands.band_sargon.skills[0]), /在场6名不同【萨尔贡】/);
  assert.match(commandText(bands.band_rich.skills[0]), /120时升级为获取2名/);
  assert.ok(!commandText(bands.band_mlynar.skills[0]).includes('undefined'));
});

test('command HUD distinguishes locks, cooldown, stocks, recruitment and insufficient funds', () => {
  assert.match(commandUnlock({ unlockType: 'band_skill_load_by_round', unlockParam: ['4'] }), /4/);
  assert.match(commandStatus({ cooldown: 3 }), /3/);
  assert.match(commandStatus({ usesLeft: 0 }), /0/);
  assert.notEqual(commandStatus({ reason: 'funds' }), commandStatus({ reason: 'specialRecruit' }));
  assert.notEqual(commandStatus({ reason: 'passive' }), commandStatus({ usesLeft: 1 }));
});

test('the aiming arrow (§37.201): chevrons every AIM_STEP px along a curve bowed up-screen, the last on the pointer', () => {
  assert.deepEqual(aimPath(100, 100, 104, 102), [], 'a pointer still on the button draws nothing');
  const pts = aimPath(800, 600, 200, 400);
  const len = Math.hypot(600, 200);
  assert.equal(pts.length, Math.round(len / AIM_STEP));
  const tip = pts.at(-1);
  assert.ok(Math.abs(tip.x - 200) < 1e-9 && Math.abs(tip.y - 400) < 1e-9, 'the tip sits on the pointer');
  // the middle chevron lies above the straight line (up-screen = smaller y)
  const mid = pts[Math.floor(pts.length / 2)];
  const lineY = 600 + (mid.x - 800) * (400 - 600) / (200 - 800);
  assert.ok(mid.y < lineY - 20, `bowed up: ${mid.y.toFixed(1)} < ${lineY.toFixed(1)}`);
  // each chevron points along the curve towards the pointer (leftwards here)
  assert.ok(Math.cos(tip.a) < 0, 'the tip points left, towards where the pointer went');
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < AIM_STEP * 1.6);
});
