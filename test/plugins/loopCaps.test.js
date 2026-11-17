import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getData } from '../../server/data.js';
import { applyPatches } from '../../shared/plugins/patch.js';
import { validateData } from '../../shared/plugins/validate.js';
import { dataBound } from '../../shared/plugins/limits.js';
import { textCount, textFinite } from '../../shared/plugins/textNumber.js';
import {
  bbCap, exportOfficialBounds, forgetOfficialBounds, installOfficialBounds, officialTextMax, rememberOfficialBounds,
} from '../../shared/plugins/officialBounds.js';
import { STEP_TICK, burstLimit } from '../../shared/plugins/steps.js';
import { TICK } from '../../server/sim/constants.js';
import { COLS } from '../../server/sim/constants.js';
import { resolveHit } from '../../server/sim/ai.js';
import { normalizeChess } from '../../server/sim/simdata.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { fixture, bondPatch } from '../helpers/contentFixtures.js';

const BOMB = '10000000000000000';
const NINES = '9'.repeat(400);

function boundProblems(op) {
  const patched = applyPatches(getData(), [op]);
  assert.deepEqual(patched.problems, [], JSON.stringify(patched.problems));
  return validateData(patched.data, { vanilla: getData() }).filter((p) => p.code === 'PLUGIN_DATA_BOUND');
}

function setDesc(record, skillId, text) {
  if (record.skill && (record.skill.skillId === skillId || record.skill.id === skillId)) record.skill.desc = text;
  for (const s of record.skills ?? []) if (s && (s.skillId === skillId || s.id === skillId)) s.desc = text;
}

test('description counts stay finite and official phrases are unchanged', () => {
  getData();
  assert.equal(officialTextMax('burst'), 9);
  assert.equal(officialTextMax('attack-times'), 15);
  assert.equal(officialTextMax('steal'), 2);
  assert.equal(officialTextMax('combo'), 10);
  assert.equal(officialTextMax('chain-attack'), 2);
  assert.equal(textCount('9连发', /(\d+)连发/, 1, 'burst'), 9);
  assert.equal(textCount('两连击', /(\d+|[一二两三四五六七八九十])连击/, 2, 'combo'), 2);
  assert.equal(textCount(`${BOMB}连发`, /(\d+)连发/, 1, 'burst'), dataBound(9));
  assert.equal(textCount(`${NINES}连发`, /(\d+)连发/, 1, 'burst'), dataBound(9));
  assert.equal(textFinite('持续120秒', /持续(\d+(?:\.\d+)?)秒/, 25), 120);
  assert.equal(textFinite('伤害降低80%', /伤害降低(\d+)%/, 0), 80);
});

test('霍尔海雅 S2 1e16 连发 fills a capped target list', async () => {
  const heyak = (await import('../../server/sim/content/kits/ops/op-heyak.js')).default;
  const form = structuredClone(getData().backups.units.char_4027_heyak.forms['2/1/4/0']);
  setDesc(form, 'skchr_heyak_2', `${BOMB}连发`);
  const problems = boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_4027_heyak', 'forms', '2/1/4/0', 'skills', 1, 'desc'], value: `${BOMB}连发`,
  });
  assert.equal(problems.length, 0);
  const kit = heyak.char_4027_heyak({}, form);
  const hooks = [];
  const foe = { id: 'e' };
  const battle = {
    on(name, fn) { hooks.push({ name, fn }); },
    addBuff() {},
    every() {},
    enemiesInKeys() { return [foe]; },
    blockedTargets() { return []; },
    rng: { pick: (xs) => xs[0] },
  };
  const unit = { id: 'u', alive: true, deployed: true, skill: { id: 'skchr_heyak_2', active: true }, rangeKeys: [], mem: {}, s: {} };
  const t0 = Date.now();
  kit.install(battle, unit);
  const before = hooks.filter((h) => h.name === 'beforeAttack').at(-1);
  assert.ok(before, 'S2 did not register beforeAttack');
  const ctx = { attacker: unit, targets: [foe], profile: {} };
  before.fn(ctx);
  assert.equal(ctx.targets.length, dataBound(officialTextMax('burst')));
  assert.ok(Date.now() - t0 < 1000, `heyak ${Date.now() - t0}ms`);
});

