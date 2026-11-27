// server/sim/content/kits/ops/op-slent2.js — 淬羽赫默 (char_1031_slent2) 自选 operator kit: 6★ 护佑者 (辅助), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules (BLS-X 难得清醒, BLS-Y 可控动量) at every
// form, and the kit of her summon 夜灯 (token_10029_slent2_protrb). Kit contract and the 自选 rules: ../README.md ("How to add
// an operator (自选)").
//
// Forms (data/backups.json units.char_1031_slent2): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 淬羽赫默 (无声砥柱 备注
// "根据其已损失的生命值比例（0%~70%，以1%为最小单位）线性提升…每当庇护数值变化时，重新为该友方单位附加庇护BUFF"; 丰润羽翼 备注
// on the BLS-Y barrier; 俯瞰视界 备注 "技能期间撤回夜灯时，夜灯立刻返回待部署区并进入再部署时间"; 无畏者协议 备注 "只在没有持有
// 不死的我方干员正在应用致命伤害时…触发…该效果不会因淬羽赫默的离场消失"), PRTS 夜灯, PRTS 衍生生命 (致命伤害: "无畏者协议提供的
// 不死效果仅在目标没有不死效果时才会触发"), and the client's battle data read from the local install — charpack
// char_1031_slent2 (talent abilities: slent2_t_1 on the allies of her range every 0.1 s, removed when they leave; slent2_t_2
// likewise, its selector ignoring 禁疗 — ignoreHealFree; the S1 / S2 / S3 modes: attacks become heals of max_target injured
// allies, the lowest HP share first) and buff_template_data slent2_t_1 / slent2_t_2 / slent2_s_2 / slent2_s_3 /
// slent2_e_002[max_hp] / slent2_e_003_t2 (+ [shield]); the template atk_to_hp_recovery is the one PRTS documents as
// 「生命回复速度」 for 絮雨 天赋 and 琴柳 S2 ("生命恢复的提供方式为增加目标的“生命回复速度”属性，不受治疗加成和禁疗影响").
// - Trait (护佑者) "攻击造成法术伤害，技能开启后改为治疗友方单位（治疗量相当于75%攻击力）": ranged arts bolts (the SUPPORT
//   default; 3×3-and-more y-6, hits air units), blocks 1, ground enemies target her (no flag); while ANY of her skills runs
//   every attack heals the most injured ally of her range instead (trait heal_scale × ATK; allies = operators and summons).
//   BLS-X “难得清醒”: heal_scale 1 (100 %). BLS-Y “可控动量” "攻击对2个目标造成法术伤害，技能开启后改为治疗2个友方单位"
//   (trait attack@max_target 2): two targets / two heals.
//   Her skills are no heal skills for the 技能策略: a 辅助's basic strategy casts on an enemy she is about to attack (PRTS
//   卫戍协议/帮助: only 医疗干员 attack the units needing a heal), so every skill keeps the data's DEFAULT.
// - T1 无声砥柱 "使攻击范围内的友军获得10%的庇护…（低于30%生命时获得最大24%的庇护）": every ally of her range (herself
//   included) holds 庇护 (ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）"; the client's damage_resistance[inf],
//   the 庇护 the other kits share as `protect` — battle.applyStrongest) of damage_resistance_base × (1 + resistance_scale × n),
//   n = its lost HP in whole hp_ratio (1 %) steps, at most 1 − min_hp_ratio (70 steps ⇒ 10 % × 2.4 = 24 %), re-read every
//   0.1 s (the client's trigger) and gone at once when it leaves her range (a lower value takes over within one refresh).
//   S3 / the 夜灯 scale damage_resistance_base (the client's `_scaleCertainKeyList`), i.e. the whole value.
// - T2 丰润羽翼 "攻击范围内生命低于50%的友军每秒恢复相当于淬羽赫默攻击力5%的生命，【莱茵生命】干员的恢复效果翻倍"
//   (full potential: 6%): while an ally of her range is below hp_ratio of its max HP it gains 生命回复速度 (an hpRegen buff,
//   checklist 11 — the template atk_to_hp_recovery, see above: 禁疗 does not stop it, no 治疗加成) of atk_to_hp_recovery_ratio × her
//   ATK, from 1 s after it dropped below (waitFirstTriggerInterval) and re-read every 1 s; a 【莱茵生命】 operator (character_table
//   groupId "rhine") gets it twice (the client's [normal] + [rhine] buffs). One buff per 淬羽赫默 (independentCharacterSource).
//   BLS-X stage 2+ (hidden max_hp; slent2_e_002[max_hp]) "攻击范围内友军的最大生命值+10%": allies of her range max HP
//   +max_hp (MAX_HP MULTIPLIER = Σpct), ×2 for a 【莱茵生命】 operator; and 8 % ATK per second (the talent change's ratio).
//   BLS-Y stage 2+ (hidden hp_ratio / scale; slent2_e_003_t2) "其中每个干员低于50%生命时仅一次立刻获得淬羽赫默生命上限50%的屏障":
//   an operator of her range gets a 屏障 (absorbs every type) of scale × her max HP (×2 for 【莱茵生命】, the client's
//   multi 2) once per deployment of hers (the card mark, cleared when she leaves): when it enters her range below hp_ratio, or
//   on a damage instance that would leave it below hp_ratio of its max HP ("在每次“受到伤害前”进行预判"): the barrier takes
//   that very hit (an `hpDamage` handler run first, after the other shields — PRTS: "能以更早的时间点触发…一定程度抵挡可能致命
//   的伤害"). Summons get no barrier ("其中每个干员") [ASSUMED: the text; the client data shows one validator].
// - S1 进取之心 (MANUAL, DEFAULT, 25 s): ATK +atk; heals (trait).
// - S2 俯瞰视界 (MANUAL, DEFAULT, 12 s): ASPD +attack_speed; heals; "技能期间可以使用一个辅助无人机…技能结束或淬羽赫默离场时
//   销毁" (slent2_s_2: WithdrawTokens at its end, the token count recharged): her placed 夜灯 piece takes the field on its tile
//   when the skill starts (content/tokens.js releaseSkillSummon; like every placed skill summon it also deploys once, free, at
//   the battle start — PRTS 卫戍协议/帮助) and is withdrawn when the skill ends (into its 5 s redeploy time, PRTS 备注) or when
//   she leaves the field; a piece already up when the skill starts serves as its drone [ASSUMED: the start deploy lasts until
//   the first end]. 夜灯 (token kit below): untargetable ("不会受到攻击", data), no attack (ATK 0), blocks nothing; its passive
//   "使周围八格友军享受2.1倍的淬羽赫默第一天赋效果": the allies of its x-4 (its own tile and the 8 around) hold her T1 庇护 ×
//   damage_resistance_scale (its skill blackboard: 2.1 / 2.4) — the same shared 庇护, so the stronger value holds.
// - S3 无畏者协议 (MANUAL, DEFAULT, 60 s, skill_max_trigger_time 2 uses per battle — the 3rd never comes: no SP after the
//   2nd; "可主动关闭" is a manual stop the 技能策略 never makes, so it runs its full time): ATK +atk, T1 ×talent_scale, heals;
//   once per cast the first operator of her range taking lethal damage (not its own — CheckEntitySuicide; not while it already
//   holds 不死 — "_dontConsumeWhenUndeadable") keeps ≥ 1 HP and holds 不死 for grave_duration s (slent2_shallow_grave, buff
//   flag `undying`; it outlasts her leaving). Order of the `fatal` step (items/battle.js): after the kits' own savers, a
//   傀儡师's switch and 坚固维式重锤's lock (PRIO_REVIVE −100) — the 复活 (M3茧甲, 埃芒加德) act on the knock-out after the
//   whole `fatal` step; the window it opens is held like the hammer's (PRIO_UNDYING_HELD −99).
// Statuses: none applied to enemies. Damage: arts normal attacks only.

