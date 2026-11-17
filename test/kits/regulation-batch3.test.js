// 规程·序列Ⅰ batch 3 kits. setGameData(REG) before makeBattle: registeredKit calls officialKitKey
// without a data argument, and isVersionData reads the loaded game data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { moduleBb, num, skillBbOf, skillRec, talentBb, traitBb } from '../../server/sim/content/kits/shared/tier1.js';
import { descOf } from '../../server/sim/content/kits/shared/version.js';
import { textCount } from '../../shared/plugins/textNumber.js';
import { chessRec, enemyRec, makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const RAW = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });
const ALLY = 'chess_b3_ally';
const DATA = new DataSource({
  ...RAW,
  chess: {
    ...RAW.chess,
    [ALLY]: chessRec({
      id: ALLY, charId: 'char_b3_ally', profession: 'WARRIOR', position: 'MELEE',
      rangeGrid: [[0, 0]], skill: null, stats: { atk: 1, maxHp: 5000, def: 0, blockCnt: 0, bat: 5 },
    }),
  },
  enemies: {
    ...RAW.enemies,
    enemy_b3: enemyRec({ key: 'enemy_b3', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }),
    enemy_b3_low: enemyRec({ key: 'enemy_b3_low', hp: 1, atk: 0, def: 0, res: 0, speed: 0 }),
    enemy_b3b: enemyRec({ key: 'enemy_b3b', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0 }),
    enemy_b3b_low: enemyRec({ key: 'enemy_b3b_low', hp: 1, atk: 0, def: 0, res: 0, speed: 0 }),
    enemy_b3_fly: enemyRec({ key: 'enemy_b3_fly', hp: 1e9, atk: 0, def: 0, res: 0, speed: 0, motion: 'FLY' }),
  },
});

function use(t) {
  setGameData(RAW);
  t.after(() => setGameData(null));
}

function chessId(charId, elite = false) {
  const normal = Object.keys(RAW.chess).find((id) => {
    const rec = RAW.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  if (!normal) return null;
  if (!elite) return normal;
  const golden = RAW.chess[normal].goldenId;
  return RAW.chess[golden]?.charId === charId ? golden : null;
}

function chess(charId, elite = false) {
  const id = chessId(charId, elite);
  assert.ok(id, `${charId} ${elite ? 'elite' : 'normal'}`);
  return RAW.chess[id];
}

function close(a, b) {
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
}

function op(uid, charId, row, col, { elite = false, skillId = null, sp = 999 } = {}) {
  const id = chessId(charId, elite);
  assert.ok(id, charId);
  const unit = { uid, chessId: id, row, col, carryState: { sp } };
  if (skillId) {
    const index = (RAW.chess[id].skills || []).findIndex((s) => s.skillId === skillId);
    assert.ok(index >= 0, `${charId} ${skillId}`);
    unit.skillIndex = index;
  }
  return unit;
}

function foe(key, row, col) {
  return { key, time: 0, pos: [row, col] };
}

function fight(t, { units, enemies, timeLimit = 20, seed = 1 }) {
  use(t);
  const outs = [];
  const heals = [];
  const h = makeBattle({
    data: DATA, seed, timeLimit, autoFinish: false, units, enemies,
    setup(b) {
      b.on('damageOutput', (c) => {
        outs.push({
          source: c.source, target: c.target, amount: c.amount,
          type: c.dmg && c.dmg.type, tags: c.dmg && c.dmg.tags ? c.dmg.tags.slice() : [],
          isAttack: !!(c.dmg && c.dmg.isAttack), t: b.time,
        });
      });
      b.on('heal', (c) => {
        heals.push({
          source: c.source, target: c.target, amount: c.amount,
          regen: !!(c.opts && c.opts.regen), t: b.time,
        });
      });
    },
  });
  return { h, outs, heals };
}

function noErrors(h) {
  const e = h.battle.errors[0];
  assert.equal(h.battle.errors.length, 0, e ? `${e.label}: ${e.message}` : '');
}

function of(outs, source, pred = () => true) {
  return outs.filter((o) => o.source === source && pred(o));
}

const R = 10;
const C = 5;

test('慕斯: double hit, S1 atk debuff, S2 atk/def, elite ASPD only while blocking nobody', (t) => {
  const id = 'char_185_frncat';
  const s1 = skillBbOf(chess(id), 'skchr_frncat_1');
  const s2 = skillBbOf(chess(id), 'skchr_frncat_2');
  const eliteTrait = traitBb(chess(id, true));
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { skillId: 'skchr_frncat_1', sp: 0 })], enemies: [] });
    h.battle.rng.chance = () => true;
    h.step(1);
    const u = h.unit(1);
    assert.equal(u.profile.hitsFn(h.battle), 2);
    h.battle.rng.chance = () => false;
    assert.equal(u.profile.hitsFn(h.battle), 1);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_frncat_1' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    h.battle.rng.chance = () => false;
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 1, 3));
    const e = h.enemy('enemy_b3');
    const deb = e.findBuff('frncat:s1');
    assert.ok(deb, 'S1 debuff');
    close(deb.mods.atkPct, num(s1['frncat_s_1[debuff].atk']));
    assert.equal(e.blockedBy, null);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_frncat_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    close(u.s.atk, u.base.atk * (1 + num(s2.atk)));
    close(u.s.def, u.base.def * (1 + num(s2.def)));
    noErrors(h);
  }
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { elite: true, sp: 0 })], enemies: [] });
    h.step(1);
    const open = h.unit(1).findBuff('frncat:open');
    assert.ok(open, 'unblocked elite ASPD');
    close(open.mods.aspd, num(eliteTrait.attack_speed));
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3', R, C)],
    });
    h.step(2);
    const u = h.unit(1);
    assert.ok(u.blocking.length > 0);
    assert.equal(u.findBuff('frncat:open'), null);
    noErrors(h);
  }
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { sp: 0 })], enemies: [] });
    h.step(1);
    assert.equal(h.unit(1).findBuff('frncat:open'), null);
    noErrors(h);
  }
});

