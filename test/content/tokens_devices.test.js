// Content tests: summons / tokens (server/sim/content/tokens.js) and stage devices & terrain (content/devices.js).
// Every token of data/tokens.json and every device/terrain kind runs in a real battle through the harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData, getDefaultSource } from '../../server/sim/simdata.js';
import { genericKit } from '../../server/sim/content/generic.js';
import { spawnYanyou, spawnMapChar, TOKEN_IDS, wolfShadows, wolfShadowInterval, wolfTacticalPoint, tileFree, findSummonTile, summonToken } from '../../server/sim/content/tokens.js';
import { startColdWind, kjeragColdWind, activateTurrets, terrainAt, deviceOverridesOf } from '../../server/sim/content/devices.js';
import { HUSK_REBIRTH } from '../../server/sim/content/enemies.js';

const REAL = { skip: !hasGeneratedData() };
const ds = getDefaultSource();
const approx = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (o = {}) => enemyRec({ key: o.key ?? 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const walker = (o = {}) => enemyRec({ key: o.key ?? 'enemy_walker', hp: 1e6, speed: 1, ...o });
/** Synthetic summoner (generic kit, no skill) — its summons run the token kits unmanaged. */
const summoner = (o = {}) => chessRec({ id: 'test_owner', profession: 'CASTER', skill: null, rangeGrid: [[0, 0]], stats: { atk: 1000, maxHp: 3000, def: 0 }, ...o });
const guard = (o = {}) => chessRec({ id: 'test_guard', profession: 'WARRIOR', skill: null, stats: { atk: 0, maxHp: 4000, def: 0, blockCnt: 2 }, ...o });
/** Injected kits for real summoners: `bare` = hand-kit-like (no skill), `generic` = flagged generic (unmanaged). */
const bare = () => ({ skill: null, talents: [] });
const genericNoSkill = () => ({ skill: null, talents: [], generic: true });
const tokDef = (id, owner) => ds.getToken(id, owner);

function spawnOn(h, owner, tokenId, r, c, opts = {}) {
  const t = h.b.spawnToken(owner, tokenId, r, c, opts);
  assert.ok(t, `spawned ${tokenId} at ${r},${c}`);
  h.step();
  return t;
}

// =================================================================================================================
// tokens

test('医疗探机: heals an injured ally next to it, untargetable, self-destructs after the withdraw time (10 s)', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner(), test_guard: guard() } }, units: [{ chessId: 'test_owner', row: 10, col: 3 }, { chessId: 'test_guard', row: 10, col: 5 }], autoFinish: false, timeLimit: 60, hooks: ['death'] });
  h.step();
  const g = h.unit('test_guard');
  g.hp = 100;
  const d = spawnOn(h, h.unit('test_owner'), TOKEN_IDS.healDrone, 10, 4);
  assert.equal(d.s.flags.untargetable, true);
  assert.equal(d.profile.dmgType, 'heal');
  h.run(2);
  assert.ok(g.hp > 100 + d.s.atk, `healed ${g.hp}`);
  const t0 = d.deployedAt;
  h.runUntil(() => !d.alive, 12);
  assert.equal(d.alive, false);
  approx(d.deathAt - t0, 10, 0.01, 'lifetime');
  assert.equal(h.hooksOf('death').find((x) => x.unit === d).reason, 'expired');
  checkInvariants(h.b);
});

test('诅咒娃娃: enemies in its range get ATK/DEF −25 % (normal) / −30 % (精锐 owner) for 15 s', REAL, () => {
  for (const [ownerId, pct] of [['chess_char_3_15_a', 0.25], ['chess_char_3_15_b', 0.3]]) {
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ atk: 1000, def: 400 }) } }, kits: { chess_char_3_15_a: bare }, units: [{ chessId: ownerId, row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], autoFinish: false, timeLimit: 60 });
    h.step();
    const doll = spawnOn(h, h.unit(ownerId), TOKEN_IDS.curseDoll, 10, 6);
    const e = h.enemy('enemy_dummy');
    h.run(0.5);
    approx(e.s.atk, 1000 * (1 - pct), 1e-9, 'ATK');
    approx(e.s.def, 400 * (1 - pct), 1e-9, 'DEF');
    assert.equal(doll.s.flags.untargetable, true);
    assert.ok(doll.profile.noAttack);
    h.runUntil(() => !doll.alive, 16);
    approx(doll.deathAt - doll.deployedAt, 15, 0.01, 'lifetime');
    h.run(0.5);
    assert.equal(e.s.atk, 1000, 'aura gone');
    checkInvariants(h.b);
  }
});

test('沙之碑: appears with owner ATK × atk_scale arts + stun on the 3×3 around it, blocks 3, lives the talent duration', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [12, 9] }], autoFinish: false, timeLimit: 60 });
  h.step();
  const [near, far] = h.enemies();
  const ob = h.b.spawnToken(h.unit('test_owner'), TOKEN_IDS.obelisk, 10, 6);
  const bb = tokDef(TOKEN_IDS.obelisk, 'test_owner').skill.bb;
  approx(1e7 - near.hp, 1000 * bb.atk_scale, 1e-9, 'burst');
  assert.equal(far.hp, 1e7, 'outside the 3×3');
  assert.ok(near.s.flags.stun);
  approx(near.findBuff('stun').timeLeft, bb.stun, 1e-9);
  assert.equal(ob.s.blockCnt, 3);
  h.runUntil(() => !ob.alive, 25);
  approx(ob.deathAt - ob.deployedAt, 20, 0.01);
  assert.ok(h.eventsOf('fx').some((e) => e[1] === 'summonBurst'));
  checkInvariants(h.b);
});

test('迷迭香的战术装备: stuns around on appear; enemies it blocks lose talent DEF (−160); 25 s', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_walker: walker({ def: 300 }) } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_walker', route: 0 }], autoFinish: false, timeLimit: 60 });
  h.step();
  const gear = spawnOn(h, h.unit('test_owner'), TOKEN_IDS.rosmonGear, 9, 6);
  const e = h.enemy('enemy_walker');
  assert.ok(h.runUntil(() => e.blockedBy === gear, 20), 'blocked by the gear');
  h.step(2);
  assert.equal(e.s.def, 140);
  // appear stun on a second one spawned next to the blocked enemy
  const g2 = h.b.spawnToken(h.unit('test_owner'), TOKEN_IDS.rosmonGear, 10, 7);
  assert.ok(g2 && e.s.flags.stun, 'stunned on appear');
  approx(e.findBuff('stun').timeLeft, tokDef(TOKEN_IDS.rosmonGear, 'test_owner').skill.bb.stun, 1e-9);
  h.runUntil(() => !gear.alive, 30);
  approx(gear.deathAt - gear.deployedAt, 25, 0.01);
  checkInvariants(h.b);
});

test('“小自在”: arts melee blocker, 25 s lifetime, kills emit summonKill for its owner', REAL, () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ hp: 300 }) } }, kits: { chess_char_5_12_a: bare }, units: [{ chessId: 'chess_char_5_12_a', row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], autoFinish: false, timeLimit: 60, hooks: ['summonKill'] });
  h.step();
  const xi = h.unit('chess_char_5_12_a');
  const d = spawnOn(h, xi, TOKEN_IDS.duskDragon, 10, 6);
  assert.equal(d.profile.dmgType, 'arts');
  assert.equal(d.s.blockCnt, 2);
  h.runUntil(() => h.enemies().length === 0, 10);
  const k = h.hooksOf('summonKill')[0];
  assert.ok(k && k.token === d && k.owner === xi, 'summonKill');
  h.runUntil(() => !d.alive, 30);
  approx(d.deathAt - d.deployedAt, 25, 0.01);
  checkInvariants(h.b);
});

test('斯卡蒂的海嗣: its owner\'s trait (生命回复速度) on the allies in its range; during the owner skill: true dmg/s + 鼓舞; expires, then redeploys after respawnTime', REAL, () => {
  const bb = tokDef(TOKEN_IDS.seaborn, 'chess_char_6_04_a').skill.bb;
  const ratio = tokDef(TOKEN_IDS.seaborn, 'chess_char_6_04_a').traitBb['attack@atk_to_hp_recovery_ratio'];
  // heal mode (owner skill idle)
  {
    const h = makeBattle({ defs: { chess: { test_guard: guard() } }, kits: { chess_char_6_04_a: genericNoSkill }, units: [{ chessId: 'chess_char_6_04_a', row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 8 }], autoFinish: false, timeLimit: 90 });
    h.step();
    const sk = h.unit('chess_char_6_04_a');
    const g = h.unit('test_guard');
    g.hp = 1000;
    const sea = spawnOn(h, sk, TOKEN_IDS.seaborn, 10, 7);
    assert.equal(sea.s.flags.untargetable, true);
    h.run(1.05);
    // an hpRegen buff keyed by the owner (one trait effect per ally — professions.js bardRegen), refreshed every second
    const v = sk.s.atk * ratio;
    approx(g.findBuff(`trait:bard:${sk.id}`)?.mods.hpRegen ?? 0, v, 1e-6, 'the owner\'s trait');
    const hp0 = g.hp, t1 = h.b.time;
    h.run(2);
    assert.ok(Math.abs(g.hp - hp0 - v * (h.b.time - t1)) <= 1.5, `regenerated ${g.hp - hp0}`);
    const life = tokDef(TOKEN_IDS.seaborn, 'chess_char_6_04_a').talents[0].bb.duration;
    h.runUntil(() => !sea.alive, life + 2);
    approx(sea.deathAt - sea.deployedAt, life, 0.01, 'lifetime');
    const died = h.b.time;
    assert.ok(h.runUntil(() => sea.alive, 60), 'redeployed');
    approx(h.b.time - died, sea.base.respawnTime, 0.3, 'respawn time');
    checkInvariants(h.b);
  }
  // owner skill running: damage + inspire
  {
    const kit = () => ({ generic: true, talents: [], skill: { kind: 'duration', duration: 20, trigger: 'SP_FULL', spCost: 1, initSp: 1 } });
    const h = makeBattle({ defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, kits: { chess_char_6_04_a: kit }, units: [{ chessId: 'chess_char_6_04_a', row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 8 }], enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], autoFinish: false, timeLimit: 60 });
    h.step(2);
    const sk = h.unit('chess_char_6_04_a');
    assert.ok(sk.skill.active);
    const sea = spawnOn(h, sk, TOKEN_IDS.seaborn, 10, 7);
    const e = h.enemy('enemy_dummy');
    h.run(2.05);
    approx(1e7 - e.hp, 2 * sk.s.atk * bb.atk_scale, 1e-9, 'true damage per second');
    const g = h.unit('test_guard');
    approx(g.s.atk, sk.s.atk * bb.atk, 1e-9, '鼓舞');
    assert.equal(sk.findBuff(`inspire:${sk.id}`), null, 'the owner is not inspired');
    checkInvariants(h.b);
  }
});

test('“耀阳”: true burst = owner ATK × atk_scale + stun on the plus grid; +1 hit after a 卡西米尔 deploy; ends with the owner skill', REAL, () => {
  const bb = tokDef(TOKEN_IDS.radiantSword, 'chess_char_6_17_a').skill.bb;
  const run = (withOther) => {
    const units = [{ chessId: 'chess_char_6_17_a', row: 11, col: 3 }];
    if (withOther) units.push({ chessId: 'test_guard', row: 9, col: 3 }); // deploys after 临光 (lower row)
    const h = makeBattle({ defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, kits: { chess_char_6_17_a: bare }, units, enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], autoFinish: false, timeLimit: 60 });
    h.step();
    const nearl = h.unit('chess_char_6_17_a');
    const sw = h.b.spawnToken(nearl, TOKEN_IDS.radiantSword, 10, 6);
    const e = h.enemy('enemy_dummy');
    assert.ok(e.s.flags.stun);
    approx(e.findBuff('stun').timeLeft, bb.stun, 1e-9);
    return { dmg: 1e7 - e.hp, atk: nearl.s.atk, h, sw };
  };
  const one = run(true);
  approx(one.dmg, one.atk * bb.atk_scale, 1e-9, '1 hit');
  const two = run(false);
  approx(two.dmg, 2 * two.atk * bb.atk_scale, 1e-9, '2 hits (上一名部署干员 = 临光, 卡西米尔)');
  assert.equal(two.sw.s.blockCnt, 2);
  // bound to the owner's running skill
  const kit = () => ({ talents: [], skill: { kind: 'duration', duration: 3, trigger: 'SP_FULL', spCost: 1, initSp: 1,
    onStart({ battle, unit }) { battle.spawnToken(unit, TOKEN_IDS.radiantSword, 10, 4); } } });
  const h = makeBattle({ kits: { chess_char_6_17_a: kit }, units: [{ chessId: 'chess_char_6_17_a', row: 10, col: 3 }], autoFinish: false, timeLimit: 60 });
  h.step(2);
  const sw = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.radiantSword);
  assert.ok(sw && sw.alive);
  h.runUntil(() => !sw.alive, 5);
  assert.equal(sw.alive, false, 'vanishes with the skill');
  approx(sw.deathAt - sw.deployedAt, 3, 0.05);
  checkInvariants(h.b);
});

