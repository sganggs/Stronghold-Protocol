import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData, playerBondRecord } from '../../server/sim/content/support/index.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { validateClientResult } from '../../server/match/fields.js';
import { compactResult, buildBattleSpec } from '../../server/sim/spec.js';
import { reconcileCommandChests } from '../../server/match/bandCommands.js';
import { GEO } from '../../shared/constants.js';
import { fileURLToPath } from 'node:url';

const CHEST = 'enemy_9038_achest';
const raw = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {} } });
const data = new DataSource({ ...raw, chess: { ...raw.chess, test_a: chessRec({ id: 'test_a', skill: null }) },
  enemies: {
    ...raw.enemies,
    test_enemy: enemyRec({ key: 'test_enemy', hp: 100000, speed: 0 }),
    test_fly: enemyRec({ key: 'test_fly', hp: 100000, speed: 0, motion: 'FLY' }),
    test_huge: { ...enemyRec({ key: 'test_huge', hp: 100000, speed: 0 }), hitArea: { w: 1.2, h: 1 } },
  } }, null);
before(() => setGameData(raw));
after(() => setGameData(null));
const unit = (uid, col = 5) => ({ uid, kind: 'chess', chessId: 'test_a', row: 10, col });
function battle(marks, extra = {}) {
  return makeBattle({ data, content: 'full', autoFinish: false, timeLimit: 2,
    players: [{ playerId: 'p1', seat: 0, side: 'L', units: [unit(1), unit(2, 6)], bonds: {}, commandMarks: marks, ...extra }] });
}

test('survival mark knocks down and revives only its uid, then spends its finite revive budget', () => {
  const h = battle([{ id: 1, uid: 1, tag: 'eff_band12' }]);
  h.step(); const a = h.unit(1), b = h.unit(2);
  assert.ok(a.alive); assert.equal(h.hooksOf('death').filter(c => c.unit === a).length, 1); assert.equal(h.hooksOf('death').filter(c => c.unit === b).length, 0);
  h.b.kill(a); assert.ok(a.alive);
  h.b.kill(a); assert.ok(a.alive);
  h.b.kill(a); assert.equal(a.alive, false);
  assert.equal(h.hooksOf('death').filter(c => c.unit === b).length, 0);
});

test('shield mark triggers on attacks and caps its shield at one hit', () => {
  const h = battle([{ id: 7, uid: 1, tag: 'eff_band17' }]); h.step();
  const a = h.unit(1), b = h.unit(2); h.b.rng = () => 0;
  h.b.emit('attack', { attacker: b }); assert.equal(b.findBuff('command:shield:7'), null);
  h.b.emit('attack', { attacker: a }); h.b.emit('attack', { attacker: a });
  assert.equal(a.findBuff('command:shield:7').shieldHits, 1);
});

test('fear tile affects only the first enemy touching it, for the blackboard duration', () => {
  const h = battle([{ id: 1, row: 9, col: 8, tag: 'eff_band19' }]); h.step();
  const first = h.spawn('test_enemy', { pos: [9, 8] }), second = h.spawn('test_enemy', { pos: [9, 8] });
  h.step();
  assert.ok(first.s.flags.fear); assert.ok(!second.s.flags.fear);
  const applied = h.hooksOf('statusApplied').filter(c => c.target === first); assert.equal(applied[0].duration, 3);
});

test('breakaway mark waits for damage, then deploys the reserved bench operator once', () => {
  const h = battle([{ id: 1, uid: 1, tag: 'eff_band22' }], { commandReserves: [{ ...unit(3), commandReserveFor: 1 }] });
  h.step(); const a = h.unit(1), reserve = h.unit(3);
  assert.equal(reserve.alive, false);
  h.b.dealDamage({ source: null, target: a, amount: 10, type: 'true' });
  assert.equal(a.alive, false); assert.equal(a.removed, true); assert.ok(reserve.alive);
  assert.equal(reserve.tileC, 5);
});

