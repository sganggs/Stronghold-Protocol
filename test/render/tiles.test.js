// test/render/tiles.test.js — pure parts of the tile renderer: stage parsing (glyph legend, heights, bands,
// margin fading, scenery rows), style helpers. Importing render/tiles.js must not need PIXI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStage, mixColor } from '../../public/js/render/tiles.js';
import { GLYPH, TILE_H, dmgStyleKey, STATUS_ICON, PROJ } from '../../public/js/render/style.js';
import { STATUS_KEYS } from '../../public/js/render/textures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));

describe('parseStage', () => {
  test('every data stage parses into a 19×21 grid with known materials and sane heights', () => {
    for (const [id, st] of Object.entries(stages)) {
      const g = parseStage(st);
      assert.equal(g.length, 19, id);
      for (const row of g) {
        assert.equal(row.length, 21, id);
        for (const t of row) {
          assert.ok(typeof t.mat === 'string' && t.mat, `${id} ${t.r},${t.c} mat`);
          // water is a shallow depression (tiles.js WATER_DEPTH): every other tile sits on the road
          assert.ok(Number.isFinite(t.h) && t.h >= -1.5 && t.h <= 1, `${id} height`);
          if (t.water) assert.ok(t.h < 0, `${id} ${t.r},${t.c}: water is sunk`);
          assert.ok(t.alpha > 0 && t.alpha <= 1);
        }
      }
      // the own board is always drawn and playable; hand slots are raised benches (the escaped levels' two maps, kind
      // 'unite', have no bench: nobody prepares on them)
      for (let r = 9; r <= 12; r++) for (let c = 3; c <= 8; c++) assert.ok(g[r][c].drawn, `${id} board ${r},${c}`);
      for (let c = 0; c < 10; c++) {
        if (st.kind === 'unite') { assert.equal(g[7][c].glyph, '#', `${id} no hand ${c}`); continue; }
        assert.equal(g[7][c].glyph, 'a', `${id} hand ${c}`);
        assert.equal(g[7][c].h, TILE_H.bench);
      }
      assert.equal(g[9][2].glyph, 'E', `${id} objective`);
    }
  });

  test('glyph legend: heights and materials follow DATA.md §12', () => {
    const st = stages.act2autochess_m02;
    const g = parseStage(st);
    const find = (glyph) => g.flat().find((t) => t.glyph === glyph);
    assert.equal(find('h').h, TILE_H.wall);
    assert.equal(find('h').mat, 'wall');
    assert.equal(find('X').h, TILE_H.sep);
    assert.equal(find('m').mat, 'mire');
    assert.equal(find('m').h, 0);
    assert.equal(find('S').mat, 'start');
    assert.equal(find('E').mat, 'end');
    for (const [glyph, def] of Object.entries(GLYPH)) assert.ok(def.mat, glyph);
  });

  test('bands: rows outside the band are not drawn; pen rows are scenery; far margins skipped', () => {
    const st = stages.act2autochess_m01;
    const field = parseStage(st, [6, 18]);
    for (let c = 0; c < 21; c++) for (let r = 0; r <= 5; r++) assert.equal(field[r][c].drawn, false, `boss rows hidden ${r},${c}`);
    assert.ok(field[15][7].scenery && field[15][7].drawn, 'pen gate drawn as scenery');
    assert.equal(field[15][7].playable, false);
    const boss = parseStage(st, [0, 6]);
    for (let r = 7; r <= 18; r++) for (let c = 0; c < 21; c++) assert.equal(boss[r][c].drawn, false);
    assert.ok(boss[2][2].drawn && boss[2][2].glyph === 'E');
    // margin '#' far from anything playable fades then disappears
    const full = parseStage(st);
    const margin = full.flat().filter((t) => t.glyph === '#' && t.drawn && t.dist === 2);
    assert.ok(margin.length > 0 && margin.every((t) => t.alpha < 1 && t.mat === 'margin'));
  });

  test('junk / missing stage data never throws', () => {
    for (const bad of [null, undefined, {}, { rows: 'x' }, { rows: [null, 42, 'zz??'] }, { rows: Array(19).fill('Q'.repeat(21)), tiles: { Q: { tileKey: 'tile_road', height: 'LOW' } } }]) {
      const g = parseStage(bad);
      assert.equal(g.length, 19);
      assert.equal(g[0].length, 21);
    }
    const q = parseStage({ rows: Array(19).fill('Q'.repeat(21)), tiles: { Q: { tileKey: 'tile_road', height: 'LOW' } } });
    assert.equal(q[10][5].glyph, 'r', 'unknown glyph mapped through its tileKey');
  });
});

