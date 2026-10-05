// server/sim/content/kits/tier2.js — Tier 2 operator kits.
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). Shared helpers live in tier1.js (named
// exports). Numbers come from the skill / talent / trait blackboards (elite module upgrades are in the elite record's
// trait.bb and hidden index −1 talents). fx kinds: see the tier1.js header.
//
// Covered (normal + elite): 2_01 送葬人 2_02 赫默 2_03 崖心(H) 2_04 小满 2_05 哈洛德 2_06 莎草 2_07 幽灵鲨 2_08 泡泡
// 2_09 休谟斯 2_10 洛洛 2_11 风丸 2_12 砾 2_13 蒂比 2_14 调香师 2_15 协律(H) 2_16 拉普兰德 2_17 折桠 2_18 灰毫 2_19 锡人.
//
// Operator loadouts (DESIGN §16): every visible chess also authors its selectable NON-default skill in `skills`
// ({ [skillId]: SkillSpec }, official Lv4 / Lv7 blackboards — the kit function receives the SELECTED skill's `bb`, so
// every spec is built from `bb`; the trigger rule comes from that skill's data). Talent / install hooks that belong to
// the default skill only (target locks, counters, hit triggers) check onDefaultSkill(chess). Module choices need no
// code here: `chess` is the loadout-resolved record (trait.bb / talents of the selected module, or none).

import { COLS, ELEMENT_GAUGE_MAX } from '../../constants.js';
import { canTargetEnemy } from '../../targeting.js';
import { bodyInKeys } from '../../body.js';
import {
  num, talentBb, moduleBb, traitBb, up, cheb, byEnemyAttack, onHitBy, onHitOn, onDamagedOn, enemiesInGrid,
  alliesInGridOf, enemyInRange, statBuff, toggleBuff, installAura, spTimeBonus, freeTileAround, instantKind,
  tinmanKit, batMod,
} from './tier1.js';
import { releaseSkillSummon } from '../tokens.js';

/** Largest element gauge of a unit (every element — 侵蚀 included: the bosses' attacks fill it on operators). */
const elemLoad = (a) => Math.max(a.elem.burn, a.elem.neural, a.elem.necrosis, a.elem.apoptosis, a.elem.erosion ?? 0);

/**
 * Whether the SELECTED skill of a loadout-resolved chess record is its default skill (DESIGN §16: `chess.skill` is the
 * selected SkillRecord, `chess.skills[]` flags the default one). Records without skill choices count as default.
 */
function onDefaultSkill(chess) {
  const d = (chess?.skills ?? []).find((s) => s && s.isDefault);
  return !d || !chess?.skill || d.skillId === chess.skill.skillId;
}

/**
 * 起飞 of 蒂比's skills (gamedata_const ba.liftoff "不阻挡地面敌人且不会被地面敌人攻击，可以阻挡飞行敌人"): the skill's flags
 * `liftoff` (no ground enemy blocked — Battle._blockerFor; 对地规避 — targeting.js evadesGround: no ground enemy selects
 * her, while what selects nobody still lands — 无视无法选择 abilities, direct picks, flying units' blasts, 无来源 damage, the
 * ticks of a debuff already on her) and `blockFly` (blocks flyers at the air radius). She stays a ground unit on her tile (PRTS 行动方式 "起飞的
 * 干员仍然是地面单位": `unit.ground` unchanged — 隐德来希's 血镰 still counts her; 地面干员 bonds / items read her position).
 */
const LIFTOFF_FLAGS = Object.freeze({ blockFly: true, liftoff: true });
/** 蒂比 take-off: the ground enemies she blocked walk on. */
function tippiTakeOff({ battle, unit }) {
  battle.releaseBlocked(unit);
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
}
/** 蒂比 landing when the airborne skill ends: the flyers she held are released. */
function tippiLand({ battle, unit }) {
  battle.releaseBlocked(unit);
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 2_01 送葬人 最终旅程: normal attacks become double hits, base attack time +base_attack_time s (−0.5 on 2.3 s
  // "少量缩短"). 终结改装: ignore def_penetrate_fixed DEF. (Trait: every enemy in range, ×atk_scale on its front row —
  // reaperrange profile.)
  //
  // S1 铳口收束 (alt): ATK +atk; "攻击时对攻击范围内的所有敌人应用特性加成" — every enemy in range takes the trait's
  // front-row multiplier (profile frontScale: trait atk_scale 1.5, elite module 1.6, elite without module 1.5).
  chess_char_2_01_a: (bb, chess) => ({
    skill: { kind: 'duration', mods: { batPct: batMod(bb.base_attack_time, chess) }, attack: { hits: 2 } },
    skills: {
      skchr_excu_1: { kind: 'duration', mods: { atkPct: num(bb.atk) }, attack: { dmgMul: (battle, u) => num(u.profile?.frontScale, 1.5) } },
    },
    talents: [{ install(battle, unit) { statBuff(battle, unit, 'talent:excu', { defIgnoreFlat: num(talentBb(chess, 0).def_penetrate_fixed) }); } }],
  }),

  // ---------------------------------------------------------------------------------------------------------------
  // 2_02 赫默 医疗无人机 (AUTO, heal trigger): "获得一个医疗无人机 / 最多可库存1个无人机；无人机投入战场后治疗周围友军，
  // 10秒后自动销毁" — the 医疗探机 is a hand piece the player places (user playtest #6; PRTS 卫戍协议/帮助): each cast gives
  // one (stock ≤ cnt) and the placed piece takes the field on its own tile (tokens.js releaseSkillSummon: not at the
  // battle start — user playtest #4; not placed ⇒ no drone); it heals around itself and self-destructs after 10 s (token
  // kit). 强化注射: every 【医疗】 operator on the field ASPD +attack_speed. Elite module (PHY-Y): heals on ground units
  // ×heal_scale (module 'none': no bonus).
  // S1 治疗强化·γ型 (alt): ATK +atk for its duration (no drone).
  chess_char_2_02_a: (bb, chess) => {
    const tokId = chess?.skill?.overrideTokenKey ?? (chess?.tokens ?? [])[0] ?? 'token_10000_silent_healrb';
    const cnt = Math.max(1, Math.floor(num(bb.cnt, 1)));
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: {
        kind: 'instant', heal: true,
        onStart({ battle, unit }) { releaseSkillSummon(battle, unit, tokId, { cap: cnt }); },
      },
      skills: { 'skcom_heal_up[3]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        const v = num(t.attack_speed);
        if (v) installAura(battle, unit, { key: 'talent:silent', value: v, select: (a) => a.kind === 'op' && a.def.profession === 'MEDIC', mods: { aspd: v } });
        if (num(tb.heal_scale, 1) !== 1) {
          battle.on('heal', (ctx) => { if (ctx.source === unit && ctx.target.ground) ctx.amount *= num(tb.heal_scale, 1); }, { owner: unit });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_03 崖心 (hidden) 束缚链: up to max_target enemies in the large front grid are dragged (force 1 = 中力; Battle.pullToFront:
  // the official 力度 − 重量 pull — weight ≤ 1 all the way in front of her, 2 a third of the way, 3 barely, ≥ 4 not at all),
  // take atk_scale × ATK true damage and are stunned `stun` s. 雪境猎手: ATK/DEF +atk/+def while not blocking.
  // Elite module (HOK-X, trait value/dist): dragged enemies take `value` arts per `dist` tiles travelled.
  chess_char_2_03_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const force = num(bb.force, 1);
    return {
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const foes = enemiesInGrid(battle, unit, def?.skill?.rangeGrid ?? null, { n: Math.max(1, Math.floor(num(bb.max_target, 1))) });
          for (const e of foes) {
            const sx = e.x, sy = e.y;
            const moved = battle.pullToFront(e, unit, force);
            battle.fx('pull', { x: e.x, y: e.y, id: e.id, fromX: sx, fromY: sy });
            if (moved > 0 && num(tb.value) > 0) {
              battle.dealDamage(unit, e, { amount: num(tb.value) * moved / Math.max(0.01, num(tb.dist, 1)), type: 'arts', isSkill: true, canDodge: false, tags: ['drag'] });
            }
            if (!e.alive) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'true', isSkill: true, tags: ['skill'] });
            if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
          }
        },
      },
      talents: [{ install(battle, unit) {
        if (num(t.atk) || num(t.def)) toggleBuff(battle, unit, 'slchan:hunter', () => unit.blocking.length === 0, { atkPct: num(t.atk), defPct: num(t.def) });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_04 小满 乡音沉沉: stops attacking and puts max_target enemies in range to sleep `sleep` s; afterwards ASPD
  // +attack_speed and attacks max_target enemies. 好好听话: ASPD +attack_speed; vs 【野生动物】 (tag `infection`,
  // "野生的被感染生物") the trait 停顿 lasts +sluggish_addition s. Elite module (DEC-X): +sp_recovery_per_sec SP/s with
  // an enemy in range.
  // S1 竹笛飞声 (alt, 2 charges): the next attack deals atk_scale × ATK arts and hits one more enemy (+1 target).
  chess_char_2_04_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const n = Math.max(1, Math.floor(num(bb.max_target, 1)));
    const sleep = num(bb.sleep);
    return {
      trait: {
        onHitStatus: null,
        canAttack: (battle, u) => !(u.skill?.active && battle.time < (u.mem.grainQuietUntil ?? -1)),
        afterHit(battle, u, target) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const beast = (target.def?.tags || []).includes('infection');
          battle.applyStatus(target, 'sluggish', { duration: num(tb.sluggish, 0.8) + (beast ? num(t.sluggish_addition) : 0), source: u });
        },
      },
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        targeting: { maxTargets: n, rangeGrid: def?.skill?.rangeGrid ?? null },
        onStart({ battle, unit }) {
          unit.mem.grainQuietUntil = battle.time + sleep;
          for (const e of enemiesInGrid(battle, unit, def?.skill?.rangeGrid ?? null, { n })) {
            if (battle.applyStatus(e, 'sleep', { duration: sleep, source: unit })) battle.fx('sleep', { x: e.x, y: e.y, id: e.id });
          }
        },
      },
      skills: {
        skchr_grabds_1: { kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1), dmgType: 'arts' }, mods: { maxTargets: 1 } },
      },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:grabds', { aspd: num(t.attack_speed) });
        spTimeBonus(battle, unit, num(moduleBb(chess).sp_recovery_per_sec), () => enemyInRange(battle, unit));
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_05 哈洛德 重症优先: ASPD +attack_speed, heals the ally with the heaviest element damage first; on targets whose
  // gauge is over half, the element recovery is trait_scale × (the wandermedic trait: ep_heal_ratio × ATK).
  // 我即军营: allies in range whose gauge is over half take −ep_damage_resistance 元素损伤 — checked on the element hit
  // itself (`elementHit`, a 元素损伤 multiplier: PRTS 元素 "…后续可应用元素损伤倍率提升/降低等效果"; not `elemTakenMul`,
  // which is 元素伤害 / 元素脆弱); several 哈洛德 do not stack — the strongest cut applies.
  // S1 治疗强化·γ型 (alt): ATK +atk; the 重症优先 target order belongs to S2 only.
  chess_char_2_05_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    const half = ELEMENT_GAUGE_MAX / 2;
    const ts = num(bb.trait_scale, 1);
    return {
      skill: {
        kind: 'duration', heal: true, mods: { aspd: num(bb.attack_speed) },
        onHit({ battle, unit, target }) {
          if (!target || !unit.mem.haroldHalf?.has(target.id) || !(ts > 1)) return;
          battle.reduceElement(target, unit.s.atk * (unit.profile.heal?.elementHealRatio ?? 0) * (ts - 1));
        },
      },
      skills: { 'skcom_heal_up[3]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        if (s2) battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit, true);
          cands.sort((a, b) => elemLoad(b) - elemLoad(a) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
          if (cands.length) ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
          unit.mem.haroldHalf = new Set(ctx.targets.filter((a) => elemLoad(a) > half).map((a) => a.id));
        }, { owner: unit });
        const r = Math.max(0, Math.min(1, num(t.ep_damage_resistance)));
        if (r > 0) {
          battle.on('elementHit', (ctx) => {
            const a = ctx.target, d = ctx.dmg;
            if (!up(unit) || !a || a.side !== 'ally' || !d || d.type !== 'element' || !(elemLoad(a) > half)) return;
            if (!(unit.rangeKeySet || new Set(unit.rangeKeys || [])).has(a.tileR * COLS + a.tileC)) return;
            const prev = d.haroldCut || 0;               // the strongest 我即军营 of the hit only
            if (r <= prev) return;
            d.mul *= (1 - r) / (1 - prev);
            d.haroldCut = r;
          }, { owner: unit, priority: 20 });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_06 莎草 巧思乍现 (AUTO, 2 charges): the next heal is heal_scale × ATK (chain jumps included) and the talent
  // barrier is shield_scale_skill × stronger. 博览古卷: every heal gives the target a barrier of attack@scale × ATK for
  // attack@shield_duration s. (Chain falloff incl. the elite module comes from the chainhealer profile.)
  // S2 临考发挥 (alt): on start lock the ally in range (not herself, no 禁疗; any profession, summons included) with the
  // highest max HP; while it runs that ally is the only main heal target, base attack time +base_attack_time s (−1.1
  // on 2.85), ATK +atk, chain jumps +attack@chain.extra_value. PRTS: "无法可选单位时无法开启技能" — with no lockable
  // ally the skill never activates (the talent install guards the unit's skill.activate: no skillStart, no
  // 萨尔贡 / 特质 "开启技能时" gains, SP kept); the skill stops at once when the locked ally leaves the field.
  chess_char_2_06_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const sc = num(t['attack@scale']), sd = num(t['attack@shield_duration'], 8), boost = num(bb.shield_scale_skill, 1);
    const extra = Math.max(0, Math.floor(num(bb['attack@chain.extra_value'])));
    const lockOf = (battle, unit) => alliesInGridOf(battle, unit)
      .filter((a) => a !== unit && !a.s.flags.noHeal && !a.profile?.noHeal)
      .sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq)[0] ?? null;
    const release = (battle, unit) => {
      if (unit.mem.papyrsHeal) { unit.profile.heal = unit.mem.papyrsHeal; unit.mem.papyrsHeal = null; }
      if (unit.mem.papyrsHook) battle.off(unit.mem.papyrsHook);
      unit.mem.papyrsHook = null;
      unit.mem.papyrsLock = null;
      unit.mem.papyrsAbort = false;
    };
    return {
      skill: { kind: instantKind(def), heal: true, attack: { healScale: num(bb.heal_scale, 1) } },
      skills: {
        skchr_papyrs_2: {
          kind: 'duration', heal: true, mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) },
          onStart({ battle, unit, skill }) {
            release(battle, unit);
            const lock = lockOf(battle, unit);
            // (only reachable when a runtime bypasses the activate guard below, e.g. a copied skill: undo on the next tick)
            if (!lock) { unit.mem.papyrsAbort = true; return; }
            unit.mem.papyrsLock = lock;
            const h = unit.profile.heal;
            if (h && extra > 0) { unit.mem.papyrsHeal = h; unit.profile.heal = { ...h, count: Math.max(1, h.count || 3) + extra }; }
            unit.mem.papyrsHook = battle.on('beforeAttack', (ctx) => {
              if (ctx.attacker !== unit || !skill.active) return;
              const L = unit.mem.papyrsLock;
              if (L && up(L) && bodyInKeys(L, unit.rangeKeySet)) ctx.targets = [L];
            }, { owner: unit, priority: 10 });
            battle.fx('buff', { x: lock.x, y: lock.y, id: lock.id, kind: 'lock' });
          },
          onTick({ unit, skill }) {
            if (unit.mem.papyrsAbort) {
              // "无法可选单位时无法开启技能": undo the cast, keep the SP
              unit.mem.papyrsAbort = false;
              skill.end('noTarget');
              skill.addCharge(1);
              return;
            }
            const L = unit.mem.papyrsLock;
            if (!L || !up(L)) skill.end('target');
          },
          onEnd({ battle, unit }) { release(battle, unit); },
        },
      },
      talents: [{ install(battle, unit) {
        const sk = unit.skill;
        if (sk && sk.id === 'skchr_papyrs_2' && !Object.prototype.hasOwnProperty.call(sk, 'activate')) {
          // "无法可选单位时无法开启技能": every activation path (DEFAULT heal trigger, carried skill, content) is refused
          // while no ally can be locked — the charge stays, nothing starts (non-enumerable: never serialised)
          const activate = sk.activate;
          Object.defineProperty(sk, 'activate', {
            configurable: true, writable: true, enumerable: false,
            value(reason, opts) { return lockOf(battle, unit) ? activate.call(this, reason, opts) : false; },
          });
        }
        if (!(sc > 0)) return;
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || ctx.target === unit && ctx.opts?.regen || !(ctx.amount > 0)) return;
          const bySkill = !!(unit.skill?.active && unit.skill.pending);
          battle.addBuff(ctx.target, { key: 'papyrs:shield', shield: unit.s.atk * sc * (bySkill ? boost : 1), duration: sd, source: unit, visible: true, tags: ['talent'] });
        }, { owner: unit, priority: -10 });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_07 幽灵鲨 肉斩骨断: ATK +atk and HP never drops below 1 while active; stunned `stun` s afterwards.
  // Talent: max HP +max_hp (elite: + hp_recovery_per_sec_by_max_hp_ratio × max HP per s).
  // Elite module (CEN-X, trait atk_scale): vs enemies it blocks ATK ×atk_scale.
  // S1 攻击力强化·γ型 (alt): ATK +atk for its duration.
  chess_char_2_07_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) {
          if (unit.mem.undying) battle.off(unit.mem.undying);
          unit.mem.undying = battle.on('fatal', (c) => { if (c.unit === unit && unit.skill?.active) c.prevented = true; }, { owner: unit, priority: 10 });
        },
        onEnd({ battle, unit, reason }) {
          if (unit.mem.undying) battle.off(unit.mem.undying);
          unit.mem.undying = null;
          if (reason !== 'death' && unit.alive && num(bb.stun) > 0) battle.applyStatus(unit, 'stun', { duration: num(bb.stun), source: unit });
        },
      },
      skills: { 'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:ghost', { hpPct: num(t.max_hp), hpRegenRatio: num(t.hp_recovery_per_sec_by_max_hp_ratio) });
        if (num(tb.atk_scale, 1) !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.blockedBy) dmg.amount *= num(tb.atk_scale, 1); });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_08 泡泡 “挨打”: stops attacking; DEF +def, taunt +taunt_level, each attack received returns atk_scale × DEF phys
  // damage to the attacker. 尖刺盾: attackers get ATK −atk for `duration` s. Elite module (PRO-X): DEF +def while blocking.
  // S1 防御力强化·β型 (alt, TAKE_DAMAGE from data): DEF +def for its duration; the counter belongs to “挨打” only.
  chess_char_2_08_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const s2 = onDefaultSkill(chess);
    return {
      skill: { kind: 'duration', mods: { defPct: num(bb.def), taunt: num(bb.taunt_level) }, attack: { noAttack: true } },
      skills: { 'skcom_def_up[2]': { kind: 'duration', mods: { defPct: num(bb.def) } } },
      talents: [{ install(battle, unit) {
        onDamagedOn(battle, unit, (ctx) => {
          if (!byEnemyAttack(ctx) || !unit.alive) return;
          const src = ctx.source;
          if (s2 && unit.skill?.active && src.alive) {
            battle.dealDamage(unit, src, { amount: unit.s.def * num(bb.atk_scale), type: 'phys', isSkill: true, canDodge: false, tags: ['counter'] });
            battle.fx('counter', { x: src.x, y: src.y, id: unit.id });
          }
          if (num(t.atk) < 0 && src.alive) battle.addBuff(src, { key: 'bubble:spike', duration: num(t.duration, 5), mods: { atkPct: num(t.atk) }, refresh: 'extend', source: unit });
        });
        if (num(tb.def)) toggleBuff(battle, unit, 'bubble:guard', () => unit.blocking.length > 0, { defPct: num(tb.def) });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_09 休谟斯 高效处理: block +block_cnt; above peak_1.hp_ratio HP ATK +peak_1.atk (精力充沛), above peak_2.hp_ratio
  // +peak_2.atk. 再回收: healing beyond max HP becomes a barrier, at most max_hp_ratio × max HP.
  // S1 固废切割 (alt, attack SP): the next attack hits at atk_scale × ATK (every enemy it reaches) and heals her `value`
  // HP once (a self heal: her trait bars only healing by others; overflow feeds 再回收).
  chess_char_2_09_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const peaks = [];
    for (const [k, v] of Object.entries(bb)) {
      const m = k.match(/\[(peak_\d+)\]\.peak_performance\.(atk|hp_ratio)$/);
      if (!m) continue;
      let p = peaks.find((x) => x.id === m[1]);
      if (!p) peaks.push((p = { id: m[1], atk: 0, hp: 1 }));
      if (m[2] === 'atk') p.atk = num(v); else p.hp = num(v, 1);
    }
    peaks.sort((a, b) => b.hp - a.hp);
    const key = 'humus:peak';
    const peak = ({ battle, unit }) => {
      const lvl = peaks.find((p) => unit.hpRatio > p.hp)?.atk ?? 0;
      const cur = unit.findBuff(key);
      if ((cur?.data?.v ?? 0) === lvl) return;
      if (lvl > 0) battle.addBuff(unit, { key, mods: { atkPct: lvl }, data: { v: lvl }, visible: true, tags: ['skill'] });
      else battle.removeBuff(unit, key);
    };
    return {
      skill: {
        kind: 'duration', mods: { blockCnt: num(bb.block_cnt) },
        onStart: peak, onTick: peak,
        onEnd({ battle, unit }) { battle.removeBuff(unit, key); },
      },
      skills: {
        skchr_humus_1: {
          kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) },
          onAttack({ battle, unit }) {
            if (num(bb.value) > 0 && unit.alive) battle.heal(unit, unit, num(bb.value), { self: true, tags: ['skill'] });
          },
        },
      },
      talents: [{ install(battle, unit) {
        const ratio = num(t.max_hp_ratio);
        if (!(ratio > 0)) return;
        battle.on('heal', (ctx) => {
          if (ctx.target !== unit || !(ctx.amount > 0)) return;
          const over = ctx.amount - (unit.s.maxHp - unit.hp);
          if (!(over > 0)) return;
          const cur = unit.findBuff('humus:recycle');
          const have = cur ? cur.shield : 0;
          const val = Math.min(unit.s.maxHp * ratio, have + over);
          if (val > have + 1e-6) battle.addBuff(unit, { key: 'humus:recycle', shield: val, source: unit, visible: true, tags: ['talent'] });
        }, { owner: unit, priority: -50 });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_10 洛洛 自负此轭: ASPD +attack_speed; the drones lock on their target until it dies or the skill ends.
  // 过载 (term ba.overdrive "技能进行到一半时触发额外效果"): the second half of the duration — ATK +atk and the funnel cap
  // ×scale; when the skill ends she is stunned as long as the overload lasted. 立于磐石: ATK +atk per `interval` s on the
  // field, up to max_stack_cnt stacks.
  // S1 战术咏唱·γ型 (alt): ASPD +attack_speed; the target lock belongs to 自负此轭 only.
  chess_char_2_10_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    const endOverload = (battle, unit) => {
      if (unit.mem.rockFunnel) { unit.profile.funnel = unit.mem.rockFunnel; unit.mem.rockFunnel = null; }
      battle.removeBuff(unit, 'rockr:overload');
    };
    return {
      skill: {
        kind: 'duration', mods: { aspd: num(bb.attack_speed) },
        onStart({ battle, unit, skill }) {
          unit.mem.rockOverAt = battle.time + skill.duration / 2;
          unit.mem.rockOver = false;
          unit.mem.rockLock = null;
        },
        onTick({ battle, unit }) {
          if (unit.mem.rockOver || battle.time + 1e-9 < unit.mem.rockOverAt) return;
          unit.mem.rockOver = true;
          const f = unit.profile.funnel;
          if (f) { unit.mem.rockFunnel = f; unit.profile.funnel = { ...f, max: f.max * num(bb.scale, 1) }; }
          battle.addBuff(unit, { key: 'rockr:overload', mods: { atkPct: num(bb.atk) }, visible: true, tags: ['skill'] });
          battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit, reason }) {
          const over = unit.mem.rockOver ? battle.time - unit.mem.rockOverAt : 0;
          endOverload(battle, unit);
          unit.mem.rockOver = false;
          unit.mem.rockLock = null;
          if (over > 0 && reason !== 'death' && unit.alive) battle.applyStatus(unit, 'stun', { duration: over, source: unit });
        },
      },
      skills: { 'skcom_magic_rage[3]': { kind: 'duration', mods: { aspd: num(bb.attack_speed) } } },
      talents: [{ install(battle, unit) {
        if (s2) battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const L = unit.mem.rockLock;
          if (L && L.alive && bodyInKeys(L, unit.rangeKeySet) && canTargetEnemy(unit, L, ctx.profile || unit.profile)) ctx.targets = [L];
          else unit.mem.rockLock = ctx.targets[0] ?? null;
        }, { owner: unit });
        const iv = num(t.interval), max = Math.floor(num(t.max_stack_cnt)), v = num(t.atk);
        if (!(iv > 0) || !(max > 0) || !v) return;
        battle.on('tick', () => {
          if (!up(unit)) return;
          const n = Math.min(max, Math.floor((battle.time - unit.deployedAt + 1e-9) / iv));
          const cur = unit.findBuff('rockr:rock');
          if ((cur ? cur.stacks : 0) === n) return;
          if (n > 0) battle.addBuff(unit, { key: 'rockr:rock', mods: { atkPct: v }, stacks: n, maxStacks: max, tags: ['talent'] });
          else battle.removeBuff(unit, 'rockr:rock');
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_11 风丸 纸艺·双影: lose hp_ratio of current HP, ATK +atk, summon the <替身> (overrideTokenKey) on a free melee tile
  // around her for the skill's duration [ASSUMED lifetime]. 折纸生花: whenever a <替身> appears (the summon, and the
  // dollkeeper substitution) enemies on the 8 surrounding tiles take damage_scale × its ATK arts — air units too [ASSUMED:
  // no 对空 note on PRTS; the <替身> itself "可对空"].
  // Trait substitution: she fights with the <替身>'s stats (the engine already swaps in its HP; the kit swaps ATK/DEF
  // with flat deltas so %-buffs still apply). Elite module (PUM-X, trait atk): while substituted, ATK +atk.
  // S1 纸艺·迅击 (alt, attack SP): the next attack hits at atk_scale × ATK and she loses hp_ratio of her MAX HP (PRTS:
  // ten casts knock her out — the loss can be fatal and so sets off the <替身> substitution).
  chess_char_2_11_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const tokId = chess?.skill?.overrideTokenKey ?? (chess?.tokens ?? []).find((x) => /shadow|doll/.test(String(x))) ?? 'token_10022_kazema_shadow';
    const ds = num(t.damage_scale);
    const origami = (battle, src, atk) => {
      battle.fx('aoe', { x: src.x, y: src.y, radius: 1.5, id: src.id, skill: 'origami' });
      if (!(ds > 0)) return;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.s.flags.untargetable || cheb(src, e) > 1) continue;
        battle.dealDamage(src, e, { amount: atk * ds, type: 'arts', isSkill: true, canDodge: false, tags: ['talent'] });
      }
    };
    return {
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) {
          const loss = unit.hp * num(bb.hp_ratio);
          if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit });
          const tile = freeTileAround(battle, unit, (r, c) => battle.grid.canStand(r, c));
          if (!tile) return;
          const doll = battle.spawnToken(unit, tokId, tile[0], tile[1], {});
          if (!doll) return;
          unit.mem.doll = doll;
          battle.fx('summon', { x: doll.x, y: doll.y, id: doll.id, token: tokId });
          origami(battle, doll, doll.s.atk);
        },
        onEnd({ battle, unit }) {
          const d = unit.mem.doll;
          if (d && d.alive) battle.retreat(d, { reason: 'expired', permanent: true });
          unit.mem.doll = null;
        },
      },
      skills: {
        skchr_kazema_1: {
          kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) },
          onAttack({ battle, unit }) {
            const loss = unit.s.maxHp * num(bb.hp_ratio);
            if (loss > 0 && unit.alive) battle.loseHp(unit, loss, { source: unit, tags: ['skill'] });
          },
        },
      },
      talents: [{ install(battle, unit) {
        const bonus = num(tb.atk);
        battle.on('tick', () => {
          const sub = up(unit) && !!unit.findBuff('trait:substitute');
          if (sub && !unit.mem.kzSub) {
            unit.mem.kzSub = true;
            const ts = battle.tokenDef(tokId, unit)?.stats ?? null; // the owner's module variant (DESIGN §16)
            const mods = {};
            if (num(ts?.atk) > 0) mods.atkFlat = num(ts.atk) - unit.base.atk;
            if (ts && Number.isFinite(ts.def)) mods.defFlat = ts.def - unit.base.def;
            if (bonus > 0) mods.atkPct = bonus;
            battle.addBuff(unit, { key: 'kazema:doll', mods, tags: ['trait'] });
            origami(battle, unit, unit.s.atk);
          } else if (!sub && unit.mem.kzSub) {
            unit.mem.kzSub = false;
            battle.removeBuff(unit, 'kazema:doll');
          }
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_12 砾 鼠群 (passive): at each deployment a barrier of hp_ratio × max HP that decays to 0 over `duration` s
  // (capacity stepped once per second; a damaged barrier shrinks in proportion — PRTS).
  // 快速部署: own deployment cost +cost (−1). Elite 小个子支援: every unit whose initial deployment cost ≤ cond.cost
  // DEF +def while 砾 is on the field. (Elite module withdraw refund: no manual retreat in battle ⇒ no effect.)
  // S1 影袭 (alt, passive): at each deployment DEF +def, decaying linearly to 0 over `duration` s, updated once per
  // second (PRTS: "防御力加成每秒更新一次").
  chess_char_2_12_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    return {
      skill: {
        kind: 'duration', activateOnDeploy: true, duration: num(bb.duration, 10), spCost: 0, spType: 'none', trigger: 'NEVER',
        onStart({ battle, unit }) {
          const total = unit.s.maxHp * num(bb.hp_ratio);
          const dur = num(bb.duration, 10);
          if (!(total > 0) || !(dur > 0)) return;
          let k = 0;
          battle.addBuff(unit, {
            key: 'gravel:rats', shield: total, duration: dur, interval: 1, visible: true, tags: ['skill'],
            // PRTS: "屏障最大容量每秒更新一次；受到伤害后，剩余容量根据屏障最大容量等比变化" — the capacity steps down
            // once per second and what is left of the barrier scales with it (never a plain cap)
            onTick: ({ unit: u, buff }) => {
              const prev = Math.max(0, dur - k) / dur;
              k++;
              const next = Math.max(0, dur - k) / dur;
              if (prev > 0 && buff.shield > 0) { buff.shield *= next / prev; u.markDirty(); }
            },
          });
          battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'gravel:rats'); },
      },
      skills: {
        skchr_gravel_1: {
          kind: 'duration', activateOnDeploy: true, duration: num(bb.duration), spCost: 0, spType: 'none', trigger: 'NEVER',
          onStart({ battle, unit }) {
            const v = num(bb.def), dur = num(bb.duration);
            if (!(v > 0) || !(dur > 0)) return;
            let k = 0;
            battle.addBuff(unit, {
              key: 'gravel:shadow', duration: dur, mods: { defPct: v }, interval: 1, visible: true, tags: ['skill'],
              onTick: ({ unit: u, buff }) => {
                k++;
                buff.mods = { defPct: v * Math.max(0, dur - k) / dur };
                u.markDirty();
              },
            });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'def' });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'gravel:shadow'); },
        },
      },
      talents: [{ install(battle, unit) {
        const c = num(t.cost);
        if (c) unit.base.cost = Math.max(0, unit.base.cost + c);
        const d = num(t.def), lim = t['cond.cost'];
        if (d && lim != null) installAura(battle, unit, { key: 'talent:gravel', value: d, select: (a) => num(a.def?.stats?.cost, Infinity) <= num(lim), mods: { defPct: d } });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_13 蒂比 紧急赶场通知 (AUTO): "受到攻击后触发" is officially "受到伤害前触发" (PRTS 修正 原因 6; 备注 "在受到伤害前自动
  // 触发技能…若本次伤害为物理或法术，再将本次伤害闪避") — any incoming damage instance (an attack, a zone tick, the 源石溶剂
  // drain; never a 流失, which has no `hit`) sets it off (the kit is the only trigger: the engine rule is disabled) and a
  // physical/arts one is dodged; takes off for the duration: skill range, ATK +atk, attacks become 3 shots, blocks flying
  // (not ground) enemies. Trait "起飞后能够阻挡2个飞行敌人": flying enemies are blocked only while airborne. 片场工作指南
  // ("若最近N秒内未受伤害" — 修正 原文 攻击): if no damage for stack_time s, the next physical/arts damage is dodged (prob);
  // every damage instance restarts that timer (dodged or not; a 流失 does not — PRTS 备注).
  // S1 专业喷绘技巧 (alt, DEFAULT trigger from data): takes off at once for its duration — skill range, ATK +atk, blocks
  // flyers only; no triple shot, and incoming attacks never set it off.
  // Both take off as 起飞 (LIFTOFF_FLAGS): she blocks no ground enemy and none selects her (对地规避), so a ground enemy's
  // selected damage refused on the way never reaches her `hit` and neither sets off S2 nor restarts 片场工作指南.
  chess_char_2_13_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const s2 = onDefaultSkill(chess);
    return {
      trait: { blockFly: false },
      skill: {
        kind: 'duration', trigger: { rule: 'CUSTOM_RANGE', grid: [] }, // never by the engine: the hit handler below
        mods: { atkPct: num(bb.atk) }, flags: LIFTOFF_FLAGS,
        targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
        attack: { hits: 3 },
        onStart: tippiTakeOff,
        onEnd: tippiLand,
      },
      skills: {
        skchr_tippi_1: {
          kind: 'duration', mods: { atkPct: num(bb.atk) }, flags: LIFTOFF_FLAGS,
          targeting: { rangeGrid: def?.skill?.rangeGrid ?? null },
          onStart: tippiTakeOff,
          onEnd: tippiLand,
        },
      },
      talents: [{ install(battle, unit) {
        battle.removeBuff(unit, 'trait:skywalker'); // the profession grants blockFly permanently; here only airborne
        const st = num(t.stack_time), p = num(t.prob, 1);
        let last = -Infinity;
        battle.on('deploy', ({ unit: u }) => { if (u === unit) last = battle.time - st; }, { owner: unit });
        onHitOn(battle, unit, (ctx) => {
          const { dmg } = ctx;
          if (!dmg || dmg.cancel || !up(unit)) return;
          const dodgeable = dmg.type === 'phys' || dmg.type === 'arts';
          const sk = unit.skill;
          let dodged = false;
          if (s2 && sk && sk.ready && !sk.active && unit.canAct && !unit.s.flags.silence && sk.activate('TAKE_DAMAGE')) dodged = dodgeable;
          else if (dodgeable && st > 0 && battle.time - last + 1e-9 >= st && battle.rng.chance(p)) dodged = true;
          last = battle.time;
          if (dodged) { dmg.cancel = true; battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id }); }
        }, 5);
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_14 调香师 精调: ASPD +attack_speed (−50), ATK +atk. 熏衣草: every ally on the field recovers
  // atk_to_hp_recovery_ratio × ATK HP per second. Elite module (RIN-Y, hidden attack@max_target): heals 4 allies.
  // S1 治疗强化·β型 (alt): ATK +atk for its duration.
  chess_char_2_14_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const cnt = Math.floor(num(moduleBb(chess)['attack@max_target']));
    return {
      trait: cnt > 0 ? { heal: { mode: 'multi', count: cnt } } : undefined,
      skill: { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } },
      skills: { 'skcom_heal_up[2]': { kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } } },
      talents: [{ install(battle, unit) {
        const r = num(t.atk_to_hp_recovery_ratio);
        if (!(r > 0)) return;
        battle.every(1, () => {
          if (!up(unit)) return;
          const amt = unit.s.atk * r;
          for (const a of battle.alliesFor(unit)) if (a.hp < a.s.maxHp) battle.heal(unit, a, amt, { aura: true, tags: ['talent'] });
        }, { owner: unit });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_15 协律 (hidden) 震爆调谐: ATK +atk; each attack sets off a sonic boom at every other operator in range:
  // attack@aoe_atk_scale × ATK arts within attack@range_radius. 律脉同构: ATK +atk with another operator in range.
  // Elite module (BLA-X): damage grows with distance, up to +damage_scale at max_dist tiles.
  chess_char_2_15_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const rad = num(bb['attack@range_radius'], 0.9), sc = num(bb['attack@aoe_atk_scale']);
    return {
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        onAttack({ battle, unit }) {
          if (!(sc > 0)) return;
          for (const a of alliesInGridOf(battle, unit)) {
            if (a === unit || a.kind !== 'op') continue;
            battle.fx('sonic', { x: a.x, y: a.y, radius: rad, id: unit.id });
            for (const e of battle.foesInRadius(a.x, a.y, rad)) {
              if (!e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'arts', isSkill: true, isSplash: true, tags: ['sonic'] });
            }
          }
        },
      },
      talents: [{ install(battle, unit) {
        const v = num(t.atk);
        if (v) toggleBuff(battle, unit, 'akkord:sync', () => alliesInGridOf(battle, unit).some((a) => a !== unit && a.kind === 'op'), { atkPct: v });
        if (tb.damage_scale != null) {
          const mn = num(tb.min_dist), mx = num(tb.max_dist, 4), ds = num(tb.damage_scale);
          onHitBy(battle, unit, ({ target, dmg }) => {
            if (!dmg.isAttack) return;
            const d = Math.hypot(target.x - unit.x, target.y - unit.y);
            dmg.amount *= 1 + ds * (mx > mn ? Math.max(0, Math.min(1, (d - mn) / (mx - mn))) : 1);
          });
        }
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_16 拉普兰德 狼魂 (AUTO, attack SP): ATK +atk, arts damage, one extra target, ranged attacks no longer reduced.
  // 精神摧毁: attacks disable the target's abilities (silence) for `duration` s. Elite module (LOR-X, trait
  // atk_scale_m): attacks add atk_scale_m × ATK arts damage.
  // S1 日晷 (alt, attack SP, 持续时间无限 ⇒ toggle until she falls): ATK +atk and a `prob` chance to block (抵挡: the
  // damage instance is negated) each physical damage an enemy deals her.
  chess_char_2_16_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    const trait = {};
    if (num(t.duration) > 0) trait.onHitStatus = { key: 'silence', duration: num(t.duration) };
    if (num(tb.atk_scale_m) > 0) {
      trait.afterHit = (battle, u, target) => {
        // PRTS 特性备注 "造成预计算的法术附加伤害": 附加伤害 (tag addition — no 叙拉古 6 roll)
        if (target && target.alive && target.side === 'enemy') battle.dealDamage(u, target, { amount: u.s.atk * num(tb.atk_scale_m), type: 'arts', tags: ['module', 'addition'] });
      };
    }
    return {
      trait,
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, targeting: { maxTargets: 2 }, attack: { dmgType: 'arts', dmgMul: () => 1 } },
      skills: {
        skchr_whitew_1: {
          kind: 'toggle', mods: { atkPct: num(bb.atk) },
          onStart({ battle, unit, skill }) {
            if (unit.mem.sundial) battle.off(unit.mem.sundial);
            const p = num(bb.prob);
            unit.mem.sundial = p > 0 ? onHitOn(battle, unit, ({ source, credit, dmg }) => { // 抵挡 is target-side: a 无来源 burst counts via its credit
              const src = source || credit;
              if (!skill.active || dmg.cancel || dmg.type !== 'phys' || !src || src.side !== 'enemy') return;
              if (battle.rng.chance(p)) { dmg.cancel = true; battle.fx('block', { x: unit.x, y: unit.y, id: unit.id }); }
            }, 5) : null;
          },
          onEnd({ battle, unit }) {
            if (unit.mem.sundial) battle.off(unit.mem.sundial);
            unit.mem.sundial = null;
          },
        },
      },
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_17 折桠 生存决心: on start, ground enemies around her (skill grid) 战栗 (tremble: "被阻挡后无法进行普通攻击") for
  // not_combat s; ATK +atk, DEF +def, hits every blocked enemy. 简易包扎: heals hp_ratio × max HP when the skill ends.
  // Elite module (UNY-X, trait damage_scale): damage from enemies she blocks ×damage_scale.
  // S1 绝境抵抗 (alt, TAKE_DAMAGE / hurt SP from data): DEF +def and 抵抗 (−one_minus_status_resistance: control
  // statuses last half as long) for its duration; 简易包扎 heals at its end too.
  chess_char_2_17_a: (bb, chess, def) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk), defPct: num(bb.def) }, attack: { hitAllBlocked: true },
        onStart({ battle, unit }) {
          const grid = def?.skill?.rangeGrid;
          const foes = grid ? enemiesInGrid(battle, unit, grid, { canHitFly: false, groundOnly: true }) : battle.foesInRadius(unit.x, unit.y, 1.5).filter((e) => !e.isFlying);
          battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'resolve' });
          for (const e of foes) battle.applyStatus(e, 'tremble', { duration: num(bb.not_combat), source: unit });
        },
      },
      skills: {
        skchr_branch_1: {
          kind: 'duration', mods: { defPct: num(bb.def) },
          onStart({ battle, unit, skill }) {
            const v = Math.min(0.95, Math.max(0, -num(bb.one_minus_status_resistance)));
            if (v > 0) battle.applyStatus(unit, 'resist', { duration: skill.timeLeft, value: v, source: unit });
          },
        },
      },
      talents: [{ install(battle, unit) {
        const hr = num(t.hp_ratio);
        if (hr > 0) {
          battle.on('skillEnd', ({ unit: u, reason }) => {
            if (u === unit && reason !== 'death' && unit.alive) battle.heal(unit, unit, unit.s.maxHp * hr, { self: true, tags: ['talent'] });
          }, { owner: unit });
        }
        if (tb.damage_scale != null) onHitOn(battle, unit, ({ source, dmg }) => { if (source && source.blockedBy === unit) dmg.mul *= num(tb.damage_scale, 1); });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_18 灰毫 攻击力强化·γ型 (DEFAULT, like S2: the owner's deliberate deviation from the 重装 TAKE_DAMAGE row, data
  // TRIGGER_DEVIATIONS, DESIGN §21.29): ATK +atk. 炮术研习: ATK +atk, or +ashlok_t_1.atk when the `cnt` orthogonal
  // tiles around her are all ground (LOW). Elite module (FOR-X, trait atk_scale): vs blocked enemies ATK ×atk_scale.
  // S2 专注轰击 (alt): block count 0 (noBlock: releases what she holds), only ranged (splash) attacks, base attack time
  // +base_attack_time s (−0.4 / −0.5 on 2.8), ATK +atk.
  chess_char_2_18_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const tb = traitBb(chess);
    return {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) } },
      skills: {
        skchr_ashlok_2: {
          kind: 'duration', mods: { atkPct: num(bb.atk), batPct: batMod(bb.base_attack_time, chess) }, flags: { noBlock: true },
          attack: { fortress: false, _fortressMelee: false },
        },
      },
      talents: [{ install(battle, unit) {
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          const r = unit.tileR, c = unit.tileC;
          const low = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => battle.grid.isLow(r + dr, c + dc)).length;
          const ground = low >= num(t.cnt, 4);
          const v = ground ? num(t['ashlok_t_1.atk'], num(t.atk)) : num(t.atk);
          if (v) battle.addBuff(unit, { key: 'talent:ashlok', mods: { atkPct: v }, data: { ground }, tags: ['talent'] });
        }, { owner: unit });
        if (num(tb.atk_scale, 1) !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && target.blockedBy) dmg.amount *= num(tb.atk_scale, 1); });
      } }],
    };
  },

  // ---------------------------------------------------------------------------------------------------------------
  // 2_19 锡人 “大拉里”: see tinmanKit (tier1.js).
  // S1 “老科利” (alt, attack SP, needs a target): throws an alchemy unit at the target (ground first); for
  // projectile_delay_time s ground enemies within projectile_range tiles are 虚弱 (weaken −atk) and take atk_scale ×
  // ATK arts per second (ATK cached at the cast; damage over time, so the elite 凋敝魂灵 ×skill@damage_scale applies;
  // the zone counts for the module's SP bonus and outlives her).
  chess_char_2_19_a: (bb, chess, def) => {
    const k = tinmanKit(bb, chess, def);
    const dur = num(bb.projectile_delay_time, 8), radius = num(bb.projectile_range, 1), dmgScale = num(bb.atk_scale);
    const weak = Math.min(1, Math.max(0, -num(bb.atk)));
    const wither = num(talentBb(chess, 1)['skill@damage_scale'], 1);
    const STEP = 0.25; // weaken refresh cadence (damage every 1 s)
    return {
      ...k,
      skills: {
        ...(k.skills || {}),
        skchr_tinman_1: {
          kind: instantKind(def),
          onStart({ battle, unit }) {
            const tgt = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0] ?? enemiesInGrid(battle, unit, null, { n: 1 })[0];
            const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
            const atk = unit.s.atk;
            const n = Math.max(1, Math.round(dur / STEP)), per = Math.max(1, Math.round(1 / STEP));
            let i = 0;
            unit.mem.tinZones = (unit.mem.tinZones ?? 0) + 1;
            battle.fx('zone', { x, y, radius, dur, id: unit.id, skill: 'tinman1' });
            battle.every(STEP, (b, sc) => {
              const pulse = i % per === 0;
              for (const e of b.foesInRadius(x, y, radius)) {
                if (e.isFlying || e.s.flags.untargetable) continue;
                if (weak > 0) b.applyStatus(e, 'weaken', { duration: STEP + 0.05, value: weak, source: unit });
                if (wither > 1) b.addBuff(e, { key: 'tinman:wither', duration: STEP + 0.05, data: { mul: wither }, source: unit });
                if (pulse && dmgScale > 0) b.dealDamage(unit, e, { amount: atk * dmgScale, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone'] });
              }
              if (++i >= n) { sc.cancel(); unit.mem.tinZones = Math.max(0, (unit.mem.tinZones ?? 1) - 1); }
            }, { immediate: true });
          },
        },
      },
    };
  },
};
