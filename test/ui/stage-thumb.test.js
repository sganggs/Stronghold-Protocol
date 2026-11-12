// 规程 briefing map: official picture, then one cached 3D render, then the cell crop.
// The camera maths is the match's prep camera (render/projection.js). The drawer is injected, so a
// thrown renderer stays on the cells and is not tried again. No Chrome here — the browser pass is
// test/ui/stage-thumb.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const {
  StageMap, stagePreviewChoice, stagePreviewFrame, stagePreviewCamera, stagePreviewSize,
  stageSceneListed, stagePreviewRenderer, stagePreviewProbeGl, stagePreviewGlCached, resetStagePreviewProbe,
  STAGE_PREVIEW_CROP,
} = await import('../../public/js/ui/stagePreview.js');
const { presetCamera } = await import('../../public/js/render/projection.js');
const { createStageThumbCache, loadStageThumb, resetStageThumbCache, renderStageThumb } = await import('../../public/js/ui/stageThumb.js');

// The local-client extraction (data/local-assets.json) is git-ignored: CI has none, so the installed-scene checks skip there.
const groups = existsSync(path.join(ROOT, 'data/local-assets.json')) ? JSON.parse(read('data/local-assets.json')).groups : null;
const LOCAL_SCENES = !!groups && Object.hasOwn(groups, 'scene/act3autochess_m01');
const sceneOf = (id) => ({ ui: {}, localGroups: groups, id });

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && !v.props?.children) return;
  yield* walk(v.props?.children);
}

test('choice order is picture, then a 3D render, then cells', () => {
  resetStagePreviewProbe();
  const id = 'act3autochess_m01';
  const listed = { ui: {}, localGroups: { [`scene/${id}`]: { scene: { path: '/s.json' }, bin: { path: '/s.bin' } } } };
  assert.equal(stagePreviewGlCached(false), null);
  assert.deepEqual(stagePreviewChoice(listed, id), { kind: 'cells', assumed: true });
  assert.deepEqual(
    stagePreviewChoice({ ui: { [`stagePreview/${id}`]: '/x.png' }, localGroups: listed.localGroups }, id, { webgl2: true }),
    { kind: 'picture', url: '/x.png', key: `stagePreview/${id}` },
  );
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: true }), { kind: 'render', stageId: id, key: `scene/${id}` });
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: false }), { kind: 'cells', assumed: true });
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: true, renderer: '2d' }), { kind: 'cells', assumed: true });
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: true, renderer: 'fallback' }), { kind: 'cells', assumed: true });
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: true, board: '2d' }), { kind: 'cells', assumed: true });
  assert.deepEqual(stagePreviewChoice(listed, id, { webgl2: true, render: 'fallback' }), { kind: 'cells', assumed: true });
  assert.deepEqual(
    stagePreviewChoice({ ui: {}, localGroups: { [`scene/${id}`]: { scene: { path: '/s.json' } } } }, id, { webgl2: true }),
    { kind: 'cells', assumed: true },
  );
  assert.equal(stagePreviewProbeGl(false), false);
  assert.equal(stagePreviewProbeGl(false), false);
  assert.equal(stagePreviewChoice(listed, id).kind, 'cells');
  assert.equal(stagePreviewRenderer({ renderer: '3d' }), '3d');
  assert.equal(stagePreviewRenderer({ board: '2d', render: 'engine' }), '2d');
  assert.equal(stagePreviewRenderer({ render: 'fallback', board: '3d' }), 'fallback');
});