test('阿 爆发剂 1e16 攻击次数 with zero damage finishes', async () => {
  const haak = (await import('../../server/sim/content/kits/ops/op-haak.js')).default;
  const form = structuredClone(getData().backups.units.char_225_haak.forms['2/1/4/0']);
  setDesc(form, 'skchr_haak_2', `攻击${BOMB}次`);
  const skill = form.skills.find((s) => s.skillId === 'skchr_haak_2');
  skill.bb = { ...skill.bb, damage: 0 };
  const descProblems = boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_225_haak', 'forms', '2/1/4/0', 'skills', 1, 'desc'], value: `攻击${BOMB}次`,
  });
  const dmgProblems = boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_225_haak', 'forms', '2/1/4/0', 'skills', 1, 'bb', 'damage'], value: 0,
  });
  assert.equal(descProblems.length, 0);
  assert.equal(dmgProblems.length, 0);
  const kit = haak.char_225_haak({}, form);
  const unit = {
    id: 'u', alive: true, deployed: true, tileR: 1, tileC: 1, dir: 'RIGHT', x: 1, y: 1,
    rangeKeys: [1 * COLS + 2], s: { atk: 1, taunt: 0, flags: {} }, mem: {},
  };
  const ally = {
    id: 'a', alive: true, deployed: true, hidden: false, kind: 'op', tileR: 1, tileC: 2, x: 2, y: 1,
    s: { taunt: 0, flags: {}, maxHp: 100 }, aggroSeq: 1, mem: {},
  };
  let hits = 0;
  const battle = {
    allyUnits: [unit, ally],
    allySelectable: () => true,
    dealDamage(_s, t, info) { hits++; assert.equal(info.amount, 0); assert.equal(t.alive, true); return 0; },
    addBuff() {},
    fx() {},
  };
  const t0 = Date.now();
  kit.skills.skchr_haak_2.onStart({ battle, unit });
  assert.equal(hits, dataBound(officialTextMax('attack-times')));
  assert.equal(ally.alive, true);
  assert.ok(Date.now() - t0 < 1000, `haak ${Date.now() - t0}ms`);
});

test('娜仁图亚 偷取触发 1e16 次 finishes', async () => {
  const narant = (await import('../../server/sim/content/kits/ops/op-narant.js')).default;
  const form = structuredClone(getData().backups.units.char_4138_narant.forms['2/1/4/0']);
  form.talents[0].desc = `偷取触发${BOMB}次`;
  form.talents[0].bb['attack@steal_atk_max'] = 1e12;
  form.talents[0].bb['attack@steal_def_max'] = 1e12;
  assert.equal(boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_4138_narant', 'forms', '2/1/4/0', 'talents', 0, 'desc'], value: `偷取触发${BOMB}次`,
  }).length, 0);
  const kit = narant.char_4138_narant({}, form);
  const hooks = [];
  const battle = {
    on(name, fn) { hooks.push({ name, fn }); },
    addBuff() {},
    removeBuff() {},
  };
  const unit = { id: 'u', alive: true, deployed: true, x: 3, y: 4, mem: {} };
  const enemy = { id: 'e', alive: true, side: 'enemy', x: 3, y: 4 };
  kit.talents[0].install(battle, unit);
  const beforeApply = hooks.find((h) => h.name === 'damageBeforeApply');
  assert.ok(beforeApply);
  const t0 = Date.now();
  beforeApply.fn({ source: unit, target: enemy, dmg: { isAttack: true } });
  const times = dataBound(officialTextMax('steal'));
  const sa = form.talents[0].bb['attack@steal_atk'];
  assert.equal(unit.mem.narantLoot.a, sa * times);
  assert.ok(Date.now() - t0 < 1000, `narant ${Date.now() - t0}ms`);
});

