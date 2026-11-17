// test/content/boss-quintus-attack-slot.test.js — 盐风主教昆图斯's 【大潮】 / 【崩坍】 take the place of a normal attack
// (DESIGN §35.19; the maintainer's recordings of 2026-10-22, 「BOSS反复释放同一技能」).
//
// Official: both skills are attack-class — the prefab ability of `tidewater*` / `rockfall*` is a MeleeAttack, the same
// class as the boss's own Attack, and PRTS 盐风主教昆图斯 says of both 「触发索敌和普通攻击相同」. PRTS's skill rules on the
// same page: 「大多数技能自动触发会占用攻击间隔」, 「优先级相同则随机触发其中之一」 (every 昆图斯 skill has priority 0),
// 「同一技能的冷却时间于该技能结束时开始计时」. In the third form 【大潮】's cooldown (3.5, initial 1 — enemy_database /
// act1autochess_h07_04 overrides) equals the attack interval (3.5); counted from the end of its 1.667 s clip it is not
// ready at the next turn, and the boss alternates: arknights.wiki.gg (Sal Viento Bishop Quintus) — it never uses Great
// Tide twice in a row. Until this fix the tide ran on its own 3.5 s timer next to the normal attack: a tide every 3.5 s
// **and** an attack every 3.5 s, tides back to back, and a tide with no operator to attack. 【断裂生殖】
// 「仅仍有未执行的小队动作指令时可触发」: no cast after the level branch's 7 phases. 【断裂生殖】 / 【物种爆发】 take the attack's
// turn too, with a trigger of their own (DESIGN §35.55; until then on their own timers).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { QUINTUS_CLIP, templateOf } from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const KEY = 'enemy_1521_dslily';
const TPL = 'act1autochess_h07_04';
const WALL = (id, def) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });

/**
 * A boss field of 昆图斯, `units` walls on the board; the leader at [3, 10]. By default the pair template with its level
 * overrides; `overrides: false` = the enemy_database values (the solo template `_s` has no override).
 */