test('the installed 规程 scenes choose the 3D render (local extraction)', { skip: !LOCAL_SCENES && 'no local 规程 scenes (data/local-assets.json is git-ignored)' }, () => {
  resetStagePreviewProbe();
  const id = 'act3autochess_m01';
  assert.equal(stageSceneListed(groups, id), true);
  assert.equal(stageSceneListed(groups, 'act3autochess_m05'), true);
  assert.equal(stageSceneListed(groups, 'act3autochess_m09'), true);
  assert.equal(stageSceneListed(groups, 'act3autochess_m10'), true);
  assert.equal(stageSceneListed(groups, 'act3autochess_escaped_single'), false);
  assert.equal(stageSceneListed(groups, 'act3autochess_m99'), false);
  assert.equal(stagePreviewChoice(sceneOf(id), id, { webgl2: true }).kind, 'render');
  assert.equal(stagePreviewChoice(sceneOf('act3autochess_m05'), 'act3autochess_m05', { webgl2: true }).kind, 'render');
  assert.equal(stagePreviewChoice(sceneOf('act3autochess_escaped_single'), 'act3autochess_escaped_single', { webgl2: true }).kind, 'cells');
  assert.equal(stagePreviewChoice(sceneOf('act3autochess_m99'), 'act3autochess_m99', { webgl2: true }).kind, 'cells');
  assert.equal(stagePreviewChoice({ ui: { [`stagePreview/${id}`]: '/x.png' }, localGroups: groups }, id, { webgl2: true }).kind, 'picture');
});

test('every seat frames the left prep crop, from the prep camera', () => {
  for (const seat of [0, 1, 2, 3, null, undefined]) {
    assert.deepEqual(stagePreviewFrame(seat), { ...STAGE_PREVIEW_CROP });
  }
  const moved = stagePreviewFrame(1);
  moved.c0 = 11;
  assert.equal(stagePreviewFrame(1).c0, 0);

  const view = { width: 1920, height: 1080 };
  const cam = stagePreviewCamera(view, { seat: 3 });
  const shop = presetCamera('prep', view, { rect: { ...STAGE_PREVIEW_CROP }, side: 'L', shop: true });
  const closed = presetCamera('prep', view, { rect: { ...STAGE_PREVIEW_CROP }, side: 'L', shop: false });
  assert.deepEqual(cam.params(), shop.params());
  assert.notDeepEqual(cam.params(), closed.params());
  assert.equal(cam.tilt, 30);
  const at = cam.position();
  assert.ok(at.z > 1, 'the prep camera sits above the board');
  assert.ok(at.y < cam.ty, 'the prep camera sits south of its target (row 0 is the near edge)');
  const mine = cam.project(5, 9.5, 0);
  const partner = cam.project(15.5, 9.5, 0);
  assert.ok(Math.abs(mine.x - view.width / 2) < Math.abs(partner.x - view.width / 2));
  assert.ok(cam.project(5, 7, 0).y > cam.project(5, 12, 0).y, 'the bench is below the far row on screen');

  const narrow = { width: 300, height: 400 };
  const fitted = stagePreviewCamera(narrow, { seat: 0 });
  assert.deepEqual(fitted.params(), presetCamera('prep', narrow, { rect: { ...STAGE_PREVIEW_CROP }, side: 'L', shop: true }).params());
  const centre = fitted.project(5, 9.5, 0);
  const other = fitted.project(15.5, 9.5, 0);
  assert.ok(Math.abs(centre.x - narrow.width / 2) < Math.abs(other.x - narrow.width / 2));
});

test('thumbnail size follows the board pixel-ratio cap', () => {
  assert.deepEqual(stagePreviewSize('high', 2), { cssWidth: 320, cssHeight: 180, width: 640, height: 360, dpr: 1, quality: 'high' });
  assert.deepEqual(stagePreviewSize('high', 4).width, 640);
  assert.deepEqual(stagePreviewSize('medium', 2), { cssWidth: 320, cssHeight: 180, width: 400, height: 225, dpr: 1, quality: 'medium' });
  assert.deepEqual(stagePreviewSize('low', 3), { cssWidth: 320, cssHeight: 180, width: 320, height: 180, dpr: 1, quality: 'low' });
  assert.equal(stagePreviewSize('nope', NaN).quality, 'medium');
  assert.equal(stagePreviewSize('low', 1).width / stagePreviewSize('low', 1).height, 320 / 180);
});

