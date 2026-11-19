import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCENE_BIN_PART_BYTES, SCENE_TRANSPORT_LIMITS, sceneBinParts, readSceneBuffer } from '../../public/js/render/board3d/sceneTransport.js';

const documentOf = sizes => ({ binBytes:sizes.reduce((a,b)=>a+b,0), binParts:sizes });

test('variable part counts use one destination and write each part before requesting the next', async () => {
  const doc=documentOf(Array(12).fill(2)), events=[], allocations=[];
  const Native=globalThis.Uint8Array;
  globalThis.Uint8Array=class extends Native {
    constructor(value,...args) { super(value,...args); if(typeof value==='number') allocations.push(value); }
    set(source,offset) { events.push(`write:${offset}`); return super.set(source,offset); }
  };
  let index=0;
  try {
    const result=await readSceneBuffer(doc,async key=>{
      assert.equal(key,index?`bin${index}`:'bin');
      if(index) assert.equal(events.at(-1),`write:${(index-1)*2}`);
      events.push(`read:${key}`);
      await Promise.resolve();
      return new Native([index*2,index++*2+1]).buffer;
    });
    assert.deepEqual([...new Native(result)],Array.from({length:24},(_,i)=>i));
    assert.deepEqual(allocations,[24],'allocate the full destination only once');
    assert.equal(events.length,24);
  } finally { globalThis.Uint8Array=Native; }
});

test('validate the complete declaration and policy before allocating or reading', async () => {
  const doc=documentOf([2,3]), bad=[
    null, {}, {...doc,binParts:[]}, {...doc,binParts:[{key:'bin',bytes:2},{key:'bin1',bytes:3}]}, {...doc,binParts:{bin:2,bin1:3}},
    {...doc,binParts:[2,{key:'bin1',bytes:3}]}, {...doc,binParts:[{key:'bin',bytes:2},3]},
    {...doc,binParts:['2',3]}, {...doc,binParts:[null,5]}, {...doc,binParts:[true,4]},
    {...doc,binParts:[[2],3]}, {...doc,binParts:[2,undefined]},
    {...doc,binBytes:6}, {...doc,binBytes:NaN}, {...doc,binBytes:Number.MAX_SAFE_INTEGER+1},
    documentOf([0]), documentOf([-1]), documentOf([1.5]), documentOf([SCENE_BIN_PART_BYTES+1]),
    documentOf([SCENE_TRANSPORT_LIMITS.maxBytes]), documentOf(Array(SCENE_TRANSPORT_LIMITS.maxParts+1).fill(1)),
    documentOf([SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES,1]),
  ];
  let reads=0,allocations=0;
  const Native=globalThis.Uint8Array;
  globalThis.Uint8Array=class extends Native { constructor(...args) { super(...args); allocations++; } };
  try {
    for(const value of bad) {
      assert.equal(sceneBinParts(value),null);
      assert.equal(await readSceneBuffer(value,()=>{reads++;return null;}),null);
    }
    for(const limits of [{maxBytes:4,maxParts:256},{maxBytes:60,maxParts:1},{maxBytes:Infinity,maxParts:256},{maxBytes:60,maxParts:0}]) {
      assert.equal(await readSceneBuffer(doc,()=>{reads++;return null;},limits),null);
    }
    assert.equal(reads,0);assert.equal(allocations,0);
  } finally { globalThis.Uint8Array=Native; }
  assert.ok(sceneBinParts(documentOf([SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES,SCENE_BIN_PART_BYTES])));
  assert.ok(sceneBinParts(documentOf(Array(SCENE_TRANSPORT_LIMITS.maxParts).fill(1))));
  assert.ok(sceneBinParts(documentOf([1])),'one declared part is also valid');
});

test('a failed or wrongly sized part stops immediately and discards the partial result', async () => {
  const doc=documentOf([2,2,2]);
  for(const failure of [null,new ArrayBuffer(1),new ArrayBuffer(3),new Uint8Array(2),'reject']) {
    let reads=0;
    const result=await readSceneBuffer(doc,async()=>{
      if(reads++===1) { if(failure==='reject') throw new Error('network'); return failure; }
      return new ArrayBuffer(2);
    });
    assert.equal(result,null);assert.equal(reads,2);
  }
  assert.deepEqual([...new Uint8Array(await readSceneBuffer(doc,()=>new Uint8Array([7,8]).buffer))],[7,8,7,8,7,8]);
});

test('allocation failure falls back before any part request', async () => {
  const Native=globalThis.Uint8Array;let reads=0;
  globalThis.Uint8Array=class { constructor() { throw new RangeError('allocation failed'); } };
  try { assert.equal(await readSceneBuffer(documentOf([1,1]),()=>{reads++;}),null);assert.equal(reads,0); }
  finally { globalThis.Uint8Array=Native; }
});

const tool=fileURLToPath(new URL('../../tools/local-extract',import.meta.url));
const python=['python3','python'].find(bin=>spawnSync(bin,['--version']).status===0);
test('Python writer supports more than four parts and matches browser policy', {skip:!python},()=>{
  const result=spawnSync(python,['-I','-B','-c',`import sys,json,tempfile,hashlib
from pathlib import Path
sys.path.insert(0,${JSON.stringify(tool)})
import scene_transport as s
with tempfile.TemporaryDirectory() as tmp:
 folder=Path(tmp)
 raw=bytes(range(251))
 parts=s.write_scene_bins(folder,raw,part_bytes=20)
 joined=b''.join((folder/p['name']).read_bytes() for p in parts)
 rejected=[]
 for opts in ({'part_bytes':0},{'part_bytes':True},{'part_bytes':15000001},{'max_bytes':250},{'part_bytes':1,'max_parts':250}):
  before=sorted(p.name for p in folder.iterdir())
  try: s.write_scene_bins(folder,raw,**opts);rejected.append(False)
  except ValueError: rejected.append(before==sorted(p.name for p in folder.iterdir()))
 print(json.dumps({'parts':parts,'same':hashlib.sha256(joined).digest()==hashlib.sha256(raw).digest(),
  'rejected':rejected,'limits':[s.SCENE_BIN_PART_BYTES,s.SCENE_BIN_MAX_BYTES,s.SCENE_BIN_MAX_PARTS]}))`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const out=JSON.parse(result.stdout);
  assert.equal(out.parts.length,13);assert.equal(out.parts[10].key,'bin10');assert.equal(out.parts[12].bytes,11);
  assert.equal(out.same,true);assert.deepEqual(out.rejected,[true,true,true,true,true]);
  assert.deepEqual(out.limits,[SCENE_BIN_PART_BYTES,SCENE_TRANSPORT_LIMITS.maxBytes,SCENE_TRANSPORT_LIMITS.maxParts]);
});
