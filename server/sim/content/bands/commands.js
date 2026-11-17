// Battle marks of 规程 指令. Targets arrive in the server's PlayerBattleInput; no automatic column selection.
import { buffsOf, bodyOnTile, bodyInRangeTile, fxOn, isOp, onField } from '../support/index.js';
import { addShieldLayer, reviveNow } from '../items/battle.js';

/** Blackboard enemy_id of skill_add_pos_effect_enemy (“模拟宝藏”). The payoff is gated on this id, not a band id. */
const CHEST_ENEMY = 'enemy_9038_achest';

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
  // touched = an enemy overlapped the tile this battle (the mark must not return). spawned = the device stood.
  let touched = false, spawned = false, chest = null;
  battle.on('battleStart', () => {
    const rec = battle.data.raw.enemies?.[CHEST_ENEMY];
    // Ally device, not spawnEnemy: the touch scan walks battle.enemies and must not see the chest itself.
    // [ASSUMED] blockCnt stays 0. The enemy record's blockCnt is 1, but a device blocker holds an enemy at
    // radius 0.4472, and the written rule is 触碰, not 阻挡. Enemies walk onto the tile.
    const hp = rec?.stats?.maxHp > 0 ? rec.stats.maxHp : 100;
    chest = battle.spawnDevice(CHEST_ENEMY, r, c, { hp, atk: 0, blockCnt: 0, name: rec?.name });
    if (!chest) return;
    spawned = true;
    battle.addBuff(chest, { key: 'command:chest', flags: { untargetable: true, invulnerable: true, noMove: true }, persist: true });
  });
  battle.on('tick', () => {
    if (touched || !spawned) return;
    // [ASSUMED] Touch = bodyInRangeTile. A point enemy's 0.1 circle overlaps the chest tile; a huge enemy's
    // rectangle does. Flyers count — the text does not exclude them. An edge-only graze does not.
    // A kill on this tick (allies strike before the tick hook) still touched the tile. Dead enemies from
    // earlier ticks are already compacted out. [ASSUMED] one sample after movement: no enemy here moves
    // far enough in a 1/30 s tick to cross the overlap and leave it.
    if (!battle.enemies.some(e => !e.hidden && (e.alive || e.deathAt === battle.time) && bodyInRangeTile(e, r, c))) return;
    touched = true;
    if (chest?.alive) battle.retreat(chest, { permanent: true });
  });
  battle.on('battleEnd', ({ result }) => {
    const pp = result?.perPlayer?.[ps.playerId];
    if (!pp) return;
    const standing = spawned && !touched && !!chest?.alive;
    // [ASSUMED] A device that never spawned was not touched, so the mark stays for the next battle and pays nothing.
    (pp.commandChests ||= []).push({ id: mark.id, alive: standing || !spawned });
    if (!standing) return;
    const n = Math.trunc(Number(mark.coin));
    if (n > 0) battle.addCoins(ps.playerId, n);
  });
}

export function installCommandMarks(battle) {
  for (const ps of battle.players) for (const mark of ps.input.commandMarks || []) {
    if (mark.enemyId === CHEST_ENEMY) installChest(battle, ps, mark);
    for (const b of buffsOf(battle.data.raw.effects?.[mark.tag])) MARKS[b.bbKey]?.(battle, ps, mark, b.p);
  }
}
