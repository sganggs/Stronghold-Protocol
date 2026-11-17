// Opt-in state-delta v1. Only m.public / m.private use this transport; all other messages keep their wire format.
// Arrays of equal length are patched by index. Length/type changes replace the subtree (no splice ambiguity).
// Applying a patch is copy-on-write: already emitted views are never changed.
export const STATE_DELTA_VERSION = 1;
export const isStateKind = (kind) => kind === 'm.public' || kind === 'm.private';
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeKey = (k) => typeof k === 'string' && !['__proto__', 'prototype', 'constructor'].includes(k);
const MAX_OPS = 4096;
const MAX_DEPTH = 64;

/** Diff JSON values. null means use a full frame instead. Ops: [path, value] sets; [path] deletes an object key. */
export function diffState(before, after) {
  const ops = [], path = [];
  let overflow = false;
  const emit = (value, remove = false) => {
    if (ops.length >= MAX_OPS || path.length > MAX_DEPTH) { overflow = true; return; }
    ops.push(remove ? [path.slice()] : [path.slice(), value]);
  };
  const child = (key, a, b) => {
    path.push(key);
    walk(a, b);
    path.pop();
  };
  const walk = (a, b) => {
    if (overflow || a === b) return;
    if (path.length > MAX_DEPTH) { overflow = true; return; }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      for (let i = 0; i < b.length && !overflow; i++) child(i, a[i], b[i]);
    } else if (record(a) && record(b)) {
      for (const key of Object.keys(a)) {
        if (!Object.hasOwn(b, key)) {
          if (!safeKey(key)) { overflow = true; return; }
          path.push(key); emit(undefined, true); path.pop();
        }
        if (overflow) return;
      }
      for (const key of Object.keys(b)) {
        if (!safeKey(key)) { overflow = true; return; }
        if (Object.hasOwn(a, key)) child(key, a[key], b[key]);
        else { path.push(key); emit(b[key]); path.pop(); }
        if (overflow) return;
      }
    } else {
      emit(b);
    }
  };
  walk(before, after);
  return overflow ? null : ops;
}

/** Throws on malformed paths/ops; failure cannot mutate the baseline or a previously emitted view. */
export function applyStatePatch(base, ops) {
  if (!Array.isArray(ops) || ops.length > MAX_OPS) throw new Error('bad patch');
  let next = base;
  const update = (node, path, index, op) => {
    const key = path[index];
    const array = Array.isArray(node);
    if (array ? !Number.isInteger(key) || key < 0 || key >= node.length : !record(node) || !safeKey(key)) {
      throw new Error('bad path');
    }
    const copy = array ? node.slice() : { ...node };
    if (index + 1 < path.length) {
      if (!Object.hasOwn(node, key)) throw new Error('missing path');
      copy[key] = update(node[key], path, index + 1, op);
    } else if (op.length === 1) {
      if (array || !Object.hasOwn(node, key)) throw new Error('bad delete');
      delete copy[key];
    } else {
      copy[key] = op[1];
    }
    return copy;
  };
  for (const op of ops) {
    if (!Array.isArray(op) || (op.length !== 1 && op.length !== 2) || !Array.isArray(op[0])
      || !op[0].length || op[0].length > MAX_DEPTH || op[0][0] === 't') throw new Error('bad op');
    next = update(next, op[0], 0, op);
  }
  return next;
}

/** Browser transport decoder. A gap blocks that channel until a full frame; request one coalesced resync. */
export class StateReceiver {
  constructor() {
    this.states = new Map();
    this.missing = new Set();
  }

  reset() { this.states.clear(); this.missing.clear(); }

  /** @returns {{ message: any, resync: boolean }} */
  receive(frame) {
    const { kind, seq } = frame;
    if (!isStateKind(kind)) return { message: null, resync: false };
    const fail = () => {
      this.states.delete(kind);
      const resync = this.missing.size === 0;
      this.missing.add(kind);
      return { message: null, resync };
    };
    if (!Number.isSafeInteger(seq) || seq <= 0) return fail();
    const previous = this.states.get(kind);
    if (previous?.seq === seq) return { message: null, resync: false }; // duplicate, never emit twice
    // A full frame is a baseline only when it is NEWER than the one this channel holds. An older or reordered one
    // would rewind the baseline and make every following delta fail, so it is dropped exactly like a stale delta.
    if (previous && seq < previous.seq) return fail();
    if (Object.hasOwn(frame, 'full')) {
      if (!record(frame.full) || frame.full.t !== kind) return fail();
      this.states.set(kind, { seq, view: frame.full });
      this.missing.delete(kind);
      return { message: frame.full, resync: false };
    }
    if (!previous || frame.base !== previous.seq || seq <= previous.seq) return fail();
    try {
      const view = applyStatePatch(previous.view, frame.patch);
      this.states.set(kind, { seq, view });
      return { message: view, resync: false };
    } catch { return fail(); }
  }
}