function quintus(units, { seed = 7, tpl = TPL, overrides = true } = {}) {
  const chess = { t_wall: WALL('t_wall', 300), t_wall2: WALL('t_wall2', 200), t_wall3: WALL('t_wall3', 0) };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed, autoFinish: false, timeLimit: 600, kind: 'boss',
    sharedBoss: { hp: 1e6, maxHp: 1e6, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
    defs: { chess }, kits: { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK }, enemies: [], units,
    setup(b) { if (tpl) b.opts.templateId = tpl; if (overrides) b.enemyOverrides = JSON.parse(JSON.stringify(W[TPL].overrides)); },
  });
  h.step();
  const e = h.spawn(KEY, { pos: [3, 10], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  return { h, e };
}

/** Into the third form (lost ≥ 2 × 33 %: the first form, then the second, on the 0.25 s ability tick). */
function thirdForm(h) {
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.3;
  h.run(1);
}

/** Every leader action over `secs` game s, in order: { t, what } — a skill cast (its prefabKey) or 'ATTACK'. */
function actions(h, e, secs) {
  const out = [];
  const keyOf = (slot) => (E[KEY].skills[slot] || {}).prefabKey;
  let seen = h.events.length, attacks = e.stats.attacks;
  const end = h.b.time + secs;
  while (h.b.time < end - 1e-9) {
    h.step();
    for (; seen < h.events.length; seen++) {
      const ev = h.events[seen];
      if (ev[0] === 'cast' && ev[1] === e.id) out.push({ t: h.b.time, what: keyOf(ev[2]) });
    }
    if (e.stats.attacks > attacks) { for (let k = attacks; k < e.stats.attacks; k++) out.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  return out;
}

const sk = (p) => W[TPL].overrides[KEY].skills.find((x) => x.prefabKey === p);
/** The actions that take an attack's turn: the normal attack and every 昆图斯 skill (DESIGN §35.19 / §35.55). */
const TURN = /^(ATTACK|Tidewater|Rockfall|SummonTentac|Doom)/;
/** The tides after a gap with no other skill in it (崩坍, 断裂生殖, 物种爆发 move the tide by a turn). */
const plainTides = (log, tides) => tides.filter((x, i) => i > 0 && !log.some((a) => /^(Rockfall|SummonTentac|Doom)/.test(a.what) && a.t > tides[i - 1].t && a.t < x.t));
const TWO = () => [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }];

/**
 * PRTS's rule, checked on a log: a tide comes only once its cooldown has run from the end of the previous tide's clip
 * (cooldown + clip after its cast), and while it is ready no turn goes to a normal attack.
 */
function tideRule(log) {
  const ready = sk('TidewaterG2').cooldown + QUINTUS_CLIP.Tidewater;
  const tides = log.filter((a) => a.what === 'TidewaterG2');
  for (let i = 1; i < tides.length; i++) assert.ok(tides[i].t - tides[i - 1].t >= ready - 1e-6, `tide gap ${(tides[i].t - tides[i - 1].t).toFixed(3)} at ${tides[i].t.toFixed(3)} (< ${ready})`);
  for (let i = 0; i + 1 < tides.length; i++) {
    const passed = log.find((a) => a.what === 'ATTACK' && a.t > tides[i].t + ready + 1e-6 && a.t < tides[i + 1].t - 1e-6);
    assert.ok(!passed, `a normal attack at ${passed && passed.t.toFixed(3)} while the tide was ready (cast ${tides[i].t.toFixed(3)}, next ${tides[i + 1].t.toFixed(3)})`);
  }
  return tides;
}

test('昆图斯 third form: 【大潮】 takes an attack slot — never twice in a row, one action per attack interval', () => {
  const { h, e } = quintus([{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }, { chessId: 't_wall3', row: 12, col: 4 }]);
  thirdForm(h);
  const iv = e.s.interval;
  assert.equal(iv, E[KEY].stats.bat, 'attack interval = baseAttackTime');
  const tide = W[TPL].overrides[KEY].skills.find((s) => s.prefabKey === 'TidewaterG2');
  assert.equal(tide.cooldown, iv, 'the level data: the third-form tide cooldown equals the attack interval');
  const log = actions(h, e, 70);
  const tides = log.filter((a) => a.what === 'TidewaterG2');
  const attacks = log.filter((a) => a.what === 'ATTACK');
  assert.ok(tides.length >= 8 && attacks.length >= 4, `tides ${tides.length}, attacks ${attacks.length}`);
  // never two tides in a row: an attack or another skill between every two
  for (let i = 1; i < log.length; i++) assert.ok(!(log[i].what === 'TidewaterG2' && log[i - 1].what === 'TidewaterG2'), `two tides in a row at ${log[i].t.toFixed(3)}`);
  // so a tide every other attack slot at most: ≥ 2 attack intervals apart (until the fix: every 3.5 s)
  for (let i = 1; i < tides.length; i++) assert.ok(tides[i].t - tides[i - 1].t >= 2 * iv - 1e-6, `tide gap ${(tides[i].t - tides[i - 1].t).toFixed(3)} at ${tides[i].t.toFixed(3)}`);
  tideRule(log);
  // with nothing else in the way: exactly every other turn (3.5 + 1.667 s ready, the turn after at 2 × 3.5 = 7 s)
  const plain = plainTides(log, tides);
  assert.ok(plain.length >= 4, `${plain.length} tide gaps without another skill`);
  for (const x of plain) { const prev = tides[tides.indexOf(x) - 1]; assert.ok(Math.abs(x.t - prev.t - 2 * iv) < 0.06, `gap ${(x.t - prev.t).toFixed(3)} at ${x.t.toFixed(3)}`); }
  // one action per slot: the tide, 崩坍, 断裂生殖 and the normal attack share the attack's turn (DESIGN §35.55)
  const slot = log.filter((a) => TURN.test(a.what));
  assert.ok(slot.some((a) => /^SummonTentac/.test(a.what)), '断裂生殖 among the turns');
  for (let i = 1; i < slot.length; i++) assert.ok(slot[i].t - slot[i - 1].t >= iv - 1e-6, `${slot[i - 1].what} then ${slot[i].what} ${(slot[i].t - slot[i - 1].t).toFixed(3)} s apart`);
  // the tide still hits the whole field (the operator outside the attack's two targets too)
  assert.ok(h.unit('t_wall3').stats.taken > 0, 'global tide');
});

test('昆图斯: no attack target, no 【大潮】 (PRTS 「触发索敌和普通攻击相同」); 【断裂生殖】 still comes (its own trigger, `_allowNoTarget` 1)', () => {
  const { h, e } = quintus([]);
  thirdForm(h);
  const log = actions(h, e, 40);
  assert.equal(log.filter((a) => a.what === 'ATTACK').length, 0);
  assert.deepEqual(log.filter((a) => /^(Tidewater|Rockfall)/.test(a.what)), [], 'no attack-class skill without a target');
  const tent = log.filter((a) => /^SummonTentac/.test(a.what));
  assert.ok(tent.length >= 1, '断裂生殖 with nobody in range');
  for (let i = 1; i < tent.length; i++) assert.ok(tent[i].t - tent[i - 1].t >= sk('SummonTentacG2').cooldown + QUINTUS_CLIP.SummonTentac - 1e-6);
});

test('昆图斯 first form: 崩坍 and 大潮 come at the first attack slot after their initial cooldown', () => {
  const { h, e } = quintus([{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }]);
  const log = actions(h, e, 60);
  const iv = e.s.interval;
  const at = (p) => (log.find((a) => a.what === p) || {}).t;
  // 断裂生殖 (AnimatedActionToOwnerAbility) takes a turn too, since §35.55 (until then its own timer)
  for (const p of ['Rockfall', 'Tidewater', 'SummonTentac']) {
    const t = at(p);
    assert.ok(t != null, `${p} cast`);
    assert.ok(t >= sk(p).initCooldown - 1e-6 && t <= sk(p).initCooldown + iv + 1e-6, `${p} at ${t} (initial cooldown ${sk(p).initCooldown})`);
  }
  const slot = log.filter((a) => TURN.test(a.what));
  for (let i = 1; i < slot.length; i++) assert.ok(slot[i].t - slot[i - 1].t >= iv - 1e-6, `${slot[i - 1].what} then ${slot[i].what}`);
});

test('昆图斯 third form at attack interval 2.0 (attack speed +75): a tide every 3 turns, as the PRTS rule gives', () => {
  const { h, e } = quintus(TWO());
  thirdForm(h);
  h.b.addBuff(e, { key: 'test:aspd', persist: true, mods: { aspd: 75 } });
  h.run(0.5);
  const iv = e.s.interval;
  assert.ok(Math.abs(iv - 2) < 1e-6, `interval ${iv}`);
  const log = actions(h, e, 70);
  const tides = tideRule(log);
  assert.ok(tides.length >= 8, `${tides.length} tides`);
  // 3.5 + 1.667 s from the cast: not ready at the 2nd turn (4 s), ready at the 3rd (6 s)
  const plain = plainTides(log, tides);
  assert.ok(plain.length >= 5, `${plain.length} tide gaps without another skill`);
  for (const x of plain) { const prev = tides[tides.indexOf(x) - 1]; assert.ok(Math.abs(x.t - prev.t - 3 * iv) < 0.06, `gap ${(x.t - prev.t).toFixed(3)} at ${x.t.toFixed(3)}`); }
});

test('昆图斯 third form under 寒冷 (interval 5.0): still alternating; 寒冷 plus any further attack-speed cut: a tide at every turn, no normal attack', () => {
  // [ASSUMED] the tide's 1.667 s clip keeps its length when the attack speed is cut (as the engine's attack clip, ai.js
  // clipSpeed: never slower), so the tide is ready 3.5 + 1.667 = 5.167 s after its cast whatever the slow: 寒冷's −30
  // (interval 3.5 × 100 / 70 = 5.0) is 0.167 s short of that and keeps the alternation; 寒冷 with 引星棘刺's 视界 −5 (the
  // repro's field, interval 5.385) makes every turn a tide. DESIGN §35.19 states it; if a slow is to stretch the clip
  // (the abilities' `_affectedBySlowDown` 1), the second half of this test changes.
  const ready = sk('TidewaterG2').cooldown + QUINTUS_CLIP.Tidewater;
  const { h, e } = quintus(TWO());
  thirdForm(h);
  assert.ok(h.b.applyStatus(e, 'cold', { duration: 600 }), '寒冷 lands on the leader');
  h.run(0.5);
  assert.ok(Math.abs(e.s.interval - 5) < 1e-6 && e.s.interval < ready, `寒冷: interval ${e.s.interval} (ready ${ready.toFixed(3)})`);
  const cold = actions(h, e, 70);
  const coldTides = tideRule(cold);
  assert.ok(cold.filter((a) => a.what === 'ATTACK').length >= 2, 'normal attacks between the tides');
  const plain = plainTides(cold, coldTides);
  assert.ok(plain.length >= 3, `${plain.length} tide gaps without another skill`);
  for (const x of plain) { const prev = coldTides[coldTides.indexOf(x) - 1]; assert.ok(Math.abs(x.t - prev.t - 2 * e.s.interval) < 0.06, `寒冷: gap ${(x.t - prev.t).toFixed(3)} at ${x.t.toFixed(3)}`); }
  h.b.addBuff(e, { key: 'test:vision', persist: true, mods: { aspd: -5 } });
  h.run(2 * e.s.interval);
  const iv = e.s.interval;
  assert.ok(Math.abs(iv - 3.5 * 100 / 65) < 1e-6 && iv > ready, `寒冷 + −5: interval ${iv}`);
  const slow = actions(h, e, 70);
  const slowTides = tideRule(slow);
  assert.equal(slow.filter((a) => a.what === 'ATTACK').length, 0, 'every turn goes to a skill');
  assert.ok(slowTides.length >= 10, `${slowTides.length} tides`);
  const turns = slow.filter((a) => TURN.test(a.what));
  for (let i = 1; i < turns.length; i++) assert.ok(Math.abs(turns[i].t - turns[i - 1].t - iv) < 0.06, `turn gap ${(turns[i].t - turns[i - 1].t).toFixed(3)} at ${turns[i].t.toFixed(3)}`);
});

test('昆图斯 third form: after a stretch with no target, the first turn is the tide (ready all along)', () => {
  const { h, e } = quintus(TWO());
  thirdForm(h);
  actions(h, e, 10);
  const walls = [h.unit('t_wall'), h.unit('t_wall2')];
  for (const u of walls) h.b.addBuff(u, { key: 'test:hide', persist: true, flags: { untargetable: true } });
  const idle = actions(h, e, 15);
  assert.deepEqual(idle.filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what)), [], 'no turn without a target');
  for (const u of walls) h.b.removeBuff(u, 'test:hide');
  const back = actions(h, e, 10).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
  assert.ok(back.length >= 2, `${back.length} turns`);
  assert.match(back[0].what, /^(TidewaterG2|RockfallG2)$/, `first turn ${back[0].what} at ${back[0].t.toFixed(3)}`);
});

