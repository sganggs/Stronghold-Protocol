// server/sim/content/kits/ops/op-ascln.js — 阿斯卡纶 (char_4132_ascln) 自选 operator kit: 6★ 伏击客 (特种), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (AMB-X “无形，无情”, AMB-Y
// “阿斯卡纶的眼睛”) at every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4132_ascln): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS
// 阿斯卡纶 (死亡拘审 备注 and its {{**}} 最终乘算 (100−18×层数)%, S2 修正 / 备注, S3 备注, the AMB-X note), PRTS 分支特性信息
// 伏击客 ("嘲讽等级为-1"), PRTS 命中率, Arknights Terra Wiki "Ascalon" (死亡拘审: "The MSPD reduction and Arts damage stack
// additively"); the client's battle data read from the local install — buff_template_data ascln_t_1 / ascln_t_1[debuff]
// (ON_OUTPUT_DAMAGE of NORMAL attacks; STACK, the duration refreshed; per trigger buff count × atk_ratio × ATK, MAGICAL,
// attack type BUFF), ascln_t_2 (CheckHeightTypeInRange x-5 ≥ cnt), ascln_s_2[enemy] (ON_OWNER_KILLED of a WALK enemy:
// the debuff in a circle of range_radius on the WALK_ONLY enemies but the dead one), ascln_s_3[self] (heal on
// ON_EVADE_DAMAGE and on a HIT_FAILED damage), ascln_e_003_t_1[heal] (a heal when the enemy holding it finishes).
// - Trait (伏击客) "对攻击范围内所有敌人造成伤害；拥有50%的物理和法术闪避且不容易成为敌人的攻击目标": the stalker profile — every
//   enemy of her range at once, melee, ground only (no "可对空"), physical — and 50 % physical / arts dodge (trait bb prob;
//   AMB-Y: 65 %). "不容易成为敌人的攻击目标" is her taunt level −1, which her data stats already carry (PRTS 伏击客 "嘲讽等级为
//   -1"): the kit trait installs the dodge without the profile's own extra −1 (professions.js installStalker adds one on
//   top of the data's — a double count reported for 水月, whose kit keeps the profile; not changed here).
//   AMB-X adds "攻击范围内所有敌人移动速度-20%" (hidden talent move_speed): every enemy of her current range, air units too,
//   moves ×(1 + move_speed); PRTS "多个伏击客X模组之间的减速效果可叠加" — one slow per 阿斯卡纶 (her own key).
// - T1 死亡拘审 "攻击对敌人施加效果：移动速度降低18％，每秒受到10％阿斯卡纶当前攻击力的法术伤害，持续25秒，效果最多叠加三层"
//   (bb move_speed / atk_ratio / max_stack_cnt / debuff_duration / interval): every damage instance of her attacks (S1's two
//   strikes are two attacks) adds a layer (≤ max_stack_cnt) and resets the duration (PRTS 备注); the target moves
//   ×(1 − 0.18 × layers) (PRTS 最终乘算 (100−18×层数)%) and takes layers × atk_ratio × her CURRENT ATK as arts damage every
//   `interval` s (Terra Wiki: both parts stack additively; PRTS 伤害分类 法术持续伤害 — not dodgeable, tag 'dot'); "自身退场后，
//   所有已施加的本天赋效果将立刻结束". One effect per 阿斯卡纶 [ASSUMED]. AMB-X stage 3: 11 %, 30 s (the talent change).
//   AMB-Y stage 3 adds "拥有该效果的敌人被击倒时阿斯卡纶回复10%生命" (hp_ratio): a heal of hp_ratio × her max HP whoever knocks
//   such an enemy out, while she is on the field.
// - T2 噬光残影 "攻击速度+8，自身周围四格有高台时，攻击速度额外+6" (full potential: +10; bb attack_speed / attack_speed_add / cnt): ASPD +10, +6 more
//   while at least `cnt` of the four tiles next to her are 高台 (heightType HIGHLAND in the level files — the 高台 deploy
//   tiles and the HIGHLAND forbidden tiles), judged at each deployment.
// - S1 追袭 (AUTO, 2 / 3 charges, data DEFAULT — a "next attack" skill): the next attack at atk_scale × ATK and "连续攻击两
//   次": every enemy of her range struck twice (bb cnt is the charge count, not the strikes).
// - S2 恩赐 (MANUAL, 35 s, data DEFAULT): ATK +atk; PRTS 修正 (原因 "描述与游戏实际表现不符合"): "使攻击范围内所有敌人移动速度
//   -N%" — every enemy of her range, air units too, moves ×(1 − |move_speed|) (refreshed every AURA_IV s, 同名 keeps the
//   strongest — two 阿斯卡纶 do not stack [ASSUMED]) — and "在地面敌人被击倒时对周围地面敌人施加一层第一天赋效果": a ground
//   enemy of her range knocked out (by anyone [ASSUMED]) gives one 死亡拘审 layer to every selectable ground enemy within
//   range_radius (PRTS 备注 "尸爆半径1.3", a 中点判定 around it).
// - S3 降临 (MANUAL, 45 s, data ACTIVE_RANGE on its y-10): range y-10, ATK +atk, base attack time + base_attack_time s
//   (−1.2 / −1.5 on 3.5 s), taunt level +taunt_level (PRTS 备注 "从-1提升至1"); ground enemies of her range have their
//   物理 / 法术命中率 −N % (PRTS 命中率: an attack of that damage type rolls once when it starts and misses as a whole —
//   every target and hit of it; here one roll per enemy attack at its first damage instance, a battle-wide `hit` handler
//   as 娜仁图亚's / Raidian's, the strongest of the 阿斯卡纶 whose range holds the attacker; several kinds of 命中率 cuts roll
//   apart [ASSUMED]); "敌人未命中自身或自身闪避时回复5%最大生命值": attack@hp_ratio × her max HP for each enemy attack her cut
//   makes miss her and each dodge of hers, while it runs (a heal: no 生命回复速度 note).