describe('style helpers', () => {
  test('damage style keys and status icons', () => {
    assert.equal(dmgStyleKey('phys'), 'phys');
    assert.equal(dmgStyleKey('arts'), 'arts');
    assert.equal(dmgStyleKey('true'), 'true');
    assert.equal(dmgStyleKey('burn'), 'elem');
    assert.equal(dmgStyleKey('necrosis'), 'elem');
    assert.equal(dmgStyleKey('???'), 'phys');
    for (const k of Object.values(STATUS_ICON)) assert.ok(STATUS_KEYS.includes(k), `status icon ${k} drawn in the atlas`);
    for (const p of Object.values(PROJ)) assert.ok(p.speed > 0 && p.width > 0);
  });

  test('mixColor', () => {
    assert.equal(mixColor(0x000000, 0xffffff, 0), 0x000000);
    assert.equal(mixColor(0x000000, 0xffffff, 1), 0xffffff);
    assert.equal(mixColor(0xff0000, 0x0000ff, 0.5), 0x800080);
    assert.equal(mixColor(0x123456, 0x654321, -5), 0x123456);
  });
});

describe('TileField external board (the 3D board layer draws the tiles)', () => {
  test('external mode builds no Pixi board, keeps heights / levels / highlights; switching back rebuilds the 2D board', async () => {
    const { installFakePixi } = await import('./fakepixi.js');
    const fake = installFakePixi();
    try {
      const P = globalThis.PIXI;
      // minimal mesh stack for the 2D board (not part of the shared fake)
      P.Buffer = class { constructor(data) { this.data = data; } update() {} };
      P.Geometry = class { addAttribute() { return this; } addIndex() { return this; } };
      P.Shader = { from: (v, f, u) => ({ uniforms: { ...u } }) };
      P.Mesh = class extends P.Container { constructor(g, s) { super(); this.geometry = g; this.shader = s; } };
      P.BLEND_MODES = { ADD: 1, NORMAL: 0 };
      const { TileField } = await import('../../public/js/render/tiles.js');
      const layers = { ground: new P.Container(), overlay: new P.Container(), props: new P.Container(), anim: new P.Container() };
      for (const l of Object.values(layers)) l.addChild = function (...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } return kids[0]; };
      const f = new TileField(layers);
      f.setView([6, 18], { r0: 7, r1: 12, c0: 0, c1: 10 }, [6, 13]);
      f.setExternal(true);
      f.setStage(stages.act2autochess_m01);
      assert.equal(f.meshes.length, 0, 'no board meshes');
      assert.equal(f.rowMeshes.size, 0);
      assert.equal(f.animSprites.length, 0);
      assert.equal(f.boxes.length, 0);
      assert.equal(f.surfaceLayer(10), null, 'units on raised tops use their ground layer');
      assert.equal(f.heightAt(10, 4), TILE_H.wall, 'high ground height still known (units / picking)');
      assert.ok(f.levels.includes(TILE_H.wall) && f.levels.includes(0));
      assert.ok(f.blowers.length > 0, 'blower airflow streaks stay in Pixi');
      f.setHighlights([[10, 5]], 'legal');
      assert.equal(f.highlights.size, 1);
      f.setExternal(false);
      assert.ok(f.meshes.length > 0 && f.rowMeshes.size > 0, '2D board rebuilt');
      assert.ok(f.boxes.length > 0, 'gate boxes back');
      f.setExternal(true);
      assert.equal(f.meshes.length, 0);
      f.destroy();
    } finally {
      fake.restore();
    }
  });
});
