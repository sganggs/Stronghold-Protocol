




























export const WORLD_TO_PX = 100;

// reference/card/particles.js:12/369: point smoke/star sprites cap at 64 px; the TV emitter is 138 px here
// without this cap, which overexposes the TV and the card (W94/W98).
export const MAX_POINT_PX = 64;
const MAX_QUAD_PX = MAX_POINT_PX;

// reference/card/particles.js:175-177/369: `maxPx` is ParticleSystemRenderer.maxParticleSize in world units
// (100 px each) and falls back to the point cap. The TV spec serializes maxParticleSize 20, so the point cap is
// the 64 px limit W98 hard-coded — derived here the way the reference derives it.
export function pointMaxSize(system, scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const maxPx = Number(system && system.maxPx) > 0 ? Number(system.maxPx) : MAX_POINT_PX;
  return Math.min(MAX_POINT_PX, maxPx * s);
}

// reference/card/particles.js:373: one square size for both axes, clamped between 1 px and the point cap.
export function pointSizeOf(system, particle, scale) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return Math.max(1, Math.min(pointMaxSize(system, s), Number(particle && particle.sizePx) * s));
}

const BURST_EPS = 1e-6;

const COLOR_GAMMA = true;


const QUAD_VERT = `#version 300 es
  in vec2 aPos;
  in vec2 aUV;
  in vec2 aMaskUV;
  in vec4 aColor;
  uniform vec2 uView;
  out vec2 vUV;
  out vec2 vMaskUV;
  out vec4 vColor;
  void main() {
    vUV = aUV;
    vMaskUV = aMaskUV;
    vColor = aColor;
    gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0);
  }`;

const QUAD_FRAG = `#version 300 es
  precision mediump float;
  in vec2 vUV;
  in vec2 vMaskUV;
  in vec4 vColor;
  uniform sampler2D uBase;
  uniform sampler2D uMask;
  uniform vec4 uBaseST;
  uniform vec4 uMaskST;
  uniform float uBaseScroll;
  uniform float uHasMask;
  uniform float uMaskInvert;
  uniform float uChannel;
  uniform vec4 uTint;
  out vec4 outColor;
  void main() {

    vec2 buv = vec2(vUV.x * uBaseST.x + uBaseST.z, vUV.y * uBaseST.y + uBaseST.w + uBaseScroll);
    vec4 base = texture(uBase, vec2(fract(buv.x), 1.0 - fract(buv.y)));
    vec3 rgb;
    float alpha;
    if (uChannel > 0.5) {
      rgb = vec3(1.0);
      alpha = base.r;
    } else {
      rgb = base.rgb;
      alpha = base.a;
    }
    if (uHasMask > 0.5) {
      vec2 muv = vec2(vMaskUV.x * uMaskST.x + uMaskST.z, vMaskUV.y * uMaskST.y + uMaskST.w);
      float mask = texture(uMask, vec2(fract(muv.x), 1.0 - fract(muv.y))).a;
      alpha *= uMaskInvert > 0.5 ? (1.0 - mask) : mask;
    }
    outColor = vec4(rgb * uTint.rgb * vColor.rgb, alpha * uTint.a * vColor.a);
  }`;

// reference/card/particles.js:14-34: the TV glow is a point sprite, not a textured quad. Chrome sizes the point
// in device px through gl_PointSize and shader-side sampling uses gl_PointCoord, so this path has no ST, mask,
// channel, tint uniform or V flip — the colour arrives already multiplied by `_TintColor` and the alpha ramp.
const POINT_VERT = `#version 300 es
  in vec2 aPos;
  in float aSize;
  in vec4 aColor;
  uniform vec2 uView;
  out vec4 vColor;
  void main() {
    vColor = aColor;
    gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0);
    gl_PointSize = max(1.0, aSize);
  }`;

const POINT_FRAG = `#version 300 es
  precision mediump float;
  in vec4 vColor;
  out vec4 outColor;
  uniform sampler2D uTex;
  void main() {
    vec4 t = texture(uTex, gl_PointCoord);
    outColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  }`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'shader');
  }
  return sh;
}


export function rangeOf(minMax, fallback) {
  if (!minMax) return [fallback, fallback];
  const num = (value, dflt) => (value == null || !Number.isFinite(Number(value)) ? dflt : Number(value));
  if (typeof minMax === 'number') return [minMax, minMax];
  if (minMax.mode === 'range' || (minMax.min != null && minMax.max != null && minMax.value == null)) {
    const a = num(minMax.min, fallback);
    const b = num(minMax.max, fallback);
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (minMax.mode === 'two-constants') {
    const a = num(minMax.min, fallback);
    const b = num(minMax.max, fallback);
    return [Math.min(a, b), Math.max(a, b)];
  }
  const c = num(minMax.value != null ? minMax.value : minMax.min, fallback);
  return [c, c];
}


export const curveRange = rangeOf;


export function keysOf(module) {
  if (!module) return null;
  if (Array.isArray(module.curve)) return module.curve;
  if (module.curve && Array.isArray(module.curve.keys)) return module.curve.keys;
  if (Array.isArray(module.keys)) return module.keys;
  return null;
}


export function sampleCurve(keys, t) {
  if (!keys || !keys.length) return 1;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const k0 = keys[i - 1];
      const k1 = keys[i];
      const dt = k1[0] - k0[0];
      if (!(dt > 0)) return k0[1];
      const u = (t - k0[0]) / dt;
      const u2 = u * u;
      const u3 = u2 * u;
      const m0 = Number(k0[3] != null ? k0[3] : k0[2]) || 0;
      const m1 = Number(k1[2] != null ? k1[2] : k1[3]) || 0;
      return (2 * u3 - 3 * u2 + 1) * k0[1] + (u3 - 2 * u2 + u) * dt * m0
        + (-2 * u3 + 3 * u2) * k1[1] + (u3 - u2) * dt * m1;
    }
  }
  return keys[keys.length - 1][1];
}

