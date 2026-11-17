// server/sim/content/kits/ops/chess_char_5_19-mlynar.js — 玛恩纳 (char_4064_mlynar) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import {
  num, on, inRange, talent, skillGrid, batPct, mods, inFaction, isOp, selectedId, lazySkills, skillRange, leaderOf,
  whileOn, permBuff,
} from '../shared/tier5.js';
import { installInjuryAura } from '../shared/injury.js';
import { damageAttackType, isHpLoss } from '../../../attack.js';

/** 玛恩纳 游侠 "周围存在3名及以上敌人" radius (8-neighbourhood). */
const AROUND_RADIUS = 1.5;
const isKazimierz = (u) => inFaction(u, 'kazimierzShip', ['kazimierz']);

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 玛恩纳 — librator (ramp to +200 % ATK while idle). S3 未照耀的荣光 (26 s, CUSTOM_RANGE): skill range, trait ×2, 5
  // targets at 125/150 % ATK phys, air units too (PRTS 备注 "※可对空"; player report B4 after 0.1.0: on a flying wave the
  // cast hit nothing for 26 s); enemies in range take +10/11 % of his ATK true damage from every Kazimierz attack. Per
  // PRTS 备注 the trait bonus drops by 10 % (per_kill_reduce, absolute: +400 % → +390 %) for each enemy knocked out by
  // his own attack (or the damage it carries — not 无动于衷's reflection, not a mark another operator's attack set off),
  // settled after that attack, never below +0 %. T1 游侠: ×1.1 ATK on attacks (×1.15 and −15 % damage taken with ≥3
  // enemies around). T2 无动于衷: taunt +1, Kazimierz ops reflect 15 % of his ATK as true damage when an enemy damages them.
  // S1 未声张的怒火 (duration, SEARCH): attacks attack@atk_scale × ATK, DEF +. S2 未宽解的悲哀 (duration): skill range,
  // BAT +0.3 s, attacks attack@atk_scale × ATK twice; a kill of his own attacks during the skill keeps the trait ramp
  // when it ends. S1 / S2 have no 对空 note: ground only, like his trait. S2's data rule is ACTIVE_RANGE on its 2-3 (the
  // owner's rule of 2026-10-05 over the 解放者 SEARCH row: an enemy he can target inside the 2-3 casts it).
  chess_char_5_19_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const up = num(bb.trait_up, 1), perKill = num(bb.per_kill_reduce);
    // S3: the trait bonus = ramp × trait_up + per_kill_reduce × kills, ≥ 0 — the trait's own ramp buff stays, the
    // difference goes into `mlynar:traitUp` (negative once the kills take the bonus below the ramp)
    const applyUp = (battle, unit) => {
      const ramp = num(unit.trait.ramp);
      const extra = unit.mem.mlyUp ? Math.max(0, ramp * up + perKill * num(unit.mem.mlyKills)) - ramp : 0;
      if (extra) battle.addBuff(unit, { key: 'mlynar:traitUp', mods: { atkPct: extra } });
      else battle.removeBuff(unit, 'mlynar:traitUp');
    };
    /**
     * "仅自身普通攻击（与该次攻击附带的伤害）击倒非角色类单位" (PRTS S2 / S3 备注): `onKill(victim)` for each enemy he
     * knocks out, while his skill runs, that his current attack hit (or the mark it set off, tagged 'mlynarOwn') — so a
     * kill by the damage that attack carries (天马之枪, the 卡西米尔 bond's true damage, the mark) counts too, in any
     * hook order; `onAttack()` after each of his attacks ("加成降低于当次攻击后统一结算"), which also closes the set.
     * 无动于衷's reflection and a mark another operator's attack set off happen outside his attack: never counted.
     */
    const ownKills = (battle, unit, onKill, onAttack = null) => {
      const hit = new Set();
      battle.on('damaged', (c) => {
        const dmg = c.dmg, parent = dmg?.origin, tags = dmg?.tags || [];
        const own = !isHpLoss(dmg) && (c.source === unit && (dmg?.isAttack || tags.includes('mlynarOwn'))
          || c.credit === unit && parent && !tags.includes('mlynarMark') && (parent.isAttack || parent.tags?.includes('mlynarOwn')));
        if (own) hit.add(c.target);
        // A nested reflection/another operator's mark is not carried damage of his attack.
        else if ((c.credit === unit && parent) || (c.source === unit && (tags.includes('reflect') || tags.includes('mlynarMark')))) hit.delete(c.target);
      }, { owner: unit, priority: 1000 });
      battle.on('kill', (c) => { if (c.killer === unit && hit.has(c.victim) && c.victim.side === 'enemy' && unit.skill?.active) onKill(c.victim); }, { owner: unit });
      battle.on('attack', (c) => { if (c.attacker !== unit) return; hit.clear(); if (onAttack) onAttack(); }, { owner: unit });
    };
    return {
      skills: lazySkills({
        skchr_mlynar_1: () => ({ kind: 'duration', mods: mods({ defPct: num(bb.def) }), attack: { atkScale: num(bb['attack@atk_scale'], 1) } }),
        skchr_mlynar_2: () => ({
          kind: 'duration', mods: mods({ batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: 2 },
        }),
      }),
      skill: {
        kind: 'duration',
        targeting: { ...(skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : {}), canHitFly: true },
        attack: { atkScale: num(bb['attack@atk_scale'], 1), maxTargets: Math.max(1, num(bb['attack@max_target'], 1)) },
        onStart({ battle, unit }) {
          unit.mem.mlyUp = true; unit.mem.mlyKills = 0; unit.mem.mlyPending = 0;
          applyUp(battle, unit);
          battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 2, skill: 'mlynar' });
        },
        onEnd({ battle, unit }) { unit.mem.mlyUp = false; unit.mem.mlyPending = 0; battle.removeBuff(unit, 'mlynar:traitUp'); },
      },
      trait: { dmgMul: (b, u) => (num(u.mem.mlyNear) >= num(t0.cnt, 3) ? num(t0.atk_scale_up, 1) : num(t0.atk_scale_base, 1)) },
      talents: [
        { install(battle, unit) { // 游侠
          const dr = num(t0.damage_resistance);
          whileOn(battle, unit, 0.2, () => {
            unit.mem.mlyNear = battle.foesInRadius(unit.x, unit.y, AROUND_RADIUS).length;
            if (dr > 0 && unit.mem.mlyNear >= num(t0.cnt, 3)) battle.addBuff(unit, { key: 'mlynar:ranger', duration: 0.3, mods: { dmgTakenMul: 1 - dr } });
          });
        } },
        { install(battle, unit) { // 无动于衷
          permBuff(battle, unit, 'mlynar:unmoved', { taunt: num(t1.taunt_level) });
          const scale = num(t1.atk_scale);
          if (!(scale > 0)) return;
          installInjuryAura(battle, unit, {
            key: `mlynar:reflection:${unit.id}`,
            // [ASSUMED] Retain the project's first living same-operator source policy for duplicate providers.
            covers: target => on(unit) && leaderOf(battle, unit) === unit && on(target)
              && target.side === 'ally' && isOp(target) && isKazimierz(target),
            effect: { observeInjury(c) {
              const src = c.source;
              if (!on(unit) || leaderOf(battle, unit) !== unit || src?.side !== 'enemy' || !src.alive) return;
              // [ASSUMED] InverseDamage's hidden cancellation defaults remain unverified; retain no dodge.
              battle.dealDamage({ source: unit, target: src, amount: unit.s.atk * scale, type: 'true',
                attackType: 'NORMAL', applyWay: 'NONE', calculation: 'precomputed', dodgeMode: 'ignore',
                ignoreSelect: true, tags: ['talent', 'reflect'] });
            } },
          });
        } },
      ],
      install(battle, unit) {
        if (sid === 'skchr_mlynar_2') {
          // 技能期间若击倒敌人，技能结束时特性效果不重置: the librator trait resets the ramp on skillEnd (priority 0) —
          // remember it before and put it back after
          battle.on('skillStart', (c) => { if (c.unit === unit) unit.mem.mlyKeep = false; }, { owner: unit });
          ownKills(battle, unit, () => { unit.mem.mlyKeep = true; });
          battle.on('skillEnd', (c) => {
            if (c.unit === unit) unit.mem.mlyRamp = unit.mem.mlyKeep && c.reason !== 'death' ? num(unit.trait.ramp) : null;
          }, { owner: unit, priority: 100 });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit || unit.mem.mlyRamp == null) return;
            unit.trait.ramp = unit.mem.mlyRamp;
            unit.mem.mlyRamp = null;
            if (unit.trait.ramp > 0 && unit.alive) battle.addBuff(unit, { key: 'trait:libratorRamp', mods: { atkPct: unit.trait.ramp } });
          }, { owner: unit, priority: -100 });
        }
        if (sid && sid !== 'skchr_mlynar_3') return;
        ownKills(battle, unit, () => { unit.mem.mlyPending = num(unit.mem.mlyPending) + 1; }, () => {
          if (!unit.mem.mlyPending || !unit.mem.mlyUp) return;
          unit.mem.mlyKills = num(unit.mem.mlyKills) + unit.mem.mlyPending;
          unit.mem.mlyPending = 0;
          applyUp(battle, unit);
        });
        const extra = num(bb.atk_scale);
        if (!(extra > 0)) return;
        installInjuryAura(battle, unit, {
          key: `mlynar:mark:${unit.id}`, targets: () => battle.enemies,
          covers: target => on(unit) && unit.skill?.active && target.side === 'enemy' && on(target) && inRange(unit, target),
          effect: { observeInjury(c) {
            const src = c.source, e = c.target;
            if (!on(unit) || !unit.skill?.active || !e.alive || !inRange(unit, e)
              || src?.side !== 'ally' || !isOp(src) || !isKazimierz(src)
              || !['NORMAL', 'SPLASH'].includes(damageAttackType(c.dmg))) return;
            const tags = src === unit && c.dmg.isAttack ? ['skill', 'mlynarMark', 'mlynarOwn'] : ['skill', 'mlynarMark'];
            battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * extra, type: 'true',
              attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed', isSkill: true,
              origin: c.dmg, tags });
          } },
        });
      },
    };
  },
};