import { num, up, traitBb, moduleBb, talentBb, skillRec, once, holdProtect } from '../shared/tier1.js';
import { releaseSkillSummon } from '../../tokens.js';
import { holdsUndying, PRIO_UNDYING_HELD, PRIO_REVIVE } from '../../items/battle.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_slent2_1';
const S2 = 'skchr_slent2_2';
const S3 = 'skchr_slent2_3';
export const LAMP = 'token_10029_slent2_protrb';
/** The client's trigger period of slent2_t_1 / slent2_t_2 (talent abilities, triggerInterval 0.1). */
export const TALENT_IV = 0.1;
/** Lifetime of a refreshed effect: a little longer than the refresh period, so it never lapses while it holds. */
const HOLD = TALENT_IV + 0.05;
/** atk_to_hp_recovery: its trigger interval (1 s, the first after one interval). */
const REGEN_IV = 1;
/** BLS-X stage 2+ max HP (slent2_e_002[max_hp]): one "同名" effect per unit. */
export const MAXHP_KEY = 'slent2:maxhp';
/** S3's 不死 (slent2_shallow_grave). */
export const GRAVE_KEY = 'slent2:grave';
/** S3's place in the `fatal` step: right after the items' 不死 lock (−100) — see the header. */
const PRIO_GRAVE = PRIO_REVIVE - 0.5;
/** 夜灯's area when its record carries no grid: its tile and the 8 around (x-4). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** 【莱茵生命】 (character_table groupId "rhine": every member, so a 自选 pick counts too). */
export const RHINE = Object.freeze(new Set([
  'char_128_plosis', 'char_135_halo', 'char_242_otter', 'char_108_silent', 'char_249_mlyss', 'char_134_ifrit',
  'char_1047_halo2', 'char_248_mgllan', 'char_1031_slent2', 'char_4212_nasti', 'char_4048_doroth', 'char_202_demkni',
]));

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileKey = (r, c) => r * COLS + c;
/** An operator of the 莱茵生命 group (summons are no 干员). */
export const isRhine = (a) => !!a && a.kind === 'op' && RHINE.has(a.def?.charId ?? a.defId);
const inKeys = (keys, a) => !!keys && keys.has(tileKey(a.tileR, a.tileC));

