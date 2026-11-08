// 规程·序列Ⅰ batch 4 kits: each skill's main effect at the built blackboard, summons leave with
// the owner, and a 60s field does not throw. Numbers are the normal (_a) blackboards unless a test says elite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { KITS } from '../../server/sim/content/index.js';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: { warn() {}, error() {}, info() {} } });
const DOG = 'enemy_1000_gopro_2';
const CHARS = [
  'char_328_cammou', 'char_194_leto', 'char_499_kaitou', 'char_129_bluep', 'char_1027_greyy2',
  'char_4222_taraxa', 'char_484_robrta', 'char_455_nothin', 'char_488_buildr',
];

const use = (t) => {
  setGameData(DATA);
  t.after(() => setGameData(null));
};

function chessId(charId, elite) {
  const normal = Object.keys(DATA.chess).find((id) => {
    const rec = DATA.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  if (!normal) return null;
  if (!elite) return normal;
  const golden = DATA.chess[normal].goldenId;
  return DATA.chess[golden]?.charId === charId ? golden : null;
}

function near(a, b, eps = 1e-6) {
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
}

function tagged(h, tag) {
  return h.hooksOf('hit').filter((c) => c.dmg && (c.dmg.tags || []).includes(tag));
}

/** One operator, optional allies / enemies. `uid` 1 is the operator. `before` is created first (allyUnits order). */
function fight(charId, opts = {}) {
  const allies = opts.allies ?? [];
  const units = [
    ...(opts.before ?? []),
    {
      uid: 1, chessId: chessId(charId, !!opts.elite), row: opts.row ?? 10, col: opts.col ?? 4,
      skillIndex: opts.skill ?? 0,
      carryState: { sp: opts.sp ?? 999, ...(opts.hpPct != null ? { hpPct: opts.hpPct } : {}) },
    },
    ...allies,
  ];
  const enemies = opts.enemies === false ? [] : (opts.enemies ?? [{ key: DOG, time: 0, pos: opts.pos ?? [10, 5], mods: { hpMul: opts.hpMul ?? 30 } }]);
  return makeBattle({
    data: new DataSource(DATA), seed: opts.seed ?? 1, timeLimit: opts.timeLimit ?? 40, autoFinish: false,
    captureNoisy: !!opts.capture, units, enemies, flags: opts.flags, setup: opts.setup,
  });
}

const ally = (uid, charId, row, col, hpPct) => ({
  uid, chessId: chessId(charId, false), row, col, skillIndex: 0, carryState: { sp: 0, hpPct },
});

/** Deploy the opening lineup and stop. Attacks and scheduled spawns wait for the next step. */
function began(h) {
  if (!h.battle.started) h.battle.start();
  return h;
}

test('both forms author every selectable skill', (t) => {
  use(t);
  const ds = new DataSource(DATA);
  for (const charId of CHARS) {
    for (const elite of [false, true]) {
      const id = chessId(charId, elite);
      assert.ok(id, `${charId} ${elite ? 'elite' : 'normal'}`);
      const raw = DATA.chess[id];
      for (let i = 0; i < raw.skills.length; i++) {
        const def = ds.getChess(id, { skillIndex: i });
        assert.equal(def.charId, charId);
        const built = KITS[charId](def.skill.bb, def.raw, def);
        const spec = built.skills[def.skill.id];
        assert.ok(spec, `${id} skill ${i} ${def.skill.id}`);
        assert.equal(typeof spec.kind, 'string');
        if (spec.kind === 'duration' && def.skill.duration > 0) assert.equal(spec.duration, def.skill.duration);
      }
    }
  }
});

test('卡达: talent attack speed, S1 attack, S2 drone locks and stops', (t) => {
  use(t);
  const s1 = fight('char_328_cammou', { skill: 0, enemies: false });
  began(s1);
  const a = s1.unit(1);
  assert.equal(a.findBuff('cammou:sync').mods.aspd, 6);
  assert.equal(a.s.aspd, 112);
  assert.equal(a.skill.activate('manual'), true);
  near(a.s.atk, 259 * 1.35);

  const h = fight('char_328_cammou', {
    skill: 1, capture: true, hpMul: 40, seed: 2,
    enemies: [
      { key: DOG, time: 0, pos: [10, 5], mods: { hpMul: 40 } },
      { key: DOG, time: 0, pos: [10, 6], mods: { hpMul: 40 } },
    ],
  });
  const u = h.unit(1);
  assert.ok(h.runUntil(() => u.skill.active, 3), `S2 did not open (rule ${u.skill.rule})`);
  assert.ok(h.runUntil(() => tagged(h, 'cammou:drone').length >= 1, 8), 'no drone hit');
  const first = tagged(h, 'cammou:drone')[0];
  const init = u.profile.funnel?.init ?? 0.2;
  near(first.dmg.amount, u.s.atk * u.s.atkScaleMul * init, 1e-4);
  const lock = u.mem.cammou.lock;
  const other = h.enemies().find((e) => e !== lock);
  assert.ok(lock?.alive && other?.alive, 'lock and a second enemy');
  const otherHits = () => tagged(h, 'cammou:drone').filter((c) => c.target === other).length;
  const beforeOther = otherHits();
  h.battle.dealDamage({ source: null, target: lock, amount: lock.hp + 500, type: 'true' });
  h.run(2);
  assert.equal(u.mem.cammou.done, true);
  assert.equal(otherHits(), beforeOther);

  const mid = tagged(h, 'cammou:drone').length;
  h.battle.dealDamage({ source: null, target: u, amount: u.hp + 500, type: 'true' });
  assert.equal(u.alive, false);
  h.run(3);
  assert.equal(tagged(h, 'cammou:drone').length, mid);
});

test('烈夏: S1 attack speed, S2 opens a ready student and the aura', (t) => {
  use(t);
  const s1 = fight('char_194_leto', { skill: 0, enemies: false });
  began(s1);
  const a = s1.unit(1);
  assert.equal(a.skill.activate('manual'), true);
  near(a.s.atk, 548 * 1.27);
  assert.equal(a.s.aspd, 125);

  const h = fight('char_194_leto', {
    skill: 1, col: 4, enemies: false,
    allies: [{ uid: 2, chessId: chessId('char_195_glassb', false), row: 10, col: 6, skillIndex: 0, carryState: { sp: 999 } }],
  });
  began(h);
  const leto = h.unit(1);
  const glass = h.unit(2);
  assert.equal(glass.skill.activations, 0);
  assert.equal(leto.skill.activate('manual'), true);
  assert.ok(glass.skill.activations >= 1, '真理 was ready and 烈夏 opened her skill');
  assert.equal(leto.skill.activations, 1);
  assert.equal(leto.profile.rangedScale, 1);
  assert.equal(leto.skill.spec.targeting.maxTargets, 2);
  h.run(0.4);
  const key = `leto:rush:${leto.id}`;
  assert.equal(leto.findBuff(key).mods.aspd, 13);
  assert.equal(glass.findBuff(key).mods.aspd, 13);
});

test('折光: apoptosis damage, burst elemental, conditional attack, elite module', (t) => {
  use(t);
  const h = fight('char_499_kaitou', { skill: 0, capture: true, enemies: false });
  began(h);
  const u = h.unit(1);
  const e = h.spawn(DOG, { pos: [10, 5], mods: { hpMul: 20 } });
  h.battle.addBuff(e, { key: 'apoptosisBurst', duration: 30 });
  assert.equal(u.skill.activate('manual'), true);
  assert.ok(h.runUntil(() => tagged(h, 'kaitou:burst').length >= 1, 4), 'no burst elemental');
  const burst = tagged(h, 'kaitou:burst')[0];
  near(burst.dmg.amount, u.s.atk * 0.3, 1e-4);
  assert.ok(e.elem.apoptosis > 0, 'apoptosis gauge');
  assert.equal(u.findBuff('kaitou:warn').mods.atkPct, 0.13);
  const arts = h.hooksOf('hit').find((c) => c.source === u && c.dmg?.isAttack && c.dmg.type === 'arts');
  assert.ok(arts);
  near(arts.dmg.mul, 1);

  const h2 = fight('char_499_kaitou', { skill: 1, enemies: false });
  began(h2);
  const s2 = h2.unit(1);
  assert.equal(s2.skill.spec.targeting.maxTargets, 2);
  assert.equal(s2.skill.activate('manual'), true);
  assert.equal(s2.s.aspd, 155);

  const elite = fight('char_499_kaitou', { elite: true, skill: 0, capture: true, enemies: false });
  began(elite);
  const eu = elite.unit(1);
  const ee = elite.spawn(DOG, { pos: [10, 5], mods: { hpMul: 20 } });
  elite.battle.addBuff(ee, { key: 'apoptosisBurst', duration: 30 });
  assert.equal(eu.skill.activate('manual'), true);
  assert.ok(elite.runUntil(() => elite.hooksOf('hit').some((c) => c.source === eu && c.dmg?.isAttack && c.dmg.type === 'arts' && c.dmg.mul > 1), 4));
  const em = elite.hooksOf('hit').find((c) => c.source === eu && c.dmg?.isAttack && c.dmg.type === 'arts');
  near(em.dmg.mul, 1.1);
});

test('蓝毒: poison, extra targets, elite ground attack speed', (t) => {
  use(t);
  const s1 = fight('char_129_bluep', {
    skill: 0, capture: true, hpMul: 40,
    enemies: [
      { key: DOG, time: 0, pos: [10, 5], mods: { hpMul: 40 } },
      { key: DOG, time: 0, pos: [11, 5], mods: { hpMul: 40 } },
    ],
  });
  const a = s1.unit(1);
  assert.equal(a.skill.spec.attack.atkScale, 1.4);
  assert.equal(a.skill.spec.targeting.maxTargets, 2);
  assert.ok(s1.runUntil(() => s1.enemies().some((e) => e.findBuff(`bluep:poison:${a.id}`)), 3), 'poison');
  assert.equal(s1.enemies().find((e) => e.findBuff(`bluep:poison:${a.id}`)).findBuff(`bluep:poison:${a.id}`).data.dmg, 40);
  assert.equal(a.findBuff('bluep:ground'), null);
  assert.ok(s1.runUntil(() => a.skill.activations >= 1 && s1.hooksOf('attack').some((c) => c.attacker === a && c.targets.length === 2), 8), 'S1 volley');

  const s2 = fight('char_129_bluep', {
    skill: 1, capture: true, hpMul: 40,
    enemies: [
      { key: DOG, time: 0, pos: [10, 5], mods: { hpMul: 40 } },
      { key: DOG, time: 0, pos: [11, 5], mods: { hpMul: 40 } },
      { key: DOG, time: 0, pos: [9, 5], mods: { hpMul: 40 } },
    ],
  });
  began(s2);
  const b = s2.unit(1);
  assert.equal(b.skill.spec.targeting.maxTargets, 3);
  assert.equal(b.skill.activate('manual'), true);
  near(b.s.atk, 442 * 1.2);
  assert.ok(s2.runUntil(() => s2.hooksOf('attack').some((c) => c.attacker === b && c.targets.length === 3), 4), 'S2 three targets');

  const elite = fight('char_129_bluep', { elite: true, skill: 0, pos: [10, 5] });
  const eu = elite.unit(1);
  assert.ok(elite.runUntil(() => eu.findBuff('bluep:ground'), 1), 'ground aspd');
  assert.equal(eu.findBuff('bluep:ground').mods.aspd, 8);
  assert.equal(eu.findBuff('trait:attack_speed'), null);
});

test('承曦格雷伊: aftershocks and the lightning ball', (t) => {
  use(t);
  const h = fight('char_1027_greyy2', { skill: 1, capture: true, enemies: false });
  began(h);
  const u = h.unit(1);
  assert.equal(u.profile.shockTimes, 2);
  assert.equal(u.skill.kind, 'charges');
  assert.equal(u.skill.maxCharges, 2);
  h.spawn(DOG, { pos: [10, 6], mods: { hpMul: 20 } });
  h.battle._buildEnemyIndex();
  assert.equal(u.skill.activate('manual'), true);
  const ball = tagged(h, 'greyy2:ball');
  assert.ok(ball.length >= 1, 'ball pulse');
  near(ball[0].dmg.amount, u.s.atk * 0.95, 1e-4);
  h.run(2);
  assert.ok(tagged(h, 'greyy2:ball').length >= 2, 'the ball keeps pulsing');

  const elite = fight('char_1027_greyy2', { elite: true, skill: 0, enemies: false });
  assert.equal(elite.unit(1).profile.shockTimes, 3);
});

test('风絮: liftoff heal, extra airborne ally, splash', (t) => {
  use(t);
  const s1 = fight('char_4222_taraxa', {
    skill: 0, capture: true, enemies: false,
    allies: [ally(2, 'char_195_glassb', 10, 5, 0.4)],
  });
  began(s1);
  const u = s1.unit(1);
  const patient = s1.unit(2);
  const hp0 = patient.hp;
  assert.equal(u.skill.activate('manual'), true);
  near(u.s.interval, 0.2);
  assert.equal(u.s.flags.liftoff, true);
  assert.ok(s1.runUntil(() => s1.hooksOf('heal').some((c) => c.source === u && c.target === patient && !c.opts?.regen), 2));
  const heal = s1.hooksOf('heal').find((c) => c.source === u && c.target === patient && !c.opts?.regen);
  near(heal.amount, 368 * 0.45, 1e-4);
  assert.ok(patient.hp > hp0);
  s1.run(0.4);
  assert.ok(u.findBuff('protect'));
  assert.equal(u.findBuff(`taraxa:block:${u.id}`).mods.blockCnt, 1);

  const s2 = fight('char_4222_taraxa', {
    skill: 1, capture: true, enemies: false, col: 4,
    // She is airborne and inside her own range, so she must not be the first ally the extra-target scan sees.
    before: [ally(2, 'char_195_glassb', 9, 3, 0.2)],
    allies: [
      ally(3, 'char_195_glassb', 11, 5, 0.7),
      ally(4, 'char_195_glassb', 10, 5, 0.15),
    ],
    setup(b) {
      b.on('deploy', (ctx) => {
        if (ctx.unit.uid === 2) b.addBuff(ctx.unit, { key: 'test:fly', flags: { liftoff: true } });
      });
    },
  });
  began(s2);
  const w = s2.unit(1);
  const flyer = s2.unit(2);
  const splash = s2.unit(3);
  const primary = s2.unit(4);
  assert.equal(w.skill.activate('manual'), true);
  near(w.s.atk, 368 * 1.8);
  assert.equal(w.s.flags.liftoff, true);
  assert.ok(s2.runUntil(() => s2.hooksOf('heal').some((c) => c.source === w && c.target === primary), 4));
  const primaryHeal = s2.hooksOf('heal').find((c) => c.source === w && c.target === primary);
  const flyerHeal = s2.hooksOf('heal').find((c) => c.source === w && c.target === flyer);
  const splashHeal = s2.hooksOf('heal').find((c) => c.source === w && c.target === splash);
  near(primaryHeal.amount, w.s.atk);
  near(flyerHeal.amount, w.s.atk);
  near(splashHeal.amount, w.s.atk * 0.4);
});

test('罗比菈塔: the device buffs her, a second does not stack, and both leave with her', (t) => {
  use(t);
  const h = fight('char_484_robrta', { skill: 0, col: 4, enemies: false });
  began(h);
  const u = h.unit(1);
  const devs = () => h.battle.allyUnits.filter((d) => d.ownerUnit === u && d.defId === 'token_10018_robrta_mach');
  const up = () => devs().filter((d) => d.alive);
  assert.equal(up().length, 1);
  const dev = up()[0];
  assert.equal(dev.tileR, u.tileR);
  assert.equal(dev.tileC, u.tileC - 1);
  assert.equal(dev.dir, 'RIGHT');
  assert.equal(u.findBuff('robrta:def').mods.defPct, 0.33);
  near(u.s.def, u.base.def * 1.33, 1e-4);
  assert.equal(u.findBuff('robrta:shield').shieldHits, 2);
  assert.equal(u.mem.craftsman.stock, 2);
  assert.equal(u.mem.craftsman.cap, 3);
  // The device's two shield hits each cancel one instance, so the killing blow is the third.
  for (let i = 0; i < 3 && u.alive; i++) h.battle.dealDamage({ source: null, target: u, amount: u.hp + 500, type: 'true' });
  assert.equal(u.alive, false);
  assert.equal(u.removeReason, 'killed');
  assert.ok(devs().every((d) => !d.alive && d.removeReason === 'expired'));

  const r = fight('char_484_robrta', { skill: 0, col: 5, enemies: false });
  began(r);
  const o = r.unit(1);
  const gone = () => r.battle.allyUnits.filter((d) => d.ownerUnit === o && d.defId === 'token_10018_robrta_mach');
  assert.equal(gone().filter((d) => d.alive).length, 1);
  r.battle.retreat(o);
  assert.equal(o.removeReason, 'retreat');
  assert.ok(gone().every((d) => !d.alive && d.removeReason === 'expired'));

  const s2 = fight('char_484_robrta', { skill: 1, col: 4, enemies: false });
  began(s2);
  const b = s2.unit(1);
  const machines = () => s2.battle.allyUnits.filter((d) => d.ownerUnit === b && d.defId === 'token_10018_robrta_mach' && d.alive);
  assert.equal(machines().length, 1);
  assert.equal(b.skill.activate('manual'), true);
  assert.equal(b.skill.end('manual'), undefined);
  assert.equal(b.skill.active, false);
  assert.equal(machines().length, 2);
  assert.equal(b.mem.craftsman.stock, 2);
  assert.equal(b.mem.craftsman.cap, 3);
  assert.equal(b.findBuff('robrta:shield').shieldHits, 2);
});

test('乌有: S1 window, ambush, merchant retreat, S2 branches', (t) => {
  use(t);
  const s1 = fight('char_455_nothin', { skill: 0, enemies: false });
  began(s1);
  const a = s1.unit(1);
  assert.equal(a.skill.active, false);
  assert.equal(a.s.blockCnt, 2);
  const low = a.s.maxHp * 0.15;
  a.hp = low;
  s1.run(1.2);
  assert.equal(a.skill.active, true);
  assert.equal(a.s.flags.noBlock, true);
  assert.equal(a.s.taunt, -1);
  near(a.s.hpRegen, a.s.maxHp * 0.09, 1e-3);
  assert.ok(a.hp > low);

  const amb = fight('char_455_nothin', { skill: 0, capture: true, enemies: false, timeLimit: 20 });
  const n = amb.unit(1);
  amb.run(4.5);
  const foe = amb.spawn(DOG, { pos: [10, 5], mods: { hpMul: 10 } });
  assert.ok(amb.runUntil(() => amb.hooksOf('hit').some((c) => c.source === n && c.dmg?.isAttack), 3));
  const hit = amb.hooksOf('hit').find((c) => c.source === n && c.dmg?.isAttack);
  near(hit.dmg.mul, 1.55);
  const stun = foe.findBuff('stun');
  assert.ok(stun && stun.timeLeft <= 4 + 1e-6 && stun.timeLeft > 3, `stun ${stun?.timeLeft}`);

  const merch = fight('char_455_nothin', { skill: 0, enemies: false, flags: { dpInit: 0, dpPerSec: 0 } });
  const m = merch.unit(1);
  assert.ok(merch.runUntil(() => m.removeReason === 'merchant', 4), `reason ${m.removeReason} dp ${merch.battle.getPlayer('p1').dp}`);
  assert.equal(m.alive, false);

  const seen = new Map();
  for (let seed = 1; seed <= 80 && seen.size < 3; seed++) {
    const h = fight('char_455_nothin', { skill: 1, seed, enemies: false, capture: seed === 1 });
    began(h);
    const u = h.unit(1);
    assert.equal(u.skill.activate('manual'), true, `seed ${seed}`);
    const br = u.mem.nothinBranch;
    if (seen.has(br)) continue;
    if (br === 0) {
      h.spawn(DOG, { pos: [10, 5], mods: { hpMul: 20 } });
      assert.ok(h.runUntil(() => h.enemies()[0]?.findBuff('nothin:slow'), 4), `seed ${seed} slow`);
      assert.equal(h.enemies()[0].findBuff('nothin:slow').mods.aspd, -25);
      const slow = h.enemies()[0].findBuff('nothin:slow');
      u.skill.end('manual');
      assert.equal(u.skill.active, false);
      assert.equal(u.findBuff('nothin:branch'), null);
      assert.equal(h.enemies()[0].findBuff('nothin:slow'), slow);
    } else if (br === 1) {
      assert.equal(u.findBuff('nothin:branch').mods.aspd, 20);
      near(u.s.atk, 626 * 1.3);
      u.skill.end('manual');
      assert.equal(u.skill.active, false);
      assert.equal(u.findBuff('nothin:branch'), null);
    } else if (br === 2) {
      assert.equal(u.findBuff('nothin:branch').mods.dodgePhys, 0.35);
      assert.equal(u.findBuff('nothin:branch').mods.blockCnt, 1);
      assert.equal(u.s.blockCnt, 2);
      near(u.s.atk, 626 * 1.3);
      u.skill.end('manual');
      assert.equal(u.findBuff('nothin:branch'), null);
    }
    seen.set(br, seed);
  }
  assert.deepEqual([...seen.keys()].sort((x, y) => x - y), [0, 1, 2], `seeds ${[...seen.entries()]}`);
  const again = fight('char_455_nothin', { skill: 1, seed: seen.get(0), enemies: false });
  began(again);
  const z = again.unit(1);
  assert.equal(z.skill.activate('manual'), true);
  assert.equal(z.mem.nothinBranch, 0);
});

test('青枳: S1 cost, talent HP, S2 second cast, elite block', (t) => {
  use(t);
  const s1 = fight('char_488_buildr', { skill: 0, enemies: false, flags: { dpInit: 0, dpPerSec: 0 }, timeLimit: 40 });
  const a = s1.unit(1);
  s1.run(0.5);
  assert.equal(s1.battle.getPlayer('p1').dp, 12);
  s1.run(30);
  assert.equal(a.findBuff('buildr:hp').mods.hpPct, 0.18);

  const s2 = fight('char_488_buildr', { skill: 1, enemies: false, flags: { dpInit: 0, dpPerSec: 0 } });
  began(s2);
  const b = s2.unit(1);
  const dp = () => s2.battle.getPlayer('p1').dp;
  assert.equal(b.skill.activate('manual'), true);
  assert.equal(dp(), 10);
  assert.ok(Number.isFinite(b.skill.timeLeft) && b.skill.timeLeft > 1);
  assert.equal(b.findBuff('buildr:s2').mods.atkPct, 0.1);
  assert.equal(b.findBuff('buildr:s2').mods.defPct, 0.4);
  b.skill.end('manual');
  assert.equal(b.findBuff('buildr:s2'), null);
  b.skill.gainSp(999);
  assert.equal(b.skill.activate('manual'), true);
  assert.equal(b.skill.timeLeft, Infinity);
  assert.equal(dp(), 20);
  assert.equal(b.findBuff('buildr:s2').mods.atkPct, 0.1);
  assert.equal(b.findBuff('buildr:s2').mods.defPct, 0.4);
  s2.run(4);
  assert.equal(dp(), 20);
  assert.equal(b.skill.active, true);
  s2.run(0.6);
  assert.equal(dp(), 21);
  assert.equal(b.skill.active, true);
  checkInvariants(s2.battle); // the endless second cast is a toggle, not a duration skill with an infinite timeLeft

  const elite = fight('char_488_buildr', { elite: true, skill: 0, pos: [10, 5], hpMul: 20 });
  const eu = elite.unit(1);
  assert.ok(elite.runUntil(() => eu.findBuff('buildr:block'), 5), 'not blocking');
  assert.equal(eu.findBuff('buildr:block').mods.atkPct, 0.08);
  assert.equal(eu.findBuff('buildr:block').mods.defPct, 0.08);
});

test('a 60-second battle of all nine does not throw', (t) => {
  use(t);
  const lineup = [
    ['char_328_cammou', 10, 4], ['char_194_leto', 10, 5], ['char_499_kaitou', 10, 6],
    ['char_129_bluep', 10, 7], ['char_1027_greyy2', 10, 8], ['char_4222_taraxa', 10, 9],
    ['char_484_robrta', 11, 3], ['char_455_nothin', 11, 5], ['char_488_buildr', 11, 6],
  ];
  const h = makeBattle({
    data: new DataSource(DATA), seed: 4, timeLimit: 60, autoFinish: false,
    units: lineup.map(([charId, row, col], i) => ({
      uid: i + 1, chessId: chessId(charId, false), row, col, skillIndex: 0, carryState: { sp: 999 },
    })),
    enemies: [{ key: DOG, time: 0, pos: [9, 10], mods: { hpMul: 30 } }],
  });
  h.run(60);
  h.invariants();
  for (const [charId] of lineup) {
    const u = h.unit(chessId(charId, false));
    assert.ok(u && u.deploySeq > 0, charId);
  }
  const robrta = h.unit(chessId('char_484_robrta', false));
  const devs = h.battle.allyUnits.filter((d) => d.ownerUnit === robrta && d.defId === 'token_10018_robrta_mach');
  assert.ok(devs.length >= 1);
  if (!robrta.alive) assert.ok(devs.every((d) => !d.alive));
});