export function rgba(hex, fallback = [1, 1, 1, 1]) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255, a];
}


export function sampleGradient(keys, t) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const dt = b[0] - a[0];
      if (!(dt > 0)) return b[1];
      const k = (u - a[0]) / dt;
      return a[1].map((value, j) => value + (b[1][j] - value) * k);
    }
  }
  return keys[keys.length - 1][1];
}


export function gradientOf(startColor) {
  if (!startColor) return null;
  const colors = Array.isArray(startColor.colorKeys) && startColor.colorKeys.length ? startColor.colorKeys : null;
  if (!colors) return null;
  const alphas = Array.isArray(startColor.alphaKeys) && startColor.alphaKeys.length
    ? startColor.alphaKeys.map(([t, value]) => [t, [value]])
    : null;
  return { colors, alphas };
}


export function colorPair(startColor) {
  if (!startColor) return [[1, 1, 1, 1], [1, 1, 1, 1]];
  if (startColor.mode === 'twoColors') return [rgba(startColor.min || startColor.color), rgba(startColor.max || startColor.color)];
  const single = rgba(startColor.min || startColor.color || '#FFFFFF');
  return [single, single];
}


export const colourPair = colorPair;


export function materialByName(card, name) {
  if (!name) return null;
  const direct = Object.values(card.materials || {}).find((m) => m.name === name);
  if (direct) return direct;
  for (const sub of Object.values(card.sub || {})) {
    const hit = Object.values(sub.materials || {}).find((m) => m.name === name);
    if (hit) return hit;
  }
  return null;
}


export function tintOf(material) {
  if (!material || material.name !== 'particle_tv_glow') return [1, 1, 1];
  const color = material.colors && material.colors._TintColor;
  if (!Array.isArray(color) || color.length < 3) return [0.5, 0.5, 0.5];
  return [Number(color[0]), Number(color[1]), Number(color[2])];
}


export function alphaKeysOf(colorModule) {
  if (!colorModule) return null;
  if (Array.isArray(colorModule.alphaKeys)) return colorModule.alphaKeys;
  if (colorModule.gradient && Array.isArray(colorModule.gradient.alphaKeys)) return colorModule.gradient.alphaKeys;
  return null;
}


export function isDrawable(spec) {
  return Number(spec && spec.renderMode != null ? spec.renderMode : 0) !== 5;
}




export function linearToGamma(value) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function textureST(texture) {
  if (!texture) return [1, 1, 0, 0];
  const scale = Array.isArray(texture.scale) ? texture.scale : [1, 1];
  const offset = Array.isArray(texture.offset) ? texture.offset : [0, 0];
  return [Number(scale[0]) || 1, Number(scale[1]) || 1, Number(offset[0]) || 0, Number(offset[1]) || 0];
}

function tintColorOf(material) {
  const color = material && material.colors && material.colors._TintColor;
  if (!Array.isArray(color) || color.length < 4) return [1, 1, 1, 1];
  return [Number(color[0]), Number(color[1]), Number(color[2]), Number(color[3])];
}


export function materialSlots(card, name) {
  const material = card ? materialByName(card, name) : null;
  if (!material) return null;
  const textures = Array.isArray(material.textures) ? material.textures : [];
  const slotOf = (key) => textures.find((texture) => texture && texture.slot === key) || null;
  const main = slotOf('_MainTex');
  const base = slotOf('_BaseTex');
  const mask = slotOf('_Mask_Tex');
  const chosen = base && base.file ? base : (main && main.file ? main : null);
  const floats = material.floats || {};
  return {
    material,
    shader: material.shader || null,
    baseSlot: chosen ? chosen.slot : null,
    baseFile: chosen ? chosen.file || null : null,
    baseST: textureST(chosen),
    maskFile: mask && mask.file ? mask.file : null,
    maskST: textureST(mask),
    channel: Number(floats._BaseTex_Channel || 0),
    speedV: Number(floats._BaseTex_SpeedV || 0),
    maskInvert: Number(floats._Mask_Invert || 0),
    tint: tintColorOf(material),
  };
}


export function componentMap(data) {
  const map = new Map();
  if (!data) return map;
  const prefabs = data.prefabs || data;
  for (const doc of Object.values(prefabs || {})) {
    for (const system of (doc && doc.particleSystems) || []) {
      if (!system || system.pathId == null) continue;
      map.set(String(system.pathId), system);
      const numeric = Number(system.pathId);
      if (Number.isFinite(numeric)) map.set(numeric, system);
    }
  }
  return map;
}


export function nativePrefabsOf(data) {
  const out = new Set();
  if (!data) return out;
  for (const [name, doc] of Object.entries(data.prefabs || {})) {
    if (!(doc && Array.isArray(doc.uiparticles) && doc.uiparticles.length)) out.add(name);
  }
  return out;
}


export function nodeScaleOf(node) {
  const scale = node && Array.isArray(node.scale) ? node.scale : null;
  if (!scale) return [1, 1];
  return [Math.abs(Number(scale[0]) || 1), Math.abs(Number(scale[1]) || 1)];
}




function burstCountOf(curve) {
  if (curve == null) return 0;
  if (typeof curve === 'number') return Math.max(0, Math.round(curve));

  const count = curve.count != null ? Number(curve.count) : NaN;
  if (Number.isFinite(count)) return Math.max(0, Math.round(count));
  const raw = curve.raw || {};
  const scalar = raw.scalar != null ? Number(raw.scalar) : Number(curve.value);
  return Number.isFinite(scalar) ? Math.max(0, Math.round(scalar)) : 0;
}