test('纸偶: appear burst = its ATK × damage_scale arts on the 8 surrounding tiles; does not block', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [11, 7] }, { key: 'enemy_dummy', pos: [10, 9] }], autoFinish: false, timeLimit: 30 });
  h.step();
  const [a, b] = h.enemies();
  const doll = h.b.spawnToken(h.unit('test_owner'), TOKEN_IDS.paperDoll, 10, 6);
  const scale = tokDef(TOKEN_IDS.paperDoll, 'test_owner').talents[0].bb.damage_scale;
  approx(1e7 - a.hp, doll.s.atk * scale, 1e-9, 'burst');
  assert.equal(b.hp, 1e7, 'outside');
  assert.equal(doll.s.blockCnt, 0);
  checkInvariants(h.b);
});

test('狼群: board piece becomes 伺夜\'s 援军; 2→3 狼影 (block & hits), fatal sheds a shadow, DEF ignore vs blocked, 战术点形态 after the last one', REAL, () => {
  let wolfHits = 0;
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ def: 200, atk: 0 }) } },
    kits: { chess_char_3_19_a: genericNoSkill },
    // the wolf is listed before its owner (higher row): it must still be linked to 伺夜 (owner-level variant)
    units: [{ kind: 'token', tokenId: TOKEN_IDS.wolfPack, row: 9, col: 6, uid: 1, ownerUid: 2 }, { chessId: 'chess_char_3_19_b', row: 10, col: 4, uid: 2 }],
    enemies: [{ key: 'enemy_walker', route: 0 }], autoFinish: false, timeLimit: 120,
    setup: (b) => b.on('damaged', (c) => { if (c.source?.defId === TOKEN_IDS.wolfPack && c.type === 'phys') { wolfHits++; c.dmgSeen = c.amount; } }),
  });
  h.step();
  const vigil = h.unit('chess_char_3_19_b');
  const wolf = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.wolfPack);
  assert.equal(wolf.ownerUnit, vigil, 'linked to its owner');
  assert.equal(wolf.base.atk, tokDef(TOKEN_IDS.wolfPack, 'chess_char_3_19_b').stats.atk, 'golden variant stats');
  assert.equal(vigil.trait.reinforcement, wolf, 'tactician reinforcement = the wolf pack');
  assert.ok(!h.b.allyUnits.some((u) => u.defId === 'token_tactician_reinforce'), 'no generic 援军');
  assert.equal(wolfShadows(wolf), 2);
  assert.equal(wolf.s.blockCnt, 2);
  const e = h.enemy('enemy_walker');
  assert.ok(h.runUntil(() => e.blockedBy === wolf && wolfHits >= 2, 30), 'blocks and bites');
  // DEF ignore: every bite does ATK − (200 − 175)
  let dealt = null;
  h.b.on('damaged', (c) => { if (c.source === wolf && c.type === 'phys') dealt = c.amount; });
  h.runUntil(() => dealt != null, 5);
  approx(dealt, wolf.s.atk - (200 - 175), 1e-9, 'def pen');
  h.runUntil(() => wolfShadows(wolf) === 3, 30);
  assert.equal(wolf.s.blockCnt, 3);
  assert.equal(wolf.profile.hitsFn(h.b, wolf), 3);
  // fatal damage with >1 shadow: lose a shadow, full HP
  h.b.dealDamage(null, wolf, { amount: 1e6, type: 'true' });
  assert.ok(wolf.alive);
  assert.equal(wolfShadows(wolf), 2);
  assert.equal(wolf.hp, wolf.s.maxHp);
  h.b.dealDamage(null, wolf, { amount: 1e6, type: 'true' });
  h.b.dealDamage(null, wolf, { amount: 1e6, type: 'true' });
  // the last shadow falls: 战术点形态 (PRTS 狼群 备注) — off the field, kept, 0 狼影, for the 狼影 interval (data), then
  // back on its tile with one 狼影 (no longer a full pack after the token's redeploy time)
  assert.equal(wolf.alive, false, 'last shadow falls');
  assert.ok(wolfTacticalPoint(wolf), '战术点形态');
  assert.equal(wolf.removed, false);
  assert.equal(wolfShadows(wolf), 0);
  const died = h.b.time, iv = wolfShadowInterval(wolf.def);
  assert.equal(iv, tokDef(TOKEN_IDS.wolfPack, 'chess_char_3_19_b').talents[0].bb.interval, 'the talent interval');
  assert.ok(h.runUntil(() => wolf.alive, iv + 1), 'back');
  approx(h.b.time - died, iv, 0.004);
  assert.deepEqual([wolf.tileR, wolf.tileC], [9, 6], 'on its tile');
  assert.equal(wolfShadows(wolf), 1, 'one 狼影');
  assert.equal(wolf.s.blockCnt, 1);
  checkInvariants(h.b);
});

test('hand-authored summoner kits: the board 狼群 deploys before 伺夜 (one pack); managed 海嗣 leaves its pulses to the owner kit', REAL, () => {
  // real 伺夜 kit (content/kits): the board wolf sits below-right of 伺夜, so it would deploy after him
  const h = makeBattle({ units: [{ chessId: 'chess_char_3_19_a', row: 11, col: 4, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.wolfPack, row: 9, col: 6, uid: 2, ownerUid: 1 }], autoFinish: false, timeLimit: 10 });
  h.step(3);
  const vigil = h.unit('chess_char_3_19_a');
  const packs = h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.wolfPack && u.alive);
  assert.equal(packs.length, 1, 'a single pack');
  assert.equal(packs[0].uid, 2, 'the player\'s piece');
  assert.equal(vigil.trait.reinforcement, packs[0]);
  // a summoner with a hand kit (no skill here): the seaborn does not run its own trait pulses
  const h2 = makeBattle({ defs: { chess: { test_guard: guard() } }, kits: { chess_char_6_04_a: bare }, units: [{ chessId: 'chess_char_6_04_a', row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 8 }], autoFinish: false, timeLimit: 30 });
  h2.step();
  const g = h2.unit('test_guard');
  g.hp = 1000;
  const sea = spawnOn(h2, h2.unit('chess_char_6_04_a'), TOKEN_IDS.seaborn, 10, 7);
  h2.run(3);
  assert.equal(g.hp, 1000, 'managed: no token-side trait');
  assert.equal(sea.mem.expiresAt, undefined, 'managed: lifetime left to the owner kit');
  checkInvariants(h.b);
});

test('tactician without a board piece: the 援军 is the real talent token (狼群), never the generic one', REAL, () => {
  const h = makeBattle({ kits: { chess_char_3_19_a: genericNoSkill }, units: [{ chessId: 'chess_char_3_19_a', row: 10, col: 3 }], autoFinish: false, timeLimit: 20 });
  h.step();
  const vigil = h.unit('chess_char_3_19_a');
  const w = vigil.trait.reinforcement;
  assert.ok(w && w.alive && w.defId === TOKEN_IDS.wolfPack);
  assert.ok(!h.b.allyUnits.some((u) => u.defId === 'token_tactician_reinforce'));
  checkInvariants(h.b);
});

test('流形: copies the nearest operator (scale × stats, block, range, damage type) after its SP fills; melee copy steals ATK/DEF', REAL, () => {
  const scaleA = tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_a').talents.find((t) => t.bb.scale != null).bb.scale;
  const steal = tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_a').talents.find((t) => t.bb.steal_atk != null).bb;
  const g = guard({ stats: { atk: 600, def: 300, maxHp: 5000, blockCnt: 2, bat: 1, res: 10 }, rangeGrid: [[0, 0], [0, 1]], dmgType: 'arts' });
  const h = makeBattle({
    defs: { chess: { test_guard: g }, enemies: { enemy_dummy: dummy({ atk: 500, def: 400 }) } },
    kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_a', row: 12, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 5, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 10, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], autoFinish: false, timeLimit: 60,
  });
  h.step();
  const m = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold);
  assert.equal(h.unit('chess_char_6_11_a').trait.reinforcement, m);
  assert.equal(m.mem.copy, null, 'not yet');
  const need = (m.skill.spCost - m.skill.sp) / m.s.spRecovery;
  assert.ok(h.runUntil(() => m.mem.copy, need + 1));
  approx(h.b.time, need, 0.1, 'copy after the SP gap (95 → 100)');
  approx(m.base.atk, 600 * scaleA, 1e-9);
  approx(m.base.def, 300 * scaleA, 1e-9);
  approx(m.base.maxHp, 5000 * scaleA, 1e-9);
  assert.equal(m.s.blockCnt, 2);
  assert.equal(m.profile.dmgType, 'arts');
  assert.equal(m.hp, m.s.maxHp);
  const e = h.enemy('enemy_dummy');
  h.run(4);
  assert.ok(m.mem.stolenAtk > 0 && m.mem.stolenAtk <= steal.steal_atk_max);
  approx(m.s.atk, 600 * scaleA + m.mem.stolenAtk, 1e-9, 'stolen ATK');
  approx(e.s.atk, 500 - m.mem.stolenAtk, 1e-9, 'robbed');
  checkInvariants(h.b);
  // 精锐: +sp ⇒ copies at once, scale 1
  const h2 = makeBattle({ defs: { chess: { test_guard: g } }, kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_b', row: 12, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 5, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 10, col: 6, uid: 3, ownerUid: 1 }], autoFinish: false, timeLimit: 10 });
  h2.step(2);
  const m2 = h2.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold);
  assert.ok(m2.mem.copy);
  approx(m2.base.atk, 600, 1e-9);
});

test('流形 ranged copy splits into a timed clone every N attacks', REAL, () => {
  const tal = tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_a').talents.find((t) => t.bb.steal_atk != null).bb;
  const every = tal['mlyss_wtrman_t_2[range].max_stack_cnt'];
  const sniper = chessRec({ id: 'test_sniper', profession: 'SNIPER', skill: null, stats: { atk: 300, bat: 0.2, maxHp: 1000 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [1, 1], [-1, 1]] });
  const h = makeBattle({
    defs: { chess: { test_sniper: sniper }, enemies: { enemy_dummy: dummy() } }, kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_b', row: 12, col: 3, uid: 1 }, { chessId: 'test_sniper', row: 10, col: 4, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 10, col: 5, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 60,
  });
  h.step(2);
  const m = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold && !u.mem.isClone);
  assert.ok(m.mem.copy && m.mem.copy.ranged);
  assert.ok(h.runUntil(() => m.stats.attacks >= every, 20));
  h.step();
  const clone = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold && u.mem.isClone);
  assert.ok(clone && clone.alive, 'split');
  assert.ok(m.alive, 'the original stays (clones are outside the deploy limit)');
  approx(clone.base.atk, m.base.atk, 1e-9);
  h.runUntil(() => !clone.alive, tal.interval + 1);
  approx(clone.deathAt - clone.deployedAt, tal.interval, 0.05, 'clone lifetime');
  checkInvariants(h.b);
});

test('香槟炸弹: the first ground enemy on its tile takes owner ATK × atk_scale (×2 after duration_switch s) and sluggish', REAL, () => {
  const bb = tokDef(TOKEN_IDS.champagne, 'chess_char_3_04_a').skill.bb;
  // armed for > duration_switch before contact: two hits
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_walker: walker() } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_walker', route: 0, time: 1 }], autoFinish: false, timeLimit: 60, hooks: ['death'] });
  h.step();
  const bomb = spawnOn(h, h.unit('test_owner'), TOKEN_IDS.champagne, 9, 6);
  assert.equal(bomb.s.flags.untargetable, true);
  const e = () => h.enemy('enemy_walker');
  assert.ok(h.runUntil(() => !bomb.alive, 30), 'consumed');
  assert.ok(h.b.time - bomb.deployedAt >= bb.duration_switch);
  approx(1e6 - e().hp, 2 * 1000 * bb['attack@atk_scale'], 1e-9, 'two hits');
  assert.ok(e().findBuff('sluggish'));
  approx(e().findBuff('sluggish').timeLeft, bb['attack@sluggish'], 0.05);
  // fresh bomb under an enemy: one hit
  const h2 = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], autoFinish: false, timeLimit: 10 });
  h2.step();
  h2.b.spawnToken(h2.unit('test_owner'), TOKEN_IDS.champagne, 9, 6);
  h2.step(2);
  approx(1e7 - h2.enemy('enemy_dummy').hp, 1000 * bb['attack@atk_scale'], 1e-9, 'one hit');
  checkInvariants(h.b);
});

