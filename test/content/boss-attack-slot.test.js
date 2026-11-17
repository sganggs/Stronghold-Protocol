// test/content/boss-attack-slot.test.js — the attack-class skills of the leaders and parts other than 昆图斯 take the
// attack's turn (DESIGN §35.29, after §35.19's 昆图斯 fix). Official: each skill's prefab ability is a MeleeAttack /
// RangedAttack / MultiRangedAttack (fx/index.json units.<key>.skills), PRTS's skill rules 「大多数技能自动触发会占用攻击
// 间隔」, 「优先级相同则随机触发其中之一」, 「同一技能的冷却时间于该技能结束时开始计时」. Until 0.3.2 they ran on their own
// timers (阿利斯泰尔's 王权号令 on its SP) on top of the attacks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { ATTACK_SKILL_CLIP } from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const FX = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../public/assets/local/fx/index.json', import.meta.url), 'utf8')); } catch { return null; } })();
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });

function field(units, { tpl = null, overrides = null, kind = 'boss' } = {}) {
  const chess = { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3') };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 900, kind,
    sharedBoss: { hp: 1e9, maxHp: 1e9, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
    defs: { chess }, kits: { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK }, enemies: [], units,
    setup(b) { if (tpl) b.opts.templateId = tpl; if (overrides) b.enemyOverrides = overrides; },
  });
  h.step();
  return h;
}
const put = (h, key, pos, o = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: o.move ? 1 : 0 }, tag: o.tag ?? 'boss', route: o.route });
const abilityOf = (e, prefabKey) => { const sk = e.mem.ab.sk[prefabKey]; return e.mem.ab.list.find((a) => a && a.sk === sk); };