test('昆图斯: two attack-class skills ready on one turn — one at random (equal priority, PRTS 「优先级相同则随机触发其中之一」)', () => {
  const first = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    const { h, e } = quintus(TWO(), { seed });
    thirdForm(h);
    const ab = e.mem.ab;
    const tide = ab.list.find((a) => a.sk === ab.sk.TidewaterG2), rock = ab.list.find((a) => a.sk === ab.sk.RockfallG2);
    assert.equal(tide.sk.pr, 0); assert.equal(rock.sk.pr, 0);
    tide.left = 0; rock.left = 0;
    const log = actions(h, e, 4 * e.s.interval).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
    first.add(log[0].what);
    assert.equal(log[1].what, log[0].what === 'TidewaterG2' ? 'RockfallG2' : 'TidewaterG2', `seed ${seed}: the other one at the next turn`);
  }
  assert.deepEqual([...first].sort(), ['RockfallG2', 'TidewaterG2']);
});

test('attack-class skills ready on one turn — the highest data priority first, whatever the seed (PRTS 「优先级最高的技能优先触发」)', () => {
  // every 昆图斯 skill has priority 0; other leaders' data do not (假想敌：胄 "1" 1, 阿利斯泰尔 equip 1 / Suicide 5), so
  // either skill raised to 1 here (ab.sk[*].pr, from skills[].priority) must take the first turn, the other the next
  for (const top of ['RockfallG2', 'TidewaterG2']) {
    for (let seed = 1; seed <= 8; seed++) {
      const { h, e } = quintus(TWO(), { seed });
      thirdForm(h);
      const ab = e.mem.ab;
      ab.sk[top].pr = 1;
      const tide = ab.list.find((a) => a.sk === ab.sk.TidewaterG2), rock = ab.list.find((a) => a.sk === ab.sk.RockfallG2);
      tide.left = 0; rock.left = 0;
      const log = actions(h, e, 4 * e.s.interval).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
      assert.equal(log[0].what, top, `seed ${seed}: priority 1 first`);
      assert.equal(log[1].what, top === 'TidewaterG2' ? 'RockfallG2' : 'TidewaterG2', `seed ${seed}: the other one at the next turn`);
    }
  }
});

