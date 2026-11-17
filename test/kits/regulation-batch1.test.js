// 规程·序列Ⅰ batch 1 kits: each skill's main blackboard effect, 渡桥's car, a 60s soak.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const DATA = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });
const ENEMY = 'enemy_1000_gopro_2';
const TOKEN = 'token_10037_mitm_trshrb';

function chessId(charId, elite = false) {
  const normal = Object.keys(DATA.chess).find((id) => {
    const rec = DATA.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  assert.ok(normal, charId);
  if (!elite) return normal;
  const golden = DATA.chess[normal].goldenId;
  assert.equal(DATA.chess[golden]?.charId, charId);
  return golden;
}

function chessOf(charId, elite = false) {
  return DATA.chess[chessId(charId, elite)];
}

function skillBb(charId, skillId, elite = false) {
  const s = chessOf(charId, elite).skills.find((x) => x.skillId === skillId);
  assert.ok(s, `${charId} ${skillId}`);
  return s.bb;
}

function close(actual, expected, eps, what) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= eps, `${what}: got ${actual}, expected ${expected}`);
}

function use(t) {
  setGameData(DATA);
  t.after(() => setGameData(null));
}

function field(t, specs, extra = {}) {
  use(t);
  const h = makeBattle({
    data: new DataSource(DATA),
    seed: extra.seed ?? 3,
    timeLimit: extra.timeLimit ?? 40,
    autoFinish: false,
    units: specs.map((s, i) => ({
      uid: s.uid ?? i + 1,
      chessId: chessId(s.charId, !!s.elite),
      row: s.row, col: s.col,
      skillIndex: s.skillIndex ?? null,
    })),
  });
  h.battle.start();
  for (const u of h.battle.allyUnits) {
    if (!u.alive) continue;
    u.atkCd = 1e9;
    if (u.skill && !(u.skill.active && u.skill.isTimed)) u.skill.setSpTotal(0);
  }
  return h;
}

function cast(u) {
  u.skill.setSpTotal(999);
  u.skill.activate('manual');
}

function foe(h, pos, mods = {}, extra = {}) {
  return h.spawn(ENEMY, {
    pos,
    mods: { defMul: 0, resMul: 0, speedMul: 0, hpMul: 40, atkMul: 0, ...mods },
    ...extra,
  });
}

function cars(h, owner) {
  return h.battle.allyUnits.filter((a) => a.alive && a.deployed && a.ownerUnit === owner && a.defId === TOKEN && !a.mem?.mitmWreck);
}

function wrecks(h, owner) {
  return h.battle.allyUnits.filter((a) => a.alive && a.ownerUnit === owner && a.mem?.mitmWreck);
}

function mergedBb(def) {
  const o = {};
  for (const t of def?.talents ?? []) if (t?.bb) Object.assign(o, t.bb);
  return o;
}

