// Official theme prefabs (ui/prefab/): the Unity layout rules, clip poses, status drivers and the 规程 HUD bindings.
// Synthetic prefabs only; the last block cross-checks the installed packs and skips without them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { layoutPrefab, applySliders, scriptRef } from '../../public/js/ui/prefab/layout.js';
import { createPose, evalKeys, evalVecKeys, clipTime, resolvePath, clipPose, applyStatuses } from '../../public/js/ui/prefab/anim.js';
import { buildPose, imageStyle, makePack, indexIds, effectStyle, effectScroll } from '../../public/js/ui/prefab/view.js';
import { hudStatus, hudBinds, countdownStatus, cornerOffset } from '../../public/js/ui/prefab/hud.js';
import { sampleClip, nodeKeyframes } from '../../public/js/ui/prefab/player.js';
import { clipPeak, scriptAnim } from '../../public/js/ui/prefab/banners.js';

const R = (size, pos = [0, 0], extra = {}) => ({ anchors: { min: [0.5, 0.5], max: [0.5, 0.5] }, pivot: [0.5, 0.5], sizeDelta: size, anchoredPosition: pos, ...extra });
/** child box by name, depth-first */
function boxOf(box, name) {
  if (box.node.name === name) return box;
  for (const c of box.children) {
    const hit = boxOf(c, name);
    if (hit) return hit;
  }
  return null;
}
const measure = (text, node) => ({ w: String(text).length * (node.text?.fontSize || 10), h: 12 });

describe('Unity RectTransform', () => {
  test('a centred child sits at its anchored position; a stretched one follows the parent; pivot moves the box', () => {
    const root = {
      name: 'root', rect: R([200, 100]),
      children: [
        { name: 'mid', rect: R([20, 10], [30, -10]) },
        { name: 'fill', rect: { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [-20, -10], anchoredPosition: [0, 0] } },
        { name: 'left', rect: { anchors: { min: [0, 0.5], max: [0, 0.5] }, pivot: [0, 0.5], sizeDelta: [40, 20], anchoredPosition: [5, 0] } },
      ],
    };
    const { box } = layoutPrefab(root);
    const mid = boxOf(box, 'mid');
    // parent 200×100: centre (100, 50) top-left based; +30 right, −10 (up in Unity) is down 10 here
    assert.deepEqual([mid.left, mid.top, mid.w, mid.h], [120, 55, 20, 10]);
    const fill = boxOf(box, 'fill');
    assert.deepEqual([fill.left, fill.top, fill.w, fill.h], [10, 5, 180, 90]);
    const left = boxOf(box, 'left');
    assert.deepEqual([left.left, left.top, left.w, left.h], [5, 40, 40, 20]);
  });

  test('a horizontal layout group under a preferred-size fitter: texts, a LayoutElement, spacing, an ignored child', () => {
    const root = {
      name: 'row', rect: R([0, 30]), layout: { axis: 'h', align: 4, spacing: 2, control: [1, 0], expand: [0, 0] }, fit: [2, 0],
      children: [
        { name: 'title', rect: { anchors: { min: [0, 0], max: [0, 0] }, pivot: [0.5, 0.5], sizeDelta: [0, 16], anchoredPosition: [0, 0] }, text: { fontSize: 10, text: 'ab' } },
        { name: 'num', rect: { anchors: { min: [0, 0], max: [0, 0] }, pivot: [0.5, 0.5], sizeDelta: [0, 20], anchoredPosition: [0, 0] }, element: { min: [40, -1], pref: [40, -1] } },
        { name: 'shadow', rect: { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [10, 0], anchoredPosition: [0, 0] }, element: { ignore: 1 } },
      ],
    };
    const { box } = layoutPrefab(root, { measure });
    assert.equal(box.w, 20 + 2 + 40, 'preferred width = 20 (text) + spacing + 40 (LayoutElement)');
    const title = boxOf(box, 'title');
    const num = boxOf(box, 'num');
    assert.deepEqual([title.left, title.w], [0, 20]);
    assert.deepEqual([num.left, num.w], [22, 40]);
    // the cross axis is not controlled: own heights, middle aligned in the 30-unit row
    assert.deepEqual([title.top, title.h, num.top, num.h], [7, 16, 5, 20]);
    const shadow = boxOf(box, 'shadow');
    assert.deepEqual([shadow.left, shadow.w], [-5, 72], 'the ignored child stretches over the fitted row by its own anchors');
  });

  test('a group that does not control widths keeps each child\'s width and centres the run', () => {
    const root = {
      name: 'g', rect: R([100, 20]), layout: { axis: 'h', align: 4, spacing: 0, control: [0, 0], expand: [0, 0] },
      children: [{ name: 'a', rect: R([10, 10]) }, { name: 'b', rect: R([30, 10]) }],
    };
    const { box } = layoutPrefab(root);
    assert.deepEqual([boxOf(box, 'a').left, boxOf(box, 'b').left], [30, 40]);
  });

  test('a slider value moves its fill\'s anchors (left to right, and bottom to top)', () => {
    const root = {
      name: 's', id: 1, rect: R([100, 10]), slider: { dir: 0, min: 0, max: 1, value: 1, fill: 2 },
      children: [{ name: 'fill', id: 2, rect: { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [0, 0], anchoredPosition: [0, 0] } }],
    };
    const pose = applySliders(root, new Map([[1, 0.25]]), createPose());
    const { box } = layoutPrefab(root, { pose });
    assert.deepEqual([boxOf(box, 'fill').left, boxOf(box, 'fill').w], [0, 25]);
    root.slider.dir = 2;
    const up = layoutPrefab(root, { pose: applySliders(root, new Map([[1, 0.5]]), createPose()) }).box;
    assert.deepEqual([boxOf(up, 'fill').top, boxOf(up, 'fill').h], [5, 5]);
  });
});

