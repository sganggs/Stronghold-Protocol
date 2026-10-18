// Pure scenario/spec and mocked studio HTTP tests. No listening ports or browser required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fixture } from '../helpers/contentFixtures.js';
import { readStudioData } from '../../server/studio/gameData.js';
import { buildConsoleScenario, consoleOptions } from '../../server/studio/console.js';
import { createStudio } from '../../server/studio/index.js';
import { newScenario, emptyPlayer, parseScenario, SCENARIO_BYTES } from '../../shared/studio/scenario.js';
import { GameData } from '../../server/match/gamedata.js';
import { diyGameData } from '../../server/match/player/diy.js';
import { createRng } from '../../server/sim/rng.js';
import { buildNormalWave, setupMatchWaves } from '../../server/match/waves.js';
import { DataSource, setSimData } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { makeRunner, makeLog, observeCombat, observeEffects, inspectUnit, pauseIfHidden } from '../../public/studio/js/console/runtime.js';
import { deviceOptionName, devicePos, lockedModuleLabel, modeOptionLabel, moduleOptionName, moduleOptions, skillOptionName, tokenRemaining, routeLabel } from '../../public/studio/js/console/labels.js';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { scenarioText } from '../../public/studio/js/console/problems.js';
import { checkInvariants } from '../helpers/battleHarness.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';
import { advanceEffectClock } from '../../public/js/render/app/playback.js';

const raw = readStudioData(path.resolve('data'));
setSimData(raw); setGameData(raw);
const ds = new DataSource(raw);
const build = s => buildConsoleScenario(s, raw);
const op = (id = 'chess_char_1_01_a', uid = 1, row = 12, col = 4) => ({ uid, kind: 'chess', chessId: id, row, col, dir: 'RIGHT', items: [] });
const reject = (s, field) => assert.throws(() => build(s), e => e.code === 'PLUGIN_STUDIO_CONSOLE_SCENARIO' && (!field || e.params.path.includes(field)));
const scenario = () => { const s = newScenario(); s.players[0].units.push(op()); return s; };

test('JSON round-trip, schema version, byte cap, prototype keys and unknown fields', () => {
  const s = newScenario(); assert.deepEqual(parseScenario(JSON.stringify(s)), s);
  for (const text of ['{', 'null', '[]', JSON.stringify({ ...s, v: 2 }), JSON.stringify({ ...s, scripts: [] }), '{"__proto__":{}}', ' '.repeat(SCENARIO_BYTES + 1)]) assert.throws(() => parseScenario(text));
  assert.throws(() => parseScenario(JSON.stringify({ ...s, name: '炎'.repeat(180000) })));
});

test('reject malformed, oversized and non-finite numeric input without coercion', () => {
  for (const patch of [{ seed: 0 }, { seed: 4294967296 }, { round: '1' }, { seconds: NaN }, { seconds: Infinity }, { seconds: 1201 }, { flags: { dpInit: 100 } }, { players: [] }]) reject({ ...newScenario(), ...patch });
  const s = newScenario(); s.enemies = Array.from({ length: 6 }, () => ({ enemyKey: 'enemy_1007_slime', count: 100, routeIndex: 0, time: 0, interval: 1 })); reject(s, 'enemies');
});

test('official normal wave and difficulty scaling are exactly the match generator', () => {
  for (const modeId of Object.keys(raw.config.modes)) for (const round of [1, 3, 7]) {
    const s = { ...newScenario(), modeId, round, seed: 179 };
    const gd = new GameData(raw, modeId), rng = createRng(s.seed), setup = setupMatchWaves(gd, rng);
    const expected = buildNormalWave(gd, rng, setup, round);
    if (!expected.routes.length) continue;
    const { spec } = build(s);
    assert.equal(spec.waveId, expected.templateId);
    assert.deepEqual(spec.spawns, expected.spawns);
    assert.equal(spec.timeLimit, Math.min(s.seconds, expected.timeLimit));
  }
});

test('every official map and four field regions builds and steps real battle code', () => {
  for (const stageId of Object.keys(raw.stages)) for (const kind of ['normal', 'boss', 'hidden', 'unite']) {
    const s = { ...newScenario(), stageId, kind, round: kind === 'hidden' ? 15 : kind === 'boss' ? 14 : 1 };
    if (kind !== 'normal') s.players.push(emptyPlayer());
    const { spec } = build(s), b = createBattleFromSpec(spec, ds, { quiet: true });
    b.start(); for (let i = 0; i < 30; i++) b.step();
    assert.deepEqual(b.errors, [], `${stageId} ${kind}`); checkInvariants(b);
  }
});

