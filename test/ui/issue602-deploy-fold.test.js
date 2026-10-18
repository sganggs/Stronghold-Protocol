// Public issue #602: "[Feature] 操作体验优化：部署干员、装备时棋盘缩放" — the official client folds the shop and
// zooms the own prep board while a piece is picked up for 部署干员 / 装备 (and while a legal drop's direction wheel is
// open), then gives the player's own 收起/展开 state back. The clone kept the shop open through the drag, so the board
// was small and easy to mis-drop on phones. The rule reuses issue #5's shop-collapsed camera:
//   gameLogic deployFoldsShop (the choice), screens/game.js deployFold / barCollapsed (derived wiring only — the
//   player's collapsed state is never written), the camera effect's deployFold branch (zoom on pickup, restore on
//   drop), the ShopBar / layout consumers taking the displayed barCollapsed state.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { deployFoldsShop, prepCameraFor, deployZoomStep, deployZoomRemember, prepDeployCamera } = await import('../../public/js/ui/gameLogic.js');
const { hudBands } = await import('../../public/js/ui/fieldHost.js');
const { presetCamera } = await import('../../public/js/render/projection.js');
const { FOLD_CAMERA_MS, CAMERA_MS } = await import('../../public/js/render/app/tune.js');

// ---- the choice (gameLogic deployFoldsShop) -----------------------------------------------------------------------

describe('deployFoldsShop: the deploy interaction temporarily folds the shop', () => {
  const own = { ownPrep: true, editable: true, pen: false };

  test('a dragged piece or the open direction wheel on the editable own prep board folds it', () => {
    assert.equal(deployFoldsShop({ ...own, drag: true }), true, 'piece picked up (operator / equipment / summon)');
    assert.equal(deployFoldsShop({ ...own, facing: true }), true, 'direction wheel of a legal drop');
    assert.equal(deployFoldsShop({ ...own, drag: true, facing: true }), true, 'both at once (drop → wheel)');
  });

  test('not on another board, not read-only, not over the enemy pen, and never without an interaction', () => {
    assert.equal(deployFoldsShop({ ...own }), false, 'no drag and no wheel');
    assert.equal(deployFoldsShop({ ...own, drag: false, facing: false }), false);
    assert.equal(deployFoldsShop({ ...own, ownPrep: false, drag: true }), false, 'battle / scouting a teammate / loading');
    assert.equal(deployFoldsShop({ ...own, editable: false, drag: true }), false, 'ready, eliminated or spectating');
    assert.equal(deployFoldsShop({ ...own, pen: true, drag: true }), false, 'the enemy preview pen folds the shop itself');
  });

  test('falsy inputs are all false', () => {
    assert.equal(deployFoldsShop(), false);
    assert.equal(deployFoldsShop({}), false);
    assert.equal(deployFoldsShop(null), false);
  });

  test('设置「部署时收起商店」 off: no fold; omitted or true stays the 0.3.0 behaviour', () => {
    assert.equal(deployFoldsShop({ ...own, drag: true, enabled: false }), false, 'drag start / tap-to-pick / keyboard');
    assert.equal(deployFoldsShop({ ...own, facing: true, enabled: false }), false, 'the facing step after a drop');
    assert.equal(deployFoldsShop({ ...own, drag: true, facing: true, enabled: false }), false);
    assert.equal(deployFoldsShop({ ...own, drag: true, enabled: true }), true);
    assert.equal(deployFoldsShop({ ...own, drag: true }), true, 'enabled omitted stays on');
  });

  test('the zoom it causes is exactly issue #5\'s folded-shop camera, on the boss prep half too', () => {
    const pl = (id, seat) => ({ playerId: id, seat, alive: true });
    const pub = { round: 6, bossRound: 14, hiddenRound: 15, players: [pl('a', 0), pl('b', 1)] };
    assert.deepEqual(prepCameraFor(pub, 'a', true), { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false } });
    const boss = { ...pub, round: 14 };
    assert.deepEqual(prepCameraFor(boss, 'b', true), { kind: 'bossPrep', opts: { side: 'R', shop: false } });
  });
});

// ---- the setting off: no zoom, and turning it off mid-drag gives the player's camera back ------------------------