test('昆图斯 【断裂生殖】: no cast once the 7 squad actions of the level branch are used (PRTS 「仅仍有未执行的小队动作指令时可触发」)', () => {
  const br = W[TPL].branches.dslily_dstnta;
  assert.equal(br.length, 7);
  assert.equal(W[`${TPL}_s`].branches.dslily_dstnta.length, 7, 'the solo template: the same 7 phases');
  const { h, e } = quintus(TWO());
  thirdForm(h);
  const log = actions(h, e, 240).filter((a) => /^SummonTentac/.test(a.what));
  assert.equal(log.length, 7, `casts at ${log.map((a) => a.t.toFixed(1)).join(', ')}`);
  // the cooldown counted from the end of its 2 s clip (18 + 2 s), then the next attack's turn — one more when a tide
  // ready on the same turn wins the draw (DESIGN §35.55)
  const ready = sk('SummonTentacG2').cooldown + QUINTUS_CLIP.SummonTentac, iv = e.s.interval;
  for (let i = 1; i < log.length; i++) { const g = log[i].t - log[i - 1].t; assert.ok(g >= ready - 1e-6 && g <= ready + 2 * iv + 0.06, `gap ${g.toFixed(3)}`); }
  assert.equal(h.eventsOf('fx').filter((f) => f[1] === 'tentacle').length, br.reduce((n, p) => n + p.length, 0), 'every phase once: 1+1+1+1+2+2+4 tentacles');
  // a field without the template's branch: the random-target fallback, no limit
  const free = quintus(TWO(), { tpl: null });
  assert.equal(templateOf(free.h.b), null);
  thirdForm(free.h);
  assert.ok(actions(free.h, free.e, 240).filter((a) => /^SummonTentac/.test(a.what)).length > 7);
});

