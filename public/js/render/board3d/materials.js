// render/board3d/materials.js — three.js materials of the official board scene (DESIGN §15). THREE is injected
// (the renderer loads /vendor/three.module.js; Node tests pass the npm package).
//
//   MT_autochess        → MeshStandardMaterial: albedo TX_autochessi_D (sRGB), normal TX_autochessi_N (BC5 / DXT5nm →
//                         RGB, tools/local-extract DERIVED), roughness 1 − smoothness of TX_autochessi_M (DERIVED), metal 0,
//                         emission TX_autochessi_E (_EmissionColor white), vertex colours = baked AO / tints
//   MT_autochess_common → device plates of TX_autochessi_common_D, alpha test 0.408, emission _E × 0.559
//   MT_autochessi_BG    → unlit TX_autochessi_BG × 0.713 (Torappu/Unlit/Texture, _Color)
//   MT_wind_device      → unlit TX_wind_device (the blower mesh)
//   [opt]start_end_add / _ab → the gate / objective boxes: Torappu/Particles/Additive (2 · tint · tex) / AlphaBlend
//   the materials of an official battlefield scene (load.js loadScenePack) → sceneMaterial / sceneWaterMaterial
// Every lit material gets the "focus" spotlight: fragments outside the camera's field rect fade towards `dim`
// (a soft world-space falloff), so the active field reads like the original's lit board without re-building
// geometry when the camera moves.

import { ORIGINIUM } from '../style.js';

/** Shared focus uniforms (one object for every lit material). */
export function focusUniforms(THREE) {
  return {
    uFocus: { value: new THREE.Vector4(0, 9, 10, 12) },  // x0, y0, x1, y1 (world)
    uFocusDim: { value: 0.72 },
    uFocusSoft: { value: 2.2 },
    // glossy "arena light" sheen: smooth surfaces (glass hatches, steel, plate centres; smoothness from TX_…_M) pick
    // up a bright reflection like the official baked reflections — added as sheen · smoothness²
    uSheen: { value: new THREE.Color(0.4, 0.45, 0.52) },
  };
}

/** Inject the focus falloff into a built-in material (onBeforeCompile). */
export function addFocus(material, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFocusWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFocusWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      // tinted (dark) blocks glow less: emission follows the vertex tint
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined( USE_COLOR )\n  { float ek = (vColor.r + vColor.g + vColor.b) / 3.0; totalEmissiveRadiance *= ek * ek; }\n#endif')
      .replace('#include <common>', '#include <common>\nvarying vec3 vFocusWorld;\nuniform vec4 uFocus;\nuniform float uFocusDim;\nuniform float uFocusSoft;\nuniform vec3 uSheen;')
      .replace('#include <opaque_fragment>', [
        '#ifdef USE_ROUGHNESSMAP',
        '  { float sm = clamp(1.0 - texelRoughness.g, 0.0, 1.0); float tintk = 1.0;',
        '    #if defined( USE_COLOR )',
        '      tintk = (vColor.r + vColor.g + vColor.b) / 3.0; tintk *= tintk;',
        '    #endif',
        '    outgoingLight += uSheen * sm * sm * tintk * diffuseColor.a; }',
        '#endif',
        '{',
        '  vec2 fq = vFocusWorld.xy;',
        '  vec2 fd = max(vec2(0.0), max(uFocus.xy - fq, fq - uFocus.zw));',
        '  float fm = 1.0 - smoothstep(0.0, uFocusSoft, length(fd));',
        '  outgoingLight *= mix(uFocusDim, 1.0, fm);',
        '}',
        '#include <opaque_fragment>',
      ].join('\n'));
  };
  material.customProgramCacheKey = () => 'sp-focus';
  return material;
}

/** Texture from a loaded image (sRGB colour maps; linear data maps), mipmapped, anisotropic. */
export function makeTexture(THREE, image, { srgb = true, aniso = 1, repeat = false, flipY = true } = {}) {
  if (!image) return null;
  const t = new THREE.Texture(image);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.max(1, aniso | 0);
  t.flipY = flipY;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** MT_autochess (see header). `tex` = { D, N?, R?, E? } textures. */
export function boardMaterial(THREE, tex, focus, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.D, vertexColors: true,
    normalMap: tex.N || null,
    roughnessMap: tex.R || null, roughness: tex.R ? (opts.roughness ?? 0.78) : 0.78, metalness: 0,
    emissiveMap: tex.E || null, emissive: tex.E ? new THREE.Color(1, 1, 1) : new THREE.Color(0, 0, 0),
    emissiveIntensity: opts.emissive ?? 1,
  });
  if (tex.N) m.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
  return addFocus(m, focus);
}