test('从不混淆的方向: marker of the owner\'s tile; when the skill ends it vanishes and the owner walks back', REAL, () => {
  const kit = () => ({ talents: [], skill: { kind: 'duration', duration: 3, trigger: 'SP_FULL', spCost: 1, initSp: 1,
    onStart({ battle, unit }) {
      const [r, c] = [unit.tileR, unit.tileC];
      if (battle.relocate(unit, 10, 7)) battle.spawnToken(unit, TOKEN_IDS.ulpiaMarker, r, c);
    } } });
  const h = makeBattle({ kits: { chess_char_5_05_a: kit }, units: [{ chessId: 'chess_char_5_05_a', row: 10, col: 4 }], autoFinish: false, timeLimit: 20 });
  h.step(2);
  const u = h.unit('chess_char_5_05_a');
  const marker = h.b.allyUnits.find((x) => x.defId === TOKEN_IDS.ulpiaMarker);
  assert.ok(marker && marker.alive && u.tileC === 7);
  assert.equal(marker.s.flags.untargetable, true);
  assert.ok(marker.profile.noAttack);
  h.runUntil(() => !marker.alive, 5);
  assert.equal(marker.alive, false);
  assert.deepEqual([u.tileR, u.tileC], [10, 4], 'back home');
  checkInvariants(h.b);
});

test('黄金盟誓: attacks deal true damage; lasts while the owner skill runs', REAL, () => {
  const kit = () => ({ talents: [], skill: { kind: 'duration', duration: 6, trigger: 'SP_FULL', spCost: 1, initSp: 1,
    onStart({ battle, unit }) { battle.spawnToken(unit, TOKEN_IDS.goldenOath, 9, 6); } } });
  const types = new Set();
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ def: 5000 }) } }, kits: { chess_char_6_07_a: kit }, units: [{ chessId: 'chess_char_6_07_a', row: 12, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], autoFinish: false, timeLimit: 30,
    setup: (b) => b.on('damaged', (c) => { if (c.source?.defId === TOKEN_IDS.goldenOath) types.add(c.type); }) });
  h.step(2);
  const lion = h.b.allyUnits.find((x) => x.defId === TOKEN_IDS.goldenOath);
  assert.ok(lion && lion.alive);
  assert.equal(lion.profile.dmgType, 'true');
  h.runUntil(() => !lion.alive, 8);
  assert.deepEqual([...types], ['true']);
  approx(lion.deathAt - lion.deployedAt, 6, 0.05);
  checkInvariants(h.b);
});

test('爬行号·防护单元: shield = 凯瑟琳 max HP × max_shield_ratio on the operator in front; refills when not hit', REAL, () => {
  const t = tokDef(TOKEN_IDS.catShield, 'chess_char_4_11_a').talents[0].bb;
  const h = makeBattle({ defs: { chess: { test_guard: guard() } }, kits: { chess_char_4_11_a: bare }, units: [{ chessId: 'chess_char_4_11_a', row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 5 }], autoFinish: false, timeLimit: 60 });
  h.step();
  const cathy = h.unit('chess_char_4_11_a');
  const g = h.unit('test_guard');
  const dev = spawnOn(h, cathy, TOKEN_IDS.catShield, 10, 4);
  assert.equal(dev.s.flags.untargetable, true);
  const cap = cathy.s.maxHp * t.max_shield_ratio;
  approx(g.s.shield, cap, 1e-9, 'initial shield');
  h.b.dealDamage(null, g, { amount: cap * 0.75, type: 'true' });
  approx(g.s.shield, cap * 0.25, 1e-6);
  h.run(t.interval - 0.5);
  approx(g.s.shield, cap * 0.25, 1e-6, 'no refill while recently hit');
  h.run(1.6);
  assert.ok(g.s.shield > cap * 0.25 + cathy.s.maxHp * t.shield_ratio_each_trigger * 0.99, 'refilled');
  h.run(10);
  approx(g.s.shield, cap, 1e-6, 'capped');
  // a second device cannot stack on the same operator
  const dev2 = spawnOn(h, cathy, TOKEN_IDS.catShield, 11, 5);
  assert.ok(dev2.alive);
  assert.equal(dev2.mem.target ?? null, null);
  checkInvariants(h.b);
});

test('every token of data/tokens.json spawns with data defaults and runs without content errors', REAL, () => {
  const raw = ds.raw.tokens && Object.keys(ds.raw.tokens).length ? ds.raw.tokens : {};
  const ids = Object.keys(raw).filter((id) => id !== TOKEN_IDS.yanyou);
  assert.ok(ids.length >= 21);
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_walker: walker({ atk: 50 }) } }, units: [{ chessId: 'test_owner', row: 12, col: 2 }], enemies: [{ key: 'enemy_walker', route: 0, count: 5, interval: 2 }], autoFinish: false, timeLimit: 60 });
  h.step();
  const o = h.unit('test_owner');
  const tiles = [];
  for (let r = 9; r <= 12; r++) for (let c = 3; c <= 9; c++) tiles.push([r, c]);
  for (const id of ids) {
    const [r, c] = tiles.shift();
    const t = h.b.spawnToken(raw[id].kind === 'mapChar' ? 'p1' : o, id, r, c);
    assert.ok(t, `${id} spawned`);
    assert.ok(t.kit && t.kit.fromTokens, `${id} uses its token kit`);
  }
  h.run(10);
  const errs = h.b.errors.filter((e) => /tokens\.js|devices\.js/.test(String(e.stack)));
  assert.deepEqual(errs, []);
  for (const id of [TOKEN_IDS.deliveryTarget, TOKEN_IDS.eagle1, TOKEN_IDS.eagle2, TOKEN_IDS.eagle3, TOKEN_IDS.iceTarget]) {
    const t = h.b.allyUnits.find((u) => u.defId === id);
    assert.ok(t.profile.noAttack, `${id} inert`);
    assert.equal(t.stats.attacks, 0);
  }
  assert.equal(h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.iceTarget).s.blockCnt, 3);
  checkInvariants(h.b);
});

test('deploy limit: a new summon of the same owner withdraws the oldest (医疗探机 limit 1)', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner() } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], autoFinish: false, timeLimit: 30 });
  h.step();
  const o = h.unit('test_owner');
  const a = spawnOn(h, o, TOKEN_IDS.healDrone, 10, 4);
  const b = spawnOn(h, o, TOKEN_IDS.healDrone, 10, 6);
  assert.equal(a.alive, false);
  assert.equal(b.alive, true);
});

test('炎佑: spawnYanyou — flying ally, bond stats, 3 targets with burn + elemental fragility, 祛恶之焰 after its cooldown', REAL, () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [], enemies: [{ key: 'enemy_dummy', pos: [9, 7] }, { key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [9, 8] }, { key: 'enemy_dummy', pos: [12, 9] }], autoFinish: false, timeLimit: 60 });
  h.step();
  const ys = spawnYanyou(h.b, 'p1', { atk: 1000, hp: 6000, atkMul: 1.5, dmgTakenMul: 0.1, count: 2 });
  assert.equal(ys.length, 2);
  const y = ys[0];
  assert.equal(y.motion, 'FLY');
  approx(y.s.atk, (600 + 1000) * 1.5, 1e-9, 'template 600 + the bond share, ×1.5');
  assert.equal(y.s.maxHp, 12000 + 6000);
  assert.equal(y.hp, 18000);
  approx(y.s.dmgTakenMul, 0.1, 1e-9);
  assert.equal(y.s.blockCnt, 0);
  const x0 = y.x, y0 = y.y;
  h.run(14);
  assert.ok(Math.hypot(y.x - x0, y.y - y0) > 0.5, 'flies toward the enemies');
  const hit = h.enemies().filter((e) => e.hp < 1e7);
  assert.ok(hit.length >= 3, `hits 3 targets (${hit.length})`);
  assert.ok(ys.every((u) => u.stats.attacks > 0 && u.x >= h.b.rect.c0 && u.x <= h.b.rect.c1));
  const burned = h.enemies().find((e) => e.elem.burn > 0 || e.findBuff('burnBurst'));
  assert.ok(burned, 'burn gauge');
  const frag = h.enemies().find((e) => e.findBuff('elemFragile'));
  assert.ok(frag, 'elemental fragility (元素脆弱 status)');
  approx(frag.s.elementalTakenMul, 1.2, 1e-9);
  assert.ok(h.runUntil(() => y.skill.activations >= 1, 10), '祛恶之焰');
  approx(y.skill.lastStart, 15, 1.5, 'first flame after initCooldown');
  h.run(2);
  assert.ok(h.eventsOf('fx').some((e) => e[1] === 'yanyouFlame'));
  checkInvariants(h.b);
});

test('band map characters: spawnMapChar puts 预备干员-医疗 at its stage slot; Touch 恳切福音 heals ×heal_scale on allies below 50 % HP', REAL, () => {
  const g = guard({ stats: { maxHp: 10000 } });
  const h = makeBattle({ stageId: 'act2autochess_m01', defs: { chess: { test_guard: g } }, units: [{ chessId: 'test_guard', row: 10, col: 3 }], autoFinish: false, timeLimit: 60,
    setup: (b) => b.on('heal', (c) => { if (c.source?.defId === TOKEN_IDS.touch) (b.mem ??= []).push({ amount: c.amount, ratio: c.target.hpRatio, active: c.source.skill.active }); }, { priority: -500 }) });
  h.step();
  const med = spawnMapChar(h.b, 'p1', TOKEN_IDS.reserveMedic);
  assert.ok(med);
  assert.deepEqual([med.tileR, med.tileC], [10, 2]);
  const gu = h.unit('test_guard');
  gu.hp = 5000;
  h.run(4);
  assert.ok(gu.hp > 5000, 'healed');
  h.b.retreat(med, { reason: 'retreat', permanent: true });
  h.step();
  const touch = spawnMapChar(h.b, 'p1', TOKEN_IDS.touch);
  assert.ok(touch);
  touch.skill.activate('test', { free: true });
  gu.hp = 3000;
  h.run(4);
  const bb = touch.skill.bb;
  const low = h.b.mem.find((x) => x.active && x.ratio < bb.hp_ratio);
  assert.ok(low, 'healed a low ally');
  approx(low.amount, touch.s.atk * bb.heal_scale, 1e-6, 'boosted heal');
  checkInvariants(h.b);
});

test('fallbacks for generic summoners: 赫默 placed drone on skill, 夕 小自在 on the first attack; 凯瑟琳 places nothing herself', REAL, () => {
  // 赫默 (generic kit): S2 fires on an injured ally → the placed drone piece takes the field on its tile
  const h = makeBattle({
    defs: { chess: { test_guard: guard({ stats: { maxHp: 1e5, atk: 0 } }) } }, kits: { chess_char_2_02_a: genericKit },
    units: [{ chessId: 'chess_char_2_02_a', row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 4, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.healDrone, ownerUid: 1, row: 11, col: 3, uid: 3 }],
    autoFinish: false, timeLimit: 60,
  });
  h.step();
  const hm = h.unit('chess_char_2_02_a');
  assert.equal(h.unit(3).alive, true, 'the free start deploy (PRTS; shared/constants.js SKILL_SUMMON_START_DEPLOY)');
  assert.ok(h.runUntil(() => !h.unit(3).alive, 12), 'its 10 s');
  h.unit('test_guard').hp = 500;
  assert.ok(h.runUntil(() => hm.skill.activations >= 1, 40));
  h.step();
  assert.ok(h.b.allyUnits.some((u) => u.defId === TOKEN_IDS.healDrone && u.alive && u.ownerUnit === hm && u.tileR === 11 && u.tileC === 3), 'drone deployed on its tile');
  // 夕 (generic): 小自在 near the first target
  const h2 = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, kits: { chess_char_5_12_a: genericKit }, units: [{ chessId: 'chess_char_5_12_a', row: 10, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], autoFinish: false, timeLimit: 30 });
  assert.ok(h2.runUntil(() => h2.b.allyUnits.some((u) => u.defId === TOKEN_IDS.duskDragon), 10));
  const dd = h2.b.allyUnits.find((u) => u.defId === TOKEN_IDS.duskDragon);
  assert.ok(Math.abs(dd.tileC - 5) + Math.abs(dd.tileR - 10) <= 1, 'at the target');
  h2.runUntil(() => !dd.alive, 30);
  approx(dd.deathAt - dd.deployedAt, 25, 0.05);
  // 凯瑟琳 (generic): her devices are hand pieces (user playtest #6) — none placed, none in battle; a placed one serves
  const h3 = makeBattle({ defs: { chess: { test_guard: guard() } }, kits: { chess_char_4_11_a: genericKit }, units: [{ chessId: 'chess_char_4_11_a', row: 10, col: 3 }, { chessId: 'test_guard', row: 10, col: 5 }, { chessId: 'test_guard', row: 11, col: 5, uid: 9 }], autoFinish: false, timeLimit: 10 });
  h3.run(1);
  assert.equal(h3.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.catShield).length, 0, 'no device of her own');
  const h4 = makeBattle({
    defs: { chess: { test_guard: guard() } }, kits: { chess_char_4_11_a: genericKit },
    units: [{ chessId: 'chess_char_4_11_a', row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 5, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.catShield, ownerUid: 1, row: 10, col: 4, uid: 3, dir: 'RIGHT' }],
    autoFinish: false, timeLimit: 10,
  });
  h4.step();
  assert.ok(h4.unit(3).alive, 'the placed device deploys with the board');
  assert.ok(h4.unit(2).s.shield > 0, 'and shields the operator it faces');
  checkInvariants(h3.b);
  checkInvariants(h4.b);
});

