// server/sim/content/kits/ops/standin-acsupo.js — Raidian (char_614_acsupo) 补位 stand-in kit: 6★ 凝滞师 for 灵知 (T4, S2),
// 夕 / 安洁莉娜 (T5, S3 + DEC-X) and 浊心斯卡蒂 / 仇白 (T6, S3 + DEC-X); every skill at every form.
// Kit contract and the stand-in rules: ../README.md ("Stand-in kits").
//
// Sources: data/backups.json (character_table / skill_table / battle_equip_table at E2 Lv1 rank 4 and E2 Lv60 rank 7),
// PRTS Raidian(卫戍协议) (S3 备注 on its 虚弱), PRTS 命中率 and the client's battle data (charpack char_614_acsupo).
// - 凝滞师 trait "攻击造成法术伤害，并对敌人造成短暂的停顿": arts, 停顿 `sluggish` s on every target (professions.js slower,
//   from the trait blackboard); S2 lengthens it (attack@sluggish).
// - T1 同调 "攻击速度+15，相邻的干员攻击速度+10" (module DEC-X level 2 / 3: 18 / 11, 20 / 12): her own ASPD (charpack
//   acsupo_t_1[self]) and an aura on the operators of the 4 tiles next to her (acsupo_t_1[ally]: profession mask of every
//   operator class — no summon —, removed when the target leaves); several sources keep the strongest [ASSUMED]. S3
//   multiplies both by talent_scale (the S3 mode's `_applyTalentScale`).
// - T2 诱引 "攻击范围内敌人的物理和法术命中率降低10%" (damage_hitrate_physical / damage_hitrate_magical): PRTS 命中率 — every
//   unit has 100 % 物理 / 法术命中率; an attack of that damage type made at a lower rate rolls once when it starts, and a
//   failed roll misses as a whole: every target and hit of that attack, its splash, and the effects it would carry
//   ("攻击未命中…在输出伤害事件前就算作处理失败", no 晕眩 / 停顿 …). Here: one roll per enemy attack (its `attackId`) while the
//   attacker stands in a Raidian's current attack range (S3's included), made by a battle-wide `hit` handler at
//   LURE_PRIORITY — before the enemy content's own hit riders (content/enemies.js, priority 200) and everything else —
//   which cancels every damage instance of a missed attack and stops the hook there. A target's own 闪避 is a separate roll
//   in the damage pipeline. [ASSUMED] the roll is made at the attack's first damage instance (a ranged enemy's at its
//   projectile's arrival; it stands still through its attack clip) rather than at its wind-up; two Raidians' cuts never
//   add up (the stronger one counts, like the mode's other same-named effects — the charpack's `disableOverride` might
//   mean they coexist); true damage is never affected (PRTS: neither 物理 nor 法术).
// - S1 双声 (24 s): ATK +atk, attack@max_target targets.
// - S2 三形 (14 / 17 s): base attack time + base_attack_time s (PRTS "略微缩短(-0.1)" / "缩短(-0.2)": a flat change, batMod),
//   attack@max_target targets, 停顿 attack@sluggish s.
// - S3 信号跃动 (30 / 35 s): range y-4 (the skill's rangeGrid) — its auto-cast is the data's ACTIVE_RANGE (the owner's rule
//   of 2026-10-05: an enemy inside the larger range casts it; tools/build-data.mjs resolveTrigger, not this kit) —, ATK
//   +acsupo_s_3.atk, T1 × talent_scale, and every enemy in her attack range takes 脆弱 damage_scale − 1 and 虚弱 1 − atk:
//   the catalogue statuses (同名效果取最高), refreshed every AURA_IV s while the skill runs. The 虚弱 stacks as `atk`
//   (0.9 / 0.8: PRTS 备注 "此技能的虚弱在叠加时视为90%（1级~6级）/80%（7级~专精二）…的虚弱（仅影响叠加优先级，不影响实际效果）"
//   — applyStatus `stackAs`), so it outranks every weaker 虚弱 while it lasts.
// - Module DEC-X "攻击范围内存在敌人时技力自然恢复速度+0.2/秒" (hidden talent sp_recovery_per_sec; acsupo_e_002_t: one
//   +0.2 whatever the number of enemies); HP / ATK in the stats; T1 changes at level 2 / 3 (composed talents).

import { canTargetEnemy } from '../../../targeting.js';
import { cancelDamage } from '../../../attack.js';
import { bodyInRange } from '../../../body.js';
import { num, talentBb, moduleBb, skillRec, statBuff, spTimeBonus, enemyInRange, up, batMod } from '../shared/tier1.js';

const S1 = 'skchr_acsupo_1';
const S2 = 'skchr_acsupo_2';
const S3 = 'skchr_acsupo_3';
/** Refresh period / length of the auras (T1 on allies, S3 on enemies): the non-stacking aura convention of the kits. */
const AURA_IV = 0.25;
const AURA_DUR = 0.4;
const T1_KEY = 'acsupo:t1';
/** 诱引's battle-wide `hit` handler runs before every other one (the enemy content's riders sit at 200). */
const LURE_PRIORITY = 300;
const ANY = Object.freeze({ canHitFly: true });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));
const adjacent4 = (a, u) => Math.abs(a.tileR - u.tileR) + Math.abs(a.tileC - u.tileC) === 1;
const s3On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S3);