describe('legacy clips', () => {
  test('Hermite between keys, an infinite slope holds, vectors evaluate per axis', () => {
    const keys = [[0, 0, 0, 0], [1, 1, 0, 0]];
    assert.equal(evalKeys(keys, 0.5), 0.5, 'flat tangents: the smoothstep midpoint');
    assert.equal(evalKeys(keys, 2), 1);
    assert.equal(evalKeys([[0, 0, 0, 1e9], [1, 1, 1e9, 0]], 0.99), 0, 'a step holds the left value');
    assert.deepEqual(evalVecKeys([[0, [0, 2], [0, 0], [0, 0]], [2, [2, 4], [0, 0], [0, 0]]], 1), [1, 3]);
  });

  test('wrap modes: loop, ping-pong, clamp', () => {
    assert.equal(clipTime({ len: 2, wrap: 2 }, 5), 1);
    assert.equal(clipTime({ len: 2, wrap: 4 }, 3), 1);
    assert.equal(clipTime({ len: 2, wrap: 0 }, 5), 2);
  });

  test('a clip pose reaches nodes by path and sets alpha, colour, position, scale and rotation', () => {
    const root = { name: 'w', children: [{ name: 'a', children: [{ name: 'b' }] }] };
    const b = resolvePath(root, 'a/b');
    assert.equal(b?.name, 'b');
    assert.equal(resolvePath(root, 'a/x'), null);
    const clip = {
      len: 1, wrap: 0, curves: [
        ['a', 'alpha', [[0, 0, 0, 0], [1, 1, 0, 0]]],
        ['a/b', 'img.a', [[0, 1, 0, 0], [1, 0.5, 0, 0]]],
        ['a/b', 'ay', [[0, 0, 0, 0], [1, -7, 0, 0]]],
        ['a', 'scale', [[0, [1, 1, 1], [0, 0, 0], [0, 0, 0]], [1, [0.5, 0.5, 1], [0, 0, 0], [0, 0, 0]]]],
        ['a', 'rot', [[0, [0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0]], [1, [0, 0, Math.SQRT1_2, Math.SQRT1_2], [0, 0, 0, 0], [0, 0, 0, 0]]]],
      ],
    };
    const pose = clipPose(clip, root, 1, createPose());
    const a = root.children[0];
    assert.equal(pose.alpha.get(a), 1);
    assert.deepEqual(pose.color.get(b), { a: 0.5 });
    assert.deepEqual(pose.pos.get(b), [null, -7]);
    assert.deepEqual(pose.scale.get(a), [0.5, 0.5]);
    assert.ok(Math.abs(pose.rot.get(a) - 90) < 1e-6);
  });

  test('a status sets nodes active, then its clip ends; a switch clip shown backwards is at its start', () => {
    const root = {
      name: 'hud', id: 1,
      status: [
        { name: 'on', ops: [{ t: 2, anim: { clip: 'sw', on: 1 } }, { t: 1, node: 2, on: 1 }] },
        { name: 'off', ops: [{ t: 3, anim: { clip: 'sw', on: 1 } }] },
        { name: 'show', ops: [{ t: 3, anim: { clip: 'sw', on: 1 }, show: 1 }] },
      ],
      children: [{ name: 'panel', id: 2, active: false }, { name: 'glow', alpha: 0 }],
    };
    const clips = { sw: { len: 1, wrap: 0, curves: [['glow', 'alpha', [[0, 0, 0, 0], [1, 1, 0, 0]]]] } };
    const ids = indexIds(root);
    const on = createPose();
    applyStatuses(root, clips, ['on'], on, (id) => ids.get(id) || null);
    assert.equal(on.active.get(root.children[0]), true);
    assert.equal(on.alpha.get(root.children[1]), 1);
    const off = createPose();
    applyStatuses(root, clips, ['off'], off, (id) => ids.get(id) || null);
    assert.equal(off.alpha.get(root.children[1]), 0);
    const show = createPose();
    applyStatuses(root, clips, ['show'], show, (id) => ids.get(id) || null);
    assert.equal(show.alpha.get(root.children[1]), 1);
  });
});

