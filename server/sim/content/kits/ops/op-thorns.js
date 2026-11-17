// server/sim/content/kits/ops/op-thorns.js — 棘刺 (char_293_thorns) 自选 operator kit: 6★ 领主 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (LOR-X, LOR-Δ) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_293_thorns, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); the client's battle
// logic — buff_template_data (thorns_t_1, thorns_s_2, thorns_e_002_t / [mark] / _tr, thorns_e_003_t / _tr), his charpack
// (talent 1 `_additiveActiveBuffs` thorns_t_1: triggerInterval 1, waitFirstTriggerInterval, independentCharacterSource;
// talent 2 toggle `_disableWhenInAttackState` / `InCombatState`, `_restoreDelay` 2) and the skill prefabs (skchr_thorns_2
// Thorn: `_preDelay` 0.5, cooldown key `cooldown`, the trait's 0.8 scale, ground + air selector, `max_target`;
// skchr_thorns_3 [a] / [b] buffs), the module parts ([uc]equips thorns_equip_1_n / 2_n: the trait buffs, and from stage 2
// the talent overrides — LOR-X `_targetFamilyMask` 31, LOR-Δ 3) — and PRTS 棘刺 (talent 备注, S2 备注, S3 备注, LOR-X 特性
// "于计算伤害时触发").
// - Trait (领主) "可以进行远程攻击，但此时攻击力降低至80%": the lord profile (professions.js: ×atk_scale unless the target
//   stands on his tile / the tile in front or he blocks it), range 3-12, hits air units (data canHitFly), blocks 2.
//   Module LOR-X “盐与沙” adds "攻击附带10%攻击力的法术伤害" (trait atk_scale_m; thorns_e_002_tr: ON_CALCULATE_DAMAGE, attack
//   type ADDITION — PRTS "造成预计算法术附加伤害"): atk_scale_m × ATK arts at source calculation, including S2 spikes.
//   Fixed-value poison is precomputed BUFF and does not enter source calculation. Module LOR-Δ “沙蚀” adds
//   "造成伤害时附带相当于10%伤害的神经损伤" (trait ep_damage_ratio; thorns_e_003_tr: ON_AFTER_OUTPUT_DAMAGE, every damage
//   type): ep_damage_ratio × output damage before target injury for every instance he deals — attacks, spikes, LOR-X additions and the
//   poison ticks — as 神经损伤 (docs/SIM.md §7.2 element conventions).
// - T1 神经腐蚀 "攻击使目标中毒，在3秒内每秒受到125点法术伤害（对会远程攻击的目标伤害加倍）" (full potential: 140): every
//   hit of his attacks (and of the S2 spikes, PRTS "所有攻击均能附加") poisons the target — one poison per 棘刺
//   (independentCharacterSource) for `duration` s, ticking every second, the first a second in (waitFirstTriggerInterval), damage[normal] or
//   damage[ranged] (an enemy whose 攻击方式 includes 远程: data applyWay RANGED or ALL; PRTS "伤害加倍为数值提升") as a fixed
//   arts 持续伤害 (FixedValueDamage MAGICAL, attack type BUFF: RES and ordinary dodge apply, tags dot). A new hit refreshes the
//   duration and keeps the damage value and the tick rhythm (PRTS "仅刷新持续时间而不改变伤害数值"). The ticks go on after
//   he leaves the field [ASSUMED, as 伊芙利特's 灼伤]. A dodged hit poisons nothing (no `damaged`; 击中目标的攻击).
//   LOR-X stage 2+ (thorns_e_002_t: no end of its own, cnt 1; every hit a new [mark] of `duration` s whose start adds 1
//   to cnt up to max_cnt; a tick without a [mark] ends it — damage × cnt) "可叠加4次": the tick is the first application's
//   value × the hits so far (≤ max_cnt; PRTS "以第一层的伤害数值为基础进行翻倍"), the poison ending `duration` s after the
//   last hit; all his hits, spikes included (mask 31). LOR-Δ stage 2+ (thorns_e_003_t, ep_break_multi): on an enemy in its
//   神经损伤 burst (the `neuralBurst` lock, FilterEPBreakRecoveryType SANITY) the tick is ×ep_break_multi 元素伤害; only his
//   normal attacks poison (mask 3; PRTS "仅有普通攻击能附加（意味着2技能不再附加中毒Buff）"), and that poison has no
//   independentCharacterSource: one per enemy whoever applies it. At stage 1 both modules leave the talent as it is
//   (battle_equip_table: no talent part in phase 1).
// - T2 故土潮声 "如果2秒内没有主动攻击过，每秒恢复最大生命3.5%的生命" (full potential: 4%): PRTS "增加“生命回复速度（百分比）”属性，
//   不受治疗加成和禁疗影响" — an hpRegenRatio buff (checklist 11, never battle.heal), on while his last attack is at least
//   `delay` s old (the toggle's restoreDelay after the attack states) and from his deployment on [ASSUMED: no attack yet counts as
//   "2秒内没有主动攻击过"]. The S2 spikes are no 主动攻击 (PRTS "不会使第二天赋效果中断").
// - S1 攻击力强化·γ型 (MANUAL, data DEFAULT): ATK +atk for `duration` s.
// - S2 护身尖刺 (MANUAL, 技能范围 3-1, data SKILL_RANGE): "停止攻击" (no normal attack; PRTS "技能期间，自身丢失全部视野"),
//   ATK +atk, DEF +def; every 普通伤害 an enemy deals him (PRTS "指受到普通伤害（伤害类型），而非由普通攻击造成的伤害";
//   thorns_s_2 FilterDamageModifer attack type NORMAL: not 溅射, not 持续 (dot / periodic), not 附加, not a gauge,
//   not a 流失, not 无来源) sets off the Thorn ability when its `cooldown` (0.8 / 0.75 s) is ready and he can act: 0.5 s
//   later (its `_preDelay`) up to max_target enemies of the 3-1 — ground and air, the usual target order — each take ATK ×
//   the trait's atk_scale (PRTS "始终受降低攻击倍率特性的影响") physical, a skill hit that is no normal attack (no `attack`
//   event, no SP), cancelled when the skill has ended, he left or cannot act by then [ASSUMED]. The 3-1 is not his
//   attack range: the card keeps his 3-12.
// - S3 至高之术 (MANUAL, attack SP, data ACTIVE_RANGE on its 3-3): range 3-3, ATK +atk, ASPD +attack_speed, every attack at
//   full ATK ("远程攻击不再降低攻击力": the skill's attack profile has no 0.8 — dmgMul 1, as 领主·Sharp S1) for `duration` s;
//   "第二次及以后使用时能力加成变为最初的两倍，且持续时间无限": from the second activation of a deployment on, the
//   thorns_s_3[b] numbers (ATK / ASPD ×2) and no end until he leaves (a toggle; the first use counts its own 30 s down) —
//   PRTS "每次部署棘刺时，重新计算该技能的使用次数": the count restarts with every deployment.

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { hasHp, isHpLoss, damageAttackType } from '../../../attack.js';
import { installLordArtsAddition } from '../shared/lord.js';