/**
 * The enemy preview pen's glass hatches (official look: glossy panes in a hazard frame reflecting a cloudy sky, not the
 * stripes under the glass): MT_autochess with the hatch's pane (the inner square of every tile, tile-local so the
 * random rotation does not matter; the hazard frame and the plate rim stay as they are) re-shaded as sky-lit glass: a
 * soft cloud reflection (T_noise_clouds_01 in world space), a faint trace of the pattern below, low roughness for the
 * key light's glint. Same UVs / atlas as the board.
 */
export function glassMaterial(THREE, tex, focus, opts = {}) {
  const m = boardMaterial(THREE, tex, focus, opts);
  const prev = m.onBeforeCompile;
  const uniforms = {
    uCloud: { value: tex.noise || null },
    uSkyLow: { value: new THREE.Color(0.4, 0.47, 0.54) },
    uSkyHigh: { value: new THREE.Color(0.72, 0.77, 0.82) },
  };
  m.userData.glass = uniforms;
  m.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCloud;\nuniform vec3 uSkyLow;\nuniform vec3 uSkyHigh;')
      .replace('#include <roughnessmap_fragment>', [
        '#include <roughnessmap_fragment>',
        '{',
        // the pane: the inner square of the hatch (tile-local, any rotation), inside the hazard frame
        '  vec2 gq = abs(fract(vFocusWorld.xy + 0.5) - 0.5);',
        '  float glassK = 1.0 - smoothstep(0.355, 0.375, max(gq.x, gq.y));',
        '    float cl = texture2D(uCloud, vFocusWorld.xy * 0.06 + vec2(0.13, 0.41), 3.0).r * 0.7 + texture2D(uCloud, vFocusWorld.xy * 0.17, 2.0).r * 0.3;',
        '    vec3 sky = mix(uSkyLow, uSkyHigh, smoothstep(0.2, 0.8, cl));',
        '    vec3 under = diffuseColor.rgb;',
        '    diffuseColor.rgb = mix(under, sky + (under - vec3(0.35)) * 0.08, glassK);',
        '  roughnessFactor = mix(roughnessFactor, 0.22, glassK);',
        '  #ifdef USE_ROUGHNESSMAP',
        '    texelRoughness.g = mix(texelRoughness.g, 0.4, glassK);',   // the sheen (addFocus) sees an even pane
        '  #endif',
        '}',
      ].join('\n'));
  };
  m.customProgramCacheKey = () => 'sp-glass';
  return m;
}

/** MT_autochess_common: alpha-tested device plates (drawn slightly above the tops). */
export function decalMaterial(THREE, tex, focus) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.common, alphaTest: 0.408, roughness: 0.7, metalness: 0,
    emissiveMap: tex.commonE || null, emissive: tex.commonE ? new THREE.Color(0.559, 0.559, 0.559) : new THREE.Color(0, 0, 0),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return addFocus(m, focus);
}

/** Orange tubular fence railings. */
export function pipeMaterial(THREE, focus) {
  return addFocus(new THREE.MeshStandardMaterial({ color: 0xf0922b, roughness: 0.42, metalness: 0.35 }), focus);
}

/** Unlit textured material (Torappu/Unlit/Texture): background plane, wind device. */
export function unlitMaterial(THREE, map, color = 0xffffff, opts = {}) {
  return new THREE.MeshBasicMaterial({ map, color, fog: opts.fog ?? true, side: opts.side ?? THREE.FrontSide });
}

/**
 * Gate / objective box material ([opt]start_end_add: additive; [opt]start_end_ab: alpha blend). `uniforms.uPulse`
 * animates the intensity (the clip's _TintColor.a curve).
 */
