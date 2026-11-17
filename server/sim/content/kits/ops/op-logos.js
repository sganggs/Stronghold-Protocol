// server/sim/content/kits/ops/op-logos.js — 逻各斯 (char_4133_logos) 自选 operator kit: 6★ 中坚术师 (术师), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (CCR-Δ, CCR-Y) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4133_logos, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 逻各斯 (the
// 备注 quoted below). Every number is read from the record (`chess` / the skill blackboards); the few constants below exist
// only in the PRTS 备注.
// - Trait (中坚术师) "攻击造成法术伤害": the profession default (ranged arts bolt, hits air units, targetable by ground
//   enemies). CCR-Δ “来自河谷的笔盒” adds "造成法术伤害时附带相当于8%伤害的凋亡损伤" (hidden module talent
//   `ep_damage_ratio`): every arts damage he deals — attacks, the talent's extra hits, 殁亡's follow-up — fills 8 % of the
//   post-injury damage amount as 凋亡 损伤 (not the overkill-clamped HP delta; docs/SIM.md §7.2). CCR-Y “《语义范式百科》” adds
//   "普通攻击命中精英或领袖敌人时获得1点技力" (trait bb `sp`): +sp SP per normal-attack hit on an elite or leader enemy
//   (none while a timed skill runs — AK) and, per the 语汇演化 备注 "<Y模组>…可触发模组提供的额外特性", per talent hit too.
// - T1 语汇演化 "对一个目标发起攻击时，有40%几率额外对攻击范围内一个随机目标造成相当于攻击力60%的法术伤害并使其停顿0.8秒"
//   (full potential: 65 %; bb prob / atk_scale / sluggish): rolled for every target of each of his attacks and after a
//   successful 殁亡 execution, before selecting its follow-up target (logos_s_1 native action order). The extra hit lands
//   at once on a random targetable enemy of his current range
//   [ASSUMED: the attacked target can be drawn], then 停顿 (the engine `sluggish`) for `sluggish` s. 备注 "该天赋的触发不依赖
//   普通攻击，不受缴械类效果制约". CCR-Δ stage 2+: prob 0.5 / 0.6 and, on a target in its 凋亡 burst, `element_atk_scale` × ATK
//   元素伤害 after the arts hit (备注 "先造成法术伤害，后造成元素伤害"). CCR-Y stage 2+: `emit_count` 2 — 备注 "本质上是将该天赋
//   重复执行2次": two independent executions (each its own roll and random target).
// - T2 剜魂具辞 "攻击使目标在5秒内法术抗性-10且受到的法术伤害提高150点" (full potential: 165; bb duration / magic_resistance /
//   atk_addition): each of his attack hits gives the target, for `duration` s, RES `magic_resistance` and +`atk_addition` on
//   every arts damage it takes (备注 "在计算攻击倍率后、计算法术抗性前增加当次伤害", "可对当次伤害生效", "即使法术伤害的攻击力
//   为0也可生效"): added to the hit's pre-mitigation amount, the hit that applies it included. One instance per enemy whoever
//   applies it (同名效果: applyStrongest).
// - S1 殁亡 (AUTO, 持续时间无限 ⇒ toggle; the data's DEFAULT trigger — it acts on enemies): range 3-3, ATK +atk, and an aura
//   (备注 "光环效果，不依赖攻击行为"): every enemy of his range whose HP is below attack@kill_atk_scale × his ATK takes
//   attack@kill_damage (9999999) 无来源 true damage (备注 "无来源真实斩杀伤害"; no dodge), then another random enemy of his
//   range takes arts damage equal to the HP the first had left (备注: his T2 bonus applies, T1 rolls). At most one try per
//   enemy per entry into the range, and none ever again on an enemy that survived one (备注; a 频次 unit takes 1 HP, a
//   leader in a boss battle loses nothing to 限伤 — 备注 "卫戍协议的最终攻势Boss…只能以常规的“当前生命值”处理斩杀的触发").
// - S2 提喻 (MANUAL, 20 s, data DEFAULT): RES +magic_resistance; the attack locks one target (an instant hit, no bolt
//   [ASSUMED: a lock-on beam]) every attack@cooldown s whatever the attack speed (备注 "攻击间隔固定为0.5s"), each hit
//   attack@atk_scale_base + attack@atk_scale_delta × n of his ATK and the target's movement speed × (1 + attack@move_speed
//   × n), n = the hits made on it so far, at most attack@max_stack_cnt (备注 "线性提升" — 3× and 40 % after 5 s). A stun /
//   freeze, the target's fall or no attack for 0.1 s past the cadence (备注 "每0.1s，若自身未处于攻击状态，则退出锁定状态")
//   resets the lock and its slow; the next attack locks anew.
// - S3 延异视阈 (MANUAL, 30 s, data ACTIVE_RANGE on its 3-4): ATK +atk, attack@max_target targets, and every enemy
//   projectile whose position is on his range flies at projectile_move_scale × its speed (备注 "降低至0.05倍"; leaving the
//   range restores it) and is removed when the skill ends — not when he is disarmed then (备注 "受缴械类效果制约") nor when
//   he is knocked out [ASSUMED]. Every enemy projectile counts as 可变速 / 可消除 [ASSUMED]. The sim's projectiles live in
//   `battle.projectiles.list` (ProjectileSystem, server/sim/projectiles.js): the kit adjusts `speed` / `maxAge` there.

