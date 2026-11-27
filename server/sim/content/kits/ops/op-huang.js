// server/sim/content/kits/ops/op-huang.js — 煌 (char_017_huang) 自选 operator kit: 6★ 强攻手 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_017_huang, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 煌 (talent and
// skill 备注, the CEN-X note); the client's buff templates (buff_template_data `huang_s_3`, `huang_t_1[heal]` / `[lock]`,
// `huang_e_003[lock]` / `[heal]`, `huang_t_2…`); Arknights Terra Wiki "Blaze" (the S3 notes).
// - Trait (强攻手) "同时攻击阻挡的所有敌人": the profession default (centurion `hitAllBlocked`, block 3). Module CEN-X
//   "攻击被阻挡的敌人攻击力提升至110%" (trait bb atk_scale): PRTS "于每次计算伤害时检查目标是否处于阻挡/被阻挡状态…提升效果
//   为攻击力倍率提升" — every damage instance of hers whose target is blocked (by anyone) takes ×atk_scale on its ATK-based
//   amount (before DEF): normal attacks, S1, the S3 cuts and burst. Module CEN-Y "生命值高于50%时受到的物理伤害降低20%"
//   (trait bb hp_ratio / damage_resistance): physical damage taken × (1 − damage_resistance) while HP > hp_ratio.
// - T1 紧急除颤 "在生命值低于25%时，仅一次回复50%的生命值并在6秒内使生命值不低于50%" (full potential: 7 s; bb hp_ratio,
//   huang_t_1[heal].hp_ratio, huang_t_1[lock].min_hp_ratio / .duration). PRTS 备注: every deployment she holds 不死 until
//   the first time her HP ratio is ≤ hp_ratio; then the heal (max HP × [heal].hp_ratio, a heal — huang_t_1[heal]
//   HealViaMaxHpRatio) and for [lock].duration s every damage that would take her below [lock].min_hp_ratio × max HP is
//   cut to what is left above it ("该伤害减少(伤害值-煌当前生命值+煌最大生命值×50%)点": the `hpDamage` hook after the
//   shields — a 伤判效果, so a 流失 such as her S3's is not held). CEN-Y stage 3 (talent hp_ratio 0.5 + the hidden
//   huang_e_003[lock] part): "在生命值首次低于25%、50%时…8秒内…" (full potential: 9 s): the talent fires at 50 %, and a second trigger at
//   check_hp_ratio (25 %) with its own 不死 (huang_e_003[undead]) fires only once the first is spent ("生命值首次低于50%
//   始终先于…25%生效"), re-checking the HP after the first one's heal [ASSUMED: both read the current HP]; its heal is
//   skipped while the first lock runs (huang_e_003[heal] "CheckContainsBuff huang_t_1[lock] → IfNot → heal"). The hidden
//   part's hp_ratio / def_penetrate_fixed (CEN-Y stage 2+): "生命值高于50%时攻击无视目标150点防御力" — a defIgnoreFlat
//   buff while HP > hp_ratio (every damage of hers).
// - T2 严酷训练 "在战场停留15秒后获得抵抗" (full potential: 12 s; bb one_minus_status_resistance, interval): `interval` s after each deployment
//   the engine 抵抗 (huang_t_2 creates status_resistance[inf]: control statuses last half as long) until she leaves.
//   CEN-X stage 3 adds "30秒后攻击力+6%，45秒后攻速+12" (huang_t_2[e_002_atk].atk / .interval, [e_002_atk_speed]
//   .attack_speed / .interval: an ATK MULTIPLIER and an ATTACK_SPEED ADDITION, INFINITY lifetime).
// - S1 强力击·γ型 (AUTO, attack SP): the next attack at atk_scale × ATK — every blocked enemy it hits (her trait); the
//   data's DEFAULT trigger (an AUTO "next attack" waits for her attack).
// - S2 链锯延伸模块 (AUTO, 持续时间无限): ATK +atk, DEF +def and the skill range 2-2 for the rest of the deployment (PRTS 备注
//   "攻击距离加长…使用技能提供的攻击范围（非攻击距离+1）"); an AUTO skill acting on herself only fires as soon as its SP is
//   full (the owner's AUTO rule, kits/README.md checklist 5).
// - S3 沸腾爆裂 (MANUAL, data DEFAULT): a 维持技能状态 (PRTS 游戏数据基础: no normal attack while it runs; its cadence
//   follows the animation — no attack speed change touches it — and a hard control (晕眩 / 冻结 …) ends it early).
//   PRTS 备注 + huang_s_3: every second for the first 8 s the ATK / DEF bonus is updated, then one physical cut hits every
//   ground enemy of her attack range ("对前方一格内的敌方单位进行切割" — her own 1-1 and the enemies she blocks; 不可对空;
//   100 % ATK [ASSUMED: no blackboard key — her attack's own damage]); the bonus is atk / def × min(1, t ÷ (duration −
//   1.05)) at the t-th update (huang_s_3 RemainingRatioToAttributeModifier `_endTime` 1.05: full at 8.95 s; the Terra
//   Wiki's "reaches maximum after 8.95 seconds"); at 9 s it reaches the maximum and the finish follows (PRTS "9s时…";
//   Terra "triggered at the 9 seconds mark"; her skeleton, whose Skill_2_* clips are S3's: the 3 s Skill_2_Loop_End's
//   last OnAttack falls at 9 s of the 10 s run — Begin 1.4 s + the 0.4 s loops to 7 s): the huang_s_3 ON_SKILL_FINISH part, she loses hp_ratio ×
//   MAX HP (DamageViaMaxHpRatio, undeadable — never below 1 HP; PRTS calls it 流失) and then every enemy of the 3 × 3
//   area ahead (PRTS "前方3×3区域 3-6…碰撞判定，可对空": air units too) takes damage_by_atk_scale × her ATK at that
//   moment, physical; the state runs on to its 10 s. A run cut short by a hard control finishes at once
//   [ASSUMED: ON_SKILL_FINISH fires on any end but her knock-out]. The range the game shows while it runs is the
//   burst's 3-6 (PRTS); the data has no skill range and the cuts use her own, so the card keeps her 1-1 and the trigger
//   stays DEFAULT.

