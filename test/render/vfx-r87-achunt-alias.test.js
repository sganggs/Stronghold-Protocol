// test/render/vfx-r87-achunt-alias.test.js — round 87 on-screen check: the 隐秘 假想敌：铳's chain hit in the live client.
// The hidden gun (enemy_9017_achunt_2, boss_9) spawns with spine enemy_9017_achunt: it is drawn with the base form's art
// (the extracted index copies the base unit for it with `aliasOf`). The app's unitKey tries the spine first, so
// FxWiring.unitKeyOf resolves its view to enemy_9017_achunt, and the binding keyed enemy_9017_achunt_2 never found its
// owner: no enemy_achunt_chain_hit played on screen. The lane's test built the gun view with spine = defId.
// Synthetic index; the view info is the sim's spawn info for that unit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { ENEMY_FX_BINDINGS } from '../../public/js/render/vfx/skills.js';

const CHAIN = 'enemy_achunt_chain_hit';

function makeIndex() {
  const enemy = () => ({ kind: 'enemy', modes: [{ name: 'Default', attack: null, combat: null }], skills: {}, talents: {} });
  const base = enemy();
  return {
    units: {
      enemy_9017_achunt: base,
      // tools/local-extract/fx.py: a unit with no prefab of its own is a copy of its base with `aliasOf`
      enemy_9017_achunt_2: { ...base, aliasOf: 'enemy_9017_achunt' },
      enemy_9020_actrpc: enemy(),
      char_test: { kind: 'char', modes: [], skills: {}, startEffect: null, deadEffect: null },
    },
    skills: {},
    projectiles: {},
    skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {} },
    prefabs: { [CHAIN]: { file: `prefabs/${CHAIN}.json`, looping: false, spawn: 2 } },
  };
}

async function setup() {
  const index = makeIndex();
  const spawned = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn ?? 2 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      const h = { key, place, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, {
    speed: () => 10, record: () => null, view: (id) => views.get(id) || null,
    // as render/app.js: [自选 charId, spine, the chess' charId, defId]
    unitKey: (info) => [info.diy?.charId, info.spine, null, info.defId].filter(Boolean),
  });
  await w.ready();
  const view = (id, info, x, y = 3) => {
    const isEnemy = info.side === 'enemy';
    const v = { id, x, y, z: 0, visFacing: 1, isEnemy, alive: true, flags: 0, sp: 0, spMax: 10, info: { id, ...info } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, view, frame, spawned, handles };
}

const count = (spawned, key) => spawned.filter((k) => k === key).length;

describe('round 87: the hidden 假想敌：铳 drawn with its base form\'s art', () => {
  test('its chain hit plays on the operator on the link, although its view resolves to the base unit', async () => {
    const { w, view, frame, spawned, handles } = await setup();
    // the spawn info of the hidden gun (boss_9 field recording): defId enemy_9017_achunt_2, spine enemy_9017_achunt
    const gun = view(32, { kind: 'enemy', side: 'enemy', defId: 'enemy_9017_achunt_2', spine: 'enemy_9017_achunt' }, 6.9);
    const spring = view(29, { kind: 'enemy', side: 'enemy', defId: 'enemy_9020_actrpc', spine: 'enemy_9020_actrpc' }, 10.6);
    const op = view(43, { kind: 'token', side: 'ally', defId: 'char_test', spine: 'char_test' }, 7);
    frame();
    assert.equal(w.unitKeyOf(gun), 'enemy_9017_achunt', 'the live client keys the hidden gun by its art');
    assert.equal(w.simFx('link', gun.x, gun.y, { from: gun.id, to: spring.id, kind: 'faithLink', dur: 1 }), false, 'the beam stays procedural');
    assert.equal(w.simFx('achuntHit', op.x, op.y, { id: gun.id, target: op.id }), true);
    assert.equal(count(spawned, CHAIN), 1);
    const h = handles.find((x) => x.key === CHAIN);
    assert.equal(h.opts.owner, op);
    assert.equal(h.opts.loop, false);
  });

  test('the base gun still has no chain hit, and no binding was added for it', async () => {
    const { w, view, frame, spawned } = await setup();
    const base = view(2, { kind: 'enemy', side: 'enemy', defId: 'enemy_9017_achunt', spine: 'enemy_9017_achunt' }, 6);
    const op = view(4, { kind: 'op', side: 'ally', defId: 'char_test', spine: 'char_test' }, 7);
    frame();
    assert.equal(w.simFx('achuntHit', op.x, op.y, { id: base.id, target: op.id }), false);
    assert.equal(count(spawned, CHAIN), 0);
    assert.equal(ENEMY_FX_BINDINGS.enemy_9017_achunt, undefined);
  });

  test('the battle preload lists the chain hit for the hidden gun', async () => {
    const { w, view } = await setup();
    const gun = view(32, { kind: 'enemy', side: 'enemy', defId: 'enemy_9017_achunt_2', spine: 'enemy_9017_achunt' }, 6.9);
    const base = view(2, { kind: 'enemy', side: 'enemy', defId: 'enemy_9017_achunt', spine: 'enemy_9017_achunt' }, 6);
    assert.ok(w.skills.keys([gun]).includes(CHAIN));
    assert.equal(w.skills.keys([base]).includes(CHAIN), false);
  });
});