export function gateMaterial(THREE, map, { additive = true, tint = [1, 1, 1] } = {}) {
  const uniforms = { map: { value: map }, uTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) }, uPulse: { value: 1 }, uFlash: { value: new THREE.Color(0, 0, 0) } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: [
      'varying vec2 vUv;',
      '#include <common>',
      '#include <fog_pars_vertex>',
      'void main() {',
      '  vUv = uv;',
      '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '  #include <fog_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D map;',
      'uniform vec3 uTint;',
      'uniform float uPulse;',
      'uniform vec3 uFlash;',
      'varying vec2 vUv;',
      '#include <common>',
      '#include <fog_pars_fragment>',
      'void main() {',
      '  vec4 t = texture2D(map, vUv);',
      '  vec3 c = t.rgb * uTint;',
      '  c = mix(c, uFlash * max(max(t.r, t.g), t.b) * 1.6, clamp(length(uFlash), 0.0, 1.0));',
      additive ? '  gl_FragColor = vec4(c * t.a * uPulse, 1.0);' : '  gl_FragColor = vec4(c, t.a * clamp(uPulse, 0.0, 1.0));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
  m.userData.additive = additive;
  return m;
}

/** Additive emissive strips (the cyan field edge); `map` = a dash pattern (alpha). */
export function glowMaterial(THREE, map, color = 0x39d6ff) {
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}

// ---- animated special terrain (ShaderMaterials, own cheap lighting) -------------------------------------------

const TERRAIN_VERT = [
  'varying vec2 vUv;',
  'varying vec3 vWorld;',
  '#include <common>',
  'void main() {',
  '  vUv = uv;',
  '  vec4 w = modelMatrix * vec4(position, 1.0);',
  '  vWorld = w.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * w;',
  '}',
].join('\n');

const FOCUS_GLSL = [
  'uniform vec4 uFocus; uniform float uFocusDim; uniform float uFocusSoft;',
  'float focusMask(vec2 q) { vec2 d = max(vec2(0.0), max(uFocus.xy - q, q - uFocus.zw)); return mix(uFocusDim, 1.0, 1.0 - smoothstep(0.0, uFocusSoft, length(d))); }',
].join('\n');

/** Deep sea: teal water with the official water normal map (two scrolling layers) and caustics. */
export function waterMaterial(THREE, tex, focus) {
  const uniforms = { uTime: { value: 0 }, uNormal: { value: tex.waterN || null }, uCaustics: { value: tex.caustics || null }, ...focus };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNormal; uniform sampler2D uCaustics;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  vec2 p = vWorld.xy * 0.45;',
      '  vec3 n1 = texture2D(uNormal, p + vec2(uTime * 0.03, uTime * 0.021)).xyz * 2.0 - 1.0;',
      '  vec3 n2 = texture2D(uNormal, p * 1.7 - vec2(uTime * 0.025, -uTime * 0.017)).xyz * 2.0 - 1.0;',
      '  vec3 n = normalize(vec3(n1.xy + n2.xy, 2.2));',
      '  vec3 L = normalize(vec3(-0.45, -0.3, 0.84));',
      '  float diff = clamp(dot(n, L), 0.0, 1.0);',
      '  vec3 V = normalize(vec3(0.0, -0.5, 0.866));',
      '  float spec = pow(clamp(dot(reflect(-L, n), V), 0.0, 1.0), 40.0);',
      '  float ca = texture2D(uCaustics, vWorld.xy * 0.6 + n.xy * 0.08 + vec2(uTime * 0.02, 0.0)).r;',
      '  vec3 deep = vec3(0.03, 0.2, 0.27), shallow = vec3(0.09, 0.46, 0.55);',
      '  vec3 c = mix(deep, shallow, 0.35 + 0.45 * diff) + ca * vec3(0.18, 0.32, 0.34) + spec * vec3(0.8, 0.95, 1.0);',
      '  c *= focusMask(vWorld.xy);',
      '  gl_FragColor = vec4(c, 0.9);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false,
  });
}

/** Mire: slow brown-green sludge (cloud noise), sticky bubbles. */
export function mireMaterial(THREE, tex, focus) {
  const uniforms = { uTime: { value: 0 }, uNoise: { value: tex.noise || null }, ...focus };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNoise;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  vec2 p = vWorld.xy * 0.35;',
      '  float a = texture2D(uNoise, p + vec2(uTime * 0.012, uTime * 0.008)).r;',
      '  float b = texture2D(uNoise, p * 2.3 - vec2(uTime * 0.01, -uTime * 0.014)).r;',
      '  float m = smoothstep(0.25, 0.75, a * 0.65 + b * 0.5);',
      '  vec3 c = mix(vec3(0.16, 0.19, 0.08), vec3(0.37, 0.4, 0.17), m);',
      '  float bub = smoothstep(0.82, 0.9, b) * (0.5 + 0.5 * sin(uTime * 3.0 + a * 20.0));',
      '  c += bub * vec3(0.35, 0.4, 0.2);',
      '  vec2 e = min(vUv, 1.0 - vUv);',
      '  float edge = smoothstep(0.0, 0.12, min(e.x, e.y));',
      '  c *= focusMask(vWorld.xy);',
      '  gl_FragColor = vec4(c, 0.86 * edge);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false,
  });
}