function burstOf(burst) {
  const b = burst || {};
  const time = Number(b.time);
  const cycleCount = Math.max(1, Math.floor(Number(b.cycleCount) || 1));
  const repeatInterval = Math.max(0, Number(b.repeatInterval) || 0);
  const probability = b.probability != null ? Math.max(0, Math.min(1, Number(b.probability))) : 1;
  return {
    time: Number.isFinite(time) ? time : 0,
    count: burstCountOf(b.countCurve),
    cycleCount,
    repeatInterval,
    probability,
  };
}


export function emissionOf(spec) {
  const modules = (spec && spec.modules) || {};
  const source = modules.emission || null;
  const duration = Number(spec && spec.length) > 0 ? Number(spec.length) : 1;
  const looping = spec && spec.looping != null ? !!spec.looping : true;
  const prewarm = !!(spec && spec.prewarm);
  const enabled = source ? source.enabled !== false : true;
  const rateSource = source && source.rateOverTime != null ? source.rateOverTime : spec && spec.rate;
  const distanceSource = source ? source.rateOverDistance : null;
  const rate = enabled ? rangeOf(rateSource, 0) : [0, 0];
  const rateDistance = enabled ? rangeOf(distanceSource, 0) : [0, 0];
  const bursts = enabled && source && Array.isArray(source.bursts) ? source.bursts.map(burstOf).filter((b) => b.count > 0 && b.probability > 0) : [];
  return { enabled, rate, rateDistance, bursts, duration, looping, prewarm };
}


export function pathVariants(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i < Math.min(3, parts.length); i += 1) out.push(parts.slice(i).join('/'));
  return out;
}


export function matchNode(system, node) {
  const path = nodePathOf(node);
  if (path == null || !path) return -1;
  const variants = system.variants || [];
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    if (!variant) continue;
    if (path === variant || path.endsWith(`/${variant}`)) return i;
  }
  return -1;
}

function nodePathOf(node) {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'object') return node.path != null ? String(node.path) : (node.name != null ? String(node.name) : null);
  return null;
}

export function prepare(spec, index, card, options = {}) {
  const modules = spec.modules || {};
  const shape = modules.shape || null;
  const [c0, c1] = colorPair(spec.startColor);
  const sizeModule = modules.size;
  const slots = card ? materialSlots(card, spec.material) : null;
  const material = card ? materialByName(card, spec.material) : null;
  const emission = emissionOf(spec);
  const path = String(spec.path || '');
  const key = spec.pathId != null && spec.pathId !== '' ? `pathId:${spec.pathId}` : `path:${path}`;
  const startGradient = gradientOf(spec.startColor);
  const max = Math.max(0, Number(spec.maxParticles != null ? spec.maxParticles : 100));
  const drawable = Number(spec.renderMode != null ? spec.renderMode : 0) !== 5;
  const canEmit = drawable && emission.enabled && max > 0
    && (emission.rate[1] > 0 || emission.rateDistance[1] > 0 || emission.bursts.length > 0);


  const component = options.components instanceof Map && spec.pathId != null
    ? (options.components.get(String(spec.pathId)) || options.components.get(Number(spec.pathId)) || null)
    : null;
  const lossyScale = component && Array.isArray(component.lossyScale) && component.lossyScale.length >= 2
    ? [Math.abs(Number(component.lossyScale[0])), Math.abs(Number(component.lossyScale[1]))]
    : null;
  const native = !!(options.native || (spec.native === true));
  const materialName = (material && material.name) || (spec && spec.material) || null;
  const maxParticleSize = Number(spec && spec.renderer && spec.renderer.maxParticleSize) || 0;
  return {
    spec,
    index,

    key,
    pathId: spec.pathId != null ? spec.pathId : null,
    path,
    variants: pathVariants(path),
    name: path.split('/').pop() || String(index),

    drawable,
    canEmit,

    native,
    bake: !native,
    lossyScale,
    moveWithTransform: component ? Number(component.moveWithTransform) || 0 : 0,
    scalingMode: component ? Number(component.scalingMode) || 0 : 0,
    renderMode: spec.renderMode != null ? Number(spec.renderMode) : (component && Number(component.renderMode)) || 0,
    alignment: component ? Number(component.renderAlignment) || 0 : 0,
    pivot: component && component.pivot ? [Number(component.pivot.x) || 0, Number(component.pivot.y) || 0] : [0, 0],
    minParticleSize: component ? Number(component.minParticleSize) || 0 : 0,
    maxParticleSize: component ? Number(component.maxParticleSize) || 0 : 0,
    velocityScale: component ? Number(component.velocityScale) || 0 : 0,
    lengthScale: component ? Number(component.lengthScale) || 0 : 0,
    normalDirection: component ? Number(component.normalDirection) || 1 : 1,
    hasMesh: !!(component && component.mesh && Number(component.mesh.m_PathID)),
    slots,
    baseFile: slots ? slots.baseFile : (spec.file || null),
    maskFile: slots ? slots.maskFile : null,
    baseST: slots ? slots.baseST : [1, 1, 0, 0],
    maskST: slots ? slots.maskST : [1, 1, 0, 0],
    channel: slots ? slots.channel : 0,
    speedV: slots ? slots.speedV : 0,
    maskInvert: slots ? slots.maskInvert : 0,
    // ref:particles.js:124-129 — AlphaBlend _TintColor multiplies only particle_tv_glow; the triple
    // emitters were validated without it (their _TintColor is also 0.5, but that family must stay at 1).
    tint: [...tintOf(material), 1],
    // ref:particles.js:175-177/187-206: the TV glow keeps the reference point-sprite path (gl.POINTS,
    // gl_PointSize, gl_PointCoord); every other emitter keeps the masked quad path.
    maxPx: maxParticleSize > 0 ? maxParticleSize * WORLD_TO_PX : MAX_POINT_PX,
    pointSprite: materialName === 'particle_tv_glow',
    shader: slots ? slots.shader : null,
    missingTexture: !!(slots && !slots.baseFile),
    emission,
    duration: emission.duration,
    looping: emission.looping,
    prewarm: emission.prewarm,
    rate: emission.rate,
    life: rangeOf(spec.startLifetime, 1),
    size: rangeOf(spec.startSize, 0.1),
    speed: rangeOf(spec.startSpeed, 0),
    color: [c0, c1],
    startGradient,
    max,
    sizeKeys: keysOf(sizeModule),


    alphaKeys: alphaKeysOf(modules.color),
    shape: shape ? {
      type: Number(shape.type),
      radius: Number(shape.radius && shape.radius.value != null ? shape.radius.value : 1),
      thickness: Number(shape.radiusThickness != null ? shape.radiusThickness : 1),
      box: Array.isArray(shape.m_Scale) ? shape.m_Scale : [1, 1, 0],
      angle: Number(shape.angle || 0),
      rotation: Array.isArray(shape.m_Rotation) ? shape.m_Rotation : [0, 0, 0],
    } : null,
    noise: modules.noise ? {
      strength: Number(modules.noise.strength && modules.noise.strength.value != null ? modules.noise.strength.value : 0),
      frequency: Number(modules.noise.frequency || 0),
      positionAmount: Number(modules.noise.positionAmount && modules.noise.positionAmount.value != null ? modules.noise.positionAmount.value : 0),
    } : null,
    file: spec.file || null,

    seedBase: 12345 + index,

    alive: [],
    acc: 0,
    distAcc: 0,
    t: 0,
    seed: 12345 + index,
    rect: null,
    active: false,
  };
}


