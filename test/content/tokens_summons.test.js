// Summon regressions from user playtest #2 (docs/DESIGN.md §14/§15; content/tokens.js, kits tier3 琳琅诗怀雅 / tier6
// 缪尔赛思, public/js/audio.js):
//   #4 琳琅诗怀雅's 香槟炸弹 is a summon, not an operator: using it up is no knock-out (no operator-knocked-down sound,
//      no death count, no "干员被击倒" effect); clients hear its explosion.
//   #5 缪尔赛思's 流形: never attacks before it copied an operator, the copy skill waits (ready) while nobody can be
//      copied, one respawn 25 s after being killed — never a quick second one (stale timers, her redeploy).
//   audit: official per-class death/deploy sounds for every summon kind (operator / summon / map character / device).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData, getDefaultSource } from '../../server/sim/simdata.js';
import { TOKEN_IDS, pickCopyTarget } from '../../server/sim/content/tokens.js';
import { AudioManager, deathSfxUrl, deploySfxUrl, unitSoundClass } from '../../public/js/audio.js';
import { showsDeathFx } from '../../public/js/render/app.js';

const REAL = { skip: !hasGeneratedData() };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const SFX = manifest.audio.sfx;
const TOKEN_DEAD = SFX.battle.charDie.replace(/b_char_dead\.mp3$/, 'b_char_tokendead.mp3');
const ds = getDefaultSource();
const dummy = (o = {}) => enemyRec({ key: o.key ?? 'enemy_dummy', hp: 1e7, speed: 0, def: 0, res: 0, ...o });
const walker = (o = {}) => enemyRec({ key: o.key ?? 'enemy_walker', hp: 1e6, speed: 1, def: 0, atk: 0, ...o });
const guard = (o = {}) => chessRec({ id: 'test_guard', profession: 'WARRIOR', skill: null, stats: { atk: 600, def: 300, maxHp: 5000, blockCnt: 2, bat: 1 }, rangeGrid: [[0, 0], [0, 1]], ...o });
const MF = TOKEN_IDS.manifold;
const manifolds = (h) => h.b.allyUnits.filter((u) => u.defId === MF && !u.mem.mlyssClone && !u.mem.isClone);
const standing = (h) => manifolds(h).filter((u) => u.alive && u.deployed);
const noErrors = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); checkInvariants(h.b); };

/** Records every attack (and damage) by a 流形 made while it has no copy (tier6 `mem.mlyss` / tokens.js `mem.copy`). */
function watchUncopied(b, out) {
  const bare = (u) => u && u.defId === MF && !u.mem.mlyss && !u.mem.copy;
  b.on('attack', (c) => { if (bare(c.attacker)) out.push({ t: b.time, id: c.attacker.id, what: 'attack' }); }, { priority: 1000 });
  b.on('damaged', (c) => { if (bare(c.source)) out.push({ t: b.time, id: c.source.id, what: 'damage' }); }, { priority: 1000 });
}
const attacksBy = (b, list) => { b.on('attack', (c) => { if (c.attacker.defId === MF) list.push({ t: b.time, u: c.attacker }); }); };

/** An AudioManager whose sounds are recorded instead of played. */
function recordingAudio() {
  const a = new AudioManager({ win: null, getManifest: () => manifest });
  a.ctx = {}; // "unlocked"
  const played = [];
  a._play = (url) => { played.push(url); };
  return { a, played };
}

// =================================================================================================================
// #4 香槟炸弹

