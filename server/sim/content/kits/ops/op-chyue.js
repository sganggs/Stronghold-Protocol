// server/sim/content/kits/ops/op-chyue.js — 重岳 (char_2024_chyue) 自选 operator kit: 6★ 斗士 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_2024_chyue, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 重岳 (talent and
// skill 备注); the client's buff templates (buff_template_data `chyue_t_1` / `_passive`, `chyue_t_2` / `_sp`,
// `chyue_e_002_t[unkill]`, `chyue_s_1_enhance_judge`, `chyue_s_2_levitate` / `_finish_levitate` / `_atk_scale`,
// `chyue_s_3_enhance` / `_trigger` / `_end_check`); Arknights Terra Wiki "Chongyue".
// - Trait (斗士) "能够阻挡一个敌人": the profession default (block 1, melee, ground only). Module FGT-X "拥有15%的物理闪避"
//   (trait bb prob): a permanent physical dodge. Module FGT-Y "生命值高于50%时攻击速度+10" (trait bb attack_speed /
//   hp_ratio): ASPD while HP > hp_ratio.
// - T1 止戈 "对目标普通攻击时，有23%的概率使重岳2.5秒内对其造成的伤害提升65%" (full potential: 25 % / 70 %; bb prob /
//   damage_scale / up_duration): chyue_t_1 rolls on every damage instance a normal attack outputs (PRTS 备注 "于普通攻击
//   每次造成伤害时独立触发，重复施加时仅刷新持续时间" — after it lands, so not for that instance) and marks the target for
//   up_duration s (his own mark: independentCharacterSource); chyue_t_1_passive: every damage of his to a marked enemy ×
//   damage_scale (DamageScale, a final multiplier — skills included). FGT-Y stage 3: damage_scale 1.8, prob 0.23 (the
//   module's blackboard; its text reads 25%（+2%）). S2's second segment marks at 100 %.
// - T2 万象为宾 "若重岳释放一次技能击倒不少于一个敌人，则回复3点技力" (bb sp): PRTS 备注 — only a kill by skill damage counts,
//   judged when the skill (or an ability of it) finishes; the SP ignores 阻回 (ModifySp forceFlag). FGT-X stage 3:
//   4 SP, and "未击倒敌人时变为回复1点技力" (the hidden part's sp: chyue_e_002_t[unkill]). S2's second segment is judged on
//   its own (PRTS: "第二段攻击打出时恢复一次SP…只与这第二段攻击是否击杀了敌人有关").
// - S1 冲盈 (MANUAL, attack SP, 可充能 3 次; data DEFAULT): the next attack strikes its target for atk_scale × ATK; cast
//   from a full stack (蓄力, chyue_s_1_enhance_judge: ≥ 3 charges) it spends every charge (ClearCharacterSp) and strikes
//   `times` times.
// - S2 拂尘 (MANUAL, 可充能 2 次; data SKILL_RANGE on its x-4): at once up to max_target enemies around him (PRTS 备注
//   "可对空，优先选择自身第一天赋生效中的>自身阻挡的>仇恨值最高的敌人") take atk_scale × ATK physical, and those he marked are
//   浮空 for 2 s (chyue_s_2_levitate: ground enemies only — the engine refuses data flyers); then the second segment
//   (SecAttack, outside the skill — 0.5 s later: his skeleton's Skill_2_Begin hits at 0.367 s of its 0.833 s, Skill_2_End
//   at 0.033 s): every 浮空 enemy around him loses every 浮空 buff (chyue_s_2_finish_levitate), takes atk_scale_down × ATK
//   physical and gets his mark (100 %, after that damage). The first segment lands at the cast [ASSUMED: the kits'
//   instant convention — the clip's 0.367 s wind-up is not modelled].
// - S3 我无 (MANUAL, attack SP; data DEFAULT): the next attack strikes its target and the ground enemies within 0.8 of it
//   (PRTS 备注 "溅射半径0.8"; the skill cannot hit air) for atk_scale × ATK. Its cast_cnt-th cast of a deployment turns him
//   (【变身】, chyue_s_3_end_check — "第五次开启本技能时【变身】（每次部署单独计算）"; that cast keeps its single strike, the
//   text's "累计使用五次技能后"): his range becomes x-6, every normal attack hits twice and gives 1 more SP ignoring 阻回
//   (chyue_s_3_enhance), the skill fires by itself the moment its SP is full and a normal-attack target exists
//   (chyue_s_3_trigger TriggerSkill, checked every frame: not the 3 s automatic-operation cooldown) and its strike lands
//   twice. The fixed animation (不受攻击速度影响) is modelled as one attack interval [ASSUMED].

