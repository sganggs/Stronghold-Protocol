// 规程's opening (ui/regulationFilm.js, DESIGN §37.147): the effect materials it needs (rings, particle sheets, masked
// and additive layers: ui/prefab/view.js), the pose of a film second, the pictures it preloads and the frame-by-frame
// stage (ui/prefab/stage.js) on a stand-in DOM. Synthetic prefabs only; the last block cross-checks the extracted group
// (tools/local-extract/season_entry.py) and skips without it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ringStyle, sheetStyle, effectImageStyle, additiveMaterial, imageStyle, makePack } from '../../public/js/ui/prefab/view.js';
import { resolvePath } from '../../public/js/ui/prefab/anim.js';
import { layoutPrefab } from '../../public/js/ui/prefab/layout.js';
import { regulationPose, regulationPictures, ENTRY_PREFAB, ENTRY_CLIP, REG_END, REG_SPAN, REGULATION_ENTRY } from '../../public/js/ui/regulationFilm.js';

const tex = (name) => `/t/${name}.webp`;
const sprite = (name) => `/s/${name}.webp`;

describe('effect materials of the opening', () => {
  test('a ring: the colour between two radii as shares of the closest side, each edge smoothed about its radius', () => {
    const img = { sprite: null, color: '#13A7A24C', material: { name: 'mat_shape_circle_clear', ring: [0.437, 0.005, 0.44, 0.005] } };
    const st = ringStyle(img, null, tex);
    assert.equal(st.backgroundColor, 'rgb(19 167 162)');
    assert.equal(st.opacity, '0.298');
    // 0.437 ± 0.0025 and 0.44 ± 0.0025 of a radius 0.5
    assert.equal(st.maskImage, 'radial-gradient(closest-side, transparent 86.9%, #000 87.9%, #000 87.9%, transparent 88.5%)');
    assert.equal(st.mixBlendMode, undefined);
    assert.equal(ringStyle({ ...img, color: '#13A7A200' }, null, tex), null);
  });

  test('a scan-lined band: the ring and the tiled addition map intersect, additive light', () => {
    const img = { sprite: null, color: '#FFFFFF80', material: { name: 'mat_shape_circle_tile_add', fx: 1, ring: [0.438, 0.065, 0.491, 0.059], add: 'img_screen_line_hori', addTile: [4.864, 4.864] } };
    const st = ringStyle(img, null, tex);
    assert.match(st.maskImage, /^radial-gradient\(closest-side, transparent 81\.1%, #000 94\.1%, #000 94\.1%, transparent 104\.1%\), url\("\/t\/img_screen_line_hori\.webp"\)$/);
    assert.equal(st.maskSize, '100% 100%, 20.559% 20.559%');
    assert.equal(st.maskRepeat, 'no-repeat, repeat');
    assert.equal(st.maskComposite, 'intersect');
    assert.equal(st.mixBlendMode, 'screen');
  });

  test('a particle sheet: the colour\'s red channel picks the frame, row by row from the top-left; a tinted sheet is a mask', () => {
    const digits = { sprite: null, color: '#1FFFFF', material: { name: 'mat_entry_num_sheet', fx: 1, sheet: { tex: 'entry_num_sheet', cols: 5, rows: 2, ctrl: 1, color: '#FFFFFF' } } };
    const nine = sheetStyle(digits, { r: 0.95 }, tex);
    assert.equal(nine.backgroundImage, 'url("/t/entry_num_sheet.webp")');
    assert.equal(nine.backgroundSize, '500% 200%');
    assert.equal(nine.backgroundPosition, '100% 100%');
    // the prefab's own colour: r 0x1F → frame 1
    assert.equal(sheetStyle(digits, null, tex).backgroundPosition, '25% 0%');
    // 0.1 is frame 1, not 0
    assert.equal(sheetStyle(digits, { r: 0.1 }, tex).backgroundPosition, '25% 0%');
    const codes = { sprite: null, color: '#4DFFFF', material: { name: 'mat_entry_desc_sheet_1', fx: 1, sheet: { tex: 'bg_link_desc_text_1', cols: 1, rows: 9, ctrl: 1, color: '#DB4834' } } };
    const a03 = sheetStyle(codes, null, tex);
    assert.equal(a03.backgroundColor, 'rgb(219 72 52)');
    assert.equal(a03.maskImage, 'url("/t/bg_link_desc_text_1.webp")');
    assert.equal(a03.maskSize, '100% 900%');
    assert.equal(a03.maskPosition, '0% 25%');
    const still = { ...codes, material: { ...codes.material, sheet: { ...codes.material.sheet, ctrl: 0 } } };
    assert.equal(sheetStyle(still, null, tex).maskPosition, '0% 0%');
    assert.equal(sheetStyle(codes, { a: 0 }, tex), null);
    assert.equal(sheetStyle(codes, null, () => ''), null);
  });

  test('effectImageStyle: sprite-less additive quads, masked sprites, a colour that drives the shader; the HUD\'s imageStyle unchanged', () => {
    const quad = { sprite: null, color: '#D6331380', material: { name: 'mat_com_add', blend: 'add' } };
    assert.deepEqual(effectImageStyle(quad, sprite, null, null, tex), { backgroundColor: 'rgb(214 51 19)', mixBlendMode: 'screen', opacity: '0.502' });
    // the theme HUD keeps leaving such quads out
    assert.equal(imageStyle(quad, sprite, null, null, tex), null);
    assert.equal(effectImageStyle({ sprite: null, color: '#FFFFFF', material: { name: 'mat_btn_mode_choice_mask' } }, sprite, null, null, tex), null);
    const map = { sprite: 'entry_anim_map', type: 'simple', color: '#FFFFFF', material: { name: 'mat_entry_map_dissolve', fx: 1, blend: 'add', mask: 'img_screen_line_hori', maskTile: [4.375, 2.625], rgbCtrl: 1 } };
    const st = effectImageStyle(map, sprite, { g: 0.5, b: 1 }, null, tex);
    assert.equal(st.backgroundImage, 'url("/s/entry_anim_map.webp")');
    assert.equal(st.backgroundColor, undefined, 'drawn white: the colour is the dissolve, not a tint');
    assert.equal(st.opacity, '0.502');
    assert.equal(st.maskImage, 'url("/t/img_screen_line_hori.webp")');
    assert.equal(st.maskSize, '22.857% 38.095%');
    assert.equal(st.mixBlendMode, 'screen');
    assert.equal(effectImageStyle(map, sprite, { g: 0 }, null, tex), null);
    assert.ok(additiveMaterial({ name: 'm_add' }) && additiveMaterial({ name: 'x', blend: 'add' }) && !additiveMaterial({ name: 'mat_address' }));
  });
});

/** A synthetic opening: root ▸ cover, entry layer (off) ▸ card; the entry clip turns the layer on, the loop dims the card. */
function synthPack() {
  const R = (size, pos = [0, 0]) => ({ anchors: { min: [0.5, 0.5], max: [0.5, 0.5] }, pivot: [0.5, 0.5], sizeDelta: size, anchoredPosition: pos });
  const S = { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [0, 0], anchoredPosition: [0, 0] };
  const prefab = {
    name: ENTRY_PREFAB, rect: S,
    children: [
      { name: 'cover_black_in', rect: S, image: { sprite: null, color: '#00000000' } },
      { name: 'canvas_front', rect: S, children: [
        { name: 'entry_anim_season_on', active: false, rect: S, alpha: 1, children: [
          { name: 'card', rect: R([100, 40], [10, 0]), image: { sprite: 'entry_id_card_frame', type: 'simple', color: '#FFFFFF' } },
          { name: 'num', rect: R([24, 24]), image: { sprite: null, color: '#00FFFF', material: { name: 'mat_entry_num_sheet', fx: 1, sheet: { tex: 'entry_num_sheet', cols: 5, rows: 2, ctrl: 1 } } } },
        ] },
      ] },
      { name: 'dust', fx: 1, rect: R([10, 10]) },
    ],
  };
  const clips = {
    [ENTRY_CLIP]: { len: 3.1667, wrap: 0, curves: [
      ['cover_black_in', 'img.a', [[0, 1, 0, 0], [0.6, 0, 0, 0]]],
      ['canvas_front/entry_anim_season_on', 'active', [[0, 1, 0, 0], [2.567, 0, 1e9, 1e9]]],
      ['canvas_front/entry_anim_season_on/card', 'sw', [[0, 0, 0, 0], [1, 100, 0, 0]]],
    ] },
    autochess_season_on_entry_loop: { len: 2.8, wrap: 2, curves: [['card', 'img.a', [[0, 0.5, 0, 0], [2.8, 0.5, 0, 0]]]] },
  };
  const doc = { spPrefabs: 1, prefabs: { [ENTRY_PREFAB]: prefab }, clips, textures: { entry_num_sheet: { file: 'sprites/tex_entry_num_sheet.webp' } } };
  const files = ['prefabs.json', 'sprites/entry_id_card_frame.webp', 'sprites/tex_entry_num_sheet.webp'];
  const groups = { [REGULATION_ENTRY]: Object.fromEntries(files.map((f) => [f, { path: `/assets/local/${REGULATION_ENTRY}/${f}` }])) };
  return makePack(groups, REGULATION_ENTRY, doc);
}

describe('the opening\'s pose and pictures', () => {
  test('film second t: the canvas size on the root, the entry clip, and the loop on the entry layer it switches on', () => {
    const pack = synthPack();
    const prefab = pack.doc.prefabs[ENTRY_PREFAB];
    const layer = resolvePath(prefab, 'canvas_front/entry_anim_season_on');
    const card = resolvePath(layer, 'card');
    const p0 = regulationPose(pack, 0.5, 1422, 720);
    assert.deepEqual(p0.size.get(prefab), [1422, 720]);
    assert.equal(p0.active.get(layer), true);
    assert.equal(p0.color.get(card).a, 0.5, 'the loop runs under the layer');
    const box = layoutPrefab(prefab, { pose: p0, skip: (n) => !!n.fx }).box;
    assert.equal(box.w, 1422);
    // the card's rect grows with the clip (sizeDelta 0 → 100 over a second), around its centre
    const cardBox = box.children[1].children[0].children[0];
    assert.equal(Math.round(cardBox.w), 50);
    const end = regulationPose(pack, REG_END, 1280, 720);
    assert.equal(end.active.get(layer), false);
    assert.equal(end.color.get(prefab.children[0]).a, 0);
    assert.ok(REG_END > pack.doc.clips[ENTRY_CLIP].len && REG_SPAN.fadeAt >= pack.doc.clips[ENTRY_CLIP].len);
  });

  test('the pictures to preload: every sprite and effect texture once, from the group', () => {
    const urls = regulationPictures(synthPack());
    assert.deepEqual(urls.sort(), [
      `/assets/local/${REGULATION_ENTRY}/sprites/entry_id_card_frame.webp`,
      `/assets/local/${REGULATION_ENTRY}/sprites/tex_entry_num_sheet.webp`,
    ]);
  });
});

// ---- the stage on a stand-in DOM -------------------------------------------------------------------------------------
class Style {
  constructor() { this.props = {}; }
  setProperty(k, v) { if (v === '') delete this.props[k]; else this.props[k] = v; }
}
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.attrs = {}; this.className = ''; this.style = new Style(); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { if (k === 'style') this.style = new Style(); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
}

describe('the frame-by-frame stage', () => {
  test('each frame lays the prefab out again: hidden nodes go, boxes move, a graphic is restyled only when its colour changes', async () => {
    globalThis.document = { createElement: (tag) => new El(tag) };
    try {
      const { createStage } = await import('../../public/js/ui/prefab/stage.js');
      const pack = synthPack();
      const host = new El('div');
      const stage = createStage(host, { pack, prefab: pack.doc.prefabs[ENTRY_PREFAB] });
      const all = [];
      (function walk(e) { for (const c of e.children) { if (c.attrs['data-n'] != null) all.push(c); walk(c); } })(stage.root);
      const el = (name) => all.find((e) => e.attrs['data-n'] === name);
      assert.equal(el('dust'), undefined, 'particle holders are not drawn');
      stage.draw(regulationPose(pack, 0.5, 1280, 720));
      assert.equal(el('card').style.display, '');
      assert.equal(el('card').style.props.width, '0.5rem');
      const g = el('card').children[0];
      assert.equal(g.className, 'pf__g');
      assert.equal(g.style.opacity, '0.5');
      const num = el('num').children[0];
      assert.equal(num.style.backgroundPosition, '0% 0%');
      stage.draw(regulationPose(pack, 0.9, 1280, 720));
      assert.equal(el('card').children[0], g);
      assert.equal(g.style.opacity, '0.5', 'same colour: not restyled');
      assert.notEqual(el('card').style.props.width, '0.5rem');
      stage.draw(regulationPose(pack, REG_END, 1280, 720));
      assert.equal(el('card').style.display, 'none', 'the entry layer is off at the end');
      assert.equal(el('cover_black_in').children[0].style.display, 'none', 'a transparent graphic is not drawn');
      stage.destroy();
      assert.equal(host.children.length, 0);
    } finally {
      delete globalThis.document;
    }
  });
});

const GROUP = new URL(`../../public/assets/local/${REGULATION_ENTRY}/prefabs.json`, import.meta.url);
describe('the extracted opening (local; skipped without it)', { skip: !existsSync(GROUP) && 'no extracted ui/season/act3autochess/entry' }, () => {
  test('the clip leaves the season ground and the title art; the cards show A01–A04; the counter ends on 1 0 0', () => {
    const doc = JSON.parse(readFileSync(GROUP, 'utf8'));
    const groups = { [REGULATION_ENTRY]: { 'prefabs.json': { path: '/x' } } };
    const pack = makePack(groups, REGULATION_ENTRY, doc);
    const prefab = doc.prefabs[ENTRY_PREFAB];
    assert.equal(resolvePath(prefab, 'canvas_center'), null, 'the season screen\'s buttons are left out');
    assert.equal(doc.clips[ENTRY_CLIP].len, 3.1667);
    const end = regulationPose(pack, REG_END, 1280, 720);
    const box = layoutPrefab(prefab, { pose: end, skip: (n) => !!n.fx }).box;
    const names = [];
    (function walk(b) { if (b.alpha > 0) { names.push(b.node.name); for (const c of b.children) walk(c); } })(box);
    for (const n of ['bkg_1', 'bkg_2', 'bg_front', 'title_season_on']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('entry_anim_season_on'));
    const frameOf = (path) => {
      const node = resolvePath(prefab, path);
      const st = sheetStyle(node.image, end.color.get(node) || null, () => '/t');
      return st?.maskPosition || st?.backgroundPosition;
    };
    const cards = [1, 2, 3, 4].map((i) => frameOf(`canvas_front/entry_anim_season_on/part_1/id_card_0${i}/root/img_code`));
    assert.deepEqual(cards, ['0% 0%', '0% 12.5%', '0% 25%', '0% 37.5%']);
    const at = regulationPose(pack, 1.12, 1280, 720);
    const digit = (n) => {
      const node = resolvePath(prefab, `canvas_front/entry_anim_season_on/part_1/root_screen/loading_count/num_layout/${n}`);
      return sheetStyle(node.image, at.color.get(node) || null, () => '/t').backgroundPosition;
    };
    assert.deepEqual(['num1', 'num2', 'num3'].map(digit), ['25% 0%', '0% 0%', '0% 0%']);
  });
});
