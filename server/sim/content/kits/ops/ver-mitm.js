// server/sim/content/kits/ops/ver-mitm.js — 渡桥 (char_4147_mitm), 规程·序列Ⅰ.
// The tactician branch still drops its generic reinforcement on deploy; this kit retreats that token and
// fields 废品战车 instead. The car's own talent (block, respawn interval, wreckage, the elite taunt) is read
// from the token def. [ASSUMED] a car blocks its talent block count (its sheet block is 0). [ASSUMED] S1's
// self-destruct and S2's end both count as a defeat: wreckage, then the talent interval, not the sheet
// redeploy time. [ASSUMED] wreckage does not survive her own redeploy. [ASSUMED] `mitm_s_2[to_token].hp` 1
// changes no HP. [ASSUMED] `mode` 1 is the "token stops attacking" already in the skill text. Orthogonal
// wreck tiles are absolute, not facing-relative.

import { num, up } from '../shared/tier1.js';
import { COLS, beginDp, endDp, kitSkills, posDur, tickDp } from '../shared/version.js';

const S1 = 'skchr_mitm_1';
const S2 = 'skchr_mitm_2';
const TOKEN = 'token_10037_mitm_trshrb';
const GENERIC = 'token_tactician_reinforce';
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function mergedBb(def) {
  const o = {};
  for (const t of def?.talents ?? []) if (t?.bb) Object.assign(o, t.bb);
  return o;
}

function isMine(a, owner) {
  return a.ownerUnit === owner && (a.defId === TOKEN || a.defId === GENERIC || a.mem?.mitmWreck);
}

function livingCar(battle, owner) {
  const c = owner.mem.mitmCar;
  if (c && c.alive && c.deployed && !c.mem?.mitmWreck) return c;
  return battle.allyUnits.find((a) => a.alive && a.deployed && a.ownerUnit === owner && a.defId === TOKEN && !a.mem?.mitmWreck) || null;
}

function sweep(battle, owner) {
  const list = battle.allyUnits.filter((a) => a.alive && isMine(a, owner));
  for (const a of list) battle.retreat(a, { reason: 'retreat', permanent: true });
}

function wreckKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    install(_battle, w) { w.mem.mitmWreck = true; },
  };
}

function spawnWrecks(battle, owner, car) {
  const bb = mergedBb(car.def);
  const hpF = num(bb['trshrb_t_1[trash_born].max_hp']);
  const atkF = num(bb['trshrb_t_1[trash_born].atk']);
  const defF = num(bb['trshrb_t_1[trash_born].def']);
  const block = num(bb['trshrb_t_1[trash_born].block_cnt']);
  const stats = {
    maxHp: Math.max(1, car.base.maxHp * (1 + hpF)),
    atk: Math.max(0, car.base.atk * (1 + atkF)),
    def: Math.max(0, car.base.def * (1 + defF)),
    blockCnt: Math.max(0, block),
  };
  for (const [dr, dc] of ORTHO) {
    const r = car.tileR + dr;
    const c = car.tileC + dc;
    if (!battle.grid.inRect(r, c) || !battle.grid.canStand(r, c) || battle.isReservedTile(r, c)) continue;
    const w = battle.spawnToken(owner, TOKEN, r, c, { anySource: true, kit: wreckKit(), stats });
    if (w) w.mem.mitmWreck = true;
  }
}

function trySpawn(battle, owner) {
  if (!up(owner) || owner.mem.mitmLeave || owner.mem.mitmWait || owner.mem.mitmSweep) return;
  if (livingCar(battle, owner)) return;
  const tile = battle.findTacticalPoint(owner);
  if (!tile) return;
  const car = battle.spawnToken(owner, TOKEN, tile[0], tile[1], { anySource: true, kit: carKit(owner) });
  if (!car) return;
  owner.mem.mitmCar = car;
  owner.trait.reinforcement = car;
  battle.fx('summon', { x: car.x, y: car.y, id: owner.id, token: TOKEN });
}

function onCarDown(battle, owner, car) {
  if (owner.mem.mitmSweep || owner.mem.mitmLeave || car.mem?.mitmWreck) return;
  if (owner.mem.mitmCar === car) owner.mem.mitmCar = null;
  if (owner.trait?.reinforcement === car) owner.trait.reinforcement = null;
  spawnWrecks(battle, owner, car);
  if (!up(owner) || owner.mem.mitmWait) return;
  owner.mem.mitmWait = true;
  const gen = owner.mem.mitmGen || 0;
  const interval = Math.max(0.05, num(mergedBb(car.def).interval, 15));
  battle.after(interval, () => {
    if ((owner.mem.mitmGen || 0) !== gen || !up(owner) || owner.mem.mitmLeave) return;
    owner.mem.mitmWait = false;
    trySpawn(battle, owner);
  }, { owner });
}

