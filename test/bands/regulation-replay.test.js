import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData, getData, setData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { replayTestMatch } from '../../server/match/testReplay.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

test('regulation command journal replays seeded use, targeted marks, refusal and reconnect snapshots', t => {
  const previous = getData(), data = getVersionData('act3autochess@V3_1');
  setData(data); setGameData(data); t.after(() => { setData(previous); setGameData(null); });
  const scheduler = new VirtualScheduler(), entries = [];
  const m = new Match({ mode: 'solo', difficulty: 'FUNNY', version: 'act3autochess@V3_1', test: true, hostId: 'p', seed: 137,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data, scheduler, registry: createRegistry(),
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
  t.after(() => m.dispose()); m.start();
  const ok = msg => assert.deepEqual(m.handle('p', msg), { ok: true });
  ok({ t: 'g.infoReady' });
  scheduler.runUntil(() => m.phase === 'BAND_DRAFT');
  ok({ t: 'g.test', cmd: 'strategy', args: { id: 'band_fund' } });
  assert.ok(scheduler.runUntil(() => m.phase === 'CUSTOM_CHECK'));
  ok({ t: 'g.diyBring', slots: [] });
  assert.ok(scheduler.runUntil(() => m.phase === 'PREP'));
  ok({ t: 'g.test', cmd: 'timers', args: { on: false } });
  const ps = m.players.get('p');
  ok({ t: 'g.command', effectId: ps.command.currentEffectId, target: {} });
  assert.ok(m.handle('p', { t: 'g.command', effectId: ps.command.currentEffectId, target: {} }).error);
  ok({ t: 'g.test', cmd: 'strategy', args: { id: 'band_survive' } });
  ok({ t: 'g.test', cmd: 'funds', args: { amount: 10 } });
  const id = Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.tier === 2).chessId;
  ok({ t: 'g.test', cmd: 'chess', args: { id } });
  const uid = ps.privateView().command.targets[0].uid;
  ok({ t: 'g.command', effectId: ps.command.currentEffectId, target: { uid } });
  const copy = replayTestMatch(data, entries, { registry: createRegistry() }); t.after(() => copy.dispose());
  const replayed = copy.players.get('p');
  assert.deepEqual(replayed.command, ps.command); assert.deepEqual(replayed.commandMarks, ps.commandMarks);
  assert.deepEqual(copy.rngMeta.state(), m.rngMeta.state()); assert.deepEqual(replayed.privateView(), ps.privateView());
  assert.equal(copy.errorCount, 0);
});

test('a placed treasure survives journal replay and the reconnect snapshot', t => {
  const previous = getData(), data = getVersionData('act3autochess@V3_1');
  setData(data); setGameData(data); t.after(() => { setData(previous); setGameData(null); });
  const scheduler = new VirtualScheduler(), entries = [];
  // 极速模拟 (mode_single_funny) lists band_treasure in inactiveModeIds. 规程等级 1 offers it.
  const m = new Match({ mode: 'solo', difficulty: 'FUNNY', modeId: 'mode_single_1', version: 'act3autochess@V3_1', test: true, hostId: 'p', seed: 211,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data, scheduler, registry: createRegistry(),
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } } });
  t.after(() => m.dispose()); m.start();
  const ok = msg => assert.deepEqual(m.handle('p', msg), { ok: true });
  ok({ t: 'g.infoReady' });
  scheduler.runUntil(() => m.phase === 'BAND_DRAFT');
  ok({ t: 'g.test', cmd: 'strategy', args: { id: 'band_treasure' } });
  assert.ok(scheduler.runUntil(() => m.phase === 'CUSTOM_CHECK'));
  ok({ t: 'g.diyBring', slots: [] });
  assert.ok(scheduler.runUntil(() => m.phase === 'PREP'));
  ok({ t: 'g.test', cmd: 'timers', args: { on: false } });
  ok({ t: 'g.test', cmd: 'funds', args: { amount: 10 } });
  const ps = m.players.get('p');
  const target = ps.privateView().command.targets[0];
  ok({ t: 'g.command', effectId: ps.command.currentEffectId, target });
  const shown = ps.privateView().prepMapChars.find(u => u.defId === 'enemy_9038_achest');
  assert.ok(shown); assert.equal(shown.x, target.col); assert.equal(shown.y, target.row);
  const copy = replayTestMatch(data, entries, { registry: createRegistry() }); t.after(() => copy.dispose());
  const replayed = copy.players.get('p');
  assert.deepEqual(replayed.commandMarks, ps.commandMarks);
  assert.deepEqual(replayed.privateView().prepMapChars, ps.privateView().prepMapChars);
  assert.deepEqual(replayed.privateView(), ps.privateView());
  assert.equal(copy.errorCount, 0);
});
