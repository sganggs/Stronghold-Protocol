// server/sim/content/kits/ops/op-cgbird.js — 夜莺 (char_179_cgbird) 自选 operator kit: 6★ 群愈师 (医疗), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules at every form and her summon 幻影.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_179_cgbird, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json; the 幻影 token record
// backups.json tokens.token_10003_cgbird_bird with its owner-form / module variants) and PRTS 夜莺 (S2 备注
// "多个屏障吸收量可叠加，持续时间独立计算，优先消耗先生成的屏障，法术抗性增加效果不可叠加"; 转瞬即逝的幻影 备注 "幻影的持有上限为3个，
// 每次部署夜莺时补充2个幻影 / Y模组2级时…补充3个 / 夜莺离场时，已部署的幻影会留在场上"); PRTS 卫戍协议/帮助 §作战阶段 (summons:
// "所有手动部署的召唤物，无视所属干员的持有状态，不消耗持有数量，作战开始时立即部署一次", "若战场区初始部署有召唤物，若召唤物在
// 战斗期间退场，将在满足条件后立即原地再部署1个").
// - Trait (群愈师) "同时恢复三个友方单位的生命": the profession default (3 heals). Module RIN-Y “莺歌” "同时恢复四个友方单位的
//   生命" (hidden module talent attack@max_target / skill@max_target 4): 4 heals (kit trait, as 调香师's RIN-Y). RIN-X
//   “封闭的希望” "攻击范围扩大": her range becomes the module's own grid (its range-only talent change, talentIndex −1: y-2
//   plus the centre tile [0,3] — PRTS y-3), as shared/loadoutRecord.js attackRangeGrid draws it; 圣域 keeps its own y-4.
// - T1 白恶魔的庇护 "攻击范围内的友方单位法术抗性+15" (full potential: +17): every ally (operators and summons) standing in
//   her current attack range — her own tile included — RES +magic_resistance (flat). RIN-X stage 2+ "…且受到的治疗效果提升5%" (talent change
//   heal_scale): also healing received ×heal_scale there. Refreshed every 0.2 s; two sources keep the strongest.
// - T2 转瞬即逝的幻影 (summon token_10003_cgbird_bird: no attack, blocks nothing, RES 75, taunt level 1 — its stats — and
//   its talent "30%的物理闪避…每秒流失3%的最大生命": dodgePhys prob, a 流失 of hp_ratio × its max HP every second; RIN-Y
//   stage 3 "40%的物理闪避": the module variant's talent; PRTS 幻影 备注 "持有禁疗。": tokens.json `abnormal` healFree from
//   tools/build-data.mjs TOKEN_ABNORMAL, §37.201 — no heal reaches it, an HP regen does). The 幻影 is a hand piece (the match's per-player shop): a placed
//   one deploys with the board at the battle start for free and without using her stock. Each deployment of 夜莺 adds
//   cnt (2; RIN-Y stage 2+: 3) to her stock, at most PHANTOM_HOLD_CAP; a placed 幻影 that falls comes back on its own tile
//   once its redeploy time (respawnTime) has passed and she holds one — using one, paying its DP cost as a deployment
//   does [ASSUMED: "满足条件" = a 幻影 held, its redeploy time, the DP], whether 夜莺 is on the field or not (deployed
//   幻影 stay when she leaves: PRTS 备注). No tokens.js kit: its talent and its return are this kit's (owner-coupled,
//   as tokens.js "Managed mode"), applied at each of its deployments.
// - S1 治疗强化·γ型 (MANUAL, 30 s, data DEFAULT — heal skill): ATK +atk.
// - S2 法术护盾 (AUTO, 2 charges, data DEFAULT — a "next heal" waits for her heal, as 闪灵's S2): "下次治疗使所有目标获得一个
//   持续N秒的屏障，屏障能吸收相当于夜莺攻击力X%的法术伤害，同时使目标法术抗性+Y" — every target of that heal (3 / 4) gets a
//   屏障 of atk_scale × her ATK for duration s that absorbs arts damage only (buff shieldType 'arts', attack/effects.js
//   injuryEffects) and RES +magic_resistance (flat) while one of her barriers lasts (op-shining.js grantBarrier: each
//   barrier its own timer, older ones first, the RES bonus not stacking) [ASSUMED: the bonus goes with the last barrier].
// - S3 圣域 (MANUAL, 60 s, data ACTIVE_RANGE on its y-4 — the owner's rule: an injured ally inside it): range y-4 while it
//   runs, ATK +atk; every ally in that range RES +magic_resistance (×(1 + v): "法术抗性+105%") and dodgeArts prob
//   ("获得20%的法术闪避"), refreshed every 0.2 s.
// Medic: heals only (dmgType heal), ranged, no anti-air question; ground enemies target her normally (no 起飞 / 迷彩 / 隐匿).

