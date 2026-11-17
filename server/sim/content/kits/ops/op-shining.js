// server/sim/content/kits/ops/op-shining.js — 闪灵 (char_147_shining) 自选 operator kit: 6★ 医师 (医疗), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_147_shining, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 闪灵 (S2 备注
// "多个屏障吸收量可叠加，持续时间独立计算，优先消耗先生成的屏障，防御力提升效果不可叠加"; PRTS 术语释义 屏障 "若无特殊说明，
// 屏障可吸收全种类伤害").
// - Trait (医师) "恢复友方单位生命": the profession default (one heal on the lowest-HP% injured ally of her 3-3 range).
//   Module PHY-Y 干枯剑鞘 "治疗地面单位时治疗量提升15%" (trait bb heal_scale): ×heal_scale on a heal whose target stands on
//   a 地面 tile (unit.ground, as 赫默's PHY-Y); PHY-X “使徒” "治疗生命值低于50%的友方单位时治疗量提升15%" (heal_scale,
//   hp_ratio): ×heal_scale when the target is at or below hp_ratio of its max HP before the heal — the client's
//   shining_e_003_tr is heal_scale_up[hpratio][LE] (as 华法琳's PHY-X; 录武官's reckpr_e_002_tr is LT, strictly below).
// - T1 黑恶魔的庇护 "攻击范围内的友方单位防御力+60" (full potential: +65): every ally (operators and summons: 友方单位)
//   standing in her current attack range — her own tile included — DEF +def (flat). PHY-Y stage 2+ "防御力+100，地面单位防御力
//   额外+40" (full potential: +105; talent change def / def_lowland): def_lowland more on a 地面 tile. Refreshed every AURA s;
//   two sources keep the strongest.
// - T2 法典 "攻击速度+10" (full potential: +13): ASPD +attack_speed. PHY-X stage 2+ "攻击速度+15，装备技能2时获得+25%攻击力，
//   装备技能3时技力自然回复速度+0.6/秒" (full potential: ASPD +18; talent change attack_speed; the hidden module talent's atk /
//   sp_recovery_per_sec): ATK +atk while 自动掩护 is her picked skill, SP +sp_recovery_per_sec per second while 教条力场 is.
// - S1 信条 (MANUAL, 20 s, data DEFAULT — a heal skill: cast as she is about to heal an injured ally in range): ATK +atk,
//   ASPD +attack_speed.
// - S2 自动掩护 (AUTO, 1 charge at rank 4 / 2 at rank 7, data DEFAULT): "下次治疗使目标获得一个持续N秒的屏障，屏障可以吸收相当于
//   闪灵攻击力X%的伤害，同时使目标防御力+Y%" — a "next heal" waits for her heal, as 推进之王's S2 waits for his attack (the
//   owner's SP_FULL rule is for AUTO skills that act on nobody). The heal's target gets a 屏障 of atk_scale × her ATK for
//   duration s (every damage type) and DEF +def while it holds: each barrier is its own buff (its own timer; older ones
//   absorb first — buff order), the DEF bonus one buff per target, kept while one of her barriers lasts [ASSUMED: it goes
//   with the last barrier, broken or expired — the 备注 only says it does not stack].
// - S3 教条力场 (MANUAL, 60 s, data DEFAULT): ATK +atk; every ally in her attack range DEF +def (%), refreshed every AURA s.
// Medic: heals only (dmgType heal), ranged, no anti-air question; ground enemies target her normally (no 起飞 / 迷彩 / 隐匿).

import { num, talentBb, moduleBb, traitBb, moduleOn, skillRec, statBuff, up } from '../shared/tier1.js';

const S1 = 'skchr_shining_1';
const S2 = 'skchr_shining_2';
const S3 = 'skchr_shining_3';
const PHY_Y = 'uniequip_002_shining';
const PHY_X = 'uniequip_003_shining';
/** Aura refresh period and buff life (s): an ally leaving the range loses the buff within one refresh (tier-4 AURA). */
const AURA = 0.2;
const AURA_DUR = 0.25;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const pickedSkill = (chess) => chess?.skill?.skillId ?? null;

/**
 * Keep buff `key` on every ally standing in `unit`'s current attack range (operators and summons, its own tile included;
 * never a 孤立 unit — Battle.alliesInGrid) while `on()` holds, refreshed every AURA s; it lapses AURA_DUR s after the
 * source stops refreshing it. Several sources of the same effect keep the strongest `value` (same-named buffs).
 * Shared with 夜莺's kit (op-cgbird.js).
 * @param {object} battle
 * @param {object} unit the source
 * @param {{ key: string, value: number, mods: object|((ally: object) => object), on?: () => boolean }} o
 */
export function rangeAura(battle, unit, { key, value, mods, on = () => true }) {
  battle.every(AURA, () => {
    if (!up(unit) || !on()) return;
    for (const a of battle.alliesInGrid(unit)) {
      const cur = a.findBuff(key);
      if (cur && cur.source !== unit && cur.source?.alive && (cur.data?.v ?? 0) > value && cur.timeLeft > 0.05) continue;
      battle.addBuff(a, { key, duration: AURA_DUR, mods: typeof mods === 'function' ? mods(a) : mods, source: unit, data: { v: value }, tags: ['aura'] });
    }
  }, { owner: unit, immediate: true });
}