import { num, talentBb, moduleBb, traitBb, skillRec, up, batMod } from '../shared/tier1.js';
import { canTargetEnemy } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { hasHp, cancelDamage } from '../../../attack.js';

const S1 = 'skchr_ascln_1';
const S2 = 'skchr_ascln_2';
const S3 = 'skchr_ascln_3';
/** Refresh period / length of the range auras (S2's slow, AMB-X's slow): the kits' non-stacking aura convention. */
const AURA_IV = 0.25;
const AURA_DUR = 0.4;
/** S3's 命中率 handler runs before the enemy content's own hit riders (priority 200), after Raidian's / 娜仁图亚's (300). */
const MISS_PRIORITY = 290;
/** Tag of the 死亡拘审 ticks (法术持续伤害). */
export const DREAD_TAG = 'ascln:dread';
const ANY = Object.freeze({ canHitFly: true });
/** The four tiles next to her (offsets: direction does not matter). */
const ADJ4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Buff key of her 死亡拘审 on an enemy (one per 阿斯卡纶). */
export const dreadKey = (src) => `ascln:dread#${src.id}`;

/**
 * One layer of 死亡拘审 from `src` on enemy `e` (talent blackboard `tb`): ≤ max_stack_cnt layers, the duration reset,
 * move ×(1 − ms × layers), layers × atk_ratio × src's current ATK arts every interval s while src is on the field.
 */
export function addDread(battle, src, e, tb) {
  if (!e || !e.alive || e.side !== 'enemy' || !hasHp(e)) return null;
  const key = dreadKey(src);
  const max = Math.max(1, Math.floor(num(tb.max_stack_cnt, 3)));
  const ms = Math.abs(num(tb.move_speed)), dur = num(tb.debuff_duration, 25), iv = num(tb.interval, 1), ratio = num(tb.atk_ratio);
  if (!(dur > 0)) return null;
  const old = e.findBuff(key);
  const n = Math.min(max, (old?.data?.n ?? 0) + 1);
  const mods = { moveMul: Math.max(0, 1 - ms * n) };
  if (old) {
    old.data.n = n;
    old.mods = mods;
    old.timeLeft = dur;
    old.duration = dur;
    e.markDirty();
    return old;
  }
  return battle.addBuff(e, {
    key, duration: dur, mods, source: src, interval: iv > 0 ? iv : 1, data: { n }, tags: ['talent', 'dot'],
    onTick: ({ battle: b, unit: t, buff }) => {
      if (!up(src)) { b.removeBuff(t, buff); return; }
      if (!(ratio > 0)) return;
      b.dealDamage({ source: src, target: t, amount: src.s.atk * ratio * buff.data.n, type: 'arts',
        attackType: 'BUFF', applyWay: 'MELEE', dodgeMode: 'ignore', tags: ['talent', 'dot', DREAD_TAG] });
    },
  });
}

