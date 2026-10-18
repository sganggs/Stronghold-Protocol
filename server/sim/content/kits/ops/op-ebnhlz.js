// server/sim/content/kits/ops/op-ebnhlz.js — 黑键 (char_4046_ebnhlz) 自选 operator kit: 6★ 秘术师 (术师), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, the three modules (MSC-X 源石骰子收纳盒, MSC-Y
// “乐理阐释者”, MSC-Δ 朽坏传承) at every form, and the kit of his S2 summon 旧日残影 (token_10024_ebnhlz_rcube). Kit contract
// and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4046_ebnhlz): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json),
// PRTS 黑键 / 旧日残影 (备注) and 分支特性信息 §秘术师, and the client's battle data (charpack char_4046_ebnhlz: the
// ExChargeAttack abilities, the talent config; skills sktok_ebnhlz_token / skchr_ebnhlz_1–3; buff templates ebnhlz_t_2,
// ebnhlz_e_003_*, ebnhlz_e_004_*).
// - Trait (秘术师) "攻击造成法术伤害，在找不到攻击目标时可以将攻击能量储存起来之后一齐发射（最多3个）" (bb times; MSC-X 4):
//   ranged arts bolts, hits air units (分支特性信息 "可对空"), blocks 1, ground enemies target him. The store (分支特性信息:
//   "能量储存与攻击占用相同的攻击间隔：…若无有效目标且能量储存数未满，则改为储存一份攻击能量（属于攻击行为）"): when his attack is
//   ready and he has no valid target he stores one energy and his attack interval starts again — the shared 秘术师
//   profile (professions.js installMystic) with this kit's `storeEnergy` (his elite energy, S3), as 维伊's. His next attack
//   releases them at its target ("一齐发射"), each hitting for ATK × the attack's scale × the energy scale (talent 1) as
//   an arts 普通伤害 attack hit ("由储存能量形成的弹道造成攻击力100%的法术普通伤害"); they land with the main bolt (one
//   volley to one target [ASSUMED], as 维伊's), the later ones only on a target still alive. [ASSUMED] a redeployment holds
//   no energy.
// - T1 强弱法 "储存的攻击能量造成的伤害提升至135%，可额外储存1份只用于攻击精英或领袖敌人的攻击能量" (bb atk_scale, times_2; MSC-X
//   stage 3: 1.43): every stored energy ×atk_scale; one more energy (the client's ExChargeAttack `_exProjectileKey`,
//   targetValidator enemyLevelMask 6 = ELITE | BOSS) stored once the trait's are full (备注 "通常情况下此“额外攻击能量”将在
//   特性能量全部储存完毕后再尝试储存") and released only by an attack on an elite or leader enemy (kept otherwise).
// - T2 倚音 "若攻击目标周围没有其他敌人，攻击对其额外造成相当于攻击力15%的法术伤害" (full potential: 17 %; bb atk_scale, cnt 0, range_radius 1.1): per
//   projectile — the main bolt and every energy (备注 "主攻击与每个攻击能量分别独立触发") — with at most `cnt` other selectable
//   enemies within range_radius of the target (中点判定; 备注 "可以攻击的装置类不影响判定"), ATK × atk_scale arts on it.
//   MSC-Y stage 3 (atk_scale 0.22, atk_scale_2 0.36): otherwise ATK × atk_scale_2 arts splash on each of those others (备注
//   "额外伤害的影响对象不包括主目标"; ebnhlz_e_003_t_2 AOEDamage SPLASH, every motion). MSC-Δ stage 3 (atk_scale 0.32,
//   element_atk_scale 0.3): and, on a target in its 凋亡 burst (its `apoptosisBurst` lock — ebnhlz_e_004[t_2_ele]
//   IsTargetInEPBreakRecovery DARK), ATK × element_atk_scale 元素伤害 after the arts (备注 "先造成法术伤害，后造成元素伤害").
// - MSC-X 源石骰子收纳盒: trait times 4 (above), attributes in the stats (ATK, ASPD). MSC-Y “乐理阐释者” "拥有已储存的攻击
//   能量时，攻击速度+30" (hidden module talent attack_speed): while any energy is stored (ebnhlz_e_003_trait: charge or ex
//   charge > 0). MSC-Δ 朽坏传承 "造成法术伤害时附带相当于8%伤害的凋亡损伤" (hidden ep_damage_ratio): every arts damage he deals
//   that removes HP attaches ep_damage_ratio × that damage of 凋亡损伤 (ebnhlz_e_004_tr ON_AFTER_OUTPUT_DAMAGE; the SIM.md
//   §7.2 convention "伤害N%的…损伤" = × the HP damage dealt); his 旧日残影 too (PRTS "旧日残影造成的伤害也可以附加相应的凋亡损伤",
//   ebnhlz_e_004_tr[token]).
// - S1 渐快急板 (MANUAL, 5 s, data DEFAULT — its 4-1 does not contain his 3-14): range 4-1, attack interval ×base_attack_time
//   (PRTS "大幅度缩短(*0.2)": batMod's ratio reading), every attack attack@atk_scale × ATK; the energies released meanwhile
//   use that scale too (备注 "该技能的“每次攻击的攻击倍率”会实时应用在特性积攒的“攻击能量”抛射物上") × the energy scale.
//   `attack@cnt` (1) has no text [unused].
// - S2 荒芜回响 (AUTO, instant): cast at full SP as soon as one placeable tile of his attack range is free — no enemy needed
//   (PRTS 备注 "攻击范围内不存在可部署位时，技能不会被触发"; the skill prefab's `_trigger._minTileNum` 1 — O20's report; 0.2.0 WE2:
//   until then the data's DEFAULT waited for an enemy in his range; `trigger: 'NEVER'` + this kit's cast, the pattern of
//   伺夜's conditional casts): spends every
//   stored energy (elite ones first: 备注 "可以消耗并优先消耗第一天赋储存的额外能量") and places energies + 1 旧日残影 on free
//   placeable tiles of his attack range (部署位置 全部位), in the 备注's order: tiles holding a selectable ground enemy (the
//   best of them first by his target order — 仇恨值 [ASSUMED: the engine's default operator order]), then the tiles nearest
//   another selectable ground enemy, then the rest at random (battle.rng); fewer free tiles than energies + 1 ⇒ fewer
//   energies spent; no free tile ⇒ no cast (备注 "攻击范围内不存在可部署位时，技能不会被触发": the charge is given back).
// - 旧日残影 (its kit below): no normal attack; 闪回 — once a selectable ground enemy (备注 "不对空") is within 1.35 of it, after
//   0.93 s (备注 "技能伤害与“拖拽”在激活0.93s后生效"; sktok_ebnhlz_token _preDelay) every selectable ground enemy within 1.35
//   then [ASSUMED: re-selected when it lands] takes 黑键's ATK × atk_scale arts from the remnant (备注 "伤害来源为召唤物自身，
//   伤害计算使用持有者的攻击力") and a 中力 (force 1) inward push towards it (备注 "此处的“拖拽”实际为反方向的推开"; template
//   mint_s_2[pull], Battle.push inward), then it withdraws (suicide). It leaves after the token talent's 30 s or when 黑键
//   leaves the field (备注; die_to_kill_token). Its data carries no 不会受到攻击: enemies may target it [ASSUMED]; no per-owner
//   deploy limit applies (several stand at once).
// - S3 寂静之声 (MANUAL, 30 s, data DEFAULT): ASPD +attack_speed, ATK +atk, attacks only elite or leader enemies (S3 mode
//   Trigger enemyLevelMask 6; with none in range he stores energy), every energy × talent_scale_multiplier (备注 "天赋伤害
//   加成与第一天赋数值直接做乘法计算"; the config trait_s3.atk_scale = atk_scale × talent_scale_multiplier). 备注 "技能开始时
//   将所有攻击能量转换为精英攻击能量，技能期间只生成精英攻击能量；技能结束时精英攻击能量会保留最多1份，溢出部分转换为普通的攻击能量":
//   at its start every energy becomes elite (cap times + times_2: the config trait_s3.times / trait_s3.times_2), it stores
//   only elite ones, and at its end at most times_2 stay elite, the rest normal (up to times). "可主动关闭" is a manual
//   operation (no automatic stop).