/**
 * 无声砥柱's 庇护 for an ally at its HP: base × scale × (1 + rs × n), n = its lost HP in whole `step` steps (at most
 * 1 − min_hp_ratio) — the client's HpRatioTrigger count, PRTS 备注 "以1%为最小单位".
 */
export function shelterOf(t, ally, scale = 1) {
  const base = num(t.damage_resistance_base) * scale;
  if (!(base > 0)) return 0;
  const step = num(t.hp_ratio, 0.01) || 0.01;
  const lost = Math.min(Math.max(0, 1 - ally.hpRatio), Math.max(0, 1 - num(t.min_hp_ratio, 0.3)));
  const n = Math.floor(lost / step + 1e-9);
  return Math.min(0.95, base * (1 + num(t.resistance_scale) * n));
}

/** The allies (operators and summons; never a 孤立 one) on absolute tile keys `keys`. */
function alliesOn(battle, by, keys) {
  return battle.allyUnits.filter((a) => a.alive && a.deployed && !a.hidden && a.kind !== 'device' && inKeys(keys, a) && battle.allySelectable(a, by));
}

/**
 * 夜灯's kit: untargetable ("不会受到攻击": the def's flag, Battle._setupUnit), no attack (ATK 0 ⇒ resolveProfile noAttack),
 * no skill to cast; while it stands, every TALENT_IV s the allies of its x-4 hold her T1 庇护 × damage_resistance_scale.
 * `owner` = 淬羽赫默, `t1` = her T1 blackboard (fallback when the token def carries none).
 */
function lampKit(t, owner, t1) {
  const def = t.def;
  const tal = (def?.talents ?? []).find((x) => x && x.bb && x.bb.damage_resistance_base != null) ?? null;
  const tb = tal?.bb ?? t1;
  const grid = tal?.rangeGrid ?? def?.rangeGrid ?? X4;
  const scale = num(def?.skill?.bb?.damage_resistance_scale, num(owner.skill?.bb?.damage_resistance_scale, 1));
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, lamp) {
      battle.every(TALENT_IV, () => {
        if (!up(lamp)) return;
        const keys = new Set(absoluteRangeKeys(grid, lamp.tileR, lamp.tileC, lamp.dir, 0));
        for (const a of alliesOn(battle, lamp, keys)) {
          const v = shelterOf(tb, a, scale);
          holdProtect(battle, a, v, HOLD, lamp);   // 庇护 (the client's damage_resistance[inf]): the shared effect
        }
      }, { owner: lamp, immediate: true });
    },
  };
}

