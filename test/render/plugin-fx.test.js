import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSkill, planFor } from '../../public/js/render/vfx/skills.js';
import { activeTalentKeys, talentBindings } from '../../public/js/render/vfx/talents.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FxLibrary } from '../../public/js/render/vfx/library.js';
import { flipbookFrame } from '../../public/js/render/vfx/pluginFormat.js';
import { PluginFxPlayer } from '../../public/js/render/vfx/pluginPlayer.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';
import { UF } from '../../shared/constants.js';
import { readFxAssets } from '../../server/plugins/fxAssets.js';
import { listPluginFiles } from '../../server/plugins/registry.js';
import { fxFixture, compiled, book } from '../helpers/fxFixtures.js';

test('explicit official unit and skill mapping precedes art and records; absent mapping falls back', () => {
  const s = { uses: [], mode: 0 }, idx = { units: { char_112_siege: { kind: 'char', skills: { skchr_siege_3: s }, modes: [] }, char_102_texas: { skills: { old: s } } }, skills: {} };
  const info = { id: 1, diy: { charId: 'char_102_texas', skillIndex: 0 }, spine: 'char_102_texas' };
  const rec = { charId: 'char_x_demo_unit', skill: { skillId: 'custom', index: 0 }, fx: { unit: 'char_112_siege', skills: { 0: 'skchr_siege_3', custom: 'absent' } } };
  const r = resolveSkill(idx, { info, rec });
  assert.equal(r.unitKey, 'char_112_siege'); assert.equal(r.skillId, 'skchr_siege_3'); assert.equal(r.via, 'plugin');
  assert.equal(resolveSkill(idx, { info: { id: 2 }, rec }).skillId, 'skchr_siege_3', 'normal deployed operators use their default record slot');
  const w = new FxWiring({ active: true, lib: { index: async () => idx } }, { record: () => rec, unitKey: () => ['char_102_texas'] });
  w.idx = idx; assert.equal(w.unitKeyOf({ info }), 'char_112_siege');
  rec.fx.unit = 'char_missing'; rec.skill.skillId = 'old';
  assert.equal(resolveSkill(idx, { info, rec }).skillId, 'old');
  rec.fx = undefined;
  assert.equal(resolveSkill(idx, { info, rec }).unitKey, 'char_102_texas');
});

test('borrowing a unit includes equipped base talent visuals, without enabling its module talents', () => {
  const idx = { units: { char_112_siege: { talentKeys: { trait: ['trait'], base: { 0: ['base'] }, modules: { x: { 0: ['module'] } } } } } };
  assert.deepEqual([...activeTalentKeys(idx, 'char_112_siege', { rec: { fx: { unit: 'char_112_siege' }, talents: [{ index: 0 }] } })], ['trait', 'base']);
});

test('plugin library works without local official extraction and compiles namespaced plans', async t => {
  const f = fxFixture(t); compiled(f);
  const got = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root));
  const value = { ...got.value, images: { 'fx/sheet.png': { w: 8, h: 8, url: '/p/fx-demo/12345678/fx/sheet.png' } } };
  const lib = new FxLibrary({ assets: { manifest: { fx: { 'fx-demo': value } } }, list: { groups: {} }, fetch: async () => ({ ok: false }) });
  assert.equal(await lib.init(), true);
  const idx = await lib.index();
  assert.ok(lib.has('plugin:fx-demo:spark'));
  assert.equal((await lib.load('plugin:fx-demo:spark')).n, 1);
  const r = planFor(idx, { info: { skillIndex: 0 }, rec: { charId: 'char_x_fx_demo_guard', skill: { index: 0, skillId: 'skx_fx_demo_one' } } });
  assert.equal(r.skillId, 'plugin:fx-demo:skx_fx_demo_one');
  assert.equal(r.plan.start[0].key, 'plugin:fx-demo:spark');
});