test('灰喉: crit multiplies fly scale, wind ASPD, ground ASPD, S1 and S2 shot counts', (t) => {
  const id = 'char_367_swllow';
  const normalT = talentBb(chess(id), 0);
  const eliteT = talentBb(chess(id, true), 0);
  const ground = num(moduleBb(chess(id, true)).attack_speed);
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { sp: 0 })], enemies: [foe('enemy_b3', R, C + 1)] });
    h.battle.rng.chance = () => true;
    h.step(1);
    const u = h.unit(1);
    assert.equal(num(normalT.prob), 0);
    assert.equal(u.profile.dmgMul(h.battle, u, { isFlying: false }), 1);
    const wind = u.findBuff('swllow:wind');
    assert.ok(wind);
    close(wind.mods.aspd, num(normalT.attack_speed));
    noErrors(h);
  }
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { elite: true, sp: 0 })], enemies: [] });
    h.step(1);
    const u = h.unit(1);
    const crit = num(eliteT.atk_scale, 1);
    h.battle.rng.chance = () => true;
    assert.equal(u.profile.dmgMul(h.battle, u, { isFlying: false }), crit);
    u.profile.flyScale = 2;
    assert.equal(u.profile.dmgMul(h.battle, u, { isFlying: true }), 2 * crit);
    h.battle.rng.chance = () => false;
    assert.equal(u.profile.dmgMul(h.battle, u, { isFlying: true }), 2);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    h.run(0.15);
    const buff = h.unit(1).findBuff('swllow:ground');
    assert.ok(buff, 'ground enemy');
    assert.ok(ground > 0);
    close(buff.mods.aspd, ground);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3_fly', R, C + 1)],
    });
    h.run(0.3);
    assert.equal(h.enemy('enemy_b3_fly').isFlying, true);
    assert.equal(h.unit(1).findBuff('swllow:ground'), null);
    noErrors(h);
  }
  {
    const s1 = skillRec(chess(id), 'skchr_swllow_1');
    const scale = num(skillBbOf(chess(id), 'skchr_swllow_1').atk_scale, 1);
    const hits = textCount(descOf(s1), /连续射击(\d+)次/, 2, 'swllow-s1');
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_swllow_1' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u).length >= hits, 3));
    assert.equal(u.stats.attacks, 1);
    for (const hit of of(outs, u).slice(0, hits)) close(hit.amount, u.base.atk * scale);
    noErrors(h);
  }
  {
    const s2 = skillRec(chess(id), 'skchr_swllow_2');
    const hits = textCount(descOf(s2), /(\d+)连射/, 3, 'swllow-s2');
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_swllow_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u).length >= hits, 3));
    assert.equal(u.stats.attacks, 1);
    for (const hit of of(outs, u).slice(0, hits)) close(hit.amount, u.s.atk);
    close(u.s.atk, u.base.atk * (1 + num(s2.bb.atk)));
    noErrors(h);
  }
});