test('the map shows cells until the render exists, and the picture wins over a shot', () => {
  const stage = { rows: [], tiles: {} };
  const render = { kind: 'render', stageId: 'act3autochess_m01', key: 'scene/act3autochess_m01' };
  const pending = StageMap({ stage, choice: render, shot: null });
  assert.equal(pending.props['data-preview'], 'cells');
  assert.equal(pending.props['data-pending'], 'render');
  assert.equal(pending.props['data-assumed'], 'true');
  const failed = StageMap({ stage, choice: render, shot: false });
  assert.equal(failed.props['data-preview'], 'cells');
  assert.equal(failed.props['data-pending'], undefined);
  const ready = StageMap({ stage, choice: render, shot: { url: 'data:image/jpeg;base64,xx', renderMs: 12.4 } });
  assert.equal(ready.props['data-preview'], 'render');
  assert.equal(ready.props['data-render-ms'], '12');
  assert.equal([...walk(ready)].find((v) => v.props?.src)?.props.src, 'data:image/jpeg;base64,xx');
  const picture = StageMap({ stage, choice: { kind: 'picture', url: '/m.png', key: 'stagePreview/x' }, shot: { url: 'data:image/jpeg;base64,xx' } });
  assert.equal(picture.props['data-preview'], 'picture');
});

test('one draw at a time, a failure is cached, and a slow frame is kept', async () => {
  const cache = createStageThumbCache();
  let active = 0;
  let max = 0;
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  const first = new Promise((r) => { releaseFirst = r; });
  const second = new Promise((r) => { releaseSecond = r; });
  const render = async (id) => {
    calls++;
    active++;
    max = Math.max(max, active);
    if (calls === 1) await first;
    else await second;
    active--;
    if (id === 'bad') throw new Error('context lost');
    return { url: `data:image/jpeg;base64,${id}`, width: 8, height: 8, renderMs: id === 'slow' ? 180 : 4 };
  };
  const size = stagePreviewSize('low', 1);
  const a = cache.load('m01', { render, size, seat: 0 });
  const again = cache.load('m01', { render, size, seat: 1 });
  const b = cache.load('m05', { render, size });
  assert.equal(again, a);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(max, 1);
  releaseFirst();
  for (let i = 0; i < 20 && calls < 2; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 2);
  assert.equal(max, 1);
  assert.equal(active, 1);
  releaseSecond();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(max, 1);
  assert.equal(ra.url, 'data:image/jpeg;base64,m01');
  assert.equal(rb.url, 'data:image/jpeg;base64,m05');
  assert.equal(ra.renderMs, 4);
  assert.equal(ra, await again);
  const lost = await cache.load('lost', {
    render: async () => ({ url: 'data:image/jpeg;base64,lost', lost: true }), size,
  });
  const empty = await cache.load('empty', { render: async () => ({ url: '' }), size });
  const bad = await cache.load('bad', { render, size });
  const badAgain = await cache.load('bad', { render, size });
  assert.equal(lost, null);
  assert.equal(empty, null);
  assert.equal(bad, null);
  assert.equal(badAgain, null);
  const callsAfterBad = calls;
  assert.equal(await cache.load('bad', { render, size }), null);
  assert.equal(calls, callsAfterBad);
  const slow = await cache.load('slow', { render, size });
  assert.equal(slow.renderMs, 180);
  assert.ok(slow.url.startsWith('data:image/'));
  cache.reset();
  const redraw = cache.load('m01', { render, size });
  releaseSecond();
  assert.equal((await redraw).url, 'data:image/jpeg;base64,m01');
  assert.ok(calls > callsAfterBad);
});

test('the session cache forgets a failure when reset, and the real drawer does nothing without a document', async () => {
  resetStageThumbCache();
  let calls = 0;
  const render = async () => {
    calls++;
    throw new Error('webgl context lost');
  };
  const size = stagePreviewSize('high', 1);
  try {
    assert.equal(await loadStageThumb('act3autochess_m01', { render, size }), null);
    assert.equal(await loadStageThumb('act3autochess_m01', { render, size }), null);
    assert.equal(calls, 1);
    resetStageThumbCache();
    assert.equal(await loadStageThumb('act3autochess_m01', { render, size }), null);
    assert.equal(calls, 2);
    assert.equal(await renderStageThumb('act3autochess_m01', { size }), null);
  } finally {
    resetStageThumbCache();
  }
});