// =================================================================================================================
// devices & terrain

test('阻隔工事: map card overrides remove crates before deployment; a harmless walker stopped by a crate breaks it', REAL, () => {
  const bb = { 'trap_1105_accrate#001': 0, 'trap_1105_accrate#002': 0, 'trap_1105_accrate#003': 0 };
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 5 }], bonds: {}, deviceOverrides: bb }];
  const h = makeBattle({ stageId: 'act1autochess_m01', defs: { chess: { test_guard: guard() } }, players, autoFinish: false, timeLimit: 10 });
  h.step();
  assert.equal(h.b.allyUnits.filter((u) => u.kind === 'device' && u.alive).length, 0, 'crates removed');
  assert.ok(h.unit('test_guard').deployed, 'the guard stands where crate #002 was');
  assert.equal(h.b.grid.isObstacle(10, 5), false);
  const plain = makeBattle({ stageId: 'act1autochess_m01', autoFinish: false, timeLimit: 10 });
  plain.step();
  assert.equal(plain.b.allyUnits.filter((u) => u.kind === 'device' && u.alive).length, 3);
  // walled lane: an atk-0 walker still gets through (the engine alone would stall until the time limit)
  const crates = [[9, 6], [10, 6], [11, 6], [12, 6]];
  const w = makeBattle({ flat: { crates }, timeLimit: 60, defs: { enemies: { enemy_walker: walker({ atk: 0, speed: 2 }) } }, enemies: [{ key: 'enemy_walker' }] });
  w.runToEnd(70);
  assert.equal(w.result().reason, 'cleared');
  assert.equal(w.result().perPlayer.p1.leaked.length, 1);
  assert.ok(w.b.allyUnits.some((u) => u.kind === 'device' && !u.alive));
  assert.ok(w.eventsOf('fx').some((e) => e[1] === 'crateBreak'));
  checkInvariants(w.b);
});

test('射击台 overrides (模拟战场演变·模式二): crates become platforms — obstacle + operators on them never block', REAL, () => {
  const e = ds.raw.effects?.map_m02_1;
  const ov = {};
  for (const b of e?.buffs ?? [{ bb: { 'trap_1105_accrate#001': 0, 'trap_1105_accrate#002': 0, 'trap_1106_achplat#001': 1, 'trap_1106_achplat#002': 1 } }]) Object.assign(ov, b.bb);
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 12, col: 4 }], bonds: {}, deviceOverrides: ov }];
  const h = makeBattle({ stageId: 'act1autochess_m02', defs: { chess: { test_guard: guard() } }, players, autoFinish: false, timeLimit: 10 });
  h.step();
  const g = h.unit('test_guard');
  assert.ok(g.deployed);
  assert.equal(g.ground, false, 'elevated on the platform');
  assert.ok(h.b.grid.isObstacle(12, 4) && h.b.grid.isObstacle(12, 5), 'platform obstacles');
  assert.ok(!h.b.allyUnits.some((u) => u.kind === 'device' && u.alive && u.tileR === 12 && (u.tileC === 4 || u.tileC === 5)), 'no crates there');
  assert.equal(deviceOverridesOf(h.b).get('trap_1106_achplat#001'), true);
});

test('气流 (act2 m01 blowers): enemies moving with the flow ×(1+equal), against ×(1+opposite); operators across it unchanged', REAL, () => {
  const stage = ds.getStage('act2autochess_m01');
  const bb = stage.devices.find((d) => d.role === 'blower').raw.skill.bb;
  const run = (route) => {
    const muls = new Set();
    const h = makeBattle({ stageId: 'act2autochess_m01', defs: { chess: { test_guard: guard() }, enemies: { enemy_walker: walker() } }, units: [{ chessId: 'test_guard', row: 11, col: 5 }], enemies: [{ key: 'enemy_walker', route }], autoFinish: false, timeLimit: 30,
      setup: (b) => b.on('tick', () => { const e = b.enemies[0]; if (e && Math.round(e.x) === 9 && Math.round(e.y) >= 10 && Math.round(e.y) <= 11) muls.add(Math.round(e.s.moveSpeed * 100) / 100); }) });
    h.run(12);
    assert.equal(h.unit('test_guard').findBuff('terrain:airflow'), null, 'facing across the flow: ATK +0');
    return muls;
  };
  const down = run({ motion: 'WALK', start: [12, 9], end: [9, 2], checkpoints: [] });
  assert.ok(down.has(Math.round((1 + bb['blower_s_enemy[equal].move_speed']) * 100) / 100), `with the flow ${[...down]}`);
  const up = run({ motion: 'WALK', start: [9, 9], end: [12, 9], checkpoints: [] });
  assert.ok(up.has(Math.round((1 + bb['blower_s_enemy[opposite].move_speed']) * 100) / 100), `against the flow ${[...up]}`);
});