test('奥斯塔: S1 stats, S2 bind on blocked and unblocked, bleed ignores the front scale', (t) => {
  const id = 'char_346_aosta';
  const s1 = skillBbOf(chess(id), 'skcom_quickattack[3]');
  const s2 = skillBbOf(chess(id), 'skchr_aosta_2');
  const talent = talentBb(chess(id), 0);
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skcom_quickattack[3]' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    close(u.s.atk, u.base.atk * (1 + num(s1.atk)));
    close(u.s.aspd, 100 + num(s1.attack_speed));
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_aosta_2' })],
      enemies: [foe('enemy_b3', R, C), foe('enemy_b3b', R, C + 1)],
      timeLimit: 8,
    });
    h.run(2.5);
    const u = h.unit(1);
    const blocked = h.enemy('enemy_b3');
    const front = h.enemy('enemy_b3b');
    assert.ok(blocked.blockedBy === u);
    assert.equal(front.blockedBy, null);
    const binds = h.hooksOf('statusApplied').filter((s) => s.status === 'bind' && s.source === u);
    assert.ok(binds.some((s) => s.target === blocked));
    assert.ok(binds.some((s) => s.target === front));
    close(binds[0].duration, num(s2['attack@frozen_duration']));
    const bleedBlocked = of(outs, u, (o) => o.target === blocked && o.tags.includes('aosta:bleed'));
    const bleedFront = of(outs, u, (o) => o.target === front && o.tags.includes('aosta:bleed'));
    assert.equal(bleedBlocked.length, 0);
    assert.ok(bleedFront.length >= 1);
    close(bleedFront[0].amount, u.s.atk * num(talent.atk_scale) * num(s2.talent_scale, 1));
    const shot = of(outs, u, (o) => o.target === front && o.isAttack && !o.tags.includes('aosta:bleed'));
    assert.ok(shot.length >= 1);
    close(shot[0].amount, u.s.atk * u.profile.frontScale);
    assert.ok(Math.abs(bleedFront[0].amount - shot[0].amount) > 1);
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      enemies: [foe('enemy_b3b', R, C + 1)],
      timeLimit: 8,
    });
    h.run(2.5);
    const u = h.unit(1);
    assert.equal(u.skill.active, false);
    const front = h.enemy('enemy_b3b');
    const bleed = of(outs, u, (o) => o.tags.includes('aosta:bleed'));
    const shot = of(outs, u, (o) => o.target === front && o.isAttack && !o.tags.includes('aosta:bleed'));
    assert.ok(bleed.length >= 1 && shot.length >= 1);
    close(bleed[0].amount, u.s.atk * num(talent.atk_scale));
    close(shot[0].amount, u.s.atk * u.profile.frontScale);
    noErrors(h);
  }
});

