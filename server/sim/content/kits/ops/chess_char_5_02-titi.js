// server/sim/content/kits/ops/chess_char_5_02-titi.js — 缇缇 (char_4056_titi) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import {
  AURA_IV, AURA_DUR, RING1, num, on, talent, mods, dist, inFaction, isOp, selectedId, lazySkills, whileOn,
} from '../shared/tier5.js';

const isSargonMinos = (u) => inFaction(u, 'sargonShip', ['sargon', 'minos']);

/** Enemy not moving along its route (blocked, stunned, rooted, waiting…). */
const isStill = (e) => !!(e.blockedBy || !e.moving || e.s.flags.stun || e.s.flags.noMove || !(e.s.moveSpeed > 0));

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 缇缇 — S3 旧日绽放 (25 s): ATK +, 2 targets, sleeps non-sleeping targets; during the skill every enemy waking up (or
  // knocked out asleep) takes arts damage growing with the sleep time (linear min_atk_scale → max_atk_scale over `sleep` s,
  // PRTS 备注) and sends the highest-aggro enemy within range_radius to sleep; other allies in range fall asleep (小睡)
  // instead of dying. T1 凝固的时光: can attack sleeping enemies, +15 % ATK arts vs non-moving
  // enemies, sleeping enemies take 30 % ATK arts/s. T2 勇气的报偿: Sargon/Minos ops above 50 % HP get +20 ASPD.
  // S1 缓蚀 (duration): ATK +, attack@prob chance per attack to sleep the target attack@sleep s.
  // S2 封护 (duration): no attacks, ATK +; she and the lowest-HP-ratio operator in her range (an equal ratio: the latest
  // deployed, the maintainer's rule of 2026-10-29, GitHub #906 / PR #907) sleep until the skill ends
  // (沉睡 = invulnerable), enemies around either of them keep falling asleep — each 0.25 s pulse a new 沉睡 entry for
  // her trait (GitHub #162, DESIGN §24.8); T1 ×talent_scale.
  chess_char_5_02_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const hitSleep = num(bb['attack@sleep'], num(bb.sleep, 5));
    const minS = num(bb.min_atk_scale, 1), maxS = num(bb.max_atk_scale, minS);
    const chainSleep = num(bb.sleep, hitSleep), radius = num(bb.range_radius, 1.5), chainN = Math.max(1, num(bb.max_target, 1));
    // S2 封护: "第一天赋效果提升至N倍" while it runs
    const t0Scale = (unit) => (sid === 'skchr_titi_2' && unit.skill?.active ? num(bb.talent_scale, 1) : 1);
    const ward = (battle, unit, a) => {
      const entered = !a.buffs.some((b) => (b.status ?? b.key) === 'sleep');
      battle.addBuff(a, { key: 'titi:ward', flags: { sleep: true }, visible: true, status: 'sleep', data: { src: unit } });
      battle.releaseBlocked(a);
      if (battle.hasHook('statusApplied')) battle.emit('statusApplied', { source: unit, target: a, status: 'sleep', duration: Infinity, entered });
    };
    return {
      skills: lazySkills({
        skchr_titi_1: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          attack: {
            onHit({ battle, unit, target }) {
              if (!target || !target.alive || target.s.flags.sleep || !battle.rng.chance(num(bb['attack@prob']))) return;
              battle.applyStatus(target, 'sleep', { duration: num(bb['attack@sleep']), source: unit });
            },
          },
        }),
        skchr_titi_2: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk) }),
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            // 生命比例最低; an equal ratio goes to the LAST-deployed op (the maintainer's rule of 2026-10-29 — the same
            // tie-break as 引星棘刺 S1's 「生命比例最低>最晚部署」, thorn2: `b.deploySeq - a.deploySeq`), then the
            // creation order as the final tie-break. Judged once, at the cast; the ward never moves afterwards.
            const pick = battle.alliesInGrid(unit).filter((a) => a !== unit && isOp(a) && a.hp > 0)
              .sort((a, b) => a.hpRatio - b.hpRatio || b.deploySeq - a.deploySeq || a.id - b.id)[0] ?? null;
            unit.mem.titiWard = pick ? [unit, pick] : [unit];
            for (const a of unit.mem.titiWard) ward(battle, unit, a);
            unit.mem.titiWardAcc = AURA_IV;
            battle.fx('sleepGuard', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ battle, unit, dt }) {
            unit.mem.titiWardAcc += dt;
            if (unit.mem.titiWardAcc < AURA_IV - 1e-9) return;
            unit.mem.titiWardAcc = 0;
            // "期间持续使自身与该目标周围的敌人陷入沉睡": every AURA_IV (0.25 s) the enemies around a ward sleep AURA_DUR (0.5 s),
            // and each pulse is a new 沉睡 entry (`reenter`), so her trait garrison_125 「每当范围内有敌人或干员进入沉睡或晕眩时」
            // climbs on it to its per-battle cap (GitHub #162, the reporter's memory of the official mode: 「攻击范围内有陷入
            // 沉睡就开始迅速增加直至上限」; the owner's decision of 2026-10-06, DESIGN §24.8). [ASSUMED] the pulse timing (not in
            // the data). Once per enemy and pulse (one beside both wards re-enters once); not while a longer sleep from
            // elsewhere holds it. The 0.5 s sleep outlasts the 0.25 s, so the enemy never wakes between pulses — only the
            // `entered` flag of the pulse changed (until 0.1.3 the first pulse alone was an entry).
            const pulsed = new Set();
            for (const a of unit.mem.titiWard || []) {
              if (!a.alive || !a.deployed || !a.findBuff('titi:ward')) continue;
              for (const e of battle.foesInRadius(a.x, a.y, RING1)) {
                if (!e.alive) continue;
                const reenter = !pulsed.has(e) && !e.buffs.some((b) => (b.status ?? b.key) === 'sleep' && b.timeLeft > AURA_DUR + 1e-9);
                pulsed.add(e);
                battle.applyStatus(e, 'sleep', { duration: AURA_DUR, source: unit, reenter });
              }
            }
          },
          onEnd({ battle, unit }) {
            for (const a of unit.mem.titiWard || []) {
              const b = a.findBuff('titi:ward');
              if (b && b.data.src === unit) battle.removeBuff(a, b);
            }
            unit.mem.titiWard = null;
          },
        }),
      }),
      trait: { hitSleep: true }, // 凝固的时光 (a): she targets and damages sleeping enemies (沉睡 = 无敌 for everyone else)
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk) }),
        attack: {
          maxTargets: Math.max(1, num(bb['attack@max_target'], 2)),
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.s.flags.sleep) return;
            battle.applyStatus(target, 'sleep', { duration: hitSleep, source: unit });
          },
        },
        onEnd({ battle, unit }) {
          for (const a of battle.allyUnits) {
            const b = a.findBuff('titi:allySleep');
            if (b && b.data.src === unit) battle.removeBuff(a, b);
          }
        },
      },
      talents: [
        { install(battle, unit) { // 凝固的时光 — (a) is the `hitSleep` trait above
          // (b) +extra_atk_scale arts vs non-moving enemies
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || c.dmg.isSplash || c.type === 'element') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || !isStill(e)) return;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0.extra_atk_scale) * t0Scale(unit), type: 'arts', tags: ['talent', 'titiStill'] });
          }, { owner: unit });
          // (c) sleeping enemies take damage_atk_scale × ATK arts per second
          whileOn(battle, unit, 1, () => {
            const amount = unit.s.atk * num(t0.damage_atk_scale) * t0Scale(unit);
            for (const e of battle.enemies) {
              if (e.alive && !e.hidden && e.s.flags.sleep) battle.dealDamage(unit, e, { amount, type: 'arts', tags: ['talent', 'titiDream'] });
            }
          });
        } },
        { install(battle, unit) { // 勇气的报偿: 精力充沛
          whileOn(battle, unit, AURA_IV, () => {
            for (const a of battle.allies()) {
              if (isOp(a) && isSargonMinos(a) && a.hpRatio > num(t1.hp_ratio, 0.5)) battle.addBuff(a, { key: 'titi:vigor', duration: AURA_DUR, mods: { aspd: num(t1.attack_speed) } });
            }
          });
        } },
      ],
      install(battle, unit) {
        if (sid && sid !== 'skchr_titi_3') return;
        // S3: wake-up burst chain (sleep applied by anyone counts)
        const asleep = new Map();
        // PRTS 备注: "向1.5半径内除该单位外仇恨值最高的敌方单位施加沉睡" — highest aggro (taunt) first, then the nearest
        const sleepOthers = (from) => {
          const cands = battle.foesInRadius(from.x, from.y, radius).filter((o) => o !== from && !o.s.flags.sleep && !o.mem?.candleOwner)
            .sort((a, b) => (b.s.taunt || 0) - (a.s.taunt || 0) || dist(a, from) - dist(b, from) || a.spawnSeq - b.spawnSeq);
          let n = 0;
          for (const o of cands) {
            if (n >= chainN) break;
            if (battle.applyStatus(o, 'sleep', { duration: chainSleep, source: unit })) n++;
          }
        };
        battle.on('statusApplied', (c) => {
          if (c.status === 'sleep' && c.target.side === 'enemy' && !asleep.has(c.target)) asleep.set(c.target, battle.time);
        }, { owner: unit });
        battle.on('tick', () => {
          if (!asleep.size) return;
          for (const [e, t0s] of asleep) {
            if (!e.alive) { asleep.delete(e); continue; }
            if (e.s.flags.sleep) continue;
            asleep.delete(e);
            if (!unit.skill?.active || !on(unit)) continue;
            const scale = minS + (maxS - minS) * Math.min(1, (battle.time - t0s) / Math.max(0.1, chainSleep));
            battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'titiWake'] });
            battle.fx('wake', { x: e.x, y: e.y, id: e.id, scale: Math.round(scale * 100) / 100 });
            sleepOthers(e);
          }
        }, { owner: unit });
        battle.on('kill', (c) => {
          const v = c.victim;
          if (v.side !== 'enemy' || !asleep.has(v)) return;
          asleep.delete(v);
          if (unit.skill?.active && on(unit)) sleepOthers(v);
        }, { owner: unit });
        // S3: other allies in range fall asleep instead of dying, until healed to full or the skill ends
        battle.on('fatal', (c) => {
          const a = c.unit;
          if (c.prevented || a.side !== 'ally' || a === unit) return;
          const guard = a.findBuff('titi:allySleep');
          if (guard) { if (guard.data.src === unit) c.prevented = true; return; }
          if (!isOp(a) || !unit.skill?.active || !on(unit) || !unit.rangeKeySet?.has(a.tileR * COLS + a.tileC)) return;
          c.prevented = true;
          const entered = !a.buffs.some((b) => (b.status ?? b.key) === 'sleep');
          battle.addBuff(a, {
            key: 'titi:allySleep', flags: { sleep: true }, visible: true, status: 'sleep', data: { src: unit }, interval: 0.2,
            onTick: ({ unit: x, buff }) => { if (x.hp >= x.s.maxHp - 1e-6) battle.removeBuff(x, buff); },
          });
          // other content (特质 "干员进入沉睡时") observes it like any sleep status
          if (battle.hasHook('statusApplied')) battle.emit('statusApplied', { source: unit, target: a, status: 'sleep', duration: Infinity, entered });
          battle.fx('sleepGuard', { x: a.x, y: a.y, id: a.id });
        }, { owner: unit, priority: 5 });
      },
    };
  },
};