import { num, talentBb, moduleBb, moduleOn, skillRec } from '../shared/tier1.js';
import { rangeAura, grantBarrier } from './op-shining.js';

const S1 = 'skcom_heal_up[3]';
const S2 = 'skchr_cgbird_2';
const S3 = 'skchr_cgbird_3';
export const PHANTOM = 'token_10003_cgbird_bird';
/** PRTS 转瞬即逝的幻影 备注 "幻影的持有上限为3个" (no blackboard key). */
export const PHANTOM_HOLD_CAP = 3;
/** Seconds between two tries of a fallen 幻影 to come back (tile busy, DP short, none held). */
const RETRY = 0.25;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

/**
 * RIN-X "攻击范围扩大": the picked module's own range grid (its range-only talent change, talentIndex −1), or null — the
 * rule of shared/loadoutRecord.js attackRangeGrid (the card / board range) and shared/tier5.js moduleRangeUp.
 */
function moduleRange(chess) {
  if (!chess?.isGolden || !moduleOn(chess) || !/攻击范围扩大/.test(String(chess?.trait?.moduleDesc ?? ''))) return null;
  const rec = (chess.modules ?? []).find((m) => m && m.uniEquipId === chess.module.id);
  const g = (rec?.talentChanges ?? []).find((t) => t && t.talentIndex === -1 && Array.isArray(t.rangeGrid) && t.rangeGrid.length)?.rangeGrid;
  return g ? g.map((p) => [p[0], p[1]]) : null;
}

/**
 * The 幻影's own talent blackboard (`prob`, `hp_ratio`) from its def at the owner's form and module: the last talent
 * holding `prob` — a module's upgrade (RIN-Y stage 3: 40 %) follows the base talent in the variant data.
 * @param {object} def normalised token def
 */
export function phantomTalent(def) {
  let out = {};
  for (const t of def?.talents ?? []) if (t && t.bb && t.bb.prob != null) out = t.bb;
  return out;
}