test('treasure survives for its coin, and an enemy collider removes the device and the mark', () => {
  const mark = { id: 17, row: 9, col: 8, enemyId: CHEST, coin: 2, persistent: true };
  const safe = battle([mark]); safe.step();
  const chest = safe.unit(CHEST);
  assert.ok(chest?.alive, 'the official enemy stands as an ally device');
  assert.equal(chest.hp, 100);
  assert.equal(chest.kind, 'device');
  assert.ok(!safe.enemies().some(e => e.defId === CHEST));
  assert.ok(safe.snapshot().units.some(t => t[0] === chest.id));
  safe.runToEnd(4);
  assert.deepEqual(safe.result().perPlayer.p1.commandChests, [{ id: 17, alive: true }]);
  assert.equal(safe.result().perPlayer.p1.coins, 2);
  assert.equal(safe.eventsOf('bounty').reduce((sum, e) => sum + e[2], 0), 2);
  assert.deepEqual(compactResult(safe.result()).perPlayer.p1.commandChests, [{ id: 17, alive: true }]);
  const kept = { commandMarks: [{ ...mark }] };
  reconcileCommandChests(kept, safe.result().perPlayer.p1);
  assert.equal(kept.commandMarks.length, 1);

  const lost = battle([mark]); lost.step(); lost.spawn('test_enemy', { pos: [9, 8] }); lost.runToEnd(4);
  const gone = lost.unit(CHEST);
  assert.equal(gone.alive, false);
  assert.equal(gone.removed, true);
  assert.ok(!lost.snapshot().units.some(t => t[0] === gone.id));
  assert.deepEqual(lost.result().perPlayer.p1.commandChests, [{ id: 17, alive: false }]);
  assert.equal(lost.result().perPlayer.p1.coins, 0);
  const holder = { commandMarks: [{ ...mark }] };
  reconcileCommandChests(holder, lost.result().perPlayer.p1);
  assert.equal(holder.commandMarks.length, 0);
});

test('treasure touch is the enemy collider, including flyers and a huge body, and a graze does not count', () => {
  const mark = { id: 17, row: 9, col: 8, enemyId: CHEST, coin: 1, persistent: true };
  const graze = battle([mark]); graze.step();
  const far = graze.spawn('test_enemy', { pos: [9, 10] });
  far.x = 8.7; far.y = 9;
  graze.runToEnd(4);
  assert.equal(graze.result().perPlayer.p1.commandChests[0].alive, true, '0.2 past the tile edge is outside the 0.1 circle');
  assert.equal(graze.result().perPlayer.p1.coins, 1);

  const clip = battle([mark]); clip.step();
  const near = clip.spawn('test_enemy', { pos: [9, 10] });
  near.x = 8.55; near.y = 9;
  clip.step();
  assert.equal(clip.unit(CHEST).alive, false, 'center is on the next tile; the 0.1 circle still overlaps');

  const fly = battle([mark]); fly.step(); fly.spawn('test_fly', { pos: [9, 8] }); fly.step();
  assert.equal(fly.unit(CHEST).alive, false);

  const huge = battle([mark]); huge.step();
  const body = huge.spawn('test_huge', { pos: [9, 7] });
  assert.ok(body.hitArea);
  huge.step();
  assert.equal(huge.unit(CHEST).alive, false, 'the rectangle overlaps the chest tile; the center circle does not');

  const slain = battle([mark]); slain.step();
  slain.b.on('tick', () => {
    const foe = slain.b.enemies.find(e => e.defId === 'test_enemy' && e.alive);
    if (foe) slain.b.kill(foe);
  }, { priority: 1 });
  slain.spawn('test_enemy', { pos: [9, 8] });
  slain.step();
  assert.equal(slain.unit(CHEST).alive, false, 'killed on the tile this tick, before the chest hook');
});

test('a treasure that cannot spawn pays nothing and keeps its mark; another enemy id does not', () => {
  const mark = { id: 17, row: 9, col: 8, enemyId: CHEST, coin: 2, persistent: true };
  const blocked = battle([mark], { units: [{ ...unit(9), row: 9, col: 8 }] });
  blocked.step();
  assert.equal(blocked.unit(CHEST), null);
  blocked.runToEnd(4);
  assert.deepEqual(blocked.result().perPlayer.p1.commandChests, [{ id: 17, alive: true }]);
  assert.equal(blocked.result().perPlayer.p1.coins, 0);

  const other = battle([{ ...mark, enemyId: 'enemy_2086_skzjxb' }]);
  other.step();
  assert.equal(other.unit('enemy_2086_skzjxb'), null);
  assert.equal(other.unit(CHEST), null);
  other.runToEnd(4);
  assert.equal(other.result().perPlayer.p1.commandChests, undefined);
  assert.equal(other.result().perPlayer.p1.coins, 0);
});

