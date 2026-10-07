// server/sim/content/kits/ops/chess_char_5_06-etlchi.js — 隐德来希 (char_4010_etlchi) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { mitigate } from '../../../damage.js';
import {
  RING1, num, on, talent, talentRec, skillGrid, mods, dist, lazySkills, instantKind,
} from '../shared/tier5.js';

/** 隐德来希 S3 "每次攻击对心烛至少造成35%攻击力的伤害". */
const CANDLE_MIN_ATK = 0.35;
/** 隐德来希 S3 心烛 enemy key (hidden talent bbStr take_extra_enemy_key; not in data/enemies.json). */
const CANDLE_KEY = 'enemy_5601_entlec';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 隐德来希 — S3 灵与欲的惜别 (20 s): skill range, ATK +, ASPD +100; summons a 心烛 for up to 3 highest-HP ground enemies
  // in range (60 % of their current HP, same DEF/RES); his hits on a candle deal at least 35 % ATK and the original loses
  // the same HP; only he can damage candles (other allies' attacks are redirected to the original).
  // T1 萃血: each hit steals 75 max HP (≤ 1350) and applies 200 arts/s for 5 s. T2 重盈: once below 25 % HP, heal 50 %
  // max HP and take −10 % phys damage afterwards. Reaper trait (heal per hit, module 60) comes from the profession.
  // S1 玫影觅迹 (instant, attack SP): next attack atk_scale × ATK, twice. S2 绯红壁合 (duration): no attacks; blood sickles
  // on herself and on one other ground unit (the ally with the most enemies around it) cut every enemy around them (RING1)
  // for atk_scale × ATK phys every `interval` s — ground enemies only unless the carrier has taken off (PRTS 备注).
  // Module REA-Y (elite): ASPD +12 with ≥ 2 enemies in range.
  chess_char_5_06_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const hpScale = num(bb['attack@max_hp_scale'], 0.6), defScale = num(bb['attack@def_scale'], 1), resScale = num(bb['attack@magic_resistance_scale'], 1);
    const nCandles = Math.max(1, num(bb['attack@max_target'], 3));
    const candleKey = talentRec(chess, 2)?.bbStr?.take_extra_enemy_key ?? CANDLE_KEY;
    const aroundN = (battle, a) => battle.foesInRadius(a.x, a.y, RING1).length;
    return {
      skills: lazySkills({
        skchr_etlchi_1: () => ({ kind: instantKind(chess, def), attack: { atkScale: num(bb.atk_scale, 1), hits: 2 } }),
        skchr_etlchi_2: () => ({
          kind: 'duration', attack: { noAttack: true },
          onStart({ battle, unit }) {
            const other = battle.alliesFor(unit).filter((a) => a !== unit && a.ground && a.hp > 0)
              .sort((a, b) => aroundN(battle, b) - aroundN(battle, a) || dist(a, unit) - dist(b, unit) || a.id - b.id)[0] ?? null;
            unit.mem.sickles = other ? [unit, other] : [unit];
            unit.mem.sickleAcc = 0;
            for (const a of unit.mem.sickles) battle.fx('aoe', { x: a.x, y: a.y, id: unit.id, r: RING1, skill: 'etlchiSickle' });
          },
          onTick({ battle, unit, dt }) {
            const iv = Math.max(0.1, num(bb.interval, 0.5));
            unit.mem.sickleAcc += dt;
            while (unit.mem.sickleAcc >= iv - 1e-9) {
              unit.mem.sickleAcc -= iv;
              for (const a of unit.mem.sickles || []) {
                if (!a.alive || !a.deployed) continue;
                // PRTS 备注 "被添加血镰的单位处于起飞时，血镰可对空": a sickle on the ground spares air units (FLY, 近地悬浮, 浮空);
                // 起飞 = an airborne skywalker (蒂比's skills: flag `liftoff`; still a 地面单位, so she can carry one)
                const air = !!a.s.flags.liftoff;
                for (const e of battle.foesInRadius(a.x, a.y, RING1)) {
                  if (e.isFlying && !air) continue;
                  battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'bloodSickle'] });
                }
              }
            }
          },
          onEnd({ unit }) { unit.mem.sickles = null; },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
        targeting: skillGrid(chess, def) ? { rangeGrid: skillGrid(chess, def) } : undefined,
        onStart({ battle, unit }) {
          unit.mem.candles = [];
          const picks = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: false })
            .filter((e) => !e.isFlying && !e.mem?.candleOwner && !e.isBoss)
            .sort((a, b) => b.hp - a.hp || a.spawnSeq - b.spawnSeq).slice(0, nCandles);
          for (const e of picks) {
            const r = Math.round(e.y), c = Math.round(e.x);
            // 心烛 is not in data/enemies.json: an inline record (neutral, never attacks, never moves, not counted)
            const def = {
              name: '心烛', rank: 'NORMAL', applyWay: 'NONE', motion: 'WALK', notCountInTotal: true, lifePointReduce: 0,
              stats: { maxHp: Math.max(1, e.hp * hpScale), atk: 0, def: e.s.def * defScale, magicResistance: e.s.res * resScale, moveSpeed: 0, massLevel: num(e.base.massLevel, 1) },
            };
            const cd = battle.spawnEnemy(candleKey, {
              def, pos: [e.y, e.x], route: { motion: 'WALK', start: [r, c], end: [r, c], checkpoints: [] },
              countInTotal: false, ownerPlayerId: e.ownerId,
            });
            if (!cd) continue;
            cd.name = '心烛';
            Object.assign(cd.base, { maxHp: Math.max(1, e.hp * hpScale), atk: 0, def: e.s.def * defScale, res: e.s.res * resScale, moveSpeed: 0 });
            cd.profile = { ...(cd.profile || {}), noAttack: true };
            cd.markDirty();
            cd.hp = cd.s.maxHp;
            cd.mem.candleOwner = unit;
            cd.mem.candleOf = e;
            cd.mem.noLeak = true;                           // never a leak at the time limit (Battle._timeout)
            battle.addBuff(cd, { key: 'etlchi:candle', flags: { unblockable: true, noMove: true } });
            unit.mem.candles.push(cd);
            battle.fx('candle', { x: cd.x, y: cd.y, id: cd.id, of: e.id });
          }
        },
        onEnd({ battle, unit }) {
          for (const cd of unit.mem.candles || []) if (cd.alive) battle.kill(cd, null);
          unit.mem.candles = [];
        },
      },
      talents: [
        { install(battle, unit) { // 萃血
          const steal = num(t0['attack@steal_hp']), cap = num(t0['attack@steal_hp_max']);
          const dot = num(t0.magic_value), dotDur = num(t0.dot_duration, 5), iv = num(t0.interval, 1);
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.stolen = 0; }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || c.type === 'element') return;
            const e = c.target;
            if (e.side !== 'enemy' || !e.alive || e.mem?.candleOwner || !on(unit)) return;
            if (dot > 0) {
              battle.addBuff(e, { key: `etlchi:dot:${unit.id}`, duration: dotDur, interval: iv, refresh: 'extend',
                onTick: ({ unit: x }) => battle.dealDamage(unit, x, { amount: dot, type: 'arts', tags: ['talent', 'dot'] }) });
            }
            const stolen = num(unit.mem.stolen);
            // (a boss sharing the match HP pool keeps its max HP: the pool is owned by the match)
            const n = Math.min(steal, cap - stolen, Math.floor(e.s.maxHp - 1)); // never below 1 max HP
            if (n > 0 && !e.bossPool) {
              unit.mem.stolen = stolen + n;
              // the victim keeps an explicit running total (a 'stack' refresh would rescale every stack by the last n)
              const key = `etlchi:steal:${unit.id}`;
              const lost = num(e.findBuff(key)?.data?.total) + n;
              const hp0 = e.hp;
              battle.addBuff(e, { key, mods: { hpFlat: -lost }, data: { total: lost } });
              // 偷取生命上限: the victim's current HP only drops where it exceeds the new maximum (the engine keeps ratios)
              if (e.alive) e.hp = Math.min(hp0, e.s.maxHp);
              battle.addBuff(unit, { key: 'etlchi:gain', mods: { hpFlat: unit.mem.stolen } });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 重盈
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.reborn = false; }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.target !== unit || unit.mem.reborn || !on(unit) || unit.hp <= 0 || !(unit.hpRatio < num(t1.hp_ratio))) return;
            unit.mem.reborn = true;
            battle.heal(unit, unit, unit.s.maxHp * num(t1['etlchi_t_2[heal].hp_ratio']), { self: true });
            if (num(t1.damage_resistance) > 0) battle.addBuff(unit, { key: 'etlchi:reborn', mods: { physTakenMul: 1 - num(t1.damage_resistance) } });
            battle.fx('reborn', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // REA-Y "攻击范围内存在2名及以上敌人时攻击速度+12": the ENGINE owns this trait line now
        // (server/sim/content/traitMods.js, applied from battle/players.js _setupUnit for every operator) — a second
        // implementation here would count the same 12 points twice.
        const mine = (e) => e && e.mem && e.mem.candleOwner === unit;
        // "心烛只受隐德来希攻击的影响": other sources' element gauges never fill a candle either
        battle.on('elementHit', (c) => { if (mine(c.target) && c.source !== unit) c.dmg.cancel = true; }, { owner: unit });
        battle.on('beforeStatus', (c) => { if (mine(c.target) && c.source !== unit) c.cancel = true; }, { owner: unit });
        battle.on('hit', (c) => {
          if (!mine(c.target)) return;
          if (c.source !== unit) { c.dmg.cancel = true; return; }
          if (c.dmg.type !== 'phys' && c.dmg.type !== 'arts') return;
          const ss = unit.s;
          const mit = mitigate(c.dmg.amount, c.dmg.type, c.target.s, {
            defIgnorePct: c.dmg.defIgnorePct + ss.defIgnorePct, defIgnoreFlat: c.dmg.defIgnoreFlat + ss.defIgnoreFlat,
            resIgnorePct: c.dmg.resIgnorePct + ss.resIgnorePct, resIgnoreFlat: c.dmg.resIgnoreFlat + ss.resIgnoreFlat,
          });
          const floor = ss.atk * CANDLE_MIN_ATK;
          if (mit < floor) { c.dmg.type = 'true'; c.dmg.amount = floor; c.dmg.canDodge = false; }
        }, { owner: unit, priority: -20 });
        battle.on('damaged', (c) => {
          if (!mine(c.target) || !(c.amount > 0) || c.type === 'element') return;
          const o = c.target.mem.candleOf;
          if (o && o.alive) battle.loseHp(o, c.amount, { source: unit });
        }, { owner: unit });
        battle.on('death', (c) => { // the original fell or leaked: its candle goes out
          if (c.unit.side !== 'enemy' || c.unit.mem?.candleOwner) return;
          for (const cd of unit.mem.candles || []) if (cd.alive && cd.mem.candleOf === c.unit) battle.kill(cd, null);
        }, { owner: unit });
        battle.on('beforeAttack', (c) => { // other allies hit the original instead of the candle
          if (c.attacker === unit || c.attacker.side !== 'ally' || !(unit.mem.candles && unit.mem.candles.length)) return;
          if (!c.targets.some(mine)) return;
          const out = [];
          for (const t of c.targets) {
            if (!mine(t)) { if (!out.includes(t)) out.push(t); continue; }
            const o = t.mem.candleOf;
            if (o && o.alive && !out.includes(o) && !c.targets.includes(o)) out.push(o);
          }
          c.targets = out;
        }, { owner: unit });
      },
    };
  },
};