describe('image layers', () => {
  const sprite = (name, file) => (name ? `/s/${file || name}` : '');
  test('a white sprite stretches; a coloured one is tinted through its own mask; sliced keeps its borders', () => {
    const plain = imageStyle({ type: 'simple', color: '#FFFFFF', sprite: 'a', w: 10, h: 10 }, sprite);
    assert.equal(plain.backgroundImage, 'url("/s/a")');
    assert.equal(plain.WebkitMaskImage, undefined);
    const tinted = imageStyle({ type: 'simple', color: '#FF000080', sprite: 'a' }, sprite);
    assert.equal(tinted.backgroundColor, 'rgb(255 0 0)');
    assert.equal(tinted.WebkitMaskImage, 'url("/s/a")');
    assert.equal(tinted.opacity, '0.502');
    const sliced = imageStyle({ type: 'sliced', color: '#FFFFFF', sprite: 'f', slice: [4, 6, 4, 6], ppu: 2 }, sprite);
    assert.equal(sliced.borderImage, 'url("/s/f") 4 6 4 6 fill / 0.02rem 0.03rem 0.02rem 0.03rem stretch');
    const own = imageStyle({ type: 'simple', color: '#FFFFFF', sprite: 'img_tv', file: 'sprites/img_tv_3.webp' }, sprite);
    assert.equal(own.backgroundImage, 'url("/s/sprites/img_tv_3.webp")', 'same-name sprites: the node\'s own file');
  });

  test('left out: an external sprite, a sprite-less Image with a shader material, a zero alpha; a plain one is a colour quad', () => {
    assert.equal(imageStyle({ type: 'simple', color: '#FFFFFF', sprite: null, external: true }, sprite), null);
    assert.equal(imageStyle({ type: 'simple', color: '#FFFFFF80', sprite: null, material: { name: 'wireline_red', fx: 1 } }, sprite), null);
    assert.equal(imageStyle({ type: 'simple', color: '#FF000000', sprite: 'a' }, sprite), null);
    assert.equal(imageStyle({ type: 'simple', color: '#DB3F67', sprite: null }, sprite).backgroundColor, 'rgb(219 63 103)');
    assert.equal(imageStyle({ type: 'simple', color: '#FFFFFF', sprite: 'g', material: { name: 'm_add' } }, sprite).mixBlendMode, 'screen');
  });
});