export default {
  char_1031_slent2: (bb, chess) => {
    const tb = traitBb(chess);
    const t1 = talentBb(chess, 0), t2 = talentBb(chess, 1), hidden = moduleBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const targets = Math.max(1, Math.floor(num(tb['attack@max_target'], 1)));
    const healAttack = Object.freeze({
      dmgType: 'heal', heal: targets > 1 ? { mode: 'multi', count: targets } : { mode: 'single' },
      healScale: num(tb.heal_scale, 0.75), projectile: 'none',
    });
    const regenRatio = num(t2.atk_to_hp_recovery_ratio), regenBelow = num(t2.hp_ratio, 0.5);
    const maxHp = num(hidden.max_hp);                                   // BLS-X stage 2+
    const barrierScale = num(hidden.scale), barrierBelow = num(hidden.hp_ratio, 0.5); // BLS-Y stage 2+
    const graveDur = num(b3.grave_duration), s3Uses = Math.max(1, Math.floor(num(b3.skill_max_trigger_time, 2)));
    const talentScale = num(b3.talent_scale, 1);
    return {
      trait: targets > 1 ? { maxTargets: targets } : null,
      skills: {
        // [ASSUMED] her skills' attacks heal: 白铁's 铁钳号 (禁疗, no patient) alone does not open them (skills.js allyTargetsOk)
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) }, attack: healAttack, allyTargets: false },
        [S2]: {
          kind: 'duration', mods: { aspd: num(b2.attack_speed) }, attack: healAttack, allyTargets: false,
          onStart({ battle, unit }) {
            // a 夜灯 already up (the battle-start deploy) is this skill's drone; else her placed piece takes the field
            if (!battle.allyUnits.some((t) => t.kind === 'token' && t.defId === LAMP && t.ownerUnit === unit && t.alive)) releaseSkillSummon(battle, unit, LAMP);
          },
          onEnd({ battle, unit }) { withdrawLamps(battle, unit); },
        },
        [S3]: {
          kind: 'duration', mods: { atkPct: num(b3.atk) }, attack: healAttack, allyTargets: false,
          onStart({ unit }) { unit.mem.slent2Grave = true; },   // the one 不死 of this cast (slent2_shallow_grave[self])
          onEnd({ unit }) { unit.mem.slent2Grave = false; },
        },
      },
      talents: [
        { install(battle, unit) { // 无声砥柱 (+ S3 ×talent_scale) and 丰润羽翼 (+ BLS-X max HP, BLS-Y barrier on entering)
          const regenKey = `talent:slent2:regen#${unit.id}`;
          const regen = new Map();   // ally → { next: battle time of its next atk_to_hp_recovery trigger }
          let prevIn = new Set();     // the allies of her range at the previous scan (slent2_t_2 started on them)
          const stopRegen = (a) => { regen.delete(a); if (a.findBuff(regenKey)) battle.removeBuff(a, regenKey); };
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.slent2Marks = new Set(); prevIn = new Set(); } }, { owner: unit });
          battle.every(TALENT_IV, () => {
            if (!up(unit)) {
              for (const a of [...regen.keys()]) stopRegen(a);
              prevIn = new Set();
              return;
            }
            const scale = unit.skill?.id === S3 && unit.skill.active ? talentScale : 1;
            const allies = alliesOn(battle, unit, unit.rangeKeySet);
            const now = new Set(allies);
            for (const a of allies) {
              const v = shelterOf(t1, a, scale);
              holdProtect(battle, a, v, HOLD, unit);
              const mult = isRhine(a) ? 2 : 1;
              if (maxHp > 0) battle.applyStrongest(a, MAXHP_KEY, { duration: HOLD, value: maxHp * mult, mods: (x) => ({ hpPct: x }), source: unit });
              if (regenRatio > 0 && a.hpRatio < regenBelow - 1e-9) {
                const st = regen.get(a) ?? { next: battle.time + REGEN_IV };
                regen.set(a, st);
                if (battle.time + 1e-9 >= st.next) {
                  st.next += REGEN_IV;
                  battle.addBuff(a, { key: regenKey, mods: { hpRegen: unit.s.atk * regenRatio * mult }, source: unit, tags: ['talent'] });
                }
              } else if (regen.has(a)) stopRegen(a);
              if (barrierScale > 0 && !prevIn.has(a) && a.hpRatio < barrierBelow - 1e-9) giveBarrier(battle, unit, a, null);
            }
            for (const a of [...regen.keys()]) if (!now.has(a) || !a.alive) stopRegen(a);
            prevIn = now;
          }, { owner: unit, immediate: true });
          // BLS-Y: a damage instance that would leave an operator of her range below barrierBelow — the barrier takes it
          if (barrierScale > 0) {
            battle.on('hpDamage', (c) => {
              const a = c.target;
              if (!up(unit) || !a || a.side !== 'ally' || !(c.amount > 0) || !inKeys(unit.rangeKeySet, a)) return;
              if (a.hp - c.amount < a.s.maxHp * barrierBelow - 1e-9) giveBarrier(battle, unit, a, c);
            }, { owner: unit, priority: 100 });
          }
          /** BLS-Y barrier on operator `a` (once per deployment of hers); `c` = the hpDamage ctx it takes, if any. */
          function giveBarrier(b, u, a, c) {
            const marks = u.mem.slent2Marks ?? (u.mem.slent2Marks = new Set());
            if (a.kind !== 'op' || marks.has(a.id)) return;
            marks.add(a.id);
            let cap = u.s.maxHp * barrierScale * (isRhine(a) ? 2 : 1);
            if (c) { const took = Math.min(cap, c.amount); c.amount -= took; cap -= took; }
            if (cap > 1e-6) b.addBuff(a, { key: `slent2:barrier#${u.id}`, shield: cap, source: u, visible: true, tags: ['talent'] });
            b.fx('shield', { x: a.x, y: a.y, id: a.id });
          }
        } },
        { install(battle, unit) { // 夜灯: her placed pieces run the drone's kit; withdrawn when she leaves the field
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || t.defId !== LAMP || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            // (no offOwner for a piece set up before her: its hooks are content/tokens.js's dock hooks — the generic token
            // kit registers none — and they must stay)
            battle._setupUnit(t, lampKit(t, unit, t1));
          }
          battle.on('death', (c) => { if (c.unit === unit) withdrawLamps(battle, unit); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (unit.skill?.id !== S3) return;
        // 同一次作战中最多使用2次: after the last use no SP comes back (activations count every deployment of the battle)
        battle.on('spGain', (c) => {
          if (c.unit === unit && !unit.skill.active && unit.skill.activations >= s3Uses) c.amount = 0;
        }, { owner: unit });
        // the one 不死 of each cast: the first operator of her range taking lethal damage (see the header)
        battle.on('fatal', (c) => {
          const a = c.unit;
          if (c.prevented || !unit.mem.slent2Grave || !unit.skill?.active || !up(unit)) return;
          if (!a || a.side !== 'ally' || a.kind !== 'op' || !inKeys(unit.rangeKeySet, a)) return;
          if (c.source === a || c.credit === a || holdsUndying(battle, a)) return;
          c.prevented = true;
          unit.mem.slent2Grave = false;
          battle.addBuff(a, { key: GRAVE_KEY, duration: graveDur, flags: { undying: true }, source: unit, visible: true, tags: ['skill'] });
          // cosmetic fx (round 86): `src` is her, so the client can play slent2_skill_03_buff_02 on the ally. Kind stays undying.
          battle.fx('undying', { x: a.x, y: a.y, id: a.id, duration: graveDur, src: unit.id, skill: 'slent2:grave' });
        }, { owner: unit, priority: PRIO_GRAVE });
        // the 不死 window, held whoever opened it (one battle-wide hook, like 坚固维式重锤's running windows)
        once(battle, 'slent2:grave', () => {
          battle.on('fatal', (c) => { if (!c.prevented && c.unit && c.unit.findBuff(GRAVE_KEY)) c.prevented = true; }, { priority: PRIO_UNDYING_HELD });
        });
      },
    };
  },
};

/** 俯瞰视界's end or her leaving: her 夜灯 leave the field (into their redeploy time) and the drone in stock is gone. */
function withdrawLamps(battle, unit) {
  const stock = unit.mem.summonStock;
  if (stock) stock[LAMP] = 0;
  for (const t of battle.allyUnits) {
    if (t.kind === 'token' && t.defId === LAMP && t.ownerUnit === unit && t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
  }
}
