// server/sim/content/kits/ops/op-chen3.js — 赤刃明霄陈 (char_1050_chen3) 自选 operator kit: 6★ 术战者 (近卫), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module (AFT-X) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1050_chen3, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, AFT-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); the client's battle
// logic — buff_template_data (chen3_t2 / [timer] / [evade], chen3_s1[derived_silence], chen3_s2[dead_listener] /
// [record_position] / [try_resapwn] / [respawn_buff], chen3_s3[ensure_dmg] / [finish_projectile]), her charpack (talent 1
// chen3_t1 + common_weak_damage; S1 attack `_additionalTimes` 1; S3 attack `_additionalTimes` 2, ground selector), the
// skill prefabs (skchr_chen3_2 S2MultiMeleeAttack: `_triggerDelta` 0.4, `s2_extend_time` 0.4 / `s2_times_add_one` 1 per
// lost target; skchr_chen3_3: the sword wave) and projectile_chr_chen3_s3 (speed 1.5, no lifetime of its own — ended by
// the skill —, `_hitDistance` 0.25, turns at high ground / map edge / 侵入点 / 保护目标, clears its hit list when it turns)
// — and PRTS 赤刃明霄陈 (talent 1 修正 "造成的物理和法术伤害变为弱点伤害"; talent 2 备注 "闪避优先级为-1000，不可叠加…二技能
// 移动时可继承闪避效果"; S2 / S3 备注), Terra wiki Ch'en the Dawnstreak (the wave's enemy hitbox 1.3).
// - Trait (术战者) "攻击造成法术伤害": the artsfghter profile (melee arts, ground only), range 1-1, blocks 1. Module AFT-X
//   “记忆残页” adds "未阻挡敌人时攻击速度+8" (trait attack_speed): ASPD + while she blocks nobody.
// - T1 形意洞照 "攻击力+13%，攻击速度+13，造成的物理和法术伤害变为弱点伤害" (PRTS 修正; full potential: +16% / +16): a permanent ATK /
//   ASPD buff, and every physical or arts damage instance she deals becomes 弱点伤害 (ba.weaknessatk "根据目标防御力和法术抗性变更伤害类
//   型"): the type the target resists less (items/battle.js weaknessRetype, as 双模机械臂 / 陈's band 以己之长).
// - T2 寒暑觉知 "未受到伤害时，每N秒随机治疗自身一定（攻击力的X%~Y%）生命值，并闪避下次物理与法术攻击": a counter +1 every
//   second (chen3_t2[timer]: triggerInterval 1, the first a second in), back to 0 with every damage instance she takes
//   (ON_APPLIED_MODIFIER IsDamage: not a 流失, not an element fill; a dodged hit lands nothing); at stack_time it restarts and
//   she heals herself ATK × a random whole percent in [heal_atk_scale_min, heal_atk_scale_max) (RandomSetter, PRTS
//   "最小单位为1%") and holds one dodge (chen3_t2[evade]: STACK, maxStackCnt 1 — "不可叠加") that cancels the next physical
//   or arts damage instance that can be dodged (Evade PHYSICAL_AND_MAGICAL), then is spent. Its priority is −1000 (PRTS;
//   onEventPriority LOW_PRIORITY): her other dodges (S2's) are rolled first, and the held dodge is kept when one of them
//   wins. S2's 【移动】 keeps it (PRTS "二技能移动时可继承闪避效果") — and the counter, as the engine's 【移动】 keeps the rest
//   (DESIGN §22.3). AFT-X stage 2+: the module talent's numbers (stage 3 at full potential: 6 s, 55 %–205 %).
// - S1 赤霄·奔夜 (MANUAL, data DEFAULT): ATK +atk for `duration` s, every attack hits twice (二连击) and 特殊能力失效 — 沉默 —
//   its target until the skill ends (chen3_s1[derived_silence]: derived from the skill's holder buff, independentCharacter
//   Source): the status for the skill's time left; an early end (she leaves) lifts the ones she set.
// - S2 赤霄·绝影-驰 (MANUAL, 技能范围 x-1, data SKILL_RANGE): she slashes the nearest enemy she can select in the x-1 (air units
//   too) `times` (10) times, 0.4 s apart, for atk_scale × ATK arts each (the first at the cast [ASSUMED], so the slashing lasts
//   0.4 s × its slashes); a target that leaves the field (or hides [ASSUMED]) hands the slashes to the selectable enemy
//   nearest it within 1.7 of it, else in her x-1, and adds one slash (+0.4 s); with nobody to select the slashing ends.
//   Meanwhile (PRTS): 无敌, 不可阻挡 (she blocks nothing), 阻回, 静默, stun / freeze immunity, no normal attack. Then always a
//   【移动】 (Battle.moveRedeploy): onto the tile its last target stood on at its last slash (record_position) when that target
//   still stands and the tile takes a melee operator, else back onto her own tile (PRTS "否则返回原位置"); the move's own
//   travel and deploy clip (Start_2, 1 s) are not modelled [ASSUMED: instant, as every deployment of the engine]. From
//   then the `duration` (6 s, "不包括斩击所耗时间"): ATK +respawn_buff.atk and respawn_buff.prob physical and arts dodge.
// - S3 赤霄·天喟 (MANUAL, data ACTIVE_RANGE on its 3-12): range 3-12, every attack hits up to attack@max_target ground enemies
//   three times (`_additionalTimes` 2) for attack@atk_scale × ATK arts, `duration` s. At the cast a sword wave leaves her
//   tile in her direction at 1.5 tiles/s and roams until the skill ends (FinishManagedProjectiles) or she leaves: when its
//   leading edge (0.25 ahead) would enter a high tile, the map's edge — the battle's field [ASSUMED: a battle's map is its
//   field, the stage tiles beyond it are another player's half] —, an 侵入点 or a 保护目标 it turns 90° clockwise (four
//   turns at most per tick; boxed in on every side it waits) and forgets whom it hit; each enemy it can select within 1.3
//   (air too) is hit once per straight run for the larger of hp_ratio × its current HP (the unit's own HP, PRTS) and
//   projectile_min_atk_scale × her ATK at the hit, arts (RES applies — PRTS "非伤害保底或无视法术抗性"; 普通伤害).
//   The wave is a kit-managed probe, not a snapshot projectile, so it is shown with `fx('chen3Wave')` events every
//   WAVE_FX_EVERY s (its position, the previous point and its direction — render/fx 'qi': a procedural blade trail with
//   a crescent head, not the official particle prefab); before that the 龙剑气 had no visual at all (PR #382). Her
//   begin clips (S1 0.2 s, S3 0.433 s) are not modelled [ASSUMED: the engine starts skills at once].

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, up } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { bodyDist } from '../../../body.js';
import { isHpLoss } from '../../../damage.js';
import { weaknessRetype } from '../../items/battle.js';

