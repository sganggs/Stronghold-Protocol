// test/content/enemy-attack-slot.test.js — the attack-class skills of the non-leader enemies and bounty leaders take the
// attack's turn (DESIGN §35.52, after §35.29's boss leaders and parts). Official: each skill's prefab ability is a
// MeleeAttack / RangedAttack / Multi*Attack (fx/index.json units.<key>.skills, from the client's battle/enm_pfb_*.ab);
// PRTS's skill rules 「大多数技能自动触发会占用攻击间隔」, 「同一技能的冷却时间于该技能结束时开始计时」. Until 0.3.2 they ran
// on their own timers on top of the attacks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { ENEMY_ATTACK_SKILL_CLIP, attackSkillOf } from '../../server/sim/content/enemies/helpers.js';
import { ATTACK_SKILL_CLIP } from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const FX = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../public/assets/local/fx/index.json', import.meta.url), 'utf8')); } catch { return null; } })();
const CLASSES_FILE = new URL('../fixtures/enemy-skill-classes.json', import.meta.url);
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const ATTACK_CLASS = /^(Multi)?(Melee|Ranged)Attack/;
/** fx index skill entry → { root, attack (an attack-class ability or a group with one), animKey (the first named clip) }. */
const classOf = (f) => ({
  root: f.rootAbility,
  attack: ATTACK_CLASS.test(f.rootAbility) || (/Group$/.test(f.rootAbility) && (f.abilities || []).some((x) => ATTACK_CLASS.test(x.class))),
  animKey: (f.abilities || []).map((x) => x.animKey).find(Boolean) || null,
});
/** The official ability class of every skill of the enemies with a kit (enemies.js KITS, the clip tables): from the fx
 *  index when extracted, else the committed fixture `test/fixtures/enemy-skill-classes.json` (so CI runs these checks
 *  too). With the extract, a test checks the fixture against it; `SP_UPDATE_FIXTURE=1` rewrites it. */
function skillClasses() {
  if (!FX) return JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8'));
  const out = {};
  const keys = [...new Set([...Object.keys(enemiesMod.KITS), ...Object.keys(ENEMY_ATTACK_SKILL_CLIP)])].filter((k) => E[k] && FX.units[k]).sort();
  for (const k of keys) {
    const sk = {};
    for (const p of Object.keys(FX.units[k].skills || {}).sort()) sk[p] = classOf(FX.units[k].skills[p]);
    out[k] = sk;
  }
  return out;
}
const CLS = skillClasses();

function field(units) {
  const chess = { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3') };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 900, kind: 'normal',
    sharedBoss: { hp: 1e9, maxHp: 1e9, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
    defs: { chess }, kits: { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK }, enemies: [], units,
  });
  h.step();
  return h;
}
const put = (h, key, pos) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0 } });
const abilityOf = (e, prefabKey) => { const sk = e.mem.ab.sk[prefabKey]; return e.mem.ab.list.find((a) => a && a.sk === sk); };

test('ENEMY_ATTACK_SKILL_CLIP: the clip of each attack-class skill\'s official ability (data/assets.json; fx index or its fixture)', () => {
  for (const [key, skills] of Object.entries(ENEMY_ATTACK_SKILL_CLIP)) {
    assert.ok(!ATTACK_SKILL_CLIP[key], `${key}: not one of the boss records' leaders and parts (bosses.js)`);
    const anims = A.enemies[key]?.spine?.animations || {};
    for (const [p, len] of Object.entries(skills)) {
      assert.ok(E[key].skills.some((s) => s.prefabKey === p), `${key} ${p}: a data skill`);
      assert.ok(Number.isFinite(len) && len >= 0);
      const c = CLS[key]?.[p.toLowerCase()];
      assert.ok(c, `${key} ${p}: in the class list`);
      assert.ok(c.attack, `${key} ${p}: an attack-class ability (${c.root})`);
      if (!c.animKey) assert.equal(len, 0, `${key} ${p}: no clip in the prefab`);
      else assert.equal(anims[c.animKey], len, `${key} ${p}: ${c.animKey}`);
    }
  }
});

test('the committed class fixture matches the fx index (when extracted; SP_UPDATE_FIXTURE=1 rewrites it)', { skip: !FX && 'no extracted fx index' }, () => {
  const text = `{\n${Object.entries(CLS).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`;
  if (process.env.SP_UPDATE_FIXTURE === '1') fs.writeFileSync(CLASSES_FILE, text);
  assert.deepEqual(JSON.parse(fs.readFileSync(CLASSES_FILE, 'utf8')), CLS);
});

/** The skills whose trigger is the attack's target (no selector of their own): they wait for a swing (DESIGN §35.54). */
const SWING_ONLY = new Set(['enemy_1513_dekght ChargeAttack', 'enemy_1517_xi ShieldBurst', 'enemy_1517_xi ShieldBurstReborn']);