import { num, talentBb, moduleBb, traitBb, skillRec, up, giveSp } from '../shared/tier1.js';
import { isElite, elementDmg } from '../shared/tier6.js';
import { hasHp, isHpLoss } from '../../../attack.js';
import { COLS, ROWS } from '../../../constants.js';

const S1 = 'skchr_logos_1';
const S2 = 'skchr_logos_2';
const S3 = 'skchr_logos_3';
const ANY = Object.freeze({ canHitFly: true });
/** 剜魂具辞: the debuff on an enemy (one instance whoever applies it). */
const T2_KEY = 'logos:soulRend';
/** 提喻 备注 "每0.1s，若自身未处于攻击状态，则退出锁定状态": the lock ends 0.1 s after a missed attack. */
const LOCK_IDLE = 0.1;
/** Enemy projectiles slowed by a running 延异视阈 (projectile → { orig speed, by: Set of unit ids }); per projectile. */
const SLOWED = new WeakMap();

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileOf = (p) => {
  const r = Math.round(p.y), c = Math.round(p.x);
  return r >= 0 && r < ROWS && c >= 0 && c < COLS ? r * COLS + c : -1;
};
/** Enemy projectiles on the field (ProjectileSystem list: the sim's only projectile store). */
const enemyShots = (battle) => (battle.projectiles?.list ?? []).filter((p) => p && p.source && p.source.side === 'enemy');

/** 延异视阈: slow the enemy projectiles on `unit`'s range, restore those that left it. */
function slowShots(battle, unit, scale) {
  const set = unit.rangeKeySet;
  for (const p of enemyShots(battle)) {
    if (!p.speedChangeable) continue;
    let s = SLOWED.get(p);
    if (set && set.has(tileOf(p))) {
      if (!s) { s = { orig: p.speed, by: new Set() }; SLOWED.set(p, s); }
      s.by.add(unit.id);
      p.speed = s.orig * scale;
      p.maxAge = Math.max(p.maxAge, p.age + 1);   // a slowed shot never lands by age while it is held
    } else if (s && s.by.delete(unit.id) && !s.by.size) {
      p.speed = s.orig;
      SLOWED.delete(p);
    }
  }
}

/** 延异视阈 ends: clear the enemy projectiles on the range (unless disarmed / knocked out), release the rest. */
function endShots(battle, unit, clear) {
  const set = unit.rangeKeySet;
  let n = 0;
  if (clear && set && battle.projectiles) {
    const keep = [];
    for (const p of battle.projectiles.list) {
      if (p && p.removable && p.source && p.source.side === 'enemy' && set.has(tileOf(p))) { n++; SLOWED.delete(p); } else keep.push(p);
    }
    battle.projectiles.list = keep;
  }
  for (const p of enemyShots(battle)) {
    const s = SLOWED.get(p);
    if (s && s.by.delete(unit.id) && !s.by.size) { p.speed = s.orig; SLOWED.delete(p); }
  }
  if (n) battle.fx('bulletClear', { x: unit.x, y: unit.y, id: unit.id, n });
}

