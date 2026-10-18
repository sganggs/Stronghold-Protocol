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
 * Gate / objective box material, after the client's Torappu/Particles/Additive and /AlphaBlend (GLES source in
 * [uc]shaders.ab): colour = 2 · vertex colour · _TintColor · tex, alpha clamped to [0, 1]; Additive blends SrcAlpha One,
 * AlphaBlend SrcAlpha OneMinusSrcAlpha. The client renders in gamma space, so this works on the texture's stored
 * (display) values: `map` must be a non-sRGB texture, and the result is written without a colour-space conversion.
 * `tint` = _TintColor.rgb, `uniforms.uAlpha` = _TintColor.a (animated by the box's clip). The box meshes carry no
 * vertex colours.
 * [ASSUMED] a mesh without vertex colours reads them as white (1, 1, 1, 1).
 */
export function gateMaterial(THREE, map, { additive = true, tint = [1, 1, 1] } = {}) {
  const uniforms = { map: { value: map }, uTint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) }, uAlpha: { value: 1 }, uFlash: { value: new THREE.Color(0, 0, 0) } };
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
      'uniform float uAlpha;',
      'uniform vec3 uFlash;',
      'varying vec2 vUv;',
      '#include <common>',
      '#include <fog_pars_fragment>',
      'void main() {',
      '  vec4 t = texture2D(map, vUv);',
      '  vec3 c = 2.0 * uTint * t.rgb;',
      '  float a = clamp(2.0 * uAlpha * t.a, 0.0, 1.0);',
      '  c = mix(c, uFlash * max(max(t.r, t.g), t.b) * 1.6, clamp(length(uFlash), 0.0, 1.0));',
      additive ? '  gl_FragColor = vec4(c * a, 1.0);' : '  gl_FragColor = vec4(c, a);',
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

