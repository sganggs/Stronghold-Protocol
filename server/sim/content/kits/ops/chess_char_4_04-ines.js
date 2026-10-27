// server/sim/content/kits/ops/chess_char_4_04-ines.js — 伊内丝 (char_4087_ines) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { bodyDist } from '../../../body.js';
import { canTargetEnemy } from '../../../targeting.js';
import { AURA, num, tbb, grid, enemiesOnRange, pulse, isSel, alt, instantKind, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 伊内丝 (agent) S2 暗夜无明 — stealth, +ATK, +1 DP & steal ASPD per attack; talents 影织 / 影哨
  //       S1 淬影突袭 (next attack: 3 s arts DoT 40 %/55 % ATK per s, not stacking, +2 DP); S3 独影归途 (passive: the
  //       first deployment leaves a 影哨 and retreats with the redeploy timer refreshed; every deployment: ATK up for
  //       the skill duration, the sentry is recalled through ≤ 4/5 enemies for 110 %/140 % phys, +1 DP per damage)
  chess_char_4_04_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid);
    const step = num(bb['attack@steal_atk_speed'], 5), maxSteal = num(bb['attack@steal_atk_speed_max'], 50);
    const S3 = isSel(def, 'skchr_ines_3');
    const clearAspd = (battle, unit) => {
      for (const id of unit.mem.inesAspdVictims || []) { const e = battle.unitById(id); if (e) battle.removeBuff(e, `ines:aspd:${unit.id}`); }
      unit.mem.inesAspdVictims = [];
      unit.mem.inesAspd = 0;
      battle.removeBuff(unit, 'ines:aspdGain');
    };
    const s3Dur = num(def.skill?.duration, 11);
    return {
      skills: alt(def, {
        skchr_ines_1: () => ({
          kind: instantKind(def),
          attack: {
            onHit({ battle, unit, target }) {
              battle.addDp(unit.ownerId, num(bb.cost, 2), unit);
              if (!target || !target.alive || target.side !== 'enemy') return;
              const scale = num(bb.bleed_atk_scale, 0.4);
              // （不叠加）: a new DoT replaces the running one
              battle.addBuff(target, { key: `ines:bleed:${unit.id}`, duration: num(bb.bleed_duration, 3) + 1e-6, interval: 1, source: unit, visible: true, refresh: 'extend',
                onTick: ({ unit: t }) => battle.dealDamage(unit, t, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'dot'] }) });
            },
          },
        }),
        skchr_ines_3: () => ({
          kind: 'duration', duration: s3Dur, spCost: 0, spType: 'none', trigger: 'NEVER',
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'ines:s3', mods: { atkPct: num(bb.atk) }, visible: true });
            // 立刻收回影哨: the sentry flies back to her and hits ≤ max_target enemies on its way (within
            // projectile_range of the segment, [ASSUMED] nearest to its start first)
            const from = unit.mem.inesSentryAt;
            if (!unit.mem.sentry || !from) return;
            unit.mem.sentry = null;
            unit.mem.inesSentryAt = null;
            const ax = from.x, ay = from.y, bx = unit.x, by = unit.y;
            const L2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
            const w = num(bb.projectile_range, 1.4);
            const hits = [];
            for (const e of battle.aliveEnemies()) {
              if (!canTargetEnemy(unit, e, { canHitFly: true })) continue;
              const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((e.x - ax) * (bx - ax) + (e.y - ay) * (by - ay)) / L2)) : 0;
              const d = bodyDist(e, ax + t * (bx - ax), ay + t * (by - ay));
              if (d <= w + 1e-9) hits.push({ e, t, d });
            }
            hits.sort((a, b) => a.t - b.t || a.d - b.d || a.e.id - b.e.id);
            const amount = unit.s.atk * num(bb.atk_scale, 1.1); // one projectile: ATK taken when it flies back
            for (const { e } of hits.slice(0, Math.max(1, Math.floor(num(bb.max_target, 4))))) {
              battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill', 'sentryRecall'] });
            }
            battle.fx('beam', { x: ax, y: ay, tx: bx, ty: by, id: unit.id });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'ines:s3'); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        flags: { stealth: true },
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) { clearAspd(battle, unit); battle.fx('stealth', { x: unit.x, y: unit.y, id: unit.id }); },
        onAttack({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost, 1), unit); },
        onHit({ battle, unit, target }) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const room = maxSteal - (unit.mem.inesAspd ?? 0);
          if (room <= 0) return;
          const s = Math.min(step, room);
          unit.mem.inesAspd = (unit.mem.inesAspd ?? 0) + s;
          const key = `ines:aspd:${unit.id}`;
          const cur = target.findBuff(key);
          battle.addBuff(target, { key, mods: { aspd: (cur?.mods?.aspd ?? 0) - s }, source: unit });
          if (!(unit.mem.inesAspdVictims ||= []).includes(target.id)) unit.mem.inesAspdVictims.push(target.id);
          battle.addBuff(unit, { key: 'ines:aspdGain', mods: { aspd: unit.mem.inesAspd } });
        },
        onEnd({ battle, unit }) { clearAspd(battle, unit); },
      },
      talents: [
        { install(battle, unit) { // 影织: first damage on each enemy → bind 5 s + steal 90 ATK until it dies or Ines leaves
          unit.mem.woven = new Set();
          unit.mem.atkVictims = [];
          const refresh = () => {
            unit.mem.atkVictims = unit.mem.atkVictims.filter((id) => battle.unitById(id)?.alive);
            const gain = Math.min(num(t0.steal_atk_max, Infinity), num(t0.steal_atk, 90) * unit.mem.atkVictims.length);
            if (unit.alive) { if (gain > 0) battle.addBuff(unit, { key: 'ines:atkGain', mods: { atkFlat: gain } }); else battle.removeBuff(unit, 'ines:atkGain'); }
          };
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !unit.alive || e.side !== 'enemy' || c.type === 'element' || unit.mem.woven.has(e.id)) return;
            unit.mem.woven.add(e.id);
            if (!e.alive) return;
            battle.applyStatus(e, 'bind', { duration: num(t0.duration, 5), source: unit });
            battle.addBuff(e, { key: `ines:atkSteal:${unit.id}`, mods: { atkFlat: -num(t0.steal_atk, 90) }, source: unit });
            unit.mem.atkVictims.push(e.id);
            refresh();
            battle.fx('shadowWeave', { x: e.x, y: e.y, id: e.id });
          }, { owner: unit });
          battle.on('death', (c) => {
            if (c.unit.side === 'enemy' && unit.mem.atkVictims.includes(c.unit.id)) refresh();
            if (c.unit !== unit) return;
            for (const id of unit.mem.atkVictims) { const e = battle.unitById(id); if (e) battle.removeBuff(e, `ines:atkSteal:${unit.id}`); }
            unit.mem.atkVictims = [];
            unit.mem.woven = new Set();
          }, { owner: unit });
        } },
        { install(battle, unit) { // 影哨: reveal + −30 % move speed in range; a sentry keeps it after she leaves (max 1)
          const mods = { moveMul: Math.max(0, 1 + num(t1.move_speed, -0.3)) };
          // priority 20: before 不屈's redeploy (death priority 10), whose deployment starts S3 and its recall
          battle.on('death', (c) => {
            if (c.unit !== unit || c.reason === 'expired') return;
            unit.mem.sentry = new Set(unit.baseRangeKeys || unit.rangeKeys || []);
            battle.fx('sentry', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: 20 });
          battle.every(AURA, () => {
            const set = new Set();
            if (unit.alive && unit.deployed) for (const k of unit.rangeKeys || []) set.add(k);
            if (unit.mem.sentry) for (const k of unit.mem.sentry) set.add(k);
            if (!set.size) return;
            for (const e of enemiesOnRange(battle, unit, set)) pulse(battle, e, `ines:sentry:${unit.id}`, mods, { flags: { reveal: true } });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (S3) {
          battle.on('deploy', (c) => {
            if (c.unit !== unit || c.move) return;
            if (unit.mem.inesS3Placed) {
              unit.skill.activate('deploy');
              return;
            }
            // 首次部署 only places a 影哨 and retreats; it is not a skill activation.
            // 立刻刷新再部署时间: redeploy as soon as its DP cost is affordable.
            unit.mem.inesS3Placed = true;
            battle.after(0, () => {
              if (!unit.alive || !unit.deployed) return;
              battle.retreat(unit, { reason: 'retreat' });
              unit.respawnAt = battle.time;
              battle.fx('sentry', { x: unit.x, y: unit.y, id: unit.id });
            }, { owner: unit });
          }, { owner: unit });
          // where the talent's 影哨 stays (every leave but an expiry), for the recall of the next deployment
          // (priority 20: recorded before 不屈's redeploy at death priority 10 starts the next deployment's S3 and its recall)
          battle.on('death', (c) => { if (c.unit === unit && c.reason !== 'expired') unit.mem.inesSentryAt = { x: unit.x, y: unit.y }; }, { owner: unit, priority: 20 });
          // 技能期间每对一个敌人造成伤害就获得1点部署费用
          battle.on('damaged', (c) => {
            if (c.source !== unit || c.target.side !== 'enemy' || !(c.amount > 0) || c.type === 'element' || !unit.skill?.active || !(unit.skill.timeLeft > 0)) return;
            battle.addDp(unit.ownerId, num(bb.cost, 1), unit);
          }, { owner: unit });
        }
        // module (elite): the first retreat's redeploy time is 35 % shorter
        const rt = num(tb.respawn_time, 0);
        if (!rt) return;
        battle.on('death', (c) => {
          if (c.unit !== unit || unit.mem.firstRetreatDone || !Number.isFinite(unit.respawnAt)) return;
          unit.mem.firstRetreatDone = true;
          unit.respawnAt = unit.deathAt + (unit.respawnAt - unit.deathAt) * Math.max(0, 1 + rt);
        }, { owner: unit });
      },
    };
  },
});