describe('effect materials', () => {
  test('a sprite-less Image with the effect shader: base × colour × tint through the base (and mask) alpha, blended like light', () => {
    const texture = (n) => `/t/${n}`;
    const img = { type: 'simple', color: '#FFFFFF80', sprite: null, material: { name: 'wireline_red', fx: 1, base: 'wireline_solid', tint: '#DE1E4D', mask: 'm' } };
    const st = effectStyle(img, null, texture);
    assert.equal(st.backgroundColor, 'rgb(222 30 77)');
    assert.equal(st.maskImage, 'url("/t/wireline_solid"), url("/t/m")');
    assert.equal(st.maskComposite, 'intersect');
    assert.equal(st.mixBlendMode, 'screen');
    assert.equal(st.opacity, '0.502');
    assert.deepEqual(imageStyle(img, () => '', null, null, texture), st, 'imageStyle hands the effect material over');
    assert.equal(imageStyle(img, () => ''), null, 'without textures it stays undrawn');
  });

  test('the base texture\'s UV scroll is a mask-position loop of one tile', () => {
    const sc = effectScroll({ base: 'f', speed: [-1, 0], tile: [0.6, 1] }, { w: 30, h: 20 });
    assert.equal(sc.animation, `${sc.name} 1s linear infinite`);
    assert.match(sc.body, /to \{ -webkit-mask-position: 0\.5rem 0rem; mask-position: 0\.5rem 0rem; \}/, 'u −1 a second moves one 50-unit tile right');
    assert.equal(effectScroll({ base: 'f' }, { w: 30, h: 20 }), null);
  });
});

/** A small group_hud with the official controller fields. */
function miniHud() {
  return {
    name: 'group_hud', id: 1, rect: R([510, 68]),
    scripts: [
      { refs: { _statusDriver: 1, _restPanel: 6, _normalPanel: 7, _helpPanel: 12, _bossPanel: 13 } },
      { refs: { _roundText: 2, _playerHpText: 3, _loseHpGrp: 4, _lostHpText: 5 } },
    ],
    status: [{ name: 'hud_rest_settled', ops: [{ t: 1, node: 6, on: 1 }, { t: 1, node: 7, on: 0 }] }],
    children: [
      { name: 'text_num', id: 2, rect: R([30, 25]), text: { fontSize: 20 } },
      { name: 'text_hp', id: 3, rect: R([30, 25]), text: { fontSize: 20 } },
      { name: 'root_lost_hp', id: 4, rect: R([60, 40]), alpha: 1, children: [{ name: 'text_lost', id: 5, rect: R([30, 18]), text: { fontSize: 19 } }] },
      { name: 'group_rest', id: 6, active: false, rect: R([157, 45]) },
      {
        name: 'group_battle', id: 7, active: false, rect: R([157, 45]),
        scripts: [{ refs: { _enemyCurCountText: 8, _enemyTotalCountText: 9, _lostEnemyGrp: 10, _lostEnemyText: 11 } }],
        children: [
          { name: 'text_current', id: 8, rect: R([11, 34]), text: { fontSize: 18 } },
          { name: 'text_total', id: 9, rect: R([11, 34]), text: { fontSize: 18 } },
          { name: 'tag_miss', id: 10, rect: R([80, 28]), children: [{ name: 'text_num', id: 11, rect: R([24, 18]), text: { fontSize: 15 } }] },
        ],
      },
      { name: 'group_coop', id: 12, active: false, rect: R([157, 45]) },
      {
        name: 'group_boss', id: 13, active: false, rect: R([482, 56]),
        scripts: [{ refs: { _bossHpSlider: 14, _enemyCurCountText: 15, _enemyTotalCountText: 16 } }],
        children: [
          { name: 'hp_slider', id: 14, rect: R([190, 11]), slider: { dir: 0, min: 0, max: 1, value: 1, fill: 17 },
            children: [{ name: 'Fill', id: 17, rect: { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [0, 0], anchoredPosition: [0, 0] }, image: { type: 'simple', color: '#DB3F67', sprite: null } }] },
          { name: 'text_current', id: 15, rect: R([10, 34]), text: { fontSize: 17 } },
          { name: 'text_total', id: 16, rect: R([20, 34]), text: { fontSize: 17 } },
        ],
      },
    ],
  };
}