test('昆图斯 skill clips: QUINTUS_CLIP = the length of the official clip of each skill slot (data/assets.json)', () => {
  const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
  const sp = A.enemies[KEY].spine;
  E[KEY].skills.forEach((s, slot) => {
    const kind = s.prefabKey.replace(/G\d$/, '');
    const clip = sp.anims.skills[String(slot)] && sp.anims.skills[String(slot)].loop;
    assert.ok(clip, `slot ${slot} ${s.prefabKey}: a clip`);
    assert.equal(sp.animations[clip], QUINTUS_CLIP[kind], `${s.prefabKey}: ${clip}`);
  });
});

test('昆图斯 solo template: 【物种爆发】 at its initial cooldown after the third form starts, then its cooldown plus its 4.467 s clip apart', () => {
  // the solo template has no override (enemy_database: Doom cooldown 100, initial cooldown 200); the pair level's
  // 999 / 999 never lets it come. It takes the attack's turn (DESIGN §35.55), the cooldown counted from the clip's end
  // (castNow); its 4.467 s clip holds the next attack (enemies.js attackCdAfter, DESIGN §35.54)
  assert.equal((W[`${TPL}_s`].overrides || {})[KEY], undefined, 'the solo template: no 昆图斯 override');
  const doom = E[KEY].skills.find((s) => s.prefabKey === 'Doom');
  assert.deepEqual([doom.cooldown, doom.initCooldown], [100, 200]);
  const { h, e } = quintus(TWO(), { tpl: `${TPL}_s`, overrides: false });
  thirdForm(h);
  const from = h.b.time;
  const full = actions(h, e, 420);
  const log = full.filter((a) => a.what === 'Doom');
  assert.equal(log.length, 3, `casts at ${log.map((a) => a.t.toFixed(3)).join(', ')}`);
  // the form starts within the 1 s of thirdForm (0.25 s ability tick): the first cast 200 s on
  const iv = e.s.interval;
  assert.ok(log[0].t - from > doom.initCooldown - 1 && log[0].t - from <= doom.initCooldown + 2 * iv + 0.06, `first at ${log[0].t.toFixed(3)} (form ${from.toFixed(3)} − 1 s)`);
  for (let i = 1; i < log.length; i++) { const g = log[i].t - log[i - 1].t; assert.ok(g >= doom.cooldown + QUINTUS_CLIP.Doom - 1e-6 && g <= doom.cooldown + QUINTUS_CLIP.Doom + 2 * iv + 0.06, `gap ${g.toFixed(3)}`); }
  // nothing else in its clip: the next turn comes 4.467 s after it at the earliest
  for (const d of log) {
    const next = full.find((a) => a.t > d.t + 1e-9 && TURN.test(a.what));
    if (next) assert.ok(next.t - d.t >= QUINTUS_CLIP.Doom - 1e-6, `${next.what} ${(next.t - d.t).toFixed(3)} s after 物种爆发`);
  }
});