const S1 = 'skcom_atk_up[3]';
const S2 = 'skchr_thorns_2';
const S3 = 'skchr_thorns_3';
/** The skill ranges when a record carries none (data: 3-1, 3-3). */
const R3_1 = Object.freeze([[1, 0], [1, 1], [1, 2], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1], [-1, 2]]);
const R3_3 = Object.freeze([[1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]]);
/** skchr_thorns_2 Thorn `_preDelay`: the spikes land this long after the hit that set them off. */
const SPIKE_DELAY = 0.5;
/** thorns_t_1 triggerInterval: a poison tick every second. */
const POISON_IV = 1;
const AIR = Object.freeze({ canHitFly: true });
const S3_BUFF = 'skill:thorns:destreza';
const REGEN_KEY = 'talent:thorns:tide';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** An enemy whose 攻击方式 includes 远程 (PRTS "图鉴中【攻击方式】包含远程的敌人"; data applyWay). */
const attacksRanged = (e) => { const w = String(e?.def?.applyWay ?? '').toUpperCase(); return w === 'RANGED' || w === 'ALL'; };
/**
 * thorns_s_2 filters the explicit NORMAL class and enemy source, without filtering the HP-damage type.
 * Descriptive dot/addition/splash flags do not override that class; gauges and HP loss omit injury dispatch.
 */