import { num, talentBb, moduleBb, traitBb, up, onHitBy, onHitOn, toggleBuff, skillRec } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';

const S1 = 'skchr_huang_1';
const S2 = 'skchr_huang_2';
const S3 = 'skchr_huang_3';
/** S3's final area "前方3×3区域" (PRTS 备注 range 3-6; range_table): her tile, the two ahead and the rows beside them. */
const GRID_3_6 = Object.freeze([[1, 0], [1, 1], [1, 2], [0, 0], [0, 1], [0, 2], [-1, 0], [-1, 1], [-1, 2]]);
/** huang_s_3 RemainingRatioToAttributeModifier `_endTime`: the ramp is full this long before the run's nominal end. */
const S3_RAMP_END = 1.05;
/** S3 updates: eight cuts (1 s apart), then the finish at the ninth (PRTS "9s时"). */
const S3_CYCLES = 9;
const S3_BUFF = 'skill:huang:ramp';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

export default {
  char_017_huang: (bb, chess, def) => {
    const tb = traitBb(chess);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hb = moduleBb(chess);   // CEN-Y stage 2+: hp_ratio / def_penetrate_fixed; stage 3: huang_e_003[lock].*
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const ownGrid = chess?.rangeGrid ?? def?.rangeGrid ?? [[0, 0], [0, 1]];
    /** The ground enemies her own range holds and the ones she blocks (the S3 cuts). */
    const cutTargets = (battle, unit) => {
      const keys = absoluteRangeKeys(unit.rangeGrid || ownGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend || 0);
      const list = battle.enemiesInKeys(keys, unit, { canHitFly: false });
      for (const e of battle.blockedTargets(unit, { canHitFly: false })) if (!list.includes(e)) list.push(e);
      return list;
    };
    /** S3's finish (huang_s_3 ON_SKILL_FINISH): the 流失 first (undeadable), then the burst at her ATK of that moment. */
    const finish = (battle, unit, s) => {
      s.done = true;
      const loss = Math.min(unit.s.maxHp * num(b3.hp_ratio), unit.hp - 1);
      if (loss > 0) battle.loseHp(unit, loss, { source: unit });
      if (!up(unit)) return;
      const atk = unit.s.atk;
      const keys = absoluteRangeKeys(GRID_3_6, unit.tileR, unit.tileC, unit.dir, 0);
      battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'huang:burst' });
      for (const e of battle.enemiesInKeys(keys, unit, { canHitFly: true })) {
        if (e.alive) battle.dealDamage(unit, e, { amount: atk * num(b3.damage_by_atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
      }
    };
    const setRamp = (battle, unit, r) => {
      const b = unit.findBuff(S3_BUFF);
      if (!b) return;
      b.mods = { atkPct: num(b3.atk) * r, defPct: num(b3.def) * r };
      unit.markDirty();
    };
    return {
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1) } },
        [S2]: {
          kind: 'toggle', trigger: 'SP_FULL',
          mods: { atkPct: num(b2.atk), defPct: num(b2.def) },
          ...(s2?.rangeGrid?.length ? { targeting: { rangeGrid: s2.rangeGrid } } : {}),
          onStart({ battle, unit }) { battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'atk' }); },
        },
        [S3]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            unit.mem.huangS3 = { t: 0, k: 0 };
            battle.addBuff(unit, { key: S3_BUFF, mods: { atkPct: 0, defPct: 0 }, tags: ['skill'], visible: true });
          },
          onTick({ battle, unit, skill, dt }) {
            const s = unit.mem.huangS3;
            if (!s) return;
            // 维持技能状态: a hard control ends it early (PRTS 游戏数据基础 "眩晕、冻结等硬性控制会提前结束")
            if (!unit.canAct || unit.s.flags.sleep) { skill.end('interrupted'); return; }
            s.t += dt;
            while (s.k < S3_CYCLES && s.t >= s.k + 1 - 1e-9) { // loop-cap: constant cycle count and a one-second step
              s.k++;
              setRamp(battle, unit, Math.min(1, s.k / Math.max(1e-6, skill.duration - S3_RAMP_END)));
              if (s.k >= S3_CYCLES) { finish(battle, unit, s); return; }
              const foes = cutTargets(battle, unit);
              // cosmetic fx (round 86): `targets` names each enemy the cut hits, so the client plays the hit on them
              if (foes.length) battle.fx('aoe', { x: unit.x, y: unit.y, radius: 0.6, id: unit.id, skill: 'huang:cut', targets: foes.map((e) => e.id) });
              for (const e of foes) if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk, type: 'phys', isSkill: true, tags: ['skill'] });
            }
          },
          onEnd({ battle, unit, reason }) {
            const s = unit.mem.huangS3;
            unit.mem.huangS3 = null;
            if (s && !s.done && reason !== 'death' && up(unit)) finish(battle, unit, s);   // cut short: it finishes at once
            battle.removeBuff(unit, S3_BUFF);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 紧急除颤 (+ CEN-Y stage 3's second trigger and stage 2+'s 防御穿透)
          const trig = num(t0.hp_ratio, 0.25);
          const healA = num(t0['huang_t_1[heal].hp_ratio'], 0.5);
          const floorA = num(t0['huang_t_1[lock].min_hp_ratio'], 0.5), durA = num(t0['huang_t_1[lock].duration'], 6);
          const second = hb['huang_e_003[lock].check_hp_ratio'] != null;
          const trigB = num(hb['huang_e_003[lock].check_hp_ratio'], 0.25);
          const healB = num(hb['huang_e_003[lock].hp_ratio'], 0.5);
          const floorB = num(hb['huang_e_003[lock].min_hp_ratio'], 0.5), durB = num(hb['huang_e_003[lock].duration'], 8);
          const st = { undeadA: false, undeadB: false, lockA: -Infinity, lockB: -Infinity };
          unit.mem.huangDefib = st;
          battle.on('deploy', ({ unit: u }) => {
            if (u !== unit) return;
            st.undeadA = true;
            st.undeadB = second;
            st.lockA = st.lockB = -Infinity;
          }, { owner: unit });
          // 不死 while a trigger is unspent: a lethal hit leaves her at 1 HP (the trigger check below follows)
          battle.on('fatal', (c) => { if (c.unit === unit && !c.prevented && (st.undeadA || st.undeadB)) c.prevented = true; }, { owner: unit });
          battle.on('hpDamage', (c) => {
            if (c.target !== unit) return;
            const t = battle.time;
            const floor = Math.max(t < st.lockA ? floorA : 0, t < st.lockB ? floorB : 0);
            if (floor > 0) c.amount = Math.min(c.amount, Math.max(0, unit.hp - floor * unit.s.maxHp));
          }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.target !== unit || !up(unit)) return;
            if (st.undeadA && unit.hpRatio <= trig + 1e-9) {
              st.undeadA = false;
              st.lockA = battle.time + durA;
              battle.heal(unit, unit, unit.s.maxHp * healA, { self: true, tags: ['talent'] });
              battle.fx('heal', { x: unit.x, y: unit.y, id: unit.id });
            }
            if (st.undeadB && !st.undeadA && unit.hpRatio <= trigB + 1e-9) {
              st.undeadB = false;
              st.lockB = battle.time + durB;
              if (!(battle.time < st.lockA)) battle.heal(unit, unit, unit.s.maxHp * healB, { self: true, tags: ['talent'] });
              battle.fx('heal', { x: unit.x, y: unit.y, id: unit.id });
            }
          }, { owner: unit });
          const pen = num(hb.def_penetrate_fixed);
          if (pen > 0) toggleBuff(battle, unit, 'talent:huang:defPen', () => unit.hpRatio > num(hb.hp_ratio, 0.5), { defIgnoreFlat: pen });
        } },
        { install(battle, unit) { // 严酷训练 (+ CEN-X stage 3: ATK after 30 s, ASPD after 45 s)
          const resAt = num(t1['huang_t_2.interval'], num(t1.interval, 15));
          const res = Math.min(0.95, Math.max(0, -num(t1['huang_t_2.one_minus_status_resistance'], num(t1.one_minus_status_resistance))));
          const atk = num(t1['huang_t_2[e_002_atk].atk']), atkAt = num(t1['huang_t_2[e_002_atk].interval']);
          const as = num(t1['huang_t_2[e_002_atk_speed].attack_speed']), asAt = num(t1['huang_t_2[e_002_atk_speed].interval']);
          battle.on('deploy', ({ unit: u }) => {
            if (u !== unit) return;
            const seq = unit.deploySeq;
            const at = (s, fn) => battle.after(s, () => { if (up(unit) && unit.deploySeq === seq) fn(); }, { owner: unit });
            if (res > 0) at(resAt, () => battle.applyStatus(unit, 'resist', { value: res, source: unit }));
            if (atk) at(atkAt, () => battle.addBuff(unit, { key: 'talent:huang:atk', mods: { atkPct: atk }, tags: ['talent'] }));
            if (as) at(asAt, () => battle.addBuff(unit, { key: 'talent:huang:aspd', mods: { aspd: as }, tags: ['talent'] }));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // CEN-X: ×atk_scale on her ATK-based damage to a blocked enemy (every damage calculation)
        const blockedMul = num(tb.atk_scale, 1);
        if (blockedMul !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (target.blockedBy) dmg.amount *= blockedMul; });
        // CEN-Y: 生命值高于50%时受到的物理伤害降低20%
        const dr = num(tb.damage_resistance);
        if (dr > 0) onHitOn(battle, unit, ({ dmg }) => { if (dmg.type === 'phys' && unit.hpRatio > num(tb.hp_ratio, 0.5)) dmg.mul *= 1 - dr; });
      },
    };
  },
};