describe('regulation batch 1 kits', { concurrency: 1 }, () => {
  test('杰克 S1 hits once at atk_scale; S2 counters a physical dodge at attack@atk_scale', (t) => {
    const s1 = skillBb('char_347_jaksel', 'skchr_jaksel_1');
    const h = field(t, [{ charId: 'char_347_jaksel', row: 10, col: 5, skillIndex: 0 }]);
    const u = h.unit(1);
    assert.equal(u.skill.id, 'skchr_jaksel_1');
    const e = foe(h, [10, 6], { hpMul: 80 });
    h.step();
    const hp0 = e.hp;
    cast(u);
    assert.equal(u.skill.pending, true);
    u.atkCd = 0;
    h.step();
    close(hp0 - e.hp, u.s.atk * s1.atk_scale, 0.05, 'jaksel s1');

    const s2 = skillBb('char_347_jaksel', 'skchr_jaksel_2');
    const talent = chessOf('char_347_jaksel').talents[0].bb;
    const h2 = field(t, [{ charId: 'char_347_jaksel', row: 10, col: 5, skillIndex: 1 }]);
    const j = h2.unit(1);
    assert.equal(j.skill.id, 'skchr_jaksel_2');
    h2.battle.addBuff(j, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    cast(j);
    assert.equal(j.s.dodgePhys, 1);
    // A melee enemy only strikes the operator blocking it, so it has to walk onto him.
    const wolf = foe(h2, [10, 8], { hpMul: 80, atkMul: 1, speedMul: 1 });
    assert.ok(h2.runUntil(() => wolf.blockedBy === j, 8), 'wolf blocked');
    const before = wolf.hp;
    assert.ok(h2.runUntil(() => wolf.hp < before - 0.5, 8), 'counter landed');
    close(before - wolf.hp, j.s.atk * s2['attack@atk_scale'], 0.05, 'jaksel counter');
    const aspd = j.findBuff('jaksel:evadeAspd');
    assert.ok(aspd, 'evade aspd');
    assert.equal(aspd.mods.aspd, talent['charge_atk_speed_on_evade.attack_speed']);
    close(aspd.duration, talent['charge_atk_speed_on_evade.duration'], 1e-6, 'evade aspd duration');
  });

  test('霜叶 S1 slows; S2 raises ASPD and slows; elite talent widens range and attack interval', (t) => {
    const s1 = skillBb('char_193_frostl', 'skchr_frostl_1');
    const h = field(t, [{ charId: 'char_193_frostl', row: 10, col: 5, skillIndex: 0 }]);
    const u = h.unit(1);
    const e = foe(h, [10, 6], { hpMul: 80 });
    h.step();
    cast(u);
    u.atkCd = 0;
    assert.ok(h.runUntil(() => e.hp < e.s.maxHp - 0.5, 4), 'frostl s1 hit');
    u.atkCd = 1e9;
    e.base.moveSpeed = 1;
    e.markDirty();
    close(e.s.moveSpeed, 1 * (1 - Math.abs(s1.move_speed)), 1e-4, 'frostl s1 slow');
    assert.ok(e.findBuff('slow'));

    const s2 = skillBb('char_193_frostl', 'skchr_frostl_2');
    const h2 = field(t, [{ charId: 'char_193_frostl', row: 10, col: 5, skillIndex: 1 }]);
    const f = h2.unit(1);
    const e2 = foe(h2, [10, 6], { hpMul: 80 });
    h2.step();
    cast(f);
    assert.equal(f.s.aspd, f.base.aspd + s2.attack_speed);
    f.atkCd = 0;
    assert.ok(h2.runUntil(() => e2.hp < e2.s.maxHp - 0.5, 4), 'frostl s2 hit');
    f.atkCd = 1e9;
    e2.base.moveSpeed = 1;
    e2.markDirty();
    assert.ok(e2.s.moveSpeed <= 1 * (1 - Math.abs(s2.move_speed)) + 1e-4, `frostl s2 speed ${e2.s.moveSpeed}`);
    assert.ok(e2.findBuff('slow'));

    const elite = chessOf('char_193_frostl', true);
    const h3 = field(t, [{ charId: 'char_193_frostl', row: 10, col: 5, elite: true, skillIndex: 1 }]);
    const g = h3.unit(1);
    const grid = elite.talents[0].rangeGrid;
    assert.deepEqual(g.rangeGrid, grid);
    const add = elite.talents[0].bb.base_attack_time;
    close(g.s.interval, (g.base.bat + add) * 100 / g.s.aspd, 1e-6, 'frostl elite interval');
  });

  test('拜松 talent DEF, S1 def%, S2 self DEF/taunt and the ally aura', (t) => {
    const talent = chessOf('char_325_bison').talents[0].bb;
    const s1 = skillBb('char_325_bison', 'skcom_def_up[3]');
    const h = field(t, [
      { charId: 'char_347_jaksel', row: 10, col: 5, skillIndex: 0 },
      { charId: 'char_325_bison', row: 10, col: 6, skillIndex: 0 },
    ]);
    const ally = h.unit(1);
    const u = h.unit(2);
    close(u.s.def, u.base.def + talent.def, 0.05, 'bison self talent');
    h.step();
    close(ally.s.def, ally.base.def + talent.def, 0.05, 'bison behind');
    cast(u);
    close(u.s.def, (u.base.def + talent.def) * (1 + s1.def), 0.05, 'bison s1');

    const s2 = skillBb('char_325_bison', 'skchr_bison_2');
    const h2 = field(t, [
      { charId: 'char_347_jaksel', row: 10, col: 5, skillIndex: 0 },
      { charId: 'char_325_bison', row: 10, col: 6, skillIndex: 1 },
    ]);
    const ally2 = h2.unit(1);
    const b = h2.unit(2);
    h2.step();
    cast(b);
    close(b.s.def, (b.base.def + talent.def) * (1 + s2['bison_s_2[self].def']), 0.05, 'bison s2 self');
    assert.equal(b.s.taunt, s2['bison_s_2[self].taunt_level']);
    h2.run(0.6);
    close(ally2.s.def, (ally2.base.def + talent.def) * (1 + s2['bison_s_2[ally].def']), 0.05, 'bison s2 ally');
  });

  test('复奏 S2 strikes, splash radius 1.7 and the DoT; a cluster of 3 is boosted', (t) => {
    const s2 = skillBb('char_4031_liesel', 'skchr_liesel_2');
    const boost = chessOf('char_4031_liesel').talents[0].bb.damage_scale;
    const h = field(t, [{ charId: 'char_4031_liesel', row: 10, col: 5, skillIndex: 1 }]);
    const u = h.unit(1);
    const a = foe(h, [9, 5], { hpMul: 80 });
    const b = foe(h, [11, 7], { hpMul: 80 });
    h.step();
    cast(u);
    const one = u.s.atk * s2.atk_scale;
    close(a.s.maxHp - a.hp, one, 0.05, 'liesel far a');
    close(b.s.maxHp - b.hp, one, 0.05, 'liesel far b');
    const ha = a.hp;
    const hb = b.hp;
    u.atkCd = 1e9;
    h.run(1.15);
    const dot = u.s.atk * s2['liesel_s_2[dot].atk_scale'];
    close(ha - a.hp, dot, 0.05, 'liesel dot a');
    close(hb - b.hp, dot, 0.05, 'liesel dot b');

    const h2 = field(t, [{ charId: 'char_4031_liesel', row: 10, col: 5, skillIndex: 1 }]);
    const u2 = h2.unit(1);
    const c1 = foe(h2, [10, 6], { hpMul: 80 });
    const c2 = foe(h2, [10, 7], { hpMul: 80 });
    const c3 = foe(h2, [11, 7], { hpMul: 80 });
    const control = foe(h2, [9, 9], { hpMul: 20 });
    h2.step();
    cast(u2);
    const hit = u2.s.atk * s2.atk_scale * boost * 3;
    close(c1.s.maxHp - c1.hp, hit, 0.05, 'liesel cluster 1');
    close(c2.s.maxHp - c2.hp, hit, 0.05, 'liesel cluster 2');
    close(c3.s.maxHp - c3.hp, hit, 0.05, 'liesel cluster 3');
    assert.equal(control.hp, control.s.maxHp);
  });

  test('云迹 S1 takes off on deploy; S2 lifts, drops ground DEF, and 停顿 on a flyer', (t) => {
    const talent = chessOf('char_4165_ctrail').talents[0].bb;
    const s1 = skillBb('char_4165_ctrail', 'skchr_ctrail_1');
    const h = field(t, [{ charId: 'char_4165_ctrail', row: 10, col: 5, skillIndex: 0 }]);
    const u = h.unit(1);
    assert.equal(u.skill.id, 'skchr_ctrail_1');
    assert.equal(u.skill.active, true);
    assert.equal(!!u.s.flags.liftoff, true);
    assert.equal(!!u.s.flags.blockFly, true);
    assert.equal(u.findBuff('trait:skywalker'), null);
    assert.equal(u.profile.blockFly, false);
    close(u.s.atk, u.base.atk * (1 + s1.atk), 0.05, 'ctrail s1 atk');
    close(u.s.def, u.base.def, 0.05, 'ctrail s1 no ground def');
    u.skill.end('test');
    h.step();
    assert.equal(!!u.s.flags.liftoff, false);
    close(u.s.def, u.base.def * (1 + talent.def), 0.05, 'ctrail ground def');

    const s2 = skillBb('char_4165_ctrail', 'skchr_ctrail_2');
    const h2 = field(t, [{ charId: 'char_4165_ctrail', row: 10, col: 5, skillIndex: 1 }]);
    const c = h2.unit(1);
    assert.equal(!!c.s.flags.liftoff, false);
    assert.equal(c.findBuff('trait:skywalker'), null);
    close(c.s.def, c.base.def * (1 + talent.def), 0.05, 'ctrail s2 before');
    cast(c);
    assert.equal(!!c.s.flags.liftoff, true);
    assert.equal(!!c.s.flags.blockFly, true);
    h2.step();
    close(c.s.def, c.base.def, 0.05, 'ctrail s2 no ground def');
    const fly = foe(h2, [10, 6], { hpMul: 40 });
    fly.motion = 'FLY';
    h2.step();
    assert.equal(fly.isFlying, true);
    c.atkCd = 0;
    assert.ok(h2.runUntil(() => fly.findBuff('sluggish'), 4), 'sluggish');
    close(fly.findBuff('sluggish').duration ?? fly.findBuff('sluggish').timeLeft, s2['attack@sluggish'], 0.2, 'sluggish dur');
  });

  test('渡桥 fields the car, S1 pays DP and wrecks it, the car returns, and it leaves with her', (t) => {
    const s1 = skillBb('char_4147_mitm', 'skchr_mitm_1');
    const h = field(t, [{ charId: 'char_4147_mitm', row: 10, col: 5, skillIndex: 0 }], { timeLimit: 80 });
    const u = h.unit(1);
    assert.equal(h.battle.allyUnits.filter((a) => a.alive && a.defId === 'token_tactician_reinforce').length, 0);
    const car = cars(h, u)[0];
    assert.ok(car, 'car on deploy');
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dr, dc]) => [car.tileR + dr, car.tileC + dc])
      .find(([r, c]) => h.battle.grid.inRect(r, c) && !(r === u.tileR && c === u.tileC));
    assert.ok(spot, 'orthogonal tile');
    const e = foe(h, spot, { hpMul: 50 });
    h.step();
    const hp0 = e.hp;
    const dp0 = h.battle.players[0].dp;
    const deathR = car.tileR;
    const deathC = car.tileC;
    const carHp = car.base.maxHp;
    const trash = mergedBb(car.def);
    cast(u);
    close(h.battle.players[0].dp - dp0, s1.cost, 1e-6, 'mitm s1 dp');
    close(hp0 - e.hp, u.s.atk * s1.aoe_damage_scale, 0.05, 'mitm s1 blast');
    assert.equal(cars(h, u).length, 0);
    const ws = wrecks(h, u);
    assert.ok(ws.length >= 1, 'wrecks');
    for (const w of ws) {
      const dr = Math.abs(w.tileR - deathR);
      const dc = Math.abs(w.tileC - deathC);
      assert.equal(dr + dc, 1, 'wreck orthogonal');
      close(w.s.maxHp, Math.max(1, carHp * (1 + trash['trshrb_t_1[trash_born].max_hp'])), 0.05, 'wreck hp');
      assert.equal(w.s.blockCnt, Math.max(0, trash['trshrb_t_1[trash_born].block_cnt']));
    }
    const interval = Math.max(0.05, trash.interval > 0 ? trash.interval : 15);
    h.run(interval - 1);
    assert.equal(cars(h, u).length, 0, 'still waiting');
    h.run(2);
    assert.equal(cars(h, u).length, 1, 'car respawned');

    const s2 = skillBb('char_4147_mitm', 'skchr_mitm_2');
    const h2 = field(t, [{ charId: 'char_4147_mitm', row: 10, col: 5, skillIndex: 1 }]);
    const m = h2.unit(1);
    const car2 = cars(h2, m)[0];
    assert.ok(car2);
    const block0 = car2.s.blockCnt;
    cast(m);
    const talentBlock = mergedBb(car2.def).block_cnt || 0;
    close(car2.s.def, car2.base.def * (1 + s2['mitm_s_2[to_token].def']), 0.05, 'car s2 def');
    assert.equal(car2.s.blockCnt, block0 + (s2['mitm_s_2[to_token].block_cnt'] - talentBlock));
    assert.equal(car2.profile.noAttack, true);
    h2.battle.kill(m);
    assert.equal(cars(h2, m).length, 0);
    assert.equal(wrecks(h2, m).length, 0);
    h2.run(2);
    assert.equal(cars(h2, m).length, 0, 'no car while she is down');
    h2.battle.addDp(m.ownerId, 99);
    m.respawnAt = h2.battle.time;
    h2.step();
    assert.equal(m.alive && m.deployed, true);
    assert.equal(cars(h2, m).length, 1, 'fresh car');
    assert.equal(wrecks(h2, m).length, 0);
  });

  test('铸铁 S1 heals, S2 regenerates, elite talent pays ASPD and resist after times kills', (t) => {
    const s1 = skillBb('char_333_sidero', 'skcom_heal_self[3]');
    const h = field(t, [{ charId: 'char_333_sidero', row: 10, col: 5, skillIndex: 0 }]);
    const u = h.unit(1);
    u.hp = u.s.maxHp * 0.2;
    const before = u.hp;
    cast(u);
    close(u.hp - before, u.s.maxHp * s1.heal_scale, 0.05, 'sidero s1');

    const s2 = skillBb('char_333_sidero', 'skchr_sidero_2');
    const h2 = field(t, [{ charId: 'char_333_sidero', row: 10, col: 5, skillIndex: 1 }]);
    const s = h2.unit(1);
    cast(s);
    close(s.s.hpRegen, s.s.maxHp * s2.hp_recovery_per_sec_by_max_hp_ratio, 0.05, 'sidero hot');
    close(s.s.atk, s.base.atk * (1 + s2.atk), 0.05, 'sidero s2 atk');

    const talent = chessOf('char_333_sidero', true).talents[0].bb;
    const h3 = field(t, [{ charId: 'char_333_sidero', row: 10, col: 5, elite: true, skillIndex: 0 }]);
    const e = h3.unit(1);
    for (let i = 0; i < talent.times; i++) {
      const wolf = foe(h3, [10, 6], { hpMul: 1 });
      wolf.hp = 1;
      e.atkCd = 0;
      assert.ok(h3.runUntil(() => !wolf.alive, 5), `kill ${i}`);
      e.atkCd = 1e9;
    }
    assert.ok(e.findBuff('sidero:kills'));
    assert.equal(e.s.aspd, e.base.aspd + talent.attack_speed);
    assert.ok(e.findBuff('resist'));
  });

  test('乌啾 chain reaches four allies, S1 a fifth, S2 damages her and camouflages the burst', (t) => {
    const talent = chessOf('char_4224_turdus').talents[0].bb;
    const scale = talent['attack@chain.atk_scale_2'] ?? talent['chain.atk_scale_2'];
    const specs = [
      { charId: 'char_4224_turdus', row: 10, col: 5, skillIndex: 1 },
      { charId: 'char_347_jaksel', row: 10, col: 6, skillIndex: 0 },
      { charId: 'char_325_bison', row: 10, col: 7, skillIndex: 0 },
      { charId: 'char_193_frostl', row: 10, col: 8, skillIndex: 0 },
    ];
    const h = field(t, specs);
    const u = h.unit(1);
    const allies = [h.unit(2), h.unit(3), h.unit(4)];
    u.hp = u.s.maxHp * 0.1;
    allies[0].hp = allies[0].s.maxHp * 0.2;
    allies[1].hp = allies[1].s.maxHp * 0.4;
    allies[2].hp = allies[2].s.maxHp * 0.6;
    const heals = [];
    h.battle.on('heal', (ctx) => {
      if (ctx.source === u && !ctx.opts?.regen && !ctx.opts?.turdusHoT) heals.push(ctx.target.id);
    }, { priority: -100 });
    u.atkCd = 0;
    h.step();
    assert.equal(heals.length, 4, `talent chain ${heals.length}`);
    const base = u.s.atk * (u.profile.atkScale ?? 1) * (u.profile.healScale ?? 1) * u.s.atkScaleMul;
    close(u.hp - u.s.maxHp * 0.1, base * scale, 0.5, 'turdus self heal');

    const s1 = skillBb('char_4224_turdus', 'skchr_turdus_1');
    const h2 = field(t, [
      ...specs.map((s) => ({ ...s, skillIndex: s.charId === 'char_4224_turdus' ? 0 : s.skillIndex })),
      { charId: 'char_333_sidero', row: 10, col: 9, skillIndex: 0 },
    ]);
    const t1 = h2.unit(1);
    assert.equal(t1.skill.id, 'skchr_turdus_1');
    const line = [h2.unit(2), h2.unit(3), h2.unit(4), h2.unit(5)];
    t1.hp = t1.s.maxHp * 0.1;
    line.forEach((a, i) => { a.hp = a.s.maxHp * (0.2 + i * 0.2); });
    cast(t1);
    assert.equal(t1.s.aspd, t1.base.aspd + s1.attack_speed);
    const n = [];
    h2.battle.on('heal', (ctx) => {
      if (ctx.source === t1 && !ctx.opts?.regen && !ctx.opts?.turdusHoT) n.push(ctx.target.id);
    }, { priority: -100 });
    t1.atkCd = 0;
    h2.step();
    assert.equal(n.length, 5, `s1 chain ${n.length}`);

    const s2 = skillBb('char_4224_turdus', 'skchr_turdus_2');
    const h3 = field(t, [
      { charId: 'char_4224_turdus', row: 10, col: 5, skillIndex: 1 },
      { charId: 'char_347_jaksel', row: 10, col: 7, skillIndex: 0 },
    ]);
    const t2 = h3.unit(1);
    const pal = h3.unit(2);
    pal.hp = pal.s.maxHp * 0.1;
    const full = t2.hp;
    const hot = [];
    h3.battle.on('heal', (ctx) => {
      if (ctx.source === t2 && ctx.opts?.turdusHoT) hot.push(ctx.target.id);
    }, { priority: -100 });
    cast(t2);
    close(t2.hp, full * (1 - s2['turdus_s2[self_damage].hp_ratio']), 0.05, 'turdus s2 self damage');
    assert.ok(pal.findBuff('camou'), 'camouflage');
    h3.run(1.2);
    assert.ok(hot.includes(pal.id), 'hot tick');
  });

  test('奥尔佳 aura, S1 two hits, S2 prefers the highest-ATK elite and applies 停顿 and taunt', (t) => {
    const talent = chessOf('char_4245_alga').talents[0].bb;
    const s1 = skillBb('char_4245_alga', 'skchr_alga_1');
    const h = field(t, [
      { charId: 'char_4245_alga', row: 10, col: 5, skillIndex: 0 },
      { charId: 'char_347_jaksel', row: 10, col: 4, skillIndex: 0 },
    ]);
    const u = h.unit(1);
    const ally = h.unit(2);
    h.step();
    const aura = ally.findBuff('alga:aura');
    assert.ok(aura, 'aura');
    close(aura.mods.atkPct, talent['alga[atk_up].atk'], 1e-6, 'base aura');
    const e = foe(h, [10, 6], { hpMul: 80 });
    h.step();
    const hp0 = e.hp;
    cast(u);
    u.atkCd = 0;
    h.step();
    const mul = e.blockedBy === u ? 1 : (u.profile.unblockedScale ?? 1);
    close(hp0 - e.hp, u.s.atk * s1.atk_scale * mul * 2, 0.05, 'alga s1');

    const s2 = skillBb('char_4245_alga', 'skchr_alga_2');
    const h2 = field(t, [
      { charId: 'char_4245_alga', row: 10, col: 5, skillIndex: 1 },
      { charId: 'char_347_jaksel', row: 10, col: 4, skillIndex: 0 },
    ]);
    const a = h2.unit(1);
    const pal = h2.unit(2);
    const low = foe(h2, [10, 6], { hpMul: 80, atkMul: 0.2 }, { tag: 'boss' });
    const high = foe(h2, [10, 7], { hpMul: 80, atkMul: 5 }, { tag: 'boss' });
    h2.step();
    h2.run(0.6);
    close(pal.findBuff('alga:aura').mods.atkPct, talent['alga[atk_up].atk'] + talent['alga[check_enemy].atk'], 1e-6, 'check aura');
    cast(a);
    h2.run(0.6);
    const want = (talent['alga[atk_up].atk'] + talent['alga[check_enemy].atk']) * s2.talent_scale;
    close(pal.findBuff('alga:aura').mods.atkPct, want, 1e-6, 's2 aura');
    const lowHp = low.hp;
    const highHp = high.hp;
    a.atkCd = 0;
    h2.step();
    assert.ok(high.hp < highHp - 0.5, 'hit the higher-ATK elite');
    assert.equal(low.hp, lowHp);
    assert.ok(high.findBuff('sluggish'));
    assert.ok(high.findBuff('taunt'));
    close(high.findBuff('sluggish').duration ?? 0, s2['attack@debuff_duration'], 0.05, 'alga sluggish');
  });

  test('all nine fight for 60s without an exception', (t) => {
    const seats = [
      ['char_347_jaksel', 10, 4],
      ['char_193_frostl', 10, 5],
      ['char_325_bison', 10, 6],
      ['char_4031_liesel', 10, 7],
      ['char_4165_ctrail', 10, 8],
      ['char_4147_mitm', 11, 4],
      ['char_333_sidero', 11, 5],
      ['char_4224_turdus', 11, 6],
      ['char_4245_alga', 11, 7],
    ];
    const h = field(t, seats.map(([charId, row, col]) => ({ charId, row, col })), { timeLimit: 120 });
    foe(h, [9, 16], { hpMul: 200, atkMul: 0, speedMul: 0 });
    h.step();
    h.run(60);
    h.invariants();
    assert.equal(h.battle.errorCount, 0);
    assert.ok(h.battle.time >= 59, `time ${h.battle.time}`);
  });
});
