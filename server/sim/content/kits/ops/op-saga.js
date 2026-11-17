// server/sim/content/kits/ops/op-saga.js — 嵯峨 (char_362_saga) 自选 operator kit: 6★ 尖兵 (先锋), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_362_saga, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); gamedata_const ba.dying
// "重伤: 移速下降且无法被阻挡，10秒后自然死亡，被击杀后使击杀者回复数点技力"; PRTS 嵯峨 (劝善 备注 "本天赋第一部分实际效果为：
// 自身造成的伤害不会致命（至多使目标生命值降至1点），成功造成伤害后若目标生命值小于等于1则为目标附加重伤"; 清明 备注 "嵯峨每次
// 部署都可以触发一次本天赋"; S2 备注 "可选择重伤单位", "攻击附加延迟检测Buff：0.7s后进行检测，强制击杀持有重伤的目标（击杀来源为
// 嵯峨自身），随后解除目标的重伤"; S3 备注 "造成伤害前判断目标生命值"); PRTS 术语释义 重伤 ("重伤Buff包含：移动速度-80%，禁疗、
// 禁用近战，阻挡数、生命回复速度、生命回复速度（百分比）归零，从消失状态变为出现的瞬间立刻死亡（消失状态期间不会因重伤自然死亡）",
// "重伤造成的自然死亡为强制死亡（也即可以杀死持有不死的单位），视为无来源击杀", "重伤期间的单位无法再被施加重伤"); PRTS 异常效果
// 禁用近战 "敌人类单位无法进行阻挡攻击，无法被阻挡".
// - Trait (尖兵) "能够阻挡两个敌人": the profession default (block 2). SOL-X 何处寻驮？ "阻挡敌人时攻击力和防御力各+8％"
//   (trait bb atk / def): +atk / +def while she blocks an enemy. SOL-Y 身向云泥 "首次部署时部署费用-4" (hidden
//   runtime_cost −4): the first deployment of a battle costs nothing in this mode ⇒ no effect (as 推进之王's SOL-Y).
// - T1 劝善: her damage is never lethal to an enemy (a `fatal` hook keeps it at 1 HP — every damage of hers: attacks, 除恶;
//   not a 无来源 one, which has no source); after a damage of hers an enemy at ≤ 1 HP becomes 重伤 (the DYING buff, once:
//   none while it holds one): move speed ×(1 + move_speed) (−80 %), unblockable (禁用近战: released by its blocker, no
//   block attack), 禁疗 (healFree / noHeal), its HP regeneration zeroed; it dies `interval` s later (10) — a forced, 无来源
//   death (battle.kill with no killer: no SP, 不死 does not hold it) — not while it is 消失 (hidden), and at once when it
//   comes back from 消失. Whoever kills a 重伤 enemy gets `sp` SP (2; "击杀者技力+2", giveSp: not during a timed skill).
//   "嵯峨不攻击重伤单位": the kit trait `skipEnemy` (targeting.js canTargetEnemy) — no normal attack, block target or
//   trigger target of hers is a 重伤 enemy. SOL-X stage 2+ "对生命值低于一半的单位造成的伤害提升15%" (hidden hp_ratio /
//   damage_scale): ×damage_scale on every damage of hers whose target is below hp_ratio before it.
//   A shared-pool leader (boss rounds: its HP is the pool's, attack/health.js runs no `fatal` step for it) is outside 劝善
//   [ASSUMED: her damage there is ordinary].
// - T2 清明 "生命值低于40%时，仅一次获得70%物理闪避和每秒回复5%的最大生命，持续15秒" (full potential: 6 %, 17 s): once per deployment (PRTS 备注), the first
//   time a damage leaves her below hp_ratio of her max HP: dodgePhys prob and hpRegenRatio for `duration` s — the
//   blackboard key hp_recovery_per_sec_by_max_hp_ratio is the 生命回复速度（百分比） attribute (PRTS 异常效果 禁疗 / 术语释义
//   重伤 name it), as 宴 S1 / 山 / 幽灵鲨 / 蜜蜡 / 烛煌 apply it [ASSUMED: no 备注 of 清明 says so; 余's 闲云隐市 with the same
//   key is still open, DESIGN 0.2.0.l3]. SOL-Y stage 2+: the talent change's numbers — at stage 3, full potential: 7 % per second for 20 s (text and
//   blackboard 0.07 agree; at potential 0 the text read 6 % while the blackboard was 0.065: the game applies the blackboard).
// - S1 冲锋号令·γ型 (AUTO, no target): +cost DP at once; an AUTO skill acting on nobody fires as soon as its SP is full
//   (`trigger: 'SP_FULL'`, as 推进之王's / 德克萨斯's kits cast the same skill — the owner's AUTO rule).
// - S2 除恶 (MANUAL, 2 charges, data SKILL_RANGE on its x-6 cross: any enemy there, 无视其不可选中): +cost DP; the up to
//   S2_MAX (6, the text's — no blackboard key) selectable ground enemies of the cross ("地面敌人"; a 重伤 one included:
//   "可选择重伤单位"), best targets first (her priority) [ASSUMED order], take atk_scale × ATK physical (a skill damage;
//   劝善 applies); S2_CHECK s later each of them still 重伤 is killed (killer 嵯峨: she gets its SP, stats and bounty; a
//   forced kill — battle.kill, no `fatal` step), then its 重伤 is lifted (should a kill handler have revived it).
// - S3 怒目 (MANUAL, 20 s, data ACTIVE_RANGE on her 1-1 + 1): +cost DP every interval s while it runs (value in all; the
//   rest of value at its natural end), attack interval +base_attack_time s (+0.5 on her 1.05), 攻击距离 +1
//   (targeting.rangeExtend), ATK +atk, every enemy she blocks at once (hitAllBlocked; one target in range while she
//   blocks none), and one more attack on each target that was below attack@hp_ratio before the hit (PRTS 备注: an HP
//   snapshot at beforeAttack; the extra attack is a forced one a tick later, no 重伤 target).
// Melee physical, ground-only (canHitFly false), ground enemies target her normally (no 起飞 / 迷彩 / 隐匿).