export default {
  char_179_cgbird: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const t0 = talentBb(chess, 0);   // 白恶魔的庇护: magic_resistance (RIN-X stage 2+: heal_scale)
    const t1 = talentBb(chess, 1);   // 转瞬即逝的幻影: cnt (RIN-Y stage 2+: 3)
    const hidden = moduleBb(chess);  // RIN-Y: attack@max_target
    const heals = Math.floor(num(hidden['attack@max_target']));
    const grid = moduleRange(chess);
    const picked = chess?.skill?.skillId ?? null;
    const tokenId = (chess?.talents ?? []).find((t) => t && t.tokenKey)?.tokenKey ?? PHANTOM;
    return {
      trait: heals > 0 ? { heal: { mode: 'multi', count: heals } } : undefined,
      skills: {
        [S1]: { kind: 'duration', heal: true, mods: { atkPct: num(b1.atk) } },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          heal: true,
          attack: { healScale: 1 },  // the next heal (ai.js doHeal calls onHit for every heal target)
          onHit({ battle, unit, target }) {
            if (!target || target.side !== 'ally') return;
            grantBarrier(battle, unit, target, {
              key: 'cgbird:barrier', statKey: 'cgbird:barrierRes', shield: unit.s.atk * num(b2.atk_scale),
              duration: num(b2.duration), mods: { resFlat: num(b2.magic_resistance) }, shieldType: 'arts',
            });
          },
        },
        [S3]: { kind: 'duration', heal: true, mods: { atkPct: num(b3.atk) }, targeting: s3?.rangeGrid ? { rangeGrid: s3.rangeGrid } : undefined },
      },
      talents: [
        { install(battle, unit) { // 白恶魔的庇护: allies in her attack range RES +magic_resistance; RIN-X stage 2+: healing ×heal_scale
          const r = num(t0.magic_resistance), hs = num(t0.heal_scale, 1);
          if (!(r > 0) && hs === 1) return;
          const mods = { ...(r ? { resFlat: r } : null), ...(hs !== 1 ? { healingTakenMul: hs } : null) };
          rangeAura(battle, unit, { key: 'talent:cgbird:res', value: r + (hs - 1) * 100, mods });
        } },
        { install(battle, unit) { // 转瞬即逝的幻影: the 幻影's talent, her stock, a fallen 幻影's return
          const cnt = Math.max(0, Math.floor(num(t1.cnt)));
          if (!(cnt > 0)) return;
          unit.mem.phantomStock = 0;
          const mine = (t) => !!t && t.kind === 'token' && t.defId === tokenId && t.ownerUnit === unit;
          battle.on('deploy', (ctx) => {
            const u = ctx.unit;
            if (u === unit) {
              unit.mem.phantomStock = Math.min(PHANTOM_HOLD_CAP, (unit.mem.phantomStock ?? 0) + cnt);
              return;
            }
            if (!mine(u)) return;
            const tal = phantomTalent(u.def);
            const p = num(tal.prob), hr = num(tal.hp_ratio);
            if (p > 0) battle.addBuff(u, { key: 'cgbird:phantomDodge', mods: { dodgePhys: p }, tags: ['talent'] });
            if (hr > 0) {
              battle.addBuff(u, {
                key: 'cgbird:phantomDrain', interval: 1, tags: ['talent'],
                onTick: ({ unit: t }) => battle.loseHp(t, t.s.maxHp * hr, { silent: true, tags: ['cgbird:phantom'] }),
              });
            }
          }, { owner: unit });
          battle.on('death', (ctx) => {
            const t = ctx.unit;
            if (!mine(t) || ctx.reason !== 'killed' || battle.finished) return;
            t.removed = false; // the piece stays (Battle.redeploy accepts it; its hooks are kept)
            const at = battle.time + Math.max(0, num(t.base.respawnTime));
            battle.every(RETRY, (b, sched) => {
              if (t.alive || t.removed || b.finished) { sched.cancel(); return; }
              if (b.time + 1e-9 < at || !((unit.mem.phantomStock ?? 0) > 0)) return;
              if (b.redeploy(t, { free: false })) { unit.mem.phantomStock--; sched.cancel(); }
            }, { owner: unit });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // RIN-X: the module's range is her own (the initial range of the DEFAULT trigger too); 圣域 runs its y-4
        if (grid) { unit.rangeGrid = grid; battle.refreshRange(unit); }
        // 圣域: allies in her (y-4) range RES ×(1 + magic_resistance), arts dodge prob, while the skill runs
        if (picked === S3) {
          const mr = num(b3.magic_resistance), p = num(b3.prob);
          if (mr > 0 || p > 0) rangeAura(battle, unit, { key: 'skill:cgbird:sanctuary', value: mr, mods: { resMul: 1 + mr, dodgeArts: p }, on: () => !!unit.skill?.active });
        }
      },
    };
  },
};