/**
 * A 屏障 on `target` (闪灵 S2 自动掩护, 夜莺 S2 法术护盾): `shield` HP for `duration` s — of `shieldType` damage only when
 * given (attack/effects.js injuryEffects), else every type — plus the buff `statKey` (`mods`) while any barrier `key` lasts. PRTS
 * 备注 of both skills: "多个屏障吸收量可叠加，持续时间独立计算，优先消耗先生成的屏障，…效果不可叠加" — each barrier is its own
 * buff (refresh 'independent': its own timer; absorbShields walks the buffs oldest first), the stat bonus one buff whose
 * life follows the barriers (it ends when the last one breaks or expires). Shared with 夜莺's kit (op-cgbird.js).
 * @param {object} battle
 * @param {object} source the operator
 * @param {object} target
 * @param {{ key: string, statKey: string, shield: number, duration: number, mods: object, shieldType?: string|null }} o
 */
export function grantBarrier(battle, source, target, { key, statKey, shield, duration, mods, shieldType = null }) {
  if (!target || !target.alive || !(shield > 0) || !(duration > 0)) return;
  const sync = () => { if (!target.buffs.some((b) => b.key === key)) battle.removeBuff(target, statKey); };
  battle.addBuff(target, {
    key, refresh: 'independent', maxStacks: 99, duration, shield, shieldType, source, visible: true, onRemove: sync, onExpire: sync,
  });
  battle.addBuff(target, { key: statKey, refresh: 'extend', duration, mods, source });
  battle.fx('shield', { x: target.x, y: target.y, id: target.id, from: source.id });
}

export default {
  char_147_shining: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const t0 = talentBb(chess, 0);   // 黑恶魔的庇护: def (PHY-Y stage 2+: def 105, def_lowland)
    const t1 = talentBb(chess, 1);   // 法典: attack_speed (PHY-X stage 2+: 18)
    const hidden = moduleBb(chess);  // PHY-X stage 2+: atk (with S2 picked), sp_recovery_per_sec (with S3 picked)
    const tb = traitBb(chess);       // PHY-Y: heal_scale; PHY-X: heal_scale, hp_ratio
    const mod = moduleOn(chess) ? chess.module.id : null;
    const picked = pickedSkill(chess);
    return {
      skills: {
        [S1]: { kind: 'duration', heal: true, mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          heal: true,
          attack: { healScale: 1 },  // the next heal (ai.js doHeal calls onHit per heal target)
          onHit({ battle, unit, target }) {
            if (!target || target.side !== 'ally') return;
            grantBarrier(battle, unit, target, {
              key: 'shining:barrier', statKey: 'shining:barrierDef', shield: unit.s.atk * num(b2.atk_scale),
              duration: num(b2.duration), mods: { defPct: num(b2.def) },
            });
          },
        },
        [S3]: { kind: 'duration', heal: true, mods: { atkPct: num(b3.atk) } },
      },
      talents: [
        { install(battle, unit) { // 黑恶魔的庇护: allies in her attack range DEF +def; PHY-Y stage 2+: 地面 units +def_lowland
          const d = num(t0.def), low = num(t0.def_lowland);
          if (!(d > 0) && !(low > 0)) return;
          rangeAura(battle, unit, { key: 'talent:shining:def', value: d + low, mods: (a) => ({ defFlat: d + (a.ground ? low : 0) }) });
        } },
        { install(battle, unit) { // 法典: ASPD +attack_speed; PHY-X stage 2+: ATK +atk with S2, SP +0.6/s with S3
          statBuff(battle, unit, 'talent:shining:aspd', { aspd: num(t1.attack_speed) });
          if (picked === S2) statBuff(battle, unit, 'talent:shining:s2', { atkPct: num(hidden.atk) });
          if (picked === S3) statBuff(battle, unit, 'talent:shining:s3', { spRecoveryFlat: num(hidden.sp_recovery_per_sec) });
        } },
      ],
      install(battle, unit) {
        // 教条力场: allies in her attack range DEF +def % while the skill runs
        if (picked === S3 && num(b3.def) > 0) {
          rangeAura(battle, unit, { key: 'skill:shining:def', value: num(b3.def), mods: { defPct: num(b3.def) }, on: () => !!unit.skill?.active });
        }
        // module traits: PHY-Y heals on 地面 units, PHY-X heals on allies below hp_ratio, ×heal_scale
        const hs = num(tb.heal_scale, 1);
        if (!mod || hs === 1) return;
        const boosted = mod === PHY_X ? (t) => t.hpRatio <= num(tb.hp_ratio) + 1e-9 : mod === PHY_Y ? (t) => !!t.ground : null;
        if (!boosted) return;
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || ctx.opts?.regen || !ctx.target || !boosted(ctx.target)) return;
          ctx.amount *= hs;
        }, { owner: unit });
      },
    };
  },
};