test('all ten leaders use the official templates and shared pool scaling', () => {
  for (const boss of Object.values(raw.bosses)) for (const n of [1, 2]) {
    const s = { ...newScenario(), kind: boss.hidden ? 'hidden' : 'boss', round: boss.hidden ? 15 : 14, bossId: boss.bossId, modeId: 'mode_multi_hard', players: Array.from({ length: n }, emptyPlayer) };
    const { spec } = build(s);
    assert.equal(spec.boss.poolMax, new GameData(raw, s.modeId).bossPoolHp(boss.bossId, n));
    assert.equal(raw.waves[spec.waveId].bossId, boss.bossId);
    assert.ok(spec.spawns.some(e => e.enemyKey === boss.enemyKey && e.tag === 'boss'));
    assert.ok(spec.spawns.filter(e => e.tag === 'boss').every(e => e.mods.hpMul === undefined));
  }
});

test('custom schedule preserves count, timing and gate, with round scaling', () => {
  const s = { ...newScenario(), enemyMode: 'custom', round: 7, modeId: 'mode_single_hard', enemies: [{ enemyKey: 'enemy_1007_slime', count: 3, routeIndex: 1, time: 2.5, interval: 1.25 }] };
  const { spec } = build(s), e = spec.spawns[0];
  assert.equal(e.count, 3); assert.equal(e.time, 2.5); assert.equal(e.interval, 1.25); assert.equal(e.routeIndex, 1);
  assert.equal(e.mods.hpMul, new GameData(raw, s.modeId).enemyScale(7).hpMul);
  for (const patch of [{ enemyKey: 'missing' }, { routeIndex: 255 }, { count: -1 }]) { const bad = structuredClone(s); Object.assign(bad.enemies[0], patch); reject(bad); }
  reject({ ...s, enemyMode: 'official' }, 'enemies');
});

test('leader mismatch and unsupported field/template combinations are refused', () => {
  reject({ ...newScenario(), bossId: 'boss_1' }, 'bossId');
  reject({ ...newScenario(), kind: 'boss', bossId: 'boss_8' }, 'bossId');
  reject({ ...newScenario(), waveId: 'act1autochess_h07_01' }, 'waveId');
  reject({ ...newScenario(), kind: 'unite', waveId: 'act1autochess_01' }, 'waveId');
  reject({ ...newScenario(), stageId: 'constructor' }, 'stageId');
});

test('legal ground/high tiles, facing and duplicate tiles/UIDs are checked', () => {
  const s = scenario(); build(s);
  const occupied = structuredClone(s); occupied.players[0].units.push(op(undefined, 2)); reject(occupied, 'unit');
  const same = structuredClone(s); same.players[0].units.push(op(undefined, 1, 12, 5)); reject(same, 'uid');
  for (const patch of [{ row: 0 }, { col: 9 }, { dir: 'SIDEWAYS' }, { chessId: 'missing' }]) {
    const bad = structuredClone(s); Object.assign(bad.players[0].units[0], patch); reject(bad);
  }
});

test('equipment, elite skill, module, cultivation and carry state survive the spec', () => {
  const s = scenario(), u = s.players[0].units[0];
  u.chessId = raw.chess[u.chessId].goldenId;
  u.skillIndex = raw.chess[u.chessId].skills[0].index; u.moduleId = 'none'; u.potential = 3; u.cultivate = 2;
  u.items = ['chess_item_1_01_e_a']; u.carryState = { hpPct: 0.25, sp: 3 };
  const { spec } = build(s); assert.deepEqual(spec.players[0].units[0], u);
  const b = createBattleFromSpec(spec, ds, { quiet: true }); b.start();
  assert.equal(b.allyUnits.find(v => v.uid === u.uid).def.golden, true);
  const details = inspectUnit(b.allyUnits.find(v => v.uid === u.uid)); assert.ok(details.atk > 0); assert.ok(Array.isArray(details.buffs));
  for (const patch of [{ skillIndex: 9 }, { moduleId: 'fake' }, { items: ['missing'] }, { potential: 7 }]) {
    const bad = structuredClone(s); Object.assign(bad.players[0].units[0], patch); reject(bad);
  }
});

