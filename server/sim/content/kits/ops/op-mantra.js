// server/sim/content/kits/ops/op-mantra.js — 真言 (char_4204_mantra) 自选 operator kit: 6★ 本源术师 (术师), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and the module (PRI-X) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4204_mantra, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, PRI-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json) and PRTS 真言 (the 备注
// quoted below). 麻痹 (ba.palsy, PRTS 术语释义): each stack interrupts one normal attack of an enemy, at most 3, kept until
// used — the engine `palsy` status; the moment a stack interrupts an attack is the engine hook `palsyTrigger` (ai.js).
// - Trait (本源术师) "攻击造成法术伤害，可以造成元素伤害": the profession default (ranged arts bolt, hits air units,
//   targetable by ground enemies); 元素伤害 = the DamageInfo type 'elemental', 神经 损伤 = element 'neural' (SIM.md §3). PRI-X
//   “中枢神经探测模块” "对处于元素爆发期间的敌人造成的伤害提升至110%" (trait bb damage_scale): ×damage_scale on every damage
//   she deals to an enemy in an element burst (shared/tier5.js burstDamageUp, as 烛煌 / 妮芙).
// - T1 噤声限域 "场上敌人触发麻痹效果时立即受到相当于真言攻击力135%的元素伤害，且触发麻痹时有10%概率不消耗麻痹层数" (full
//   potential: 145 % / 13 %; bb atk_scale / prob; PRI-X stage 3: 1.7 / 0.18): 备注 "触发麻痹时指的是敌人的攻击被麻痹打断时
//   （而非获得麻痹时）", "造成的元素伤害为元素持续伤害" (tagged 'dot'), "全场光环存在0.5秒检测周期，单位无法被真言选择的情况下
//   将失去效果" (every 0.5 s the enemies she can select — not untargetable, 隐匿 or asleep; "三技能期间，此天赋的检测无视
//   隐匿与沉睡" — carry her mark), "麻痹不消耗效果在同类效果中取概率最高" (two 真言: one roll at the higher chance; each deals
//   her own hit [ASSUMED]).
// - T2 全局洞悉 "距离真言最近的一个侵入点出场的敌人出现时立刻获得1层麻痹": at each deployment she picks the 侵入点 (the
//   stage's 'start' tiles) nearest by Manhattan distance, a tie drawn at random (备注 "优先选取距离自身曼哈顿距离最近的侵入点，
//   相同距离下随机选取"); every enemy spawning on it gets 1 麻痹 0.1 s later (备注 "【延迟麻痹】：0.1s后获得1层麻痹；付与选取
//   无视隐匿").
// - S1 共鸣溃缩 (AUTO, attack SP, data DEFAULT): the next attack deals atk_scale × ATK arts, then ep_damage_ratio of the
//   damage as 神经 损伤, then — on a target in its 神经 burst — element_atk_scale × ATK 元素伤害 (S2 备注 "伤害顺序为：法术伤害 →
//   神经损伤 → 元素伤害", the same riders).
// - S2 意识联协 (MANUAL, 25 s, data DEFAULT): attack interval base_attack_time (a flat −0.7 / −0.6 s); each attack deals
//   attack@atk_scale × ATK arts and jumps to chain_times other enemies (attack@chain.atk_scale × ATK arts each), every hit
//   with the S1 riders at attack@ep_damage_ratio / attack@element_atk_scale. 备注 "跳跃半径2.0，首次跳跃开始后弹道速度降低至
//   3.2": each jump flies at 3.2 tiles/s to the nearest not-yet-hit enemy within 2.0 tiles [ASSUMED: nearest, as the
//   链术师]. The first shot keeps the engine's bolt (11 tiles/s; 备注 10).
// - S3 无言为真 (MANUAL, 40 s, data ACTIVE_RANGE on its 3-17): ATK +atk, attack@max_target targets; on her range (备注:
//   【反隐】 / the overflow by 碰撞判定 — an enemy's body —, 【麻痹付与】 by the enemy's tile) enemies lose 隐匿 (reveal) and
//   their 麻痹 cap falls to 2 (text "降为2"; no blackboard key): stacks above it, held when the cap falls or gained later, become
//   "溢出麻痹" (麻痹免疫 enemies count too — 备注 "仅为令麻痹失效": the stacks 真言 gives them are kept here); each one turns
//   into an 元素伤害 bounce of atk_scale × ATK — on the holder, then (chain_times) to the nearest other enemy within 2.0 tiles
//   at 3.2 tiles/s, max_target hits — one at once when gained and one every interval_projectile_trigger s after, all of them
//   at once when the holder leaves the range, falls or the skill ends (备注). 【麻痹付与】: 0.1 s after the cast and whenever
//   another operator on her range starts a skill, every enemy on her range gets per_active 麻痹, max_trigger_cnt times per
//   cast, a grant with no enemy there kept (备注 "在范围内不存在可选敌方单位时保留可付与次数").

