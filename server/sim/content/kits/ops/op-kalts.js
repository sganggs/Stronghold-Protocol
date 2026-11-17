// server/sim/content/kits/ops/op-kalts.js — 凯尔希 (char_003_kalts) 自选 operator kit: 6★ 医师 (医疗), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her modules (PHY-X Mon2tr, PHY-Y 医者, ISW-A 凯尔希特限
// 证章) at every form, and the kit of her summon Mon3tr (token_10002_kalts_mon3tr) — its block, its attacks and her skills
// acting through it. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_003_kalts): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json);
// PRTS 凯尔希 (Mon3tr 备注 "仅在未装配模组时优先治疗效果为优先治疗自身、干员Mon3tr和凯尔希的召唤物", "可以强行选择…凯尔希的召唤物
// 作为治疗目标，相同生命比例下优先治疗自身", "治疗效果无视禁疗，但对象选取受禁疗制约"; 不毁重构 备注 "可对空"; S3 备注 "技能效果流失
// 的生命值可以击倒Mon3tr，并触发第二天赋", "攻击力加成每秒更新一次"); PRTS Mon3tr(凯尔希的召唤物) (备注 "持有禁疗（可被凯尔希…无视）",
// "凯尔希退场时强制撤退场上的Mon3tr"; 攻击范围 1-1, 阻挡数 3); gamedata_const ba.binding 绑定 "绑定对象不在场时技能强制结束，清空
// 所有技力且无法回复技力"; the client's battle data (charpack char_003_kalts: its attack `_ignoreHealFree`, WithdrawTokens,
// Talents/1 the in-range aura kalts_t_1[token_def_down_finish] + charge_token[born], Talents/2; token prefab
// token_10002_kalts_mon3tr: mon3tr_c_healfree (abnormal flag 7 = 禁疗), kalts_t_1[token_def_down] (DEF FINAL_SCALER 0),
// kalts_token[finish_kill_mark], Talents/2 the death rattle (FixedValueDamage PURE `value`, SPLASH, stun `stun`, range x-4),
// modes S2 (`_limitedMaxTargetNumToBlockedCnt`) / S3 (damage type PURE); skill prefabs skchr_kalts_1 (kalts_s_1[evade] =
// damage_block[phy]), skchr_kalts_2 / _3 (`_onlyAvailableWhenTokenValid`, RecoverSpCond every 0.1 s); equips kalts_equip_1_*
// (heal_scale_up[hpratio][LE]; stage 2+ the toggle-once HP ≤ 50 % rattle), kalts_equip_2_* (heal_scale_up[lowland]),
// kalts_equip_3_* (`_checkRoguelikeMode`); buff_template_data kalts_s_2_3[sp_cond], kalts_t_withdraw_token,
// kalts_s_3[ratio_atk], kalts_token_death_rattle_projectile, kalts_e_002_t[token]).
// - Trait (医师) "恢复友方单位生命": the profession default (one heal per attack on an injured ally of her 3-10 range), with T1's
//   order: when she, her Mon3tr or — with no module — an operator Mon3tr (char_4179_monstr) is injured, the one of them with
//   the lowest HP ratio (ties: herself); else the lowest HP ratio. Her heals reach her Mon3tr through its 禁疗, and her heal
//   selection takes it (profile `healThrough`, attack/heal.js heal / Battle.injuredAlliesInKeys); other 禁疗 units stay out.
// - Module PHY-X Mon2tr: ×heal_scale (1.15) on a heal whose target is at or below hp_ratio (50 %) before it
//   (heal_scale_up[hpratio][LE]); stage 3 changes T2 (below). PHY-Y 医者: ×heal_scale on a heal whose target stands on a 地面
//   tile (heal_scale_up[lowland]); stage 3 changes T1 (below). ISW-A 凯尔希特限证章: only its attributes act — its trait
//   ("在集成战略中，同时治疗两个目标") and talent ("在集成战略中，Mon3tr不占用部署位，生命上限和攻击力+50%…") are 集成战略-only
//   (`_checkRoguelikeMode`): N/A here, the trait blackboard it carries is not used. Stats: the module attributes.
// - T1 Mon3tr: her Mon3tr is a hand piece the player places; it deploys with the board, blocks 3 and strikes one ground
//   enemy of its 1-1 in melee for physical damage (its data), holds 禁疗 (only her heals pass — the data's `abnormal` lacks it
//   [ASSUMED: given here]); its DEF is ×0 while its tile is outside her attack range (kalts_t_1[token_def_down]; PHY-Y stage
//   3: inside it ASPD +attack_speed, DEF +def — kalts_t_1[token_def_down_finish]). It is withdrawn when she leaves (no
//   rattle); it comes back on its tile its respawnTime (25 s) after it left, paying its cost (10 DP), only while she stands —
//   her (re)deployment readies a waiting one at once (charge_token[born]: RechargeToken with timing NORMAL, while its own timer
//   is the summon's charge_token[finish], ON_FINISH — the one reading of every summoner kit, 傀影's twin included)
//   [ASSUMED: the 卫戍 auto redeploy of a placed summon].
// - T2 不毁重构: Mon3tr knocked out (not withdrawn; S3's 流失 counts) ⇒ every selectable enemy of its 3×3 (the talent's x-4,
//   air units too) takes `value` (1400) true damage (溅射, not dodgeable) and is stunned `stun` (3.5) s. PHY-X stage 3 (the
//   token's module talent: 4 s, 1700, hp_ratio): also once per deployment when a hit leaves it at or below hp_ratio of
//   its max HP (the equip's toggle-once `_maxHpRatio` 0.5) and it survives [ASSUMED].
// - S1 指令：结构加固 (MANUAL, data DEFAULT — a heal skill: cast as she is about to heal): her DEF +def and Mon3tr's DEF
//   +attack@def while it runs; 物理格挡 prob (damage_block[phy]: a physical damage instance she takes is blocked whole —
//   not a dodge, nothing ignores it; a 流失 is no damage).
// - S2 指令：战术协同 (MANUAL, data DEFAULT, 绑定 Mon3tr): her ASPD +attack_speed; Mon3tr ATK +attack@atk and "可以攻击阻挡的所有
//   敌人": each of its attacks takes up to its block count (3) of targets, the blocked ones first (the 强攻手 rule — PRTS 分支特性信息
//   "普通攻击最大目标数等于阻挡数（不会低于1）"; its mode's _limitedMaxTargetNumToBlockedCnt).
// - S3 指令：熔毁 (MANUAL, data DEFAULT, 绑定 Mon3tr, 18 s): Mon3tr DEF +attack@def, its attacks deal true damage, its ATK
//   +attack@atk × the remaining share of the skill, updated every second from the cast (+190 % … +10.6 %); unless it killed
//   an enemy meanwhile, at the skill's normal end it loses attack@hp_ratio × its max HP (a 流失 that may knock it out).
// - 绑定 (S2 / S3): cast only while her Mon3tr is on the field; every 0.1 s without one, a running S2 / S3 ends, her SP is
//   emptied and recovers no more (阻回 flag `noSp`) until it is back (kalts_s_2_3[sp_cond]).