test('all ordinary/elite chess and selectable skills can build on a legal tile', () => {
  const map = build(newScenario()).maps[0];
  for (const rec of Object.values(raw.chess).filter(c => !c.isDiy)) for (const skill of rec.skills || [rec.skill]) {
    const s = newScenario(); const tile = map.find(v => v.type === 'melee');
    s.players[0].units = [{ ...op(rec.chessId, 1, tile.row, tile.col), skillIndex: skill.index }];
    assert.equal(build(s).spec.players[0].units[0].skillIndex, skill.index);
  }
});

test('tokens require a deployed owner, selected skill, legal owner range and stock limit', () => {
  const s = newScenario(); s.players[0].units = [op('chess_char_3_19_a', 1, 10, 4)];
  const info = build(s).tokens[0][0]; assert.equal(info.tokenId, 'token_10028_vigil_wolf');
  const token = { uid: 2, kind: 'token', tokenId: info.tokenId, ownerUid: 1, row: 10, col: 7, dir: 'RIGHT' };
  s.players[0].units.push(token); const { spec } = build(s);
  const b = createBattleFromSpec(spec, ds, { quiet: true }); b.start(); assert.ok(b.allyUnits.some(u => u.kind === 'token' && u.deployed));
  for (const patch of [{ ownerUid: 99 }, { row: 12, col: 3 }, { items: [] }]) { const bad = structuredClone(s); Object.assign(bad.players[0].units[1], patch); reject(bad); }
  const copies = structuredClone(s); copies.players[0].units.push({ ...token, uid: 3, row: 9, col: 4 }); reject(copies, 'unit.tokenId');
  const silence = Object.values(raw.chess).find(c => c.charId === 'char_108_silent' && !c.isGolden);
  const other = newScenario(); other.players[0].units = [{ ...op(silence.chessId), skillIndex: 0 }];
  assert.equal(build(other).tokens[0].length, 0);
});

test('bond tiers/layers, band and gated battle choices are explicit', () => {
  const s = scenario(); s.players[0].bonds = { yanShip: { tier: 3, layers: 55 } }; s.players[0].bandId = 'band_amiya';
  const supported = consoleOptions(raw).choices.filter(c => c.supported);
  s.players[0].choices = supported.slice(0, 2).map(c => c.effectId);
  const { spec } = build(s); assert.deepEqual(spec.players[0].bonds.yanShip, { count: 9, active: true, tier: 3, layers: 55 });
  assert.equal(spec.players[0].playerEffects.length, 2);
  const bad = structuredClone(s); bad.players[0].bonds.yanShip.tier = 4; reject(bad, 'bonds');
  bad.players[0].bonds = {}; bad.players[0].choices = [consoleOptions(raw).choices.find(c => !c.supported).effectId]; reject(bad, 'choices');
});

test('summon stock uses match rules for all regular/elite owners and DIY modules', () => {
  const gd = new GameData(raw);
  for (const rec of Object.values(raw.chess).filter(c => !c.isDiy && c.tokens?.length)) {
    const s = newScenario(); s.players[0].units = [op(rec.chessId)];
    assert.deepEqual(build(s).tokens[0].map(({tokenId,count}) => ({tokenId,count})), gd.placeableTokens(rec.chessId), rec.chessId);
  }
  const s = newScenario(), u = { ...op('chess_char_6_diy1_a'), diy: { charId: 'char_248_mgllan', skillIndex: 0, uniEquipId: null }, potential: 3 };
  s.players[0].units = [u];
  const def = ds.getChess(u.chessId, u); assert.ok(def);
  const expected = diyGameData(gd, new Map([[u.chessId, def.raw]])).placeableTokens(u.chessId, def.loadout);
  assert.ok(expected.length);
  assert.deepEqual(build(s).tokens[0].map(({tokenId,count}) => ({tokenId,count})), expected);
});