test('沼泽 (act2 m02): a trigger on entering and every second — 1 layer (an enemy of 重量 ≥ 3: 2) of ASPD −5 / move −5 %, at most 10; operators ASPD only; cleared on leaving', REAL, () => {
  const mire = ds.getStage('act2autochess_m02').special.mire;
  // PRTS 沼泽控制: "每秒将会触发一次" (sktok_mire spData maxChargeTime 1); "若其重量大于等于3，改为获得2层" (the skill's value 3)
  assert.equal(mire.intervalSec, 1);
  assert.equal(mire.heavyWeight, 3);
  const h = makeBattle({ stageId: 'act2autochess_m02', defs: { chess: { test_guard: guard() } }, units: [{ chessId: 'test_guard', row: 11, col: 7 }], autoFinish: false, timeLimit: 60 });
  h.step(2);
  assert.equal(terrainAt(h.b, 11, 7), 'mire');
  const g = h.unit('test_guard');
  approx(g.s.aspd, 100 + mire.aspdPerStack * 100, 1e-9, '1 layer');
  assert.equal(g.findBuff('terrain:mire').mods.moveMul, undefined, 'an operator gets the ASPD part only');
  h.run(mire.intervalSec);
  approx(g.s.aspd, 100 + 2 * mire.aspdPerStack * 100, 1e-9, '2 layers');
  h.run(mire.intervalSec * mire.maxStacks);
  approx(g.s.aspd, 100 + mire.maxStacks * mire.aspdPerStack * 100, 1e-9, 'max layers');
  // enemies standing in the mire: 重量 1 gains 1 layer a second, 重量 3 two (heavyWeight), both capped at maxStacks
  const layersOver = (mass) => {
    const key = `enemy_mass${mass}`;
    const h3 = makeBattle({ stageId: 'act2autochess_m02', defs: { enemies: { [key]: walker({ key, mass }) } }, enemies: [{ key, pos: [10, 7], route: { motion: 'WALK', start: [10, 7], end: [10, 7], checkpoints: [{ type: 'WAIT', time: 99 }] } }], autoFinish: false, timeLimit: 60 });
    h3.step();
    const e = h3.enemy(key);
    assert.equal(terrainAt(h3.b, 10, 7), 'mire');
    const t0 = e.mem.terrainSince;
    const out = [0.5, 1.5, 2.5, 4.5, 9.5, 20].map((t) => {
      h3.run(t0 + t - h3.b.time);
      const n = Math.round((e.s.aspd - 100) / (mire.aspdPerStack * 100));
      approx(e.s.moveSpeed, 1 + n * mire.moveMulPerStack, 1e-9, `move ×(1 − 5 % × ${n})`);
      return n;
    });
    checkInvariants(h3.b);
    return out;
  };
  assert.deepEqual(layersOver(1), [1, 2, 3, 5, 10, 10], 'weight 1: a layer per second');
  assert.deepEqual(layersOver(3), [2, 4, 6, 10, 10, 10], 'weight 3: two layers per second');
  // an enemy walking down col 7 (mire) is slowed there and recovers once it leaves
  const h2 = makeBattle({ stageId: 'act2autochess_m02', defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', route: { motion: 'WALK', start: [12, 7], end: [9, 2], checkpoints: [] } }], autoFinish: false, timeLimit: 60 });
  let slowed = false;
  h2.b.on('tick', () => { const x = h2.b.enemies[0]; if (x && x.findBuff('terrain:mire') && x.s.moveSpeed < 1 - 1e-9) slowed = true; });
  h2.step();
  const x = h2.enemy('enemy_walker');
  h2.runUntil(() => Math.round(x.y) === 9 && Math.round(x.x) <= 6, 40);
  h2.step();
  assert.ok(slowed, 'slowed on the mire');
  assert.equal(x.findBuff('terrain:mire'), null, 'cleared on leaving');
  approx(x.s.moveSpeed, 1, 1e-9);
  checkInvariants(h.b);
});

test('烟雾 (act2 m03): an operator on smog is not picked by ranged enemies; the one beside it is', REAL, () => {
  const shooter = enemyRec({ key: 'enemy_shooter', hp: 1e7, speed: 0, atk: 200, range: 2.5, bat: 1 });
  const h = makeBattle({ stageId: 'act2autochess_m03', defs: { chess: { test_guard: guard() }, enemies: { enemy_shooter: shooter } }, units: [{ chessId: 'test_guard', row: 12, col: 5, uid: 1 }, { chessId: 'test_guard', row: 12, col: 6, uid: 2 }], enemies: [{ key: 'enemy_shooter', pos: [11, 5.5] }], autoFinish: false, timeLimit: 30 });
  h.run(6);
  const onSmog = h.unit(2), off = h.unit(1);
  assert.equal(terrainAt(h.b, 12, 6), 'smog');
  assert.ok(onSmog.s.flags.stealth);
  assert.equal(onSmog.stats.taken, 0, 'untouched on smog (and deployed last: would be the preferred target)');
  assert.ok(off.stats.taken > 0);
  checkInvariants(h.b);
});

test('深水 (act2 m04): ground enemies in deep water take damage/s, ASPD −60, move ×0.6', REAL, () => {
  const bb = ds.getStage('act2autochess_m04').special.deepsea.bb;
  const h = makeBattle({ stageId: 'act2autochess_m04', defs: { enemies: { enemy_dummy: dummy({ speed: 1 }), enemy_fly: dummy({ key: 'enemy_fly', motion: 'FLY', speed: 1 }) } }, routes: [{ motion: 'WALK', start: [11, 6], end: [11, 6], checkpoints: [{ type: 'WAIT', time: 99 }] }], enemies: [{ key: 'enemy_dummy', pos: [11, 6], route: { motion: 'WALK', start: [11, 6], end: [9, 2], checkpoints: [{ type: 'WAIT', time: 99 }] } }, { key: 'enemy_fly', pos: [11, 6], route: { motion: 'FLY', start: [11, 6], end: [9, 2], checkpoints: [{ type: 'WAIT', time: 99 }] } }], autoFinish: false, timeLimit: 30 });
  h.step();
  h.run(3);
  const e = h.enemy('enemy_dummy'), f = h.enemy('enemy_fly');
  assert.equal(terrainAt(h.b, 11, 6), 'deepsea');
  approx(1e7 - e.hp, 3 * bb['sea_drown[enemy].damage'], 1e-9, 'damage');
  approx(e.s.aspd, 100 + bb['sea_drown[enemy].attack_speed'] * 100, 1e-9);
  approx(e.s.moveSpeed, bb['sea_drown[enemy].move_speed'], 1e-9);
  assert.equal(f.hp, 1e7, 'flyers are not in the water');
  checkInvariants(h.b);
});

// PRTS 涨潮控制 技能3 深水: "【水蚀】的敌方单位每秒受到40点无来源真实持续伤害（不属于环境伤害，不会触发受击回复）"
test('深水: the 【水蚀】 tick is 无来源 true 持续伤害, not 环境伤害 (tags dot / periodic / deepsea, no terrain, no 受击回复) — 纠缠藤蔓 does not turn fragile in it', REAL, () => {
  const bb = ds.getStage('act2autochess_m04').special.deepsea.bb;
  const dmg = bb['sea_drown[enemy].damage'];
  const wait = (pos) => ({ motion: 'WALK', start: pos, end: [9, 2], checkpoints: [{ type: 'WAIT', time: 99 }] });
  const ticks = [];
  const h = makeBattle({ stageId: 'act2autochess_m04', defs: { enemies: { enemy_dummy: dummy({ speed: 1 }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 6], route: wait([11, 6]) }, { key: 'enemy_2052_smgia', pos: [10, 6], route: wait([10, 6]) }], autoFinish: false, timeLimit: 30,
    setup: (b) => b.on('hit', ({ source, target, dmg: d }) => { if (target.defId === 'enemy_dummy') ticks.push({ source, type: d.type, tags: [...d.tags], sourceless: d.sourceless, noSp: d.noSp }); }) });
  h.step();
  h.run(5);
  const e = h.enemy('enemy_dummy'), vine = h.enemy('enemy_2052_smgia');
  assert.deepEqual([terrainAt(h.b, 11, 6), terrainAt(h.b, 10, 6)], ['deepsea', 'deepsea']);
  assert.equal(ticks.length, 5);
  for (const t of ticks) {
    assert.equal(t.source, null);
    assert.equal(t.type, 'true');
    assert.deepEqual(t.tags, ['dot', 'periodic', 'deepsea']);
    assert.ok(t.sourceless && t.noSp);
  }
  approx(1e7 - e.hp, 5 * dmg, 1e-9);
  assert.equal(vine.findBuff('ab:natureWeak'), null, '受到来自自然环境的伤害 does not fire');
  approx(vine.s.maxHp - vine.hp, 5 * dmg, 1e-9, '40/s, not ×2');
  checkInvariants(h.b);
});

test('活性源石 (act1 m04): units on it take damage/s and gain ATK/ASPD (allies and ground enemies)', REAL, () => {
  const bb = ds.getStage('act1autochess_m04').special.infection.bb;
  const g = guard({ stats: { atk: 1000, maxHp: 1e5 } });
  const h = makeBattle({ stageId: 'act1autochess_m04', defs: { chess: { test_guard: g }, enemies: { enemy_dummy: dummy({ atk: 500 }) } }, units: [{ chessId: 'test_guard', row: 11, col: 6 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 30 });
  h.step();
  h.run(2);
  const u = h.unit('test_guard'), e = h.enemy('enemy_dummy');
  assert.equal(terrainAt(h.b, 11, 6), 'infection');
  approx(u.s.atk, 1000 * (1 + bb.atk), 1e-9);
  approx(u.s.aspd, 100 + bb.attack_speed, 1e-9);
  approx(u.stats.taken, 2 * bb.damage, 1e-9, 'ally damage');
  approx(e.s.atk, 500 * (1 + bb.atk), 1e-9);
  assert.ok(e.stats.taken >= 2 * bb.damage - 1e-9);
  checkInvariants(h.b);
});

// GitHub #33 item 6: the effect is timed (PRTS tile template "经过的敌军在{duration}s内…"), not tied to standing on the tile
test('活性源石: an enemy keeps the effect after leaving the tile — damage/s, ATK and ASPD go on for `duration` s', REAL, () => {
  const bb = ds.getStage('act1autochess_m04').special.infection.bb;
  // a harmless walker crosses (11,6) going left, then waits on (11,4), off the tile
  const route = { motion: 'WALK', start: [11, 8], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [11, 4] }, { type: 'WAIT', time: 99 }] };
  const h = makeBattle({ stageId: 'act1autochess_m04', defs: { enemies: { enemy_walker: walker({ atk: 500 }) } }, enemies: [{ key: 'enemy_walker', route }], autoFinish: false, timeLimit: 120 });
  h.step();
  const e = h.enemy('enemy_walker');
  const onTile = () => Math.round(e.y) === 11 && Math.round(e.x) === 6;
  assert.ok(h.runUntil(onTile, 10), 'steps on (11,6)');
  assert.ok(h.runUntil(() => !onTile(), 10), 'walks off');
  assert.ok(e.findBuff('terrain:infection'), 'still carries the effect after leaving');
  const hp0 = e.hp;
  h.run(20);
  assert.deepEqual([Math.round(e.y), Math.round(e.x)], [11, 4], 'waits off the tile');
  const loss = hp0 - e.hp;
  assert.ok(Math.abs(loss - 20 * bb.damage) <= bb.damage + 1e-6, `20 s after leaving: lost ${loss}, ≈ 20 × ${bb.damage}`);
  approx(e.s.atk, 500 * (1 + bb.atk), 1e-9);
  approx(e.s.aspd, 100 + bb.attack_speed, 1e-9);
  const b = e.findBuff('terrain:infection');
  assert.ok(Math.abs(b.timeLeft - (bb.duration - 20)) <= 3 * h.TICK, `${b.timeLeft} s left of ${bb.duration}`);
  checkInvariants(h.b);
});

test('活性源石: one effect per unit — contact restarts its duration, it ends `duration` s after the last contact; the tiles never switch off', REAL, () => {
  const stage = structuredClone(ds.getStage('act1autochess_m04'));
  const bb = stage.special.infection.bb;
  bb.duration = 10; // short, so that the end is inside the test
  // the walker crosses (11,6) to (11,4), walks straight back over it to (11,8) and waits there
  const route = { motion: 'WALK', start: [11, 8], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [11, 4] }, { type: 'MOVE', pos: [11, 8] }, { type: 'WAIT', time: 99 }] };
  const h = makeBattle({ stage, defs: { enemies: { enemy_walker: walker({ atk: 500 }) } }, enemies: [{ key: 'enemy_walker', route }], autoFinish: false, timeLimit: 120 });
  h.step();
  const e = h.enemy('enemy_walker');
  const onTile = () => Math.round(e.y) === 11 && Math.round(e.x) === 6;
  const hp0 = e.hp;
  let first = null, lastOn = null, end = null, contacts = 0, was = false, most = 0, atkMax = 0;
  while (h.b.time < 40 && end == null) {
    h.step();
    const on = onTile();
    if (on && !was) contacts++;
    was = on;
    const n = e.buffs.filter((x) => x.key === 'terrain:infection').length;
    most = Math.max(most, n);
    atkMax = Math.max(atkMax, e.s.atk);
    if (on) { lastOn = h.b.time; first ??= h.b.time; }
    if (first != null && n === 0) end = h.b.time;
  }
  assert.equal(contacts, 2, 'walked over the tile twice');
  assert.equal(most, 1, 'never a second effect');
  approx(atkMax, 500 * (1 + bb.atk), 1e-9, 'ATK + atk once');
  assert.ok(end != null && end > first + bb.duration, `outlived its first ${bb.duration} s: the second contact restarted it (${first} → ${end})`);
  assert.ok(Math.abs(end - (lastOn + bb.duration)) <= 2 * h.TICK, `ends ${bb.duration} s after the last contact (${lastOn} → ${end})`);
  const loss = hp0 - e.hp;
  assert.ok(Math.abs(loss - bb.damage * (end - first)) <= bb.damage + 1e-6, `${bb.damage}/s while it lasted: lost ${loss} in ${end - first} s`);
  h.run(3);
  assert.equal(e.hp, hp0 - loss, 'nothing after the end');
  approx(e.s.atk, 500, 1e-9);
  // an operator deployed on it is always in contact: it keeps draining past `duration` (no lifetime of the tiles; 3 ×
  // `duration`, so that a shut-off at `duration` followed by the effect's own `duration` would still show)
  const g = guard({ stats: { atk: 1000, maxHp: 1e5 } });
  const h2 = makeBattle({ stage, defs: { chess: { test_guard: g } }, units: [{ chessId: 'test_guard', row: 11, col: 6 }], autoFinish: false, timeLimit: 120 });
  h2.step();
  h2.run(3 * bb.duration);
  const u = h2.unit('test_guard');
  approx(u.stats.taken, 3 * bb.duration * bb.damage, 1e-9, 'ally damage');
  approx(u.s.atk, 1000 * (1 + bb.atk), 1e-9);
  // moved off the tile (Battle.relocate, as 乌尔比安 S3 does), it keeps the effect for its time, then it ends
  assert.ok(h2.b.relocate(u, 11, 7));
  const taken0 = u.stats.taken;
  h2.run(3);
  assert.ok(u.findBuff('terrain:infection'), 'kept after the move');
  approx(u.stats.taken - taken0, 3 * bb.damage, 1e-9, 'still draining');
  h2.run(bb.duration);
  assert.equal(u.findBuff('terrain:infection'), null, `gone ${bb.duration} s after the move`);
  approx(u.s.atk, 1000, 1e-9);
  checkInvariants(h.b);
  checkInvariants(h2.b);
});

test('活性源石: a 重生 clears the lasting effect — a 深池逐火战士 that crossed the tile, knocked out off it, stands up from its ember after 1 + 10 s', REAL, () => {
  const key = 'enemy_1288_duskls';
  const delay = ds.getEnemy(key).talent['Revive[Trigger].interval'];
  // it crosses (11,6) going left, then waits on (11,4), off the tile
  const route = { motion: 'WALK', start: [11, 8], end: [9, 2], checkpoints: [{ type: 'MOVE', pos: [11, 4] }, { type: 'WAIT', time: 99 }] };
  const h = makeBattle({ stageId: 'act1autochess_m04', enemies: [{ key, route }], autoFinish: false, timeLimit: 120 });
  h.step();
  const e = h.enemy(key);
  const onTile = () => Math.round(e.y) === 11 && Math.round(e.x) === 6;
  assert.ok(h.runUntil(onTile, 20), 'steps on (11,6)');
  assert.ok(h.runUntil(() => Math.round(e.x) === 4, 20), 'waits on (11,4)');
  assert.ok(e.findBuff('terrain:infection'), 'carries the effect off the tile');
  const max = e.s.maxHp;
  h.b.dealDamage(null, e, { amount: e.hp + 1e6, type: 'true', canDodge: false });
  assert.ok(e.alive, 'knocked out into its ember');
  assert.equal(e.findBuff('terrain:infection'), null, 'the 重生 cleared it');
  h.run(HUSK_REBIRTH + delay - 0.5);
  assert.ok(e.alive && e.s.maxHp < max, 'still the ember');
  assert.equal(e.hp, e.s.maxHp, 'no tick took one of its hits');
  h.run(1);
  assert.ok(e.alive);
  assert.equal(e.s.maxHp, max, `stood up ${HUSK_REBIRTH} + ${delay} s after the knock-out`);
  assert.equal(e.hp, max);
  assert.equal(e.findBuff('terrain:infection'), null);
  checkInvariants(h.b);
});

test('盟约寒风: every interval all enemies turn cold; a gust on cold enemies freezes them; kjeragColdWind uses live layers', REAL, () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11, 8] }], autoFinish: false, timeLimit: 60 });
  h.step();
  const wind = startColdWind(h.b, { interval: 5, duration: 6 });
  assert.ok(wind);
  h.run(4.9);
  assert.ok(h.enemies().every((e) => !e.s.flags.cold));
  h.run(0.2);
  assert.ok(h.enemies().every((e) => e.s.flags.cold), 'cold');
  h.run(5);
  assert.ok(h.enemies().every((e) => e.s.flags.freeze), 'second gust freezes');
  assert.ok(h.eventsOf('fx').filter((e) => e[1] === 'coldWind').length >= 2);
  wind.cancel();
  // bond helper: duration = base_time + time_per_stack × layers
  const bb = ds.raw.effects?.bondeffect_kjerag?.buffs?.[0]?.bb ?? { 'bond_eff_kjerag[storm].interval': 25, 'bond_eff_kjerag[storm].base_time': 20, 'bond_eff_kjerag[storm].time_per_stack': 0.1 };
  const h2 = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, bonds: { kjeragShip: { count: 6, active: true, tier: 2, layers: 40 } }, enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 60 });
  h2.step();
  kjeragColdWind(h2.b, 'p1', bb);
  h2.run(bb['bond_eff_kjerag[storm].interval'] + 0.05);
  const c = h2.enemy('enemy_dummy').findBuff('cold');
  assert.ok(c);
  approx(c.duration, bb['bond_eff_kjerag[storm].base_time'] + 40 * bb['bond_eff_kjerag[storm].time_per_stack'], 1e-9);
});