function carKit(owner) {
  return {
    skill: null,
    install(battle, car) {
      const bb = mergedBb(car.def);
      const block = num(bb.block_cnt);
      if (block) {
        battle.addBuff(car, {
          key: 'mitm:block', mods: { blockCnt: block }, persist: true, allowDead: true, tags: ['talent'],
        });
      }
      const taunt = num(bb.taunt_level);
      if (taunt) {
        battle.every(0.25, () => {
          if (!car.alive || !car.deployed) return;
          for (const e of car.blocking) {
            if (e.blockedBy === car && e.alive) battle.applyStatus(e, 'taunt', { value: taunt, duration: 0.4, source: car });
          }
        }, { owner: car });
      }
      battle.on('death', (ctx) => { if (ctx.unit === car) onCarDown(battle, owner, car); }, { owner: car });
    },
  };
}

function applyS2(battle, unit, sbb) {
  const car = livingCar(battle, unit);
  if (!car || car.findBuff('mitm:s2')) return;
  const talentBlock = num(mergedBb(car.def).block_cnt);
  const extra = num(sbb['mitm_s_2[to_token].block_cnt']) - talentBlock;
  const mods = { defPct: num(sbb['mitm_s_2[to_token].def']) };
  if (extra) mods.blockCnt = extra;
  battle.addBuff(car, { key: 'mitm:s2', mods, source: unit, tags: ['skill'] });
  car.profile.noAttack = true;
}

function mitm(_bb, chess) {
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: 'instant',
        onStart({ battle, unit }) {
          battle.addDp(unit.ownerId, num(sbb.cost), unit);
          const car = livingCar(battle, unit);
          if (!car) return;
          const keys = [];
          for (const [dr, dc] of ORTHO) {
            const r = car.tileR + dr;
            const c = car.tileC + dc;
            if (battle.grid.inRect(r, c)) keys.push(r * COLS + c);
          }
          const amount = unit.s.atk * num(sbb.aoe_damage_scale, 1);
          for (const e of battle.enemiesOnTiles(keys, unit, { canHitFly: true })) {
            battle.dealDamage(unit, e, { amount, type: 'phys', tags: ['mitm:blast'] });
          }
          battle.retreat(car, { reason: 'expired', permanent: true });
        },
      };
    }
    if (id === S2) {
      const interval = num(sbb['mitm_s_2[cost].interval'], 1.25);
      const packets = num(sbb['mitm_s_2[cost].display'], 12);
      const per = num(sbb['mitm_s_2[cost].cost'], 1);
      const maxT = Math.max(1, Math.floor(num(sbb['attack@max_target'], 1)));
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { atkPct: num(sbb.atk) },
        targeting: { maxTargets: maxT },
        onStart({ battle, unit }) {
          beginDp(unit, 'mitm:dp', interval, packets, per);
          applyS2(battle, unit, sbb);
        },
        onTick({ battle, unit, dt }) {
          tickDp(battle, unit, 'mitm:dp', dt);
          applyS2(battle, unit, sbb);
        },
        onEnd({ battle, unit, reason }) {
          endDp(battle, unit, 'mitm:dp', reason);
          const car = livingCar(battle, unit);
          if (!car) return;
          battle.removeBuff(car, 'mitm:s2');
          car.profile.noAttack = false;
          battle.retreat(car, { reason: 'expired', permanent: true });
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      unit.mem.mitmGen = 0;
      unit.mem.mitmWait = false;
      unit.mem.mitmLeave = false;
      unit.mem.mitmSweep = false;
      const clearOwned = () => {
        unit.mem.mitmGen = (unit.mem.mitmGen || 0) + 1;
        unit.mem.mitmWait = false;
        unit.mem.mitmSweep = true;
        sweep(battle, unit);
        unit.mem.mitmSweep = false;
        unit.mem.mitmCar = null;
        if (unit.trait) unit.trait.reinforcement = null;
      };
      // After the tactician branch's own deploy hook, which drops the generic reinforcement first.
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit) return;
        unit.mem.mitmLeave = false;
        clearOwned();
        trySpawn(battle, unit);
      }, { owner: unit, priority: -1 });
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit) return;
        unit.mem.mitmLeave = true;
        clearOwned();
      }, { owner: unit });
      battle.every(0.5, () => {
        if (!up(unit) || unit.mem.mitmLeave || unit.mem.mitmWait || livingCar(battle, unit)) return;
        trySpawn(battle, unit);
      }, { owner: unit });
    },
  };
}

export default { char_4147_mitm: mitm };