test('DIY and stand-in identity, condition facts and unsupported loadout fields', () => {
  const s = newScenario(); s.players[0].units = [{ ...op('chess_char_5_diy1_a'), diy: { charId: 'char_601_cguard' } }];
  let b = createBattleFromSpec(build(s).spec, ds, { quiet: true }); b.start();
  assert.equal(b.allyUnits.find(u => u.uid === 1).def.charId, 'char_601_cguard');
  s.players[0].units[0].cultivate = 1; reject(s, 'unit.diy');
  s.players[0].units = [{ ...op('chess_char_3_01_a'), standIn: true }];
  s.players[0].facts = { shopLevel: 6, funds: 50, handChess: 2, roundStats: { refreshes: 5 }, extraBands: ['band_amiya'] };
  s.players[0].handUnits = 2;
  const { spec } = build(s); assert.equal(spec.players[0].contentInfo.funds, 50);
  assert.deepEqual(spec.players[0].contentInfo.roundStats, { refreshes: 5 });
  assert.deepEqual(spec.players[0].contentInfo.matchBands, ['band_amiya']);
  b = createBattleFromSpec(spec, ds, { quiet: true }); b.start();
  assert.equal(b.allyUnits.find(u => u.uid === 1).def.standInFor, raw.chess.chess_char_3_01_a.charId);
  s.players[0].units[0].potential = 6; reject(s, 'standIn');
  delete s.players[0].units[0].potential; s.players[0].facts.handChess = 3; reject(s, 'handChess');
});

test('second unite board reads its own terrain and disallows other fields device aliases', () => {
  const s = { ...newScenario(), kind: 'unite', players: [emptyPlayer(), emptyPlayer()] };
  const tile = build(s).maps[1].find(v => v.type === 'melee' && v.col > 2); assert.ok(tile);
  s.players[1].units = [op(undefined, 2, tile.row, tile.col)];
  const b = createBattleFromSpec(build(s).spec, ds, { quiet: true }); b.start();
  const u = b.allyUnits.find(v => v.uid === 2); assert.equal(u.tileC, tile.col + 8); assert.equal(u.tileR, tile.row);
  const foreign = raw.stages[s.stageId].devices.find(d => d.pos[0] < 6); assert.ok(foreign);
  s.players[1].deviceOverrides[foreign.alias] = false; reject(s, 'deviceOverrides');
});

test('device overrides reject arbitrary aliases and change placement legality', () => {
  const s = newScenario(); const crate = raw.stages[s.stageId].devices.find(d => d.role === 'crate' && d.pos[0] >= 9 && d.pos[0] <= 12 && d.pos[1] <= 10 && d.active);
  assert.ok(crate);
  assert.ok(!build(s).maps[0].some(t => t.row === crate.pos[0] && t.col === crate.pos[1]));
  s.players[0].deviceOverrides[crate.alias] = false;
  assert.ok(build(s).maps[0].some(t => t.row === crate.pos[0] && t.col === crate.pos[1]));
  s.players[0].deviceOverrides.fake = true; reject(s, 'deviceOverrides');
});

test('bounties retain official enemy, spawn scaling and kill payout', () => {
  const card = raw.choices.cards.bounty.find(c => c.payout === 'kill'); const s = newScenario(); s.bounties = [card.effectId];
  const b = build(s).spec.spawns.filter(e => e.tag === 'bounty'); assert.ok(b.length); assert.ok(b.every(e => e.enemyKey === card.enemyKey));
  assert.equal(b.reduce((n, e) => n + e.count, 0), card.count); assert.equal(b[0].bounty.coins, card.coin);
});

test('restarts are deterministic and builders leave official data/input untouched', () => {
  const s = scenario(), before = JSON.stringify(s), stageBefore = JSON.stringify(raw.stages);
  const run = () => { const { spec } = build(s); const b = createBattleFromSpec(spec, ds, { quiet: true }); while (!b.finished) b.step(); return resultDigest(b.result()); };
  assert.deepEqual(run(), run()); assert.equal(JSON.stringify(s), before); assert.equal(JSON.stringify(raw.stages), stageBefore);
});

