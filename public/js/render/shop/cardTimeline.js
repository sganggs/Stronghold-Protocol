




























export const CARD_CLIPS = {
  card_frozen: { what: 'frozen overlay (dissolve / glow)', loop: false },
  loop_triple: { what: 'triple star sweep: UIRawImageMatAnimWrapper._textureProperty1.offset.y (UV scroll)', loop: true },
  btn_double_check: { what: 'confirm strip: sh grows 24 -> 76 (a height: the stretch children follow)', loop: false, playAutomatically: 0.4333 },
  single_card_refresh: { what: 'shop refresh: root.ay slides the whole card (-203.5708 -> 0)', loop: false },
};


export const clipStats = { calls: 0, hits: 0, misses: 0, last: null };


export function resetClipStats() {
  clipStats.calls = 0;
  clipStats.hits = 0;
  clipStats.misses = 0;
  clipStats.last = null;
}


export function createClipPose() {
  return { ax: null, ay: null, h: null, w: null, alpha: null, scale: null, rot: null, colour: {}, tex: {} };
}


export function resetPoses(records) {
  for (const rec of records) rec.pose = createClipPose();
}





export function hermiteKey(k0, k1, t) {
  const t0 = k0[0];
  const t1 = k1[0];
  const dt = t1 - t0;
  if (!(dt > 0)) return k0[1];
  const u = (t - t0) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;

  const m0 = Number(k0[3] != null ? k0[3] : k0[2]) || 0;
  const m1 = Number(k1[2] != null ? k1[2] : k1[3]) || 0;
  const tangent = (m, j) => (Array.isArray(m) ? Number(m[j]) || 0 : m);
  const left = k0[1];
  const right = k1[1];
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : [left];
    const b = Array.isArray(right) ? right : [right];
    return a.map((av, j) => {
      const bv = Number(b[j] != null ? b[j] : av);
      return h00 * av + h10 * dt * tangent(m0, j) + h01 * bv + h11 * dt * tangent(m1, j);
    });
  }
  return h00 * left + h10 * dt * m0 + h01 * right + h11 * dt * m1;
}

export function sampleKeys(keys, t, hermite) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      if (hermite) return hermiteKey(keys[i - 1], keys[i], t);
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return Array.isArray(v0) ? v0.map((v, j) => v + ((v1[j] ?? v) - v) * u) : v0 + (v1 - v0) * u;
    }
  }
  return keys[keys.length - 1][1];
}


export function clipOf(card, name) {
  return (card && card.clips && card.clips[name]) || null;
}


export function applyClip(records, clip, t, basePath, hermite) {
  clipStats.calls += 1;
  clipStats.last = { t, basePath, curves: (clip && clip.curves || []).length };
  const resolve = (path) => {
    if (!path) return null;
    if (basePath) {
      const joined = records.byPath(`${basePath}/${path}`);
      if (joined) return joined;
    }
    const direct = records.byPath(path);
    if (direct) return direct;

    const suffix = `/${path}`;
    for (const key of records.paths()) {
      if (key === path || key.endsWith(suffix)) return records.byPath(key);
    }
    return null;
  };
  for (const [path, prop, keys] of clip.curves || []) {
    const rec = resolve(path);
    if (!rec) { clipStats.misses += 1; continue; }
    clipStats.hits += 1;
    const v = sampleKeys(keys, t, hermite);
    if (v == null) continue;
    const pose = rec.pose;
    if (prop === 'ax') pose.ax = Number(v);
    else if (prop === 'ay') pose.ay = Number(v);


    else if (prop === 'sh') pose.h = Number(v);
    else if (prop === 'sw') pose.w = Number(v);
    else if (prop === 'alpha') {


      pose.alpha = Number(v);
      rec.group = true;
    }
    else if (prop === 'scale') pose.scale = v;
    else if (prop === 'rot' || prop === 'rz') {


      if (Array.isArray(v)) {
        pose.rot = v.length >= 4 ? (2 * Math.atan2(Number(v[2]) || 0, Number(v[3]) || 0) * 180) / Math.PI : Number(v[2]) || 0;
      } else {
        pose.rot = Number(v);
      }
    }
    else if (/^(img|txt|raw)\.([rgba])$/.test(prop)) {

      const channel = prop.slice(prop.indexOf('.') + 1);
      const index = { r: 0, g: 1, b: 2, a: 3 }[channel];
      pose.colour[channel] = Number(Array.isArray(v) ? v[Math.min(index, v.length - 1)] : v);
    }
    else if (/^tex\.([xy])$/.test(prop)) pose.tex[prop.slice(4)] = Number(v);
  }
}


