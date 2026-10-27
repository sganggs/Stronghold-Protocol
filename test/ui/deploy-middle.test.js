import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { prepDeployCamera } from '../../public/js/ui/gameLogic/camera.js';
import { presetCamera, officialCamera, parseCameraParam, OFFICIAL_PARAMS } from '../../public/js/render/projection.js';
import { hudBands } from '../../public/js/ui/fieldHost.js';

const pub = { round: 2, bossRound: 14, players: [{ playerId: 'a', seat: 0 }] };

test('middle deploy setting preserves old booleans, defaults and serialized preferences', () => {
  for (const value of [false, true, 'partial']) assert.equal(sanitizeSettings(JSON.parse(JSON.stringify({ prepDeployFold: value }))).prepDeployFold, value);
  for (const value of [undefined, 'off', 'middle', 0, null]) assert.equal(sanitizeSettings({ prepDeployFold: value }).prepDeployFold, true);
});

test('partial camera changes live between all levels and restores while still dragging', () => {
  const own = { pub, myId: 'a', ownPrep: true, folded: false, busy: true };
  const middle = prepDeployCamera({ ...own, deployFold: true, partial: true });
  assert.equal(middle.opts.shop, 'partial');
  assert.equal(prepDeployCamera({ ...own, deployFold: true, partial: true, current: middle }), null);
  const full = prepDeployCamera({ ...own, deployFold: true, current: middle });
  assert.equal(full.opts.shop, false);
  assert.equal(prepDeployCamera({ ...own, releaseDeploy: true, current: middle }).opts.shop, true);
  assert.equal(prepDeployCamera({ ...own, releaseDeploy: true, folded: true, current: middle }).opts.shop, false);
  assert.equal(prepDeployCamera({ ...own, releaseDeploy: true, pen: true, current: middle }), null);
});

test('normal and both boss halves use halfway official offsets and an intermediate HUD band', (t) => {
  let rem = 100;
  const oldStyle = globalThis.getComputedStyle, oldDocument = globalThis.document;
  globalThis.getComputedStyle = () => ({ fontSize: `${rem}px` });
  globalThis.document = { documentElement: {}, querySelector: () => null, querySelectorAll: () => [] };
  t.after(() => { globalThis.getComputedStyle = oldStyle; globalThis.document = oldDocument; });
  for (const [kind, side, openKey, closedKey] of [
    ['prep', 'L', 'left_shop_camera_param', 'left_prepare_camera_param'],
    ['bossPrep', 'L', 'left_boss_shop_camera_param', 'left_boss_prepare_camera_param'],
    ['bossPrep', 'R', 'right_boss_shop_camera_param', 'right_boss_prepare_camera_param'],
  ]) {
    const size = { width: 1920, height: 1080 };
    rem = 100;
    const a = parseCameraParam(OFFICIAL_PARAMS[openKey]);
    const b = parseCameraParam(OFFICIAL_PARAMS[closedKey]);
    const expected = officialCamera(a.map((n, i) => (n + b[i]) / 2), size);
    assert.deepEqual(presetCamera(kind, size, { side, shop: 'partial' }).params(), expected.params());
    const open = hudBands(kind, size, { shop: true });
    const mid = hudBands(kind, size, { shop: 'partial' });
    const closed = hudBands(kind, size, { shop: false });
    assert.ok(closed.bottom < mid.bottom && mid.bottom < open.bottom);
    for (const dimensions of [{ width: 844, height: 390 }, size]) {
      rem = Math.max(40, Math.min(dimensions.width / 19.2, dimensions.height / 10.8, 240));
      const cams = [true, 'partial', false].map((shop) => presetCamera(kind, dimensions, { side, shop, hud: hudBands(kind, dimensions, { shop }) }));
      const pixels = cams.map((c) => c.project(side === 'R' ? 15 : 5, kind === 'prep' ? 10 : 3, 0).s);
      assert.ok(pixels[0] <= pixels[1] && pixels[1] <= pixels[2], `${kind} ${side}: ${pixels}`);
    }
  }
});