const S1 = 'skchr_chen3_1';
const S2 = 'skchr_chen3_2';
const S3 = 'skchr_chen3_3';
/** The skill ranges when a record carries none (data: x-1, 3-12). */
const X_1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
const R3_12 = Object.freeze([[1, 0], [1, 1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1]]);
/** skchr_chen3_2 S2MultiMeleeAttack `_triggerDelta` / dead_listener `s2_extend_time`: the time per slash. */
const SLASH_IV = 0.4;
/** PRTS S2 备注: a lost target hands over to "该目标半径1.7范围内的另一个目标". */
const RETARGET_RADIUS = 1.7;
/** projectile_chr_chen3_s3: speed; its terrain probe (`_hitDistance`); Terra wiki: its enemy hitbox. */
const WAVE_SPEED = 1.5;
const WAVE_PROBE = 0.25;
const WAVE_HIT_RADIUS = 1.3;
/**
 * How often the wave's position is sent to the client as an `fx` (`chen3Wave`, carrying the previous point and its
 * direction). The wave is a kit-managed probe (it turns corners and lives as long as the skill), so it is not in the
 * snapshot's projectile list: without these events the client has nothing to draw and the 龙剑气 is invisible (the cast
 * emitted one `dash` puff and each hit a `slash` spark). The rate is the renderer's: each event draws a short blade
 * trail whose life outlasts the gap, so the events join into one continuous wave.
 */
const WAVE_FX_EVERY = 0.12;
/** S1's early end: a silence of hers that ends within this of the skill's planned end ended with it. */
const SILENCE_SLACK = 0.1;
const AIR = Object.freeze({ canHitFly: true });
const DASH_KEY = 'skill:chen3:dash';
const AFTER_KEY = 'skill:chen3:respawn';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Absolute tile keys of a skill range at the unit's tile and facing (a 技能范围 ignores 攻击距离). */
const keysOf = (unit, grid) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
/** An S2 target that left the field — dead, removed or hidden [ASSUMED: a hidden one counts as gone]. */
const gone = (e) => !e || !e.alive || e.removed || e.hidden;
/** The enemy of `list` nearest to (x, y) (body distance; ties by spawn order), or null. */
function nearest(list, x, y) {
  let best = null, bd = Infinity;
  for (const e of list) {
    const d = bodyDist(e, x, y);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.spawnSeq < best.spawnSeq)) { bd = d; best = e; }
  }
  return best;
}
/** A tile S2's 【移动】 may land on: in the field, melee-deployable, free (her own tile aside), no operator lying there. */
function landable(battle, unit, r, c) {
  if (!Number.isInteger(r) || !Number.isInteger(c) || !battle.grid.inRect(r, c) || !battle.grid.canStand(r, c)) return false;
  if (battle.downOn(r, c)) return false;
  return (r === unit.tileR && c === unit.tileC) || !battle.isReservedTile(r, c);
}
/**
 * S3's wave turns before a high tile, the map's edge — the battle's field (`rect`): the official map of a battle is that
 * field, the stage tiles beyond it (another player's half) are not part of it —, an 侵入点 or a 保护目标.
 */