// ---- S3 命中率: one battle-wide handler over every 阿斯卡纶 of the battle ---------------------------------------------------
/** battle → { srcs: [{ unit, phys, arts, heal }], last: WeakMap(enemy → { id, miss }) }. */
const MISS = new WeakMap();
const s3On = (u) => !!(u.skill && u.skill.active && u.skill.id === S3);

function missCut(st, e, type) {
  let cut = 0;
  for (const s of st.srcs) {
    const v = type === 'arts' ? s.arts : s.phys;
    if (v > cut && up(s.unit) && s3On(s.unit) && s.unit.rangeKeySet && bodyInRange(e, s.unit.rangeKeySet)) cut = v;
  }
  return Math.min(1, cut);
}

function missHit(battle, st, ctx) {
  const e = ctx.source, d = ctx.dmg;
  if (!e || e.side !== 'enemy' || e.isFlying || !d || !d.isAttack || d.cancel || (d.type !== 'phys' && d.type !== 'arts')) return;
  // one roll per attack: every damage instance of it shares the first instance's result
  const prev = d.attackId ? st.last.get(e) : null;
  let miss, first = false;
  if (prev && prev.id === d.attackId) miss = prev.miss;
  else {
    first = true;
    const cut = missCut(st, e, d.type);
    miss = cut > 0 && battle.rng() < cut;
    if (d.attackId) st.last.set(e, { id: d.attackId, miss });
  }
  if (!miss) return;
  const cancelled = cancelDamage(d, 'miss');
  if (cancelled) ctx.stopPropagation = true;
  const t = ctx.target;
  if (t) battle.fx('dodge', { x: t.x, y: t.y, id: t.id });
  // 敌人未命中自身: the 阿斯卡纶 it aimed at heals (once per missed attack)
  if (first && t) for (const s of st.srcs) if (s.unit === t && up(t) && s3On(t) && s.heal > 0) battle.heal(t, t, t.s.maxHp * s.heal, { self: true });
}

function installMiss(battle, unit, phys, arts, heal) {
  if (!(phys > 0) && !(arts > 0)) return;
  let st = MISS.get(battle);
  if (!st) {
    st = { srcs: [], last: new WeakMap() };
    MISS.set(battle, st);
    // no owner: it serves every 阿斯卡纶 of the battle, whichever is on the field
    battle.on('hit', (ctx) => missHit(battle, st, ctx), { priority: MISS_PRIORITY });
  }
  st.srcs.push({ unit, phys, arts, heal });
}

