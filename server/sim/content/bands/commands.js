// Battle marks of 规程 指令. Targets arrive in the server's PlayerBattleInput; no automatic column selection.
import { buffsOf, bodyOnTile, fxOn, isOp, onField } from '../support/index.js';
import { addShieldLayer, reviveNow } from '../items/battle.js';

const MARKS = {
  act3autochess_band12_buff(battle, ps, mark, p) {
    const unit = ps.units.find(u => u.uid === mark.uid && isOp(u));
    if (!unit) return;
    let left = p.max_respawn_cnt + (p.start_dead ? 1 : 0);
    battle.on('death', c => {
      if (c.unit === unit && left > 0 && reviveNow(battle, c, 'command')) left--;
    }, { priority: 12 });
    if (p.start_dead) battle.on('battleStart', () => { if (onField(unit)) battle.kill(unit); });
  },
  act1autochess_band17_buff(battle, ps, mark, p) {
    const unit = ps.units.find(u => u.uid === mark.uid && isOp(u));
    if (!unit) return;
    battle.on('attack', c => {
      if (c.attacker === unit && onField(unit) && battle.rng() < p.prob) {
        addShieldLayer(battle, unit, `command:shield:${mark.id}`, 1);
      }
    });
  },
  act3autochess_band19_buff(battle, ps, mark, p) {
    const [r, c] = battle.mapTile(ps, mark.row, mark.col);
    let used = false;
    battle.on('tick', () => {
      if (used) return;
      const enemy = battle.enemies.find(e => e.alive && bodyOnTile(e, r, c));
      if (!enemy) return;
      used = true;
      battle.applyStatus(enemy, 'fear', { duration: p.fear, source: null });
      fxOn(battle, 'fear', enemy, `command:${mark.id}`, mark.tag);
    });
  },
  act3autochess_band22_buff(battle, ps, mark) {
    const unit = ps.units.find(u => u.uid === mark.uid && isOp(u));
    const reserve = ps.units.find(u => u.commandReserveFor === mark.uid);
    if (!unit) return;
    let used = false;
    battle.on('damaged', c => {
      if (used || c.target !== unit || !(c.amount > 0)) return;
      used = true;
      if (unit.alive) battle.kill(unit);
      if (!reserve) return;
      // [ASSUMED] The summoned reserve replaces the knocked-down body's tile for the rest of this battle.
      // The owned board and bench stay intact; the ordinary knock-down hooks above still run.
      if (unit.alive) battle.retreat(unit, { permanent: true });
      unit.removed = true;
      unit.respawnAt = Infinity;
      reserve.deferDeploy = false;
      battle.redeploy(reserve, { free: true });
    }, { priority: -100 });
  },
};

function installChest(battle, ps, mark) {
  const [r, c] = battle.mapTile(ps, mark.row, mark.col);
  let alive = true, chest = null;
  battle.on('battleStart', () => {
    chest = battle.spawnDevice(mark.enemyId, r, c, { hp: 1, blockCnt: 0, name: battle.data.raw.enemies?.[mark.enemyId]?.name });
    if (chest) battle.addBuff(chest, { key: 'command:chest', flags: { untargetable: true, invulnerable: true }, persist: true });
  });
  battle.on('tick', () => {
    if (!alive || !battle.enemies.some(e => e.alive && bodyOnTile(e, r, c))) return;
    alive = false;
    if (chest?.alive) battle.retreat(chest, { permanent: true });
  });
  battle.on('battleEnd', ({ result }) => {
    const pp = result.perPlayer[ps.playerId];
    (pp.commandChests ||= []).push({ id: mark.id, alive });
    if (alive) pp.coins += mark.coin;
  });
}

export function installCommandMarks(battle) {
  for (const ps of battle.players) for (const mark of ps.input.commandMarks || []) {
    if (mark.enemyId) installChest(battle, ps, mark);
    for (const b of buffsOf(battle.data.raw.effects?.[mark.tag])) MARKS[b.bbKey]?.(battle, ps, mark, b.p);
  }
}