/**
 * 活性源石 (infection): dark originium crust patches with glowing, pulsing orange veins over the concrete. The palette
 * (`style.js ORIGINIUM`) and the recipe are the ones `render/textures.js originiumOverlay` draws on the 2D board —
 * two octaves of noise for the crust, the ridge of the fine one for the veins, a third for the crystal grains — so both
 * boards show ONE material (GitHub #184).
 * The noise is world-space, so the crust carries on into the neighbouring tile: there is deliberately NO per-tile edge
 * fade (the old `edge` term faded every tile out at its own border, which made a field of 活性源石 read as separate
 * patches instead of one floor).
 */
const V3 = (c) => `vec3(${c.map((v) => Number(v).toFixed(3)).join(', ')})`;

export function infectionMaterial(THREE, tex, focus) {
  const uniforms = { uTime: { value: 0 }, uNoise: { value: tex.noise || null }, ...focus };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNoise;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  float n = texture2D(uNoise, vWorld.xy * 0.55).r;',
      '  float n2 = texture2D(uNoise, vWorld.xy * 1.3 + 0.37).r;',
      '  float n3 = texture2D(uNoise, vWorld.xy * 3.1 + 0.11).r;',
      '  float crust = smoothstep(0.38, 0.62, n * 0.7 + n2 * 0.45);',
      '  float vein = smoothstep(0.86, 0.98, 1.0 - abs(n2 * 2.0 - 1.0)) * (0.35 + 0.65 * crust);',
      '  float grain = smoothstep(0.93, 1.0, n3) * crust;',
      '  float pulse = 0.6 + 0.4 * sin(uTime * 2.2 + n * 9.0);',
      `  vec3 base = mix(${V3(ORIGINIUM.base)}, ${V3(ORIGINIUM.crust)}, n2);`,
      `  vec3 glow = ${V3(ORIGINIUM.vein)} * (1.2 + 0.8 * pulse);`,
      '  vec3 c = mix(base, glow, vein);',
      `  c = mix(c, ${V3(ORIGINIUM.spec)} * (1.0 + 0.6 * pulse), grain);`,
      '  c *= focusMask(vWorld.xy);',
      '  float a = clamp(crust * 0.72 + vein, 0.0, 1.0);',
      '  gl_FragColor = vec4(c, a);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false,
  });
}