test('纯烬艾雅法拉 连发 of 1e16 and of 400 nines both clamp', async () => {
  const agoat = (await import('../../server/sim/content/kits/ops/chess_char_6_20-agoat2.js')).default;
  const fire = (text) => {
    const chess = structuredClone(getData().chess.chess_char_6_20_a);
    chess.skill.desc = text;
    for (const s of chess.skills ?? []) if (s && s.skillId === chess.skill.skillId) s.desc = text;
    const def = normalizeChess(chess);
    const kit = agoat.chess_char_6_20_a({}, chess, def);
    const hooks = [];
    const battle = { on(name, fn) { hooks.push({ name, fn }); } };
    const ally = { id: 'a' };
    const unit = { id: 'u', skill: { active: true }, mem: {} };
    kit.talents[0].install(battle, unit);
    const before = hooks.find((h) => h.name === 'beforeAttack');
    const ctx = { attacker: unit, targets: [ally] };
    const t0 = Date.now();
    before.fn(ctx);
    assert.equal(ctx.targets.length, dataBound(officialTextMax('burst')));
    assert.ok(Date.now() - t0 < 1000, `agoat2 ${Date.now() - t0}ms`);
  };
  const chess = getData().chess.chess_char_6_20_a;
  const skillAt = chess.skills.findIndex((s) => s.skillId === chess.skill.skillId);
  for (const text of [`${BOMB}连发`, `${NINES}连发`]) {
    const problems = validateData(applyPatches(getData(), [
      { op: 'set', file: 'chess', id: 'chess_char_6_20_a', path: ['skill', 'desc'], value: text },
      { op: 'set', file: 'chess', id: 'chess_char_6_20_a', path: ['skills', skillAt, 'desc'], value: text },
    ]).data, { vanilla: getData() });
    assert.equal(problems.filter((p) => p.code === 'PLUGIN_DATA_BOUND' || p.code === 'PLUGIN_RECORD_SKILLS').length, 0, JSON.stringify(problems.slice(0, 3)));
    fire(text);
  }
});

test('雪猎 1e16 连击 with zero attack finishes', async () => {
  const snhunt = (await import('../../server/sim/content/kits/ops/chess_char_3_11-snhunt.js')).default;
  const chess = structuredClone(getData().chess.chess_char_3_11_a);
  chess.stats = { ...chess.stats, atk: 0 };
  setDesc(chess, chess.skill.skillId, `${BOMB}连击`);
  const skillAt = chess.skills.findIndex((s) => s.skillId === chess.skill.skillId);
  const problems = validateData(applyPatches(getData(), [
    { op: 'set', file: 'chess', id: 'chess_char_3_11_a', path: ['skill', 'desc'], value: `${BOMB}连击` },
    { op: 'set', file: 'chess', id: 'chess_char_3_11_a', path: ['skills', skillAt, 'desc'], value: `${BOMB}连击` },
    { op: 'set', file: 'chess', id: 'chess_char_3_11_a', path: ['stats', 'atk'], value: 0 },
  ]).data, { vanilla: getData() });
  assert.equal(problems.filter((p) => p.code === 'PLUGIN_DATA_BOUND' || p.code === 'PLUGIN_RECORD_SKILLS').length, 0, JSON.stringify(problems.slice(0, 3)));
  const kit = snhunt.chess_char_3_11_a({}, chess);
  const target = { id: 't', alive: true, blockedBy: null, moving: false, s: { flags: {} } };
  let onHit = null;
  let hits = 0;
  const battle = {
    enemiesInKeys() { return [target]; },
    addProjectile(p) { onHit = p.onHit; },
    fx() {},
    dealDamage() { hits++; assert.equal(target.alive, true); return 0; },
  };
  const unit = { id: 'u', alive: true, rangeKeys: [], profile: {}, s: { atk: 0 }, x: 0, y: 0, mem: {} };
  const t0 = Date.now();
  kit.skill.onStart({ battle, unit });
  assert.ok(onHit);
  onHit({ target });
  assert.equal(hits, dataBound(officialTextMax('combo')));
  assert.equal(target.alive, true);
  assert.ok(Date.now() - t0 < 1000, `snhunt ${Date.now() - t0}ms`);
});

