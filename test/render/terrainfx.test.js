import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainFx, TERRAIN_EFFECTS } from '../../public/js/render/vfx/terrainfx.js';

test('map effects retain pending fallbacks, avoid recreating steady loops and cancel on area/quality changes', () => {
  const spawned = [], killed = [], grounds = [];
  const ofx = {active:true, tier:'full', lib:{has:()=>true}, update(){}, clear(){},
    setGround(heightAt, key){grounds.push({heightAt,key});},
    spawn(key, place, opts) { const handle = {effect:null, kill(){killed.push(key);}};
      spawned.push({key,place,opts,handle}); return handle; }};
  const board = {official:{key:'map-9'},stage:{arena:{}},stageKey:'map-9',areaKey:'left',
    board:{grid:[[{drawn:true,glyph:'w',h:0},{drawn:false,glyph:'w',h:0.7}],
      [{drawn:true,glyph:'H',h:0.4}]]},
    setNativeTerrain(glyphs){this.shown=[...glyphs];}};
  const terrain = new TerrainFx(ofx);
  terrain.update(board, 0.1);
  assert.equal(spawned.length,1);
  assert.equal(grounds[0].heightAt(1,0),0.4,'the raised bench occludes the road effect');
  assert.equal(grounds[0].heightAt(0,1),0,'hidden board parts do not occlude');
  assert.equal(grounds[0].heightAt(50,50),0);
  assert.deepEqual(spawned[0].place.pos,[-10,-9,-0]);
  assert.deepEqual(board.shown,[], 'the fallback remains during resource loading');
  spawned[0].handle.effect = {done:false};
  terrain.update(board,0.1);
  assert.deepEqual(board.shown,['w']);
  assert.equal(spawned.length,1,'steady frames do not recreate loops');
  assert.equal(grounds.length,1,'steady frames reuse the depth geometry');
  board.areaKey = 'right'; terrain.update(board,0.1);
  assert.equal(grounds.length,2,'a new visible area refreshes the depth geometry');
  assert.equal(killed.length,1,'camera change cancels old handles, including late resource arrivals');
  ofx.active = false; terrain.update(board,0.1);
  assert.deepEqual(board.shown,[]);
  assert.equal(killed.length,2);
});

test('a missing original effect does not hide its fallback or create a pending loop', () => {
  let spawned=0;
  const fx = new TerrainFx({active:true,tier:'lite',lib:{has:()=>false},clear(){},setGround(){},update(){},spawn(){spawned++;}});
  const board={official:{key:'missing'},stage:{arena:{}},stageKey:'missing',areaKey:'a',board:{grid:[[{glyph:'m',drawn:true,h:0}]]},
    setNativeTerrain(s){assert.equal(s.size,0);}};
  fx.update(board,0.1); assert.equal(spawned,0);
  fx.update(null,0.1);
});

test('only the three sourced terrain kinds have native loops; no guessed dash or teleport particles', () => {
  assert.deepEqual(Object.keys(TERRAIN_EFFECTS).sort(), ['i', 'm', 'w']);
});

test('fresh pieces use authored highland depth, old or invalid metadata keeps the board approximation', () => {
  let sample;
  const ofx={active:true,tier:'full',lib:{has:()=>false},clear(){},update(){},setGround(f){sample=f;}};
  const board={stageKey:'map',areaKey:'a',stage:{arena:{},scenePiece:{group:'sub_01'}},
    official:{doc:{tileDepthHeights:{sub_01:0.4}}},board:{grid:[[{glyph:'a',drawn:true,h:0.16},{glyph:'h',drawn:true,h:0.42},{glyph:'a',drawn:false,h:0.16}]]}};
  const terrain=new TerrainFx(ofx);terrain.update(board,0.1);
  assert.equal(sample(0,0),0.4);assert.equal(sample(0,1),0.4);assert.equal(sample(0,2),0);
  board.official.doc.tileDepthHeights.sub_01=Infinity;terrain.update(board,0.1);
  assert.equal(sample(0,0),0.16);
});