test('“双眼皮” turret (机械援助 / device override): arts shots at 900 ATK on its range, ASPD + layers, fragile per layer', REAL, () => {
  const stage = ds.getStage('act2autochess_m01');
  const d = stage.devices.find((x) => x.raw?.alias === 'trap_1104_aclasert#1');
  const bb = d.raw.skill.bb;
  const L = 100;
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: { preciShip: { count: 3, active: true, tier: 1, layers: L } },
    playerEffects: [{ id: 'aceffect_band_43', key: 'auto_chess_change_map', params: { 'trap_1104_aclasert#1': 1 } }] }];
  const h = makeBattle({ stageId: 'act2autochess_m01', defs: { enemies: { enemy_dummy: dummy() } }, players, enemies: [{ key: 'enemy_dummy', pos: [10, 9] }], autoFinish: false, timeLimit: 30 });
  h.step();
  const t = h.b.allyUnits.find((u) => u.kind === 'device' && u.defId === 'trap_1104_aclasert');
  assert.ok(t && t.alive, 'turret online');
  assert.equal(t.ownerId, 'p1');
  assert.equal(t.s.blockCnt, 0);
  const e = h.enemy('enemy_dummy');
  h.run(3);
  assert.ok(t.stats.attacks >= 1);
  approx(t.s.aspd, 100 + Math.min(L * bb.attack_speed_per_stack, bb.max_attack_speed), 1e-9);
  const frag = e.findBuff('fragile');
  assert.ok(frag, 'fragile applied');
  approx(e.s.dmgTakenMul, Math.min(1 + L * bb.damage_scale_per_stack, bb.max_damage_scale), 1e-9);
  assert.ok(1e7 - e.hp >= d.raw.stats.atk, 'hit for ≥ ATK');
  assert.deepEqual(activateTurrets(h.b).filter((u) => u !== t), [], 'idempotent');
  // no override: no turret
  const h2 = makeBattle({ stageId: 'act2autochess_m01', autoFinish: false, timeLimit: 5 });
  h2.step();
  assert.ok(!h2.b.allyUnits.some((u) => u.defId === 'trap_1104_aclasert'));
  checkInvariants(h.b);
});

// =================================================================================================================
// verification pass: owner variants, elite numbers, prior-verifier fixes, engine-change interplay

test('every token variant: a spawn with that owner takes the owner-level stats (elite owners → `_b` variant)', REAL, () => {
  const raw = ds.raw.tokens;
  let n = 0, expected = 0;
  for (const [id, rec] of Object.entries(raw)) {
    for (const [ownerId, v] of Object.entries(rec.variants || {})) {
      if (!ds.raw.chess[ownerId]) continue;
      expected++;
      const base = ownerId.replace(/_[ab]$/, '_a');
      const h = makeBattle({ kits: { [base]: genericNoSkill }, units: [{ chessId: ownerId, row: 12, col: 2 }], autoFinish: false, timeLimit: 10 });
      h.step();
      const o = h.unit(ownerId);
      const t = h.b.spawnToken(o, id, 9, 8);
      assert.ok(t, `${id} for ${ownerId}`);
      assert.equal(t.base.atk, v.stats.atk, `${id}/${ownerId} ATK`);
      assert.equal(t.base.def, v.stats.def, `${id}/${ownerId} DEF`);
      assert.equal(t.base.respawnTime, v.stats.respawnTime, `${id}/${ownerId} respawn`);
      assert.equal(t.s.maxHp, v.stats.maxHp, `${id}/${ownerId} HP`);
      if (v.skill?.bb && Object.keys(v.skill.bb).length && t.skill?.bb) assert.deepEqual({ ...t.skill.bb }, { ...v.skill.bb }, `${id}/${ownerId} skill bb`);
      h.run(1);
      assert.deepEqual(h.b.errors.filter((e) => /tokens\.js|devices\.js/.test(String(e.stack))), [], `${id}/${ownerId} errors`);
      n++;
    }
  }
  // 19 chess summons × (normal, 精锐) owner variants = 38 (炎佑 / map characters have no owner variants)
  assert.equal(n, expected);
  assert.ok(n >= 38, `variants checked: ${n}`);
});

test('elite numbers: 沙之碑 230 %/1.5 s, 香槟炸弹 170 %, 纸偶 its ATK × 2.7, “耀阳” 100 % + ×1.15 vs blocked, 医疗探机 ATK 114', REAL, () => {
  const burstOf = (ownerId, tokenId, r, c, ePos) => {
    const base = ownerId.replace(/_[ab]$/, '_a');
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, kits: { [base]: genericNoSkill }, units: [{ chessId: ownerId, row: 12, col: 2 }], enemies: [{ key: 'enemy_dummy', pos: ePos }], autoFinish: false, timeLimit: 10 });
    h.step();
    const o = h.unit(ownerId);
    const t = h.b.spawnToken(o, tokenId, r, c);
    assert.ok(t);
    return { h, o, t, e: h.enemy('enemy_dummy') };
  };
  {
    const { o, t, e } = burstOf('chess_char_4_05_b', TOKEN_IDS.obelisk, 10, 6, [10, 7]);
    approx(1e7 - e.hp, o.s.atk * 2.3, 1e-9, '沙之碑 elite');
    approx(e.findBuff('stun').timeLeft, 1.5, 1e-9);
    assert.equal(t.base.def, 546);
  }
  {
    const { h, o, e } = burstOf('chess_char_3_04_b', TOKEN_IDS.champagne, 10, 7, [10, 7]);
    h.step(2);
    approx(1e7 - e.hp, o.s.atk * 1.7, 1e-9, '香槟炸弹 elite (fresh bomb: 1 hit, DEF 0)');
  }
  {
    const { t, e } = burstOf('chess_char_2_11_b', TOKEN_IDS.paperDoll, 10, 6, [11, 7]);
    assert.equal(t.base.atk, 728);
    approx(1e7 - e.hp, 728 * 2.7, 1e-9, '纸偶 elite');
  }
  {
    const { o, e } = burstOf('chess_char_6_17_b', TOKEN_IDS.radiantSword, 10, 6, [10, 7]);
    // last deployed operator = 耀骑士临光 herself (卡西米尔) ⇒ 2 hits
    approx(1e7 - e.hp, 2 * o.s.atk * 1.0, 1e-9, '耀阳 elite burst');
  }
  // trait (精锐 owner module, isToken): a blocked enemy takes ATK × 1.15; the normal owner's sword hits for ATK
  // (the sword's range is its own tile: a walker entering it is blocked and bitten)
  for (const [ownerId, mul] of [['chess_char_6_17_b', 1.15], ['chess_char_6_17_a', 1]]) {
    const hits = [];
    const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ def: 0, atk: 0 }) } }, kits: { chess_char_6_17_a: genericNoSkill }, units: [{ chessId: ownerId, row: 12, col: 2 }], enemies: [{ key: 'enemy_walker', route: 0, time: 4 }], autoFinish: false, timeLimit: 30 });
    h.step();
    const t = h.b.spawnToken(h.unit(ownerId), TOKEN_IDS.radiantSword, 9, 6);
    h.b.on('damaged', (c) => { if (c.source === t && c.dmg?.isAttack) hits.push({ amount: c.amount, blocked: c.target.blockedBy === t }); });
    assert.ok(h.runUntil(() => hits.length > 0, 20), `${ownerId}: the sword bites a blocked walker`);
    assert.ok(hits[0].blocked);
    approx(hits[0].amount, t.s.atk * mul, 1e-9, `${ownerId} trait ×atk_scale vs blocked`);
    checkInvariants(h.b);
  }
  {
    const h = makeBattle({ kits: { chess_char_2_02_a: genericNoSkill }, units: [{ chessId: 'chess_char_2_02_b', row: 12, col: 2 }], autoFinish: false, timeLimit: 10 });
    h.step();
    const d = h.b.spawnToken(h.unit('chess_char_2_02_b'), TOKEN_IDS.healDrone, 10, 4);
    assert.equal(d.s.atk, 114);
  }
});

test('海嗣 elite: skill bb 55 %/80 %, lifetime 30 s, respawn 25 s', REAL, () => {
  const kit = () => ({ generic: true, talents: [], skill: { kind: 'duration', duration: 40, trigger: 'SP_FULL', spCost: 1, initSp: 1 } });
  const h = makeBattle({ defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy() } }, kits: { chess_char_6_04_a: kit }, units: [{ chessId: 'chess_char_6_04_b', row: 12, col: 3 }, { chessId: 'test_guard', row: 10, col: 8 }], enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], autoFinish: false, timeLimit: 120 });
  h.step(2);
  const sk = h.unit('chess_char_6_04_b');
  const sea = spawnOn(h, sk, TOKEN_IDS.seaborn, 10, 7);
  const e = h.enemy('enemy_dummy');
  h.run(1.02);
  approx(1e7 - e.hp, sk.s.atk * 0.55, 1e-9);
  approx(h.unit('test_guard').s.atk, sk.s.atk * 0.8, 1e-9);
  h.runUntil(() => !sea.alive, 32);
  approx(sea.deathAt - sea.deployedAt, 30, 0.01);
  const died = h.b.time;
  h.b.getPlayer('p1').dp = 99;
  assert.ok(h.runUntil(() => sea.alive, 40));
  approx(h.b.time - died, 25, 0.3);
  checkInvariants(h.b);
});

test('狼群 S3 bb: while 伺夜\'s timed skill runs, each bite on an enemy the pack blocks adds 伺夜 ATK × 20 % (30 % elite) arts', REAL, () => {
  for (const [ownerId, scale] of [['chess_char_3_19_a', 0.2], ['chess_char_3_19_b', 0.3]]) {
    const kit = () => ({ generic: true, talents: [], skill: { kind: 'duration', duration: 60, trigger: 'SP_FULL', spCost: 1, initSp: 1 } });
    const extra = [];
    const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ atk: 0, res: 0 }) } }, kits: { chess_char_3_19_a: kit }, units: [{ chessId: ownerId, row: 10, col: 3 }], enemies: [{ key: 'enemy_walker', route: 0 }], autoFinish: false, timeLimit: 60,
      setup: (b) => b.on('damaged', (c) => { if (c.dmg?.tags?.includes('vigil')) extra.push(c.amount); }) });
    h.step(2);
    const vigil = h.unit(ownerId);
    const wolf = vigil.trait.reinforcement;
    assert.ok(wolf && wolf.defId === TOKEN_IDS.wolfPack && vigil.skill.active);
    const e = h.enemy('enemy_walker');
    assert.ok(h.runUntil(() => e.blockedBy === wolf && extra.length >= 2, 30), 'bonus hits');
    approx(extra[0], vigil.s.atk * scale, 1e-9, `${ownerId} S3 bonus`);
    checkInvariants(h.b);
  }
});