test('each listed skill is built as an attack-class ability with its clip; 腐败骑士\'s charge and “自在”\'s 破桎而出 wait for a swing', () => {
  for (const [key, skills] of Object.entries(ENEMY_ATTACK_SKILL_CLIP)) {
    const h = field([]);
    const e = put(h, key, [9, 8]);
    for (const [p, len] of Object.entries(skills)) {
      const a = abilityOf(e, p);
      assert.ok(a, `${key} ${p}: an ability`);
      assert.equal(a.sk, e.mem.ab.sk[p], `${key} ${p}: skill slot available for the cast clip`);
      assert.equal(a.atk, true, `${key} ${p}: atk`);
      assert.equal(a.clip, len, `${key} ${p}: clip`);
      assert.equal(a.own, !SWING_ONLY.has(`${key} ${p}`), `${key} ${p}: own trigger`);
    }
  }
  assert.deepEqual(attackSkillOf('enemy_1504_cqbw', 'nothing'), {});
});

test('no other kit casts an attack-class official ability on its own timer (fx index or its fixture)', () => {
  // not attack turns: 暴鸰's one bomb is its attack (no normal attack), “帝国的甲胄” MultiCombat arms its next attack,
  // “巨大的丑东西”'s bomb is its 重生's (cooldown 9999)
  const KEEP = new Set(['enemy_1040_bombd boomb', 'enemy_10027_vtsk MultiCombat', 'enemy_1512_mcmstr bomb[reborning]']);
  const left = [], unmapped = [];
  for (const key of Object.keys(enemiesMod.KITS)) {
    if (!E[key] || !CLS[key]) continue;
    const h = field([]);
    const e = put(h, key, [9, 8]);
    if (!e || !e.mem.ab) continue;
    const sks = Object.entries(e.mem.ab.sk || {});
    for (const a of e.mem.ab.list) {
      if (!a || !a.fire || a.cd == null || a.atk) continue;
      // the data skill it runs: its `sk`, else (an ability built without one) the one skill
      // with its cooldown and initial cooldown
      const m = a.sk ? sks.filter(([, sk]) => sk === a.sk) : sks.filter(([, sk]) => sk.cd === a.cd && (sk.icd ?? 0) === (a.icd ?? 0));
      if (m.length !== 1) { unmapped.push(`${key} cd ${a.cd} icd ${a.icd}`); continue; }
      const p = m[0][0], c = CLS[key][p.toLowerCase()];
      if (c && c.attack && !KEEP.has(`${key} ${p}`)) left.push(`${key} ${p}`);
    }
  }
  assert.deepEqual(unmapped, [], 'cooldown abilities the sweep cannot map to a data skill');
  assert.deepEqual(left, []);
});

/** Every action of `e` over `secs` game s: { t, what } — a cast of skill `p` or 'ATTACK'. */
function actions(h, e, a, secs) {
  const out = [];
  let n = a.casts ?? 0, attacks = e.stats.attacks;
  const end = h.b.time + secs;
  while (h.b.time < end - 1e-9 && e.alive) {
    h.step();
    if ((a.casts ?? 0) > n) { out.push({ t: h.b.time, what: 'skill' }); n = a.casts; }
    if (e.stats.attacks > attacks) { out.push({ t: h.b.time, what: 'ATTACK' }); attacks = e.stats.attacks; }
  }
  return out;
}
const oneActionPerTurn = (log, iv, label) => {
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= iv - 1e-6, `${label}: ${log[i - 1].what} then ${log[i].what} ${(log[i].t - log[i - 1].t).toFixed(3)} s apart`);
};

test('W 【C4】 and 凋零骑士 【爆炸箭】 take an attack\'s turn — one action per interval, ready again its cooldown + clip after', () => {
  for (const [key, p] of [['enemy_1504_cqbw', 'C4'], ['enemy_1513_dekght_2', 'TripleAttack']]) {
    const h = field([{ chessId: 't_wall', row: 9, col: 6 }]);
    const e = put(h, key, [9, 7]);
    const a = abilityOf(e, p);
    const s = E[key].skills.find((x) => x.prefabKey === p);
    const log = actions(h, e, a, s.initCooldown + 3 * (s.cooldown + a.clip) + 3 * e.s.interval);
    const casts = log.filter((x) => x.what === 'skill');
    assert.ok(casts.length >= 2 && log.some((x) => x.what === 'ATTACK'), `${key}: ${casts.length} casts`);
    assert.ok(casts[0].t >= s.initCooldown - 1e-6, `${key}: not before its initial cooldown`);
    oneActionPerTurn(log, e.s.interval, key);
    for (let i = 1; i < casts.length; i++) assert.ok(casts[i].t - casts[i - 1].t >= s.cooldown + a.clip - 1e-6, `${key}: cooldown from the clip's end`);
  }
});