import { num, talentBb, moduleBb, traitBb, up, onHitBy, statBuff, toggleBuff, skillRec } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { hasHp, isHpLoss } from '../../../attack.js';

const S1 = 'skchr_chyue_1';
const S2 = 'skchr_chyue_2';
const S3 = 'skchr_chyue_3';
/** S2's 技能范围 when the data carries none (x-4: the 8 tiles around him and his own). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** His range after the S3 【变身】 (PRTS 备注 "攻击范围扩大至 x-6"; range_table x-6). */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** S3 "溅射半径0.8" (PRTS 备注). */
const S3_SPLASH = 0.8;
/** S2 浮空 "持续2s" (PRTS 备注; chyue_s_2_levitate lifeTime 2). */
const S2_LEVITATE = 2;
/** S2's second segment after the first: the skeleton's OnAttack events (Skill_2_Begin 0.367 / 0.833 s, Skill_2_End 0.033 s). */
const S2_SECOND_DELAY = 0.833 + 0.033 - 0.367;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const markKey = (unit) => `talent:chyue:mark#${unit.id}`;
const marked = (unit, e) => !!e.findBuff(markKey(unit));

export default {
  char_2024_chyue: (bb, chess, def) => {
    const tb = traitBb(chess);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hb = moduleBb(chess);   // FGT-X stage 3: sp when the skill killed nobody
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const picked = def?.skill?.id ?? chess?.skill?.skillId ?? null;
    const castCnt = Math.max(1, Math.floor(num(b3.cast_cnt, 5)));
    const mark = (battle, unit, e) => {
      if (hasHp(e)) battle.addBuff(e, { key: markKey(unit), duration: num(t0.up_duration, 2.5), refresh: 'replace', source: unit, tags: ['talent'] });
    };
    /** 万象为宾: the SP of a finished skill / segment (a kill by his skill damage: sp, else the FGT-X stage 3 part). */
    const settle = (unit) => {
      const killed = !!unit.mem.chyueKilled;
      unit.mem.chyueKilled = false;
      const n = killed ? num(t1.sp) : num(hb.sp);
      if (n > 0 && up(unit) && unit.skill) unit.skill.gainSp(n, 'init');   // ModifySp forceFlag: 阻回 does not stop it
    };
    const s2Keys = (unit) => absoluteRangeKeys(s2?.rangeGrid?.length ? s2.rangeGrid : X4, unit.tileR, unit.tileC, unit.dir, 0);
    /** S2's second segment (SecAttack). */
    const secondSegment = (battle, unit, seq) => {
      if (!up(unit) || unit.deploySeq !== seq) return;
      unit.mem.chyueKilled = false;
      const atk = unit.s.atk;
      const lifted = battle.enemiesInKeys(s2Keys(unit), unit, { canHitFly: true }).filter((e) => e.s.flags.levitate);
      if (lifted.length) battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'chyue:down' });
      for (const e of lifted) {
        for (const b of e.buffs.slice()) if (b.flags && b.flags.levitate) battle.removeBuff(e, b);
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount: atk * num(b2.atk_scale_down, 1), type: 'phys', isSkill: true, tags: ['skill'] });
        mark(battle, unit, e);
      }
      settle(unit);
    };
    /** After the S3 【变身】: x-6, double hits, +1 SP per attack, the self-cast. */
    const awaken = (battle, unit) => {
      unit.mem.chyueAwake = true;
      unit.rangeGrid = X6;
      battle.refreshRange(unit);
      battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'atk' });
    };
    return {
      skills: {
        [S1]: {
          kind: 'charges',
          attack: { atkScale: num(b1.atk_scale, 1), hitsFn: (b, u) => u.mem.chyueS1Hits || 1 },
          onStart({ unit, skill }) {
            // 蓄力: the cast took one charge of a full stack ⇒ the rest goes too and the strike lands `times` times
            const full = skill.maxCharges > 1 && skill.charges === skill.maxCharges - 1;
            unit.mem.chyueS1Hits = full ? Math.max(1, Math.floor(num(b1.times, skill.maxCharges))) : 1;
            if (full) { skill.charges = 0; skill.sp = 0; }
          },
          onEnd({ unit }) { unit.mem.chyueS1Hits = 1; settle(unit); },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          onStart({ battle, unit }) {
            unit.mem.chyueKilled = false;
            const foes = battle.enemiesInKeys(s2Keys(unit), unit, { canHitFly: true });
            sortEnemyTargets(battle, unit, foes, null);   // the ones he blocks first, then aggro
            foes.sort((a, b) => (marked(unit, b) ? 1 : 0) - (marked(unit, a) ? 1 : 0));   // his marked ones before them (stable)
            const atk = unit.s.atk;
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1.5, id: unit.id, skill: 'chyue:whisk' });
            for (const e of foes.slice(0, Math.max(1, Math.floor(num(b2.max_target, 4))))) {
              if (!e.alive) continue;
              const lift = marked(unit, e);
              battle.dealDamage(unit, e, { amount: atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
              if (lift && e.alive) battle.applyStatus(e, 'levitate', { duration: S2_LEVITATE, source: unit });
            }
            const seq = unit.deploySeq;
            battle.after(S2_SECOND_DELAY, () => secondSegment(battle, unit, seq), { owner: unit });
          },
          onEnd({ unit }) { settle(unit); },
        },
        [S3]: {
          kind: 'instant',
          attack: {
            atkScale: num(b3.atk_scale, 1), splashRadius: S3_SPLASH, hitsFn: () => 1,
            onHit({ battle, unit, target, x, y }) {
              if (!unit.mem.chyueAwake) return;
              // after the 【变身】 the strike lands once more: its target and the ground enemies within 0.8 of it
              const amount = unit.s.atk * num(b3.atk_scale, 1);
              const cx = target ? target.x : x, cy = target ? target.y : y;
              if (target && target.alive) battle.dealDamage(unit, target, { amount, type: 'phys', isSkill: true, tags: ['skill'] });
              for (const e of battle.foesInRadius(cx, cy, S3_SPLASH, true)) {
                if (e === target || !e.alive || e.isFlying || e.s.flags.untargetable) continue;
                battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, isSplash: true, tags: ['skill'] });
              }
            },
          },
          onStart({ unit }) { unit.mem.chyueCasts = (unit.mem.chyueCasts || 0) + 1; },
          onEnd({ battle, unit }) {
            settle(unit);
            if (!unit.mem.chyueAwake && unit.mem.chyueCasts >= castCnt && up(unit)) awaken(battle, unit);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 止戈
          const p = num(t0.prob), scale = num(t0.damage_scale, 1);
          if (scale !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (marked(unit, target)) dmg.mul *= scale; });
          if (!(p > 0)) return;
          battle.on('damaged', (c) => {
            const e = c.target, d = c.dmg;
            if (c.source !== unit || !e || e.side !== 'enemy' || !d || !d.isAttack || d.isSkill || isHpLoss(d) || c.type === 'element' || !hasHp(e)) return;
            if (battle.rng.chance(p)) mark(battle, unit, e);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 万象为宾: a kill by his skill damage, for the running skill / segment (settle)
          battle.on('damaged', (c) => {
            if (c.source === unit && c.dmg && c.dmg.isSkill && c.target && c.target.side === 'enemy' && !hasHp(c.target)) unit.mem.chyueKilled = true;
          }, { owner: unit });
        } },
      ],
      // the S3 【变身】's double hit (normal attacks only: S1 / S3 strikes set their own hits)
      trait: picked === S3 ? { hitsFn: (b, u) => (u.mem.chyueAwake ? 2 : 1) } : undefined,
      install(battle, unit) {
        // FGT-X 物理闪避 / FGT-Y 生命值高于50%时攻击速度+10
        if (num(tb.prob) > 0) statBuff(battle, unit, 'trait:chyue:dodge', { dodgePhys: num(tb.prob) });
        if (num(tb.attack_speed)) toggleBuff(battle, unit, 'trait:chyue:aspd', () => unit.hpRatio > num(tb.hp_ratio, 0.5), { aspd: num(tb.attack_speed) });
        // every deployment starts untransformed with no cast counted (每次部署单独计算)
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          unit.mem.chyueCasts = 0;
          unit.mem.chyueAwake = false;
          unit.mem.chyueS1Hits = 1;
          unit.mem.chyueKilled = false;
          const own = unit.def?.rangeGrid;
          if (own && unit.rangeGrid !== own) { unit.rangeGrid = own; battle.refreshRange(unit); }
        }, { owner: unit });
        if (picked !== S3) return;
        // 【变身】: +1 SP per normal attack (阻回 ignored) and the self-cast the moment SP and a target are there
        battle.on('attack', (c) => {
          if (c.attacker === unit && !c.isSkill && unit.mem.chyueAwake && unit.skill) unit.skill.gainSp(1, 'init');
        }, { owner: unit });
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!unit.mem.chyueAwake || !sk || !up(unit) || !unit.canAct || !sk.ready || sk.pending || unit.s.flags.silence) return;
          const prof = battle.effectiveProfile(unit);
          if (!battle.enemiesInKeys(unit.rangeKeys, unit, prof).length && !battle.blockedTargets(unit, prof).length) return;
          if (!sk.activate('awake')) return;
          if (battle.forceAttack(unit)) unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
        }, { owner: unit });
      },
    };
  },
};