import { num, talentBb, traitBb, moduleOn, skillRec, up } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { COLS } from '../../../constants.js';
import { acquireTargets } from '../../../ai.js';

const S1 = 'skchr_kalts_1';
const S2 = 'skchr_kalts_2';
const S3 = 'skchr_kalts_3';
/** Her summon Mon3tr (talent Mon3tr). */
export const MON3TR = 'token_10002_kalts_mon3tr';
/** The operator Mon3tr (an owned 自选 pick): in T1's heal order when she wears no module (PRTS 备注). */
const OP_MON3TR = 'char_4179_monstr';
const PHY_X = 'uniequip_002_kalts';
const PHY_Y = 'uniequip_003_kalts';
/** 不毁重构's area when the token talent lacks it (x-4: its tile and the 8 around it). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** 绑定's check period (RecoverSpCond triggerInterval 0.1). */
const BIND_IV = 0.1;
/** How often a waiting Mon3tr tries to come back once ready. */
const RETRY = 0.1;
const BIND_KEY = 'kalts:binding';
const TAG_RATTLE = 'kalts:rattle';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const isMon3trOf = (t, unit) => !!t && t.kind === 'token' && t.defId === MON3TR && t.ownerUnit === unit;
const mon3trsOf = (battle, unit) => battle.allyUnits.filter((t) => isMon3trOf(t, unit));
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
/** Keep buff `key` with `mods` on `u` while `want`; replace it when the mods changed. */
function holdBuff(battle, u, key, want, mods) {
  const has = u.findBuff(key);
  if (!want) { if (has) battle.removeBuff(u, key); return; }
  if (has && Object.keys(mods).every((k) => has.mods?.[k] === mods[k])) return;
  battle.addBuff(u, { key, mods, tags: ['skill'] });
}

