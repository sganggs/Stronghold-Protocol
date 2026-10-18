// server/sim/content/kits/ops/op-shwaz.js — 黑 (char_340_shwaz) 自选 operator kit: 6★ 重射手 (狙击), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (ARC-X 定制弩配件套装, ARC-Y 老剃刀) at
// every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_340_shwaz): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 黑
// (破甲箭头 备注 "攻击力提升效果为提升攻击力倍率"; 战术的终结 "攻击间隔略微增大(+0.4)"; the {{**|80%|下降20%}} marks of the
// DEF cut = a final ×0.8).
// - Trait (重射手) "高精度的近距离射击": the plain closerange profile — ranged physical arrows, 3-6, can hit air units
//   (PRTS 分支特性信息 重射手 "可对空"), blocks 1, ground enemies target her (no flag).
// - T1 破甲箭头 "攻击时，20%几率当次攻击的攻击力提升至160%，并使命中目标的防御力下降20%，持续5秒": one roll per attack
//   (`prob`); on a proc the attack's damage ×atk_scale (an ATK-scale multiplier, PRTS 备注, so it multiplies the skills'
//   own scales) and, once the hit landed (命中: a dodged hit does nothing), the target's DEF ×(1 + def) for
//   defdown_duration s — the catalogue `defDown` (final ×0.8, PRTS; 同名 keeps the strongest). The skills raise the chance:
//   S1's next attack to S1 talent@prob, S2 / S3's attacks while they run to their talent@prob (every attack a skill makes
//   carries dmg.isSkill — S2's empty attack override marks its attacks for that). ARC-Y stage 2+ upgrades it (stage 3:
//   170 %, DEF −25 %) — read from the base talent and the module's NAMED change: ARC-Y's hidden talent part (talentIndex 0,
//   isHideTalent, atk_scale 1.05, prefabKey "10") is the trait's 105 % as a talent of its own in the game, which the
//   data's merge by talentIndex folds into 破甲箭头 at stage 1 (composed atk_scale 1.05) — reported, not used.
// - T2 交叉火力 "场上存在黑和另外至少一名【狙击】干员时，所有【狙击】干员的攻击力+8%" (full potential: +10%): while she is on the
//   field and another 【狙击】 operator is too, every 【狙击】 operator of the field (her included; a partner's in a shared
//   field too [ASSUMED, as 推进之王's 万兽之王]) ATK +atk, refreshed every 0.5 s (lapses within 0.6 s when the condition
//   ends); several sources keep the strongest. ARC-X stage 2+ "携带黑和另外至少一名【狙击】干员时…+13%" (full potential:
//   +15%): 携带 = in the squad — the player's own pieces of the battle, deployed or not — so with another 【狙击】 piece in
//   her player's battle every 【狙击】 operator of that player ATK +15 % for the whole battle (persist; a partner's
//   operators are not in her squad [ASSUMED]).
// - Module ARC-X “定制弩配件套装”: "再部署时间减少" (attribute respawn_time −25, in the stats: 66 → 41 s at full potential) + HP /
//   ATK.
// - Module ARC-Y “老剃刀” trait "攻击正前方的敌人时攻击力提升至105%且无视其物理闪避" (trait bb atk_scale): her attack damage
//   on an enemy whose body is on her straight line ahead ×atk_scale and not dodgeable (canDodge false — her damage is
//   physical only). 正前方 = local row 0, column ≥ 0 in her facing — her own tile included, as S3's 3-2 "前方3格" counts
//   it [ASSUMED: no source draws the line].
// - S1 强弩 (AUTO, attack SP 4, data DEFAULT): the next attack ×atk_scale (and the T1 chance above).
// - S2 暮眼锐瞳 (MANUAL, data DEFAULT): ATK +atk for 33 / 36 s, T1 chance talent@prob.
// - S3 战术的终结 (MANUAL): range → 3-2 (her tile + 3 ahead) while it runs, attack interval +base_attack_time s (a flat
//   +0.4 on her 1.6 s, PRTS), ATK +atk, T1 chance 100 %. Trigger: the data's DEFAULT (the basic strategy) — "攻击范围改为前方
//   3格" is an attack-range change, not a 技能范围 (tools/build-data.mjs ATTACK_RANGE_CHANGE has "改为" since O6's report).

import { num, up, traitBb, moduleOn, skillRec, batMod } from '../shared/tier1.js';
import { bodyKeys } from '../../../body.js';
import { toLocal } from '../../../dir.js';
import { hasHp } from '../../../attack.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_shwaz_1';
const S2 = 'skchr_shwaz_2';
const S3 = 'skchr_shwaz_3';
/** 交叉火力's buff (the field aura and the squad version share it: one effect per operator, the strongest). */
const CROSSFIRE = 'talent:shwaz:crossfire';
/** 交叉火力's refresh interval (s), as installAura. */
const AURA_EVERY = 0.5;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 【狙击】 operator (summons are never operators). */
const isSniperOp = (a) => !!a && a.kind === 'op' && a.def?.profession === 'SNIPER';

