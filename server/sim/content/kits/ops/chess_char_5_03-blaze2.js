// server/sim/content/kits/ops/chess_char_5_03-blaze2.js — 烛煌 (char_1040_blaze2) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';
import {
  AURA_IV, AURA_DUR, num, on, talent, traitBb, skillGrid, batPct, mods, isOp, selectedId, lazySkills, instantKind,
  skillRange, burstSpUp, elementHit, whileOn, burstDamageUp,
} from '../shared/tier5.js';

/** 烛煌 绝处重燃 "使附近的敌人晕眩" radius (tiles). PRTS 备注: 1.7. */
const NEARBY_RADIUS = 1.7;
/** 烛煌 S3 "攻击变为群体攻击": splash radius around the target (tiles). PRTS 技能3 备注 "攻击溅射半径1.7". */
const BLAZE_S3_SPLASH = 1.7;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 烛煌 — S3 众恶的焚场 (ammo): skill range 4-11 (the targets; the DEFAULT cast still needs an enemy in 3-1), ATK +,
  // BAT −1.3 s, "攻击变为群体攻击" = one target + a BLAZE_S3_SPLASH (1.7) splash around it (PRTS 备注 "攻击溅射半径1.7",
  // 中点判定 — so the fire reaches past the diamond; it used to hit every enemy inside it instead, community report E1
  // after 0.1.0), +attack@atk_scale ATK elemental damage to every enemy of the attack in a burn burst (main and splash),
  // dealt BEFORE the attack's own damage ("于攻击造成伤害前判定元素爆发并造成元素伤害": a 'hit' hook — so a hit that kills
  // or starts the burst keeps / does not get it); loses 3 % max HP/s; any burn burst on the field refills ammo_recover
  // bullets, never above the skill's ammo ("补充后的弹药数量无法超过上限"). Each landed bolt shows its splash (fx 'splash' r 1.7).
  // T1 熔点引爆: burn burst anywhere → 350 % ATK elemental damage to it + heal 12 % max HP. T2 绝处重燃: downed instead of
  // dying (6000 shield, no attack, no heal, 3 %/s regen) → revives at full HP and stuns nearby enemies.
  // Module (elite): ×damage_scale vs enemies in an element burst.
  // S1 炙手之援 (instant): the operator with the highest max HP in her range carries a fire aura for max_duration s —
  // every `interval` s the enemies within range_radius of it take atk_scale × her ATK arts + element_multiplier × that
  // damage as 灼燃损伤. S2 沸血燎原 (duration): skill range, BAT +0.9 s, ATK +, 3 targets; each attack costs
  // attack@hp_ratio of her max HP and leaves a burning tile under every target: ground enemies on it move −50 % and take
  // atk_scale × ATK arts + element_damage_scale × that as 灼燃损伤 per second (the tiles burn until the skill ends
  // [ASSUMED: no duration in the data]). Module PRI-Y (elite): SP +0.2/s while an enemy in range is in an element burst.
  chess_char_5_03_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const talentBbs = (chess?.talents || []).map((t) => t?.bb).filter((b) => b && typeof b === 'object');
    // 规程 default module: hidden talent { duration, atk } — 灼燃爆发后 10 秒攻击力 +10%. 盟约 has neither key.
    const meltBuff = talentBbs.find((b) => b.atk != null && b.duration != null && b.damage_scale == null) ?? {};
    // 规程 module 003 绝处重燃: a second index -1 { damage_scale, ep_damage_ratio, sp }. talent() keeps only the first -1.
    const rally = talentBbs.find((b) => b.damage_scale != null && b.ep_damage_ratio != null && b.sp != null) ?? {};
    const sid = selectedId(chess, def);
    const lose = num(bb.lose_hp_scale);
    const burnTiles = (battle, unit) => {
      const tiles = unit.mem.blazeTiles;
      if (!tiles || !tiles.size) return;
      unit.mem.blazeAcc2 = (unit.mem.blazeAcc2 ?? 0) + AURA_IV;
      const dmgTick = unit.mem.blazeAcc2 >= 1 - 1e-9;
      if (dmgTick) unit.mem.blazeAcc2 -= 1;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !bodyInKeys(e, tiles)) continue;
        battle.addBuff(e, { key: `blaze2:ground:${unit.id}`, duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + num(bb.move_speed)) } });
        if (!dmgTick) continue;
        const d = battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'blazeGround'] });
        if (d > 0 && e.alive) battle.dealDamage(unit, e, { type: 'element', element: 'burn', amount: d * num(bb.element_damage_scale), tags: ['skill', 'blazeGround'] });
      }
    };
    return {
      skills: lazySkills({
        skchr_blaze2_1: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            const t = battle.alliesInGrid(unit).filter((a) => isOp(a)).sort((a, b) => b.s.maxHp - a.s.maxHp || a.id - b.id)[0];
            if (!t) return;
            const r = num(bb.range_radius, 1.5);
            battle.addBuff(t, {
              key: `blaze2:aid:${unit.id}`, duration: num(bb.max_duration, 20), interval: Math.max(0.1, num(bb.interval, 1)), visible: true, data: { src: unit },
              onTick: ({ unit: x }) => {
                for (const e of battle.foesInRadius(x.x, x.y, r)) {
                  const d = battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'blazeAid'] });
                  if (d > 0 && e.alive) battle.dealDamage(unit, e, { type: 'element', element: 'burn', amount: d * num(bb.element_multiplier), tags: ['skill', 'blazeAid'] });
                }
              },
            });
            battle.fx('aoe', { x: t.x, y: t.y, id: unit.id, r, skill: 'blaze2Aid' });
          },
        }),
        skchr_blaze2_2: () => ({
          kind: 'duration',
          mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def, { maxTargets: Math.max(1, num(bb['attack@max_target'], 3)) }),
          attack: {
            onEachHit({ unit, target }) {
              if (target && target.side === 'enemy') unit.mem.blazeTiles?.add(Math.round(target.y) * COLS + Math.round(target.x));
            },
          },
          onStart({ unit }) { unit.mem.blazeTiles = new Set(); unit.mem.blazeAcc2 = 0; },
          onAttack({ battle, unit }) { battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio']), { source: unit }); },
          onEnd({ unit }) { unit.mem.blazeTiles = null; },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 18),
        mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        attack: {
          splashRadius: BLAZE_S3_SPLASH,
          // the fire of each landed bolt (the screen rings splash attacks by sub-profession; 本源术师 is not one): once
          // per attack at the main target / its spot — from the profile it was fired with, so the last bolt too
          onHit({ battle, unit, target, x, y }) {
            battle.fx('splash', { x, y, ...(target && target.alive ? { id: target.id } : {}), src: unit.id, r: BLAZE_S3_SPLASH, element: 'burn' });
          },
        },
        onStart({ unit }) { unit.mem.blazeAcc = 0; },
        onTick({ battle, unit, dt }) {
          if (!(lose > 0)) return;
          unit.mem.blazeAcc = (unit.mem.blazeAcc ?? 0) + dt;
          while (unit.mem.blazeAcc >= 1 && unit.alive) { // loop-cap: one-second step
            unit.mem.blazeAcc -= 1;
            battle.loseHp(unit, unit.s.maxHp * lose, { source: unit });
          }
        },
      },
      talents: [
        { install(battle, unit) { // 熔点引爆
          battle.on('elementBurst', (c) => {
            if (c.element !== 'burn' || !on(unit) || c.target.side !== 'enemy') return;
            elementHit(battle, unit, c.target, unit.s.atk * num(t0.ep_damage_scale), 'blazeMelt', 'burn');
            // 绝处重燃: "倒地期间…无法被治疗" — the meltdown heal does not reach her while downed
            if (!unit.mem.downed) battle.heal(unit, unit, unit.s.maxHp * num(t0.hp_ratio), { self: true });
            const buffAtk = num(meltBuff.atk), buffDur = num(meltBuff.duration);
            if (buffAtk > 0 && buffDur > 0 && on(unit)) battle.addBuff(unit, { key: 'blaze2:meltAtk', duration: buffDur, mods: { atkPct: buffAtk }, refresh: 'replace' });
            battle.fx('meltdown', { x: c.target.x, y: c.target.y, id: c.target.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 绝处重燃
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.downed = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented || unit.mem.downed) return;
            c.prevented = true;
            unit.mem.downed = true;
            unit.mem.blazeDownedThisHit = true;
            if (unit.skill?.active) unit.skill.end('downed');
            battle.releaseBlocked(unit);
            const dep = unit.deploySeq;
            battle.addBuff(unit, {
              key: 'blaze2:downed', visible: true, shield: num(t1.dynamic), interval: 0.2,
              flags: { disarm: true, noHeal: true },
              mods: mods({ hpRegenRatio: num(t1.hp_recovery_per_sec_by_max_hp_ratio), blockCnt: -99 }),
              onTick: ({ unit: u, buff }) => {
                if (u.deploySeq !== dep || u.hp < u.s.maxHp - 1e-6) return;
                battle.removeBuff(u, buff);
                u.mem.downed = false;
                for (const e of battle.foesInRadius(u.x, u.y, NEARBY_RADIUS)) if (e.alive) battle.applyStatus(e, 'stun', { duration: num(t1.stun), source: u });
                if (num(rally.sp) > 0 && u.skill) u.skill.gainSp(num(rally.sp), 'talent');
                battle.fx('revive', { x: u.x, y: u.y, id: u.id, r: NEARBY_RADIUS });
              },
            });
            battle.fx('downed', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -50 });
          // 规程 module 003: each hit taken while downed deals damage_scale × ATK arts, and ep_damage_ratio of that as burn.
          const scale = num(rally.damage_scale), ratio = num(rally.ep_damage_ratio);
          if (scale > 0) battle.on('damaged', (c) => {
            // fatal runs before damaged, so the hit that downs her is not yet "while downed".
            if (unit.mem.blazeDownedThisHit) { unit.mem.blazeDownedThisHit = false; return; }
            if (!unit.mem.downed || unit.mem.blazeRallying || c.target !== unit || !c.source || c.source.side !== 'enemy' || !c.source.alive) return;
            unit.mem.blazeRallying = true;
            try {
              const dealt = battle.dealDamage(unit, c.source, { amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'blazeRally'] });
              if (dealt > 0 && ratio > 0 && c.source.alive) battle.dealDamage(unit, c.source, { type: 'element', element: 'burn', amount: dealt * ratio, tags: ['talent', 'blazeRally'] });
            } finally {
              unit.mem.blazeRallying = false;
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        burstDamageUp(battle, unit, num(tb.damage_scale));
        burstSpUp(battle, unit, 'blaze2:module', num(tm.sp_recovery_per_sec));
        if (sid === 'skchr_blaze2_2') whileOn(battle, unit, AURA_IV, () => burnTiles(battle, unit));
        if (sid && sid !== 'skchr_blaze2_3') return;
        // S3: each hit of her skill attack (main and splash) on an enemy in a burn burst deals the bonus first (PRTS 备注).
        // Gated on the attack's own isSkill (captured when the bolt was fired), not on the live skill: her bolts land after
        // the last bullet's end('ammo') / an early end (downed), and those still carry it. Only S3 runs here (sid gate).
        battle.on('hit', (c) => {
          const d = c.dmg, t = c.target;
          if (c.source !== unit || !d.isAttack || !d.isSkill || d.cancel) return;
          if (t.side === 'enemy' && t.alive && t.findBuff('burnBurst')) elementHit(battle, unit, t, unit.s.atk * num(bb['attack@atk_scale']), 'blazeBurn', 'burn');
        }, { owner: unit });
        const maxAmmo = num(bb['attack@trigger_time'], 18);
        battle.on('elementBurst', (c) => { // S3: burn bursts refill ammo, up to the skill's ammo
          const sk = unit.skill;
          if (c.element !== 'burn' || !sk?.active || sk.kind !== 'ammo' || !on(unit)) return;
          const n = Math.min(num(bb.ammo_recover), maxAmmo - sk.ammoLeft);
          if (n > 0) sk.addAmmo(n);
        }, { owner: unit });
      },
    };
  },
};
