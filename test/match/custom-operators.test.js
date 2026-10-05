import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, legalTileFor } from './harness.js';
import { checkLoadout } from '../../shared/protocol.js';
import { customRuntimeId } from '../../shared/customOperators.js';
import { serializeExport, parseImport, sanitizeEntries } from '../../public/js/ui/loadoutModel.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { flatStage, makeBattle } from '../helpers/battleHarness.js';
import { PHASE } from '../../shared/constants.js';

const SLOT = 'chess_char_5_diy1_a';
const OTHER = 'chess_char_6_diy2_a';
const CHAR = 'char_293_thorns';
const lookup = (id) => DATA.chess[id] || null;
const seats = () => [0, 1].map((seat) => ({ seat, playerId: `p_${seat}`, name: `P${seat}`, connected: true,
  isBot: false, loadout: { [SLOT]: { charId: CHAR, skill: 2, module: 'none' } } }));

test('custom loadouts reject unsupported/repeated choices and survive export/import', () => {
  const entries = { [SLOT]: { charId: CHAR, skill: 2, module: 'none' } };
  assert.equal(checkLoadout(entries, lookup).ok, true);
  assert.equal(checkLoadout({ [SLOT]: { charId: 'char_not_supported' } }, lookup).error, 'BAD_TARGET');
  assert.equal(checkLoadout({ ...entries, [OTHER]: { charId: CHAR } }, lookup).error, 'BAD_TARGET');
  assert.equal(checkLoadout({ [SLOT]: { charId: CHAR, module: 'uniequip_002_ifrit' } }, lookup).error, 'BAD_TARGET');
  const imported = parseImport(serializeExport(entries));
  assert.equal(imported.ok, true);
  assert.deepEqual(sanitizeEntries(imported.entries, lookup), entries);
});

test('same custom choice has independent copies per player, merges and returns its own stock', () => {
  const h = makeMatch({ seats: seats() }).start().toPrep();
  try {
    const { m } = h;
    const a = h.ps('p_0'), b = h.ps('p_1');
    const aid = customRuntimeId(SLOT, CHAR, 0), bid = customRuntimeId(SLOT, CHAR, 1);
    assert.equal(m.pool.cap(aid), 8);
    assert.equal(m.pool.cap(bid), 8);
    const piece = a.acquireChess(aid);
    const [row, col] = legalTileFor(m, a, aid);
    assert.equal(a.move(piece.uid, { area: 'board', row, col }).ok, true);
    a.acquireChess(aid);
    a.acquireChess(aid);
    const elite = [...a.board.values()].find((p) => p.kind === 'chess');
    assert.equal(elite.id, customRuntimeId(SLOT, CHAR, 0, true));
    assert.equal(m.pool.left(aid), 5);
    assert.equal(m.pool.left(bid), 8);
    assert.equal(b.acquireChess(aid), null);
    const stock = m.pool.left(bid);
    assert.equal(a.sell(elite.uid).ok, true);
    assert.equal(m.pool.left(aid), 8);
    assert.equal(m.pool.left(bid), stock);
    for (const ps of [a, b]) {
      ps.shop.level = 6;
      for (let n = 0; n < 80; n++) {
        const rec = m.gd.chess(ps._rollChessSlot()?.id);
        if (rec?.isDiy) assert.equal(rec.customOwner, ps.playerId);
      }
    }
    h.invariants();
  } finally { h.m.dispose(); }
});

test('custom choices can change during briefing but not rewrite a running match', () => {
  const h = makeMatch({ seats: seats() }).start();
  try {
    assert.equal(h.m.phase, PHASE.INFO_CHECK);
    const loadout = { [SLOT]: { charId: 'char_112_siege', skill: 1, module: 'none' } };
    assert.equal(h.m.setLoadout('p_0', loadout).ok, true);
    assert.equal(h.m.gd.chess(customRuntimeId(SLOT, 'char_112_siege', 0)).name, '推进之王');
    assert.equal(h.m.pool.has(customRuntimeId(SLOT, CHAR, 0)), false);
    assert.equal(h.m.pool.has(customRuntimeId(SLOT, CHAR, 1)), true);
    h.toPrep();
    assert.equal(h.m.setLoadout('p_0', {}).error, 'WRONG_PHASE');
    assert.deepEqual(h.ps('p_0').loadout, loadout);
  } finally { h.m.dispose(); }
});