/** 不毁重构's blast from Mon3tr's tile: `value` true damage (溅射) + `stun` s on every selectable enemy of its 3×3. */
function rattle(battle, m, { value, stun, grid }) {
  battle.fx('aoe', { x: m.x, y: m.y, radius: 1.5, id: m.id, skill: TAG_RATTLE });
  const keys = absoluteRangeKeys(grid, m.tileR, m.tileC, m.dir, 0);
  for (const e of battle.enemiesInKeys(keys, m, { canHitFly: true })) {
    if (!e.alive) continue;
    battle.dealDamage(m, e, { amount: value, type: 'true', isSplash: true, canDodge: false, tags: [TAG_RATTLE] });
    if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: m });
  }
}

/**
 * Mon3tr's kit: 禁疗, DEF ×0 outside her range (PHY-Y stage 3 bonus inside), her S1 / S2 / S3 acting through it, 不毁重构
 * (and PHY-X stage 3's), its return. `owner` = 凯尔希.
 */
function mon3trKit(owner, { t0, b1, b2, b3 }) {
  return {
    skill: null,
    talents: [],
    install(battle, m) {
      const rt = (m.def?.talents ?? []).find((x) => x && x.bb && x.bb.value != null);
      const rb = rt?.bb ?? {};
      const blast = { value: num(rb.value, 1200), stun: num(rb.stun, 3), grid: rt?.rangeGrid?.length ? rt.rangeGrid : X4 };
      const halfAt = num(rb.hp_ratio);   // PHY-X stage 3: 生命值首次低于50%
      battle.addBuff(m, { key: 'kalts:mon3tr:abnormal', flags: { noHeal: true }, persist: true, allowDead: true });   // 持有禁疗
      battle.on('deploy', (c) => {
        if (c.unit !== m) return;
        m.mem.halfDone = false;
        m.mem.s3NoKill = false;
      }, { owner: m });
      // her range, her skills: buffs held every tick
      battle.on('tick', () => {
        if (!up(m)) return;
        const inRange = up(owner) && !!owner.rangeKeySet && owner.rangeKeySet.has(m.tileR * COLS + m.tileC);
        holdBuff(battle, m, 'kalts:mon3tr:defZero', !inRange, { defMul: 0 });
        holdBuff(battle, m, 'kalts:mon3tr:near', inRange && (num(t0.attack_speed) > 0 || num(t0.def) > 0), { aspd: num(t0.attack_speed), defPct: num(t0.def) });
        holdBuff(battle, m, 'kalts:s1:mon3tr', skillOn(owner, S1), { defPct: num(b1['attack@def']) });
        holdBuff(battle, m, 'kalts:s2:mon3tr', skillOn(owner, S2), { atkPct: num(b2['attack@atk']) });
        let s3Atk = 0;
        if (skillOn(owner, S3)) {
          const sk = owner.skill;
          const dur = sk.duration > 0 ? sk.duration : 1;
          const steps = Math.floor(battle.time - sk.lastStart + 1e-9);   // "攻击力加成每秒更新一次", from the cast
          s3Atk = num(b3['attack@atk']) * Math.max(0, 1 - steps / dur);
        }
        holdBuff(battle, m, 'kalts:s3:mon3tr', skillOn(owner, S3), { atkPct: s3Atk, defPct: num(b3['attack@def']) });
      }, { owner: m });
      // S2: "Mon3tr可以攻击阻挡的所有敌人" — the 强攻手 rule (its mode's _limitedMaxTargetNumToBlockedCnt): up to its block count
      // of targets, the blocked ones first (ai.js acquireTargets with `hitAllBlocked`)
      battle.on('beforeAttack', (c) => {
        if (c.attacker !== m || !skillOn(owner, S2) || !c.profile) return;
        const t = acquireTargets(battle, m, { ...c.profile, hitAllBlocked: true });
        if (t.length) c.targets = t;
      }, { owner: m });
      // S3: true damage; a kill keeps its HP
      battle.on('hit', (c) => {
        if (c.source === m && c.dmg && c.dmg.isAttack && skillOn(owner, S3)) c.dmg.type = 'true';
      }, { owner: m, priority: 50 });
      battle.on('kill', (c) => { if (c.killer === m && c.victim && c.victim.side === 'enemy') m.mem.s3NoKill = false; }, { owner: m });
      // PHY-X stage 3: once per deployment, a hit that leaves it at or below half
      if (halfAt > 0) {
        battle.on('damaged', (c) => {
          if (c.target !== m || m.mem.halfDone || !m.alive || !(m.hp > 0) || m.hpRatio > halfAt + 1e-9) return;
          m.mem.halfDone = true;
          rattle(battle, m, blast);
        }, { owner: m });
      }
      battle.on('death', (c) => {
        if (c.unit !== m || battle.finished) return;
        if (c.reason === 'killed') rattle(battle, m, blast);   // 被击倒后（不包括撤退）
        // the piece stays (退场时返还1个可部署的Mon3tr): back on its tile once ready, while she stands
        m.removed = false;
        m.mem.readyAt = battle.time + Math.max(0, num(m.base.respawnTime));
        if (m.mem.retry) return;
        m.mem.retry = battle.every(RETRY, (b, sched) => {
          const stop = () => { sched.cancel(); m.mem.retry = null; };
          if (m.alive || m.removed || b.finished) { stop(); return; }
          if (!up(owner) || b.time + 1e-9 < m.mem.readyAt) return;
          if (b.redeploy(m, { free: false })) stop();
        }, { owner: m });
      }, { owner: m, priority: -10 });
    },
  };
}

