// server/sim/content/kits/ops/op-lmlee.js — 老鲤 (char_322_lmlee) 自选 operator kit: 6★ 行商 (特种), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_322_lmlee, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 老鲤 (有备无患
// 备注 "“费用充足”指的是当前费用≥触发天赋所需要消耗的费用 / 自身已拥有本天赋的抵消异常效果时，额外消耗费用效果不会重复触发。本天赋
// 不会对我方单位造成晕眩"; S2 备注 "标记爆炸半径1，可对空 / 撤退老鲤时，如果老鲤没有阻挡存在标记的目标，则标记会消失且不产生任何
// 效果 / …①老鲤被击倒 ②老鲤在阻挡被标记的目标时撤退 ③在标记消失前再次释放本技能"; S3 备注 "闪避效果以伤害来源当前位置为准，
// 无来源伤害始终被视作“来自范围外”"), PRTS 分支特性信息 行商 ("可以且优先攻击自身阻挡的单位" — the engine's blocker rule).
// - Trait (行商) "在场时每3秒消耗3点部署费用（不足时自动撤退）": the profession default (professions.js installMerchant, trait
//   bb interval / cost). Module MER-X “无问吉凶” overrides it with 2 DP (trait bb cost −2). Module MER-Y “但思善恶” adds
//   "每次特性消耗费用时攻击力+4%，最多可以叠加5次" (hidden module talent atk / max_stack_cnt): every trait payment +atk ATK,
//   up to max_stack_cnt stacks, until he leaves the field. "再部署时间减少" is in the stats; "撤退时不返还部署费用" has no
//   battle effect here (no manual retreat).
// - T1 和气生财 "老鲤阻挡目标时，使其攻击速度-14，且自身攻击速度+14；当周围八格内仅存在一个敌人时效果翻倍" (full
//   potential: ∓15; lmlee_t_1[enemy] / [self].attack_speed, cnt): while he blocks, the blocked enemy ASPD −15 and his own +15, both ×2
//   while exactly `cnt` enemy stands on the 3 × 3 around him (his tile included [ASSUMED: the enemy he blocks stands
//   there], flyers too). MER-Y stage 3: ∓21.
// - T2 有备无患 "特性消耗费用时，若费用足够则改为消耗5费用，抵消自身受到的下一次晕眩/冻结，并使攻击来源晕眩3秒" (extra_cost,
//   stun): a trait payment while DP ≥ |extra_cost| and no guard held pays |extra_cost| instead (the `merchantPay` hook) and
//   gives him the guard; the guard cancels the next 晕眩 / 冻结 on him (a cold-on-cold 冻结 too) and stuns its source for
//   `stun` s — an enemy only (PRTS: never an ally). MER-X stage 3: 4 DP, 4 s.
// - S1 小惩大诫 (AUTO, 持续时间无限): ATK +atk, 法术闪避 prob. An AUTO skill acting on himself fires as soon as its SP is
//   full (`trigger: 'SP_FULL'`, the owner's AUTO rule, kits/README.md checklist 5); the data's DEFAULT would wait for an
//   attack.
// - S2 驱凶辟邪 (MANUAL, data DEFAULT): passive ASPD +attack_speed. Cast as he is about to attack: the target of that
//   attack is marked (taunt_level: our units select it first — "使其更易受我方攻击"); paper_duration s later the mark bursts
//   for (default_atk_scale + n × factor_atk_scale) × his ATK arts damage on every enemy within MARK_RADIUS of it (air
//   units too; 中点判定 around the target, the selectable enemies), n = the damage instances our side dealt to the target
//   meanwhile (≤ max_stack_cnt; at the cap, or when the target is knocked out, it bursts at once). PRTS 备注: it also
//   bursts when he is knocked out, when he leaves while blocking the marked enemy, and when he casts again; when he leaves
//   otherwise it vanishes. Counted: every `damaged` instance of an ally (credit included) on it but 元素损伤 and 流失
//   [ASSUMED: a hit absorbed by a shield counts]. The burst after a knock-out uses his ATK of the last tick on the field
//   [ASSUMED].
// - S3 贵客盈门 (AUTO, 持续时间无限; SP_FULL as S1): range x-4, ATK / DEF +atk / +def, taunt +taunt_level; each attack pushes
//   every other enemy of his range with attack@force (小力 = 0) at attack@prob_knockback (radial from him [ASSUMED: the text
//   gives no direction — knockback[relative]]); prob to dodge each physical / arts damage whose source stands outside his
//   range at that moment (无来源 damage always counts as from outside).

import { num, talentBb, moduleBb, skillRec, statBuff, up } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { isHpLoss } from '../../../attack.js';
import { acquireTargets, effectiveProfile } from '../../../ai.js';

