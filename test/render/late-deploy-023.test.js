import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
let fake, UnitView;
before(async () => { fake = installFakePixi(); ({ UnitView } = await import('../../public/js/render/units.js')); });
after(() => fake.restore());
function rig(rate = 1) {
  let resolve;
  const entry = { skel: '/op.skel', atlas: '/op.atlas', textures: ['/op.png'], anims: { idle: 'Idle', deploy: 'Start', die: 'Die', attack: { loop: 'Attack' } }, animations: { Idle: 1, Start: 1, Die: 1, Attack: 1 } };
  const assets = { spineEntry: () => entry, hasBack: () => false, spine: { acquire: () => new Promise((r) => { resolve = r; }), release() {} } };
  const cam = presetCamera('prep', { width: 1280, height: 720 });
  const ctx = fakeViewCtx(fake.P, { assets, cam: () => cam }); ctx.animRate = () => rate;
  const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_op', x: 5, y: 12, maxHp: 1000, dir: 'RIGHT' }, { prep: true });
  return { v, advance: (dt) => v.update(dt, cam, dt), ready: async () => { await new Promise((r) => setImmediate(r)); resolve({ animations: [{ name: 'Idle' }, { name: 'Start' }, { name: 'Die' }, { name: 'Attack' }] }); await new Promise((r) => setImmediate(r)); } };
}
test('late model continues the current deployment at elapsed game time', async () => {
  const h = rig(2); h.v.onDeploy(); h.advance(0.1); await h.ready();
  assert.equal(h.v.actor.mode, 'deploy'); assert.ok(Math.abs(h.v.actor.deployElapsed() - 0.2) < 1e-6); h.v.destroy();
});
test('model arriving after Start duration does not replay the old entrance', async () => {
  const h = rig(); h.v.onDeploy(); h.advance(2); await h.ready();
  assert.equal(h.v.actor.mode, 'base'); assert.equal(h.v._pendingDeployElapsed, null); h.v.destroy();
});
test('an attack or death supersedes the pending entrance', async () => {
  for (const action of ['attack', 'die']) {
    const h = rig(); h.v.onDeploy();
    if (action === 'attack') h.v.onAttack(null, 1, 'none'); else h.v.die();
    await h.ready(); assert.notEqual(h.v.actor.mode, 'deploy'); assert.equal(h.v._pendingDeployElapsed, null); h.v.destroy();
  }
});
test('a destroyed view never consumes a late model as a fresh entrance', async () => {
  const h = rig(); h.v.onDeploy(); h.v.destroy(); await h.ready(); assert.equal(h.v.actor, null);
});