test('Miss.Christine: feast on a burst, spirit pulses, and a knock-out stops the spirit', (t) => {
  const id = 'char_4198_christ';
  const s1 = skillBbOf(chess(id), 'skchr_christ_1');
  const s2 = skillBbOf(chess(id), 'skchr_christ_2');
  function burst(h, u) {
    h.step(1);
    const e = h.enemy('enemy_b3');
    e.elem.neural = e.gaugeMax - 1;
    h.battle.dealElementDamage({ source: u, target: e, amount: 5, element: 'neural' });
    return e;
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    burst(h, u);
    const feast = of(outs, u, (o) => o.tags.includes('christ:feast'));
    assert.equal(feast.length, 1);
    close(feast[0].amount, u.s.atk * num(talentBb(chess(id), 0).atk_scale));
    close(u.s.atk, u.base.atk);
    noErrors(h);
  }
  {
    const scale = num(talentBb(chess(id, true), 0).atk_scale);
    const amp = num(traitBb(chess(id, true)).damage_scale);
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    const e = burst(h, u);
    assert.ok(e.s.flags.burstLock);
    const feast = of(outs, u, (o) => o.tags.includes('christ:feast'));
    assert.equal(feast.length, 1);
    close(feast[0].amount, u.s.atk * scale * amp);
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_christ_1' })],
      enemies: [foe('enemy_b3', R, C + 1), foe('enemy_b3b', R, C + 2)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    close(u.s.atk, u.base.atk * (1 + num(s1.atk)));
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.isAttack).length >= 2, 3));
    const ratio = num(s1['attack@ep_damage_ratio']);
    for (const hit of of(outs, u, (o) => o.isAttack).slice(0, 2)) {
      close(hit.target.elem.neural, hit.amount * ratio);
    }
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_christ_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.tags.includes('christ:spirit')).length >= 1, 3));
    assert.equal(u.stats.attacks, 0);
    const spirit = of(outs, u, (o) => o.tags.includes('christ:spirit'));
    close(spirit[0].amount, u.s.atk * num(s2.atk_scale));
    const e = h.enemy('enemy_b3');
    e.elem.neural = e.gaugeMax - 1;
    h.battle.dealElementDamage({ source: u, target: e, amount: 5, element: 'neural' });
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.tags.includes('christ:spirit:ep')).length >= 1, 3));
    close(of(outs, u, (o) => o.tags.includes('christ:spirit:ep'))[0].amount, u.s.atk * num(s2.atk_scale_ep));
    assert.equal(u.stats.attacks, 0);
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_christ_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.tags.includes('christ:spirit')).length >= 1, 3));
    const n = of(outs, u, (o) => o.tags.includes('christ:spirit')).length;
    h.battle.kill(u);
    h.run(2);
    assert.equal(of(outs, u, (o) => o.tags.includes('christ:spirit')).length, n);
    assert.equal(u.stats.attacks, 0);
    noErrors(h);
  }
});

test('星极: ASPD stack after one interval, elite fragile on a blocked enemy, S2 hits both', (t) => {
  const id = 'char_274_astesi';
  const s1 = skillBbOf(chess(id), 'skchr_astesi_1');
  const t0 = talentBb(chess(id), 0);
  {
    const { h } = fight(t, { units: [op(1, id, R, C, { sp: 0 })], enemies: [], timeLimit: 25 });
    h.run(19.5);
    const u = h.unit(1);
    assert.equal(u.mem.astesiN || 0, 0);
    h.run(1);
    assert.equal(u.mem.astesiN, 1);
    close(u.findBuff('astesi:sky').mods.aspd, num(t0.attack_speed));
    noErrors(h);
  }
  {
    const scale = num(traitBb(chess(id, true)).damage_scale);
    const { h } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3', R, C)],
    });
    h.run(0.25);
    const applied = h.hooksOf('statusApplied').filter((s) => s.status === 'artsFragile' && s.source === h.unit(1));
    assert.ok(applied.length >= 1);
    close(applied[0].value, scale - 1);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      enemies: [foe('enemy_b3', R, C)],
    });
    h.run(0.5);
    assert.equal(h.hooksOf('statusApplied').filter((s) => s.status === 'artsFragile').length, 0);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_astesi_1' })],
      enemies: [foe('enemy_b3', R, C + 1)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    close(u.s.atk, u.base.atk * (1 + num(s1.atk)));
    close(u.s.def, u.base.def * (1 + num(s1.def)));
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_astesi_2' })],
      enemies: [foe('enemy_b3', R, C), foe('enemy_b3b', R, C)],
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u).length >= 2, 3));
    const targets = new Set(of(outs, u).slice(0, 2).map((o) => o.target));
    assert.equal(targets.size, 2);
    assert.ok(u.skill.active);
    close(u.s.blockCnt, u.base.blockCnt + num(skillBbOf(chess(id), 'skchr_astesi_2').block_cnt));
    noErrors(h);
  }
});