// ---- 诱引 (T2): one battle-wide handler over every Raidian of the battle -------------------------------------------
/** battle → { srcs: [{ unit, phys, arts }], last: WeakMap(enemy → { id, miss }) }. */
const LURE = new WeakMap();

/** The hit-rate cut (0–1) `e`'s attack of damage type `type` suffers: the strongest of the Raidians whose range holds it. */
function lureCut(st, e, type) {
  let cut = 0;
  for (const s of st.srcs) {
    const u = s.unit, v = Math.abs(type === 'arts' ? s.arts : s.phys);
    if (v > cut && up(u) && u.rangeKeySet && canTargetEnemy(u, e, ANY) && bodyInRange(e, u.rangeKeySet)) cut = v;
  }
  return Math.min(1, cut);
}

function lureHit(battle, st, ctx) {
  const e = ctx.source, d = ctx.dmg;
  if (!e || e.side !== 'enemy' || !d || !d.isAttack || d.cancel || (d.type !== 'phys' && d.type !== 'arts')) return;
  // one roll per attack: every damage instance of it (each target, a multi-hit) shares the first instance's result
  const prev = d.attackId ? st.last.get(e) : null;
  let miss;
  if (prev && prev.id === d.attackId) miss = prev.miss;
  else {
    const cut = lureCut(st, e, d.type);
    miss = cut > 0 && battle.rng() < cut;
    if (d.attackId) st.last.set(e, { id: d.attackId, miss });
  }
  if (!miss) return;
  const cancelled = cancelDamage(d, 'miss');
  if (cancelled) ctx.stopPropagation = true;
  if (ctx.target) battle.fx('dodge', { x: ctx.target.x, y: ctx.target.y, id: ctx.target.id });
}

function installLure(battle, unit, phys, arts) {
  if (!phys && !arts) return;
  let st = LURE.get(battle);
  if (!st) {
    st = { srcs: [], last: new WeakMap() };
    LURE.set(battle, st);
    // no owner: it serves every Raidian of the battle, whichever is on the field
    battle.on('hit', (ctx) => lureHit(battle, st, ctx), { priority: LURE_PRIORITY });
  }
  st.srcs.push({ unit, phys, arts });
}

// ---- the kit ---------------------------------------------------------------------------------------------------------
export default {
  char_614_acsupo: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const grid3 = skillRec(chess, S3)?.rangeGrid;
    const self = num(t0.attack_speed), ally = num(t0['acsupo_t_1[ally].attack_speed']);
    const scale = num(b3.talent_scale, 1);
    const fragile = num(b3.damage_scale, 1) - 1, atkMul = num(b3.atk, 1);
    /** S3: 脆弱 / 虚弱 on every enemy of her (skill) range — at the cast, then every AURA_IV s while it runs. */
    const s3Aura = (battle, unit) => {
      for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) {
        if (fragile > 0) battle.applyStatus(e, 'fragile', { duration: AURA_DUR, value: fragile, source: unit });
        if (atkMul > 0 && atkMul < 1 && e.alive) battle.applyStatus(e, 'weaken', { duration: AURA_DUR, value: 1 - atkMul, stackAs: atkMul, source: unit });
      }
    };
    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) }, targeting: { maxTargets: count(b1['attack@max_target'], 2) } },
        [S2]: {
          kind: 'duration',
          mods: { batPct: batMod(b2.base_attack_time, chess) },
          targeting: { maxTargets: count(b2['attack@max_target'], 3) },
          attack: { onHitStatus: { key: 'sluggish', duration: num(b2['attack@sluggish'], 1.1) } },
        },
        [S3]: {
          kind: 'duration',
          // T1 × talent_scale: her own part here, the allies' in the T1 aura
          mods: { atkPct: num(b3['acsupo_s_3.atk']), aspd: self * (scale - 1) },
          ...(grid3 && grid3.length ? { targeting: { rangeGrid: grid3.map((p) => [p[0], p[1]]) } } : {}),
          onStart({ battle, unit }) { s3Aura(battle, unit); },
        },
      },
      talents: [
        { install(battle, unit) { // 同调
          statBuff(battle, unit, 'talent:acsupo', { aspd: self });
          if (!ally) return;
          battle.every(AURA_IV, () => {
            if (!up(unit)) return;
            const v = ally * (s3On(unit) ? scale : 1);
            for (const a of battle.alliesFor(unit)) {
              if (a === unit || a.kind !== 'op' || !adjacent4(a, unit)) continue;
              const cur = a.findBuff(T1_KEY);
              if (cur && cur.source !== unit && (cur.data?.v ?? 0) > v && cur.timeLeft > 0.05) continue;
              battle.addBuff(a, { key: T1_KEY, duration: AURA_DUR, mods: { aspd: v }, source: unit, data: { v }, tags: ['aura'] });
            }
          }, { owner: unit, immediate: true });
        } },
        { install(battle, unit) { installLure(battle, unit, num(t1.damage_hitrate_physical), num(t1.damage_hitrate_magical)); } }, // 诱引
      ],
      install(battle, unit) {
        spTimeBonus(battle, unit, num(moduleBb(chess).sp_recovery_per_sec), () => enemyInRange(battle, unit)); // DEC-X
        if (unit.skill?.id === S3) battle.every(AURA_IV, () => { if (up(unit) && s3On(unit)) s3Aura(battle, unit); }, { owner: unit });
      },
    };
  },
};