test('鼠王: 【唱沙】 / 【沙狱】 with no target in its attack range still take the ready attack\'s turn (their own selectors)', () => {
  const h = field([{ chessId: 't_wall', row: 9, col: 2 }]);
  const e = put(h, 'enemy_1509_mousek', [12, 9]);   // 7.6 tiles away, range 2.5
  const ds = abilityOf(e, 'DriftSand'), ss = abilityOf(e, 'SandStorm');
  h.run(60);
  assert.equal(e.stats.attacks, 0, 'nothing in its attack range');
  assert.ok((ds.casts ?? 0) >= 1 && (ss.casts ?? 0) >= 1, `唱沙 ${ds.casts}, 沙狱 ${ss.casts}`);
  // a cast spends the attack's turn: the cooldown restarts as after a strike
  const n = ds.casts;
  while (ds.casts === n && h.b.time < 200) h.step();
  assert.ok(Math.abs(e.atkCd - e.s.interval) < 1e-9);
});

test('a clip longer than the attack interval holds the next attack: no strike inside 自行炮\'s Cannon or W\'s C4 (DESIGN §35.54)', () => {
  for (const [key, p, row] of [['enemy_1273_stmgun_2', 'Cannon', 9], ['enemy_1504_cqbw', 'C4', 9]]) {
    const h = field([{ chessId: 't_wall', row, col: 6 }]);
    const e = put(h, key, [9, 7]);
    const a = abilityOf(e, p);
    assert.ok(a.clip > e.s.interval, `${key}: clip ${a.clip} over the interval ${e.s.interval}`);
    const s = E[key].skills.find((x) => x.prefabKey === p);
    const log = actions(h, e, a, s.initCooldown + 2 * (s.cooldown + a.clip) + 2 * e.s.interval);
    const casts = log.filter((x) => x.what === 'skill');
    assert.ok(casts.length >= 2, `${key}: ${casts.length} casts`);
    for (const c of casts) {
      const next = log.find((x) => x.t > c.t + 1e-9);
      if (next) assert.ok(next.t - c.t >= a.clip - 1e-6, `${key}: ${next.what} ${(next.t - c.t).toFixed(3)} s after the cast (clip ${a.clip})`);
    }
    assert.ok(log.some((x) => x.what === 'ATTACK'), `${key}: still attacks between the casts`);
  }
});

test('鼠王\'s own turns keep a normal attack\'s refusals: no 唱沙 / 沙狱 while 缴械 or 恐惧 (DESIGN §35.29)', () => {
  for (const st of ['disarm', 'fear']) {
    const h = field([{ chessId: 't_wall', row: 9, col: 2 }]);
    const e = put(h, 'enemy_1509_mousek', [12, 9]);
    const ds = abilityOf(e, 'DriftSand'), ss = abilityOf(e, 'SandStorm');
    const span = E.enemy_1509_mousek.skills.find((x) => x.prefabKey === 'SandStorm').initCooldown + 10;
    assert.equal(h.b.applyStatus(e, st, { duration: span, force: true, source: h.unit('t_wall') }), true, st);
    h.run(span - 1);
    assert.equal((ds.casts ?? 0) + (ss.casts ?? 0), 0, `${st}: no own-turn cast`);
    h.run(30);
    assert.ok((ds.casts ?? 0) >= 1, `${st} over: 唱沙 again`);
  }
});

test('an attack-class skill without a selector of its own (`own` false) is never cast from an attack ready with no swing', () => {
  const h = field([{ chessId: 't_wall', row: 9, col: 2 }]);
  const e = put(h, 'enemy_1509_mousek', [12, 9]);   // nothing in its attack range: no swing
  const ds = abilityOf(e, 'DriftSand'), ss = abilityOf(e, 'SandStorm');
  ds.own = false;   // its turn now needs a swing; 沙狱 keeps the own turns
  h.run(90);
  assert.equal(ds.casts ?? 0, 0, '唱沙 waits for a swing');
  assert.ok((ss.casts ?? 0) >= 1, '沙狱 still takes the own turns');
});

test('鼠王: 战栗 prevents own turns while blocked and allows them again when released', () => {
  const h = field([{ chessId: 't_wall', row: 9, col: 6 }, { chessId: 't_wall2', row: 9, col: 1 }]);
  const e = put(h, 'enemy_1509_mousek', [9, 6.5]);
  assert.equal(h.b.applyStatus(e, 'tremble', { duration: 100, force: true }), true);
  h.run(40);
  assert.ok(e.blockedBy, 'blocked throughout the refusal');
  const ds = abilityOf(e, 'DriftSand'), ss = abilityOf(e, 'SandStorm');
  assert.equal((ds.casts ?? 0) + (ss.casts ?? 0), 0, 'no own turns while blocked');
  h.b.retreat(h.unit('t_wall'));
  h.run(1);
  assert.equal(e.blockedBy, null);
  assert.ok((ds.casts ?? 0) + (ss.casts ?? 0) > 0, 'the ready own skill casts once unblocked');
});