import { num, talentBb, moduleBb, traitBb, skillRec, toggleBuff, batMod, giveSp, up } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_saga_2';
const S3 = 'skchr_saga_3';
/** The 重伤 buff (gamedata_const ba.dying): one per enemy — "重伤期间的单位无法再被施加重伤". */
export const DYING = 'saga:dying';
/** S2 除恶 备注 "攻击附加延迟检测Buff：0.7s后进行检测" (no blackboard key). */
export const S2_CHECK = 0.7;
/** S2 除恶 "对十字范围内最多6名地面敌人" — the text's number when it cannot be read (no blackboard key). */
const S2_MAX = 6;
/** The x-6 cross (skill range) when the data carries no grid. */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** 除恶's selection: ground enemies only ("地面敌人"), 重伤 ones included (no skipEnemy). */
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });

/** Is `e` 重伤 (whoever put it there)? */
export const isDying = (e) => !!(e && typeof e.findBuff === 'function' && e.findBuff(DYING));

/**
 * 重伤 on enemy `e` from `saga` (PRTS 术语释义 重伤): move speed ×(1 + ms), unblockable (禁用近战), 禁疗, no HP regeneration;
 * a forced, 无来源 death `life` s later — never while 消失, at once when it comes back from 消失. The killer of a 重伤
 * enemy gets `sp` SP (the talent's kill hook reads `data.sp`). Nothing when it already holds one.
 */
function applyDying(battle, saga, e, { sp, life, ms }) {
  if (!e || !e.alive || isDying(e)) return;
  battle.addBuff(e, {
    key: DYING, source: saga, visible: true,
    mods: { moveMul: Math.max(0, 1 + ms), hpRegen: -1e9 },
    flags: { unblockable: true, healFree: true, noHeal: true },
    data: { sp, until: battle.time + life, hidden: !!e.hidden },
    onTick: ({ battle: b, unit: x, buff }) => {
      const d = buff.data;
      if ((d.hidden && !x.hidden) || (!x.hidden && b.time + 1e-9 >= d.until)) { b.kill(x, null); return; }
      d.hidden = !!x.hidden;
    },
  });
  battle.fx('dying', { x: e.x, y: e.y, id: e.id, from: saga.id });
}