test('flipbook exact timing, incomplete last row, loop and pause arithmetic', () => {
  const b = book();
  assert.equal(flipbookFrame(b, 0).frame, 0); assert.equal(flipbookFrame(b, 0.1).frame, 1);
  assert.equal(flipbookFrame(b, 0.3).frame, 3); assert.equal(flipbookFrame(b, 0.4), null);
  assert.equal(flipbookFrame({ ...b, loop: true }, 0.4).frame, 0);
  const last = flipbookFrame({ ...b, frames: 5 }, 0.4); assert.equal(last.row, 2); assert.equal(last.col, 0); assert.equal(last.rows, 3);
  assert.deepEqual(flipbookFrame(b, 0.2), flipbookFrame(b, 0.2));
});

test('a missing official index produces just one note and preserves a silent fallback', async t => {
  const note = t.mock.method(console, 'info', () => {});
  const lib = new FxLibrary({ list: { groups: {} }, fetch: async () => ({ ok: false }) });
  lib.notePluginUnit('char_1_absent'); lib.notePluginUnit('char_2_absent');
  await lib.index();
  assert.equal(note.mock.callCount(), 1);
  assert.equal(lib.available, false);
});

test('removing an effect set discards a texture that finishes decoding later', async () => {
  const lib = new FxLibrary({ list: { groups: {} }, fetch: async () => ({ ok: false }) });
  await lib.init();
  lib.groups = { 'fx/tex': { 'plugin:fx-demo:sheet': { path: '/old.png' } } };
  let resolve, started;
  const waiting = new Promise(r => { started = r; });
  lib._image = () => { started(); return new Promise(r => { resolve = r; }); };
  const pending = lib.loadTexture('plugin:fx-demo:sheet', false); await waiting;
  await lib.reloadPlugins(); let closed = false;
  resolve({ image: { close() { closed = true; } }, flipped: true });
  assert.equal(await pending, null); assert.equal(closed, true); assert.equal(lib.images.has('plugin:fx-demo:sheet|0'), false);
});

test('sprite path follows both cameras, skill loops stop, setting off clears and DSL/phase work', () => {
  class Texture { constructor(base) { this.baseTexture = base; } destroy() {} }
  class Sprite { constructor(texture) { this.texture = texture; this.anchor = { set() {} }; this.position = { set(x, y) { this.x = x; this.y = y; } }; } destroy() { this.destroyed = true; } }
  const P = { BaseTexture: { from: () => ({ valid: true }) }, Texture, Sprite, Rectangle: class { constructor(...values) { this.values = values; } }, BLEND_MODES: { ADD: 1, NORMAL: 0 } };
  const rec = { charId: 'char_x_fx_demo_guard', skill: { index: 0, skillId: 'custom' } }, v = { info: { id: 1, skillIndex: 0 }, x: 1, y: 2, alive: true };
  const b = book(), effects = { 'fx-demo': { config: { flipbooks: { flash: b }, bind: { char_x_fx_demo_guard: { 0: { skillLoop: 'flash', hit: 'flash', projectile: 'flash' } } }, silentPhases: ['quiet'] }, images: { [b.image]: { w: 8, h: 8, url: '/p/a/b/fx/sheet.png' } } } };
  let enabled = true, camera = 1;
  const player = new PluginFxPlayer({ P, layer: { addChild() {} }, assets: { manifest: { fx: effects } }, cam: () => ({ project: (x,y) => ({ x: x * camera, y, s: 40 }) }), enabled: () => enabled, record: () => rec, speed: () => 10, ofx: { active: false } });
  player.skill(v, true); assert.equal(player.live.size, 1);
  player.update(0.5); const loop = [...player.live][0]; assert.ok(loop && !loop.dead); assert.equal(loop.sprite.position.x, 1);
  camera = 2; player.update(0); assert.equal(loop.sprite.position.x, 2);
  player.skill(v, false); assert.equal(player.live.size, 0);
  const target = { info: { id: 2 }, x: 11, y: 2, alive: true };
  assert.equal(player.attack(v, target, 'arrow'), true);
  player.update(0.6); assert.equal(player.live.size, 1, 'a flight outlives one animation cycle');
  assert.equal(player.hit(null, target), false, 'source-less damage cannot be attributed to this shot');
  player.update(0.4); assert.equal(player.live.size, 1, 'arrival starts the hit');
  player.clear();
  v.flags = UF.SKILL; player.sync([v]); assert.equal(player.live.size, 1, 'snapshot resumes a loop without its start burst');
  v.flags = 0; player.sync([v]); assert.equal(player.live.size, 0);
  assert.equal(player.simFx('phase', 0, 0, { kind: 'quiet' }), true);
  assert.equal(player.simFx('phase', 0, 0, { kind: 'other' }), false);
  assert.equal(player.simFx('plugin', 1, 1, { skill: 'plugin:fx-demo:flash', dur: 0.2 }), true); assert.equal(player.live.size, 1);
  enabled = false; player.update(0); assert.equal(player.live.size, 0);
  player.skill(v, true); assert.equal(player.live.size, 0);
});