import { num, talentBb, moduleBb, traitBb, skillRec, batMod, up, toggleBuff } from '../shared/tier1.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { hasHp } from '../../../attack.js';
import { COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_ebnhlz_1';
const S2 = 'skchr_ebnhlz_2';
const S3 = 'skchr_ebnhlz_3';
/** 旧日残影, his S2 summon. */
export const REMNANT = 'token_10024_ebnhlz_rcube';
/** 闪回: activation radius = effect radius (PRTS 旧日残影 备注 "激活范围与技能生效的半径为1.35"). */
const REMNANT_RADIUS = 1.35;
/** 闪回: its damage and push land 0.93 s after the activation (PRTS 备注; sktok_ebnhlz_token `_preDelay` 0.93). */
const REMNANT_DELAY = 0.93;
/** The remnant's life when its talent carries none (PRTS "部署30秒后…自身自动撤退"). */
const REMNANT_LIFE = 30;
/** 倚音's radius when the talent carries none (PRTS 备注 "判定范围半径1.1"). */
const T2_RADIUS = 1.1;
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
/** An elite or leader enemy (the ELITE | BOSS level mask of the client's validators; targeting.js priority 'elite'). */
export const eliteOrLeader = (e) => !!e && (!!e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
/** His stored energies (per deployment): `n` normal, `e` elite, `q` the volleys in flight per target id. */
const stateOf = (unit) => unit.trait.ebn ?? (unit.trait.ebn = { n: 0, e: 0, q: new Map() });

/** A tile 荒芜回响 may place a 旧日残影 on: inside the field, deployable (全部位) and free (Battle.isReservedTile). */
const remnantTileOk = (battle, r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c, { ranged: true }) && !battle.isReservedTile(r, c);

/** Whether `unit`'s attack range holds one tile 荒芜回响 may use (its cast condition; no rng, unlike remnantTiles). */
function hasRemnantTile(battle, unit) {
  for (const k of unit.rangeKeys || []) if (remnantTileOk(battle, Math.floor(k / COLS), k % COLS)) return true;
  return false;
}

/**
 * The tiles 荒芜回响 may place 旧日残影 on (PRTS 备注 order): free deployable tiles of `unit`'s attack range — first those
 * holding a selectable ground enemy, by the best of them in his target order; then by the distance to the nearest
 * selectable ground enemy; then (no such enemy) at random.
 */
function remnantTiles(battle, unit) {
  const tiles = [];
  for (const k of unit.rangeKeys || []) {
    const r = Math.floor(k / COLS), c = k % COLS;
    if (remnantTileOk(battle, r, c)) tiles.push([r, c]);
  }
  if (!tiles.length) return tiles;
  const foes = battle.enemies.filter((e) => canTargetEnemy(unit, e, GROUND));
  sortEnemyTargets(battle, unit, foes, null);
  const rank = new Map();
  foes.forEach((e, i) => { const k = Math.round(e.y) * COLS + Math.round(e.x); if (!rank.has(k)) rank.set(k, i); });
  battle.rng.shuffle(tiles);   // the random order of the last group, and of equal distances [ASSUMED]
  const dist = (r, c) => { let d = Infinity; for (const e of foes) d = Math.min(d, hypot(e.x - c, e.y - r)); return d; };
  const keyed = tiles.map(([r, c], i) => ({ r, c, i, on: rank.get(r * COLS + c) ?? Infinity, d: dist(r, c) }));
  keyed.sort((a, b) => a.on - b.on || a.d - b.d || a.i - b.i);
  return keyed.map((x) => [x.r, x.c]);
}

/**
 * 旧日残影's kit: no normal attack; 闪回 once (a selectable ground enemy within REMNANT_RADIUS ⇒ REMNANT_DELAY s later the
 * blast and the inward push, then it withdraws); its life; it leaves with 黑键 (owner kit's death hook).
 */
function remnantKit(owner) {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, t) {
      const bb = t.def?.skill?.bb ?? {};
      const scale = num(bb.atk_scale, 1), force = num(bb.force, 1);
      const life = num((t.def?.talents ?? []).find((x) => x && x.bb && x.bb.duration != null)?.bb.duration, REMNANT_LIFE);
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== t) return;
        const seq = t.deploySeq;
        t.mem.flashback = false;
        if (life > 0) battle.after(life, () => { if (t.alive && t.deploySeq === seq) battle.retreat(t, { reason: 'expired', permanent: true }); }, { owner: t });
      }, { owner: t });
      battle.on('tick', () => {
        if (!t.alive || t.mem.flashback) return;
        if (!battle.foesInRadius(t.x, t.y, REMNANT_RADIUS, true).some((e) => !e.isFlying && canTargetEnemy(t, e, GROUND))) return;
        t.mem.flashback = true;
        const seq = t.deploySeq;
        battle.fx('aoe', { x: t.x, y: t.y, radius: REMNANT_RADIUS, id: t.id, dmgType: 'arts', skill: 'ebnhlz:flashback', t: REMNANT_DELAY });
        battle.after(REMNANT_DELAY, () => {
          if (!t.alive || t.deploySeq !== seq) return;
          const atk = owner && owner.s ? owner.s.atk : t.s.atk;
          for (const e of battle.foesInRadius(t.x, t.y, REMNANT_RADIUS, true)) {
            if (e.isFlying || !canTargetEnemy(t, e, GROUND)) continue;
            battle.dealDamage(t, e, { amount: atk * scale, type: 'arts', isSkill: true, tags: ['summon', 'ebnhlz:flashback'] });
            if (e.alive && battle.push(e, force, { from: t, inward: true }) > 0) battle.fx('pull', { x: e.x, y: e.y, id: e.id, src: t.id });
          }
          battle.retreat(t, { reason: 'expired', permanent: true });
        }, { owner: t });
      }, { owner: t });
    },
  };
}