export default {
  char_362_saga: (bb, chess) => {
    const b1 = skillRec(chess, S1)?.bb ?? {}, b2 = skillRec(chess, S2)?.bb ?? {}, b3 = skillRec(chess, S3)?.bb ?? {};
    const s2 = skillRec(chess, S2);
    const t0 = talentBb(chess, 0);   // 劝善: move_speed, sp, interval
    const t1 = talentBb(chess, 1);   // 清明: hp_ratio, hp_recovery_per_sec_by_max_hp_ratio, prob, duration
    const hidden = moduleBb(chess);  // SOL-X stage 2+: hp_ratio, damage_scale; SOL-Y: runtime_cost (no effect)
    const tb = traitBb(chess);       // SOL-X: atk, def while blocking
    const picked = chess?.skill?.skillId ?? null;
    const maxHit = Math.max(1, Math.floor(num(/最多(\d+)名/.exec(String(s2?.desc ?? ''))?.[1], S2_MAX)));
    return {
      // 劝善 "嵯峨不攻击重伤单位"
      trait: { skipEnemy: isDying },
      skills: {
        [S1]: {
          kind: 'instant', trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            const n = num(b1.cost);
            battle.addDp(unit.ownerId, n, unit);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          onStart({ battle, unit }) {
            const n = num(b2.cost);
            battle.addDp(unit.ownerId, n, unit);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
            const keys = absoluteRangeKeys(s2?.rangeGrid ?? X6, unit.tileR, unit.tileC, unit.dir, 0);
            const list = battle.enemiesInKeys(keys, unit, GROUND);
            sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
            const hit = list.slice(0, maxHit);
            battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'saga:cleanse', n: hit.length });
            for (const e of hit) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['saga:s2'] });
              if (!e.alive) continue;
              battle.addBuff(e, {
                key: 'saga:s2check', refresh: 'independent', maxStacks: 99, duration: S2_CHECK, source: unit,
                onExpire: ({ battle: b, unit: x }) => {
                  if (!x.alive || !isDying(x)) return;
                  b.kill(x, unit);
                  if (x.alive) b.removeBuff(x, DYING);
                },
              });
            }
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          targeting: { rangeExtend: num(b3.ability_range_forward_extend) },
          attack: { hitAllBlocked: true },
          onStart({ unit }) { unit.mem.sagaDp = { acc: 0, got: 0 }; },
          onTick({ battle, unit, dt }) {
            const st = unit.mem.sagaDp;
            const iv = stepOf('interval', num(b3.interval, 1), 1), n = stepOf('cost', num(b3.cost), 1), total = num(b3.value);
            if (!st || !(iv > 0) || !(n > 0)) return;
            st.acc += dt;
            let guard = 0;
            while (st.acc + 1e-9 >= iv && st.got + n <= total + 1e-9 && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval/cost
              st.acc -= iv;
              st.got += n;
              battle.addDp(unit.ownerId, n, unit);
            }
          },
          onEnd({ battle, unit, reason }) {
            const st = unit.mem.sagaDp;
            unit.mem.sagaDp = null;
            // the last grant falls on the very end of its 20 s
            if (st && reason === 'duration' && num(b3.value) - st.got > 1e-9) battle.addDp(unit.ownerId, num(b3.value) - st.got, unit);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 劝善
          const sp = num(t0.sp), life = num(t0.interval, 10), ms = num(t0.move_speed, -0.8);
          // "自身造成的伤害不会致命（至多使目标生命值降至1点）" — before any other saver: it never was lethal
          battle.on('fatal', (c) => {
            if (c.source === unit && c.unit && c.unit.side === 'enemy' && !c.prevented) c.prevented = true;
          }, { owner: unit, priority: 100 });
          // "成功造成伤害后若目标生命值小于等于1则为目标附加重伤"
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !e || e.side !== 'enemy' || !e.alive || e.bossPool || c.type === 'element' || e.hp > 1) return;
            applyDying(battle, unit, e, { sp, life, ms });
          }, { owner: unit });
          // "被击杀后使击杀者回复数点技力" — the killer of a 重伤 enemy she marked (none for the 无来源 natural death)
          battle.on('kill', (c) => {
            const d = c.victim && typeof c.victim.findBuff === 'function' ? c.victim.findBuff(DYING) : null;
            if (!d || d.source !== unit || !c.killer || c.killer.side !== 'ally') return;
            giveSp(c.killer, num(d.data?.sp));
          }, { owner: unit });
          // SOL-X stage 2+: "对生命值低于一半的单位造成的伤害提升15%"
          const hr = num(hidden.hp_ratio), ds = num(hidden.damage_scale, 1);
          if (hr > 0 && ds !== 1) {
            battle.on('hit', (c) => {
              if (c.source === unit && c.target && c.target.side === 'enemy' && c.target.hpRatio < hr) c.dmg.mul *= ds;
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 清明: once per deployment below hp_ratio — dodgePhys prob, hpRegenRatio, `duration` s
          const hr = num(t1.hp_ratio), p = num(t1.prob), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), dur = num(t1.duration);
          if (!(hr > 0) || !(dur > 0)) return;
          battle.on('damaged', (c) => {
            if (c.target !== unit || !up(unit) || unit.mem.qingmingAt === unit.deploySeq) return;
            if (!(unit.hp < unit.s.maxHp * hr)) return;
            unit.mem.qingmingAt = unit.deploySeq;
            battle.addBuff(unit, { key: 'talent:saga:qingming', duration: dur, mods: { dodgePhys: p, hpRegenRatio: regen }, visible: true, tags: ['talent'] });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'saga:qingming' });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // SOL-X 何处寻驮？: 阻挡敌人时攻击力和防御力各+8％
        const ma = num(tb.atk), md = num(tb.def);
        if (ma || md) toggleBuff(battle, unit, 'trait:saga:block', () => unit.blocking.length > 0, { atkPct: ma, defPct: md });
        // 怒目: one more attack on each target below attack@hp_ratio (checked before the hit) — a forced attack a tick later
        if (picked !== S3) return;
        const hp3 = num(b3['attack@hp_ratio']);
        if (!(hp3 > 0)) return;
        let half = null;
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || unit.mem.sagaExtra || !unit.skill?.active) return;
          half = (c.targets || []).filter((e) => e && e.side === 'enemy' && e.hpRatio < hp3);
        }, { owner: unit, priority: -100 });
        battle.on('attack', (c) => {
          if (c.attacker !== unit || unit.mem.sagaExtra) return;
          const list = half;
          half = null;
          if (!list || !list.length) return;
          const dep = unit.deploySeq;
          battle.after(0, () => {
            if (!up(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm) return;
            const t = list.filter((e) => e.alive && canTargetEnemy(unit, e, unit.profile));
            if (!t.length) return;
            unit.mem.sagaExtra = true;
            try { battle.forceAttack(unit, t, { noAmmo: true }); } finally { unit.mem.sagaExtra = false; }
          }, { owner: unit });
        }, { owner: unit });
      },
    };
  },
};