/** Every action of `e` over `secs` game s: { t, what } — a cast (its ability's prefabKey among `keys`) or 'ATTACK'. */
function actions(h, e, secs, keys) {
  const out = [];
  const abs = keys.map((k) => [k, typeof k === 'function' ? null : abilityOf(e, k)]);
  const seen = new Map(abs.map(([k, a]) => [k, a?.casts ?? 0]));
  let attacks = e.stats.attacks;
  const end = h.b.time + secs;
  while (h.b.time < end - 1e-9 && e.alive) {
    h.step();
    for (const [k, a] of abs) { const n = a?.casts ?? 0; if (n > seen.get(k)) { out.push({ t: h.b.time, what: k }); seen.set(k, n); } }
    if (e.stats.attacks > attacks) { for (let i = attacks; i < e.stats.attacks; i++) out.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  return out;
}
/** One action per turn: no two actions closer than the attack interval, no cast in the tick of an attack. */
function oneActionPerTurn(log, iv, label) {
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= iv - 1e-6, `${label}: ${log[i - 1].what} then ${log[i].what} ${(log[i].t - log[i - 1].t).toFixed(3)} s apart`);
}
const sk = (key, p) => E[key].skills.find((s) => s.prefabKey === p);

test('ATTACK_SKILL_CLIP: the length of the clip each attack-class skill\'s official ability plays (data/assets.json; fx index when extracted)', () => {
  for (const [key, skills] of Object.entries(ATTACK_SKILL_CLIP)) {
    const anims = A.enemies[key].spine.animations;
    for (const [p, len] of Object.entries(skills)) {
      assert.ok(E[key].skills.some((s) => s.prefabKey === p), `${key} ${p}: a data skill`);
      if (!FX) continue;
      const ab = (FX.units[key].skills[p.toLowerCase()] || {}).abilities || [];
      const animKey = ab.map((x) => x.animKey).find(Boolean);
      if (!animKey) { assert.equal(len, 0, `${key} ${p}: no clip in the prefab`); continue; }
      assert.ok(/Attack$/.test(ab.find((x) => x.animKey === animKey).class), `${key} ${p}: an attack-class ability`);
      assert.equal(anims[animKey], len, `${key} ${p}: ${animKey}`);
    }
  }
});

test('卢西恩 / 不祥幻影 (lucienCore): the aoe takes an attack\'s turn — one action per interval, never in an attack\'s tick, ready again its cooldown + clip after', () => {
  // 不祥幻影 has 卢西恩's aoe without the blink, so it stays at its blocker
  const key = 'enemy_2017_csphts';
  const h = field([{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 11, col: 6 }], { kind: 'normal' });
  const e = put(h, key, [10, 8], { move: true, tag: null, route: { motion: 'WALK', start: [10, 8], end: [10, 2], checkpoints: [] } });
  // (after its fifth attack the phantom leaves its blocker — unchanged behaviour —, so the window ends there)
  const log = actions(h, e, 22, ['aoe']);
  const iv = e.s.interval;
  const aoes = log.filter((a) => a.what === 'aoe'), attacks = log.filter((a) => a.what === 'ATTACK');
  assert.ok(aoes.length >= 1 && attacks.length >= 3, `aoe ${aoes.length}, attacks ${attacks.length}`);
  assert.ok(aoes[0].t >= sk(key, 'aoe').initCooldown - 1e-6, 'not before its initial cooldown');
  oneActionPerTurn(log, iv, '不祥幻影');
  const ready = sk(key, 'aoe').cooldown + ATTACK_SKILL_CLIP[key].aoe;
  for (let i = 1; i < aoes.length; i++) {
    const gap = aoes[i].t - aoes[i - 1].t;
    assert.ok(gap >= ready - 1e-6 && gap <= ready + iv + 0.05, `aoe gap ${gap.toFixed(3)} (ready ${ready}, interval ${iv})`);
  }
  assert.ok(abilityOf(put(h, 'enemy_2016_csphtm', [3, 15]), 'aoe').atk, '卢西恩\'s aoe is the same attack-class ability');
  // with nobody to attack, no aoe either
  const q = field([], { kind: 'normal' });
  const lone = put(q, key, [9, 8]);
  q.run(40);
  assert.equal(abilityOf(lone, 'aoe').casts ?? 0, 0);
});

test('卢西恩 / 不祥幻影: unblocked, the aoe still takes the ready attack\'s turn with an operator within radius 2 (its own trigger selector)', () => {
  // PRTS 不祥幻影 「仅在半径2范围内存在我方单位时触发」: the trigger is any selectable operator in the radius, not the attack's
  // own target — a melee enemy nobody blocks has none (卢西恩 past his blocker). Its turn comes when the attack is ready
  // and no swing started (enemies.js onTick, `own`); the attack cooldown restarts as after a strike (DESIGN §35.29).
  for (const key of ['enemy_2017_csphts', 'enemy_2016_csphtm']) {
    const h = field([{ chessId: 't_wall', row: 11, col: 8 }], { kind: 'normal' });
    const e = put(h, key, [10, 9], { tag: null });
    const a = abilityOf(e, 'aoe');
    assert.ok(a.own, `${key}: the aoe has a trigger selector of its own`);
    const log = actions(h, e, 30, ['aoe']);
    assert.equal(e.blockedBy, null, `${key}: nobody blocks it`);
    assert.equal(e.stats.attacks, 0, `${key}: no normal attack (melee, unblocked)`);
    const aoes = log.filter((x) => x.what === 'aoe');
    assert.ok(aoes.length >= 2, `${key}: aoe ${aoes.length}`);
    assert.ok(aoes[0].t >= sk(key, 'aoe').initCooldown - 1e-6, `${key}: not before its initial cooldown`);
    const ready = sk(key, 'aoe').cooldown + ATTACK_SKILL_CLIP[key].aoe;
    for (let i = 1; i < aoes.length; i++) assert.ok(aoes[i].t - aoes[i - 1].t >= ready - 1e-6, `${key}: aoe gap`);
    // a cast restarts the attack cooldown (the attack's turn spent)
    const before = a.casts;
    while (a.casts === before && h.b.time < 120) h.step();
    assert.ok(Math.abs(e.atkCd - e.s.interval) < 1e-9, `${key}: atkCd ${e.atkCd} after the cast`);
    // out of the radius: no turn for the aoe
    const q = field([{ chessId: 't_wall', row: 4, col: 2 }], { kind: 'normal' });
    const far = put(q, key, [10, 9], { tag: null });
    q.run(40);
    assert.equal(abilityOf(far, 'aoe').casts ?? 0, 0, `${key}: nobody within radius 2`);
  }
});

test('假想敌：胄: 【灭顶之灾】 replaces an attack (priority 1); 死亡集群 keeps its own timer', () => {
  const key = 'enemy_9013_acstmk';
  const h = field([{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 12, col: 4 }], { tpl: 'act1autochess_h07_01' });
  const e = put(h, key, [3, 10]);
  const log = actions(h, e, 140, ['1', '2']);
  const iv = e.s.interval;
  const shells = log.filter((a) => a.what === '1');
  assert.ok(shells.length >= 4, `${shells.length} shells`);
  assert.ok(Math.abs(shells[0].t - sk(key, '1').initCooldown) <= iv + 0.05, `first at ${shells[0].t.toFixed(3)}`);
  oneActionPerTurn(log.filter((a) => a.what !== '2'), iv, '胄');
  for (let i = 1; i < shells.length; i++) assert.ok(shells[i].t - shells[i - 1].t >= sk(key, '1').cooldown + ATTACK_SKILL_CLIP[key][1] - 1e-6);
  assert.ok(log.some((a) => a.what === '2'), '死亡集群 still comes');
});

test('假想敌：管 / 弦: 【裂管之奏】 / 【断弦之奏】 take a strike\'s turn on 余音', () => {
  const h = field([{ chessId: 't_wall', row: 10, col: 6 }], { tpl: 'act1autochess_h08_03' });
  const pipe = put(h, 'enemy_9021_acduml_2', [3, 10]);
  const str = put(h, 'enemy_9022_acdumm', [3, 11], { tag: 'part' });
  put(h, 'enemy_9023_acdums', [3, 6], { tag: 'part' });
  const gold = put(h, 'enemy_9023_acdums', [4, 6], { tag: 'part' });
  bossesMod.setEchoForm(h.b, gold, 'gold');
  const log = actions(h, pipe, 120, ['1']);
  const casts = log.filter((a) => a.what === '1');
  assert.ok(casts.length >= 1, '裂管之奏 cast');
  oneActionPerTurn(log, pipe.s.interval, '管');
  for (const c of casts) {
    const next = log.find((a) => a.t > c.t + 1e-9);
    if (next) assert.ok(next.t - c.t >= ATTACK_SKILL_CLIP[pipe.defId][1] - 1e-6, 'no strike inside 裂管之奏\'s longer clip');
  }
  assert.ok((abilityOf(str, '1').casts ?? 0) >= 1, '断弦之奏 cast');
  // 弦 alone with a gold echo: its 断弦之奏 in its own strike turn
  const q = field([{ chessId: 't_wall', row: 10, col: 6 }], { tpl: 'act1autochess_h08_03' });
  const s2 = put(q, 'enemy_9022_acdumm', [3, 11], { tag: 'part' });
  bossesMod.setEchoForm(q.b, put(q, 'enemy_9023_acdums', [4, 6], { tag: 'part' }), 'gold');
  const log2 = actions(q, s2, 80, ['1']);
  assert.ok(log2.some((a) => a.what === '1'), '断弦之奏 cast');
  oneActionPerTurn(log2, s2.s.interval, '弦');
});

test('阿利斯泰尔: 【王权号令】 with full SP takes the next attack\'s turn (not at once on top of the attacks); 斥退 (priority 5) too', () => {
  const key = 'enemy_9032_aclionk';
  const ov = JSON.parse(JSON.stringify(W.act1autochess_h07_06.overrides));
  ov[key].skills.find((s) => s.prefabKey === 'Suicide').initCooldown = 60;
  const h = field([{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }], { overrides: ov });
  const e = put(h, key, [3, 11]);
  const decree = e.mem.ab.list.find((a) => a && a.atk && !a.sk);
  assert.ok(decree, '王权号令 is an attack-class ability');
  const cost = ov[key].skills.find((s) => s.prefabKey === 'equip').spCost;
  const log = [];
  let n = 0, attacks = 0;
  while (h.b.time < 120) {
    h.step();
    if ((decree.casts ?? 0) > n) { log.push({ t: h.b.time, what: 'decree' }); n = decree.casts; }
    if ((abilityOf(e, 'Suicide').casts ?? 0) > 0 && !log.some((a) => a.what === 'Suicide')) log.push({ t: h.b.time, what: 'Suicide' });
    if (e.stats.attacks > attacks) { log.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  const decrees = log.filter((a) => a.what === 'decree');
  assert.ok(decrees.length >= 4, `${decrees.length} decrees`);
  assert.ok(decrees[0].t >= cost - 1e-6 && decrees[0].t <= cost + e.s.interval + 0.05, `first at ${decrees[0].t.toFixed(3)}`);
  oneActionPerTurn(log, e.s.interval, '阿利斯泰尔');
  // between two decrees at least one attack (the SP refills over cost s, at least one turn at the 8.2 s interval)
  for (let i = 1; i < decrees.length; i++) assert.ok(log.some((a) => a.what === 'ATTACK' && a.t > decrees[i - 1].t && a.t < decrees[i].t), `an attack between decrees ${i - 1} and ${i}`);
  assert.ok(log.some((a) => a.what === 'Suicide' && a.t >= 60), '斥退 at a turn after its initial cooldown');
});

test('阿利斯泰尔: 【王权号令】 needs a target in its own range — an attack whose target only the collider reach takes keeps its turn', () => {
  // the attack's reach adds the operator's collider (3.4 + 0.25), the decree selects within 3.4 (targetsNear): an operator
  // √13 ≈ 3.61 tiles away is attacked, but the decree has no target, so the full SP waits and the turn stays an attack
  // (without the target check in `cond` the turn would be spent on nothing and the SP kept)
  const key = 'enemy_9032_aclionk';
  const ov = JSON.parse(JSON.stringify(W.act1autochess_h07_06.overrides));
  ov[key].skills.find((s) => s.prefabKey === 'Suicide').initCooldown = 600;
  const h = field([{ chessId: 't_wall', row: 5, col: 14 }], { overrides: ov });
  const e = put(h, key, [3, 11]);
  const decree = e.mem.ab.list.find((a) => a && a.atk && !a.sk);
  const cost = ov[key].skills.find((s) => s.prefabKey === 'equip').spCost;
  h.run(cost + 4 * e.s.interval);
  assert.equal(decree.casts ?? 0, 0, 'no decree without a target in its range');
  assert.ok(e.stats.attacks >= 4, `the turns stay attacks (${e.stats.attacks})`);
});

test('“萨米的意志”: 【自然涌动】 takes a 冰凌 turn', () => {
  const key = 'enemy_9033_acdeer';
  const h = field([{ chessId: 't_wall', row: 9, col: 6 }, { chessId: 't_wall2', row: 12, col: 6 }]);
  const e = put(h, key, [3, 10]);
  const log = actions(h, e, 160, ['Lasso']);
  const lassos = log.filter((a) => a.what === 'Lasso');
  assert.ok(lassos.length >= 2, `${lassos.length} lassos`);
  assert.ok(lassos[0].t >= sk(key, 'Lasso').initCooldown - 1e-6 && lassos[0].t <= sk(key, 'Lasso').initCooldown + e.s.interval + 0.05);
  oneActionPerTurn(log, e.s.interval, '萨米');
});

test('“萨米的意志”: a shortened attack interval still waits for Doom\'s clip in its own attack loop', () => {
  const h = field([{ chessId: 't_wall', row: 9, col: 6 }]);
  const e = put(h, 'enemy_9033_acdeer', [3, 10]);
  h.b.addBuff(e, { key: 'test:haste', persist: true, mods: { aspd: 300 } });
  const doom = abilityOf(e, 'Doom');
  doom.left = 0;
  assert.ok(e.s.interval < doom.clip);
  const log = actions(h, e, 12, ['Lasso', 'Doom']);
  const cast = log.find((a) => a.what === 'Doom');
  assert.ok(cast, 'Doom cast');
  const next = log.find((a) => a.t > cast.t + 1e-9);
  assert.ok(next && next.t - cast.t >= doom.clip - 1e-6, 'no action inside the clip');
});