export function systemsOf(card, mounted) {
  const mountedSet = new Set(Array.isArray(mounted) ? mounted : []);
  const components = componentMap(card && card.particleComponents);
  const nativePrefabs = nativePrefabsOf(card && card.particleComponents);
  const all = [];
  const mountedPath = (path) => {
    if (!mountedSet.size) return true;
    for (const name of mountedSet) {
      if (path === name || path.endsWith('/' + name) || path.includes('/' + name + '/')) return true;
    }
    return false;
  };
  const push = (list, site, forcedNative = false) => {
    for (const system of list || []) {
      const path = String(system.path || '');
      const root = path.split('/')[0];
      if (site === 'sub' && !mountedPath(path)) continue;
      all.push({ spec: system, site, native: forcedNative || nativePrefabs.has(root) || system.native === true });
    }
  };
  // scene.bakeParticles marks the per-frame TV systems with `sub`: they belong to a mounted sub-prefab,
  // not to the card root, so the mounted filter applies to them.
  for (const system of card.particles || []) push([system], system && system.sub ? 'sub' : 'card');
  push(card.nativeParticles, 'native', true);
  for (const sub of Object.values(card.sub || {})) push(sub.particles, 'sub');
  return all.map((entry, index) => {
    const prepared = prepare(entry.spec, index, card, { components, native: entry.native });
    prepared.site = entry.site;
    return prepared;
  });
}

function randomOf(state) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function between(state, range) {
  return range[0] + (range[1] - range[0]) * randomOf(state);
}


export function spawn(system, age = 0, state = system) {
  const shape = system.shape;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  if (shape && shape.type === 5) {

    const halfW = (Math.abs(shape.box[0]) * WORLD_TO_PX) / 2;
    const halfH = (Math.abs(shape.box[1]) * WORLD_TO_PX) / 2;
    const lx = (randomOf(state) - 0.5) * 2 * halfW;
    const ly = (randomOf(state) - 0.5) * 2 * halfH;
    const a = (shape.angle * Math.PI) / 180;
    x = lx * Math.cos(a) - ly * Math.sin(a);
    y = lx * Math.sin(a) + ly * Math.cos(a);
  } else if (shape && (shape.type === 8 || shape.type === 4 || shape.type === 9 || shape.type === 7)) {



    const radius = shape.radius * WORLD_TO_PX;
    const theta = randomOf(state) * Math.PI * 2;
    const r = radius * Math.sqrt((1 - shape.thickness) + shape.thickness * randomOf(state));
    x = Math.cos(theta) * r;
    y = Math.sin(theta) * r;
    const speed = between(state, system.speed) * WORLD_TO_PX;
    const drift = randomOf(state) * Math.PI * 2;
    vx = Math.cos(drift) * speed;
    vy = Math.sin(drift) * speed;
  }
  const life = between(state, system.life);
  const startSize = between(state, system.size);
  const mix = randomOf(state);
  const c0 = system.color[0];
  const c1 = system.color[1];

  let gradient = null;
  if (system.startGradient) {
    const u = randomOf(state);
    const rgb = sampleGradient(system.startGradient.colors, u);
    if (rgb) {
      const alpha = system.startGradient.alphas ? sampleGradient(system.startGradient.alphas, u) : null;
      gradient = [rgb[0], rgb[1], rgb[2], alpha ? alpha[0] : rgb[3]];
    }
  }
  const base = gradient || [
    c0[0] + (c1[0] - c0[0]) * mix,
    c0[1] + (c1[1] - c0[1]) * mix,
    c0[2] + (c1[2] - c0[2]) * mix,
    c0[3] + (c1[3] - c0[3]) * mix,
  ];
  return {
    age: Math.min(age, life * 0.999),
    life,
    startSize,

    colour: [base[0], base[1], base[2], base[3]],
    x,
    y,
    vx,
    vy,
    phaseA: randomOf(state) * Math.PI * 2,
    phaseB: randomOf(state) * Math.PI * 2,
    px: x,
    py: y,
    sizePx: startSize * WORLD_TO_PX,
    alpha: 1,
  };
}


