// server/sim/content/kits/ops/op-bgsnow.js — 鸿雪 (char_4055_bgsnow) 自选 operator kit: 6★ 重射手 (狙击), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules (ARC-Y 打字机色带, ARC-X 仪式感) at
// every form, and the kit of her summon “打字机” (token_10026_bgsnow_subbow). Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4055_bgsnow): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json)
// and PRTS 鸿雪 + “打字机” (点题 备注; the {{**|82%|下降18%}} marks = a final ×0.82 (full potential: ×0.8); PRTS 伤害分类: "鸿雪2技能三段伤害的后2段"
// are 持续伤害).
// - Trait (重射手) "高精度的近距离射击": ranged physical arrows, 3-6, can hit air units (PRTS 分支特性信息 重射手 "可对空"),
//   blocks 1, ground enemies target her (no flag).
// - Module ARC-Y “打字机色带” trait "攻击正前方的敌人时攻击力提升至105%且无视其物理闪避" (trait bb atk_scale): her damage on
//   an enemy whose body is on her straight line ahead ×atk_scale, not dodgeable — 点题's two 持续伤害 hits included
//   [ASSUMED: they are two of its "3次攻击"]; 正前方 = local row 0, column ≥ 0 (her own tile included, as the 3-2 "前方3格"
//   lines count it) [ASSUMED]. Stage 2+ "属性更强的打字机": the typewriter's stats of the data (token module attributes).
// - Module ARC-X “仪式感”: "再部署时间减少" (attribute respawn_time −25, in the stats); stage 2+ upgrades 弱点速记 (below).
// - T1 自动打字机 "可使用一个持续25秒的“打字机”，“打字机”拥有和自己一样的技能，拥有独立的再部署时间": the typewriter is a
//   hand piece the player places (the mode's talent summons, content/tokens.js header): it deploys with the board, leaves
//   after 25 s (the token's hidden talent `interval`), and comes back on its tile after its own redeploy time (data 40 s; ×
//   respawn_time while she carries S2), paying its cost (5 DP), while she is on the field [ASSUMED: as the 海嗣]. Its skill
//   is the copy of hers the data gives (bySkill: sktok_bgsnow_1 / 2 / 3 — the 卫戍 strategy force-opens a summon's manual
//   skill, PRTS 卫戍协议/帮助): free (spCost 0), once per deployment, by the data's DEFAULT. It is untargetable ("不会受到
//   攻击"), blocks nothing, hits air units. content/tokens.js has no kit for it: her install gives her pieces this one.
// - T2 弱点速记 "“打字机”的攻击会使命中目标的防御力下降18%，持续4秒；若“打字机”放在鸿雪周围四格则效果提升至23%" (full potential:
//   20% for 5 s, 25%): every damage the typewriter's attacks land cuts the target's DEF by bgsnow_token[def_down]_1 (_2
//   while the typewriter stands on one of the 4 tiles next to her — while she is on the field [ASSUMED]) for `duration` s:
//   the catalogue `defDown` (final ×, 同名 keeps the strongest). ARC-X stage 2+: 28 % / 33 % (full potential: 30 % /
//   35 %) and "周围八格" (the talent text names the ring).
// - S1 抑扬格 (AUTO, attack SP, data DEFAULT — an AUTO attack buff waits for her next attack): ATK +atk until she leaves the
//   field ("持续时间无限": a toggle), and every attack meanwhile `prob` to deal ×atk_scale (one roll per attack).
// - S2 点题 (MANUAL, 2 charges, data SKILL_RANGE on its 3-1): passive — the typewriter's redeploy time ×respawn_time;
//   active — 3 attacks at once ("立即": the cast takes the next attack now) on one target of the 3-1, atk_scale × ATK each:
//   the first a physical 普通伤害 attack, the other two physical 持续伤害 (PRTS 伤害分类: tags 'dot', not dodgeable).
//   PRTS 备注 "仅在干员自身范围内有可攻击目标时可释放": the data's SKILL_RANGE fires for any enemy of the 3-1, untargetable
//   ones too; the cast then waits (pending) for an attackable target — reported as an open question (the 备注 reading
//   of the strategy would be the basic one on her own range).
// - S3 锐笔速写 (MANUAL, data ACTIVE_RANGE on its 3-1): range 3-1 while it runs, attack interval base_attack_time s (−0.6 on
//   1.6 s), every attack atk_scale × ATK, bgsnow_s_3[atk_up].atk_scale × ATK on the 正前方3格 (the 3-2 line, her tile
//   included [ASSUMED]).

