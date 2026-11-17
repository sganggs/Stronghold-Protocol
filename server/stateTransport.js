// Connection-local baselines. Snapshot and diff encoding are shared only for the SAME message/baseline objects,
// never across players' private views. Weak maps release disconnected sockets and superseded snapshots.
//
// Every frame a connection is given — full or delta — carries a fresh number from that connection's own counter, so
// the sequence only moves forward: a re-sent snapshot must not hand out an older number than the frames before it, and
// a full frame is always ahead of what came before it. The receiver keys its baseline on those numbers.
import { diffState, isStateKind, STATE_DELTA_VERSION } from '../shared/stateDelta.js';

/**
 * The channels this build compresses. Only the public view for now: it is the frame every member of a room receives, so
 * a client that cannot apply one loses nothing it cannot get back from the next full frame, while m.private is per
 * player and gets its opt-in only after the round-trip is proven in a whole match.
 */
export const DELTA_KINDS = new Set(['m.public']);

const connections = new WeakMap();   // ws -> { seq, kinds: Map<kind, { snapshot, seq }> }
const snapshots = new WeakMap();     // msg -> { encoded, view, patches: WeakMap<previousSnapshot, opsJson | false> }

const fullFrame = (kind, seq, encoded) =>
  `{"t":"m.state","kind":${JSON.stringify(kind)},"seq":${seq},"full":${encoded}}`;

export function negotiateStateDelta(ws, version) {
  const enabled = version === STATE_DELTA_VERSION;
  const old = connections.get(ws);
  // A repeated hello keeps the baseline it already has: dropping it would turn the next frame into a full one for no
  // reason, and the client would have to decode a full frame it did not need.
  if (enabled) { if (!old) connections.set(ws, { seq: 0, kinds: new Map() }); return; }
  connections.delete(ws);
}

/** The already negotiated capability, for an internal identity handover on the same socket. */
export function stateDeltaVersion(ws) { return connections.has(ws) ? STATE_DELTA_VERSION : undefined; }

/** Forget the baselines (a new negotiation, or a client that asked for a full resync). The counter never rewinds. */
export function resetStateDelta(ws) { connections.get(ws)?.kinds.clear(); }

/** Keep negotiation and sequence, but never carry a previous room's state into a new room. */
export function setStateDeltaRoom(ws, roomCode) {
  const connection = connections.get(ws);
  if (!connection || connection.roomCode === roomCode) return;
  connection.roomCode = roomCode;
  connection.kinds.clear();
}

/** Return an encoded state and commit its baseline ONLY after the caller successfully queues the reliable frame.
 * `usable: false` means the given bytes cannot be a baseline (they are not a JSON object) and the caller should send a
 * full frame it encoded itself; this connection keeps the baseline it already had. */
export function prepareStateFrame(ws, msg, encoded) {
  const connection = connections.get(ws);
  if (!connection || !isStateKind(msg?.t) || !DELTA_KINDS.has(msg.t)) return { data: encoded, commit() {}, usable: true };
  let snapshot = snapshots.get(msg);
  // The encoding, not mutable game objects, owns this immutable baseline.
  if (!snapshot || snapshot.encoded !== encoded) {
    let view;
    // Bytes a caller pre-encoded (a lane worker) can be anything: never throw out of the send path because of them.
    try { view = JSON.parse(encoded); } catch { view = null; }
    if (view === null || typeof view !== 'object' || Array.isArray(view)) {
      return { data: encoded, commit() {}, usable: false };
    }
    snapshot = { encoded, view, patches: new WeakMap() };
    snapshots.set(msg, snapshot);
  }
  const previous = connection.kinds.get(msg.t);
  const seq = ++connection.seq;
  let data = fullFrame(msg.t, seq, encoded);
  if (previous && previous.snapshot !== snapshot) {
    // The patch is content-only, so it is shared between connections; the sequence numbers are not.
    let patch = snapshot.patches.get(previous.snapshot);
    if (patch === undefined) {
      const ops = diffState(previous.snapshot.view, snapshot.view);
      patch = ops ? JSON.stringify(ops) : false;
      snapshot.patches.set(previous.snapshot, patch);
    }
    if (patch) {
      const delta = `{"t":"m.state","kind":${JSON.stringify(msg.t)},"seq":${seq},"base":${previous.seq},"patch":${patch}}`;
      // Compare actual UTF-8 bytes, not JS string length. Large changes fall back to full.
      if (Buffer.byteLength(delta) < Buffer.byteLength(data)) data = delta;
    }
  }
  return { data, commit() { connection.kinds.set(msg.t, { snapshot, seq }); }, usable: true };
}