import { num, talentBb, traitBb, skillRec, batMod, up, once } from '../shared/tier1.js';
import { elementDmg } from '../shared/tier6.js';
import { burstDamageUp } from '../shared/tier5.js';
import { hasHp } from '../../../attack.js';
import { canTargetEnemy, enemyStealthed } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { COLS, PALSY_MAX } from '../../../constants.js';
import { burstLimit } from '../../../../../shared/plugins/steps.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_mantra_1';
const S2 = 'skchr_mantra_2';
const S3 = 'skchr_mantra_3';
const ANY = Object.freeze({ canHitFly: true });
/** 意识联协 / 无言为真 备注: "跳跃半径2.0", "速度3.2，弹射半径2.0". */
const JUMP_RADIUS = 2.0;
const JUMP_SPEED = 3.2;
/** 无言为真 "麻痹层数上限降为2" (text only). */
const S3_CAP = 2;
/** 无言为真 备注 "【麻痹付与】效果在自身技能开启后的0.1s触发一次". */
const GRANT_DELAY = 0.1;
/** 噤声限域 备注 "全场光环存在0.5秒检测周期". */
const MARK_IV = 0.5;
const MARK = 'mantra:hush:';
/** 全局洞悉 备注 "0.1s后获得1层麻痹". */
const SPAWN_DELAY = 0.1;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const palsyImmune = (e) => !!e?.def?.immune?.has?.('palsy');
/** 麻痹 stacks of an enemy — a 麻痹免疫 one keeps the ineffective stacks 真言 gave it in `mem.mantraPalsy`. */
const palsyOf = (e) => (palsyImmune(e) ? (e.mem.mantraPalsy ?? 0) : (e.findBuff('palsy')?.stacks ?? 0));
function setPalsy(battle, e, n) {
  if (palsyImmune(e)) { e.mem.mantraPalsy = n; return; }
  const b = e.findBuff('palsy');
  if (!b) return;
  if (n <= 0) battle.removeBuff(e, b);
  else { b.stacks = n; e.markDirty(); }
}
// 【麻痹付与】 takes the enemy's tile (PRTS 备注: 格子判定), unlike the reveal and the overflow (碰撞判定: bodyInRange)
const tileIn = (e, set) => set.has(Math.round(e.y) * COLS + Math.round(e.x));

/** The S1 / S2 riders: share × the damage dealt as 神经 损伤, then elemScale × ATK 元素伤害 on a target in its 神经 burst. */
function riders(battle, unit, t, dealt, share, elemScale) {
  if (!t || t.side !== 'enemy') return;
  if (share > 0 && dealt > 0) elementDmg(battle, unit, t, 'neural', dealt * share, ['skill', 'mantra']);
  if (elemScale > 0 && hasHp(t) && t.findBuff('neuralBurst')) {
    battle.dealDamage(unit, t, { amount: unit.s.atk * elemScale, type: 'elemental', element: 'neural', canDodge: false, isSkill: true, tags: ['skill', 'mantra'] });
  }
}

