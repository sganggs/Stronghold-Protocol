// server/sim/content/kits/ops/chess_char_1_16-tinman.js — 锡人 (char_4151_tinman) kit, tier 1 (hidden).
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, moduleBb, enemiesInGrid, spTimeBonus, makeZone, instantKind } from '../shared/tier1.js';

import { damageAttackType } from '../../../attack.js';

/** Native tinman_t_2: ordinary ON_TAKE_DAMAGE, BUFF attack type only; strongest copy, never additive. */
export function refreshTinmanWither(battle, target, source, zone, duration, mul) {
  if (!(mul > 1)) return;
  const key = 'tinman:wither';
  const old = target.buffs.find(buff => buff.key === key && buff.data.zone === zone);
  if (old) { old.timeLeft = old.duration = duration; return old; }
  return battle.addBuff(target, { key, source, duration, refresh: 'independent', maxStacks: Number.MAX_SAFE_INTEGER,
    data: { mul, zone }, injury(c) {
      if (damageAttackType(c.dmg) !== 'BUFF') return;
      const strongest = target.buffs.filter(buff => buff.key === key)
        .reduce((best, buff) => !best || buff.data.mul > best.data.mul
          || buff.data.mul === best.data.mul && buff.seq < best.seq ? buff : best, null);
      if (c.buff === strongest) c.amount *= mul;
    } });
}

/** A landed unit owns its coverage and lifetime; caster departure cannot remove its effects. */
// [ASSUMED] Existing instant landing; native projectile travel is not simulated.
export function startTinmanCoverage(battle, source, { key, x, y, radius, duration, mul, regen = 0 }) {
  const held = new Map();
  const sync = () => {
    const covered = new Set();
    if (mul > 1) for (const target of battle.foesInRadius(x, y, radius)) {
      if (target.isFlying) continue;
      covered.add(target);
      held.set(target, refreshTinmanWither(battle, target, source, key, Infinity, mul));
    }
    if (regen > 0) for (const target of battle.alliesInRadius(x, y, radius, null)) {
      if (!battle.allySelectable(target, source)) continue;
      covered.add(target);
      if (!target.buffs.includes(held.get(target))) held.set(target,
        battle.addBuff(target, { key, source, mods: { hpRegen: regen } }));
    }
    for (const [target, buff] of held) if (!covered.has(target)) {
      battle.removeBuff(target, buff);
      held.delete(target);
    }
  };
  // [ASSUMED] Tick/pre-hit coverage follows the sim clock, not native selector polling.
  // Pre-hit synchronization also covers relocation between ticks.
  const hooks = mul > 1 || regen > 0 ? ['tick', 'hit'].map(event => battle.on(event, sync)) : [];
  source.mem.tinZones = (source.mem.tinZones ?? 0) + 1;
  battle.after(duration, () => {
    for (const hook of hooks) battle.off(hook);
    for (const [target, buff] of held) battle.removeBuff(target, buff);
    held.clear();
    source.mem.tinZones = Math.max(0, (source.mem.tinZones ?? 1) - 1);
  });
  sync();
  return sync;
}

// =================================================================================================================
// kit builders shared by two chess ids

/**
 * 锡人 “大拉里” (chess_char_1_16 hidden and chess_char_2_19): throw an alchemy unit at the current target —
 * for projectile_delay_time s, ground enemies within projectile_range tiles take atk_scale × ATK arts per second,
 * allies there recover hp_recovery_per_sec_ratio × ATK per second. Elite: 凋敝魂灵 (skill@damage_scale: damage-over-
 * time taken by ground enemies inside a unit ×1.2) and the module's +sp_recovery_per_sec SP while a unit exists.
 * PRTS 锡人 技能2 备注: the unit caches her ATK at the cast, several can exist and their effects add up, and "生命恢复的
 * 提供方式为增加目标的“生命回复速度”属性，不受治疗加成和禁疗影响" — an hpRegen buff per unit on the allies inside it
 * (no heal: 无法被友方治疗 / 禁疗 units get it too), held only while the ally is inside the live unit.
 */
export function tinmanKit(bb, chess, def) {
  const dur = num(bb.projectile_delay_time, 10);
  const radius = num(bb.projectile_range, 1.5);
  const dmgScale = num(bb.atk_scale);
  const healRatio = num(bb.hp_recovery_per_sec_ratio);
  const wither = num(talentBb(chess, 1)['skill@damage_scale'], 1);
  const spBonus = num(moduleBb(chess).sp_recovery_per_sec);
  return {
    skill: {
      kind: instantKind(def),
      onStart({ battle, unit }) {
        const tgt = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0] ?? enemiesInGrid(battle, unit, null, { n: 1 })[0];
        const x = tgt ? tgt.x : unit.x + unit.fwd[1], y = tgt ? tgt.y : unit.y + unit.fwd[0];
        const atk = unit.s.atk;
        const regenKey = `tinman:zone:${unit.id}:${unit.mem.tinZoneSeq = (unit.mem.tinZoneSeq ?? 0) + 1}`;
        const sync = startTinmanCoverage(battle, unit, { key: regenKey, x, y, radius, duration: dur,
          mul: wither, regen: atk * healRatio });
        makeZone(battle, unit, {
          x, y, radius, duration: dur, skill: 'tinman', onPulse(b) {
            sync();
            for (const e of b.foesInRadius(x, y, radius)) {
              if (e.isFlying || e.s.flags.untargetable) continue;
              b.dealDamage({ source: null, credit: unit, target: e, amount: atk * dmgScale, type: 'arts',
                attackType: 'BUFF', calculation: 'precomputed', isSkill: true, tags: ['dot', 'zone'] });
            }
          },
        });
      },
    },
    talents: [{ install(battle, unit) {
      spTimeBonus(battle, unit, spBonus, () => (unit.mem.tinZones ?? 0) > 0);
    } }],
  };
}

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_16 锡人 (hidden tier-1 entry of chess_char_2_19): see tinmanKit.
  chess_char_1_16_a: tinmanKit,
};