test('至简 1e16 连续攻击 writes a capped hit count and resolveHit finishes', async () => {
  const malist = (await import('../../server/sim/content/kits/ops/chess_char_3_13-malist.js')).default;
  const chess = structuredClone(getData().chess.chess_char_3_13_a);
  chess.stats = { ...chess.stats, atk: 0 };
  setDesc(chess, chess.skill.skillId, `连续攻击${BOMB}次`);
  const skillAt = chess.skills.findIndex((s) => s.skillId === chess.skill.skillId);
  const problems = validateData(applyPatches(getData(), [
    { op: 'set', file: 'chess', id: 'chess_char_3_13_a', path: ['skill', 'desc'], value: `连续攻击${BOMB}次` },
    { op: 'set', file: 'chess', id: 'chess_char_3_13_a', path: ['skills', skillAt, 'desc'], value: `连续攻击${BOMB}次` },
    { op: 'set', file: 'chess', id: 'chess_char_3_13_a', path: ['stats', 'atk'], value: 0 },
  ]).data, { vanilla: getData() });
  assert.equal(problems.filter((p) => p.code === 'PLUGIN_DATA_BOUND' || p.code === 'PLUGIN_RECORD_SKILLS').length, 0, JSON.stringify(problems.slice(0, 3)));
  const kit = malist.chess_char_3_13_a({}, chess);
  const cap = dataBound(officialTextMax('chain-attack'));
  assert.equal(kit.skill.attack.hits, cap);
  assert.equal(kit.skill.attack.funnelBodyHits, cap);
  let hits = 0;
  const target = { id: 't', alive: true };
  const t0 = Date.now();
  resolveHit(
    { dealDamage() { hits++; return 0; }, rng: { chance: () => false } },
    { id: 'u', alive: true, s: { atk: 0, atkScaleMul: 1 } },
    { hits: cap, funnelBodyHits: cap, funnelMul: () => 1, dmgType: 'arts' },
    target,
    { index: 0, isSkill: true },
    0, 0,
  );
  assert.equal(hits, cap * 2);
  assert.equal(target.alive, true);
  assert.ok(Date.now() - t0 < 1000, `malist ${Date.now() - t0}ms`);
});