import { num, up, traitBb, skillRec, batMod } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyKeys, bodyInRange } from '../../../body.js';
import { toLocal } from '../../../dir.js';
import { hasHp } from '../../../attack.js';
import { COLS } from '../../../constants.js';
import { startCountdown } from '../../tokens.js';

const S1 = 'skchr_bgsnow_1';
const S2 = 'skchr_bgsnow_2';
const S3 = 'skchr_bgsnow_3';
export const TYPEWRITER = 'token_10026_bgsnow_subbow';
const TS1 = 'sktok_bgsnow_1';
const TS2 = 'sktok_bgsnow_2';
const TS3 = 'sktok_bgsnow_3';
/** 锐笔速写's 正前方3格: the 3-2 line (range_table) — her tile and the three ahead. */
const FRONT_3 = Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]]);
/** 点题's two 持续伤害 hits (PRTS 伤害分类 attackType BUFF). */
const TAG_PRECIS = 'bgsnow:precis';
/** 自动打字机: the typewriter's life when neither the token nor the talent carries it (PRTS: 持续25秒 at E2). */
const LIFE_FALLBACK = 25;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** First talent of a normalised token def holding `key` (token talents keep no index). */
const tokTalent = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null) ?? null;

/** ARC-Y 正前方: the enemy's body touches the unit's straight line ahead (local row 0, local column ≥ 0). */
function inFrontLine(unit, e) {
  for (const k of bodyKeys(e)) {
    const [lr, lc] = toLocal(Math.floor(k / COLS) - unit.tileR, (k % COLS) - unit.tileC, unit.dir);
    if (lr === 0 && lc >= 0) return true;
  }
  return false;
}

/** 点题 / its copy: the two 持续伤害 hits after the attack's first (普通伤害) hit, on the same target. */
function precisFollowUps(battle, unit, target, scale) {
  for (let i = 0; i < 2 && target && target.alive; i++) {
    battle.dealDamage(unit, target, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'dot', TAG_PRECIS] });
  }
}

/** 抑扬格 / its copy: while `on(unit)`, every attack `prob` to deal ×scale (one roll per attack). */
function installIamb(battle, unit, prob, scale, on) {
  if (!(prob > 0) || !(scale > 0) || scale === 1) return;
  battle.on('hit', (ctx) => {
    const d = ctx.dmg, t = ctx.target;
    if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || d.isSplash || d.type === 'element' || !on(unit)) return;
    const m = unit.mem;
    if (!d.attackId || m.iambRollId !== d.attackId) {
      m.iambRollId = d.attackId;
      m.iambProc = battle.rng.chance(prob);
      if (m.iambProc) battle.fx('crit', { x: t.x, y: t.y, id: unit.id });
    }
    if (m.iambProc) d.amount *= scale;
  }, { owner: unit });
}

/**
 * The typewriter's kit: its skill (the copy of her skill the data gives), 弱点速记, its life and its redeploys.
 * `owner` = 鸿雪, `chess` = her composed record.
 */