test('compiled author loops cannot bypass live or pending renderer budgets', () => {
  const ofx = new OfficialFx({ P: { Container: class {} }, lib: { available: true, has: () => true }, tier: 'lite' });
  ofx.pending = Array(128).fill({});
  assert.equal(ofx.spawn('plugin:fx-demo:spark', {}, { loop: true }), null);
  assert.equal(ofx.dropped, 1);
});

for (const requested of ['char_missing', 'char_112_siege_99']) test(`missing exact mapping ${requested} preserves the complete fallback plan`, async t => {
  const own = { uses: [{ keys: ['own'], role: 'start' }], mode: 0 }, mapped = { uses: [{ keys: ['foreign'], role: 'loop' }], mode: 0 };
  const idx = { units: { char_112_siege: { kind: 'char', skills: { mapped }, modes: [] }, char_102_texas: { kind: 'char', skills: { own }, modes: [] } }, skills: { mapped }, prefabs: {} };
  const info = { id: 1, spine: 'char_102_texas', skillIndex: 0 }, rec = { charId: 'char_x_demo_guard', skill: { skillId: 'own', index: 0 } };
  const borrowed = { ...rec, fx: { unit: requested, skills: { 0: 'mapped' } } };
  assert.deepEqual(resolveSkill(idx, { info, rec: borrowed }), resolveSkill(idx, { info, rec }));
  assert.deepEqual(planFor(idx, { info, rec: borrowed }), planFor(idx, { info, rec }));
  const lib = new FxLibrary({}); lib.index = async () => idx;
  const note = t.mock.method(console, 'info', () => {});
  lib.notePluginUnit(requested); lib.notePluginUnit(requested); await Promise.resolve();
  assert.equal(note.mock.callCount(), 1);
  const wiring = new FxWiring({ active: true, lib }, { record: () => borrowed, unitKey: () => [info.spine] });
  wiring.idx = idx;
  assert.equal(wiring.unitKeyOf({ info }), 'char_102_texas', 'normal attacks and talents also keep the fallback unit');
  // Suffix stripping is retained for ordinary art candidates, never explicit fx.unit.
  assert.equal(resolveSkill(idx, { info: { spine: 'char_112_siege_99' }, rec }).unitKey, 'char_112_siege');
});

test('borrowed talents select only equipped branches and explicitly active modules', () => {
  const node = { nodes: [{ node: 'root', when: 'passive' }], uses: [] };
  const idx = { units: { char_112_siege: { kind: 'char', talentKeys: { trait: ['trait'], base: { 0: ['first'], 1: ['second'] }, modules: { mod: { 0: ['module'] } } },
    talents: { trait: node, first: node, second: node, module: node } } } };
  const rec = { fx: { unit: 'char_112_siege' }, talents: [{ index: 1 }] };
  const keys = () => talentBindings(idx, 'char_112_siege', { rec }).map(b => b.key);
  assert.deepEqual(keys(), ['trait', 'second']);
  rec.talents = []; assert.deepEqual(keys(), ['trait']);
  rec.talents = [{ index: 0, fromModule: true }]; assert.deepEqual(keys(), ['trait']);
  rec.module = { id: 'mod', active: true }; assert.deepEqual(keys(), ['trait', 'module']);
});