export default {
  char_4133_logos: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // CCR-Δ: ep_damage_ratio
    const tb = traitBb(chess);        // CCR-Y: sp
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1), s3 = skillRec(chess, S3);
    const lex = {
      prob: num(t0.prob), scale: num(t0.atk_scale), sluggish: num(t0.sluggish),
      elemScale: num(t0.element_atk_scale), emit: Math.max(1, Math.floor(num(t0.emit_count, 1))),
    };

    /** 语汇演化: `emit` executions, each a `prob` roll for a random enemy of his range. */
    function lexicon(battle, unit) {
      if (!(lex.prob > 0) || !(lex.scale > 0)) return;
      for (let k = 0; k < lex.emit; k++) {
        if (!up(unit) || !battle.rng.chance(lex.prob)) continue;
        const t = battle.rng.pick(battle.enemiesInKeys(unit.rangeKeys, unit, ANY));
        if (!t) continue;
        battle.fx('logosLexicon', { x: t.x, y: t.y, id: unit.id, target: t.id });
        battle.dealDamage(unit, t, { amount: unit.s.atk * lex.scale, type: 'arts', calculation: 'precomputed', tags: ['talent', 'logosLexicon'] });
        if (t.alive && lex.sluggish > 0) battle.applyStatus(t, 'sluggish', { duration: lex.sluggish, source: unit });
        if (lex.elemScale > 0 && hasHp(t) && t.findBuff('apoptosisBurst')) {
          battle.dealDamage(unit, t, { amount: unit.s.atk * lex.elemScale, type: 'elemental', element: 'apoptosis', calculation: 'precomputed', tags: ['talent', 'logosLexicon'] });
        }
      }
    }

  /** 殁亡's execution, talent trigger on death, then the independent inherited-HP follow-up. */
  function execute(battle, unit, e, st) {
    const left = e.hp;
    battle.fx('logosExecute', { x: e.x, y: e.y, id: unit.id, target: e.id });
    battle.dealDamage({ source: null, credit: unit, target: e, amount: num(b1['attack@kill_damage'], 9999999),
      type: 'true', ignoreCancelReasons: ['dodge', 'block', 'miss'], isSkill: true, tags: ['skill', 'execute'] });
    if (e.alive) st.spared.add(e.id); // survived (不死, 频次, 限伤 …): never tried again
    // Native CheckUnitAlive → IfNot → TriggerBuffsByKeys(logos_t_1), then a separate follow-up projectile.
    // [ASSUMED] Keep this kit's immediate talent/follow-up delivery; native projectile arrival order is not modeled.
    else lexicon(battle, unit);
    const t = battle.rng.pick(battle.enemiesInKeys(unit.rangeKeys, unit, ANY).filter((x) => x !== e));
    if (!t || !(left > 0)) return;
    battle.dealDamage(unit, t, { amount: left, type: 'arts', isSkill: true, tags: ['skill', 'logosPerish'] });
  }

    /** 提喻: end the lock (its slow leaves the target). */
    function unlock(battle, unit) {
      const L = unit.mem.logosLock;
      if (L && L.target) battle.removeBuff(L.target, `logos:lockSlow:${unit.id}`);
      unit.mem.logosLock = null;
    }
    const lockIv = num(b2['attack@cooldown'], 0.5);
    const base2 = num(b2['attack@atk_scale_base'], 1), delta2 = num(b2['attack@atk_scale_delta']);
    const maxN = Math.max(0, Math.floor(num(b2['attack@max_stack_cnt'])));
    const s2On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S2);

    return {
      skills: {
        [S1]: {
          kind: 'toggle',
          mods: { atkPct: num(b1.atk) },
          targeting: { rangeGrid: s1?.rangeGrid ?? null },
          onStart({ unit }) { unit.mem.logosExec = { tried: new Set(), spared: unit.mem.logosExec?.spared ?? new Set() }; },
          onTick({ battle, unit }) {
            const st = unit.mem.logosExec;
            if (!st || !up(unit)) return;
            const inRange = battle.enemiesInKeys(unit.rangeKeys, unit, ANY);
            const ids = new Set(inRange.map((e) => e.id));
            for (const id of st.tried) if (!ids.has(id)) st.tried.delete(id);   // left the range: a new entry may try again
            const thr = num(b1['attack@kill_atk_scale']) * unit.s.atk;
            for (const e of inRange) {
              if (st.tried.has(e.id) || st.spared.has(e.id) || !e.alive || !hasHp(e) || !(e.hp < thr)) continue;
              st.tried.add(e.id);
              execute(battle, unit, e, st);
              if (!up(unit)) return;
            }
          },
        },
        [S2]: {
          kind: 'duration',
          mods: { resFlat: num(b2.magic_resistance) },
          attack: {
            projectile: 'beam',
            atkScale: base2,
            // the hit's scale: base + delta × n (n = the hits already made on the locked target)
            dmgMul: (battle, unit, target) => {
              const L = unit.mem.logosLock;
              const n = L && L.target === target ? L.n : 0;
              return base2 > 0 ? (base2 + delta2 * n) / base2 : 1;
            },
            onEachHit({ battle, unit, target, kind }) {
              const L = unit.mem.logosLock;
              if (kind !== 'main' || !L || L.target !== target || !target.alive) return;
              L.n = Math.min(maxN, L.n + 1);
              const mul = Math.max(0, 1 + num(b2['attack@move_speed']) * L.n);
              battle.addBuff(target, { key: `logos:lockSlow:${unit.id}`, duration: lockIv + LOCK_IDLE + 0.2, source: unit, mods: { moveMul: mul } });
            },
          },
          onStart({ battle, unit }) { unlock(battle, unit); unit.mem.logosLockAt = null; },
          onAttack({ battle, unit }) { unit.mem.logosLockAt = battle.time; },
          onTick({ battle, unit }) {
            const L = unit.mem.logosLock;
            // a stun / freeze breaks the lock; so does no attack for LOCK_IDLE past the cadence
            if (L && (!unit.canAct || !L.target.alive || battle.time - unit.mem.logosLockAt > lockIv + LOCK_IDLE + 1e-9)) unlock(battle, unit);
            if (!unit.canAct) return;
            // 攻击间隔固定为0.5s: the next attack exactly lockIv after the last one (the engine counts atkCd down right after)
            const at = unit.mem.logosLockAt;
            if (at == null) { unit.atkCd = Math.min(unit.atkCd, lockIv); return; }
            const left = at + lockIv - battle.time;
            unit.atkCd = left > 1e-6 ? left + battle.dt : 0;
          },
          onEnd({ battle, unit }) { unlock(battle, unit); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: s3?.rangeGrid ?? null, maxTargets: num(b3['attack@max_target'], 1) },
          onTick({ battle, unit }) { slowShots(battle, unit, num(b3.projectile_move_scale, 1)); },
          onEnd({ battle, unit, reason }) { endShots(battle, unit, reason !== 'death' && !unit.s.flags.disarm); },
        },
      },
      talents: [
        { install(battle, unit) { // 语汇演化: every target of each of his attacks
          battle.on('attack', (ctx) => {
            if (ctx.attacker !== unit || !up(unit)) return;
            for (let i = 0; i < ctx.targets.length; i++) lexicon(battle, unit);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 剜魂具辞: native source calculation marks the target (before its target calculation / mitigation)
          const dur = num(t1.duration), res = num(t1.magic_resistance), add = num(t1.atk_addition);
          if (!(dur > 0) || !(add > 0 || res)) return;
          battle.on('damageCalculate', (ctx) => {
            if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy') return;
            battle.applyStrongest(ctx.target, T2_KEY, { duration: dur, value: add, source: unit, mods: value => ({ resFlat: res, artsAttackAddition: value }) });
          }, { owner: unit, priority: 10 });

        } },
      ],
      install(battle, unit) {
        // 提喻: keep attacking the locked target while it stays a target; a new lock otherwise
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !s2On(unit) || !ctx.targets.length) return;
          const L = unit.mem.logosLock;
          const prof = ctx.profile || unit.profile;
          if (L && L.target.alive) {
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
            if (cands.includes(L.target) || battle.blockedTargets(unit, prof).includes(L.target)) { ctx.targets = [L.target]; return; }
          }
          unlock(battle, unit);
          unit.mem.logosLock = { target: ctx.targets[0], n: 0 };
          ctx.targets = [ctx.targets[0]];
        }, { owner: unit });
        // CCR-Δ: 8 % of every arts damage as 凋亡 损伤
        const ep = num(hidden.ep_damage_ratio);
        if (ep > 0) {
          battle.on('damageApplied', ctx => {
            if (ctx.source !== unit || ctx.dmg.type !== 'arts' || ctx.target.side !== 'enemy') return;
            // Native logos_e_002_tr uses successful damage with assignRealDelta=false.
            elementDmg(battle, unit, ctx.target, 'apoptosis', ctx.amount * ep, ['trait', 'logosCcrd']);
          }, { owner: unit });
        }
        // CCR-Y: a normal-attack (or 语汇演化) hit on an elite / leader enemy gives SP
        // [ASSUMED] Keep legacy zero/full-shield trigger behavior until the native Y event is established.
        const sp = num(tb.sp);
        if (sp > 0) {
          battle.on('damaged', (ctx) => {
            const d = ctx.dmg;
            if (ctx.source !== unit || !d || isHpLoss(d) || ctx.type === 'element' || !ctx.target || ctx.target.side !== 'enemy') return;
            if ((d.isAttack || (d.tags || []).includes('logosLexicon')) && isElite(ctx.target)) giveSp(unit, sp, 'trait');
          }, { owner: unit });
        }
      },
    };
  },
};