// Board water and StylizedWater surfaces share waterMaterial below (GitHub #549).

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
 * Lighting of the official scene materials (sceneMaterial), after the official GLES program of
 * Torappu/Scene/StandardRealtimeShadow (shaders/standardrealtimeshadow.ab): Unity's mobile Standard BRDF in gamma
 * colour space (PlayerSettings m_ActiveColorSpace 0, LDR camera), all in display values —
 *   diffuse  = albedo × 0.779 · (1 − metallic)          specular = mix(0.221, albedo, metallic)
 *   colour   = (diffuse + specular · highlight) × key light × N·L × baked shadow
 *            + diffuse × lightmap (RGBM: 5 · A · RGB)
 *            + reflection cubemap (mip by roughness) × (1 − 0.28 · (1 − smoothness)³) × Fresnel(specular)
 * with N bent by the normal map. Emission is added after that sum when the material's `_EMISSION` keyword is on
 * and an emission map was loaded: texture(_EmissionMap).xyz * _EmissionColor.xyz, the term at the end of the GLES
 * fragment of Torappu/Scene/StandardRealtimeShadow and of Torappu/Scene/Standard (Android 26-04-13-12-31-42_e9b560;
 * both the normal keyword set and the cutout set). A map without the keyword is not sampled (MT_Syracuse_metro_floor).
 * `direct` / `indirect` — gains of the key light and of the lightmap (1 = the scene's
 * own values). `range` — the display-space light a lightmap texel of 1.0 stands for when scene.json has no
 * lightRange. Not drawn: the realtime shadow map of the units (_ShadowStrength scales only that one), the
 * vertex-colour blend.
 * [ASSUMED] (inferred, not read from the client):
 *   - `ambient` — the light of a mesh without a lightmap page;
 *   - SCENE_LM_V1 — a scene extracted before scene.json `lightEncoding` stores (L_linear / 8)^(1/2.2) per channel; the
 *     shader rebuilds the display value by un-gamma-ing each channel's ratio to the brightest one, an approximation
 *     (a few percent bright), exact only after the scene is extracted again;
 *   - the tangent frame of the normal map — built from screen-space derivatives with t along +u and b along +v
 *     (scene.bin has no tangents); the sign of the bump was not checked against the client surface by surface;
 *   - reflection probes — one cubemap per scene, chosen at the board's anchor: the baked cubemap of the
 *     ReflectionProbe whose box holds the board (act2autochess_m01 / m03, at the probe's intensity), else the
 *     scene's default reflection; a renderer outside that box and the blend at its edge are not reproduced;
 *   - the vertex-colour blend is left out on the reading that it is a tile buried in sand
 *     (mix(albedo, _BlendColor, smoothstep(colour.r) · _BlendStrength) in the program) which the client uncovers at
 *     run time by a rule not found yet; drawn as written it covers every patterned tile of the field.
 *   - the emission map is an sRGB colour map, sampled with toDisplay like albedo: the client's gamma shader reads
 *     the stored bytes as display values. The colour is colors._EmissionColor (rgb); there is no second key;
 *   - the sum, including emission, is then clamped to 0–1 with the rest of the lighting. The client writes that
 *     sum unclamped (no bloom pass here). _EmissionBloomFilter is not read.
 */
export const SCENE_LIGHT = Object.freeze({ range: 3.0, ambient: 0.5, direct: 1, indirect: 1 });

/**
 * Cube texture of a scene's decoded reflection atlas (scenes.py env_atlas: mip m in the row at y = Σ sizes of the
 * mips before it, face f at x = f · (size >> m); texels in display values / env.range). The faces keep the client's
 * layout, so the shader looks it up with the Unity-space direction (board z negated). Null without a DOM canvas.
 * @param {{ size: number, mips: number }} env  scene.json `env`
 */
export function sceneEnvTexture(THREE, image, env) {
  const size = env && env.size | 0, mips = env && env.mips | 0;
  if (!image || !(size > 0) || !(mips > 0) || typeof document === 'undefined') return null;
  const levels = [];
  for (let m = 0, y = 0; m < mips; m++) {
    const s = Math.max(1, size >> m), faces = [];
    for (let f = 0; f < 6; f++) {
      const cv = document.createElement('canvas');
      cv.width = s; cv.height = s;
      cv.getContext('2d').drawImage(image, f * s, y, s, s, 0, 0, s, s);
      faces.push(cv);
    }
    levels.push(faces);
    y += s;
  }
  const t = new THREE.CubeTexture(levels[0]);
  t.mipmaps = levels.slice(1).map((faces) => ({ image: faces }));   // the client's pre-filtered mips, not generated ones
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

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
 * A lit material of an official scene, lit in display (gamma) space like the client (SCENE_LIGHT has the formula):
 * albedo `map` × _Color, the lightmap's baked light, the key light masked by the baked shadow (lightmap A), the
 * reflection of `env`, the normal and metallic-gloss maps, then emission; alpha test / blend by the material's
 * keywords; the focus falloff of the other board materials. Emission (`SCENE_EMIS`) is on only when the material's
 * `_EMISSION` keyword is on and `emissionMap` loaded: toDisplay(map) * _EmissionColor.rgb, added before the clamp.
 * A scene.json without those keys, a missing map, or a map whose keyword is off (the Syracuse floor) adds nothing.
 * Without `env` (a scene extracted before the reflection atlas) the material
 * is the plain sum albedo × (lightmap + key light · N·L · shadow), which lands within about 10 % of the full formula.
 * `map` and `emissionMap` are sRGB textures; `normalMap` (RGB = xyz · 0.5 + 0.5), `glossMap` (R = metallic, A = smoothness) and `env`
 * (sceneEnvTexture, texels / `envRange`) carry no colour space. `lightMap` holds Unity's gamma-space RGBM value
 * (5 · A · RGB) / lightRange in RGB when `lightEncoding` is 'gamma'; a page of an older extraction holds
 * (5^2.2 · A^2.2 · RGB / lightRange)^(1/2.2), from which the same value is read back to within a few percent (the
 * brightest channel of RGB is taken as 1). Geometry attributes: position, normal, uv, aLm (lightmap uv), aColor.
 * @param {{ map?: any, lightMap?: any, normalMap?: any, glossMap?: any, emissionMap?: any, env?: any, envRange?: number, info?: object, lightRange?: number, lightEncoding?: string, light?: { dir: number[], color: number[], intensity: number } }} o
 */
export function sceneMaterial(THREE, o, focus) {
  const info = o.info || null;
  const blend = sceneBlend(info);
  const L = o.light || { dir: [0.36, 0.45, 0.82], color: [1, 1, 1], intensity: 1 };
  const k = (Number.isFinite(L.intensity) ? L.intensity : 1) * SCENE_LIGHT.direct;
  const col = colorOf(info, '_Color');
  const gamma = o.lightEncoding === 'gamma';
  const range = o.lightRange > 0 ? o.lightRange : (gamma ? SCENE_LIGHT.range : 8);
  const pbs = !!o.env;
  // The client's program samples _EmissionMap only in the _EMISSION variant. Unity's unset colour is black.
  const emis = hasKeyword(info, '_EMISSION') && !!o.emissionMap;
  const emisCol = emis ? colorOf(info, '_EmissionColor', [0, 0, 0, 1]) : [0, 0, 0, 1];
  const uniforms = {
    uMap: { value: o.map || null }, uLm: { value: o.lightMap || null },
    uColor: { value: new THREE.Vector4(col[0], col[1], col[2], col[3]) },   // display values, like the texture's stored ones
    uCutoff: { value: blend === 'cutout' ? floatOf(info, '_Cutoff', 0.5) : 0 },
    uLmScale: { value: o.lightMap ? (gamma ? range : Math.pow(range, 1 / 2.2)) * SCENE_LIGHT.indirect : 0 },
    uAmbient: { value: o.lightMap ? 0 : SCENE_LIGHT.ambient },
    uLightDir: { value: new THREE.Vector3(...L.dir).normalize() },
    uLightColor: { value: new THREE.Vector3(L.color[0] * k, L.color[1] * k, L.color[2] * k) },
    uEnv: { value: o.env || null }, uEnvScale: { value: pbs ? (o.envRange > 0 ? o.envRange : 1) : 0 },
    uNormal: { value: pbs ? o.normalMap || null : null }, uGlossMap: { value: pbs ? o.glossMap || null : null },
    uEmissionMap: { value: emis ? o.emissionMap : null },
    uEmissionColor: { value: new THREE.Vector3(emisCol[0], emisCol[1], emisCol[2]) },
    // _BumpScale, metallic, smoothness (the gloss map's scale with a map, else the material's own two values)
    uSurface: { value: new THREE.Vector3(floatOf(info, '_BumpScale', 1), floatOf(info, '_Metallic', 0), floatOf(info, o.glossMap ? '_GlossMapScale' : '_Glossiness', o.glossMap ? 1 : 0)) },
    ...focus,
  };
  const m = new THREE.ShaderMaterial({
    uniforms,
    defines: {
      ...(o.map ? { SCENE_MAP: 1 } : {}), ...(o.lightMap ? { SCENE_LM: 1 } : {}), ...(o.lightMap && !gamma ? { SCENE_LM_V1: 1 } : {}),
      ...(pbs ? { SCENE_PBS: 1 } : {}), ...(pbs && o.normalMap ? { SCENE_NORMAL: 1 } : {}), ...(pbs && o.glossMap ? { SCENE_GLOSS: 1 } : {}),
      ...(emis ? { SCENE_EMIS: 1 } : {}),
    },
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
      'uniform float uLmScale; uniform float uAmbient; uniform vec3 uLightDir; uniform vec3 uLightColor;',
      'uniform samplerCube uEnv; uniform float uEnvScale; uniform sampler2D uNormal; uniform sampler2D uGlossMap; uniform vec3 uSurface;',
      'uniform sampler2D uEmissionMap; uniform vec3 uEmissionColor;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec2 vLm; varying vec3 vN; varying vec3 vWorld;',
      // linear light ↔ display values (sRGB): the inverses of the texture decode and of <colorspace_fragment>
      'vec3 toDisplay(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
      'vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }',
      'void main() {',
      '  vec4 a = uColor;',
      '  #ifdef SCENE_MAP',
      '    vec4 t = texture2D(uMap, vUv);',
      '    a *= vec4(toDisplay(t.rgb), t.a);',
      '  #endif',
      '  if (a.a < uCutoff) discard;',
      '  vec3 light = vec3(uAmbient); float shade = 1.0;',
      '  #ifdef SCENE_LM',
      '    vec4 lm = texture2D(uLm, vLm);',
      // [ASSUMED] pages of an earlier extraction (linear reading, range 8): an approximate read-back, see SCENE_LIGHT
      '    #ifdef SCENE_LM_V1',
      '      float mx = max(max(lm.r, lm.g), max(lm.b, 1e-4));',
      '      lm.rgb = mx * pow(lm.rgb / mx, vec3(2.2));',
      '    #endif',
      '    light += lm.rgb * uLmScale; shade = lm.a;',
      '  #endif',
      '  vec3 n = normalize(gl_FrontFacing ? vN : -vN);',
      '  #ifdef SCENE_PBS',
      '    float metallic = uSurface.y, smoothness = uSurface.z;',
      '    #ifdef SCENE_GLOSS',
      '      vec4 mg = texture2D(uGlossMap, vUv);',
      '      metallic = mg.r; smoothness = mg.a * uSurface.z;',
      '    #endif',
      '    #ifdef SCENE_NORMAL',
      // [ASSUMED] tangent frame from the screen-space derivatives (scene.bin has no tangents): t along +u, b along +v
      '      vec3 q0 = dFdx(vWorld), q1 = dFdy(vWorld); vec2 s0 = dFdx(vUv), s1 = dFdy(vUv);',
      '      float det = s0.x * s1.y - s1.x * s0.y;',
      '      vec3 tu = (q0 * s1.y - q1 * s0.y) * sign(det), bv = (q1 * s0.x - q0 * s1.x) * sign(det);',
      '      tu -= n * dot(n, tu); bv -= n * dot(n, bv);',
      '      if (dot(tu, tu) > 0.0 && dot(bv, bv) > 0.0) {',
      '        vec3 nt = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;',
      '        nt.xy *= uSurface.x;',
      '        n = normalize(normalize(tu) * nt.x + normalize(bv) * nt.y + n * nt.z);',
      '      }',
      '    #endif',
      '    float omr = 0.779083729 * (1.0 - metallic);',
      '    vec3 diff = a.rgb * omr, spec = mix(vec3(0.220916301), a.rgb, metallic);',
      '    vec3 view = normalize(vWorld - cameraPosition);',
      '    float rough = 1.0 - smoothness, r2 = rough * rough;',
      '    vec3 hv = normalize(uLightDir - view);',
      '    float nl = clamp(dot(n, uLightDir), 0.0, 1.0), nh = clamp(dot(n, hv), 0.0, 1.0);',
      '    float nv = clamp(dot(n, -view), 0.0, 1.0), lh = clamp(dot(uLightDir, hv), 0.0, 1.0);',
      '    float d = nh * nh * (r2 * r2 - 1.0) + 1.00001;',
      '    float highlight = clamp(r2 / (d * max(lh, 0.32) * (r2 + 1.5)) - 1e-4, 0.0, 100.0);',
      '    vec3 rd = reflect(view, n);',
      '    vec3 env = textureLod(uEnv, vec3(rd.x, rd.y, -rd.z), rough * (1.7 - 0.7 * rough) * 6.0).rgb * uEnvScale;',
      '    float fres = 1.0 - nv; fres *= fres; fres *= fres;',
      '    vec3 lit = (diff + spec * highlight) * uLightColor * (shade * nl) + diff * light',
      '      + env * (1.0 - 0.28 * r2 * rough) * mix(spec, vec3(clamp(smoothness + 1.0 - omr, 0.0, 1.0)), fres);',
      '  #else',
      '    vec3 lit = a.rgb * (light + uLightColor * max(dot(n, uLightDir), 0.0) * shade);',
      '  #endif',
      // Client GLES, after the BRDF, not × albedo: texture(_EmissionMap).xyz * _EmissionColor.xyz + lit.
      // [ASSUMED] sRGB → toDisplay, then the existing 0–1 clamp (the client writes the sum unclamped).
      '  #ifdef SCENE_EMIS',
      '    lit += toDisplay(texture2D(uEmissionMap, vUv).rgb) * uEmissionColor;',
      '  #endif',
      '  vec3 c = toLinear(clamp(lit, 0.0, 1.0));',
      '  gl_FragColor = vec4(c * focusMask(vWorld.xy), a.a);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: blend === 'blend', depthWrite: blend !== 'blend',
  });
  m.userData.blend = blend;
  return m;
}

/**
 * The official device shader (Torappu/Scene/Trap/Shadow — 射击台 and 阻隔工事, trap_1106_achplat / trap_1105_accrate):
 * albedo × (_Ambient + _Diffuse · N·L) in display values, so the model reads nearly flat-lit like in the client.
 * `info` is the material record (mesh/trap_110/materials.json), `lightDir` the key light direction in board space
 * (an official scene's own light when it is drawn). [ASSUMED] the formula, inferred from the material's two lighting
 * parameters (the shader program was not read); the client's realtime shadow on the model is not reproduced.
 */
export function trapMaterial(THREE, map, focus, info = null, lightDir = [0.36, 0.45, 0.82]) {
  const uniforms = {
    uMap: { value: map || null },
    uOpacity: { value: 1 },
    uAmbient: { value: floatOf(info, '_Ambient', 0.9) }, uDiffuse: { value: floatOf(info, '_Diffuse', 0.2) },
    uLightDir: { value: new THREE.Vector3(...lightDir).normalize() },
    ...focus,
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: [
      'varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;',
      'void main() {',
      '  vUv = uv;',
      '  vN = normalize(mat3(modelMatrix) * normal);',
      '  vec4 w = modelMatrix * vec4(position, 1.0);',
      '  vWorld = w.xyz;',
      '  gl_Position = projectionMatrix * viewMatrix * w;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uMap; uniform float uOpacity; uniform float uAmbient; uniform float uDiffuse; uniform vec3 uLightDir;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;',
      'vec3 toDisplay(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
      'vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }',
      'void main() {',
      '  vec3 a = toDisplay(texture2D(uMap, vUv).rgb);',
      '  vec3 n = normalize(gl_FrontFacing ? vN : -vN);',
      '  vec3 lit = a * (uAmbient + uDiffuse * max(dot(n, uLightDir), 0.0));',
      '  gl_FragColor = vec4(toLinear(clamp(lit, 0.0, 1.0)) * focusMask(vWorld.xy), uOpacity);',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
}

/**
 * [ASSUMED] Procedural-board compatibility defaults. RGB is now in display values: the old linear deep/shallow
 * colours encoded as sRGB; caustics/specular tints approximate the old output after that encoding. Keep the old
 * normal tiling, speeds, light, wet blend, exponent and opacity so a missing scene does not darken the metal board.
 */
export const WATER_DEFAULTS = Object.freeze({
  deep: [0.189748, 0.484529, 0.556393, 0.9], shallow: [0.331830, 0.708370, 0.767376, 0.9],
  tiling: 0.45, normalTiling: 0.765, bumpScale: 1 / 2.2,
  waterSpeed: [0.03, 0.021], flowSpeed: [-0.025, 0.017],
  causticsTiling: 0.6, causticsSpeed: 0.02, causticsBrightness: 1,
  sunDir: [-0.45, -0.3, 0.84], viewDir: [0, -0.5, 0.866], skyStrength: 0, colorIntensity: 1, specPower: 40,
  wet: [0.35, 0.45], causticsTint: [0.28, 0.25, 0.23], specTint: [0.8, 0.65, 0.6],
});

/** Missing fields of a surface record: dumped MT_AutochessSand_water, level_act1autochess_m01.ab. */
export const SCENE_WATER_DEFAULTS = Object.freeze({
  deep: [0, 0.270538, 0.404412, 0.672], shallow: [0.389706, 1, 0.696957, 0.503],
  tiling: 0.45, normalTiling: 0.562, bumpScale: 0.55,
  waterSpeed: [0.73, 0.59], flowSpeed: [0.1, 0.07],
  causticsTiling: 0.47, causticsSpeed: 0.277, causticsBrightness: 0.377,
  sunDir: [0.34, 0.64, -0.94], skyStrength: 0.767, colorIntensity: 1.15, glossiness: 0.975,
});

/**
 * [ASSUMED] StylizedWater approximations, NOT the official shader formula. Display-space gains, for screenshot
 * review: reflection replaces part of the base colour, never adds a second sky. With the decoded cubemap reduce
 * PR #555's sky .22 → .15, specular 1.6 → .6, caustics .35 → .2 to avoid double brightening; without it retain .22,
 * 1.6, .35 for the gradient approximation. Alpha +.2 stays: it changes coverage, not the light sum.
 * Smoothness → Phong exponent ×128 (minimum 2), wet = .08 + .2 N·L in lieu of shore depth, fixed tints/distortion
 * and the gradient stops are estimates. The board's normal/caustics textures stand in for the material's maps;
 * _SkyCurvatureMask, _CausticCtrl, foam, flow distortion and the separate sun-disc controls are not reproduced.
 */
export const WATER_TUNING = Object.freeze({
  envSkyGain: 0.15, skyGain: 0.22,
  envSpecGain: 0.6, specGain: 1.6,
  envCausticsGain: 0.2, causticsGain: 0.35,
  alphaLift: 0.2, specExponent: 128, minSpecPower: 2,
  wet: [0.08, 0.2], specTint: [0.5, 0.6, 0.65], causticsTint: [0.55, 0.85, 0.9],
  causticsDistortion: 0.08, skyLow: [0.10, 0.12, 0.15], skyHigh: [0.30, 0.36, 0.44],
});

/** One mapping from the record's Unity names to our uniforms, shared by construction and scene changes. */
function waterParams(info, reflection = {}) {
  const D = info ? SCENE_WATER_DEFAULTS : WATER_DEFAULTS, K = WATER_TUNING;
  const env = reflection.env || null;
  const sun = colorOf(info, '_SunDir', [...D.sunDir, 0]).slice(0, 3);
  // scene.bin is anchor-local Unity with z negated. [ASSUMED] _SunDir is a direction toward the custom sun in
  // that same frame; PR #555 left its negative z unchanged, putting the sun below our z-up water.
  if (info) sun[2] = -sun[2];
  const len = Math.hypot(...sun);
  const pair = (key, d) => colorOf(info, key, [...d, 0, 0]).slice(0, 2);
  const gain = (withEnv, withoutEnv) => info ? (env ? withEnv : withoutEnv) : 1;
  const rough = Math.max(0, Math.min(1, 1 - floatOf(info, '_Glossiness', info ? D.glossiness : 1)));
  return {
    uDeep: colorOf(info, '_DeepWaterColor', D.deep), uShallow: colorOf(info, '_ShallowWaterColor', D.shallow),
    uTiling: floatOf(info, '_Tiling', D.tiling), uNormalTiling: floatOf(info, '_NormalTiling', D.normalTiling),
    uBumpScale: floatOf(info, '_BumpScale', D.bumpScale),
    uWaterSpeed: pair('_WaterSpeed', D.waterSpeed), uFlowSpeed: pair('_FlowSpeed', D.flowSpeed),
    uCausticsTiling: floatOf(info, '_CausticsTiling', D.causticsTiling),
    uCausticsSpeed: floatOf(info, '_CausticsSpeed', D.causticsSpeed),
    uCausticsGain: floatOf(info, '_CausticsBrightness', D.causticsBrightness) * gain(K.envCausticsGain, K.causticsGain),
    uSunDir: len > 0 ? sun.map((v) => v / len) : [0, 0, 1],
    uViewDir: info ? [0, 0, 0] : D.viewDir, // fixed old board view; official surfaces use the actual camera
    uSkyStrength: floatOf(info, '_SkyStrength', D.skyStrength) * gain(K.envSkyGain, K.skyGain),
    uColorIntensity: floatOf(info, '_WaterColorIntensity', D.colorIntensity),
    uSpecPower: info ? Math.max(K.minSpecPower, floatOf(info, '_Glossiness', D.glossiness) * K.specExponent) : D.specPower,
    uWet: info ? K.wet : D.wet, uAlphaLift: info ? K.alphaLift : 0,
    uSpecTint: (info ? K.specTint : D.specTint).map((v) => v * gain(K.envSpecGain, K.specGain)),
    uCausticsTint: info ? K.causticsTint : D.causticsTint,
    uEnv: env, uEnvScale: env ? (reflection.envRange > 0 ? reflection.envRange : 1) : 0,
    // [ASSUMED] match sceneMaterial's roughness curve; use the extracted mip count (8 today), not a new atlas.
    uEnvLod: rough * (1.7 - 0.7 * rough) * Math.max(0, (reflection.envMips || 7) - 1),
  };
}

/**
 * One shader for the board's water tiles and StylizedWater surfaces. No record → WATER_DEFAULTS; incomplete
 * records → SCENE_WATER_DEFAULTS. Reflection is the SAME decoded cube owned by _sceneResources, never disposed
 * here. Without a cube use PR #555's sky gradient. World-space waves keep board and scene surfaces in phase.
 *
 * Colour contract (#571): material RGB and decoded env RGB × envRange are display (Gamma) values. Water colour,
 * reflection, caustics and highlights combine THERE. Clamp, then exact sRGB toLinear, then the shared linear focus
 * falloff and <colorspace_fragment>. Do not pow(colour, 2.2) before adding light: that recreates the old mismatch.
 *
 * @param {any} THREE
 * @param {{ waterN?: any, caustics?: any }} tex
 * @param {object} focus
 * @param {object|null} [info]
 * @param {{ env?: any, envRange?: number, envMips?: number }} [reflection]
 */
export function waterMaterial(THREE, tex, focus, info = null, reflection = {}) {
  const uniforms = {
    uTime: { value: 0 }, uNormal: { value: tex.waterN || null }, uCaustics: { value: tex.caustics || null }, ...focus,
  };
  for (const [name, value] of Object.entries(waterParams(info, reflection))) {
    const Vector = Array.isArray(value) && [null, null, THREE.Vector2, THREE.Vector3, THREE.Vector4][value.length];
    uniforms[name] = { value: Vector ? new Vector(...value) : value };
  }
  const m = new THREE.ShaderMaterial({
    uniforms,
    defines: { ...(tex.waterN ? { WATER_NORMAL: 1 } : {}), ...(tex.caustics ? { WATER_CAUSTICS: 1 } : {}), ...(reflection.env ? { WATER_ENV: 1 } : {}) },
    vertexShader: TERRAIN_VERT,
    fragmentShader: [
      'uniform float uTime; uniform sampler2D uNormal; uniform sampler2D uCaustics; uniform vec4 uDeep; uniform vec4 uShallow;',
      'uniform float uTiling; uniform float uNormalTiling; uniform float uBumpScale; uniform vec2 uWaterSpeed; uniform vec2 uFlowSpeed;',
      'uniform float uCausticsTiling; uniform float uCausticsSpeed; uniform float uCausticsGain; uniform vec3 uCausticsTint;',
      'uniform vec3 uSunDir; uniform vec3 uViewDir; uniform float uSkyStrength; uniform float uColorIntensity; uniform float uSpecPower; uniform vec3 uSpecTint;',
      'uniform vec2 uWet; uniform float uAlphaLift; uniform samplerCube uEnv; uniform float uEnvScale; uniform float uEnvLod;',
      FOCUS_GLSL,
      'varying vec2 vUv; varying vec3 vWorld;',
      'vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }',
      'void main() {',
      '  vec3 n = vec3(0.0, 0.0, 1.0);',
      '  #ifdef WATER_NORMAL',
      '    vec3 n1 = texture2D(uNormal, vWorld.xy * uTiling + uTime * uWaterSpeed).xyz * 2.0 - 1.0;',
      '    vec3 n2 = texture2D(uNormal, vWorld.xy * uNormalTiling + uTime * uFlowSpeed).xyz * 2.0 - 1.0;',
      '    n = normalize(vec3((n1.xy + n2.xy) * uBumpScale, 1.0));',
      '  #endif',
      '  vec3 view = dot(uViewDir, uViewDir) > 0.0 ? -normalize(uViewDir) : normalize(vWorld - cameraPosition);',
      '  float diff = clamp(dot(n, uSunDir), 0.0, 1.0);',
      '  float spec = pow(clamp(dot(reflect(-uSunDir, n), -view), 0.0, 1.0), uSpecPower);',
      '  float ca = 0.0;',
      '  #ifdef WATER_CAUSTICS',
      `    ca = texture2D(uCaustics, vWorld.xy * uCausticsTiling + n.xy * ${WATER_TUNING.causticsDistortion} + vec2(uTime * uCausticsSpeed, 0.0)).r;`,
      '  #endif',
      '  vec3 rd = reflect(view, n);',
      '  #ifdef WATER_ENV',
      '    vec3 sky = textureLod(uEnv, vec3(rd.x, rd.y, -rd.z), uEnvLod).rgb * uEnvScale;',
      '  #else',
      `    vec3 sky = mix(${V3(WATER_TUNING.skyLow)}, ${V3(WATER_TUNING.skyHigh)}, clamp(rd.z * 0.5 + 0.5, 0.0, 1.0));`,
      '  #endif',
      '  vec4 w = mix(uDeep, uShallow, clamp(uWet.x + uWet.y * diff, 0.0, 1.0));',
      '  vec3 lit = mix(w.rgb * uColorIntensity, sky, clamp(uSkyStrength, 0.0, 1.0));',
      '  lit += ca * uCausticsGain * uCausticsTint + spec * uSpecTint;',
      '  vec3 c = toLinear(clamp(lit, 0.0, 1.0));',
      '  gl_FragColor = vec4(c * focusMask(vWorld.xy), clamp(w.a + uAlphaLift, 0.0, 1.0));',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
    transparent: true, depthWrite: false,
  });
  m.userData.water = true;
  return applyWaterMaterial(m, info, reflection);
}

/** Update only our water materials; a missing record resets every parameter and a missing cube removes WATER_ENV. */
export function applyWaterMaterial(material, info, reflection = {}) {
  if (!material?.userData?.water || !material.uniforms) return material;
  for (const [name, value] of Object.entries(waterParams(info, reflection))) {
    const u = material.uniforms[name];
    if (!u) continue;
    if (Array.isArray(value) && typeof u.value?.set === 'function') u.value.set(...value);
    else u.value = value;
  }
  const hadEnv = !!material.defines.WATER_ENV;
  if (reflection.env) material.defines.WATER_ENV = 1; else delete material.defines.WATER_ENV;
  if (hadEnv !== !!reflection.env) material.needsUpdate = true;
  return material;
}

/** Compatibility entry point; surface water always uses the board's shader. */
export const sceneWaterMaterial = waterMaterial;

/**
 * Legacy kind:water non-surface records (DynamicWaterTile). Keep their existing rendering outside this water port;
 * they are platform decals, not StylizedWater, and must not select the board's water parameters or reflections.
 */
export function sceneWaterDecalMaterial(THREE, tex, focus, info) {
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
  // The framebuffer stays alive after the texture is returned. BoardScene.destroy frees it
  // (a 3D rebuild is destroy + a new BoardScene). [ASSUMED] WebGLRenderTarget.dispose also
  // disposes this texture, so destroy does not dispose the texture a second time.
  rt.texture.userData.pmremTarget = rt;
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