test('tiny positive step keys are PLUGIN_DATA_BOUND and the named loops still finish', async () => {
  const jedi = boundProblems({
    op: 'set', file: 'enemies', id: 'enemy_1328_cbjedi',
    path: ['talents', 'bb', 'unbalanced_bleed.interval'], value: 1e-18,
  });
  assert.equal(jedi.length, 1, JSON.stringify(jedi));
  assert.equal(jedi[0].code, 'PLUGIN_DATA_BOUND');
  assert.match(jedi[0].message, /低于最小步长/);
  const nastiIv = boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_4212_nasti', 'forms', '2/1/4/0', 'skills', 1, 'bb', 'attack@nasti_s2[update_shield].interval'],
    value: 1e-18,
  });
  assert.equal(nastiIv.length, 1);
  assert.match(nastiIv[0].message, /低于最小步长/);
  const duration = boundProblems({
    op: 'set', file: 'backups', id: 'units',
    path: ['char_4212_nasti', 'forms', '2/1/4/0', 'skills', 1, 'duration'], value: 1e9,
  });
  assert.equal(duration.length, 0, JSON.stringify(duration));
  for (const key of ['interval', 'cost']) {
    const hit = boundProblems({
      op: 'set', file: 'backups', id: 'units',
      path: ['char_362_saga', 'forms', '2/1/4/0', 'skills', 2, 'bb', key], value: 1e-18,
    });
    assert.equal(hit.length, 1, key);
    assert.match(hit[0].message, /低于最小步长/);
  }
  for (const key of ['closur_s_2[add_cost_period].cost', 'closur_s_2[add_cost_period].interval']) {
    const hit = boundProblems({
      op: 'set', file: 'backups', id: 'units',
      path: ['char_4228_closur', 'forms', '2/1/4/0', 'skills', 1, 'bb', key], value: 1e-18,
    });
    assert.equal(hit.length, 1, key);
    assert.match(hit[0].message, /低于最小步长/);
  }

  const { LEADER_KITS } = await import('../../server/sim/content/enemies/leaders.js');
  const bleed = LEADER_KITS.enemy_1328_cbjedi({ t: { 'unbalanced_bleed.damage': 400, 'unbalanced_bleed.interval': 1e-18 } });
  let bleedHits = 0;
  const tBleed = Date.now();
  bleed[0].tick({ time: 0, dealDamage() { bleedHits++; } }, { alive: true, unbalanceUntil: 10 }, {}, 1);
  assert.ok(bleedHits > 0 && bleedHits <= 8, `bleed ${bleedHits}`);
  assert.ok(Date.now() - tBleed < 1000, `jedi ${Date.now() - tBleed}ms`);

  const nasti = (await import('../../server/sim/content/kits/ops/op-nasti.js')).default;
  const nastiForm = structuredClone(getData().backups.units.char_4212_nasti.forms['2/1/4/0']);
  const kit = nasti.char_4212_nasti({}, nastiForm);
  const unit = { id: 'u', alive: true, deployed: true, mem: {}, s: { maxHp: 1000 } };
  let pulses = 0;
  unit.mem.nastiS2 = { n: 0, shield() { pulses++; this.n++; } };
  const tNasti = Date.now();
  kit.skills.skchr_nasti_2.onEnd({ battle: {}, unit, skill: { duration: 1e9 } });
  assert.equal(pulses, burstLimit(8));
  assert.ok(Date.now() - tNasti < 1000, `nasti ${Date.now() - tNasti}ms`);

  nastiForm.skills[1].bb['attack@nasti_s2[update_shield].interval'] = 1e-18;
  const tiny = nasti.char_4212_nasti({}, nastiForm);
  const unit2 = { id: 'u2', alive: true, deployed: true, mem: {}, s: { maxHp: 1000 } };
  let tinyPulses = 0;
  unit2.mem.nastiS2 = { n: 0, shield() { tinyPulses++; this.n++; } };
  const tTiny = Date.now();
  tiny.skills.skchr_nasti_2.onEnd({ battle: {}, unit: unit2, skill: { duration: 4 } });
  assert.ok(tinyPulses > 0 && tinyPulses <= burstLimit(8), `tiny nasti ${tinyPulses}`);
  assert.ok(Date.now() - tTiny < 1000, `nasti tiny ${Date.now() - tTiny}ms`);

  const sagaMod = (await import('../../server/sim/content/kits/ops/op-saga.js')).default;
  const sagaForm = structuredClone(getData().backups.units.char_362_saga.forms['2/1/4/0']);
  sagaForm.skills[2].bb.interval = 1e-18;
  sagaForm.skills[2].bb.cost = 1e-18;
  sagaForm.skills[2].bb.value = 1e6;
  const saga = sagaMod.char_362_saga({}, sagaForm);
  let dp = 0;
  const sagaUnit = { id: 's', ownerId: 'p', mem: { sagaDp: { acc: 0, got: 0 } } };
  const tSaga = Date.now();
  saga.skills.skchr_saga_3.onTick({ battle: { addDp(_o, n) { dp += n; } }, unit: sagaUnit, dt: 10 });
  assert.ok(dp > 0 && sagaUnit.mem.sagaDp.got <= 8, `saga got ${sagaUnit.mem.sagaDp.got}`);
  assert.ok(Date.now() - tSaga < 1000, `saga ${Date.now() - tSaga}ms`);

  const closurMod = (await import('../../server/sim/content/kits/ops/op-closur.js')).default;
  const closurForm = structuredClone(getData().backups.units.char_4228_closur.forms['2/1/4/0']);
  closurForm.skills[1].bb['closur_s_2[add_cost_period].cost'] = 1e-18;
  closurForm.skills[1].bb['closur_s_2[add_cost_period].interval'] = 1e-18;
  closurForm.skills[1].bb.cost_period = 1e6;
  const closur = closurMod.char_4228_closur({}, closurForm);
  let cdp = 0;
  const cUnit = { id: 'c', ownerId: 'p', alive: true, deployed: true, x: 0, y: 0, mem: {} };
  const cBattle = { allyUnits: [], addDp(_o, n) { cdp += n; }, addBuff() {}, fx() {}, time: 0 };
  closur.skills.skchr_closur_2.onStart({ battle: cBattle, unit: cUnit });
  const tClosur = Date.now();
  closur.skills.skchr_closur_2.onTick({ battle: cBattle, unit: cUnit, dt: 10 });
  assert.ok(cdp > 0 && cdp <= 8, `closur ${cdp}`);
  assert.ok(Date.now() - tClosur < 1000, `closur ${Date.now() - tClosur}ms`);
});