export default {
  char_4046_ebnhlz: (bb, chess) => {
    const tb = traitBb(chess);
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // MSC-Y attack_speed, MSC-Δ ep_damage_ratio
    const b1 = bbOf(chess, S1), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1);
    const N = Math.max(1, Math.floor(num(tb.times, 3)));
    const E = Math.max(0, Math.floor(num(t0.times_2, 0)));
    const energyScale = num(t0.atk_scale, 1);
    const s3Mult = num(b3.talent_scale_multiplier, 1);
    const s1Scale = num(b1['attack@atk_scale'], 1);
    const t2 = {
      scale: num(t1.atk_scale), cnt: Math.max(0, Math.floor(num(t1.cnt, 0))), radius: num(t1.range_radius, T2_RADIUS),
      splash: num(t1.atk_scale_2), elem: num(t1.element_atk_scale),
    };
    const epRatio = num(hidden.ep_damage_ratio);

    /** 倚音 on the target of one projectile (the main bolt or one energy). */
    function yiyin(battle, unit, t, attackId) {
      if (!t || !t.alive) return;
      const others = battle.foesInRadius(t.x, t.y, t2.radius, true).filter((e) => e !== t);
      const atk = unit.s.atk;
      if (others.length <= t2.cnt) {
        if (t2.scale > 0) battle.dealDamage(unit, t, { amount: atk * t2.scale, type: 'arts', attackId, tags: ['talent', 'ebnhlz:yiyin'] });
      } else if (t2.splash > 0) {
        for (const e of others) battle.dealDamage(unit, e, { amount: atk * t2.splash, type: 'arts', isSplash: true, attackId, tags: ['talent', 'ebnhlz:yiyin'] });
      }
      if (t2.elem > 0 && t.alive && t.findBuff('apoptosisBurst')) {
        battle.dealDamage(unit, t, { amount: atk * t2.elem, type: 'elemental', element: 'apoptosis', attackId, tags: ['talent', 'ebnhlz:yiyin'] });
      }
    }

    /** The main bolt of an attack landed on `victim`: its 倚音, then every energy of its volley (and theirs). */
    function land(battle, unit, victim, hc) {
      const v = stateOf(unit);
      const list = v.q.get(victim.id);
      const rec = list ? list.shift() : null;
      if (list && !list.length) v.q.delete(victim.id);
      yiyin(battle, unit, victim, hc.attackId);
      if (!rec) return;
      const per = (rec.s1 ? s1Scale : 1) * energyScale * (rec.s3 ? s3Mult : 1);
      for (let i = 0; i < rec.n + rec.e && victim.alive; i++) {
        battle.dealDamage(unit, victim, { amount: unit.s.atk * per * unit.s.atkScaleMul, type: 'arts', isAttack: true, isSkill: !!hc.isSkill, attackId: hc.attackId, tags: ['ebnhlz:energy'] });
        yiyin(battle, unit, victim, hc.attackId);
      }
    }

    return {
      trait: {
        hitsFn: () => 1,   // the engine's main hit only: the stored energies are this kit's (land)
        onEachHit(battle, unit, victim, hc) { if (hc.kind === 'main' && victim && victim.side === 'enemy') land(battle, unit, victim, hc); },
        // the store (the shared profile calls it at his attack check with no valid target — professions.js installMystic:
        // an attack action, the interval restarts): the trait's energies first, then the elite one; during S3 elite ones
        // only (false = a full store: he idles)
        storeEnergy(battle, unit) {
          const v = stateOf(unit);
          if (skillOn(unit, S3)) { if (v.n + v.e >= N + E) return false; v.e++; }
          else if (v.n < N) v.n++;
          else if (v.e < E) v.e++;
          else return false;
          return true;
        },
        install(battle, unit) {
          battle.on('deploy', (ctx) => { if (ctx.unit === unit && !ctx.move) unit.trait.ebn = null; }, { owner: unit });
          battle.on('death', (ctx) => { if (ctx.unit && ctx.unit.side === 'enemy') stateOf(unit).q.delete(ctx.unit.id); }, { owner: unit });
        },
      },
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { batPct: batMod(b1.base_attack_time, chess, s1?.desc ?? '') },
          targeting: { rangeGrid: s1?.rangeGrid ?? null },
          attack: { atkScale: s1Scale },
        },
        [S2]: {
          kind: 'instant',
          trigger: 'NEVER',   // the kit's cast (install): full SP and one free placeable tile in his range
          onStart({ battle, unit, skill }) {
            const tiles = remnantTiles(battle, unit);
            if (!tiles.length) { skill.addCharge(1); return; }   // "攻击范围内不存在可部署位时，技能不会被触发"
            const v = stateOf(unit);
            const count = Math.min(v.n + v.e + 1, tiles.length);
            let spend = count - 1;
            const fromE = Math.min(v.e, spend);
            v.e -= fromE; spend -= fromE;
            v.n -= Math.min(v.n, spend);
            for (const [r, c] of tiles.slice(0, count)) {
              const t = battle.spawnToken(unit, REMNANT, r, c, { kit: remnantKit(unit) });
              if (t) battle.fx('summon', { x: t.x, y: t.y, id: t.id, token: REMNANT });
            }
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { aspd: num(b3.attack_speed), atkPct: num(b3.atk) },
          attack: { skipEnemy: (e) => !eliteOrLeader(e) },
          onStart({ unit }) { const v = stateOf(unit); v.e += v.n; v.n = 0; },
          onEnd({ unit }) {
            const v = stateOf(unit);
            const keep = Math.min(v.e, E);
            v.n = Math.min(N, v.n + v.e - keep);
            v.e = keep;
          },
        },
      },
      install(battle, unit) {
        // S2 荒芜回响: cast at full SP with one free placeable tile in his range, no enemy needed (see the header)
        if (unit.skill?.id === S2) {
          battle.on('tick', () => {
            const sk = unit.skill;
            if (!sk || !sk.ready || sk.active || !up(unit) || !unit.canAct || unit.s.flags.silence) return;
            if (hasRemnantTile(battle, unit)) sk.activate('SP_FULL');
          }, { owner: unit });
        }
        // MSC-Y: ASPD while any energy is stored
        const aspd = num(hidden.attack_speed);
        if (aspd) toggleBuff(battle, unit, 'trait:ebnhlz:stored', () => { const v = stateOf(unit); return v.n + v.e > 0; }, { aspd });
        // MSC-Δ: every arts damage of his (and of his 旧日残影) that removes HP attaches ep_damage_ratio × it of 凋亡损伤
        if (epRatio > 0) {
          battle.on('damaged', (ctx) => {
            const s = ctx.source, t = ctx.target;
            if (!s || ctx.type !== 'arts' || !(ctx.amount > 0) || !t || t.side !== 'enemy' || !hasHp(t)) return;
            if (s !== unit && !(s.kind === 'token' && s.defId === REMNANT && s.ownerUnit === unit)) return;
            battle.dealDamage(s, t, { type: 'element', element: 'apoptosis', amount: ctx.amount * epRatio, tags: ['module', 'ebnhlz:decay'] });
          }, { owner: unit });
        }
        // the energies leave with the attack: the normal ones always, the elite ones only at an elite / leader target
        battle.on('attack', (ctx) => {
          if (ctx.attacker !== unit || !ctx.targets.length) return;
          const v = stateOf(unit);
          ctx.targets.forEach((tg, i) => {
            if (!tg || tg.side !== 'enemy') return;
            const rec = { n: 0, e: 0, s1: skillOn(unit, S1), s3: skillOn(unit, S3) };
            if (i === 0) {
              rec.n = v.n; v.n = 0;
              if (eliteOrLeader(tg)) { rec.e = v.e; v.e = 0; }
              if (rec.n + rec.e > 0) battle.fx('volley', { x: unit.x, y: unit.y, id: unit.id, target: tg.id, n: rec.n + rec.e });
            }
            const list = v.q.get(tg.id) ?? [];
            list.push(rec);
            v.q.set(tg.id, list);
          });
        }, { owner: unit });
        // 旧日残影 leave with him (PRTS 备注 "黑键离场时，自身自动撤退"; die_to_kill_token)
        battle.on('death', (ctx) => {
          if (ctx.unit !== unit) return;
          for (const t of battle.allyUnits) if (t.alive && t.kind === 'token' && t.defId === REMNANT && t.ownerUnit === unit) battle.retreat(t, { reason: 'expired', permanent: true });
        }, { owner: unit });
      },
    };
  },
};