function prewarmState(system, state) {
  const rate = (system.rate[0] + system.rate[1]) / 2;
  const life = (system.life[0] + system.life[1]) / 2;
  const steady = Math.min(system.max, Math.ceil(rate * life));
  for (let i = 0; i < steady; i += 1) state.alive.push(spawn(system, randomOf(state) * system.life[1], state));
}


export function prewarm(system) {
  return prewarmState(system, system);
}

export function stepOne(system, p, dt) {
  p.age += dt;
  if (p.age >= p.life) return false;
  const u = p.age / p.life;
  const sizeCurve = system.sizeKeys ? sampleCurve(system.sizeKeys, u) : 1;
  const alphaCurve = system.alphaKeys ? sampleCurve(system.alphaKeys, u) : 1;



  let noiseX = 0;
  let noiseY = 0;
  if (system.noise && system.noise.positionAmount) {
    const amp = system.noise.positionAmount * WORLD_TO_PX;
    const w = system.noise.frequency * Math.PI * 2;
    noiseX = Math.sin(w * p.age + p.phaseA) * amp;
    noiseY = Math.cos(w * p.age + p.phaseB) * amp;
  }
  p.px = p.x + p.vx * p.age + noiseX;
  p.py = p.y + p.vy * p.age + noiseY;
  p.sizePx = p.startSize * sizeCurve * WORLD_TO_PX;
  p.alpha = p.colour[3] * alphaCurve;
  return true;
}


function fireBursts(system, state, from, to, step = 0) {
  const emission = system.emission;
  if (!emission || !emission.bursts.length || !(to > from)) return;
  const duration = emission.duration > 0 ? emission.duration : Infinity;
  const first = Number.isFinite(duration) ? Math.max(0, Math.floor(from / duration)) : 0;
  const last = Number.isFinite(duration)
    ? (emission.looping ? Math.floor(to / duration) : 0)
    : 0;
  if (first > last) return;
  for (let cycle = first; cycle <= last; cycle += 1) {
    const base = cycle * duration;
    for (const burst of emission.bursts) {
      for (let rep = 0; rep < burst.cycleCount; rep += 1) {
        const t = base + burst.time + rep * burst.repeatInterval;
        if (t <= from || t > to) continue;
        if (burst.probability < 1 && randomOf(state) >= burst.probability) continue;
        // the caller advances every alive particle after emitting, so the spawn age is one step short
        const age = Math.max(0, to - t - step);
        for (let n = 0; n < burst.count; n += 1) {
          if (state.alive.length >= system.max) break;
          state.alive.push(spawn(system, age, state));
        }
      }
    }
  }
}


export function advanceEmitter(system, state, step, distance) {
  const emission = system.emission;
  if (!emission || emission.enabled === false) {
    state.alive.length = 0;
    state.active = false;
    return 0;
  }
  if (!state.active) {
    state.active = true;
    state.t = 0;
    state.acc = 0;
    state.distAcc = 0;
    state.alive.length = 0;
    if (emission.prewarm) prewarmState(system, state);

    fireBursts(system, state, -BURST_EPS, 0);
  }
  const prevT = state.t;
  const curT = prevT + step;
  const emitting = emission.looping || prevT < emission.duration;

  // reference/card/particles.js:340-355 emits first and only then advances every alive particle. Spawning
  // after the step let a fresh particle reach the draw with spawn()'s placeholder `alpha = 1`, which painted
  // one full-brightness frame per respawn (the TV glow flashed white every 0.4 s instead of fading 0→1→0).
  if (emitting && (emission.rate[0] > 0 || emission.rate[1] > 0)) {
    state.acc += between(state, emission.rate) * step;
    while (state.acc >= 1) {
      state.acc -= 1;
      if (state.alive.length < system.max) state.alive.push(spawn(system, 0, state));
    }
    if (state.acc > 4) state.acc = 4;
  }

  if (emitting && emission.rateDistance[1] > 0 && distance > 0) {
    state.distAcc += between(state, emission.rateDistance) * distance;
    while (state.distAcc >= 1) {
      state.distAcc -= 1;
      if (state.alive.length < system.max) state.alive.push(spawn(system, 0, state));
    }
    if (state.distAcc > 4) state.distAcc = 4;
  }

  fireBursts(system, state, prevT, curT, step);

  for (let i = state.alive.length - 1; i >= 0; i -= 1) {
    if (!stepOne(system, state.alive[i], step)) state.alive.splice(i, 1);
  }
  state.t = curT;
  return state.alive.length;
}

function emitterState(system, seed) {
  return {
    system,
    seed: seed >>> 0,
    alive: [],
    acc: 0,
    distAcc: 0,
    t: 0,
    active: false,
    rect: null,
    node: null,
    nodePath: null,
    unitScale: 1,
    scale: [1, 1],
  };
}