test('runner pauses, steps exactly 1/30 ticks, speeds and stops at a hard cap', () => {
  const b = createBattleFromSpec(build(scenario()).spec, ds, { quiet: true }), r = makeRunner(b, { cap: 3 });
  r.advance(1); assert.equal(b.time, 0); r.step(); assert.ok(Math.abs(b.time - 1 / 30) < 1e-9);
  r.step(30); assert.ok(Math.abs(b.time - 31 / 30) < 1e-9); r.speedTo(0.25); r.play();
  for (let i = 0; i < 4; i++) r.advance(0.1); assert.ok(Math.abs(b.time - 34 / 30) < 1e-9);
  r.pause(); r.advance(10); assert.ok(Math.abs(b.time - 34 / 30) < 1e-9);
  assert.throws(() => r.speedTo(100)); assert.throws(() => r.step(300000));
  r.speedTo(8); r.play(); for (let i = 0; i < 10; i++) r.advance(0.2);
  assert.equal(b.finished, true); assert.equal(r.playing, false); assert.ok(Math.abs(b.time - 3) < 1e-9);
});

test('preview shows the idle pose, drops the deploy beam and stays paused until the user plays', () => {
  const b = createBattleFromSpec(build(scenario()).spec, ds, { quiet: true });
  const frames = [];
  const r = makeRunner(b, { cap: 30, preview: true, onFrame: (snap, ev) => frames.push({ t: snap.t, ev }) });
  assert.ok(b.time + 1e-9 >= 0.5);
  assert.equal(r.playing, false);
  assert.equal(r.touched, false);
  const ally = b.allyUnits.find((u) => u.uid === 1);
  assert.ok(b.time - ally.deployedAt + 1e-9 >= 0.5);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ev.some((e) => e[0] === 'deploy'), false);
  const held = b.time;
  r.advance(1);
  assert.equal(b.time, held);
  pauseIfHidden(r, false);
  assert.equal(r.playing, false);
  r.play();
  pauseIfHidden(r, true);
  assert.equal(r.playing, false);
  assert.equal(r.touched, true);
});

test('preview keeps a view entry for every starting operator, summon and device', () => {
  const s = newScenario();
  s.players[0].units = [
    op('chess_char_3_19_a', 1, 10, 4),
    { uid: 2, kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 10, col: 7, dir: 'RIGHT' },
  ];
  const b = createBattleFromSpec(build(s).spec, ds, { quiet: true });
  const frames = [];
  const r = makeRunner(b, { cap: 30, preview: true, onFrame: (snap, ev) => frames.push({ snap, ev }) });
  assert.equal(frames.length, 1);
  assert.equal(r.playing, false);
  assert.equal(r.touched, false);
  assert.equal(frames[0].ev.some((e) => e[0] === 'deploy'), false);
  const infos = new Map();
  for (const e of frames[0].ev) {
    if (e[0] !== 'spawn') continue;
    const info = renderInfo(e[1]);
    assert.ok(info);
    infos.set(info.id, info);
  }
  const views = new Map();
  for (const tuple of frames[0].snap.units) {
    const id = tuple[0];
    const info = infos.get(id);
    views.set(id, info
      ? { id, kind: info.kind, defId: info.defId, spine: info.spine, unknown: false }
      : { id, kind: 'enemy', defId: null, spine: null, unknown: true });
  }
  const present = b.units.filter((u) => u.deployed && (u.kind === 'op' || u.kind === 'token' || u.kind === 'device'));
  assert.equal(present.filter((u) => u.kind === 'op').length > 0, true);
  assert.equal(present.filter((u) => u.kind === 'token').length > 0, true);
  assert.equal(present.filter((u) => u.kind === 'device').length > 0, true);
  for (const u of present) {
    const v = views.get(u.id);
    assert.ok(v, `${u.kind} ${u.defId}`);
    assert.equal(v.unknown, false, u.defId);
    assert.equal(v.defId, u.defId);
    assert.ok(v.spine, u.defId);
  }
});