test('three times an official interval still validates, and the shared bounds snapshot raises the floor', () => {
  const base = getData();
  const d = structuredClone(base);
  const chess = d.chess.chess_char_6_12_a;
  const mul = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const v of node) mul(v); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'bb' && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [bk, bv] of Object.entries(v)) if (typeof bv === 'number' && Number.isFinite(bv)) v[bk] = bv * 3;
      } else mul(v);
    }
  };
  mul(chess);
  d.enemies.enemy_1328_cbjedi.talents.bb['unbalanced_bleed.interval'] *= 3;
  assert.equal(validateData(d, { vanilla: base }).filter((p) => p.code === 'PLUGIN_DATA_BOUND').length, 0);
  assert.equal(validateData(base, { vanilla: base }).filter((p) => p.code === 'PLUGIN_DATA_BOUND').length, 0);

  const snap = exportOfficialBounds(rememberOfficialBounds(base));
  forgetOfficialBounds();
  try {
    assert.equal(bbCap('times'), 64);
    installOfficialBounds(snap);
    assert.equal(bbCap('times'), dataBound(12));
    assert.equal(bbCap('times'), 120);
    assert.ok(80 < bbCap('times'));
  } finally {
    rememberOfficialBounds(base);
  }
  assert.equal(STEP_TICK, TICK);
});

test('every while in the sim and the match names its loop cap', () => {
  const missing = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      if (!name.endsWith('.js')) continue;
      const lines = fs.readFileSync(abs, 'utf8').split(/\n/);
      lines.forEach((line, i) => {
        const s = line.trim();
        if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
        if (!/\bwhile\s*\(/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
        if (!window.includes('loop-cap')) missing.push(`${path.relative(process.cwd(), abs)}:${i + 1}`);
      });
    }
  };
  walk('server/sim');
  walk('server/match');
  assert.deepEqual(missing, []);
});

test('a content selection ships the same vanilla bounds the engine installs', (t) => {
  const f = fixture(t);
  const vanilla = buildContentSet({ registry: f.registry });
  assert.equal(contentSetFiles(vanilla).has('bounds/official.json'), false);
  assert.equal(vanilla.bounds.v, 1);
  assert.equal(vanilla.bounds.bb.times, 12);
  f.put('data-demo', { data: ['patch.json'] }, { 'patch.json': bondPatch() });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  assert.equal(set.bounds.v, 1);
  assert.equal(set.bounds.bb.times, 12);
  const file = contentSetFiles(set).get('bounds/official.json');
  assert.ok(file);
  const parsed = JSON.parse(file.body.toString('utf8'));
  assert.equal(parsed.v, 1);
  assert.equal(parsed.bb.times, 12);
  assert.equal(set.index.bounds.official.sha256, file.sha256);
  forgetOfficialBounds();
  try {
    installOfficialBounds(parsed);
    assert.equal(bbCap('times'), 120);
  } finally {
    rememberOfficialBounds(getData());
  }
});