function typewriterKit(t, owner, chess) {
  const def = t.def;
  const sk = def.skill ?? null;
  const tb = sk?.bb ?? {};
  const weak = tokTalent(def, 'duration');
  const wb = weak?.bb ?? {};
  const cut1 = -num(wb['bgsnow_token[def_down]_1.def']), cut2 = -num(wb['bgsnow_token[def_down]_2.def'], -cut1);
  const ring8 = /八格/.test(String(weak?.description ?? ''));
  const ownTalent = (chess?.talents ?? []).find((x) => x && x.index === 0)?.bb ?? {};
  const life = num(tokTalent(def, 'interval')?.bb?.interval, num(ownTalent.duration, LIFE_FALLBACK));
  const respawnMul = owner.skill?.id === S2 ? num(bbOf(chess, S2).respawn_time, 1) : 1;
  const near = () => {
    if (!up(owner)) return false;
    const dr = Math.abs(t.tileR - owner.tileR), dc = Math.abs(t.tileC - owner.tileC);
    return ring8 ? Math.max(dr, dc) === 1 : dr + dc === 1;
  };
  const skillOn = (u) => !!(u.skill && u.skill.active);
  let skill = null;
  if (sk?.id === TS1) skill = { kind: 'toggle', mods: { atkPct: num(tb.atk) } };
  else if (sk?.id === TS2) {
    const scale = num(tb.atk_scale, 1);
    skill = { kind: 'instant', attack: { atkScale: scale, onHit({ battle, unit, target }) { precisFollowUps(battle, unit, target, scale); } } };
  } else if (sk?.id === TS3) {
    skill = {
      kind: 'duration',
      targeting: { rangeGrid: sk.rangeGrid ?? [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
      mods: { batPct: batMod(tb.base_attack_time, { stats: def.stats }) },
      attack: { atkScale: num(tb['attack@atk_scale'], 1) },
    };
  }
  return {
    skill,
    talents: [{ install(battle, unit) { // 弱点速记: every damage of its attacks cuts the target's DEF (near her: more)
      const dur = num(wb.duration, 4);
      if (!(cut1 > 0) || !(dur > 0)) return;
      battle.on('damaged', (ctx) => {
        if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy' || !hasHp(ctx.target) || ctx.dmg?.type === 'element') return;
        battle.applyStatus(ctx.target, 'defDown', { duration: dur, value: near() ? cut2 : cut1, source: unit });
      }, { owner: unit });
    } }],
    install(battle, unit) {
      if (sk?.id === TS1) installIamb(battle, unit, num(tb.prob), num(tb.atk_scale, 1), skillOn);
      // 持续25秒: leaves `life` s after each deployment — a countdown summon (content/tokens.js startCountdown): 无敌,
      // 禁疗 [ASSUMED], its bar = the life left
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit || !(life > 0)) return;
        startCountdown(battle, unit, life);
        const seq = unit.deploySeq;
        battle.after(life, () => { if (unit.alive && unit.deploySeq === seq) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
      }, { owner: unit });
      // 拥有独立的再部署时间: back on its tile after its redeploy time, paying its cost, while 鸿雪 stands (the piece is kept:
      // `removed` false, as content/tokens.js enableRespawn)
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit || battle.finished) return;
        unit.removed = false;
        const at = battle.time + Math.max(0, num(unit.base.respawnTime) * respawnMul);
        unit.mem.respawnAt = at;
        battle.every(0.25, (b, sched) => {
          if (unit.alive || unit.removed) { sched.cancel(); return; }
          if (b.time + 1e-9 < at || !up(owner)) return;
          if (b.redeploy(unit, { free: false })) sched.cancel();
        }, { owner: unit });
      }, { owner: unit, priority: -10 });
    },
  };
}

export default {
  char_4055_bgsnow: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const frontScale = num(traitBb(chess).atk_scale, 1);
    const s2Scale = num(b2.atk_scale, 1);
    const s3Scale = num(b3.atk_scale, 1), s3Front = num(b3['bgsnow_s_3[atk_up].atk_scale'], s3Scale);
    return {
      skills: {
        [S1]: { kind: 'toggle', mods: { atkPct: num(b1.atk) } },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          // the 3-1 selects the target; her attack range stays her own (a 技能范围, not a range change)
          targeting: { rangeGrid: s2?.rangeGrid ?? null, showOwnRange: true },
          attack: { atkScale: s2Scale, onHit({ battle, unit, target }) { precisFollowUps(battle, unit, target, s2Scale); } },
          onStart({ unit }) { unit.atkCd = 0; }, // "立即": the pending attack goes off now when a target is there
        },
        [S3]: {
          kind: 'duration',
          targeting: { rangeGrid: s3?.rangeGrid ?? null },
          mods: { batPct: batMod(b3.base_attack_time, chess) },
          attack: { atkScale: s3Scale },
        },
      },
      talents: [
        // 自动打字机 (and 弱点速记, the typewriter's own talent): her typewriter pieces run the typewriter's kit — set up
        // here, before the battle starts (Battle._setupUnit with a kit, as spawnToken's `kit` option)
        { install(battle, unit) {
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || t.defId !== TYPEWRITER || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t); // a piece set up before her: drop its generic kit's hooks
            battle._setupUnit(t, typewriterKit(t, unit, chess));
          }
        } },
      ],
      install(battle, unit) {
        const sid = unit.skill?.id;
        if (sid === S1) installIamb(battle, unit, num(b1.prob), num(b1.atk_scale, 1), (u) => !!u.skill?.active);
        // 锐笔速写: 正前方3格 ⇒ atk_up's scale instead of the skill's
        if (sid === S3 && s3Front !== s3Scale && s3Scale > 0) {
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, t = ctx.target;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || !unit.skill?.active) return;
            if (bodyInRange(t, absoluteRangeKeys(FRONT_3, unit.tileR, unit.tileC, unit.dir, 0))) d.amount *= s3Front / s3Scale;
          }, { owner: unit });
        }
        // ARC-Y 打字机色带: 攻击正前方的敌人时攻击力提升至105%且无视其物理闪避
        if (frontScale > 0 && frontScale !== 1) {
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, t = ctx.target;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || d.type === 'element') return;
            if (!(d.isAttack || d.tags?.includes(TAG_PRECIS)) || !inFrontLine(unit, t)) return;
            d.amount *= frontScale;
            d.canDodge = false;
          }, { owner: unit });
        }
      },
    };
  },
};