test('海沫: element heal is capped by block, S2 heals a kill in range, and a knock-out does not', (t) => {
  const id = 'char_4066_highmo';
  const healN = num(talentBb(chess(id), 0).value);
  const s1 = skillRec(chess(id), 'skchr_highmo_1');
  const hits = textCount(descOf(s1), /连续攻击(两|\d+)次/, 2, 'highmo-s1');
  const s2 = skillBbOf(chess(id), 'skchr_highmo_2');
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_highmo_1' })],
      enemies: [foe('enemy_b3', R, C + 1), foe('enemy_b3', R + 1, C + 1), foe('enemy_b3', R - 1, C + 1)],
    });
    const u = h.unit(1);
    h.battle.on('skillStart', (c) => { if (c.unit === u) u.elem.neural = u.gaugeMax; });
    assert.ok(h.runUntil(() => u.stats.attacks >= 1, 3));
    const mine = of(outs, u, (o) => o.isAttack);
    assert.ok(mine.length > u.s.blockCnt);
    assert.equal(mine.length, hits * 3);
    close(u.elem.neural, u.gaugeMax - healN * u.s.blockCnt);
    noErrors(h);
  }
  {
    const { h, heals } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_highmo_2' })],
      enemies: [foe('enemy_b3_low', R, C + 1)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => heals.some((x) => x.target === u && !x.regen && Math.abs(x.amount - u.s.maxHp * num(s2.hp_ratio)) < 1e-4), 3));
    assert.ok(u.skill.active);
    close(u.s.dodgePhys, num(s2.prob));
    close(u.s.atk, u.base.atk * (1 + num(s2.atk)));
    noErrors(h);
  }
  {
    const { h, heals } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_highmo_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    h.battle.kill(u);
    const n = heals.length;
    h.battle.kill(h.enemy('enemy_b3'), u);
    h.step(1);
    assert.equal(heals.length, n);
    noErrors(h);
  }
});

test('水灯心: dodge count, S1 bounces then a catch, S2 cuts, module, knock-out drops the boomerang', (t) => {
  const id = 'char_4177_brigid';
  const talent = talentBb(chess(id), 0);
  const need = Math.floor(num(talent.trigger_damage_count));
  const prob = num(talent.prob);
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      enemies: [foe('enemy_b3', R, C - 3)],
    });
    h.step(1);
    const u = h.unit(1);
    const e = h.enemy('enemy_b3');
    assert.equal(u.stats.attacks, 0);
    for (let i = 0; i < need - 1; i++) h.battle.dealDamage({ source: u, target: e, amount: 1, type: 'phys', isAttack: true });
    h.battle.dealElementDamage({ source: u, target: e, amount: 5, element: 'neural' });
    assert.equal(u.findBuff('brigid:dodge'), null);
    h.battle.dealDamage({ source: u, target: e, amount: 1, type: 'phys', isAttack: true });
    close(u.s.dodgePhys, prob);
    h.battle.emit('deploy', { unit: u });
    assert.equal(u.findBuff('brigid:dodge'), null);
    assert.equal(u.mem.brigidHits, 0);
    h.battle.dealDamage({ source: u, target: e, amount: 1, type: 'phys', isAttack: true });
    assert.equal(u.findBuff('brigid:dodge'), null);
    noErrors(h);
  }
  {
    const s1 = skillBbOf(chess(id), 'skchr_brigid_1');
    const times = Math.floor(num(s1.times));
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_brigid_1' })],
      enemies: [foe('enemy_b3', R, C + 1), foe('enemy_b3b', R, C + 2)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 1, 3));
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.isAttack).length >= 1 + times, 3));
    assert.equal(u.stats.attacks, 1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 2, 5));
    noErrors(h);
  }
  {
    const s2 = skillBbOf(chess(id), 'skchr_brigid_2');
    const cuts = Math.round(num(s2['attack@cut_duration']) / num(s2['attack@interval']));
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_brigid_2' })],
      enemies: [foe('enemy_b3', R, C + 2)],
      timeLimit: 8,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.tags.includes('brigid:cut')).length >= cuts, 5));
    assert.equal(u.stats.attacks, 1);
    for (const cut of of(outs, u, (o) => o.tags.includes('brigid:cut')).slice(0, cuts)) {
      close(cut.amount, u.s.atk * num(s2['attack@cut_scale'], 1));
      assert.equal(cut.type, 'phys');
    }
    const slow = h.hooksOf('statusApplied').filter((s) => s.status === 'sluggish' && s.source === u);
    assert.equal(slow.length, 1);
    close(slow[0].duration, num(s2['attack@sluggish']));
    noErrors(h);
  }
  {
    const scale = num(traitBb(chess(id, true)).atk_scale);
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { elite: true, sp: 0 })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 5,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.isAttack).length >= 1, 3));
    assert.equal(u.skill.activations, 0);
    close(of(outs, u, (o) => o.isAttack)[0].amount, u.s.atk * scale);
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 5,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.isAttack).length >= 1, 3));
    close(of(outs, u, (o) => o.isAttack)[0].amount, u.s.atk);
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_brigid_2' })],
      enemies: [foe('enemy_b3', R, C + 2)],
      timeLimit: 5,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 1, 3));
    h.battle.kill(u);
    h.run(2);
    assert.equal(of(outs, u, (o) => o.tags.includes('brigid:cut')).length, 0);
    noErrors(h);
  }
});