describe('prepDeployCamera: the deploy fold off does not zoom, and a mid-drag toggle restores', () => {
  const pl = (id, seat) => ({ playerId: id, seat, alive: true });
  const pub = { round: 6, bossRound: 14, hiddenRound: 15, players: [pl('a', 0), pl('b', 1)] };
  const open = prepCameraFor(pub, 'a', false);
  const zoomed = prepCameraFor(pub, 'a', true);
  const frame = (extra) => ({ pub, myId: 'a', ownPrep: true, pen: false, folded: false, current: open, ...extra });

  test('picking up while the setting is on zooms even though the drag is busy', () => {
    const step = deployZoomStep(false, true);
    assert.equal(step.release, false);
    assert.equal(step.zoomed, true);
    assert.deepEqual(prepDeployCamera(frame({ deployFold: true, busy: true, releaseDeploy: step.release })), zoomed);
    assert.equal(prepDeployCamera(frame({ deployFold: true, busy: true, current: zoomed, releaseDeploy: false })), null, 'already zoomed');
  });

  test('the setting off from the start: no zoom, and a hand-made fold during the drag still waits', () => {
    const step = deployZoomStep(false, false);
    assert.deepEqual(step, { release: false, zoomed: false });
    assert.equal(prepDeployCamera(frame({ deployFold: false, busy: true, releaseDeploy: step.release })), null);
    assert.equal(prepDeployCamera(frame({ deployFold: false, busy: true, releaseDeploy: false, folded: true })), null, 'hand-made 收起 still deferred');
    assert.deepEqual(prepDeployCamera(frame({ deployFold: false, busy: false, releaseDeploy: false, folded: true, current: open })), zoomed, 'applied once the drag ends');
  });

  test('turning the setting off mid-drag restores the player\'s shop camera on that frame, and not again', () => {
    const release = deployZoomStep(true, false);
    assert.equal(release.release, true);
    assert.equal(release.zoomed, false);
    assert.deepEqual(
      prepDeployCamera(frame({ deployFold: false, busy: true, releaseDeploy: release.release, current: zoomed, folded: false })),
      open,
      'busy does not keep the deploy zoom',
    );
    const later = deployZoomStep(false, false);
    assert.equal(later.release, false);
    assert.equal(prepDeployCamera(frame({ deployFold: false, busy: true, releaseDeploy: later.release, current: open, folded: true })), null,
      'a 收起 made after the restore still waits');
    assert.equal(
      prepDeployCamera(frame({ deployFold: false, busy: true, releaseDeploy: true, current: zoomed, folded: true })),
      null,
      'a shop the player had already folded stays folded',
    );
  });

  test('opening the pen mid-drag keeps the restore owed until the pen closes', () => {
    // the cases above keep pen false. A second pointer can open 敌方情报 while the piece is held
    // (render/drag.js takes one pointer). That frame's camera request is null.
    let collapsed = false;
    let setting = true;
    let drag = true;
    let pen = false;
    let penCollapsed = false;
    let zoomRef = false;
    let cam = open;
    const tick = () => {
      const deployFold = deployFoldsShop({
        ownPrep: true, editable: true, pen, drag, facing: false, enabled: setting,
      });
      const shopFolded = pen ? penCollapsed : (collapsed || deployFold);
      const bar = !!(collapsed || deployFold);
      const step = deployZoomStep(zoomRef, deployFold);
      const next = prepDeployCamera({
        pub, myId: 'a', deployFold, releaseDeploy: step.release, folded: shopFolded,
        ownPrep: true, pen, busy: drag, current: cam,
      });
      zoomRef = deployZoomRemember(step, { next, pen });
      if (next) cam = next;
      return { bar, cam, zoomRef, release: step.release, next };
    };

    const picked = tick();
    assert.equal(picked.zoomRef, true);
    assert.deepEqual(picked.cam, zoomed);

    penCollapsed = collapsed;
    collapsed = true;
    pen = true;
    const opened = tick();
    assert.equal(opened.next, null);
    assert.equal(opened.release, true);
    assert.equal(opened.zoomRef, true, 'the pen does not spend the one-shot restore');
    assert.deepEqual(opened.cam, zoomed);

    setting = false;
    const off = tick();
    assert.equal(off.next, null);
    assert.equal(off.zoomRef, true, 'turning the setting off under the pen still owes the restore');

    collapsed = penCollapsed;
    pen = false;
    const closed = tick();
    assert.deepEqual(
      { bar: closed.bar, cam: `${closed.cam.kind} side=${closed.cam.opts.side} shop=${closed.cam.opts.shop !== false}`, zoomRef: closed.zoomRef, release: closed.release },
      { bar: false, cam: 'prep side=L shop=true', zoomRef: false, release: true },
      'leaving the pen asks for the open shop while the piece is still held',
    );

    collapsed = true;
    const handmade = tick();
    assert.equal(handmade.release, false);
    assert.equal(handmade.next, null);
    assert.deepEqual(handmade.cam, open, 'a 收起 made after that restore still waits');
  });

  test('a null release spends the zoom only when the camera already matches the player fold', () => {
    let collapsed = true;
    let setting = true;
    let drag = true;
    let pen = false;
    let penCollapsed = false;
    let zoomRef = false;
    let cam = zoomed;
    const tick = () => {
      const deployFold = deployFoldsShop({
        ownPrep: true, editable: true, pen, drag, facing: false, enabled: setting,
      });
      const shopFolded = pen ? penCollapsed : (collapsed || deployFold);
      const step = deployZoomStep(zoomRef, deployFold);
      const next = prepDeployCamera({
        pub, myId: 'a', deployFold, releaseDeploy: step.release, folded: shopFolded,
        ownPrep: true, pen, busy: drag, current: cam,
      });
      zoomRef = deployZoomRemember(step, { next, pen });
      if (next) cam = next;
      return { bar: !!(collapsed || deployFold), cam, zoomRef, release: step.release, next };
    };

    tick();
    penCollapsed = collapsed;
    collapsed = true;
    pen = true;
    assert.equal(tick().zoomRef, true);
    setting = false;
    assert.equal(tick().zoomRef, true);
    collapsed = penCollapsed;
    pen = false;
    const closed = tick();
    assert.equal(closed.next, null);
    assert.equal(closed.release, true);
    assert.equal(closed.zoomRef, false, 'the matching folded camera spends the owed zoom');
    assert.equal(closed.bar, true);
    assert.deepEqual(closed.cam, zoomed);

    collapsed = false;
    const unfolded = tick();
    assert.equal(unfolded.release, false);
    assert.equal(unfolded.next, null);
    assert.deepEqual(unfolded.cam, zoomed, 'unfolding during the rest of the drag still waits');
    assert.equal(deployZoomRemember(null, null), false);
    assert.equal(deployZoomRemember({ release: true, zoomed: false }, { next: null, pen: false }), false);
    assert.equal(deployZoomRemember({ release: true, zoomed: false }, { next: null, pen: true }), true);
  });
});