const S1 = 'skchr_lmlee_1';
const S2 = 'skchr_lmlee_2';
const S3 = 'skchr_lmlee_3';
/** The 3 × 3 around him (range_table x-4): 和气生财's 周围八格 and S3's range when the data carries no grid. */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** S2 驱凶辟邪's burst radius (PRTS 备注 "标记爆炸半径1"; no blackboard key). */
export const MARK_RADIUS = 1;
/** 有备无患's guard on him (cancels the next 晕眩 / 冻结). */
export const GUARD_KEY = 'lmlee:guard';
/** Tag of S2's burst (not counted as a damage instance on the mark). */
const BURST_TAG = 'lmlee:burst';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const markKey = (unit) => `lmlee:mark:${unit.id}`;

/** End the mark `m` without a burst (he left without blocking the marked enemy, the target left the field). */
function dropMark(battle, unit, m) {
  m.alive = false;
  if (m.target) battle.removeBuff(m.target, markKey(unit));
}

/** S2's burst of mark `m`: (scale + n × factor) × ATK arts on the selectable enemies within MARK_RADIUS of the target. */
function burstMark(battle, unit, m, b2, atk = null) {
  if (!m.alive) return;
  m.alive = false;
  const t = m.target;
  battle.removeBuff(t, markKey(unit));
  const x = t.x, y = t.y;
  const amount = (atk ?? unit.s.atk) * (num(b2.default_atk_scale) + m.n * num(b2.factor_atk_scale));
  battle.fx('explode', { x, y, r: MARK_RADIUS, id: unit.id, dmgType: 'arts', skill: 'lmlee_2', n: m.n });
  if (!(amount > 0)) return;
  for (const e of battle.foesInRadius(x, y, MARK_RADIUS, true)) {
    if (e.alive) battle.dealDamage(unit, e, { amount, type: 'arts', isSkill: true, tags: ['skill', BURST_TAG] });
  }
}

