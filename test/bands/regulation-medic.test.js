import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch } from '../match/harness.js';
import { openSkillChangeDraft, beginCommandPrep, commandSkill } from '../../server/match/bandCommands.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { DataSource } from '../../server/sim/simdata.js';
import { fileURLToPath } from 'node:url';

const data = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {} } });
const legacyData = loadData(fileURLToPath(new URL('../../data/versions/act2autochess-v2_1', import.meta.url)), { log: { warn() {} } });
const medicRecipient = chessRec({
  id: 'test_medic_recipient', profession: 'TANK', position: 'MELEE', skill: null,
  stats: { maxHp: 5000, atk: 0, def: 100, blockCnt: 1, respawnTime: 0 },
  rangeGrid: [[0, 0]],
});
const battleData = new DataSource({ ...data, chess: { ...data.chess, [medicRecipient.chessId]: medicRecipient } });
before(() => setGameData(data));
after(() => setGameData(null));

function createMatch(t, matchData = data, humans = 3) {
  const h = makeMatch({ data: matchData, mode: 'coop', humans, bots: 0, fake: true, seed: 241, registry: createRegistry() }).start();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  h.toPrep(1);
  return h;
}

function setBand(ps, bandId) {
  ps.bandId = bandId;
  ps.funds = 100;
  ps.commandDrafts = [];
  ps.recompute();
  beginCommandPrep(ps);
}

function chooseCommand(ps, choiceId, effectId) {
  const opened = openSkillChangeDraft(ps, choiceId, { rng: { shuffle(pool) {
    const first = pool.find(row => row.effectId === effectId);
    assert.ok(first, `${effectId} must be in the current command pool`);
    return [first, ...pool.filter(row => row !== first)];
  } } });
  assert.ok(opened);
  const draft = ps.commandDrafts[0];
  assert.equal(draft.cards[0], effectId);
  assert.ok(ps.pickCommand(draft.id, 0).ok);
  assert.equal(commandSkill(ps).effectId, effectId);
}

function candidateIds(ps, choiceId) {
  let ids = null;
  const before = ps.commandDrafts?.length || 0;
  const opened = openSkillChangeDraft(ps, choiceId, { rng: { shuffle(pool) {
    ids = pool.map(row => row.effectId);
    return pool;
  } } });
  assert.ok(opened, `${choiceId} must open a draft`);
  assert.equal(ps.commandDrafts.length, before + 1);
  assert.equal(ps.commandDrafts[before].choiceId, choiceId);
  ps.commandDrafts.splice(before, 1);
  return ids;
}

function battleInputFor(ps) {
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  ps.m.dispatch(ps, 'onBattleStart', { kind: 'normal', input });
  return input;
}