function normalizeNodes(nodes) {
  const out = [];
  if (!nodes) return out;
  const add = (key, value) => {
    if (!value || typeof value !== 'object') return;
    const node = value.node || (key && typeof key === 'object' ? key : null);
    const path = value.path != null ? String(value.path)
      : node && node.path != null ? String(node.path)
        : typeof key === 'string' ? key : '';
    const name = value.name != null ? String(value.name) : node && node.name != null ? String(node.name) : path.split('/').pop();
    const w = Number(value.w);
    const h = Number(value.h);
    if (!(w > 0) || !(h > 0)) return;
    out.push({ key: path || name, node, path: path || name, name, x: Number(value.x) || 0, y: Number(value.y) || 0, w, h });
  };
  if (nodes instanceof Map) {
    for (const [key, value] of nodes) add(key, value);
    return out;
  }
  if (Array.isArray(nodes) || typeof nodes[Symbol.iterator] === 'function') {
    for (const item of nodes) {
      if (!item) continue;
      if (item.node && item.w != null) add(item.node, item);
      else add(item.path || item.name || item.key, item);
    }
  }
  return out;
}


export function createSimulation(systems) {
  
  const emitters = new Map();
  let unitPx = 1;
  const keyOf = (system, nodePath) => `${system.key}@${nodePath}`;

  
  const advance = (dt, nodes, pixels) => {
    unitPx = Number(pixels) > 0 ? Number(pixels) : 1;
    const list = normalizeNodes(nodes);
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    const next = new Map();
    for (const system of systems) {
      if (!system.canEmit) continue;
      const matches = [];
      for (const node of list) if (matchNode(system, node) >= 0) matches.push(node);
      if (!matches.length) continue;
      matches.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const seen = new Set();
      let bound = 0;
      for (let i = 0; i < matches.length; i += 1) {
        const node = matches[i];

        if (seen.has(node.path)) continue;
        seen.add(node.path);
        const key = keyOf(system, node.path);
        let state = emitters.get(key);
        if (!state) {

          state = emitterState(system, (system.seedBase + bound * 1000003) >>> 0);
          emitters.set(key, state);
        }
        bound += 1;

        state.scale = system.lossyScale || nodeScaleOf(node.node);
        let distance = 0;
        if (state.rect) {
          const dx = (node.x + node.w / 2) - (state.rect.x + state.rect.w / 2);
          const dy = (node.y + node.h / 2) - (state.rect.y + state.rect.h / 2);
          const scale = Math.max(1e-6, (state.scale[0] + state.scale[1]) / 2);
          distance = Math.hypot(dx, dy) / (unitPx * scale);
        }
        state.rect = { x: node.x, y: node.y, w: node.w, h: node.h };
        state.node = node.node || null;
        state.nodePath = node.path;
        state.unitScale = unitPx;
        advanceEmitter(system, state, step, distance);
        next.set(key, state);
      }
    }
    for (const key of [...emitters.keys()]) if (!next.has(key)) emitters.delete(key);


    const bySystem = new Map();
    for (const state of next.values()) {
      const list = bySystem.get(state.system);
      if (list) list.push(state); else bySystem.set(state.system, [state]);
    }
    for (const system of systems) {
      const states = bySystem.get(system) || [];
      system.active = states.some((state) => state.active);
      system.rect = states.length ? states[0].rect : null;
      if (!Array.isArray(system.alive)) system.alive = [];
      system.alive.length = 0;
      for (const state of states) for (const particle of state.alive) system.alive.push(particle);
    }
    return { step, emitters: next.size };
  };

  const emittersFor = (node) => {
    const path = nodePathOf(node);
    if (path == null) return [];
    const list = [];
    for (const system of systems) {
      const state = emitters.get(keyOf(system, path));
      if (state) list.push(state);
    }
    return list;
  };

  const has = (node) => {
    const path = nodePathOf(node);
    if (path == null) return false;
    return systems.some((system) => system.canEmit && matchNode(system, { path }) >= 0);
  };

  const aliveCount = () => {
    let sum = 0;
    for (const state of emitters.values()) sum += state.alive.length;
    return sum;
  };

  
  const report = (node = null) => {
    const path = nodePathOf(node);
    const pathOf = (state) => (state.node ? nodePathOf(state.node) : (state.nodePath || null));
    const out = [];
    for (const state of emitters.values()) {
      if (path != null && pathOf(state) !== path) continue;
      const quads = state.alive.filter((p) => p.alpha > 0.002).length;
      out.push({
        pathId: state.system.pathId,
        path: state.system.path,
        name: state.system.name,
        node: pathOf(state),
        alive: state.alive.length,
        quads,

        native: !!state.system.native,
        missingTexture: !!state.system.missingTexture,
        baseFile: state.system.baseFile || null,
        maskFile: state.system.maskFile || null,
        scale: state.scale ? [...state.scale] : [1, 1],
        drawn: state.system.native || state.system.missingTexture ? 0 : quads,
        rect: state.rect ? { ...state.rect } : null,
      });
    }
    return out;
  };

  const emitter = (system, nodePath) => emitters.get(keyOf(system, nodePath)) || null;

  return {
    advance,
    emittersFor,
    has,
    aliveCount,
    report,
    emitter,
    get emitters() { return emitters; },
    get unitPx() { return unitPx; },
  };
}


export function advanceSystems(systems, dt, rects, unitPx) {
  const pixels = Number(unitPx) > 0 ? Number(unitPx) : 1;
  const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
  for (const system of systems) {
    const rect = rects instanceof Map ? rects.get(system.name) : (rects && rects[system.name]);
    if (!rect || !system.canEmit || !system.drawable || system.max <= 0) {
      system.alive.length = 0;
      system.active = false;
      system.acc = 0;
      system.distAcc = 0;
      system.t = 0;
      system.rect = null;
      continue;
    }
    let distance = 0;
    if (system.rect) {
      const dx = (rect.x + rect.w / 2) - (system.rect.x + system.rect.w / 2);
      const dy = (rect.y + rect.h / 2) - (system.rect.y + system.rect.h / 2);
      distance = Math.hypot(dx, dy) / pixels;
    }
    system.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    system.unitScale = pixels;
    advanceEmitter(system, system, step, distance);
  }
  return systems.reduce((sum, system) => sum + system.alive.length, 0);
}