export default {
  char_322_lmlee: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 和气生财 (MER-Y stage 2+: its change)
    const t1 = talentBb(chess, 1);   // 有备无患 (MER-X stage 2+: its change)
    const hidden = moduleBb(chess);  // MER-Y: atk / max_stack_cnt per trait payment
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const tauntLv = num(b2.taunt_level, 1);
    const maxN = Math.max(1, Math.floor(num(b2.max_stack_cnt, 20)));
    return {
      skills: {
        [S1]: { kind: 'toggle', trigger: { rule: 'SP_FULL' }, mods: { atkPct: num(b1.atk), dodgeArts: num(b1.prob) } },
        [S2]: {
          kind: 'instant',
          // "主动开启：标记目标": the target of the attack he is about to make (the basic strategy casts on that attack)
          onStart({ battle, unit }) {
            const t = acquireTargets(battle, unit, effectiveProfile(unit)).find((e) => e && e.side === 'enemy' && e.alive);
            if (!t) return;
            const prev = unit.mem.lmleeMark;
            if (prev && prev.alive) burstMark(battle, unit, prev, b2);   // ③ cast again before the mark ends
            const m = { target: t, n: 0, alive: true, atk: unit.s.atk };
            unit.mem.lmleeMark = m;
            const dur = num(b2.paper_duration, 5);
            battle.addBuff(t, { key: markKey(unit), duration: dur + 0.1, mods: tauntLv ? { taunt: tauntLv } : null, source: unit, tags: ['skill'] });
            battle.fx('mark', { x: t.x, y: t.y, id: t.id, src: unit.id, skill: 'lmlee_2' });
            battle.after(dur, () => burstMark(battle, unit, m, b2), { owner: unit });
          },
        },
        [S3]: {
          kind: 'toggle',
          trigger: { rule: 'SP_FULL' },
          mods: { atkPct: num(b3.atk), defPct: num(b3.def), taunt: num(b3.taunt_level) },
          targeting: { rangeGrid: s3?.rangeGrid ?? X4 },
      onStart({ battle, unit }) {
        battle.addBuff(unit, { key: 'lmlee:outsideDodge', tags: ['skill'], injury(c) {
          if (c.type !== 'phys' && c.type !== 'arts') return;
          if (c.source && bodyInRange(c.source, unit.rangeKeySet ?? new Set(unit.rangeKeys ?? []))) return;
          c.dodge(num(b3.prob));
        } });
      },
      onEnd({ battle, unit }) { battle.removeBuff(unit, 'lmlee:outsideDodge'); },
          attack: {
            // "攻击小力度推开范围内除当前目标外的敌人"
            onHit({ battle, unit, target }) {
              const p = num(b3['attack@prob_knockback'], 1), force = num(b3['attack@force'], 0);
              if (!(p > 0) || (p < 1 && !battle.rng.chance(p))) return;
              for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
                if (e !== target && e.alive) battle.push(e, force, { from: unit });
              }
            },
          },
        },
      },
      talents: [
        { install(battle, unit) { // 和气生财: while blocking — the blocked enemy ASPD −, his own +; ×2 with one enemy around
          const foe = num(t0['lmlee_t_1[enemy].attack_speed']), self = num(t0['lmlee_t_1[self].attack_speed']);
          const alone = Math.max(1, Math.floor(num(t0.cnt, 1)));
          if (!foe && !self) return;
          const selfKey = 'talent:lmlee:self', foeKey = `talent:lmlee:foe:${unit.id}`;
          battle.on('tick', () => {
            const blocked = up(unit) ? unit.blocking.filter((e) => e && e.alive) : [];
            if (!blocked.length) {
              if (unit.findBuff(selfKey)) battle.removeBuff(unit, selfKey);
              return;
            }
            const around = new Set(absoluteRangeKeys(X4, unit.tileR, unit.tileC, unit.dir, 0));
            let n = 0;
            for (const e of battle.enemies) if (e.alive && !e.hidden && bodyInRange(e, around)) n++;
            const k = n === alone ? 2 : 1;
            const cur = unit.findBuff(selfKey);
            if (self && (!cur || cur.mods?.aspd !== self * k)) battle.addBuff(unit, { key: selfKey, mods: { aspd: self * k }, tags: ['talent'] });
            if (foe) for (const e of blocked) battle.addBuff(e, { key: foeKey, duration: 0.1, mods: { aspd: foe * k }, source: unit, tags: ['talent'] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 有备无患: pay |extra_cost| for the guard; the guard cancels the next 晕眩 / 冻结
          const pay = Math.abs(num(t1.extra_cost)), stun = num(t1.stun);
          if (!(pay > 0)) return;
          battle.on('merchantPay', (ctx) => {
            if (ctx.unit !== unit || ctx.cancel || unit.findBuff(GUARD_KEY)) return;
            const pl = battle.getPlayer(unit.ownerId);
            if (!pl || pl.dp + 1e-9 < pay) return;   // "费用充足": DP ≥ the talent's cost
            ctx.cost = pay;
            battle.addBuff(unit, { key: GUARD_KEY, tags: ['talent'] });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, kind: 'lmlee' });
          }, { owner: unit, priority: 10 });
          battle.on('beforeStatus', (ctx) => {
            if (ctx.target !== unit || ctx.cancel || (ctx.status !== 'stun' && ctx.status !== 'freeze') || !unit.findBuff(GUARD_KEY)) return;
            ctx.cancel = true;
            battle.removeBuff(unit, GUARD_KEY);
            const src = ctx.source;
            if (stun > 0 && src && src.side === 'enemy' && src.alive) battle.applyStatus(src, 'stun', { duration: stun, source: unit });
            battle.fx('counter', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // MER-Y “但思善恶”: every trait payment ATK +atk (≤ max_stack_cnt) — counted when the payment goes through (after
        // 有备无患 set its cost)
        const ma = num(hidden.atk);
        if (ma > 0) {
          const cap = Math.max(1, Math.floor(num(hidden.max_stack_cnt, 5)));
          battle.on('merchantPay', (ctx) => {
            if (ctx.unit !== unit || ctx.cancel) return;
            const pl = battle.getPlayer(unit.ownerId);
            const c = Number.isFinite(ctx.cost) ? Math.max(0, ctx.cost) : 0;
            if (!pl || pl.dp < c) return;
            battle.addBuff(unit, { key: 'trait:lmlee:merY', refresh: 'stack', stacks: 1, maxStacks: cap, mods: { atkPct: ma }, tags: ['trait'] });
          }, { owner: unit, priority: -10 });
        }
        const sid = unit.skill?.id;
        if (sid === S2) {
          statBuff(battle, unit, 'skill:lmlee:s2passive', { aspd: num(b2.attack_speed) });  // "被动效果：攻击速度+15"
          // the mark: every damage instance of our side on it, its target's knock-out, his leaving the field
          battle.on('damaged', (ctx) => {
            const m = unit.mem.lmleeMark;
            if (!m || !m.alive || ctx.target !== m.target) return;
            const who = ctx.source ?? ctx.credit;
            const d = ctx.dmg;
            if (!who || who.side !== 'ally' || !d || ctx.type === 'element' || isHpLoss(d) || d.tags?.includes(BURST_TAG)) return;
            m.n = Math.min(maxN, m.n + 1);
            if (m.n >= maxN) burstMark(battle, unit, m, b2);
          }, { owner: unit, priority: -20 });
          battle.on('tick', () => {
            const m = unit.mem.lmleeMark;
            if (!m || !m.alive || !up(unit)) return;
            m.blocked = m.target.blockedBy === unit;   // read when he leaves (his block list is gone by then)
            m.atk = unit.s.atk;
          }, { owner: unit });
          battle.on('death', (ctx) => {
            const m = unit.mem.lmleeMark;
            if (!m || !m.alive) return;
            if (ctx.unit === m.target) {
              if (ctx.reason === 'killed') burstMark(battle, unit, m, b2);
              else dropMark(battle, unit, m);
            } else if (ctx.unit === unit) {
              // ① knocked out, ② leaving while blocking the marked enemy ⇒ bursts; else it vanishes
              if (ctx.reason === 'killed' || m.blocked) burstMark(battle, unit, m, b2, m.atk);
              else dropMark(battle, unit, m);
            }
          }, { owner: unit, priority: 5 });
        }

      },
    };
  },
};
