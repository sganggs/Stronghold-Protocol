// Spine 3.8 binary skeleton (.skel) inspection in Node, using the same parser
// the client ships (@pixi-spine/runtime-3.8, a dependency of pixi-spine).
//
// We only need metadata: animation names + durations, event names, the times
// of `OnAttack` events per animation (hit timing, research 07 §5.4) and the
// skeleton bounds. Attachments are created without textures, so no atlas or
// canvas is needed; attachment paths are checked against the atlas region names
// to detect mismatched downloads.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));

let runtime = null;
/**
 * Lazily load @pixi-spine/runtime-3.8.
 * @returns {any} the runtime module
 * @throws when pixi-spine is not installed (run `npm install`)
 */
function loadRuntime() {
  if (runtime) return runtime;
  runtime = require('@pixi-spine/runtime-3.8');
  return runtime;
}

/**
 * True when the Spine parser can be loaded.
 * @returns {boolean}
 */
export function skelParserAvailable() {
  try { loadRuntime(); return true; } catch { return false; }
}

function makeLoader(r, regions, missing) {
  const check = (path) => { if (regions && !regions.has(path)) missing.add(path); };
  return {
    newRegionAttachment(skin, name, path) { check(path); return new r.RegionAttachment(name); },
    newMeshAttachment(skin, name, path) { check(path); return new r.MeshAttachment(name); },
    newBoundingBoxAttachment(skin, name) { return new r.BoundingBoxAttachment(name); },
    newPathAttachment(skin, name) { return new r.PathAttachment(name); },
    newPointAttachment(skin, name) { return new r.PointAttachment(name); },
    newClippingAttachment(skin, name) { return new r.ClippingAttachment(name); },
  };
}

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;

// [ASSUMED] Counts a hostile .skel can set far above the bytes that follow. setArraySize and `new Array(n)` run
// before the read, so a 2^24 skin count allocates. These caps sit above the installed skeletons (581 bones, 360
// slots, 3 skins, 186 vertices, float arrays of 372) and below 2^24. The per-vertex weight count of a weighted
// mesh is not capped: that loop pushes until the bytes run out.
const SPINE_CAP = { bones: 4096, slots: 4096, array: 4096, vertices: 4096, floats: 8192, shorts: 16384 };

function spineCountError(kind, n, cap) {
  return new Error(`Spine ${kind} count ${n} exceeds ${cap}`);
}

/**
 * Bone and slot counts from the Spine 3.8 header. Returns an oversize record, or null when the counts fit or the
 * walk cannot be trusted (a throw is the caller's signal to let the parser and the allocation guards decide).
 * @param {Uint8Array} bytes
 * @returns {{ kind: string, n: number, cap: number } | null}
 */
function spineHeaderOversize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let index = 0;
  const need = (n) => { if (index + n > bytes.byteLength) throw new Error('truncated'); };
  const vi = () => {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      need(1);
      const b = view.getUint8(index);
      index += 1;
      result |= (b & 127) << shift;
      if ((b & 128) === 0) return result >>> 0;
      shift += 7;
    }
    throw new Error('varint');
  };
  const skipStr = () => {
    const n = vi();
    if (n === 0 || n === 1) return;
    const count = n - 1;
    need(count);
    index += count;
  };
  skipStr();
  skipStr();
  need(16);
  index += 16;
  need(1);
  const nonessential = view.getUint8(index) !== 0;
  index += 1;
  if (nonessential) {
    need(4);
    index += 4;
    skipStr();
    skipStr();
  }
  const strings = vi();
  if (strings > 65536) return null;
  for (let i = 0; i < strings; i++) skipStr();
  const bones = vi();
  if (bones > SPINE_CAP.bones) return { kind: 'bone', n: bones, cap: SPINE_CAP.bones };
  for (let i = 0; i < bones; i++) {
    skipStr();
    if (i !== 0) vi();
    need(32);
    index += 32;
    vi();
    need(1);
    index += 1;
    if (nonessential) { need(4); index += 4; }
  }
  const slots = vi();
  if (slots > SPINE_CAP.slots) return { kind: 'slot', n: slots, cap: SPINE_CAP.slots };
  return null;
}

let guardDepth = 0;
/** @type {null | { utils: any, proto: any, setArraySize: Function, newArray: Function, newFloatArray: Function, readFloatArray: Function, readShortArray: Function, readVertices: Function }} */
let guardSaved = null;