test('流形 fixes: elite first-deploy +5 SP only once (not after respawn); module ×0.85 from its blocked enemies even when managed', REAL, () => {
  const g = guard({ stats: { atk: 600, def: 300, maxHp: 5000, blockCnt: 2, bat: 1 } });
  const h = makeBattle({ defs: { chess: { test_guard: g }, enemies: { enemy_dummy: dummy({ atk: 1000 }) } }, kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_b', row: 12, col: 3, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 10, col: 6, uid: 3, ownerUid: 1 }], autoFinish: false, timeLimit: 120 });
  h.step();
  const m = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold);
  assert.ok(m.mem.firstSpDone, 'first deploy bonus');
  assert.ok(m.skill.active || m.skill.sp >= m.skill.spCost - 1e-9, `95 + 5 SP ⇒ ready (${m.skill.sp})`);
  h.b.dealDamage(null, m, { amount: 1e7, type: 'true' });
  assert.equal(m.alive, false);
  const respawn = tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_b').talents.find((t) => t.bb.scale != null).bb.interval;
  assert.ok(h.runUntil(() => m.alive, respawn + 2), 'respawned after the talent interval');
  // initSp again (+ at most the SP of the redeploy tick) — never initSp + 5
  assert.ok(m.skill.sp <= tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_b').skill.initSp + 2 * m.s.spRecovery / 30 + 1e-9, `no second bonus (${m.skill.sp})`);
  checkInvariants(h.b);
  // module guard, owner with a hand kit (managed token)
  const h2 = makeBattle({ defs: { enemies: { enemy_walker: walker({ atk: 1000, def: 0 }) } }, kits: { chess_char_6_11_a: bare },
    units: [{ chessId: 'chess_char_6_11_b', row: 12, col: 2, uid: 1 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 9, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_walker', route: 0 }], autoFinish: false, timeLimit: 60 });
  h2.step();
  const m2 = h2.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold);
  m2.base.blockCnt = 1; m2.markDirty();
  const hits = [];
  h2.b.on('damaged', (c) => { if (c.target === m2 && c.source?.side === 'enemy') hits.push(c.amount); });
  assert.ok(h2.runUntil(() => hits.length > 0, 30), 'blocked enemy hits the copy');
  approx(hits[0], Math.max(1000 - m2.s.def, 50) * 0.85, 1e-9, 'module 梳妆流形 ×0.85');
});

test('deploy limit: a withdrawn board piece (limit 1) never respawns — no two pieces taking turns', REAL, () => {
  const h = makeBattle({ kits: { chess_char_3_19_a: genericNoSkill }, units: [{ chessId: 'chess_char_3_19_a', row: 10, col: 3, uid: 1 }], autoFinish: false, timeLimit: 60, hooks: ['death'] });
  h.step();
  const vigil = h.unit('chess_char_3_19_a');
  const a = vigil.trait.reinforcement;
  assert.ok(a && a.alive);
  const b = h.b.spawnToken(vigil, TOKEN_IDS.wolfPack, 12, 6);
  assert.ok(b && b.alive);
  assert.equal(a.alive, false, 'oldest withdrawn');
  h.run(a.base.respawnTime + 5);
  assert.equal(a.alive, false, 'no respawn of the replaced pack');
  assert.equal(b.alive, true);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.wolfPack && u.alive).length, 1);
  checkInvariants(h.b);
});

test('炎佑 details: plain spawnToken works (enemy-shaped record), burn gauge = ATK × 20 % per hit, burst 7000 元素伤害, flame skips stealthed enemies', REAL, () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }], autoFinish: false, timeLimit: 60, hooks: ['elementBurst', 'damaged'], captureNoisy: true });
  h.step();
  const y = h.b.spawnToken('p1', TOKEN_IDS.yanyou, 10, 7, { stats: { atk: 1000 } });
  assert.ok(y && y.kit?.fromTokens && y.skill?.kind === 'duration');
  assert.equal(y.motion, 'FLY');
  const e = h.enemy('enemy_dummy');
  assert.ok(h.runUntil(() => y.stats.attacks >= 1 && e.elem.burn > 0, 5));
  // 元素脆弱 raises 元素伤害 only ("受到的元素伤害提升"), never the gauge fill (damage.js)
  approx(e.elem.burn, 1000 * 0.2, 1e-6, 'gauge per hit');
  assert.ok(h.runUntil(() => h.hooksOf('elementBurst').length > 0, 20), 'burn burst');
  const burst = h.hooksOf('damaged').find((c) => c.type === 'elemental' && c.target === e);
  assert.ok(burst, 'elemental burst damage');
  approx(burst.amount, 7000 * 1.2, 1e-6, 'burst 7000 × 元素脆弱');
  checkInvariants(h.b);
  // a stealthed enemy is never the flame's target
  const h2 = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [], enemies: [{ key: 'enemy_dummy', pos: [10, 8] }], autoFinish: false, timeLimit: 60 });
  h2.step();
  const e2 = h2.enemy('enemy_dummy');
  h2.b.addBuff(e2, { key: 'test:stealth', flags: { stealth: true } });
  const [y2] = spawnYanyou(h2.b, 'p1', { atk: 1000, hp: 5000 });
  h2.run(20);
  assert.equal(e2.hp, 1e7, 'untouched');
  assert.equal(y2.skill.activations, 0, 'no flame without a target');
  assert.deepEqual(h2.b.errors, []);
});

test('预备干员-医疗: stat talent 攻击提升 (+4 % ATK) on top of the data stats', REAL, () => {
  const h = makeBattle({ stageId: 'act2autochess_m01', units: [], autoFinish: false, timeLimit: 10 });
  h.step();
  const med = spawnMapChar(h.b, 'p1', TOKEN_IDS.reserveMedic);
  approx(med.s.atk, tokDef(TOKEN_IDS.reserveMedic).stats.atk * 1.04, 1e-9);
  med.skill.activate('test', { free: true });
  approx(med.s.atk, tokDef(TOKEN_IDS.reserveMedic).stats.atk * (1.04 + 0.5), 1e-9, '治疗强化·β型 +50 %');
});

test('Touch talents: 攫升 +3 SP to the healed unit, 超脱 +5 SP when an operator in range is knocked out; extra heal = 30 % of the main heal\'s base, ×heal_scale on its own low recipient', REAL, () => {
  const g = chessRec({ id: 'test_sp', stats: { maxHp: 10000, atk: 0, spRecovery: 0 }, skill: { spCost: 100, initSp: 0 } });
  const h = makeBattle({ stageId: 'act2autochess_m01', defs: { chess: { test_sp: g } }, units: [{ chessId: 'test_sp', row: 10, col: 3, uid: 1 }, { chessId: 'test_sp', row: 11, col: 3, uid: 2 }], autoFinish: false, timeLimit: 60,
    setup: (b) => b.on('heal', (c) => { if (c.source?.defId === TOKEN_IDS.touch) (b.mem ??= []).push({ t: c.target.id, amount: c.amount, ratio: c.target.hpRatio }); }, { priority: -500 }) });
  h.step();
  const touch = spawnMapChar(h.b, 'p1', TOKEN_IDS.touch);
  const a = h.unit(1), b2 = h.unit(2);
  a.hp = 9000;
  assert.ok(h.runUntil(() => (h.b.mem ?? []).length > 0, 5));
  approx(a.skill.sp, 3, 1e-9, '攫升');
  // 超脱
  const sp0 = touch.skill.sp;
  h.b.dealDamage(null, b2, { amount: 1e6, type: 'true' });
  assert.equal(b2.alive, false);
  approx(touch.skill.sp - sp0, 5, 0.1, '超脱');
  // skill: main heal (×1.5 below 50 %) + an extra heal of 30 % of its base (ATK) on the lowest-ratio unit of the target and
  // its neighbours — the target again, still below half after the main heal: ×1.5 on its own (PRTS 技能3 备注)
  h.b.mem = [];
  touch.skill.activate('test', { free: true });
  a.hp = 2000;
  assert.ok(h.runUntil(() => h.b.mem.length >= 2, 5));
  const [main, extra] = h.b.mem;
  assert.deepEqual([main.t, extra.t], [a.id, a.id]);
  approx(main.amount, touch.s.atk * 1.5, 1e-6, 'main heal boosted');
  assert.ok(extra.ratio < 0.5);
  approx(extra.amount, touch.s.atk * 0.3 * 1.5, 1e-6, 'extra = 30 % of the base, boosted on its low recipient');
  checkInvariants(h.b);
});

test('user: Given a wounded ally only in Touch skill range, When the skill is ready, Then Touch casts and heals it', REAL, () => {
  const h = makeBattle({ stageId: 'act2autochess_m01',
    defs: { chess: { test_guard: guard() } },
    units: [{ chessId: 'test_guard', row: 10, col: 7 }], autoFinish: false, timeLimit: 60 });
  h.step();
  const touch = spawnMapChar(h.b, 'p1', TOKEN_IDS.touch);
  const ally = h.unit('test_guard');
  touch.skill.gainSp(100);
  h.run(4);
  assert.equal(touch.skill.activations, 0, 'full-health allies do not trigger the skill');
  ally.hp = 1000;
  const noHeal = h.b.addBuff(ally, { key: 'test:no-heal', flags: { noHeal: true } });
  h.run(1);
  assert.equal(touch.skill.activations, 0, 'an unhealable ally does not trigger the skill');
  h.b.removeBuff(ally, noHeal);
  assert.ok(h.runUntil(() => ally.hp > 1000, 5), 'Touch heals the ally five tiles ahead');
  assert.equal(touch.skill.activations, 1);
  checkInvariants(h.b);
});

test('spawnMapChar: per-player slots — unite: p1 #1 (10,2), p2 its multi-only slot (10,10); boss: L (3,2), R (3,18); solo never multi-only', REAL, () => {
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {} },
    { playerId: 'p2', seat: 1, side: 'R', colOffset: 8, units: [], bonds: {} },
  ];
  const u = makeBattle({ kind: 'unite', stageId: 'act2autochess_m01', players, autoFinish: false, timeLimit: 10 });
  u.step();
  const m2 = spawnMapChar(u.b, 'p2', TOKEN_IDS.touch);
  const m1 = spawnMapChar(u.b, 'p1', TOKEN_IDS.touch);
  assert.deepEqual([m1.tileR, m1.tileC], [10, 2]);
  assert.deepEqual([m2.tileR, m2.tileC], [10, 10]);
  const bossPlayers = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {} },
    { playerId: 'p2', seat: 1, side: 'R', colOffset: 0, units: [], bonds: {} },
  ];
  const bo = makeBattle({ kind: 'boss', stageId: 'act2autochess_m01', players: bossPlayers, autoFinish: false, timeLimit: 10 });
  bo.step();
  const b1 = spawnMapChar(bo.b, 'p1', TOKEN_IDS.reserveMedic), b2 = spawnMapChar(bo.b, 'p2', TOKEN_IDS.reserveMedic);
  assert.deepEqual([b1.tileR, b1.tileC], [3, 2]);
  assert.deepEqual([b2.tileR, b2.tileC], [3, 18]);
  assert.equal(b2.facing, -1);
  const solo = makeBattle({ stageId: 'act2autochess_m01', units: [], autoFinish: false, timeLimit: 10 });
  solo.step();
  assert.ok(spawnMapChar(solo.b, 'p1', TOKEN_IDS.touch));
  assert.equal(spawnMapChar(solo.b, 'p1', TOKEN_IDS.reserveMedic), null, 'the only non-multi slot is taken');
});

test('summon tiles never take the home tile of a piece that waits to redeploy (battle.isReservedTile)', REAL, () => {
  const g = guard({ stats: { maxHp: 100, atk: 0, respawnTime: 60 } });
  const h = makeBattle({ defs: { chess: { test_guard: g, test_owner: summoner({ rangeGrid: [[0, 1]] }) } }, units: [{ chessId: 'test_owner', row: 10, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 4, uid: 2 }], autoFinish: false, timeLimit: 60 });
  h.step();
  const gu = h.unit(2);
  h.b.dealDamage(null, gu, { amount: 1e6, type: 'true' });
  assert.equal(gu.alive, false);
  assert.equal(tileFree(h.b, 10, 4), false);
  assert.equal(findSummonTile(h.b, h.unit(1), 'ally'), null, 'the only range tile is reserved');
  assert.equal(summonToken(h.b, h.unit(1), TOKEN_IDS.healDrone, 'ally'), null);
  checkInvariants(h.b);
});

test('“双眼皮” per player: a partner\'s 机械援助 only switches on the partner\'s turret (its layers); first hit = 900 arts; a stronger fragile is kept', REAL, () => {
  const band = [{ id: 'aceffect_band_43', key: 'auto_chess_change_map', params: { 'trap_1104_aclasert#1': 1, 'trap_1104_aclasert#2': 1 } }];
  const players = [
    { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: { preciShip: { count: 3, active: true, tier: 1, layers: 300 } } },
    { playerId: 'p2', seat: 1, side: 'R', colOffset: 8, units: [], bonds: { preciShip: { count: 3, active: true, tier: 1, layers: 50 } }, playerEffects: band },
  ];
  const first = [];
  const h = makeBattle({ kind: 'unite', stageId: 'act2autochess_m01', defs: { enemies: { enemy_dummy: dummy() } }, players, enemies: [{ key: 'enemy_dummy', pos: [10, 17] }], autoFinish: false, timeLimit: 30,
    setup: (b) => b.on('damaged', (c) => { if (c.source?.kind === 'device') first.push(c.amount); }) });
  h.step();
  const turrets = h.b.allyUnits.filter((u) => u.defId === 'trap_1104_aclasert' && u.alive);
  assert.equal(turrets.length, 1, 'only p2\'s turret');
  assert.equal(turrets[0].ownerId, 'p2');
  assert.ok(turrets[0].tileC >= 11);
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'fragile', { duration: 60, value: 0.5 });
  assert.ok(h.runUntil(() => first.length >= 2, 15));
  approx(first[0], 900 * 1.5, 1e-9, 'first hit (arts, RES 0) × the stronger fragile');
  approx(e.s.dmgTakenMul, 1.5, 1e-9, 'turret fragile (1 + 50 × 0.001) never replaces the stronger one');
  approx(turrets[0].s.aspd, 100 + 50, 1e-9, 'p2 layers');
  checkInvariants(h.b);
});