test('device, module, token and route labels, and a named scenario error', () => {
  assert.equal(devicePos([11, 5]), '(11,5)');
  const mods = [{ uniEquipId: 'isw', typeName: 'ISW-A', name: '证章' }, { uniEquipId: 'mod', typeName: 'X', name: '模组' }];
  assert.deepEqual(moduleOptions(mods, true, 'isw').map((m) => m.uniEquipId), ['isw', 'mod']);
  assert.deepEqual(moduleOptions(mods, true, null).map((m) => m.uniEquipId), ['mod']);
  assert.equal(moduleOptions([], true, 'fixed')[0].uniEquipId, 'fixed');
  assert.equal(moduleOptions([], true, 'fixed')[0].name, 'fixed');
  const named = moduleOptions([], true, 'uniequip_002_acpion', '郁金香证章')[0];
  assert.equal(named.uniEquipId, 'uniequip_002_acpion');
  assert.equal(moduleOptionName(named), '郁金香证章');
  assert.equal(moduleOptionName({ uniEquipId: 'uniequip_002_acpion', name: 'uniequip_002_acpion' }), 'uniequip_002_acpion');
  assert.equal(tokenRemaining({ ownerUid: 1, tokenId: 't', count: 3 }, [
    { kind: 'token', ownerUid: 1, tokenId: 't' },
    { kind: 'token', ownerUid: 1, tokenId: 't' },
    { kind: 'token', ownerUid: 2, tokenId: 't' },
  ]), 1);
  assert.equal(tokenRemaining({ ownerUid: 1, tokenId: 't', count: 1 }, [{ kind: 'token', ownerUid: 1, tokenId: 't' }]), 0);
  const direct = routeLabel({ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }, 0);
  const via = routeLabel({ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [[8, 3]] }, 1);
  assert.equal(direct, '#1 WALK (9,10) → (9,2) · 直达');
  assert.equal(via, '#2 WALK (9,10) → (9,2) · 经由 (8,3)');
  const text = scenarioText({ params: { path: 'players.0.units.1.row', reason: 'tile' } });
  assert.match(text, /players\.0\.units\.1\.row/);
  assert.match(text, /这个格子不能部署该单位/);
});

test('mode, skill and device labels and a locked module name follow the data overlay', () => {
  const editor = readFileSync(new URL('../../public/studio/js/console/editor.js', import.meta.url), 'utf8');
  for (const needle of ["data.get('config')", "data.get('backups')", "data.lookup('stages'", 'lockedModuleLabel', 'modeOptionLabel', 'skillOptionName', 'deviceOptionName']) {
    assert.equal(editor.includes(needle), true, needle);
  }
  const config = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8'));
  const chess = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const stages = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url), 'utf8'));
  const backups = JSON.parse(readFileSync(new URL('../../data/backups.json', import.meta.url), 'utf8'));
  const zhMode = config.modes.mode_single_normal.name;
  const zhSkill = chess.chess_char_1_01_a.skills.find((s) => s.index === 0).name;
  const zhEye = stages.act1autochess_m01.devices.find((d) => d.key === 'trap_1104_aclasert').name;
  const zhCrate = stages.act1autochess_m01.devices.find((d) => d.role === 'crate').name;
  assert.equal(zhMode, '险境模拟');
  assert.equal(zhSkill.includes('不惹麻烦'), true);
  assert.equal(zhEye.includes('双眼皮'), true);
  assert.equal(zhCrate, '阻隔工事');
  const expect = {
    en: ['Perilous Simulation', "'Don't Invite Trouble'", "'Double Lids'", 'Barricade', "Tulip's Badge"],
    ja: ['逆境', '「トラブル回避」', '「ダブルリッズ」', 'バリケード', 'チューリップの記章'],
    ko: ['험지 시뮬레이션', "'트러블 차단'", "'쌍꺼풀'", '차단 공사', '튤립의 배지'],
  };
  for (const [lang, want] of Object.entries(expect)) {
    const ov = JSON.parse(readFileSync(new URL(`../../data/i18n/${lang}.json`, import.meta.url), 'utf8'));
    const mode = applyFileOverlay(config, ov.files.config).value.modes.mode_single_normal;
    const skill = applyFileOverlay(chess, ov.files.chess).value.chess_char_1_01_a.skills.find((s) => s.index === 0);
    const devs = applyFileOverlay(stages, ov.files.stages).value.act1autochess_m01.devices;
    const eye = devs.find((d) => d.key === 'trap_1104_aclasert');
    const crate = devs.find((d) => d.role === 'crate');
    const locBackups = applyFileOverlay(backups, ov.files.backups).value;
    const mod = lockedModuleLabel(locBackups, 'char_608_acpion', 'uniequip_002_acpion');
    assert.equal(modeOptionLabel(mode, 'mode_single_normal'), `${want[0]} · mode_single_normal`);
    assert.equal(skillOptionName(skill), `S1 · ${want[1]}`);
    assert.equal(deviceOptionName(eye).startsWith(`${want[2]} · `), true);
    assert.equal(deviceOptionName(crate).startsWith(`${want[3]} · `), true);
    assert.equal(mod, want[4]);
    assert.equal(mod.includes('uniequip_'), false);
    assert.equal(moduleOptionName(moduleOptions([], true, 'uniequip_002_acpion', mod)[0]), want[4]);
  }
});