test('factions: the numbers the wave generator reads as counts and weights are bounded like a blackboard (integration note 11)', () => {
  const op = (id, p, value) => ({ op: 'set', file: 'factions', id, path: p, value });
  const g = getData().factions.generation;
  assert.deepEqual([g.maxLevelCnt, g.minReplacedEnemyCount, g.maxReplacedEnemyCount, g.typeSlots.FLY], [15, 1, 5, 3], 'the official numbers');
  // the official table and a creative one (3 × official) are clean
  assert.deepEqual(boundProblems(op('generation', ['maxLevelCnt'], 45)), []);
  assert.deepEqual(boundProblems(op('generation', ['maxReplacedEnemyCount'], 15)), []);
  // far past the rule: refused at the path that says so
  const cases = [
    [op('generation', ['maxLevelCnt'], 1e9), 'factions.generation.maxLevelCnt', 150],
    [op('generation', ['minReplacedEnemyCount'], 4e7), 'factions.generation.minReplacedEnemyCount', 50],
    [op('generation', ['typeSlots', 'FLY'], 1e6), 'factions.generation.typeSlots.FLY', 64],
    [op('types', ['FLY', 'count'], 1e9), 'factions.types.FLY.count', 64],
  ];
  for (const [o, where, cap] of cases) {
    const problems = boundProblems(o);
    assert.equal(problems.length, 1, `${where}: ${JSON.stringify(problems)}`);
    assert.match(problems[0].path, new RegExp(where.replace(/\./g, '\\.')));
    assert.match(problems[0].message, new RegExp(`上限 ${cap}`));
  }
  // the replaced counts stay within the generator's own clamp (PLUGIN_ACTION_UNITS): 51 is refused though 10 × 5 is 50
  // and the floor is 64 — what passes is what the generator plays
  assert.equal(boundProblems(op('generation', ['maxReplacedEnemyCount'], 51)).length, 1);
  assert.deepEqual(boundProblems(op('generation', ['maxReplacedEnemyCount'], 50)), []);
});