test('#4 香槟炸弹 (琳琅诗怀雅): used up by its blast = no knock-out — no death count, no operator-knocked-down sound, its explosion is heard', REAL, async () => {
  const id = 'chess_char_3_04_a';
  const knocked = [];
  const h = makeBattle({
    defs: { enemies: { enemy_w: walker({ key: 'enemy_w' }) } }, timeLimit: 60, hooks: ['death', 'deploy'],
    units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'enemy_w', route: 0 }],
    setup: (b) => b.on('death', (c) => { if (c.reason === 'killed' && c.unit.side === 'ally') knocked.push(c.unit.defId); }),
  });
  assert.ok(h.runUntil(() => h.hooksOf('death').some((c) => c.unit.defId === TOKEN_IDS.champagne), 30), 'a bomb went off');
  h.run(0.1);
  const bombDeaths = h.hooksOf('death').filter((c) => c.unit.defId === TOKEN_IDS.champagne);
  for (const c of bombDeaths) {
    assert.equal(c.unit.kind, 'token');
    assert.notEqual(c.reason, 'killed', 'a used-up bomb is not knocked out');
  }
  assert.deepEqual(knocked, [], 'no ally knocked out');
  assert.equal(h.result().perPlayer.p1.deaths, 0, 'result: no operator deaths');
  // the client stream: the blast fx names the bomb as used up right before its `die` event
  const ev = h.events;
  const bombIds = new Set(bombDeaths.map((c) => c.unit.id));
  for (const bid of bombIds) {
    const iDie = ev.findIndex((e) => e[0] === 'die' && e[1] === bid);
    const iBoom = ev.findIndex((e) => e[0] === 'fx' && e[4] && e[4].id === bid && e[4].consumed === true);
    assert.ok(iBoom >= 0 && iBoom < iDie, 'consumed blast fx before the die event');
  }
  // …and the audio manager fed with it plays the bomb's impact sound, never the operator knock-down sound
  const { a, played } = recordingAudio();
  a.setFieldUnits([]);
  a.handleBattleEvents(ev);
  // this test hands the manager the WHOLE battle in one call (the client feeds one tick per call): a deployment batch is
  // spread over 60 ms a piece so that a whole board does not stack into one blast (audio.js _playDeploy), so give the
  // staggered ones their time before reading what played
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(!played.includes(SFX.battle.charDie), 'no 干员被击倒 sound');
  assert.ok(!played.includes(TOKEN_DEAD), 'no token death sound either (it exploded)');
  assert.ok(played.includes(SFX.units[TOKEN_IDS.champagne].hit), 'its explosion (official ON_ABILITY_HIT) is heard');
  assert.ok(played.includes(SFX.units[TOKEN_IDS.champagne].born), 'placed with its own sound');
  // …and the renderer shows no knock-down particles for it (its blast is its end — integration)
  for (const bid of bombIds) {
    const info = ev.find((e) => e[0] === 'spawn' && e[1]?.id === bid)?.[1] || { kind: 'token' };
    assert.equal(showsDeathFx(info, true), false, 'used-up bomb: no death particles');
    assert.equal(showsDeathFx(info, false), true, 'a summon destroyed otherwise still gets them');
  }
  assert.equal(showsDeathFx({ kind: 'device' }), false, 'stage devices: none');
  noErrors(h);
});

test('#4 audio classes (official ON_UNIT_DEAD/BORN defaults): only operators play the knock-down / operator deploy sounds', () => {
  const op = { side: 'ally', kind: 'op', defId: 'chess_char_1_01_a', def: 'char_x' };
  const tok = { side: 'ally', kind: 'token', defId: TOKEN_IDS.wolfPack, def: TOKEN_IDS.wolfPack };
  const own = { side: 'ally', kind: 'token', defId: MF, def: MF };
  const bomb = { side: 'ally', kind: 'token', defId: TOKEN_IDS.champagne, def: TOKEN_IDS.champagne };
  const mapChar = { side: 'ally', kind: 'token', defId: 'char_605_cmedic', def: 'char_605_cmedic' };
  const crate = { side: 'ally', kind: 'device', defId: 'trap_1105_accrate', def: 'trap_1105_accrate' };
  const enemy = { side: 'enemy', kind: 'enemy', defId: 'enemy_x', def: 'enemy_x' };
  const boss = { ...enemy, boss: true };
  assert.deepEqual([op, tok, bomb, mapChar, crate, enemy].map(unitSoundClass), ['char', 'token', 'token', 'char', 'device', 'enemy']);
  // deaths
  assert.equal(deathSfxUrl(manifest, op), SFX.battle.charDie);
  assert.equal(deathSfxUrl(manifest, tok), TOKEN_DEAD, 'summon ⇒ b_char_tokendead');
  assert.equal(deathSfxUrl(manifest, own), SFX.units[MF].die, 'own ON_UNIT_DEAD first (流形)');
  assert.equal(deathSfxUrl(manifest, bomb), TOKEN_DEAD);
  assert.equal(deathSfxUrl(manifest, bomb, { consumed: true }), null, 'used up ⇒ silent');
  assert.equal(deathSfxUrl(manifest, mapChar), SFX.battle.charDie, 'band map characters are operators');
  assert.equal(deathSfxUrl(manifest, crate), TOKEN_DEAD, 'act crate trap_1105 ⇒ b_char_tokendead');
  assert.equal(deathSfxUrl(manifest, enemy), SFX.battle.enemyDie);
  assert.equal(deathSfxUrl(manifest, boss), SFX.battle.enemyDieHeavy);
  assert.equal(deathSfxUrl(manifest, op, { reason: 'retreat' }), null, 'a retreat is no knock-down');
  assert.equal(deathSfxUrl(manifest, op, { reason: 'killed' }), SFX.battle.charDie);
  assert.equal(deathSfxUrl(null, op), null);
  // deployments
  assert.equal(deploySfxUrl(manifest, op), SFX.battle.deploy);
  assert.equal(deploySfxUrl(manifest, tok), SFX.units[TOKEN_IDS.wolfPack].born);
  assert.equal(deploySfxUrl(manifest, { ...tok, def: 'token_nope', defId: 'token_nope' }), SFX.battle.tokenDeploy, 'summon ⇒ b_char_tokenset');
  assert.equal(deploySfxUrl(manifest, crate), null, 'stage devices are placed silently');
  assert.equal(deploySfxUrl(manifest, enemy), null);
  // through the event handler
  const { a, played } = recordingAudio();
  a.setFieldUnits([{ id: 1, ...op, spine: 'char_x' }, { id: 2, side: 'ally', kind: 'token', defId: 'token_nope', spine: 'token_nope' }, { id: 3, ...crate, spine: crate.def }]);
  a.handleBattleEvents([['die', 2], ['die', 3], ['deploy', 3]]);
  assert.deepEqual(played, [TOKEN_DEAD, TOKEN_DEAD], 'summon + crate: token death sound, no operator one');
  a.handleBattleEvents([['die', 1]]);
  assert.deepEqual(played.slice(2), [SFX.battle.charDie]);
});