function shotFixture(phases = { projectile: 'flash', hit: 'flash' }) {
  const bases = [];
  class Texture { constructor(base) { this.baseTexture = base; } destroy() { this.destroyed = true; } }
  class Sprite { constructor() { this.anchor = { set() {} }; this.position = { set() {} }; } destroy() { this.destroyed = true; } }
  const P = { BaseTexture: { from(url) { const base = { url, valid: true, destroys: 0, destroy() { this.destroys++; } }; bases.push(base); return base; } },
    Texture, Sprite, Rectangle: class {}, BLEND_MODES: { ADD: 1, NORMAL: 0 } };
  const b = book(), effects = { 'fx-demo': { config: { flipbooks: { flash: b }, bind: { char_x_fx_demo_guard: { 0: phases } } },
    images: { [b.image]: { w: 8, h: 8, url: '/p/fx-demo/12345678/fx/sheet.png' } } } };
  const assets = { manifest: { fx: effects } }, src = { info: { id: 1, skillIndex: 0 }, id: 1, x: 0, y: 0, alive: true };
  const tgt = { info: { id: 2 }, id: 2, x: 30, y: 0, alive: true }, other = { info: { id: 3 }, id: 3, x: 0, y: 0, alive: true };
  const player = new PluginFxPlayer({ P, layer: { addChild() {} }, assets, cam: () => ({ project: (x, y) => ({ x, y, s: 40 }) }),
    enabled: () => true, record: info => info?.id === 1 ? { charId: 'char_x_fx_demo_guard', skill: { index: 0 } } : null,
    speed: () => 10, ofx: { active: false } });
  return { player, src, tgt, other, assets, bases };
}

test('ranged plugin arrivals never claim source-less, husk or a paired attacker damage', () => {
  const { player, src, tgt, other } = shotFixture();
  assert.equal(player.attack(src, tgt, 'arrow'), true);
  let wiringHits = 0;
  const damage = source => player.hit(source, tgt) || (++wiringHits, false);
  for (const dt of [0, 1, 2]) {
    player.update(dt);
    assert.equal(damage(null), false, 'unattributed ranged or husk damage keeps its spark');
    assert.equal(damage(other), false, 'another attacker still reaches official wiring');
  }
  assert.equal(wiringHits, 6);
  assert.equal([...player.live].filter(e => !e.flight).length, 1, 'one hit at arrival');
  player.update(0.1); assert.equal(damage(null), false, 'no blanket arrival grace window');
  assert.equal(damage(src), true, 'an identified melee hit suppresses only the spark it drew');
  player.destroy();
});

for (const projectile of [true, false]) test(`owner death cancels pending hit with projectile=${projectile}`, () => {
  const { player, src, tgt } = shotFixture(projectile ? undefined : { hit: 'flash' });
  player.attack(src, tgt, 'arrow'); src.alive = false; player.update(0.1);
  assert.equal(player.hit(null, tgt), false);
  assert.equal(player.hit(src, tgt), false, 'a dead source cannot draw or claim damage');
  assert.equal(player.hitClaims.size, 0, 'no pending shot survives owner death');
  player.update(3); assert.equal(player.live.size, 0, 'cancelled arrival never draws a hit');
  player.destroy();
});

test('clearing the flipbook cache destroys each base texture once after its sprites', () => {
  const { player, src, assets, bases } = shotFixture();
  player.phase(src, 'hit'); player.phase(src, 'hit');
  const sprites = [...player.live]; assert.equal(bases.length, 1);
  assets.manifest.fx = structuredClone(assets.manifest.fx); player.refresh();
  assert.equal(bases[0].destroys, 1);
  assert.ok(sprites.every(e => e.sprite.destroyed && e.texture.destroyed));
  player.phase(src, 'hit'); assert.equal(bases.length, 2);
  player.destroy(); player.destroy();
  assert.deepEqual(bases.map(b => b.destroys), [1, 1]);
});

test('a rejected compiled hit leaves the damage spark and official wiring available', t => {
  const f = fxFixture(t); compiled(f);
  const got = readFxAssets(f.root, { index: 'fx/index.json', bind: { char_x_fx_demo_guard: { 0: { hit: 'spark' } } } }, ['fx-demo'], listPluginFiles(f.root));
  const { player, src, tgt, assets } = shotFixture();
  assets.manifest.fx = { 'fx-demo': got.value };
  player.ofx = { active: true, spawn: () => null };
  assert.equal(player.hit(src, tgt), false);
  assert.equal(player.live.size, 0);
  player.destroy();
});