export default {
  char_4132_ascln: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);
    const dodge = num(traitBb(chess).prob, 0.5);
    const picked = chess?.skill?.skillId ?? null;
    return {
      trait: {
        // 伏击客: the dodge; the taunt level −1 is in her stats (no second −1)
        install(battle, unit) {
          const p = num(unit.profile?.dodge, dodge);
          if (p > 0) battle.addBuff(unit, { key: 'trait:stalker', mods: { dodgePhys: p, dodgeArts: p }, persist: true, allowDead: true });
        },
      },
      skills: {
        [S1]: {
          kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: { atkScale: num(b1.atk_scale, 1), hits: 2 },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk) },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess), taunt: num(b3.taunt_level) },
          targeting: s3?.rangeGrid ? { rangeGrid: s3.rangeGrid.map((p) => [p[0], p[1]]) } : undefined,
        },
      },
      talents: [
        { install(battle, unit) { // 死亡拘审 (+ AMB-Y stage 3: a heal when an enemy carrying it is knocked out)
          battle.on('damaged', (ctx) => {
            const d = ctx.dmg, e = ctx.target;
            if (ctx.source !== unit || !up(unit) || !d || !d.isAttack || !e || e.side !== 'enemy' || d.type === 'element') return;
            addDread(battle, unit, e, t0);
          }, { owner: unit });
          const key = dreadKey(unit);
          battle.on('death', (ctx) => {
            const u = ctx.unit;
            if (u === unit) { // 自身退场后，所有已施加的本天赋效果将立刻结束
              for (const e of battle.enemies) if (e.findBuff(key)) battle.removeBuff(e, key);
              return;
            }
            const hr = num(t0.hp_ratio);
            if (hr > 0 && u.side === 'enemy' && ctx.reason === 'killed' && up(unit) && u.findBuff(key)) battle.heal(unit, unit, unit.s.maxHp * hr, { self: true });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 噬光残影: ASPD +10, +6 with 高台 among the four tiles next to her
          const base = num(t1.attack_speed), add = num(t1.attack_speed_add), cnt = Math.max(1, Math.floor(num(t1.cnt, 1)));
          const KEY = 'talent:ascln:shadow';
          const apply = (r, c) => {
            let n = 0;
            for (const [dr, dc] of ADJ4) {
              const rr = r + dr, cc = c + dc;
              if (battle.grid.inBounds(rr, cc) && battle.grid.tile(rr, cc).height === 'HIGH') n++;
            }
            const v = base + (n >= cnt ? add : 0);
            if (v) battle.addBuff(unit, { key: KEY, mods: { aspd: v }, persist: true, allowDead: true, tags: ['talent'], data: { high: n } });
          };
          apply(unit.homeR ?? unit.tileR, unit.homeC ?? unit.tileC);
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) apply(unit.tileR, unit.tileC); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // AMB-X: every enemy of her range moves ×(1 + move_speed) (one slow per 阿斯卡纶: they stack — PRTS)
        const mx = num(hidden.move_speed);
        if (mx < 0) {
          const key = `ascln:ambx#${unit.id}`;
          battle.every(AURA_IV, () => {
            if (!up(unit)) return;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) battle.addBuff(e, { key, duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + mx) }, source: unit, tags: ['module'] });
          }, { owner: unit, immediate: true });
        }
        if (picked === S2) {
          const ms = Math.abs(num(b2.move_speed)), radius = num(b2.range_radius, 1.3);
          const slow = () => {
            if (!up(unit) || !unit.skill?.active) return;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) {
              battle.applyStrongest(e, 'ascln:s2slow', { duration: AURA_DUR, value: ms, mods: (v) => ({ moveMul: Math.max(0, 1 - v) }), source: unit });
            }
          };
          if (ms > 0) {
            battle.on('skillStart', (ctx) => { if (ctx.unit === unit) slow(); }, { owner: unit });
            battle.every(AURA_IV, slow, { owner: unit });
          }
          // a ground enemy of her range knocked out ⇒ one 死亡拘审 layer on the selectable ground enemies within the radius
          battle.on('death', (ctx) => {
            const v = ctx.unit;
            if (ctx.reason !== 'killed' || !v || v.side !== 'enemy' || v.isFlying || !up(unit) || !unit.skill?.active || !unit.rangeKeySet || !bodyInRange(v, unit.rangeKeySet)) return;
            battle.fx('aoe', { x: v.x, y: v.y, radius, id: unit.id, skill: 'ascln:endowment' });
            for (const e of battle.foesInRadius(v.x, v.y, radius, true)) {
              if (e !== v && !e.isFlying && canTargetEnemy(unit, e, ANY)) addDread(battle, unit, e, t0);
            }
          }, { owner: unit });
        }
        if (picked === S3) {
          const heal = num(b3['attack@hp_ratio']);
          installMiss(battle, unit, Math.abs(num(b3['attack@damage_hitrate_physical'])), Math.abs(num(b3['attack@damage_hitrate_magical'])), heal);
          // 自身闪避时回复…最大生命值
          if (heal > 0) {
            battle.on('dodge', (ctx) => {
              if (ctx.target !== unit || !up(unit) || !s3On(unit) || !ctx.source || ctx.source.side !== 'enemy') return;
              battle.heal(unit, unit, unit.s.maxHp * heal, { self: true });
            }, { owner: unit });
          }
        }
      },
    };
  },
};