test('an attack-class skill its leader cannot cast (here: silenced, the skill made silenceable) leaves the turn to the normal strike', () => {
  // attackSlotSkill checks canCast like the own-timer path: 昆图斯 is immune to silence and stun and its skills are not
  // silenceable (no `sil`), so both are forced here — the case of a later attack-class skill on another leader. A stun
  // stops the swing itself (no turn at all).
  const { h, e } = quintus(TWO());
  thirdForm(h);
  const ab = e.mem.ab;
  const tide = ab.list.find((a) => a.sk === ab.sk.TidewaterG2), rock = ab.list.find((a) => a.sk === ab.sk.RockfallG2);
  tide.sil = true; rock.sil = true;
  h.b.addBuff(e, { key: 'test:silence', persist: true, flags: { silence: true } });
  h.run(0.25);
  assert.ok(e.s.flags.silence, 'silenced');
  const mute = actions(h, e, 25).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
  assert.ok(mute.length >= 6, `${mute.length} turns`);
  assert.deepEqual(mute.filter((a) => a.what !== 'ATTACK'), [], 'no attack-class skill while silenced');
  assert.ok(tide.left <= 1e-9, 'the tide stays ready');
  h.b.removeBuff(e, 'test:silence');
  const back = actions(h, e, 10).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what));
  assert.match(back[0].what, /^(TidewaterG2|RockfallG2)$/, `first turn after the silence: ${back[0].what}`);
  h.b.addBuff(e, { key: 'test:stun', persist: true, flags: { stun: true } });
  h.run(0.25);
  assert.deepEqual(actions(h, e, 15).filter((a) => a.what === 'ATTACK' || /^(Tidewater|Rockfall)/.test(a.what)), [], 'stunned: no turn');
});
