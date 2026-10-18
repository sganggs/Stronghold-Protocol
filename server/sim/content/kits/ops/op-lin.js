// server/sim/content/kits/ops/op-lin.js — 林 (char_4080_lin) 自选 operator kit: 6★ 阵法术师 (术师), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4080_lin, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 林 (计出万全 备注:
// "通常情况下琉璃璧生效优先级为+1000", "琉璃璧破碎效果于满足条件的伤害应用前瞬间触发" — so a lethal hit still sets it off —,
// "其破碎时的影响范围以持有该效果的单位为中心，与林的当前攻击范围一致，先造成晕眩后造成伤害", "可造成琉璃璧破碎的伤害结算时，伤害量减少
// 相当于琉璃璧吸收伤害上限的数值"; 玲珑 备注 "非初始状态下…技能开启时的效果均会生效，但此状态下并不实际属于“技能期间”"; 荫庇 备注
// "每个干员单独获得琉璃壁，单独计算琉璃壁破碎与恢复时间", "伤害计算使用林的攻击力，伤害来源为林自身"; 流光乍裂 备注 "第一天赋生效的
// 优先级从+1000变为±0，琉璃璧破碎效果于满足条件的伤害应用后瞬间触发", "仅自身普通攻击造成击杀时可触发琉璃璧破碎/生成效果，单次普攻
// 最多触发1次效果"); PRTS 卫戍协议/帮助 §技能操作 ("携带状态切换类技能的干员…每次部署后仅开启一次技能"; 阵法术师 row "在初始攻击范围内
// 存在敌人时释放技能"; 林【流光乍裂】 x-2 "在自定义范围内存在敌人时释放技能"); PRTS 分支特性信息 阵法术师 ("攻击时可对空"); the client's
// battle data (charpack char_4080_lin, battle/prefabs [uc]skills skchr_lin_1/2/3, buff_template_data lin_t_1 / lin_t_1[damage]
// / lin_t_1_s_3 / lin_t_1_s_3[refresh] / lin_t_2 / lin_e_002[half_attribute] / lin_e_002_trait).
// - Trait (阵法术师) "通常时不攻击且防御力和法术抗性大幅度提升，技能开启时攻击造成群体法术伤害": the profession (professions.js
//   phalanx — DEF +def ×, RES +magic_resistance while no skill runs; while one runs, `rangeAoe`: every selectable enemy of
//   her range at once, air units too). Module PLX-X “七窍玲珑” overrides it with "更大幅度提升" (def 2.15 / magic_resistance
//   25, the profession's trait tunables) and "技能开启时保留部分效果" (lin_e_002[buff] def 1 / magic_resistance 10): DEF +100 %
//   and RES +10 while any skill runs — 玲珑's switched state too (PRTS: "技能开启时的效果均会生效"). Module PLX-Y “情与义”:
//   "范围内敌人越多造成的伤害越高（最高提升15%）" — the hidden module talent: +damage_scale (3 %) per enemy on her range, at most
//   max_valid_stack_cnt (5), on every damage she deals (the 琉璃璧 bursts too), counted like 卡涅利安's PLX-Y (every living
//   enemy standing on her current range).
// - T1 计出万全 (lin_t_1, HIGH_PRIORITY: ON_TAKE_DAMAGE → BlockDamage of a fixed `value`, a break when the damage left it
//   negative): a 琉璃璧 on her from every deployment — an HP shield of `value` (200) that every damage instance refills
//   (`absorbShields` absorbs it after DEF / RES and the damage multipliers): a hit of at most 200 is absorbed whole; a hit
//   over 200 ("单次超过200点伤害") goes through less 200 (PRTS: "伤害量减少相当于琉璃璧吸收伤害上限的数值") and breaks it — the
//   burst (lin_t_1[damage] on the targets of Lin's "Attack" selector, i.e. her CURRENT attack range, centred on the holder):
//   stun `stun` s on every enemy there, then atk_scale × Lin's ATK arts (source Lin) — and lin_t_1[disable] brings it back
//   `interval` s later (8 s; full potential: 110 %; PLX-Y stage 3: 120 %, 6 s). A 流失 or an element 损伤 never touches it.
//   [ASSUMED] the shield sits in the buff order (HIGH_PRIORITY puts it first; no other shield usually stands on her), and
//   the burst comes right after the hit has landed — before a knock-out, as PRTS's lethal-hit note says — in the 流光乍裂
//   order too (PRTS: "伤害应用后").
// - T2 韬光 "受到攻击时，有50%几率回复1点技力" (full potential: 55 %; PLX-X stage 3: 80 %, 2 SP): the client's lin_t_2
//   (ON_TAKE_DAMAGE → IsIgnoreForSp → Dice prob → ModifySp sp, no damage-value filter): one roll per damage instance she
//   takes that could give 受击回复 SP — a hit the 琉璃璧 absorbs whole included (it is still taken, at 0); not a 流失 or an
//   element 损伤. No SP while a skill runs (玲珑's state included: it stays on).
// - S1 玲珑 (MANUAL, data SEARCH, a 状态切换类 skill: switched on once per deployment and kept — the official rule, `toggle`):
//   attack interval +base_attack_time (+1.0 s on her 2.0 s), ATK +atk, every enemy each attack hits 停顿 attack@sluggish s.
//   PRTS's "并不实际属于技能期间" changes nothing here: the state is never switched back in the auto battle.
// - S2 荫庇 (MANUAL, data SEARCH, 25 s): ASPD +attack_speed, taunt +taunt_level (−1: "自身不容易受到敌人攻击"); every allied
//   unit on her range (the client's validator: ground allies — every ally of this mode but the 孤立 “炎佑”, which no ally
//   ability selects) gets its own lin_t_1 — the plain T1 (threshold `value`, Lin's ATK and source, its own break and
//   `interval` regrowth; independentCharacterSource, not on Lin herself) — while the skill runs (removed when the ability
//   detaches), checked every SHELTER_IV s; an ally that leaves the field loses it (its buffs go).
// - S3 流光乍裂 (MANUAL, data CUSTOM_RANGE on its x-2, 26 / 28 s): ATK +atk; range x-2 (the burst range follows: it is her
//   current range: lin_t_1_s_3_selector); her own 琉璃璧 threshold ×talent_scale (2 / 2.5) while it runs (lin_t_1_s_3);
//   each kill by her "Attack" ability (ON_TARGET_KILLED, one per attack) runs lin_t_1_s_3[refresh]: a standing 琉璃璧 bursts
//   and stays, a broken one comes back at once. The auto battle never switches it off early.