// ---- the wiring (screens/game.js) ---------------------------------------------------------------------------------

describe('game.js wiring', () => {
  const game = read('public/js/screens/game.js');

  test('deployFold is derived from the interaction state on the own editable prep board, never written into `collapsed`', () => {
    assert.match(game, /const deployFold = deployFoldsShop\(\{\n\s+ownPrep: !!view && viewModeRef\.current === 'prep' && showPrep, editable, pen, drag: !!drag, facing: !!facing,\n\s+enabled: playerSettings\.prepDeployFold !== false,\n\s+\}\);/);
    // the player's own state feeds the camera state only ORed with the temporary fold (pen behavior untouched)
    assert.match(game, /const shopFolded = showShop && \(pen \? penRef\.current\.collapsed : \(collapsed \|\| deployFold\)\);/);
    assert.match(game, /const barCollapsed = collapsed \|\| deployFold;/);
    // nothing ever persists the temporary fold as the player's 收起/展开 state
    assert.doesNotMatch(game, /setCollapsed\(\s*(?:deployFold|barCollapsed)\b/);
  });

  test('the camera effect zooms on pickup and restores through prepDeployCamera, on the short flight', () => {
    assert.match(game, /const step = deployZoomStep\(deployZoomedRef\.current, deployFold\);\n\s+const next = prepDeployCamera\(\{\n\s+pub, myId, deployFold, releaseDeploy: step\.release, folded: shopFolded,\n\s+ownPrep: !!view && viewModeRef\.current === 'prep' && showPrep,\n\s+pen, busy: !!drag \|\| !!facing, current: camRef\.current,\n\s+\}\);\n\s+\/\/ a null release because the pen is open stays owed; a null only because the camera already\n\s+\/\/ matches the player's fold spends it\. \[ASSUMED\]\n\s+deployZoomedRef\.current = deployZoomRemember\(step, \{ next, pen \}\);/);
    assert.doesNotMatch(game, /deployZoomedRef\.current = step\.zoomed/);
    const call = game.indexOf('const next = prepDeployCamera({');
    const effectEnd = game.indexOf('}, [view, deployFold, shopFolded, showPrep, pen, !!drag, !!facing, prepCamKey]);', call);
    assert.ok(call > 0 && effectEnd > call, 'deployFold stays in the effect deps');
    assert.equal(FOLD_CAMERA_MS < CAMERA_MS, true, `${FOLD_CAMERA_MS} ms is shorter than the ${CAMERA_MS} ms camera flight`);
    assert.equal((game.match(/ms: FOLD_CAMERA_MS/g) || []).length, 1, 'the pickup zoom and the fold / unfold restore share one flight');
    assert.match(game, /import \{ FOLD_CAMERA_MS \} from '\.\.\/render\/app\/tune\.js';/);
  });

  test('every shop / board-layout consumer shows the temporary fold while leaving the real state alone', () => {
    assert.match(game, /const shopOpen = showShop && !barCollapsed;/, 'detail panel / bottom frame避让');
    assert.match(game, /drag && 'is-dragging', barCollapsed && 'is-collapsed',/, 'the screen\'s folded-shop layout');
    assert.match(game, /<\$\{ShopBar\}[^\n]*collapsed=\$\{barCollapsed\}/, 'the shop bar renders folded (its 展开商店 tab)');
    assert.match(game, /<\$\{RewardOverlay\} priv=\$\{priv\} minimized=\$\{rewardMin \|\| barCollapsed\}/, 'the reward overlay stays minimized');
    // the toggle the tab calls is still the player's own state only
    assert.match(game, /<\$\{ShopBar\}[^\n]*onCollapse=\$\{setCollapsed\}/);
  });
});

// ---- the zoom itself: the deploy fold gets the same bigger board as a hand-made 收起 (phone viewport) ----------------

function withDom({ rem }, fn) {
  const g = globalThis;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  const root = { classList: { contains: (c) => c === 'sp-coarse' } };
  g.getComputedStyle = (el) => ({ fontSize: `${rem}px`, getPropertyValue: (p) => (el === root && p === '--tap-min' ? ' 44px' : '') });
  g.document = {
    documentElement: root,
    querySelector: (s) => (s === '.gm__hud' ? { getBoundingClientRect: () => ({ top: 0, bottom: 0 }) } : null),
    querySelectorAll: (s) => (s.includes('.gm__corner') ? [{ top: 390 - 0.24 * rem - 34, height: 34 }] : []),
  };
  try { return fn(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
}

describe('the deploy fold zooms the phone board like 收起, and ending it asks for the shop camera again', () => {
  test('844×390 touch viewport: tiles grow while dragging; the end state is the exact shop camera', () => {
    const [w, h] = [844, 390];
    const opts = { rect: { ...GEO.NORMAL_RECT }, side: 'L' };
    withDom({ rem: 40 }, () => {
      const openHud = hudBands('prep', { width: w, height: h }, { shop: true });
      const foldHud = hudBands('prep', { width: w, height: h }, { shop: false });
      const openCam = presetCamera('prep', { width: w, height: h }, { ...opts, shop: true, hud: openHud });
      const deployCam = presetCamera('prep', { width: w, height: h }, { ...opts, shop: false, hud: foldHud });
      const tileW = (cam, row) => cam.project(5.5, row - 0.5).x - cam.project(4.5, row - 0.5).x;
      assert.ok(tileW(deployCam, 10) > tileW(openCam, 10) * 1.15,
        `the picked-up piece's board grows (${tileW(openCam, 10).toFixed(1)} → ${tileW(deployCam, 10).toFixed(1)} px)`);
      // the interaction ending requests the shop camera again — the very same framing as before the drag
      const back = presetCamera('prep', { width: w, height: h }, { ...opts, shop: true, hud: openHud });
      assert.deepEqual(back.params(), openCam.params());
    });
  });
});

// ---- the 0.3.0 port: what the merge added on top of the PR ---------------------------------------------------------

describe('0.3.0 port of PR #646', () => {
  const game = read('public/js/screens/game.js');
  const app = read('public/js/render/app.js');

  test('the camera the pen returns to is remembered without its flight time (the fold zoom\'s 350 ms is not replayed)', () => {
    // togglePen(false) repeats camRef's opts: with `ms: FOLD_CAMERA_MS` kept there, the way back from the pen flew
    // 350 ms instead of the pen's own 0.25 s (render/app.js PEN_CAMERA_MS)
    assert.match(game, /const setCam = useCallback\(\(kind, opts\) => \{[\s\S]{0,400}?const \{ ms: _ms, instant: _instant, \.\.\.framing \} = opts \|\| \{\};\n\s+camRef\.current = \{ kind, opts: framing \};/);
    assert.match(game, /const c = camRef\.current;\n\s+view\.setCamera\(c\.kind, c\.opts\);/, 'the pen\'s way back repeats the remembered framing');
  });

  test('a drag under a still pointer follows a camera flight (the pickup zoom): the view judges it again every flying frame', () => {
    assert.match(app, /const flying = !!camTo;\n\s+stepCamera\(now\);\n[\s\S]{0,300}?if \(flying && mode === 'prep' && drag\.dragging\) drag\.refresh\(\);/);
  });
});