function guardSpineCounts(runtime) {
  const base = require('@pixi-spine/base');
  const Utils = base.Utils;
  const proto = runtime.SkeletonBinary.prototype;
  if (guardDepth === 0) {
    guardSaved = {
      utils: Utils,
      proto,
      setArraySize: Utils.setArraySize,
      newArray: Utils.newArray,
      newFloatArray: Utils.newFloatArray,
      readFloatArray: proto.readFloatArray,
      readShortArray: proto.readShortArray,
      readVertices: proto.readVertices,
    };
    const saved = guardSaved;
    Utils.setArraySize = function setArraySize(array, size, value) {
      if (typeof size === 'number' && size > SPINE_CAP.array) throw spineCountError('skin', size, SPINE_CAP.array);
      return saved.setArraySize.call(this, array, size, value);
    };
    Utils.newArray = function newArray(size, defaultValue) {
      if (typeof size === 'number' && size > SPINE_CAP.array) throw spineCountError('array', size, SPINE_CAP.array);
      return saved.newArray.call(this, size, defaultValue);
    };
    Utils.newFloatArray = function newFloatArray(size) {
      if (typeof size === 'number' && size > SPINE_CAP.floats) throw spineCountError('float', size, SPINE_CAP.floats);
      return saved.newFloatArray.call(this, size);
    };
    proto.readFloatArray = function readFloatArray(input, n, scale) {
      if (typeof n === 'number' && n > SPINE_CAP.floats) throw spineCountError('float', n, SPINE_CAP.floats);
      return saved.readFloatArray.call(this, input, n, scale);
    };
    proto.readShortArray = function readShortArray(input) {
      const n = input.readInt(true);
      if (n > SPINE_CAP.shorts) throw spineCountError('triangle', n, SPINE_CAP.shorts);
      const array = new Array(n);
      for (let i = 0; i < n; i++) array[i] = input.readShort();
      return array;
    };
    proto.readVertices = function readVertices(input, vertexCount) {
      if (typeof vertexCount === 'number' && vertexCount > SPINE_CAP.vertices) throw spineCountError('vertex', vertexCount, SPINE_CAP.vertices);
      return saved.readVertices.call(this, input, vertexCount);
    };
  }
  guardDepth += 1;
}

function unguardSpineCounts() {
  if (guardDepth === 0) return;
  guardDepth -= 1;
  if (guardDepth > 0 || !guardSaved) return;
  const saved = guardSaved;
  saved.utils.setArraySize = saved.setArraySize;
  saved.utils.newArray = saved.newArray;
  saved.utils.newFloatArray = saved.newFloatArray;
  saved.proto.readFloatArray = saved.readFloatArray;
  saved.proto.readShortArray = saved.readShortArray;
  saved.proto.readVertices = saved.readVertices;
  guardSaved = null;
}

/**
 * @typedef {{ version: string, animations: string[], durations: Record<string, number>,
 *   events: string[], hits: Record<string, number[]>, bounds: {x:number,y:number,width:number,height:number}|null,
 *   missingRegions: string[] }} SkelInfo
 */

/**
 * Parse a Spine 3.8 binary skeleton.
 * @param {Uint8Array} bytes .skel file contents
 * @param {Set<string>} [atlasRegions] region names of the matching atlas (optional, for validation)
 * @returns {SkelInfo}
 * @throws on malformed data
 */
export function parseSkel(bytes, atlasRegions) {
  const r = loadRuntime();
  const missing = new Set();
  const bin = new r.SkeletonBinary(makeLoader(r, atlasRegions, missing));
  // the runtime reads `bytes.buffer` from its start (BinaryInput: new DataView(data.buffer)), so a view into a larger
  // buffer — a small file fs.readFileSync took from Node's buffer pool — is copied into one of its own first
  const own = bytes instanceof Uint8Array && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  const raw = own ? bytes : new Uint8Array(bytes);
  let over;
  try { over = spineHeaderOversize(raw); } catch { over = null; }
  if (over) throw spineCountError(over.kind, over.n, over.cap);
  guardSpineCounts(r);
  let data;
  try {
    data = bin.readSkeletonData(raw);
  } finally {
    unguardSpineCounts();
  }
  const animations = data.animations.map((a) => a.name);
  const durations = {};
  const hits = {};
  for (const a of data.animations) {
    durations[a.name] = round3(a.duration);
    for (const t of a.timelines) {
      if (!t || !Array.isArray(t.events)) continue;
      for (const e of t.events) {
        const nm = e?.data?.name;
        if (typeof nm === 'string' && /^onattack$/i.test(nm)) {
          (hits[a.name] ||= []).push(round3(e.time));
        }
      }
    }
    if (hits[a.name]) hits[a.name].sort((x, y) => x - y);
  }
  const w = Number(data.width); const h = Number(data.height);
  const bounds = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    ? { x: round3(data.x), y: round3(data.y), width: round3(w), height: round3(h) }
    : null;
  return {
    version: String(data.version ?? ''),
    animations,
    durations,
    events: data.events.map((e) => e.name),
    hits,
    bounds,
    missingRegions: [...missing].sort(),
  };
}