test('the chest follows the field mapping on a hidden half and a unite offset', () => {
  const mark = { id: 17, row: 9, col: 8, enemyId: CHEST, coin: 1, persistent: true };
  const hidden = makeBattle({ data, content: 'full', autoFinish: false, timeLimit: 2, kind: 'hidden',
    players: [{ playerId: 'p1', seat: 0, side: 'R', units: [unit(1)], bonds: {}, commandMarks: [mark] }] });
  hidden.step();
  const right = hidden.unit(CHEST);
  assert.equal(right.y, 2);
  assert.equal(right.x, GEO.COLS - 1 - 8);
  const unite = makeBattle({ data, content: 'full', autoFinish: false, timeLimit: 2, kind: 'unite',
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 8, units: [unit(1)], bonds: {}, commandMarks: [mark] }] });
  unite.step();
  const helper = unite.unit(CHEST);
  assert.equal(helper.y, 9);
  assert.equal(helper.x, 16);
});

test('bond replacements resolve by effect id in both directions and stay per player', () => {
  const from = raw.bonds.yanShip.effectId, to = from.endsWith('_2') ? from.slice(0, -2) : `${from}_2`;
  assert.ok(raw.effects[to]);
  const h = battle([], { bondEffectOverrides: { [from]: to } });
  assert.equal(playerBondRecord(h.b, 'p1', 'yanShip').effectId, to);
  assert.equal(playerBondRecord(h.b, 'absent', 'yanShip').effectId, from);
  assert.equal(raw.bonds.yanShip.effectId, from);
});

test('treasure result validation rejects absent, duplicate, foreign and non-boolean receipts', () => {
  const spec = buildBattleSpec({ battleId: 'command', fieldId: 'n:p1', kind: 'normal', round: 2, stageId: 'flat', timeLimit: 2,
    players: [{ playerId: 'p1', units: [], commandMarks: [{ id: 17, enemyId: 'chest', persistent: true, coin: 2 }] }], spawns: [] });
  const raw = { reason: 'timeout', time: 2, perPlayer: { p1: { killed: 0, total: 0, leaked: [], perfect: true,
    layerGains: {}, coins: 2, unitsEnd: [], commandChests: [{ id: 17, alive: true }] } } };
  assert.equal(validateClientResult(spec, raw).ok, true);
  for (const receipt of [undefined, [], [{ id: 17, alive: true }, { id: 17, alive: true }], [{ id: 18, alive: true }], [{ id: 17, alive: 1 }]]) {
    const bad = structuredClone(raw); bad.perPlayer.p1.commandChests = receipt;
    assert.equal(validateClientResult(spec, bad).reason, 'command chests');
  }
});

test('Chen regulation passive grants elite attack/speed and applies weakness damage to melee operators too', () => {
  const band = raw.bands.band_weakness;
  const h = battle([], { bandId: band.bandId, commandEffectId: band.effectId,
    units: [unit(1), { ...unit(2, 6), chessId: Object.values(raw.chess).find(c => c.isGolden && !c.isDiy && c.position === 'MELEE').chessId }] });
  h.step(); const normal = h.unit(1), elite = h.unit(2);
  assert.equal(normal.s.atk, normal.base.atk);
  const buff = elite.findBuff(`band:${band.bandId}:attributes`); assert.ok(buff);
  assert.equal(buff.mods.atkPct, 0.16); assert.equal(buff.mods.aspd, 16);
  const target = h.spawn('test_enemy', { pos: [10, 9] }); target.base.def = 900; target.base.res = 0; target.markDirty();
  const damage = { type: 'phys', amount: 500 };
  h.b.emit('hit', { source: normal, target, dmg: damage }); assert.equal(damage.type, 'arts');
  assert.equal(h.b.errorCount, 0);
});