describe('规程 HUD bindings', () => {
  test('the mid-screen status follows the phase', () => {
    assert.equal(hudStatus('PREP', null), 'hud_rest_settled');
    assert.equal(hudStatus('COMBAT', {}), 'hud_battle_settled');
    assert.equal(hudStatus('UNITE', {}), 'hud_coop', 'the prefabs have no settled 联防 status');
    assert.equal(hudStatus('FINAL_ASSAULT', {}), 'hud_boss_settled');
    assert.equal(hudStatus('SETTLE', { total: 12 }), 'hud_battle_settled');
    assert.equal(hudStatus('SETTLE', null), 'hud_rest_settled');
  });

  test('round, HP, the lost-HP tag, kill counts and the boss bar go where the controllers point', () => {
    const hud = miniHud();
    assert.equal(scriptRef(hud, '_roundText'), 2);
    const b = hudBinds(hud, { phase: 'FINAL_ASSAULT', round: '7', lp: 24, pending: 3, hud: { resolved: 5, total: 12 }, miss: null, boss: { hp: 250, max: 1000 } });
    assert.equal(b.texts.get(2), '7');
    assert.equal(b.texts.get(3), '24');
    assert.equal(b.texts.get(5), '-3');
    assert.equal(b.alpha.get(4), 1);
    assert.equal(b.texts.get(8), '5');
    assert.equal(b.texts.get(9), '12');
    assert.equal(b.texts.get(15), '5');
    assert.equal(b.sliders.get(14), 0.25);
    assert.equal(b.active.get(10), false, 'the miss tag belongs to 联防 only');
    const quiet = hudBinds(hud, { phase: 'PREP', round: '1', lp: null, pending: 0, hud: null, miss: null, boss: null });
    assert.equal(quiet.alpha.get(4), 0, 'no loss: the lost-HP tag hides');
    assert.equal(quiet.texts.get(3), '--');
  });

  test('the countdown statuses: ready, last seconds, untimed', () => {
    assert.deepEqual(countdownStatus({ remain: 40, ready: false }), ['countdown', 'cd_color_normal', 'content_timer']);
    assert.deepEqual(countdownStatus({ remain: 8, ready: true }), ['ready_continue', 'cd_color_last', 'content_timer']);
    assert.deepEqual(countdownStatus({ remain: 0, ready: false }), ['countdown', 'cd_color_normal', 'content_timer']);
    assert.deepEqual(countdownStatus({ remain: null, ready: false }), ['countdown', 'cd_color_normal', 'content_single_plain']);
  });

  test('a pose from statuses, id-keyed texts and slider values', () => {
    const hud = miniHud();
    const pack = makePack({}, 'themes/x', { spPrefabs: 1, prefabs: { group_hud: hud }, clips: {} });
    const pose = buildPose(pack, hud, { status: ['hud_rest_settled'], texts: new Map([[2, '9']]), sliders: new Map([[14, 0.5]]) });
    const ids = indexIds(hud);
    assert.equal(pose.active.get(ids.get(6)), true);
    assert.equal(pose.active.get(ids.get(7)), false);
    assert.equal(pose.texts.get(ids.get(2)), '9');
    assert.deepEqual(pose.anchors.get(ids.get(17)), { min: [0, 0], max: [0.5, 1] });
  });

  test('the ready face sits where both roots meet', () => {
    const cd = { name: 'panel_countdown', rect: R([0, 0]), children: [{ name: 'tv', rect: R([100, 80], [-50, 0]), image: { type: 'simple', color: '#FFFFFF', sprite: 'tv' } }] };
    const ready = {
      name: 'panel_prep_ready', rect: R([0, 0]),
      scripts: [{ anims: { _animationLocation: { clip: 'btn_ready_switch', on: 2 } } }],
      children: [{ name: 'btn_ready', id: 2, rect: R([60, 20], [-40, -50]), image: { type: 'simple', color: '#FFFFFF', sprite: 'b' } }],
    };
    const pack = makePack({}, 'themes/x', { spPrefabs: 1, prefabs: { panel_countdown: cd, panel_prep_ready: ready }, clips: {} });
    // tv box: x −100…0, y −40…40 (y down); button: x −70…−10, y 40…60 → offset (30, 80) units at 1.44
    assert.deepEqual(cornerOffset(pack), { x: '0.432rem', y: '1.152rem' });
  });
});