// =================================================================================================================
// verification wave 2 (regressions for the fixes of this pass)

test('tactical point: without a board piece the 援军 (狼群) stands on an enemy ground path inside the tactician range', REAL, () => {
  const h = makeBattle({ kits: { chess_char_3_19_a: genericNoSkill }, units: [{ chessId: 'chess_char_3_19_a', row: 10, col: 3 }], autoFinish: false, timeLimit: 10 });
  h.step();
  const vigil = h.unit('chess_char_3_19_a');
  const w = vigil.trait.reinforcement;
  assert.ok(w && w.alive && w.defId === TOKEN_IDS.wolfPack);
  const onPath = new Set();
  for (const rt of h.b.routes.filter((x) => x.motion === 'WALK')) for (const [r, c] of h.b.grid.findPath(rt.start[0], rt.start[1], rt.end[0], rt.end[1]) || []) onPath.add(`${r},${c}`);
  assert.ok(onPath.has(`${w.tileR},${w.tileC}`), `on a path (${w.tileR},${w.tileC})`);
  assert.ok(vigil.baseRangeKeys.includes(w.tileR * 21 + w.tileC), 'inside the initial range');
  // official smoothed lanes (grid.js flow field): the upper gate's route (12,10) → (9,2) runs one straight diagonal
  // through (10,4), so the nearest path tile — same row first — is right beside 伺夜
  assert.deepEqual([w.tileR, w.tileC], [10, 4], 'the path tile nearest to 伺夜 (same row first)');
  checkInvariants(h.b);
});

test('狼群 (generic 伺夜): 伺夜\'s own attacks on pack-blocked enemies ignore 175 DEF and get the S3 bonus; the pack leaves with 伺夜', REAL, () => {
  const kit = () => ({ generic: true, talents: [], skill: { kind: 'duration', duration: 60, trigger: 'SP_FULL', spCost: 1, initSp: 1 } });
  const own = [], bonus = [];
  // RES 100: the 弱点伤害 garrison keeps the attacks physical (arts would do 5 %)
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ atk: 0, def: 300, res: 100, hp: 1e8 }) } }, kits: { chess_char_3_19_a: kit }, units: [{ chessId: 'chess_char_3_19_a', row: 10, col: 3 }], enemies: [{ key: 'enemy_walker', route: 0 }], autoFinish: false, timeLimit: 60,
    setup: (b) => b.on('damaged', (c) => {
      if (c.source?.defId === 'chess_char_3_19_a' && c.dmg?.isAttack) own.push({ amount: c.amount, type: c.type, blocked: c.target.blockedBy?.defId === TOKEN_IDS.wolfPack });
      if (c.dmg?.tags?.includes('vigil')) bonus.push({ src: c.source?.defId, amount: c.amount });
    }) });
  h.step(2);
  const vigil = h.unit('chess_char_3_19_a');
  const wolf = vigil.trait.reinforcement;
  assert.ok(vigil.skill.active);
  assert.ok(h.runUntil(() => own.some((x) => x.blocked) && bonus.some((x) => x.src === 'chess_char_3_19_a'), 30), 'owner hits a pack-blocked enemy');
  const hit = own.find((x) => x.blocked);
  assert.equal(hit.type, 'phys');
  // tactician trait ×1.5 vs enemies its 援军 blocks; DEF 300 − 175
  approx(hit.amount, vigil.s.atk * 1.5 - (300 - 175), 1e-6, 'DEF ignore on 伺夜\'s attack');
  approx(bonus.find((x) => x.src === 'chess_char_3_19_a').amount, vigil.s.atk * 0.2 * 0.05, 1e-6, 'S3 bonus: 20 % ATK arts vs RES 100 (5 % floor)');
  assert.ok(bonus.some((x) => x.src === TOKEN_IDS.wolfPack), 'the pack\'s bites carry the bonus too');
  // the 援军 leaves with its tactician (no respawn afterwards)
  h.b.dealDamage(null, vigil, { amount: 1e7, type: 'true' });
  assert.equal(vigil.alive, false);
  assert.equal(wolf.alive, false, 'pack withdrawn');
  h.run(wolf.base.respawnTime + 2);
  assert.equal(wolf.alive, false, 'no respawn of a withdrawn pack');
  checkInvariants(h.b);
});

test('狼群 (generic 伺夜): a killed pack waits while 伺夜 is down and comes back with him', REAL, () => {
  const h = makeBattle({ kits: { chess_char_3_19_a: genericNoSkill }, units: [{ chessId: 'chess_char_3_19_a', row: 10, col: 3 }], autoFinish: false, timeLimit: 120 });
  h.step();
  const vigil = h.unit('chess_char_3_19_a');
  const wolf = vigil.trait.reinforcement;
  h.b.dealDamage(null, wolf, { amount: 1e7, type: 'true' });
  h.b.dealDamage(null, wolf, { amount: 1e7, type: 'true' });
  assert.equal(wolf.alive, false, 'pack down');
  h.b.dealDamage(null, vigil, { amount: 1e7, type: 'true' });
  assert.equal(vigil.alive, false);
  h.run(wolf.base.respawnTime + 3);
  assert.equal(wolf.alive, false, 'no respawn without its tactician');
  assert.ok(h.b.redeploy(vigil, { free: true }), '伺夜 back');
  h.step();
  assert.ok(wolf.alive, 'the same pack returns with him');
  assert.equal(vigil.trait.reinforcement, wolf);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.wolfPack && u.alive).length, 1);
  checkInvariants(h.b);
});

test('沙之碑 (token kit): a blocking pillar — it never attacks the enemies it blocks', REAL, () => {
  const h = makeBattle({ defs: { chess: { test_owner: summoner() }, enemies: { enemy_walker: walker({ atk: 0 }) } }, units: [{ chessId: 'test_owner', row: 12, col: 3 }], enemies: [{ key: 'enemy_walker', route: 0, time: 3 }], autoFinish: false, timeLimit: 30 });
  h.step();
  const ob = h.b.spawnToken(h.unit('test_owner'), TOKEN_IDS.obelisk, 9, 6);
  assert.ok(h.runUntil(() => h.enemy('enemy_walker')?.blockedBy === ob, 15), 'blocked by the obelisk');
  const e = h.enemy('enemy_walker');
  h.run(3);
  assert.equal(ob.stats.attacks, 0);
  assert.equal(e.hp, e.s.maxHp);
  checkInvariants(h.b);
});

test('流形 melee copy: ATK/DEF stolen up to steal_*_max; the robbed enemy loses exactly what was taken', REAL, () => {
  const steal = tokDef(TOKEN_IDS.manifold, 'chess_char_6_11_a').talents.find((t) => t.bb.steal_atk != null).bb;
  const g = guard({ stats: { atk: 600, def: 300, maxHp: 5000, blockCnt: 2, bat: 0.2 }, rangeGrid: [[0, 0], [0, 1]] });
  const h = makeBattle({ defs: { chess: { test_guard: g }, enemies: { enemy_dummy: dummy({ atk: 800, def: 600 }) } }, kits: { chess_char_6_11_a: genericNoSkill },
    units: [{ chessId: 'chess_char_6_11_b', row: 12, col: 3, uid: 1 }, { chessId: 'test_guard', row: 10, col: 5, uid: 2 }, { kind: 'token', tokenId: TOKEN_IDS.manifold, row: 10, col: 6, uid: 3, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], autoFinish: false, timeLimit: 60 });
  h.step(2);
  const m = h.b.allyUnits.find((u) => u.defId === TOKEN_IDS.manifold);
  const e = h.enemy('enemy_dummy');
  assert.ok(m.mem.copy && !m.mem.copy.ranged);
  assert.ok(h.runUntil(() => m.mem.stolenAtk >= steal.steal_atk_max, 40), `stole ${m.mem.stolenAtk}`);
  h.run(2);
  assert.equal(m.mem.stolenAtk, steal.steal_atk_max);
  assert.equal(m.mem.stolenDef, steal.steal_def_max);
  approx(e.s.atk, 800 - steal.steal_atk_max, 1e-9);
  approx(e.s.def, 600 - steal.steal_def_max, 1e-9);
  approx(m.s.atk, 600 + steal.steal_atk_max, 1e-9);
  checkInvariants(h.b);
});

test('炎佑 祛恶之焰: every enemy within range_radius of the channelled target burns each second (no 3-target cap)', REAL, () => {
  const flame = new Map();
  // six enemies on one tile: all within range_radius of whichever is channelled
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [], enemies: [{ key: 'enemy_dummy', pos: [10, 6], count: 6 }], autoFinish: false, timeLimit: 60,
    setup: (b) => b.on('damaged', (c) => { if (c.dmg?.tags?.includes('flame')) flame.set(c.target.id, (flame.get(c.target.id) ?? 0) + 1); }) });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 1000, hp: 50000 });
  assert.ok(h.runUntil(() => y.skill.activations >= 1, 20), '祛恶之焰');
  h.run(1.1);
  const t = y.mem.flame?.target;
  assert.ok(t, 'channelling');
  const r = h.b.data.rawToken(TOKEN_IDS.yanyou).skills.find((s) => s.prefabKey === 'Skill_2').bb.range_radius;
  const near = h.enemies().filter((e) => Math.hypot(e.x - t.x, e.y - t.y) <= r + 1e-9);
  assert.equal(near.length, 6, `${near.length} enemies around the target`);
  for (const e of near) assert.ok(flame.get(e.id) >= 1, `enemy ${e.id} burnt`);
  checkInvariants(h.b);
});

test('device overrides are per half: in 联防 p1\'s 模拟战场演变 removes only p1\'s crates; a card on p2 only p2\'s', REAL, () => {
  // 模拟战场演变·模式一 (map_m01_1): every crate alias of the stage → 0
  const card = {};
  for (const d of ds.getStage('act1autochess_m01').devices) if (d.role === 'crate') card[d.raw.alias] = 0;
  const crates = (h) => h.b.allyUnits.filter((u) => u.kind === 'device' && u.defId === 'trap_1105_accrate' && u.alive);
  for (const [who, keptSide] of [['p1', 'R'], ['p2', 'L']]) {
    const players = [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {}, deviceOverrides: who === 'p1' ? card : {} },
      { playerId: 'p2', seat: 1, side: 'R', colOffset: 8, units: [], bonds: {}, deviceOverrides: who === 'p2' ? card : {} },
    ];
    const h = makeBattle({ kind: 'unite', stageId: 'act1autochess_m01', players, autoFinish: false, timeLimit: 10 });
    h.step();
    const left = crates(h).filter((u) => u.tileC <= 10), right = crates(h).filter((u) => u.tileC >= 11);
    assert.equal(keptSide === 'R' ? left.length : right.length, 0, `${who}'s half cleared`);
    assert.equal(keptSide === 'R' ? right.length : left.length, 3, `the partner's crates stay (${who} card)`);
    checkInvariants(h.b);
  }
});

test('“双眼皮” off-field position (act2 m01 row 8): the turret takes a void tile, never the red gate or the lane', REAL, () => {
  const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 10 } },
    playerEffects: [{ id: 'aceffect_band_43', key: 'auto_chess_change_map', params: { 'trap_1104_aclasert#1': 1 } }] }];
  const h = makeBattle({ stageId: 'act2autochess_m01', defs: { enemies: { enemy_dummy: dummy() } }, players, enemies: [{ key: 'enemy_dummy', pos: [12, 10] }], autoFinish: false, timeLimit: 20 });
  h.step();
  const t = h.b.allyUnits.find((u) => u.defId === 'trap_1104_aclasert');
  assert.ok(t && t.alive);
  assert.equal(h.b.grid.groundPassable(t.tileR, t.tileC, true), false, `void tile (${t.tileR},${t.tileC})`);
  assert.equal(h.b.grid.tile(t.tileR, t.tileC).build, 'NONE');
  h.run(5);
  assert.ok(h.enemy('enemy_dummy').hp < 1e7, 'still shoots its data range (the gate)');
  checkInvariants(h.b);
});