test('custom battle spec uses the selected skill identically in server and browser data sources', () => {
  const h = makeMatch({ seats: seats() }).start().toPrep();
  try {
    const ps = h.ps('p_0');
    const id = customRuntimeId(SLOT, CHAR, 0, true);
    const piece = ps.acquireChess(id);
    ps.board.set('10,4', piece);
    ps.recompute();
    const spec = buildBattleSpec({ seed: 31, fieldId: 'custom-smoke', kind: 'normal', players: [ps.battleInput()],
      stageId: 'flat', timeLimit: 3, content: 'full', flags: { startOpCooldown: 0 },
      spawns: [{ enemyKey: 'enemy_1007_slime', pos: [10,5], count: 1, time: 0, mods: { hpMul: 1000, speedMul: 0 } }] });
    const raw = { ...DATA, stages: { ...DATA.stages, flat: flatStage() } };
    const browserData = new DataSource(raw);
    const server = createBattleFromSpec(spec, new DataSource({ ...h.m.data, stages: raw.stages }), { quiet: true });
    const browser = createBattleFromSpec(spec, browserData, { quiet: true });
    server.start(); browser.start();
    for (const battle of [server, browser]) {
      const unit = battle.allyUnits.find((u) => u.uid === piece.uid);
      assert.equal(unit.skill.id, 'skchr_thorns_3');
      assert.equal(unit.def.raw.garrisonIds.length, 0);
      unit.skill.activate('smoke', { free: true });
      for (let n = 0; n < 60; n++) battle.step();
      battle.forceEnd('forced');
      assert.equal(unit.stats.dmg > 0, true);
      assert.equal(battle.errorCount, 0);
    }
    assert.deepEqual(resultDigest(server.result()), resultDigest(browser.result()));
  } finally { h.m.dispose(); }
});

test('selection catalog: candidates never duplicate a pool operator and every candidate composes its four slots', () => {
  const catalog = DATA['custom-operators'];
  const ids = Object.keys(catalog);
  assert.ok(ids.length >= 60, `candidates ${ids.length}`);
  const poolCharIds = new Set(Object.values(DATA.chess).map((c) => c.charId).filter(Boolean));
  for (const charId of ids) {
    assert.ok(!poolCharIds.has(charId), `${charId} is already a season pool operator`);
    const rec = catalog[charId];
    assert.equal(rec.charId, charId);
    assert.deepEqual(Object.keys(rec.variants).sort(), ['5_a', '5_b', '6_a', '6_b'], charId);
    const golden = rec.variants['6_b'];
    assert.ok(golden.stats && golden.stats.atk > 0 && golden.stats.maxHp > 0, charId);
    assert.ok(Array.isArray(golden.skills) && golden.skills.length >= 1, charId);
    assert.ok(golden.module?.active, `${charId} elite module`);
    assert.ok(golden.trait && Array.isArray(golden.talents), charId);
  }
  const lookup = (id) => DATA.chess[id] || null;
  for (const charId of ['char_2027_wang', 'char_4182_oblvns', 'char_4037_demetr']) {
    assert.ok(catalog[charId], `${charId} is offered`);
    const res = checkLoadout({ [SLOT]: { charId, skill: 0, module: 'none' } }, lookup);
    assert.equal(res.ok, true, `${charId}: ${res.error}${res.detail ? ` (${res.detail})` : ''}`);
  }
});

test('every selection candidate runs a real battle with every selectable skill, no content errors', () => {
  const catalog = DATA['custom-operators'];
  const data = new DataSource(DATA);
  const SLOT6 = 'chess_char_6_diy1_a';
  let battles = 0;
  for (const [charId, rec] of Object.entries(catalog)) {
    const id = customRuntimeId(SLOT6, charId, 0, true);
    assert.ok(id, charId);
    for (const skill of rec.variants['6_b'].skills) {
      const h = makeBattle({
        data, autoFinish: false, timeLimit: 4,
        units: [{ chessId: id, skillIndex: skill.index, moduleId: 'none', row: 10, col: 4 }],
        enemies: [{ key: 'enemy_1007_slime', pos: [10, 5], mods: { hpMul: 1000, atkMul: 0, speedMul: 0 } }],
      }).step();
      const u = h.unit(id);
      assert.ok(u, `${charId} ${skill.skillId} deploys`);
      assert.equal(u.skill.id, skill.skillId, charId);
      if (u.skill.kind !== 'passive') u.skill.activate('smoke', { free: true });
      h.run(1.2);
      assert.equal(h.b.errorCount, 0, `${charId} ${skill.skillId}: content error`);
      h.invariants();
      battles++;
    }
  }
  assert.ok(battles >= Object.keys(catalog).length * 2, `ran ${battles} battles`);
});