test('吉星: unique enemies, S1 stack lands with the arrow, S2 cycles one control per attack', (t) => {
  const id = 'char_4203_kichi';
  const talent = talentBb(chess(id), 0);
  const scale = num(talent.damage_scale);
  const s1 = skillBbOf(chess(id), 'skchr_kichi_1');
  const s2 = skillBbOf(chess(id), 'skchr_kichi_2');
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { sp: 0 })],
      // [0,−1] and [−1,−1] are outside the reaperrange grid, so these two never take her attack.
      enemies: [foe('enemy_b3', R, C + 1), foe('enemy_b3b', R, C - 1), foe('enemy_b3b', R - 1, C - 1)],
      timeLimit: 12,
    });
    h.step(1); // enemies enter battle.units on the first step
    const u = h.unit(1);
    const live = h.enemy('enemy_b3');
    const extras = h.battle.units.filter((e) => e.defId === 'enemy_b3b');
    assert.ok(live);
    assert.equal(extras.length, 2);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.target === live && o.isAttack).length >= 1, 5));
    const first = of(outs, u, (o) => o.target === live && o.isAttack)[0].amount;
    h.battle.kill(extras[0], u);
    close(u.findBuff('kichi:luck').mods.dmgDealtMul, 1 + scale);
    h.battle.kill(extras[1], u);
    close(u.findBuff('kichi:luck').mods.dmgDealtMul, 1 + scale);
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.target === live && o.isAttack).length >= 2, 8));
    const second = of(outs, u, (o) => o.target === live && o.isAttack)[1].amount;
    close(second / first, 1 + scale);
    noErrors(h);
  }
  {
    const cap = Math.floor(num(s1.max_stack_cnt));
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_kichi_1' })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 45,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 1, 3));
    assert.equal(of(outs, u).length, 0);
    close(u.findBuff('kichi:s1atk').mods.atkPct, num(s1.atk));
    assert.ok(h.runUntil(() => of(outs, u, (o) => o.isAttack).length >= 1, 3));
    close(of(outs, u, (o) => o.isAttack)[0].amount, u.s.atk * u.profile.frontScale);
    assert.ok(h.runUntil(() => (u.mem.kichiS1 || 0) >= cap, 20));
    close(u.findBuff('kichi:s1atk').mods.atkPct, num(s1.atk) * cap);
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    assert.equal(u.findBuff('kichi:s1atk'), null);
    noErrors(h);
  }
  {
    const { h } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_kichi_2' })],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 20,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.stats.attacks >= 3, 15));
    const order = h.hooksOf('statusApplied').filter((s) => s.source === u).map((s) => s.status);
    assert.deepEqual(order.slice(0, 3), ['sluggish', 'bind', 'stun']);
    close(h.hooksOf('statusApplied').find((s) => s.status === 'sluggish').duration, num(s2['attack@sluggish']));
    close(h.hooksOf('statusApplied').find((s) => s.status === 'bind').duration, num(s2['attack@unmoveable']));
    close(h.hooksOf('statusApplied').find((s) => s.status === 'stun').duration, num(s2['attack@stun']));
    noErrors(h);
  }
});