test('one-second stepping and fast playback advance the real official effect clock without frame-cap loss', () => {
  const fx = Object.assign(Object.create(OfficialFx.prototype), { time: 0, frameNo: 0, effects: [] });
  advanceEffectClock(fx, 0); assert.equal(fx.time, 0);
  advanceEffectClock(fx, 1); assert.equal(fx.time, 1);
  advanceEffectClock(fx, 1.6); assert.equal(fx.time, 2.6);
  advanceEffectClock(fx, 0); assert.equal(fx.time, 2.6);
});

test('combat observation records capped healing after hooks and leaves regen rules unchanged', () => {
  const b = createBattleFromSpec(build(scenario()).spec, ds, { quiet: true }); b.start();
  const log = makeLog(), original = b.heal, off = observeCombat(b, log);
  const u = b.allyUnits.find(v => v.uid === 1);
  b.on('heal', ctx => { ctx.amount *= 4; });
  u.hp = u.s.maxHp - 10;
  assert.equal(b.heal(u, u, 100), 10); assert.equal(log.entries.at(-1).amount, 10);
  u.hp -= 30;
  assert.equal(b.heal(u, u, 5, { regen: true }), 5); assert.equal(log.entries.at(-1).amount, 5);
  off(); assert.equal(b.heal, original);
});

test('effect observation records actual official starts, restores methods and bounds logs', () => {
  const log = makeLog(2), ofx = { _add() {} }, fx = { particle: () => ({}) }, original = ofx._add;
  const off = observeEffects({ debug: { ofx, fx } }, log, () => 1);
  ofx._add({ def: { key: 'test-effect' } }); fx.particle('dot'); fx.particle('dot');
  assert.equal(log.entries.length, 2); assert.equal(log.counts.get('official:test-effect'), 1); assert.equal(log.counts.get('procedural:particle:dot'), 2);
  off(); assert.equal(ofx._add, original); log.clear(); assert.equal(log.counts.size, 0);
});

async function request(studio, route, { key = studio.key, method = 'POST', body = newScenario(), headers = {}, ip = '127.0.0.1' } = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method = method; req.url = `/studio/api/console/${route}`; req.complete = true;
  req.headers = { host: 'localhost:3000', ...(key === null ? {} : { 'x-sp-studio': key }), ...headers }; req.socket = { remoteAddress: ip };
  const res = new EventEmitter();
  Object.assign(res, { setHeader() {}, writeHead(code) { this.status = code; }, end(body) { this.body = body?.toString() || ''; }, destroy() {} });
  await studio.handle(req, res, req.url, ''); return res;
}
test('keyed console API: no key, wrong key, foreign origin/Host, public/forwarded peer and disabled studio fail closed', async t => {
  const f = fixture(t); const args = { registry: f.registry, publicDir: path.resolve('public'), dataDir: path.resolve('data'), pluginsDir: path.join(f.dir, 'plugins'), watch: () => ({ on() {}, close() {} }) };
  const studio = createStudio(args); t.after(() => studio.close());
  for (const route of ['options', 'build']) {
    assert.equal((await request(studio, route)).status, 200);
    for (const [opts, code] of [[{ key: null }, 404], [{ key: 'wrong' }, 403], [{ headers: { origin: 'https://evil.example' } }, 404], [{ headers: { host: 'evil.example' } }, 404], [{ ip: '203.0.113.2' }, 404], [{ headers: { 'x-forwarded-for': '203.0.113.2' } }, 404], [{ method: 'GET' }, 404]]) assert.equal((await request(studio, route, opts)).status, code);
  }
  assert.equal((await request(studio, 'build', { body: { ...newScenario(), seed: -1 } })).status, 400);
  assert.equal((await request(studio, 'build', { body: ' '.repeat(SCENARIO_BYTES + 1) })).status, 413);
  const disabled = createStudio({ ...args, mode: 'off' }); t.after(() => disabled.close());
  assert.equal((await request(disabled, 'options')).status, 404);
});