test('#4 die events carry their reason: a retreat plays no knock-down sound, a knock-out does (integration)', REAL, () => {
  const h = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, timeLimit: 60, autoFinish: false,
    units: [{ chessId: 'test_guard', row: 10, col: 5, uid: 1 }, { chessId: 'test_guard', row: 11, col: 5, uid: 2 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 8] }],
  });
  h.step();
  const [g1, g2] = h.b.allyUnits.filter((u) => u.defId === 'test_guard');
  h.b.retreat(g1);
  h.b.kill(g2);
  h.step();
  const dies = h.eventsOf('die');
  assert.deepEqual(dies.find((e) => e[1] === g1.id), ['die', g1.id, 'retreat']);
  assert.deepEqual(dies.find((e) => e[1] === g2.id), ['die', g2.id, 'killed']);
  const { a, played } = recordingAudio();
  const op = { side: 'ally', kind: 'op', defId: 'test_guard', def: 'test_guard' };
  a.setFieldUnits([{ id: g1.id, ...op, spine: 'char_x' }, { id: g2.id, ...op, spine: 'char_y' }]);
  a.handleBattleEvents(dies.filter((e) => e[1] === g1.id));
  assert.deepEqual(played, [], 'a retreat is no knock-down');
  a.handleBattleEvents(dies.filter((e) => e[1] === g2.id));
  assert.deepEqual(played, [SFX.battle.charDie], 'a knock-out plays b_char_dead');
  noErrors(h);
});

// =================================================================================================================
// #5 流形

test('#5 流形: never attacks before copying; with nobody to copy its copy skill waits ready, then copies at once', REAL, () => {
  const bad = [], atk = [];
  const h = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, timeLimit: 120, autoFinish: false,
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_guard', row: 12, col: 9, uid: 2 }, { kind: 'token', tokenId: MF, row: 9, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], // standing on the 流形's own tile (its uncopied range)
    setup: (b) => { watchUncopied(b, bad); attacksBy(b, atk); },
  });
  h.step();
  const m = standing(h)[0], g = h.unit('test_guard');
  assert.ok(m);
  assert.equal(m.profile.noAttack, true, 'uncopied: no attack');
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' }); // the only operator it could copy is knocked out
  assert.equal(g.alive, false);
  h.run(12);
  assert.equal(pickCopyTarget(h.b, m), null);
  assert.equal(m.skill.active, false, 'copy skill not spent on nobody');
  assert.ok(m.skill.ready, 'it stays ready');
  assert.equal(m.mem.mlyss ?? null, null);
  assert.deepEqual(bad, [], 'no attack / damage without a copy');
  assert.equal(atk.length, 0);
  // the operator comes back: the 流形 copies it at once and only then attacks
  assert.ok(h.b.redeploy(g, { free: true }));
  h.step(2);
  assert.ok(m.mem.mlyss, 'copied as soon as someone can be copied');
  assert.equal(m.mem.mlyss.from, g.id);
  assert.equal(m.profile.noAttack, false);
  assert.ok(h.runUntil(() => atk.length > 0, 5), 'attacks once copied');
  assert.deepEqual(bad, []);
  noErrors(h);
});