export default {
  char_003_kalts: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // Mon3tr: def, attack_speed (PHY-Y stage 3: 0.2 / 20 inside her range)
    const tb = traitBb(chess);       // PHY-X: heal_scale, hp_ratio; PHY-Y: heal_scale (ISW-A's: 集成战略-only, unused)
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const mod = moduleOn(chess) ? chess.module.id : null;
    const picked = chess?.skill?.skillId ?? null;
    return {
      // her heals pass her Mon3tr's 禁疗 and her heal selection takes it (PRTS: "持有禁疗（可被凯尔希…无视）")
      trait: { healThrough: (healer, a) => isMon3trOf(a, healer) },
      skills: {
        [S1]: {
          kind: 'duration', mods: { defPct: num(b1.def) },
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'kalts:physicalBlock', tags: ['skill'], injury(c) {
              if (c.type === 'phys' && c.block(num(b1.prob))) battle.fx('block', { x: unit.x, y: unit.y, id: unit.id });
            } });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'kalts:physicalBlock'); },
        },
        [S2]: {
          kind: 'duration', mods: { aspd: num(b2.attack_speed) },
          onStart({ battle, unit, skill }) { if (!mon3trsOf(battle, unit).some(up)) skill.end('binding'); },   // 绑定
        },
        [S3]: {
          kind: 'duration',
          onStart({ battle, unit, skill }) {
            const m = mon3trsOf(battle, unit).find(up);
            if (!m) { skill.end('binding'); return; }
            m.mem.s3NoKill = true;   // kalts_s_3[no_kill_mark]
          },
          onEnd({ battle, unit, reason }) {
            if (reason !== 'duration') return;   // ended by 绑定 or her leaving: no loss
            for (const m of mon3trsOf(battle, unit)) {
              if (!up(m) || !m.mem.s3NoKill) continue;
              m.mem.s3NoKill = false;
              battle.loseHp(m, m.s.maxHp * num(b3['attack@hp_ratio'], 0.5), { source: m, tags: ['kalts:meltdown'] });
            }
          },
        },
      },
      talents: [
        { install(battle, unit) { // Mon3tr: her pieces run Mon3tr's kit; withdrawn with her, readied by her deployment
          for (const t of battle.allyUnits) {
            if (!isMon3trOf(t, unit) || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, mon3trKit(unit, { t0, b1, b2, b3 }));
          }
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            for (const t of mon3trsOf(battle, unit)) if (t.alive) battle.retreat(t, { reason: 'retreat', permanent: true });
          }, { owner: unit });
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            for (const t of mon3trsOf(battle, unit)) if (!t.alive && !t.removed) t.mem.readyAt = battle.time;
          }, { owner: unit });
          // the heal order: herself, her Mon3tr (and, with no module, an operator Mon3tr) first when injured
          const noModule = !moduleOn(chess);
          const first = (a) => a === unit || isMon3trOf(a, unit) || (noModule && a.kind === 'op' && a.def?.charId === OP_MON3TR);
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !c.profile || c.profile.dmgType !== 'heal') return;
            const pri = battle.injuredAlliesInKeys(unit.rangeKeys, unit).filter(first);
            if (!pri.length) return;
            pri.sort((a, b) => a.hpRatio - b.hpRatio || (a === unit ? -1 : b === unit ? 1 : 0) || a.deploySeq - b.deploySeq);
            c.targets = [pri[0]];
          }, { owner: unit, priority: 10 });
        } },
        // 不毁重构 lives in Mon3tr's kit (its knock-out, PHY-X stage 3's half-HP blast)
      ],
      install(battle, unit) {
        // PHY-X / PHY-Y: ×heal_scale on the heals she outputs to a target at or below hp_ratio / on a 地面 tile
        const hs = num(tb.heal_scale, 1);
        const boosted = mod === PHY_X ? (t) => t.hpRatio <= num(tb.hp_ratio, 0.5) + 1e-9 : mod === PHY_Y ? (t) => !!t.ground : null;
        if (boosted && hs !== 1) {
          battle.on('heal', (c) => {
            if (c.source !== unit || c.opts?.regen || !c.target || !boosted(c.target)) return;
            c.amount *= hs;
          }, { owner: unit });
        }
        // 绑定 (S2 / S3): no Mon3tr on the field ⇒ the skill ends, the SP is emptied and recovers no more
        if (picked === S2 || picked === S3) {
          battle.every(BIND_IV, () => {
            if (!unit.alive || !unit.deployed || !unit.skill) return;
            if (mon3trsOf(battle, unit).some(up)) { if (unit.findBuff(BIND_KEY)) battle.removeBuff(unit, BIND_KEY); return; }
            const sk = unit.skill;
            if (sk.active) sk.end('binding');
            sk.sp = 0;
            sk.charges = 0;
            if (!unit.findBuff(BIND_KEY)) battle.addBuff(unit, { key: BIND_KEY, flags: { noSp: true }, tags: ['skill'] });
          }, { owner: unit, immediate: true });
        }
      },
    };
  },
};