import { num, talentBb, moduleBb, traitBb, skillRec, up, giveSp, batMod } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { isHpLoss } from '../../../attack.js';

const S1 = 'skchr_lin_1';
const S2 = 'skchr_lin_2';
const S3 = 'skchr_lin_3';
/** The 琉璃璧 shield buff (one per holder: Lin's own, and the S2 copies on her allies). */
const GLASS_KEY = 'lin:glass';
/** PLX-X: the part of the trait kept while a skill runs. */
const KEEP_KEY = 'lin:plxKeep';
/** S2 荫庇: how often the allies on her range are checked for a 琉璃璧. */
const SHELTER_IV = 0.1;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const s3On = (lin) => !!(lin.skill && lin.skill.active && lin.skill.id === S3);

export default {
  char_4080_lin: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // PLX-Y: damage_scale per enemy, max_valid_stack_cnt
    const tb = traitBb(chess);        // PLX-X: lin_e_002[buff] def / magic_resistance
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const g3 = skillRec(chess, S3)?.rangeGrid ?? null;
    const glass = { value: num(t0.value, 200), atkScale: num(t0.atk_scale, 1), stun: num(t0.stun, 1), interval: num(t0.interval, 8) };
    const s3Scale = num(b3.talent_scale, 1);

    /** Threshold (= shield) of a holder's 琉璃璧: Lin's own ×talent_scale while 流光乍裂 runs, the plain value otherwise. */
    const thresholdOf = (lin, holder) => (holder === lin && s3On(lin) ? glass.value * s3Scale : glass.value);
    /** (Re)raise the 琉璃璧 of `holder`, full. `mods: {}` keeps the buff when an instance drains it exactly (absorbShields). */
    const raise = (battle, lin, holder) => {
      if (!holder.alive) return;
      const r = holder.mem.linGlassRegen;
      if (r) { r.cancel(); holder.mem.linGlassRegen = null; }
      battle.addBuff(holder, { key: GLASS_KEY, shield: thresholdOf(lin, holder), mods: {}, source: lin, tags: ['talent'] });
      battle.fx('shield', { x: holder.x, y: holder.y, id: holder.id, skill: 'lin:glass' });
    };
    /** The break: Lin's current attack range centred on the holder — stun first, then the damage (PRTS 备注). */
    const burst = (battle, lin, holder) => {
      const grid = lin.liveRangeGrid || lin.rangeGrid || [[0, 0]];
      const keys = absoluteRangeKeys(grid, holder.tileR, holder.tileC, lin.dir, 0);
      const victims = battle.enemiesInKeys(keys, lin, { canHitFly: true });
      if (glass.stun > 0) for (const e of victims) battle.applyStatus(e, 'stun', { duration: glass.stun, source: lin });
      for (const e of victims) {
        if (e.alive && glass.atkScale > 0) battle.dealDamage(lin, e, { amount: lin.s.atk * glass.atkScale, type: 'arts', tags: ['talent', 'lin:glass'] });
      }
      battle.fx('aoe', { x: holder.x, y: holder.y, radius: 1.5, id: lin.id, skill: 'lin:glass' });
    };
    /** Break `holder`'s 琉璃璧; it grows back `interval` s later (an S2 copy only while 荫庇 still covers it), or at once. */
    const shatter = (battle, lin, holder, now = false) => {
      battle.removeBuff(holder, GLASS_KEY);
      burst(battle, lin, holder);
      if (now) { raise(battle, lin, holder); return; }
      const seq = holder.deploySeq;
      holder.mem.linGlassRegen = battle.after(glass.interval, () => {
        holder.mem.linGlassRegen = null;
        if (!holder.alive || holder.deploySeq !== seq || holder.findBuff(GLASS_KEY)) return;
        if (holder !== lin && !lin.mem.shelter?.has(holder.id)) return;
        raise(battle, lin, holder);
      }, { owner: lin });
    };
    /** Drop an S2 copy (the ally left her range, or 荫庇 ended). */
    const dropCopy = (battle, holder) => {
      const g = holder.findBuff(GLASS_KEY);
      if (g) battle.removeBuff(holder, g);
      const r = holder.mem.linGlassRegen;
      if (r) { r.cancel(); holder.mem.linGlassRegen = null; }
    };
    /** S2: the allied units (not Lin, not devices) on her range get / keep / lose their 琉璃璧. */
    const shelterTick = (battle, lin) => {
      const st = lin.mem.shelter;
      if (!st || !lin.rangeKeySet) return;
      const now = new Set();
      for (const a of battle.alliesFor(lin)) {
        if (a === lin || a.kind === 'device' || !lin.rangeKeySet.has(a.tileR * COLS + a.tileC)) continue;
        now.add(a.id);
        if (!st.has(a.id)) { st.add(a.id); raise(battle, lin, a); }
      }
      for (const id of [...st]) {
        if (now.has(id)) continue;
        st.delete(id);
        const a = battle.unitById(id);
        if (a) dropCopy(battle, a);
      }
    };
    const endShelter = (battle, lin) => {
      const st = lin.mem.shelter;
      lin.mem.shelter = null;
      for (const id of st || []) { const a = battle.unitById(id); if (a) dropCopy(battle, a); }
    };

    return {
      skills: {
        [S1]: {
          kind: 'toggle',
          mods: { atkPct: num(b1.atk), batPct: batMod(b1.base_attack_time, chess) },
          attack: { onHitStatus: { key: 'sluggish', duration: num(b1['attack@sluggish']) } },
        },
        [S2]: {
          kind: 'duration',
          mods: { aspd: num(b2.attack_speed), taunt: num(b2.taunt_level) },
          onStart({ battle, unit }) { unit.mem.shelter = new Set(); shelterTick(battle, unit); },
          onTick({ battle, unit, dt }) {
            unit.mem.shelterAcc = (unit.mem.shelterAcc ?? 0) + dt;
            if (unit.mem.shelterAcc + 1e-9 < SHELTER_IV) return;
            unit.mem.shelterAcc = 0;
            shelterTick(battle, unit);
          },
          onEnd({ battle, unit }) { unit.mem.shelterAcc = 0; endShelter(battle, unit); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: g3 ? { rangeGrid: g3 } : undefined,
          onStart({ battle, unit }) { // the threshold ×talent_scale: a standing 琉璃璧 grows to it
            const g = unit.findBuff(GLASS_KEY);
            if (g) { g.shield = thresholdOf(unit, unit); unit.markDirty(); }
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'lin:s3' });
          },
          onAttack({ battle, unit, targets }) { // a knock-out by this attack: break and raise again, once per attack
            if (!(targets || []).some((t) => t && t.side === 'enemy' && !t.alive)) return;
            if (unit.findBuff(GLASS_KEY)) shatter(battle, unit, unit, true);
            else raise(battle, unit, unit);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 计出万全: her 琉璃璧 (and the S2 copies — the same hook: any holder of one she gave)
          battle.on('deploy', (c) => { if (c.unit === unit) raise(battle, unit, unit); }, { owner: unit });
          battle.on('damaged', (c) => {
            const h = c.target;
            const g = h && h.findBuff(GLASS_KEY);
            if (!g || g.source !== unit || c.type === 'element' || isHpLoss(c.dmg)) return;
            if (g.shield > 1e-9 || !(c.amount > 0)) { // absorbed whole: full again for the next instance
              g.shield = thresholdOf(unit, h);
              h.markDirty();
              return;
            }
            if (h === unit || unit.alive) shatter(battle, unit, h);
          }, { owner: unit, priority: 50 });
          battle.on('skillEnd', (c) => { // 流光乍裂 over: a standing 琉璃璧 shrinks to the plain threshold
            if (c.unit !== unit || c.skill.id !== S3) return;
            const g = unit.findBuff(GLASS_KEY);
            if (g) { g.shield = thresholdOf(unit, unit); unit.markDirty(); }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 韬光: prob to +sp SP per damage instance taken (absorbed or not) that could give 受击回复 SP
          const p = num(t1.prob), sp = num(t1.sp);
          if (!(p > 0 && sp > 0)) return;
          battle.on('damaged', (c) => {
            if (c.target !== unit || !c.dmg || c.dmg.noSp || c.type === 'element' || isHpLoss(c.dmg) || !up(unit)) return;
            if (battle.rng.chance(p)) giveSp(unit, sp);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // PLX-X “七窍玲珑”: 技能开启时保留部分效果 (any skill; 玲珑's switched state included)
        const keepDef = num(tb['lin_e_002[buff].def']), keepRes = num(tb['lin_e_002[buff].magic_resistance']);
        if (keepDef || keepRes) {
          battle.on('skillStart', (c) => { if (c.unit === unit) battle.addBuff(unit, { key: KEEP_KEY, mods: { defPct: keepDef, resFlat: keepRes }, tags: ['module'] }); }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit) battle.removeBuff(unit, KEEP_KEY); }, { owner: unit });
        }
        // PLX-Y “情与义”: +damage_scale per enemy on her range (≤ max_valid_stack_cnt), every damage she deals
        const per = num(hidden.damage_scale), cap = Math.max(0, Math.floor(num(hidden.max_valid_stack_cnt, 5)));
        if (per > 0 && cap > 0) {
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.target || c.target.side !== 'enemy' || c.dmg.type === 'element' || !unit.rangeKeySet) return;
            let n = 0;
            for (const e of battle.enemies) if (e.alive && !e.hidden && bodyInRange(e, unit.rangeKeySet) && ++n >= cap) break;
            if (n > 0) c.dmg.mul *= 1 + per * n;
          }, { owner: unit });
        }
      },
    };
  },
};