test('#5 流形: a respawned 流形 comes back uncopied after 25 s and does not attack until its copy (5 s later)', REAL, () => {
  const bad = [];
  const h = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, timeLimit: 120, autoFinish: false,
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_guard', row: 12, col: 6, uid: 2 }, { kind: 'token', tokenId: MF, row: 9, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }],
    setup: (b) => watchUncopied(b, bad),
  });
  h.step();
  const first = standing(h)[0];
  assert.ok(h.runUntil(() => first.mem.mlyss, 7), 'first copy after 95 → 100 SP');
  h.b.dealDamage(null, first, { amount: 1e9, type: 'true' });
  const respawn = ds.getToken(MF, 'chess_char_6_11_a').talents.find((t) => t.bb.scale != null).bb.interval;
  const tKill = h.b.time;
  assert.ok(h.runUntil(() => standing(h).length === 1, respawn + 2));
  const again = standing(h)[0];
  assert.ok(Math.abs(h.b.time - tKill - respawn) < 0.1, `back after ${respawn} s (${h.b.time - tKill})`);
  assert.deepEqual([again.tileR, again.tileC], [9, 6], 'on its tile');
  assert.equal(again.mem.mlyss ?? null, null, 'uncopied');
  assert.equal(again.profile.noAttack, true);
  const t0 = h.b.time;
  assert.ok(h.runUntil(() => again.mem.mlyss, 6));
  assert.ok(h.b.time - t0 > 4.5, 'copies when its SP fills (95 → 100)');
  assert.deepEqual(bad, [], 'the enemy on its tile was never attacked by an uncopied 流形');
  noErrors(h);
});

test('#5 流形: no quick second revive — her knock-out cancels the pending respawn, her redeploy brings exactly one back', REAL, () => {
  const deploys = [];
  const h = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, timeLimit: 200, autoFinish: false, hooks: ['death'],
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_guard', row: 12, col: 7, uid: 2 }, { kind: 'token', tokenId: MF, row: 11, col: 5, uid: 3, ownerUid: 1 }],
    setup: (b) => b.on('deploy', (c) => { if (c.unit.defId === MF && !c.unit.mem.mlyssClone) deploys.push({ t: b.time, id: c.unit.id, tile: [c.unit.tileR, c.unit.tileC] }); }),
  });
  h.step();
  const u = h.unit('chess_char_6_11_a');
  h.run(1);
  h.b.dealDamage(null, standing(h)[0], { amount: 1e9, type: 'true' }); // 流形 killed: respawn pending (25 s)
  h.run(2);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });            // then she is knocked out
  assert.equal(u.alive, false);
  h.run(40);                                                          // past the old respawn time: she is still down
  assert.equal(standing(h).length, 0, 'no 流形 while she is off the field');
  assert.ok(h.b.redeploy(u, { free: true }));                          // her redeploy summons it as her 援军
  h.step();
  assert.equal(standing(h).length, 1);
  assert.deepEqual([standing(h)[0].tileR, standing(h)[0].tileC], [11, 5], 'back on the tactical point the player chose (its board tile, inside her range)');
  const n = deploys.length;
  // kill it right away: the next one needs the full 25 s (no stale timer firing within a second)
  h.b.dealDamage(null, standing(h)[0], { amount: 1e9, type: 'true' });
  h.run(20);
  assert.equal(standing(h).length, 0, 'not back within 20 s');
  assert.equal(deploys.length, n);
  h.run(6);
  assert.equal(standing(h).length, 1, 'back after 25 s');
  h.run(60);
  assert.equal(deploys.length, n + 1, 'exactly one respawn');
  assert.equal(h.hooksOf('death').filter((c) => c.unit.defId === MF && c.reason === 'expired').length, 0, 'never replaced by a second 流形');
  noErrors(h);
});