export function findNode(root, name) {
  if (!root) return null;
  if (root.name === name) return root;
  for (const child of root.children || []) {
    const hit = findNode(child, name);
    if (hit) return hit;
  }
  return null;
}


export function createTimeline(card) {
  const clocks = new Map();
  return {
    play(name, { restart = true } = {}) {
      const clip = clipOf(card, name);
      if (!clip) return 0;
      const prev = clocks.get(name);
      const next = restart || prev == null ? 0 : prev;
      clocks.set(name, next);
      return next;
    },
    stop(name) {
      clocks.delete(name);
    },
    advance(dt) {
      for (const [name, t] of clocks) clocks.set(name, t + (Number(dt) || 0));
    },
    at(name) {
      return clocks.get(name) ?? 0;
    },
    
    sampleTime(name) {
      const clip = clipOf(card, name);
      const t = clocks.get(name) ?? 0;
      const len = Number(clip && clip.len) || 0;
      const wrap = Number((clip && (clip.wrap ?? clip.wrapMode)) || 0);
      if (!(len > 0)) return t;
      return wrap === 2 ? ((t % len) + len) % len : Math.max(0, Math.min(len, t));
    },
    running() {
      return [...clocks.keys()];
    },
  };
}


export function applyCardClips(records, card, opts = {}) {
  const state = opts.state || {};
  const times = opts.times || {};
  const clock = Number(opts.clock) || 0;
  const armClock = Number(opts.armClock) || 0;
  const level = opts.level || {};
  const basePath = (name) => {
    const node = findNode(records.root || {}, name);
    return node ? (node.path || name) : '';
  };
  let cardTime = null;
  if (state.frozen) {
    const clip = clipOf(card, 'card_frozen');
    if (clip) {
      const t = state.still ? clip.len : (times.frozenAt != null ? Math.min(times.frozenAt, clip.len) : Math.min(clock, clip.len));
      applyClip(records, clip, t, basePath('state_fx_frozen'));

      if (times.frozenAt != null) cardTime = t;
    }
  }




  if (state.repeated) {
    const clip = clipOf(card, 'loop_triple');
    if (clip) {
      const t = times.tripleAt != null ? Math.min(times.tripleAt, clip.len)
        : (state.still ? 2.0 : clock % Math.max(0.001, clip.len));
      applyClip(records, clip, t, basePath('state_fx_triple'), true);
      if (times.tripleAt != null) cardTime = t;
    }
  }


  for (const name of [level.frame, level.tierObj]) {
    const sub = name && card.sub && card.sub[name];
    if (!sub) continue;
    for (const [clipName, clip] of Object.entries(sub.clips || {})) {
      if (!/loop_tier_star/.test(clipName)) continue;
      if (!state.still) applyClip(records, clip, clock % Math.max(0.001, clip.len), name);
    }
  }




  if (state.armed) {
    const clip = clipOf(card, 'btn_double_check');
    if (clip) {
      const forced = opts.armTime != null ? Number(opts.armTime) : times.armedAt;
      const t = forced != null ? Math.min(forced, clip.len)
        : (state.still ? clip.len : Math.min(armClock, clip.len));
      applyClip(records, clip, t, basePath('btn_double_check'), true);
    }
  }



  if (state.refresh) {
    const clip = clipOf(card, 'single_card_refresh');
    if (clip) {


      const settled = state.still || times.frozenAt != null;
      const t = times.refreshAt != null ? Math.min(times.refreshAt, clip.len)
        : (settled ? clip.len : Math.min(clock, clip.len));
      applyClip(records, clip, t, '', true);

      if (times.refreshAt != null) cardTime = t;
    }
  }
  return { cardTime };
}