describe('clip playback and banners', () => {
  test('a clip becomes per-node keyframes: opacity, a translation from where the layout drew it, scale and rotation', () => {
    const root = { name: 'w', children: [{ name: 'a' }] };
    const clip = { len: 1, wrap: 0, curves: [
      ['a', 'alpha', [[0, 0, 0, 0], [1, 1, 0, 0]]],
      ['a', 'ay', [[0, 10, 0, 0], [1, 0, 0, 0]]],
      ['a', 'scale', [[0, [0.5, 0.5, 1], [0, 0, 0], [0, 0, 0]], [1, [1, 1, 1], [0, 0, 0], [0, 0, 0]]]],
    ] };
    const { frames, tracks } = sampleClip(clip, root);
    assert.equal(frames, 30);
    const tr = tracks.get(root.children[0]);
    const kf = nodeKeyframes(tr, frames, { pos: [0, 0], size: [20, 20], scale: [1, 1], rot: 0, alpha: 1, color: null, tinted: false, text: false });
    assert.equal(kf.box.length, 31);
    assert.equal(kf.box[0].opacity, '0');
    assert.equal(kf.box[30].opacity, '1');
    assert.equal(kf.box[0].transform, 'translate(0rem, -0.1rem) rotate(0deg) scale(0.5, 0.5)', 'up 10 units in Unity is up 0.1rem on screen');
    assert.equal(kf.box[30].transform, 'translate(0rem, 0rem) rotate(0deg) scale(1, 1)');
    assert.equal(kf.gfx, null);
  });

  test('a graphic colour clip moves the layer\'s opacity and, tinted, its colour', () => {
    const root = { name: 'w', children: [{ name: 'g' }] };
    const clip = { len: 0.5, wrap: 0, curves: [['g', 'img.a', [[0, 0, 0, 0], [0.5, 1, 0, 0]]], ['g', 'img.r', [[0, 0, 0, 0], [0.5, 1, 0, 0]]]] };
    const { frames, tracks } = sampleClip(clip, root);
    const kf = nodeKeyframes(tracks.get(root.children[0]), frames, { pos: [0, 0], size: [1, 1], scale: [1, 1], rot: 0, alpha: 1, color: '#0000FF', tinted: true, text: false });
    assert.equal(kf.box, null);
    assert.equal(kf.gfx[0].opacity, '0');
    assert.equal(kf.gfx[0].backgroundColor, 'rgb(0 0 255)');
    assert.equal(kf.gfx[frames].backgroundColor, 'rgb(255 0 255)');
  });

  test('a banner lays out at its show clip\'s peak: the end of an in clip, the middle of one that comes and goes', () => {
    const inClip = { len: 1.2, curves: [['', 'alpha', [[0, 0, 0, 0], [1.2, 1, 0, 0]]]] };
    const showClip = { len: 3, curves: [['', 'alpha', [[0, 0, 0, 0], [0.5, 1, 0, 0], [2.5, 1, 0, 0], [3, 0, 0, 0]]]] };
    assert.equal(clipPeak(inClip), 1.2);
    assert.equal(clipPeak(showClip), 1.5);
    const prefab = { name: 'b', scripts: [{ anims: { _showAnim: { clip: 'x_show', on: 2 } } }], children: [] };
    assert.deepEqual(scriptAnim(prefab, '_showAnim'), { clip: 'x_show', on: 2 });
    assert.equal(scriptAnim(prefab, '_inAnim'), null);
  });
});