test('#5 流形 (unmanaged token kit): redeploys uncopied (data stats, own tile range), then copies again', REAL, () => {
  const genericNoSkill = () => ({ skill: null, talents: [], generic: true });
  const bad = [];
  const h = makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, timeLimit: 120, autoFinish: false,
    kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_guard', row: 12, col: 6, uid: 2 }, { kind: 'token', tokenId: MF, row: 9, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }],
    setup: (b) => watchUncopied(b, bad),
  });
  h.step();
  const m = standing(h)[0];
  const tdef = ds.getToken(MF, 'chess_char_6_11_a');
  assert.ok(h.runUntil(() => m.mem.copy, 7));
  assert.notEqual(m.base.atk, tdef.stats.atk);
  h.b.dealDamage(null, m, { amount: 1e9, type: 'true' });
  const respawn = tdef.talents.find((t) => t.bb.scale != null).bb.interval;
  assert.ok(h.runUntil(() => m.alive, respawn + 2), 'same piece redeployed');
  assert.equal(m.mem.copy, null);
  assert.equal(m.base.atk, tdef.stats.atk, 'uncopied data ATK');
  assert.equal(m.base.blockCnt, tdef.stats.blockCnt);
  assert.deepEqual(m.rangeGrid, tdef.rangeGrid, 'own tile range again');
  assert.equal(m.profile.noAttack, true);
  assert.ok(h.runUntil(() => m.mem.copy, 6), 'copies again');
  assert.deepEqual(bad, [], 'no attack before either copy');
  noErrors(h);
});

// =================================================================================================================
// adversarial review (workstream "summons")

const fastSniper = (o = {}) => chessRec({
  id: 'test_sniper', profession: 'SNIPER', position: 'RANGED', skill: null, stats: { atk: 300, def: 50, maxHp: 3000, blockCnt: 1, bat: 0.3 },
  rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [-1, 0], [-1, 1], [-1, 2]], ...o,
});

test('#5 流形: a split clone alive when 缪尔赛思 redeploys is not taken for her 流形 — a real one comes back and stays', REAL, () => {
  const h = makeBattle({
    defs: { chess: { test_sniper: fastSniper() }, enemies: { enemy_dummy: dummy({ atk: 0 }) } }, timeLimit: 300, autoFinish: false,
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_sniper', row: 12, col: 6, uid: 2 }, { kind: 'token', tokenId: MF, row: 11, col: 5, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }],
  });
  h.step();
  const clones = () => h.b.allyUnits.filter((u) => u.defId === MF && u.alive && u.deployed && (u.mem.mlyssClone || u.mem.isClone));
  assert.ok(h.runUntil(() => clones().length > 0, 60), 'the ranged copy split');
  const m = h.unit('chess_char_6_11_a');
  h.b.dealDamage(null, standing(h)[0], { amount: 1e9, type: 'true' });
  h.b.dealDamage(null, m, { amount: 1e9, type: 'true' });
  h.step();
  assert.equal(standing(h).length, 0);
  assert.equal(clones().length, 1, 'the clone outlives them (25 s)');
  assert.ok(h.b.redeploy(m, { free: true }));
  h.step(2);
  assert.equal(standing(h).length, 1, 'her redeploy brings a real 流形 although a clone stands');
  assert.equal(m.trait.reinforcement, standing(h)[0], 'her 援军 is the 流形, not the clone');
  assert.deepEqual([standing(h)[0].tileR, standing(h)[0].tileC], [11, 5], 'on the tactical point the player chose');
  h.run(60); // the clone expired long ago
  assert.equal(standing(h).length, 1, 'still has her 流形');
  noErrors(h);
});

test('#5 流形 (unmanaged token kit): no respawn while 缪尔赛思 is down, her redeploy brings exactly one back', REAL, () => {
  const genericNoSkill = () => ({ skill: null, talents: [], generic: true });
  const deploys = [];
  const h = makeBattle({
    defs: { chess: { test_guard: guard() } }, timeLimit: 200, autoFinish: false,
    kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 2, uid: 1 }, { chessId: 'test_guard', row: 12, col: 6, uid: 2 }, { kind: 'token', tokenId: MF, row: 11, col: 4, uid: 3, ownerUid: 1 }],
    setup: (b) => b.on('deploy', (c) => { if (c.unit.defId === MF && !c.unit.mem.isClone) deploys.push(b.time); }),
  });
  h.step();
  const u = h.unit('chess_char_6_11_a');
  const n0 = deploys.length;
  h.b.dealDamage(null, standing(h)[0], { amount: 1e9, type: 'true' });
  h.run(2);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  h.run(40); // past the 25 s respawn
  assert.equal(standing(h).length, 0, 'not back while she is down');
  assert.equal(deploys.length, n0);
  assert.ok(h.b.redeploy(u, { free: true }));
  h.step();
  assert.equal(standing(h).length, 1, 'back with her');
  h.run(60);
  assert.equal(deploys.length, n0 + 1, 'exactly once');
  noErrors(h);
});