function normalHitFromEnemy(c) {
  const d = c.dmg;
  return !!d && !!c.source && c.source.side === 'enemy' && !isHpLoss(d) && damageAttackType(d) === 'NORMAL';
}

export default {
  char_293_thorns: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const grid2 = skillRec(chess, S2)?.rangeGrid ?? R3_1, grid3 = skillRec(chess, S3)?.rangeGrid ?? R3_3;
    const rangedScale = num(tb.atk_scale, 0.8);
    const loreX = num(tb.atk_scale_m);                 // LOR-X: arts addition
    const loreD = num(tb.ep_damage_ratio);             // LOR-Δ: 神经损伤 rider
    const maxCnt = Math.max(1, Math.floor(num(t0.max_cnt, 1)));   // LOR-X stage 2+: 可叠加
    const breakMul = num(t0.ep_break_multi);           // LOR-Δ stage 2+: ×multi 元素伤害 in a 神经 burst
    const spikesPoison = !(breakMul > 0);              // LOR-Δ stage 2+: only normal attacks poison

    /** T1 神经腐蚀: poison `e` (one per 棘刺; a new hit refreshes it, LOR-X stage 2+ adds a layer). */
    const poison = (battle, unit, e) => {
      if (!e || !e.alive || e.side !== 'enemy' || !hasHp(e)) return;
      const dur = num(t0.duration, 3);
      const base = num(attacksRanged(e) ? t0['damage[ranged]'] : t0['damage[normal]']);
      if (!(dur > 0) || !(base > 0)) return;
      // one poison per 棘刺 (independentCharacterSource) — but the LOR-Δ stage 2+ one (thorns_e_003_t has no such flag)
      const key = breakMul > 0 ? 'thorns:poison' : `thorns:poison:${unit.id}`;
      const old = e.findBuff(key);
      const b = battle.addBuff(e, {
        key, duration: dur, refresh: 'extend', interval: POISON_IV, source: unit, tags: ['dot', 'talent'],
        data: { base, cnt: 1 },
        onTick({ battle: bt, unit: tgt, buff }) {
          if (!tgt.alive || !hasHp(tgt)) return;
          let amount = buff.data.base * (maxCnt > 1 ? buff.data.cnt : 1);
          let type = 'arts';
          if (breakMul > 0 && tgt.findBuff('neuralBurst')) { amount *= breakMul; type = 'elemental'; }
          bt.dealDamage({ source: unit, target: tgt, amount, type, element: type === 'elemental' ? 'neural' : undefined,
            attackType: 'BUFF', applyWay: 'NONE', calculation: 'precomputed', tags: ['talent', 'dot', 'thorns:poison'] });
        },
      });
      if (old && b === old && maxCnt > 1) old.data.cnt = Math.min(maxCnt, num(old.data.cnt, 1) + 1);
    };

    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) } },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), defPct: num(b2.def) },
          attack: { noAttack: true },     // 停止攻击
          onStart({ battle, unit }) {
            const cd = num(b2.cooldown, 0.8), n = Math.max(1, Math.floor(num(b2.max_target, 4)));
            // [ASSUMED] Literal-zero requests retain the simulator's shared injury dispatch policy.
            battle.addBuff(unit, { key: 'skill:thorns:spikes',
              observeInjury(c) {
                const sk = unit.skill;
                if (c.target !== unit || !sk || !sk.active || !up(unit) || !unit.canAct || !normalHitFromEnemy(c)) return;
                if (battle.time < unit.mem.thornsSpikeAt + cd - 1e-9) return;
                unit.mem.thornsSpikeAt = battle.time;
                const seq = unit.deploySeq, act = sk.activations;
                battle.after(SPIKE_DELAY, () => {
                  if (!up(unit) || unit.deploySeq !== seq || !unit.canAct || !unit.skill?.active || unit.skill.activations !== act) return;
                  const list = battle.enemiesInKeys(absoluteRangeKeys(grid2, unit.tileR, unit.tileC, unit.dir, 0), unit, AIR);
                  sortEnemyTargets(battle, unit, list, null);
                  const targets = list.slice(0, n);
                  if (!targets.length) return;
                  battle.fx('thorns', { x: unit.x, y: unit.y, id: unit.id, n: targets.length });
                  for (const e of targets) {
                    if (!e.alive) continue;
                    battle.dealDamage(unit, e, { amount: unit.s.atk * rangedScale * unit.s.atkScaleMul, type: 'phys', isSkill: true, tags: ['skill', 'thorns:spike'] });
                  }
                }, { owner: unit });
              },
            });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:thorns:spikes'); },
        },
        [S3]: {
          kind: 'toggle',
          targeting: { rangeGrid: grid3 },
          attack: { dmgMul: () => 1 },    // 远程攻击不再降低攻击力
          onStart({ battle, unit, skill }) {
            const n = (unit.mem.thornsS3Uses = num(unit.mem.thornsS3Uses) + 1);
            const again = n >= 2;
            const atk = again ? num(b3['thorns_s_3[b].atk'], 2 * num(b3.atk)) : num(b3.atk);
            const aspd = again ? num(b3['thorns_s_3[b].attack_speed'], 2 * num(b3.attack_speed)) : num(b3.attack_speed);
            battle.addBuff(unit, { key: S3_BUFF, mods: { atkPct: atk, aspd }, tags: ['skill'] });
            // the first use runs `duration` s; from the second on "持续时间无限" ([b].duration −1)
            skill.timeLeft = again && num(b3['thorns_s_3[b].duration'], -1) < 0 ? Infinity : Math.max(0.01, skill.duration);
          },
          onTick({ skill, dt }) {
            if (!Number.isFinite(skill.timeLeft)) return;
            skill.timeLeft -= dt;
            if (skill.timeLeft <= 1e-9) skill.end('duration');
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, S3_BUFF); },
        },
      },
      talents: [
        { install(battle, unit) { // 神经腐蚀: his attack hits (and the spikes, but under LOR-Δ stage 2+) poison
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.target || c.target.side !== 'enemy' || !c.dmg || isHpLoss(c.dmg) || c.type === 'element') return;
            const tags = c.dmg.tags || [];
            if (c.dmg.isAttack || (spikesPoison && tags.includes('thorns:spike'))) poison(battle, unit, c.target);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 故土潮声: 生命回复速度 while no attack of his is younger than `delay` s
          const r = num(t1.hp_recovery_per_sec_by_max_hp_ratio), delay = num(t1.delay, 2);
          if (!(r > 0)) return;
          unit.mem.thornsAttackAt = -Infinity;
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.thornsAttackAt = -Infinity; }, { owner: unit });
          battle.on('attack', (c) => { if (c.attacker === unit) unit.mem.thornsAttackAt = battle.time; }, { owner: unit });
          const apply = () => {
            const want = up(unit) && battle.time - unit.mem.thornsAttackAt >= delay - 1e-9;
            const has = unit.findBuff(REGEN_KEY);
            if (want && !has) battle.addBuff(unit, { key: REGEN_KEY, mods: { hpRegenRatio: r }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, REGEN_KEY);
          };
          battle.on('tick', apply, { owner: unit });
          battle.on('battleStart', apply, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit && battle.started) apply(); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        installLordArtsAddition(battle, unit, loreX, ['module', 'addition', 'thorns:lorx']);
        // S3: the use count restarts with every deployment (PRTS "每次部署棘刺时，重新计算该技能的使用次数")
        battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.thornsS3Uses = 0; }, { owner: unit });
        // thorns_e_003_tr: 神经损伤 uses output damage before target injury, not eventual HP removed.
        if (loreD > 0) {
          battle.on('damageOutput', (c) => {
            if (c.source !== unit || !c.target || c.target.side !== 'enemy' || c.type === 'element' || !(c.amount > 0) || !hasHp(c.target)) return;
            battle.dealElementDamage({ source: unit, target: c.target, element: 'neural', amount: c.amount * loreD, tags: ['module', 'thorns:lord'] });
          }, { owner: unit });
        }
        if (unit.skill?.id !== S2) return;
        // The actual S2 buff owns its observer; cooldown state lasts for this deployment.
        unit.mem.thornsSpikeAt = -Infinity;
      },
    };
  },
};