test('阿米娅（医疗）: aura, S1 grid heal, S2 volley then two true-damage targets, once per battle', (t) => {
  const id = 'char_1037_amiya3';
  const t0 = talentBb(chess(id), 0);
  const s1 = skillBbOf(chess(id), 'skchr_amiya3_1');
  const s2 = skillBbOf(chess(id), 'skchr_amiya3_2');
  {
    const { h, heals } = fight(t, {
      units: [
        op(1, id, R, C, { skillId: 'skchr_amiya3_1' }),
        { uid: 2, chessId: ALLY, row: R, col: C - 2 },
      ],
      enemies: [foe('enemy_b3', R, C + 1)],
      timeLimit: 8,
    });
    h.step(1);
    const u = h.unit(1);
    const ally = h.unit(2);
    close(u.s.maxHp, u.base.maxHp * (1 + num(t0.max_hp)));
    assert.ok(h.runUntil(() => heals.some((x) => x.source === u && x.target === ally && !x.regen), 4));
    const heal = heals.find((x) => x.source === u && x.target === ally && !x.regen);
    close(heal.amount, u.s.atk * num(s1.heal_scale));
    // hpRegenRatio is the 生命回复速度 stat. status.js only calls heal({ regen }) while hp is below max.
    assert.ok(h.runUntil(() => u.skill?.active && u.s.hpRegen > 0, 2));
    close(u.s.hpRegen, u.s.maxHp * num(t0.hp_recovery_per_sec_by_max_hp_ratio));
    u.hp = u.s.maxHp - 50;
    assert.ok(h.runUntil(() => heals.some((x) => x.target === u && x.regen), 2));
    noErrors(h);
  }
  {
    const { h, outs } = fight(t, {
      units: [op(1, id, R, C, { skillId: 'skchr_amiya3_2' })],
      enemies: [foe('enemy_b3', R, C + 1), foe('enemy_b3b', R, C + 2), foe('enemy_b3', R + 1, C + 1)],
      timeLimit: 70,
    });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.activations >= 1, 3));
    assert.equal(of(outs, u, (o) => o.type === 'true').length, 0);
    const open = of(outs, u, (o) => o.tags.includes('amiya3:open'));
    assert.equal(open.length, 3);
    const scale = num(s2.atk_scale, 1);
    for (const hit of open) close(hit.amount, u.base.atk * scale);
    const stacks = Math.min(Math.floor(num(s2.max_stack_cnt)), open.length);
    close(u.findBuff('amiya3:s2atk').mods.atkPct, num(s2.atk) * stacks);
    assert.ok(open[0].target.findBuff('amiya3:s2'));
    close(open[0].target.findBuff('amiya3:s2').mods.aspd, num(s2['amiya3_s_2[debuff].attack_speed']));
    const slow = h.hooksOf('statusApplied').find((s) => s.status === 'slow' && s.source === u);
    assert.ok(slow);
    close(slow.value, Math.abs(num(s2['amiya3_s_2[debuff].move_speed'])));
    h.run(0.5);
    const truth = of(outs, u, (o) => o.type === 'true');
    assert.ok(truth.length >= 1);
    assert.ok(new Set(truth.map((o) => o.target)).size <= 2);
    h.run(64);
    assert.equal(u.skill.activations, 1);
    assert.equal(u.skill.sp, 0);
    assert.equal(u.skill.active, false);
    noErrors(h);
  }
});

test('batch 3 default skills fight for 60s without a handler error', (t) => {
  const cast = [
    ['char_185_frncat', 10, 3],
    ['char_274_astesi', 10, 5],
    ['char_4066_highmo', 10, 7],
    ['char_367_swllow', 9, 3],
    ['char_346_aosta', 9, 5],
    ['char_4198_christ', 9, 7],
    ['char_4177_brigid', 11, 3],
    ['char_4203_kichi', 11, 5],
    ['char_1037_amiya3', 11, 7],
  ];
  const { h } = fight(t, {
    units: cast.map(([charId, row, col], i) => op(i + 1, charId, row, col)),
    enemies: cast.map(([, row, col]) => foe('enemy_b3', row, col + 1)),
    timeLimit: 60,
  });
  h.run(60);
  noErrors(h);
  for (let i = 1; i <= cast.length; i++) assert.ok(h.unit(i));
});