const PACKS = '/assets/local/themes';
const local = (id) => new URL(`../../public${PACKS}/${id}/prefabs.json`, import.meta.url);
describe('installed official packs (local; skipped without them)', { skip: !existsSync(local('ac_s_closur')) && 'no local theme packs' }, () => {
  test('可露希尔 group_hud: the round row lays out, each status shows its own panel, the boss bar fills', () => {
    const doc = JSON.parse(readFileSync(local('ac_s_closur'), 'utf8'));
    const pack = makePack({}, 'themes/ac_s_closur', doc);
    const hud = doc.prefabs.group_hud;
    for (const [status, panel] of [['hud_rest_settled', 'group_rest'], ['hud_battle_settled', 'group_battle'], ['hud_boss_settled', 'group_boss']]) {
      const pose = buildPose(pack, hud, { status: [status], textFor: (n) => (n.text?.textId?.endsWith('ROUND_TEXT') ? '回合' : '12') });
      const { box } = layoutPrefab(hud, { pose, measure, skip: (n) => !!n.fx });
      const mid = boxOf(box, 'group_mid_screen');
      assert.deepEqual(mid.children.map((c) => c.node.name), [panel], status);
      const title = boxOf(box, 'text_title');
      const round = boxOf(box, 'round');
      assert.ok(round.left > title.left + title.w - 0.01, 'the round number sits right of 回合');
    }
    const b = hudBinds(hud, { phase: 'FINAL_ASSAULT', round: '9', lp: 30, pending: 0, hud: { resolved: 3, total: 10 }, miss: null, boss: { hp: 1, max: 4 } });
    assert.equal([...b.sliders.values()][0], 0.25);
  });

  test('可露希尔 countdown: the last seconds switch the TV, the bitmap font has its ten digits', () => {
    const doc = JSON.parse(readFileSync(local('ac_s_closur'), 'utf8'));
    const pack = makePack({}, 'themes/ac_s_closur', doc);
    const cd = doc.prefabs.panel_countdown;
    const find = (name, root = cd) => (root.name === name ? root : (root.children || []).map((c) => find(name, c)).find(Boolean) || null);
    const last = buildPose(pack, cd, { status: countdownStatus({ remain: 5, ready: false }) });
    assert.equal(last.alpha.get(find('back_last')), 1);
    assert.equal(last.alpha.get(find('back_normal')), 0);
    const normal = buildPose(pack, cd, { status: countdownStatus({ remain: 50, ready: false }) });
    assert.equal(normal.alpha.get(find('back_last')), 0);
    const font = doc.fonts.find((f) => f.name === 'font_ac_s_closur_1');
    assert.equal(font.glyphs.length, 10);
    assert.match(font.file, /^sprites\/font_ac_s_closur_1\.webp$/);
  });
});