/** The module the record fights with (its active one), or null. */
function activeModule(chess) {
  if (!moduleOn(chess)) return null;
  return (chess.modules ?? []).find((m) => m && m.uniEquipId === chess.module.id) ?? null;
}

/**
 * 破甲箭头's blackboard: the base talent (no module) with the module's NAMED changes of talent 0 only — never the hidden
 * trait part (see the header).
 */
function pierceBb(chess) {
  const base = (chess?.talentsBase ?? chess?.talents ?? []).find((t) => t && t.index === 0)?.bb ?? {};
  const ups = (activeModule(chess)?.talentChanges ?? []).filter((t) => t && t.talentIndex === 0 && !t.hidden && t.name);
  return Object.assign({}, base, ...ups.map((t) => t.bb || {}));
}

/** The record's 交叉火力 (talent 1, the module's change included): its blackboard and whether it reads 携带 (squad). */
function crossfireOf(chess) {
  const t = (chess?.talents ?? []).find((x) => x && x.index === 1) ?? null;
  return { atk: num(t?.bb?.atk), squad: /携带/.test(String(t?.desc ?? '')) };
}

/** ARC-Y 正前方: the enemy's body touches the unit's straight line ahead (local row 0, local column ≥ 0). */
function inFrontLine(unit, e) {
  for (const k of bodyKeys(e)) {
    const [lr, lc] = toLocal(Math.floor(k / COLS) - unit.tileR, (k % COLS) - unit.tileC, unit.dir);
    if (lr === 0 && lc >= 0) return true;
  }
  return false;
}

export default {
  char_340_shwaz: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const t0 = pierceBb(chess);
    const cross = crossfireOf(chess);
    const frontScale = num(traitBb(chess).atk_scale, 1);
    return {
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1) } },
        // (an empty attack override: the attacks made while it runs carry dmg.isSkill — 破甲箭头's raised chance)
        [S2]: { kind: 'duration', mods: { atkPct: num(b2.atk) }, attack: {} },
        [S3]: {
          kind: 'duration',
          targeting: { rangeGrid: s3?.rangeGrid ?? [[0, 0], [0, 1], [0, 2], [0, 3]] },
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
        },
      },
      talents: [
        { install(battle, unit) { // 破甲箭头: one roll per attack; ×atk_scale on a proc, then DEF cut on the target hit
          const scale = num(t0.atk_scale, 1), cut = -num(t0.def), dur = num(t0.defdown_duration, 5), base = num(t0.prob);
          const sid = unit.skill?.id;
          const raised = num(bbOf(chess, sid)['talent@prob'], base);
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, t = ctx.target;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || d.isSplash || d.type === 'element') return;
            const m = unit.mem;
            if (!d.attackId || m.shwazRollId !== d.attackId) {
              m.shwazRollId = d.attackId;
              const p = d.isSkill ? raised : base;
              m.shwazProc = p > 0 && battle.rng.chance(p);
              if (m.shwazProc) battle.fx('crit', { x: t.x, y: t.y, id: unit.id });
            }
            if (!m.shwazProc) return;
            d.amount *= scale;
            d.shwazPierce = true;
          }, { owner: unit });
          battle.on('damaged', (ctx) => {
            if (ctx.source !== unit || !ctx.dmg?.shwazPierce || !(cut > 0) || !hasHp(ctx.target) || ctx.target.side !== 'enemy') return;
            battle.applyStatus(ctx.target, 'defDown', { duration: dur, value: cut, source: unit });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 交叉火力: field aura, or (ARC-X stage 2+) the squad's snipers for the whole battle
          const v = cross.atk;
          if (!(v > 0)) return;
          const give = (a, extra) => {
            const cur = a.findBuff(CROSSFIRE);
            if (cur && cur.source !== unit && (cur.data?.v ?? 0) > v && cur.timeLeft > 0.05) return;
            battle.addBuff(a, { key: CROSSFIRE, mods: { atkPct: v }, source: unit, data: { v }, ...extra });
          };
          if (cross.squad) {
            const squad = battle.allyUnits.filter((a) => isSniperOp(a) && a.ownerId === unit.ownerId);
            if (squad.some((a) => a !== unit)) for (const a of squad) give(a, { persist: true, allowDead: true, tags: ['talent'] });
            return;
          }
          battle.every(AURA_EVERY, () => {
            if (!up(unit)) return;
            const snipers = battle.alliesFor(unit).filter(isSniperOp);
            if (!snipers.some((a) => a !== unit)) return;
            for (const a of snipers) give(a, { duration: AURA_EVERY + 0.1, tags: ['aura'] });
          }, { owner: unit, immediate: true });
        } },
      ],
      install(battle, unit) {
        // ARC-Y 老剃刀: 攻击正前方的敌人时攻击力提升至105%且无视其物理闪避
        if (!(frontScale > 0) || frontScale === 1) return;
        battle.on('hit', (ctx) => {
          const d = ctx.dmg, t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || d.type === 'element' || !inFrontLine(unit, t)) return;
          d.amount *= frontScale;
          d.canDodge = false;
        }, { owner: unit });
      },
    };
  },
};