test('the wolf pack: its text counts are capped, and an attack on a target that takes no damage still returns (count-limit regression)', async () => {
  // the review's repro: 至多 1e16 只 on the pack's texts, 初始 1e16 只 on its owner's talents, every attack 0 — all of it passes
  // the data check; the pack used to read both with a raw regex and resolveHit looped 1e16 times on a target that never fell
  const { makeBattle } = await import('../helpers/battleHarness.js');
  const { resolveHit: hit } = await import('../../server/sim/ai.js');
  const { PLUGIN_TIMES_MAX } = await import('../../shared/plugins/limits.js');
  const base = getData();
  const tid = 'token_10028_vigil_wolf';
  const owner = Object.keys(base.chess).find((id) => id.includes('3_19') && id.endsWith('_a'));
  assert.ok(owner && base.tokens[tid], 'the pack and its owner exist');
  const paths = (node, re, at = [], out = []) => {
    if (typeof node === 'string') { if (re.test(node)) out.push({ at, text: node }); return out; }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) paths(v, re, at.concat(Array.isArray(node) ? Number(k) : k), out);
    return out;
  };
  const atks = (node, at = [], out = []) => {
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) {
      if (k === 'atk' && typeof v === 'number') out.push(at.concat(k));
      else atks(v, at.concat(Array.isArray(node) ? Number(k) : k), out);
    }
    return out;
  };
  const ops = [
    ...paths(base.tokens[tid], /至多\d+只/).map((h) => ({ op: 'set', file: 'tokens', id: tid, path: h.at, value: h.text.replace(/至多\d+只/, `至多${BOMB}只`) })),
    ...paths(base.chess[owner], /初始(两|二|\d+)只/).map((h) => ({ op: 'set', file: 'chess', id: owner, path: h.at, value: h.text.replace(/初始(两|二|\d+)只/, `初始${BOMB}只`) })),
    ...atks(base.tokens[tid]).map((p) => ({ op: 'set', file: 'tokens', id: tid, path: p, value: 0 })),
  ];
  assert.ok(ops.length >= 3, `${ops.length} writes`);
  const patched = applyPatches(base, ops);
  assert.deepEqual(patched.problems, []);
  assert.deepEqual(validateData(patched.data, { vanilla: base }).filter((p) => p.code === 'PLUGIN_DATA_BOUND'), [], 'text is not a number the check bounds: the engine caps it');
  const h = makeBattle({
    content: 'full', timeLimit: 5, autoFinish: false, enemies: [],
    logger: { error() {}, warn() {}, info() {}, log() {}, debug() {} },
    defs: { tokens: { [tid]: patched.data.tokens[tid] }, chess: { [owner]: patched.data.chess[owner] } },
    units: [{ chessId: owner, row: 10, col: 4, uid: 1 }, { kind: 'token', tokenId: tid, ownerUid: 1, row: 10, col: 5, uid: 2 }],
  });
  h.battle.start();
  const wolf = h.battle.allyUnits.find((u) => u.defId === tid);
  assert.ok(wolf && typeof wolf.profile?.hitsFn === 'function', 'the pack is on the field');
  const cap = dataBound(officialTextMax('at-most-pack'));
  assert.ok(wolf.mem.wolfCapacity <= cap && wolf.mem.shadows <= cap, `capacity ${wolf.mem.wolfCapacity}, shadows ${wolf.mem.shadows} ≤ ${cap}`);
  const foe = h.spawn('enemy_1000_gopro_2', { pos: [wolf.y, wolf.x] });
  const t0 = Date.now();
  hit(h.battle, wolf, wolf.profile, foe, { index: 0, attackId: 1 }, wolf.x, wolf.y);
  assert.ok(Date.now() - t0 < 1000, 'the attack returned');
  assert.ok(foe.alive, 'nothing hurt it (atk 0): only the cap ended the loop');
  assert.ok(PLUGIN_TIMES_MAX >= 64, 'the hit cap sits above the pack\'s');
});

test('the pick-one offer: its count stays within the slots an offer shows, in the game data and in the check (offer-limit regression)', async () => {
  const { GameData } = await import('../../server/match/gamedata.js');
  const { MAX_OFFER_SLOTS } = await import('../../server/match/player/common.js');
  const { PLUGIN_OFFER_SLOTS } = await import('../../shared/plugins/limits.js');
  assert.equal(PLUGIN_OFFER_SLOTS, MAX_OFFER_SLOTS, 'the check\'s cap is the game\'s');
  assert.equal(getData().config.economy.rewardOffer.count, 3, 'the official count');
  const op = (value) => ({ op: 'set', file: 'config', id: 'economy', path: ['rewardOffer', 'count'], value });
  assert.deepEqual(boundProblems(op(MAX_OFFER_SLOTS)), []);
  for (const bad of [1e9, MAX_OFFER_SLOTS + 1, 0, 2.5]) {
    const problems = boundProblems(op(bad));
    assert.equal(problems.length, 1, `${bad}: ${JSON.stringify(problems)}`);
    assert.equal(problems[0].path, 'config.economy.rewardOffer.count');
  }
  // a game data that was never checked (a direct GameData): the count is capped all the same — the 松果 and promotion loops
  // roll at most a few times the slots
  const data = applyPatches(getData(), [op(1e9)]).data;
  assert.equal(new GameData(data, 'mode_single_normal').rewardOffer().count, MAX_OFFER_SLOTS);
  assert.equal(new GameData(getData(), 'mode_single_normal').rewardOffer().count, 3);
});