/** Smog: drifting exhaust haze (vertical billboards over the grilles). */
export function smogMaterial(THREE, tex, focus) {
  const uniforms = { uTime: { value: 0 }, uNoise: { value: tex.noise || null }, ...focus };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNoise;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  vec2 p = vec2(vUv.x * 0.8 + vWorld.x * 0.13, vUv.y * 0.7 - uTime * 0.12);',
      '  float n = texture2D(uNoise, p).r * 0.7 + texture2D(uNoise, p * 2.1 + vec2(uTime * 0.03, 0.0)).r * 0.5;',
      '  float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));',
      '  float a = smoothstep(0.3, 0.9, n) * fade * 0.8;',
      '  vec3 c = vec3(0.74, 0.79, 0.78) * focusMask(vWorld.xy);',
      '  gl_FragColor = vec4(c, a);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/**
 * Tuning of the official scene materials (sceneMaterial). The official shader (Torappu/Scene/StandardRealtimeShadow) is
 * not reproduced: the albedo is lit by the baked indirect light of the scene's lightmap plus the scene's key light
 * masked by its baked shadow, in linear light (Unity's Shadowmask lighting mode). `range` — the linear light a lightmap
 * texel of 1.0 stands for when scene.json has no lightRange; [ASSUMED] `ambient` — the light of a mesh without a
 * lightmap page; `direct` / `indirect` — gains of the two terms, both 1: the scene's own values (the key light's
 * `light.intensity`, and the lightmap's baked linear light, whose texel is (L / lightRange)^(1/2.2)). Anything below 1
 * darkens the board against the official render — 0.2.5 had 0.8 / 0.4 tuned by eye (GitHub #549, PR #554 by @xcdoge).
 */
export const SCENE_LIGHT = Object.freeze({ range: 8.0, ambient: 0.2, direct: 1, indirect: 1 });

const colorOf = (info, key, fallback = [1, 1, 1, 1]) => {
  const c = info && info.colors && Array.isArray(info.colors[key]) ? info.colors[key] : fallback;
  return [0, 1, 2, 3].map((i) => (Number.isFinite(c[i]) ? c[i] : fallback[i]));
};
const floatOf = (info, key, fallback) => (info && info.floats && Number.isFinite(info.floats[key]) ? info.floats[key] : fallback);
const hasKeyword = (info, kw) => !!(info && Array.isArray(info.keywords) && info.keywords.includes(kw));

/** Blend class of a scene material record (scene.json materials[name]): 'opaque' | 'cutout' | 'blend'. */
export function sceneBlend(info) {
  if (hasKeyword(info, '_ALPHABLEND_ON') || hasKeyword(info, '_ALPHAPREMULTIPLY_ON')) return 'blend';
  return hasKeyword(info, '_ALPHATEST_ON') ? 'cutout' : 'opaque';
}

/**
 * A lit material of an official scene: albedo (`map`, × _Color) × (the lightmap's baked light + key light · N·L ·
 * baked shadow (lightmap A, by _ShadowStrength)), alpha test / blend by the material's keywords, the focus falloff of
 * the other board materials. `map` is an sRGB texture; `lightMap` holds (light / lightRange)^(1/2.2) in RGB (no colour
 * space). Geometry attributes: position, normal, uv, aLm (lightmap uv), aColor.
 * @param {{ map?: any, lightMap?: any, info?: object, lightRange?: number, light?: { dir: number[], color: number[], intensity: number } }} o
 */
export function sceneMaterial(THREE, o, focus) {
  const info = o.info || null;
  const blend = sceneBlend(info);
  const L = o.light || { dir: [0.36, 0.45, 0.82], color: [1, 1, 1], intensity: 1 };
  const k = (Number.isFinite(L.intensity) ? L.intensity : 1) * SCENE_LIGHT.direct;
  const lin = (v) => Math.pow(Math.max(0, v), 2.2);   // the scene's colours are authored in gamma space
  const col = colorOf(info, '_Color');
  const uniforms = {
    uMap: { value: o.map || null }, uLm: { value: o.lightMap || null },
    uColor: { value: new THREE.Vector4(lin(col[0]), lin(col[1]), lin(col[2]), col[3]) },
    uCutoff: { value: blend === 'cutout' ? floatOf(info, '_Cutoff', 0.5) : 0 },
    uLmScale: { value: o.lightMap ? (o.lightRange > 0 ? o.lightRange : SCENE_LIGHT.range) * SCENE_LIGHT.indirect : 0 },
    uAmbient: { value: o.lightMap ? 0 : SCENE_LIGHT.ambient },
    uShadow: { value: floatOf(info, '_ShadowStrength', 1) },
    uLightDir: { value: new THREE.Vector3(...L.dir).normalize() },
    uLightColor: { value: new THREE.Vector3(lin(L.color[0]) * k, lin(L.color[1]) * k, lin(L.color[2]) * k) },
    ...focus,
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    defines: { ...(o.map ? { SCENE_MAP: 1 } : {}), ...(o.lightMap ? { SCENE_LM: 1 } : {}) },
    vertexShader: [
      'attribute vec2 aLm;',
      'varying vec2 vUv; varying vec2 vLm; varying vec3 vN; varying vec3 vWorld;',
      'void main() {',
      '  vUv = uv; vLm = aLm;',
      '  vN = normalize(mat3(modelMatrix) * normal);',
      '  vec4 w = modelMatrix * vec4(position, 1.0);',
      '  vWorld = w.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * w;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uMap; uniform sampler2D uLm; uniform vec4 uColor; uniform float uCutoff;',
      'uniform float uLmScale; uniform float uAmbient; uniform float uShadow; uniform vec3 uLightDir; uniform vec3 uLightColor;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec2 vLm; varying vec3 vN; varying vec3 vWorld;',
      'void main() {',
      '  vec4 a = uColor;',
      '  #ifdef SCENE_MAP',
      '    a *= texture2D(uMap, vUv);',
      '  #endif',
      '  if (a.a < uCutoff) discard;',
      '  vec3 light = vec3(uAmbient); float shade = 1.0;',
      '  #ifdef SCENE_LM',
      '    vec4 lm = texture2D(uLm, vLm);',
      '    light += pow(lm.rgb, vec3(2.2)) * uLmScale; shade = mix(1.0, lm.a, uShadow);',
      '  #endif',
      '  vec3 n = normalize(gl_FrontFacing ? vN : -vN);',
      '  light += uLightColor * max(dot(n, uLightDir), 0.0) * shade;',
      '  gl_FragColor = vec4(a.rgb * light * focusMask(vWorld.xy), a.a);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: blend === 'blend', depthWrite: blend !== 'blend',
  });
  m.userData.blend = blend;
  return m;
}

/** A water surface of an official scene (Torappu/Scene/StylizedWater): the board's water shader in the material's colours. */
export function sceneWaterMaterial(THREE, tex, focus, info) {
  const deep = colorOf(info, '_DeepWaterColor', [0.03, 0.2, 0.27, 0.7]), shallow = colorOf(info, '_ShallowWaterColor', [0.09, 0.46, 0.55, 0.5]);
  const uniforms = {
    uTime: { value: 0 }, uNormal: { value: tex.waterN || null }, uCaustics: { value: tex.caustics || null },
    uDeep: { value: new THREE.Vector4(...deep) }, uShallow: { value: new THREE.Vector4(...shallow) }, ...focus,
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: tex.waterN && tex.caustics ? { WATER_MAPS: 1 } : {},
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNormal; uniform sampler2D uCaustics; uniform vec4 uDeep; uniform vec4 uShallow;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'void main() {',
      '  float diff = 0.5, spec = 0.0, ca = 0.0;',
      '  #ifdef WATER_MAPS',
      '    vec2 p = vWorld.xy * 0.45;',
      '    vec3 n1 = texture2D(uNormal, p + vec2(uTime * 0.03, uTime * 0.021)).xyz * 2.0 - 1.0;',
      '    vec3 n2 = texture2D(uNormal, p * 1.7 - vec2(uTime * 0.025, -uTime * 0.017)).xyz * 2.0 - 1.0;',
      '    vec3 n = normalize(vec3(n1.xy + n2.xy, 2.2));',
      '    vec3 L = normalize(vec3(-0.45, -0.3, 0.84));',
      '    diff = clamp(dot(n, L), 0.0, 1.0);',
      '    spec = pow(clamp(dot(reflect(-L, n), normalize(vec3(0.0, -0.5, 0.866))), 0.0, 1.0), 40.0);',
      '    ca = texture2D(uCaustics, vWorld.xy * 0.6 + n.xy * 0.08 + vec2(uTime * 0.02, 0.0)).r;',
      '  #endif',
      '  vec4 w = mix(uDeep, uShallow, 0.08 + 0.2 * diff);',
      '  vec3 c = pow(w.rgb, vec3(2.2)) + ca * vec3(0.03, 0.05, 0.05) + spec * vec3(0.5, 0.6, 0.65);',
      '  gl_FragColor = vec4(c * focusMask(vWorld.xy), clamp(w.a + 0.2, 0.0, 1.0));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false,
  });
}

/**
 * Soft studio environment for image-based light (PMREM of a canvas equirect: bright sky with light panels above the
 * horizon, dark void below): gives the glass hatches, steel and gold frames their sheen and fills the shadows.
 * Y-up equirect — the scene rotates it to the board's z-up (scene.environmentRotation).
 */
export function environmentMap(THREE, renderer) {
  if (typeof document === 'undefined' || !renderer) return null;
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#dfe7ef'); grad.addColorStop(0.32, '#b9c3cc'); grad.addColorStop(0.5, '#6d757d');
  grad.addColorStop(0.56, '#262b30'); grad.addColorStop(1, '#0c0e10');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // overhead light panels (the arena's floodlights) for crisp highlights
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 6; i++) g.fillRect(8 + i * 42, 14 + (i % 2) * 8, 26, 7);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromEquirectangular(tex);
  pm.dispose();
  tex.dispose();
  return rt.texture;
}

/** Canvas texture of a dash pattern (cyan field edge). */
export function dashTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 8);
  const grad = g.createLinearGradient(0, 0, 0, 8);
  grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  for (let x = 2; x < 128; x += 32) g.fillRect(x, 0, 26, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft radial falloff texture (contact shadow of the island on the background, glow cards). */
export function softTexture(THREE, size = 64) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