function waveBlocked(battle, w) {
  const r = Math.round(w.y + w.dr * WAVE_PROBE), c = Math.round(w.x + w.dc * WAVE_PROBE);
  if (!battle.grid.inRect(r, c)) return true;
  const t = battle.grid.tile(r, c);
  return t.height === 'HIGH' || t.special === 'start' || t.special === 'end';
}

export default {
  char_1050_chen3: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const grid2 = skillRec(chess, S2)?.rangeGrid ?? X_1, grid3 = skillRec(chess, S3)?.rangeGrid ?? R3_12;
    const slashes = Math.max(1, Math.floor(num(b2.times, 10)));

    /** S2: the selectable enemies (air too) she may slash next — around the lost target, else in her x-1. */
    const nextTarget = (battle, unit, from) => {
      const near = battle.foesInRadius(from.x, from.y, RETARGET_RADIUS).filter((e) => e !== from.e && canTargetEnemy(unit, e, AIR));
      if (near.length) return nearest(near, from.x, from.y);
      const inRange = battle.enemiesInKeys(keysOf(unit, grid2), unit, AIR).filter((e) => e !== from.e);
      return nearest(inRange, from.x, from.y);
    };
    /** S2: the slashing is over — the 【移动】, then the 6 s state. */
    const landS2 = (battle, unit, skill, m) => {
      battle.removeBuff(unit, DASH_KEY);
      m.phase = 2;
      const keep = m.target && !m.lost && !gone(m.target) && m.at;
      const [r, c] = keep && landable(battle, unit, m.at[0], m.at[1]) ? m.at : [unit.tileR, unit.tileC];
      battle.moveRedeploy(unit, r, c);
      battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, skill: 'chen3:respawn' });
      if (!unit.alive || !skill.active) return;
      const p = num(b2['chen3_s2[respawn_buff].prob']);
      battle.addBuff(unit, { key: AFTER_KEY, mods: { atkPct: num(b2['chen3_s2[respawn_buff].atk']), dodgePhys: p, dodgeArts: p }, tags: ['skill'] });
      skill.timeLeft = Math.max(0.01, skill.duration);
    };
    /** S2: one slash on the current target; a target that falls hands over (+1 slash) or ends the slashing. */
    const slash = (battle, unit, m) => {
      const e = m.target;
      m.n++;
      m.at = [Math.round(e.y), Math.round(e.x)];           // record_position (each slash)
      battle.fx('slash', { x: e.x, y: e.y, id: unit.id, n: 1, skill: 'chen3:slash' });
      battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'chen3:slash'] });
    };
    /** S2: the current target left — retarget (+1 slash, +0.4 s) or end the slashing (it was lost). */
    const handOver = (m, battle, unit) => {
      const from = { e: m.target, x: m.target.x, y: m.target.y };
      const next = nextTarget(battle, unit, from);
      if (!next) { m.lost = true; return false; }
      m.target = next;
      m.lost = false;
      m.hits++;
      return true;
    };

    return {
      // S2's slashes replace her attacks
      trait: { canAttack: (b, u) => !(u.mem.chen3S2 && u.mem.chen3S2.phase === 1) },
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { atkPct: num(b1.atk) },
          attack: {
            hits: 2,                                         // 二连击
            onHit({ battle, unit, skill, target }) {         // 特殊能力失效 until the skill ends
              if (!target || !target.alive || target.side !== 'enemy' || !skill.active) return;
              if (battle.applyStatus(target, 'silence', { duration: Math.max(0.01, skill.timeLeft), source: unit })) unit.mem.chen3S1Silenced?.add(target);
            },
          },
          onStart({ battle, unit, skill }) { unit.mem.chen3S1End = battle.time + skill.timeLeft; unit.mem.chen3S1Silenced = new Set(); },
          onEnd({ battle, unit, reason }) {
            const hit = unit.mem.chen3S1Silenced;
            unit.mem.chen3S1Silenced = null;
            if (reason === 'duration' || !hit) return;
            // an early end lifts the silences she set (derived from the skill: _finishDerivedBuffIfParentFinish) — the ones
            // that would have ended with it (a tick of slack: the status and the skill count down in different phases)
            const left = num(unit.mem.chen3S1End) - battle.time + SILENCE_SLACK;
            for (const e of hit) {
              for (const s of [...e.buffs]) if (s.key === 'silence' && s.source === unit && s.timeLeft <= left) battle.removeBuff(e, s);
            }
          },
        },
        [S2]: {
          kind: 'duration',
          onStart({ battle, unit, skill }) {
            const m = unit.mem.chen3S2 = { phase: 1, t: 0, n: 0, hits: slashes, target: null, at: null, lost: false };
            battle.addBuff(unit, { key: DASH_KEY, flags: { invulnerable: true, noBlock: true, noSp: true, silence: true }, tags: ['skill'] });
            battle.releaseBlocked(unit);
            m.target = nearest(battle.enemiesInKeys(keysOf(unit, grid2), unit, AIR), unit.x, unit.y);
            battle.fx('dash', { x: unit.x, y: unit.y, id: unit.id, skill: 'chen3:dash' });
            if (!m.target) landS2(battle, unit, skill, m);
          },
          onTick({ battle, unit, skill, dt }) {
            const m = unit.mem.chen3S2;
            if (!m || m.phase !== 1) return;
            skill.timeLeft = Math.max(0.01, skill.duration) + dt;   // the 6 s start after the move
            m.t += dt;
            if (gone(m.target) && !handOver(m, battle, unit)) { landS2(battle, unit, skill, m); return; }
            while (m.n < m.hits && m.t + 1e-9 >= SLASH_IV * m.n) {
              slash(battle, unit, m);
              if (!unit.alive || !skill.active) return;
              if (gone(m.target) && !handOver(m, battle, unit)) { landS2(battle, unit, skill, m); return; }
            }
            if (m.n >= m.hits && m.t + 1e-9 >= SLASH_IV * m.hits) landS2(battle, unit, skill, m);
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, DASH_KEY);
            battle.removeBuff(unit, AFTER_KEY);
            unit.mem.chen3S2 = null;
          },
        },
        [S3]: {
          kind: 'duration',
          targeting: { rangeGrid: grid3, maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 3))) },
          attack: { atkScale: num(b3['attack@atk_scale'], 1), hits: 3 },   // `_additionalTimes` 2
          onStart({ battle, unit, skill }) {
            const [dr, dc] = unit.fwd;
            unit.mem.chen3Wave = { x: unit.x, y: unit.y, dr, dc, hit: new Set(), act: skill.activations, seq: unit.deploySeq,
              fx: 0, fxX: unit.x, fxY: unit.y };
            battle.fx('dash', { x: unit.x, y: unit.y, id: unit.id, skill: 'chen3:wave' });
          },
          onEnd({ unit }) { unit.mem.chen3Wave = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 形意洞照: ATK / ASPD; every physical / arts damage of hers is 弱点伤害
          statBuff(battle, unit, 'talent:chen3:insight', { atkPct: num(t0.atk), aspd: num(t0.attack_speed) });
          battle.on('hit', (c) => { if (c.source === unit && c.target && c.target.side === 'enemy') weaknessRetype(c.dmg, unit, c.target); }, { owner: unit, priority: 5 });
        } },
        { install(battle, unit) { // 寒暑觉知: every stack_time s without damage: a random self-heal and one held dodge
          const st = Math.max(1, Math.floor(num(t1.stack_time, 7))), lo = num(t1.heal_atk_scale_min), hi = num(t1.heal_atk_scale_max, lo + 1);
          const fresh = () => ({ count: 0, acc: 0, evade: false });
          unit.mem.chen3T2 = fresh();
          // a 【移动】 (S2) keeps it — the dodge by PRTS, the counter as the engine's 【移动】 keeps the rest
          battle.on('deploy', (c) => { if (c.unit === unit && !c.move) unit.mem.chen3T2 = fresh(); }, { owner: unit });
          battle.on('tick', ({ dt }) => {
            const m = unit.mem.chen3T2;
            if (!up(unit) || !m) return;
            m.acc += dt;
            while (m.acc >= 1 - 1e-9) {
              m.acc -= 1;
              if (++m.count < st) continue;
              m.count = 0;
              m.evade = true;
              const pct = lo + battle.rng.int(Math.max(1, Math.floor(hi - lo)));
              battle.heal(unit, unit, unit.s.atk * pct / 100, { self: true });
              battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, skill: 'chen3:evade' });
            }
          }, { owner: unit });
          battle.on('damaged', (c) => {
            const m = unit.mem.chen3T2;
            if (c.target !== unit || !m || !c.dmg || isHpLoss(c.dmg) || c.type === 'element') return;
            m.count = 0;
            m.acc = 0;
          }, { owner: unit });
          // the held dodge: after her other dodges (priority −1000), on a dodgeable physical / arts damage instance
          battle.on('hit', (c) => {
            const m = unit.mem.chen3T2, d = c.dmg;
            if (c.target !== unit || !m || !m.evade || !d || d.cancel || !d.canDodge || (d.type !== 'phys' && d.type !== 'arts')) return;
            const p = d.type === 'phys' ? unit.s.dodgePhys : unit.s.dodgeArts;
            if (!(p > 0 && battle.rng() < p)) m.evade = false;   // one of her other dodges first: then it is kept
            d.cancel = true;
            battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
            battle.emit('dodge', { source: c.credit ?? c.source, target: unit, dmg: d });
          }, { owner: unit, priority: -1000 });
        } },
      ],
      install(battle, unit) {
        // AFT-X “记忆残页”: 未阻挡敌人时攻击速度+8
        const as = num(tb.attack_speed);
        if (as) toggleBuff(battle, unit, 'trait:chen3:unblocked', () => unit.blocking.length === 0, { aspd: as });
        // S2: 眩晕 / 冻结 immunity while she slashes
        battle.on('beforeStatus', (c) => {
          if (c.target === unit && unit.mem.chen3S2 && unit.mem.chen3S2.phase === 1 && (c.status === 'stun' || c.status === 'freeze')) c.cancel = true;
        }, { owner: unit });
        // S3: the sword wave
        if (unit.skill?.id !== S3) return;
        // PRTS: the sword wave hits air, although her S3 normal attacks remain ground-only. Include those selectable
        // targets in the existing ACTIVE_RANGE automation. [ASSUMED] Use its expanded attack grid (plus permanent
        // range extension), not the wave's entire eventual route; operation cooldown / control checks stay shared.
        unit.skill.addTriggerRange(() => [{
          keys: absoluteRangeKeys(grid3, unit.tileR, unit.tileC, unit.dir, unit.s.baseRangeExtend || 0), profile: AIR,
        }]);
        const ratio = num(b3.hp_ratio), minScale = num(b3.projectile_min_atk_scale);
        battle.on('tick', ({ dt }) => {
          const w = unit.mem.chen3Wave;
          if (!w) return;
          const sk = unit.skill;
          if (!up(unit) || unit.deploySeq !== w.seq || !sk || !sk.active || sk.activations !== w.act) { unit.mem.chen3Wave = null; return; }
          for (let i = 0; i < 4 && waveBlocked(battle, w); i++) {   // turn 90° clockwise (row up, col right)
            const dr = w.dr;
            w.dr = 0 - w.dc;    // (`0 - x`: never a negative zero)
            w.dc = dr;
            w.hit.clear();
            w.fxX = w.x; w.fxY = w.y;   // the drawn trail starts again at the corner (no streak across the turn)
          }
          if (!waveBlocked(battle, w)) { w.x += w.dc * WAVE_SPEED * dt; w.y += w.dr * WAVE_SPEED * dt; }
          // the 龙剑气 itself: tell the client where it is now (and where it came from) so it can be drawn — while it
          // runs, while it is boxed in waiting, and after a turn (the direction comes along for the renderer)
          w.fx += dt;
          if (w.fx >= WAVE_FX_EVERY) {
            w.fx = 0;
            battle.fx('chen3Wave', { x: w.x, y: w.y, fromX: w.fxX, fromY: w.fxY, dr: w.dr, dc: w.dc, id: unit.id, skill: 'chen3:wave' });
            w.fxX = w.x; w.fxY = w.y;
          }
          for (const e of battle.foesInRadius(w.x, w.y, WAVE_HIT_RADIUS)) {
            if (w.hit.has(e) || !canTargetEnemy(unit, e, AIR)) continue;
            w.hit.add(e);
            const amount = Math.max(ratio * e.hp, minScale * unit.s.atk);
            battle.fx('slash', { x: e.x, y: e.y, id: unit.id, n: 1, skill: 'chen3:wave' });
            battle.dealDamage(unit, e, { amount, type: 'arts', isSkill: true, tags: ['skill', 'chen3:wave'] });
            if (!unit.alive || unit.mem.chen3Wave !== w) return;
          }
        }, { owner: unit });
      },
    };
  },
};