test('one live Touch command grants team medics, locks the pool, and allows a teammate to take over', t => {
  const h = createMatch(t);
  h.setStage('act3autochess_m01');
  const [holder, teammate, recipient] = ['p_0', 'p_1', 'p_2'].map(id => h.ps(id));
  setBand(holder, 'band_support');
  for (const ps of [teammate, recipient]) setBand(ps, 'band_amiya');

  chooseCommand(holder, 'skill_change_1', 'aceffect_band_61');
  assert.deepEqual(h.m.teamMedicVariants(), [
    { cond: 'condition_golden_chess_le', cnt: 1, chars: ['char_605_cmedic'] },
    { cond: 'condition_golden_chess_ge', cnt: 2, chars: ['char_613_acmedc'] },
  ]);
  for (const ps of [holder, teammate, recipient]) {
    assert.ok(ps.privateView().prepMapChars.some(unit => unit.defId === 'char_605_cmedic'), ps.playerId);
  }

  for (const choiceId of ['skill_change_1', 'skill_change_2']) {
    assert.ok(!candidateIds(teammate, choiceId).includes('aceffect_band_61'),
      `${choiceId} excludes Touch while another teammate currently has it`);
  }

  const input = battleInputFor(recipient);
  assert.deepEqual(input.contentInfo.medicVariants, h.m.teamMedicVariants());
  assert.ok(!input.contentInfo.matchBands.includes('band_amedic'), 'the grant does not masquerade as a strategy identity');
  input.units = [{ uid: 9001, kind: 'chess', chessId: 'test_medic_recipient', row: 10, col: 3 }];
  const battle = makeBattle({
    data: battleData,
    stageId: h.m.stageId,
    players: [input],
    autoFinish: false,
    timeLimit: 20,
  });
  battle.step();
  const medic = battle.unit('char_605_cmedic');
  const ally = battle.unit('test_medic_recipient');
  assert.ok(medic?.alive && ally?.alive);
  assert.equal(medic.def.attackKind, 'heal');
  const damaged = ally.hp - 1000;
  battle.b.dealHPLose({ source: null, target: ally, amount: 1000 });
  assert.equal(ally.hp, damaged);
  battle.run(8);
  assert.ok(ally.hp > damaged, 'the granted map medic can heal a teammate in the real battle sim');

  chooseCommand(holder, 'skill_change_2', 'aceffect_band_22');
  assert.equal(h.m.teamMedicGranted(), false, 'the grant ends when the current Touch command is replaced');
  assert.equal(recipient.privateView().prepMapChars.some(unit => unit.defId === 'char_605_cmedic'), false);

  for (const choiceId of ['skill_change_1', 'skill_change_2']) {
    assert.ok(candidateIds(teammate, choiceId).includes('aceffect_band_61'),
      `${choiceId} restores Touch after its only current holder swaps out`);
  }
  chooseCommand(teammate, 'skill_change_1', 'aceffect_band_61');
  assert.equal(h.m.teamMedicGranted(), true, 'another teammate can take over the team grant');
  assert.ok(recipient.privateView().prepMapChars.some(unit => unit.defId === 'char_605_cmedic'));

  chooseCommand(teammate, 'skill_change_2', 'aceffect_band_22');
  assert.equal(h.m.teamMedicGranted(), false, 'the team grant disappears when the replacement holder swaps out');
  const swappedOut = battleInputFor(recipient);
  assert.deepEqual(swappedOut.contentInfo.medicVariants, [], 'an empty grant is explicit in battle contentInfo');
  const noMedic = makeBattle({ data: battleData, stageId: h.m.stageId, players: [swappedOut], autoFinish: false, timeLimit: 2 });
  noMedic.step();
  assert.equal(noMedic.unit('char_605_cmedic'), null, 'the map medic no longer appears after the swap');
});

test('a swapped-out original Touch strategy no longer blocks Touch from another player\'s pool', t => {
  const h = createMatch(t, data, 2);
  const holder = h.ps('p_0'), teammate = h.ps('p_1');
  setBand(holder, 'band_amedic');
  setBand(teammate, 'band_amiya');
  assert.equal(commandSkill(holder).effectId, 'aceffect_band_61');
  assert.equal(h.m.teamMedicGranted(), true);

  chooseCommand(holder, 'skill_change_1', 'aceffect_band_22');
  assert.equal(commandSkill(holder).effectId, 'aceffect_band_22');
  assert.equal(h.m.teamMedicGranted(), false, 'the original strategy does not keep the swapped-out command active');
  assert.ok(candidateIds(teammate, 'skill_change_2').includes('aceffect_band_61'),
    'the pool checks current commands rather than the original strategy identity');
  chooseCommand(teammate, 'skill_change_2', 'aceffect_band_61');
  assert.equal(h.m.teamMedicGranted(), true);
});

test('historical no-skills Touch data retains its original strategy-wide grant', t => {
  const h = createMatch(t, legacyData, 2);
  h.setStage('act2autochess_m01');
  const holder = h.ps('p_0'), recipient = h.ps('p_1');
  setBand(holder, 'band_amedic');
  assert.equal(holder.command, null, 'this historical version has no command skill rows');
  assert.equal(h.m.teamMedicGranted(), true);
  assert.ok(recipient.privateView().prepMapChars.some(unit => unit.defId === 'char_605_cmedic'));
  const input = battleInputFor(recipient);
  assert.equal(input.contentInfo.medicVariants.length, 2);
  assert.deepEqual(input.contentInfo.medicVariants.map(v => v.chars), [['char_605_cmedic'], ['char_613_acmedc']]);
});