/** The nearest enemy within `r` of (x, y) that `unit` can select, none of `skip`. */
function nearestFoe(battle, unit, x, y, r, skip) {
  let best = null, bd = Infinity;
  for (const e of battle.enemiesInRadius(x, y, r)) {
    if (skip.has(e) || !canTargetEnemy(unit, e, ANY)) continue;
    const d = hypot(e.x - x, e.y - y);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.spawnSeq < best.spawnSeq)) { bd = d; best = e; }
  }
  return best;
}

export default {
  char_4204_mantra: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const tb = traitBb(chess);   // PRI-X: damage_scale
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const s3On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S3 && unit.mem.mantraS3);

    /** 意识联协: `left` jumps from `from`, each to the nearest not-yet-hit enemy, at JUMP_SPEED. */
    function chain(battle, unit, from, hit, left, attackId) {
      if (left <= 0) return;
      const next = nearestFoe(battle, unit, from.x, from.y, JUMP_RADIUS, hit);
      if (!next) return;
      hit.add(next);
      battle.addProjectile({
        from: { x: from.x, y: from.y }, target: next, speed: JUMP_SPEED, visual: 'bolt', source: unit, hitDead: true,
        onHit: ({ target, x, y }) => {
          if (target && target.alive) {
            const d = battle.dealDamage(unit, target, { amount: unit.s.atk * num(b2['attack@chain.atk_scale'], 1), type: 'arts', isAttack: true, isSkill: true, tags: ['chain'], attackId });
            riders(battle, unit, target, d, num(b2['attack@ep_damage_ratio']), num(b2['attack@element_atk_scale']));
          }
          chain(battle, unit, target && target.alive ? target : { x, y }, hit, left - 1, attackId);
        },
      });
    }

    /** 无言为真: one 溢出麻痹 → an 元素伤害 bounce on `holder`, then to the nearest other enemy (chain_times jumps). */
    function bounce(battle, unit, holder) {
      const amount = unit.s.atk * num(b3.atk_scale);
      if (!(amount > 0)) return;
      const hit = new Set([holder]);
      const elem = (t) => battle.dealDamage(unit, t, { amount, type: 'elemental', element: 'neural', canDodge: false, isSkill: true, tags: ['skill', 'mantraOverflow'] });
      let left = Math.max(1, Math.floor(num(b3.max_target, 2)));
      if (holder.alive && hasHp(holder)) { elem(holder); left--; }
      battle.fx('mantraArc', { x: holder.x, y: holder.y, id: unit.id, target: holder.id });
      const jump = (from, jumps) => {
        if (jumps <= 0 || left <= 0) return;
        const next = nearestFoe(battle, unit, from.x, from.y, JUMP_RADIUS, hit);
        if (!next) return;
        hit.add(next);
        left--;
        battle.addProjectile({
          from: { x: from.x, y: from.y }, target: next, speed: JUMP_SPEED, visual: 'bolt', source: unit,
          onHit: ({ target }) => { if (target && target.alive) elem(target); if (target) jump(target, jumps - 1); },
        });
      };
      jump(holder, Math.max(0, Math.floor(num(b3.chain_times, 1))));
    }

    /** 溢出麻痹 gained by `e`: one turns into a bounce at once, the next one interval later. */
    function overflow(battle, unit, st, e, rec, n) {
      if (!(n > 0)) return;
      rec.over += n;
      rec.over--;
      rec.next = battle.time + num(b3.interval_projectile_trigger, 1.5);
      bounce(battle, unit, e);
    }
    /** `e` leaves the overflow (range, fall, skill end): every 溢出麻痹 left bounces at once. */
    function flush(battle, unit, e, rec) {
      let guard = 0;
      const limit = burstLimit(PALSY_MAX);
      while (rec.over > 0 && guard++ < limit) { rec.over--; bounce(battle, unit, e); } // loop-cap: burstLimit palsy
      if (rec.over > 0) rec.over = 0;
    }
    /** 真言's own 麻痹 (S3 grants, 全局洞悉): a 麻痹免疫 enemy keeps them (ineffective) for the overflow count. */
    function givePalsy(battle, unit, e, n) {
      if (!e.alive || !(n > 0)) return;
      if (!palsyImmune(e)) { battle.applyStatus(e, 'palsy', { value: n, source: unit }); return; }
      const owner = battle.allyUnits.find((a) => s3On(a) && a.mem.mantraS3.map.has(e));
      const cap = owner ? S3_CAP : PALSY_MAX;
      const cur = palsyOf(e);
      const add = Math.min(n, Math.max(0, cap - cur));
      e.mem.mantraPalsy = cur + add;
      if (owner && n > add) overflow(battle, owner, owner.mem.mantraS3, e, owner.mem.mantraS3.map.get(e), n - add);
    }
    /** 【麻痹付与】: per_active 麻痹 to every enemy on her range (by its tile); kept when there is none. */
    function grant(battle, unit) {
      const st = unit.mem.mantraS3;
      if (!st || st.grants <= 0 || !s3On(unit)) return;
      const set = unit.rangeKeySet;
      const foes = battle.enemies.filter((e) => e.alive && !e.hidden && set && tileIn(e, set));
      if (!foes.length) return;
      st.grants--;
      battle.fx('mantraGrant', { x: unit.x, y: unit.y, id: unit.id, n: foes.length });
      for (const e of foes) givePalsy(battle, unit, e, Math.max(1, Math.floor(num(b3.per_active, 1))));
    }

    return {
      skills: {
        [S1]: {
          kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1),
            onHit({ battle, unit, target, dealt }) { riders(battle, unit, target, dealt, num(b1.ep_damage_ratio), num(b1.element_atk_scale)); },
          },
        },
        [S2]: {
          kind: 'duration',
          mods: { batPct: batMod(b2.base_attack_time, chess) },
          attack: {
            atkScale: num(b2['attack@atk_scale'], 1),
            onEachHit({ battle, unit, target, dealt, kind, attackId }) {
              if (kind !== 'main' || !target) return;
              riders(battle, unit, target, dealt, num(b2['attack@ep_damage_ratio']), num(b2['attack@element_atk_scale']));
              chain(battle, unit, target, new Set([target]), Math.max(0, Math.floor(num(b2.chain_times))), attackId);
            },
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: s3?.rangeGrid ?? null, maxTargets: num(b3['attack@max_target'], 1) },
          onStart({ battle, unit, skill }) {
            const n = skill.activations;
            unit.mem.mantraS3 = { grants: Math.max(0, Math.floor(num(b3.max_trigger_cnt))), map: new Map() };
            battle.after(GRANT_DELAY, () => { if (skill.activations === n) grant(battle, unit); });
          },
          onTick({ battle, unit, dt }) {
            const st = unit.mem.mantraS3;
            const set = unit.rangeKeySet;
            if (!st || !set) return;
            const seen = new Set();
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || !bodyInRange(e, set)) continue;
              seen.add(e);
              // 【反隐】 (隐匿免疫) on her range
              if (e.s.flags.stealth) battle.applyStatus(e, 'reveal', { duration: 2 * dt + 0.05, source: unit });
              let rec = st.map.get(e);
              if (!rec) {
                rec = { over: 0, next: Infinity };
                st.map.set(e, rec);
                const cur = palsyOf(e);
                if (cur > S3_CAP) { setPalsy(battle, e, S3_CAP); overflow(battle, unit, st, e, rec, cur - S3_CAP); }
              } else if (rec.over > 0 && battle.time >= rec.next - 1e-9) {
                rec.over--;
                rec.next = battle.time + num(b3.interval_projectile_trigger, 1.5);
                bounce(battle, unit, e);
              }
            }
            for (const [e, rec] of [...st.map]) if (!seen.has(e)) { st.map.delete(e); flush(battle, unit, e, rec); }
          },
          onEnd({ battle, unit }) {
            const st = unit.mem.mantraS3;
            unit.mem.mantraS3 = null;
            if (st) for (const [e, rec] of st.map) flush(battle, unit, e, rec);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 噤声限域: her mark on every enemy she can select (0.5 s); a 麻痹 interrupt hits it
          const scale = num(t0.atk_scale), prob = num(t0.prob);
          if (!(scale > 0) && !(prob > 0)) return;
          battle.every(MARK_IV, () => {
            if (!up(unit)) return;
            const all = s3On(unit);   // 三技能期间: 隐匿 / 沉睡 do not hide an enemy from the check
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || !e.deployed || e.s.flags.untargetable) continue;
              if (!all && (e.s.flags.sleep || (e.s.flags.stealth && enemyStealthed(e)))) continue;
              battle.addBuff(e, { key: MARK + unit.id, duration: MARK_IV + 0.1, source: unit, data: { scale, prob } });
            }
          }, { owner: unit, immediate: true });
          once(battle, 'mantra:palsyTrigger', () => battle.on('palsyTrigger', (ctx) => {
            const e = ctx.enemy;
            let p = 0;
            for (const m of e.buffs.slice()) {
              if (typeof m.key !== 'string' || !m.key.startsWith(MARK) || !m.data) continue;
              const src = m.source;
              if (!up(src)) continue;
              if (m.data.scale > 0 && hasHp(e)) {
                battle.dealDamage(src, e, { amount: src.s.atk * m.data.scale, type: 'elemental', element: 'neural', canDodge: false, tags: ['talent', 'dot', 'mantraHush'] });
              }
              p = Math.max(p, m.data.prob);
              if (!e.alive) return;
            }
            if (p > 0 && battle.rng.chance(p)) ctx.keep = true;
          }));
        } },
        { install(battle, unit) { // 全局洞悉: the nearest 侵入点; its spawns get 1 麻痹 0.1 s later
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            let best = [], bd = Infinity;
            for (const [r, c] of battle.grid.specialTiles('start')) {
              const d = Math.abs(r - unit.tileR) + Math.abs(c - unit.tileC);
              if (d < bd) { bd = d; best = [[r, c]]; } else if (d === bd) best.push([r, c]);
            }
            unit.mem.mantraGate = best.length > 1 ? battle.rng.pick(best) : best[0] ?? null;
            if (unit.mem.mantraGate) battle.fx('mantraGate', { x: unit.mem.mantraGate[1], y: unit.mem.mantraGate[0], id: unit.id });
          }, { owner: unit });
          battle.on('enemySpawn', ({ enemy: e }) => {
            const g = unit.mem.mantraGate;
            if (!g || !up(unit) || Math.round(e.spawnY) !== g[0] || Math.round(e.spawnX) !== g[1]) return;
            battle.after(SPAWN_DELAY, () => givePalsy(battle, unit, e, 1));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // PRI-X: ×damage_scale on enemies in an element burst
        burstDamageUp(battle, unit, num(tb.damage_scale));
        // 无言为真: the 麻痹 cap 2 on her range; the stacks above it become 溢出麻痹
        battle.on('beforeStatus', (c) => {
          if (c.status !== 'palsy' || !s3On(unit) || !c.target || c.target.side !== 'enemy') return;
          const st = unit.mem.mantraS3;
          const rec = st.map.get(c.target);
          if (!rec) return;
          const n = Math.max(1, Math.floor(Number.isFinite(c.value) ? c.value : 1));
          const room = Math.max(0, S3_CAP - palsyOf(c.target));
          if (n <= room) return;
          if (room > 0) c.value = room; else c.cancel = true;
          overflow(battle, unit, st, c.target, rec, n - room);
        }, { owner: unit });
        // 【麻痹付与】 when another operator on her range starts a skill
        battle.on('skillStart', (ctx) => {
          const u = ctx.unit;
          if (u === unit || !u || u.kind !== 'op' || !s3On(unit) || !unit.rangeKeySet?.has(u.tileR * COLS + u.tileC)) return;
          grant(battle, unit);
        }, { owner: unit });
      },
    };
  },
};