export function create(canvas, card, textures, mounted) {
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  // Own the program/buffer so the stage's destroy() can release them; a failed compile or link must not
  // leave either behind.
  let program = null;
  let destroyed = false;
  const shaders = [];
  const discardProgram = () => {
    for (const sh of shaders) {
      if (program) gl.detachShader(program, sh);
      gl.deleteShader(sh);
    }
    shaders.length = 0;
    if (program) { gl.deleteProgram(program); program = null; }
  };
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VERT);
    shaders.push(vs);
    const fs = compile(gl, gl.FRAGMENT_SHADER, QUAD_FRAG);
    shaders.push(fs);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      discardProgram();
      return null;
    }
  } catch {
    discardProgram();
    return null;
  }
  for (const sh of shaders) { gl.detachShader(program, sh); gl.deleteShader(sh); }
  shaders.length = 0;
  const U = {
    view: gl.getUniformLocation(program, 'uView'),
    base: gl.getUniformLocation(program, 'uBase'),
    mask: gl.getUniformLocation(program, 'uMask'),
    baseST: gl.getUniformLocation(program, 'uBaseST'),
    maskST: gl.getUniformLocation(program, 'uMaskST'),
    baseScroll: gl.getUniformLocation(program, 'uBaseScroll'),
    hasMask: gl.getUniformLocation(program, 'uHasMask'),
    maskInvert: gl.getUniformLocation(program, 'uMaskInvert'),
    channel: gl.getUniformLocation(program, 'uChannel'),
    tint: gl.getUniformLocation(program, 'uTint'),
  };
  const aPos = gl.getAttribLocation(program, 'aPos');
  const aUV = gl.getAttribLocation(program, 'aUV');
  const aMaskUV = gl.getAttribLocation(program, 'aMaskUV');
  const aColor = gl.getAttribLocation(program, 'aColor');
  const buffer = gl.createBuffer();

  // reference/card/particles.js:208-221: the TV glow gets the reference's own point program. A driver that
  // refuses the program (or an attribute) leaves the TV on the quad path instead of dropping the effect.
  let point = null;
  {
    let pointVs = null;
    let pointFs = null;
    let pointProgram;
    try {
      pointVs = compile(gl, gl.VERTEX_SHADER, POINT_VERT);
      pointFs = compile(gl, gl.FRAGMENT_SHADER, POINT_FRAG);
      pointProgram = gl.createProgram();
      gl.attachShader(pointProgram, pointVs);
      gl.attachShader(pointProgram, pointFs);
      gl.linkProgram(pointProgram);
      const ok = gl.getProgramParameter(pointProgram, gl.LINK_STATUS);
      const pPos = gl.getAttribLocation(pointProgram, 'aPos');
      const pSize = gl.getAttribLocation(pointProgram, 'aSize');
      const pColor = gl.getAttribLocation(pointProgram, 'aColor');
      if (ok && pPos >= 0 && pSize >= 0 && pColor >= 0) {
        point = {
          program: pointProgram,
          buffer: gl.createBuffer(),
          aPos: pPos,
          aSize: pSize,
          aColor: pColor,
          view: gl.getUniformLocation(pointProgram, 'uView'),
          tex: gl.getUniformLocation(pointProgram, 'uTex'),
        };
      } else {
        gl.deleteProgram(pointProgram);
      }
    } catch {
      point = null;
    } finally {
      for (const sh of [pointVs, pointFs]) {
        if (!sh) continue;
        if (point && point.program) gl.detachShader(point.program, sh);
        gl.deleteShader(sh);
      }
    }
  }
  const mountedSource = mounted && typeof mounted === 'object' && 'mounted' in mounted ? mounted : null;
  const systems = systemsOf(card, null);
  const simulation = createSimulation(systems);
  const mountedNames = () => {
    if (!mountedSource) return Array.isArray(mounted) ? mounted : [];
    return Array.isArray(mountedSource.mounted) ? mountedSource.mounted : [];
  };
  const mountedMatch = (path) => {
    const names = mountedNames();
    if (!names.length) return true;
    for (const name of names) {
      if (path === name || path.endsWith('/' + name) || path.includes('/' + name + '/')) return true;
    }
    return false;
  };
  const isMounted = (system) => system.site !== 'sub' || mountedMatch(String(system.path || ''));
  let clock = 0;

  
  // The stage owns the emitters but not the GL objects they draw with: release the program and the
  // vertex buffer here so a disposed host leaves nothing behind.
  const advance = (dt, nodes, unitPx) => {
    if (destroyed) return { step: 0, emitters: 0 };
    clock += Math.min(0.1, Math.max(0, Number(dt) || 0));
    return simulation.advance(dt, nodes, unitPx);
  };

  
  // reference/card/particles.js:359-409: one gl.POINTS draw per TV emitter, with that emitter's own material
  // texture, the reference's single square size, and the colour that already carries `_TintColor` (baked in
  // spawn). No ST / mask / channel / V flip and no gamma: exactly the reference fragment.
  const drawPointSprites = (system, state) => {
    if (!point) return 0;
    const texture = textures(system.file || system.baseFile);
    if (!texture || !texture.tex) return 0;
    const scale = state.unitScale > 0 ? state.unitScale : simulation.unitPx;
    const cx = state.rect.x + state.rect.w / 2;
    const cy = state.rect.y + state.rect.h / 2;
    const tint = system.tint || [1, 1, 1, 1];
    const data = new Float32Array(state.alive.length * 7);
    let n = 0;
    for (const p of state.alive) {
      if (p.alpha <= 0.002) continue;
      data[n * 7 + 0] = cx + p.px * scale;
      data[n * 7 + 1] = cy + p.py * scale;
      data[n * 7 + 2] = pointSizeOf(system, p, scale);
      data[n * 7 + 3] = p.colour[0] * tint[0];
      data[n * 7 + 4] = p.colour[1] * tint[1];
      data[n * 7 + 5] = p.colour[2] * tint[2];
      data[n * 7 + 6] = p.alpha;
      n += 1;
    }
    if (!n) return 0;
    gl.useProgram(point.program);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.colorMask(true, true, true, true);
    gl.uniform2f(point.view, canvas.width, canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, point.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 7), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(point.aPos);
    gl.vertexAttribPointer(point.aPos, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(point.aSize);
    gl.vertexAttribPointer(point.aSize, 1, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(point.aColor);
    gl.vertexAttribPointer(point.aColor, 4, gl.FLOAT, false, 28, 12);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture.tex);
    gl.uniform1i(point.tex, 0);
    gl.drawArrays(gl.POINTS, 0, n);
    return n;
  };

  const draw = (node) => {
    if (destroyed) return 0;
    let drawn = 0;
    for (const state of simulation.emittersFor(node)) {
      const system = state.system;
      if (!isMounted(system)) continue;
      if (!state.rect || !system.drawable || system.native || system.missingTexture || !state.alive.length) continue;
      if (system.pointSprite) {
        drawn += drawPointSprites(system, state);
        continue;
      }
      const baseTex = textures(system.baseFile);
      if (!baseTex || !baseTex.tex) continue;
      const maskTex = system.maskFile ? textures(system.maskFile) : null;
      const scaleX = (state.scale ? state.scale[0] : 1) * (state.unitScale > 0 ? state.unitScale : simulation.unitPx);
      const scaleY = (state.scale ? state.scale[1] : 1) * (state.unitScale > 0 ? state.unitScale : simulation.unitPx);
      const cx = state.rect.x + state.rect.w / 2;
      const cy = state.rect.y + state.rect.h / 2;
      const data = new Float32Array(state.alive.length * 6 * 10);
      const order = [0, 1, 2, 0, 2, 3];
      let n = 0;
      for (const p of state.alive) {
        if (p.alpha <= 0.002) continue;
        const width = Math.max(1, Math.min(MAX_QUAD_PX, p.sizePx * Math.abs(scaleX)));
        const height = Math.max(1, Math.min(MAX_QUAD_PX, p.sizePx * Math.abs(scaleY)));
        const x = cx + p.px * scaleX;
        const y = cy + p.py * scaleY;
        const corners = [
          [x - width / 2, y - height / 2, 0, 0],
          [x + width / 2, y - height / 2, 1, 0],
          [x + width / 2, y + height / 2, 1, 1],
          [x - width / 2, y + height / 2, 0, 1],
        ];
        const r = COLOR_GAMMA ? linearToGamma(p.colour[0]) : p.colour[0];
        const g = COLOR_GAMMA ? linearToGamma(p.colour[1]) : p.colour[1];
        const b = COLOR_GAMMA ? linearToGamma(p.colour[2]) : p.colour[2];
        for (const index of order) {
          const corner = corners[index];
          const offset = n * 10;
          data[offset + 0] = corner[0];
          data[offset + 1] = corner[1];
          data[offset + 2] = corner[2];
          data[offset + 3] = corner[3];
          data[offset + 4] = corner[2];
          data[offset + 5] = corner[3];
          data[offset + 6] = r;
          data[offset + 7] = g;
          data[offset + 8] = b;
          data[offset + 9] = p.alpha;
          n += 1;
        }
      }
      if (!n) continue;
      gl.useProgram(program);
      gl.enable(gl.BLEND);



      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.colorMask(true, true, true, true);
      gl.uniform2f(U.view, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 10), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(aUV);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 40, 8);
      gl.enableVertexAttribArray(aMaskUV);
      gl.vertexAttribPointer(aMaskUV, 2, gl.FLOAT, false, 40, 16);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 40, 24);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTex.tex);
      gl.uniform1i(U.base, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, maskTex && maskTex.tex ? maskTex.tex : null);
      gl.uniform1i(U.mask, 1);
      gl.uniform4f(U.baseST, system.baseST[0], system.baseST[1], system.baseST[2], system.baseST[3]);
      gl.uniform4f(U.maskST, system.maskST[0], system.maskST[1], system.maskST[2], system.maskST[3]);
      gl.uniform1f(U.baseScroll, (system.speedV || 0) * clock);
      gl.uniform1f(U.hasMask, maskTex && maskTex.tex ? 1 : 0);
      gl.uniform1f(U.maskInvert, system.maskInvert ? 1 : 0);
      gl.uniform1f(U.channel, system.channel || 0);
      gl.uniform4f(U.tint, system.tint[0], system.tint[1], system.tint[2], system.tint[3]);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      drawn += n / 6;
    }
    return drawn;
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    program = null;
    if (point) {
      gl.deleteBuffer(point.buffer);
      gl.deleteProgram(point.program);
      point = null;
    }
  };

  return {
    advance,
    draw,
    
    has: (node) => simulation.has(node),
    aliveCount: () => systems.filter(isMounted).reduce((sum, system) => sum + system.alive.length, 0),
    report: (node) => simulation.report(node).filter((row) => {
      const system = systems.find((candidate) => candidate.name === row.name && String(candidate.path) === String(row.path));
      return !system || isMounted(system);
    }),
    destroy,
    get destroyed() { return destroyed; },
    get systems() { return systems.filter(isMounted); },
    get simulation() { return simulation; },
  };
}


export const CardParticles = { create };
