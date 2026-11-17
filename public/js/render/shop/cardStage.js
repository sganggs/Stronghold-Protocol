





























const VERT = `#version 300 es
  in vec2 aPos;
  in vec2 aUV;
  uniform vec4 uRect;
  uniform vec2 uView;
  uniform float uAngle;
  uniform vec2 uScale;
  uniform vec2 uPivot;
  out vec2 vUV;
  void main() {
    vUV = aUV;
    float px = uRect.x + aUV.x * uRect.z;
    float py = uRect.y + aUV.y * uRect.w;
    vec2 d = (vec2(px, py) - uPivot) * uScale;
    float c = cos(uAngle);
    float s = sin(uAngle);
    vec2 r = vec2(d.x * c - d.y * s, d.x * s + d.y * c) + uPivot;
    gl_Position = vec4(r.x / uView.x * 2.0 - 1.0, 1.0 - r.y / uView.y * 2.0, 0.0, 1.0);
  }`;

const FRAG = `#version 300 es
  precision mediump float;
  in vec2 vUV;
  out vec4 outColor;
  uniform sampler2D uBase;
  uniform highp vec4 uRect;
  uniform sampler2D uMask;
  uniform sampler2D uDiss;
  uniform sampler2D uSoft;
  uniform vec4 uSoftRect;
  uniform vec4 uSoftWeights;
  uniform float uSoftMix;
  uniform vec2 uBaseTile;
  uniform vec2 uBaseOffset;
  uniform vec2 uMaskTile;
  uniform vec2 uMaskOffset;
  uniform vec2 uDissTile;
  uniform vec2 uDissOffset;
  uniform float uHasBase;
  uniform float uHasMask;
  uniform float uHasDiss;
  uniform float uMaskInvert;
  uniform float uDissInvert;
  uniform float uProgress;
  uniform float uSmooth;
  uniform float uAlphaClip;
  uniform vec4 uTint;
  uniform float uIsText;
  uniform float uFlipV;
  uniform float uFlipDiss;
  uniform float uRawUv;
  uniform float uRawFlipV;
  uniform float uBaseChannel;

  void main() {
    vec4 base;
    if (uRawUv > 0.5) {







      float sweepS = vUV.y * uBaseTile.y + (uRawFlipV > 0.5 ? -uBaseOffset.y : uBaseOffset.y);


      if (uRawFlipV > 0.5) sweepS = clamp(sweepS, 0.0, 1.0); else sweepS = fract(sweepS);
      vec2 uv = vec2(fract(vUV.x * uBaseTile.x + uBaseOffset.x), 1.0 - sweepS);
      base = uHasBase > 0.5 ? texture(uBase, uv) : vec4(1.0);
    } else {

      vec2 baseUV = vUV;
      if (uFlipV > 0.5) baseUV.y = 1.0 - baseUV.y;
      base = uHasBase > 0.5 ? texture(uBase, fract(baseUV * uBaseTile + uBaseOffset)) : vec4(1.0);
    }

    vec3 rgb;
    float alpha;
    if (uBaseChannel > 0.5) {



      rgb = uTint.rgb;
      alpha = base.r * uTint.a;
    } else {
      rgb = base.rgb * uTint.rgb;
      alpha = base.a * uTint.a;
    }
    if (uHasMask > 0.5) {



      vec2 maskUV = uRawUv > 0.5
        ? vec2(fract(vUV.x * uMaskTile.x + uMaskOffset.x), 1.0 - fract(vUV.y * uMaskTile.y + uMaskOffset.y))
        : fract(vUV * uMaskTile + uMaskOffset);
      float m = texture(uMask, maskUV).a;
      if (uMaskInvert > 0.5) m = 1.0 - m;
      alpha *= m;
    }
    if (uHasDiss > 0.5) {
      vec2 dissUV = vUV;
      if (uFlipDiss > 0.5) dissUV.y = 1.0 - dissUV.y;
      vec2 duv = uRawUv > 0.5
        ? vec2(fract(vUV.x * uDissTile.x + uDissOffset.x), 1.0 - fract(vUV.y * uDissTile.y + uDissOffset.y))
        : fract(dissUV * uDissTile + uDissOffset);
      float d = texture(uDiss, duv).r;
      if (uDissInvert > 0.5) d = 1.0 - d;
      float x = clamp((d - uProgress) / max(uSmooth, 0.0001), 0.0, 1.0);
      alpha *= x * x * (3.0 - 2.0 * x);
    }
    if (uSoftMix > 0.5) {

      vec2 cardPx = uRect.xy + vUV * uRect.zw;
      vec2 uv = (cardPx - uSoftRect.xy) / max(uSoftRect.zw, vec2(1.0));
      vec4 s = texture(uSoft, uv);



      float inRect = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float m = (s.r * uSoftWeights.r + s.g * uSoftWeights.g + s.b * uSoftWeights.b + s.a * uSoftWeights.a) * inRect;
      alpha *= m;
    }
    if (uAlphaClip > 0.5 && alpha < 0.004) discard;
    outColor = vec4(rgb, alpha);
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


export const UNITY_FONT_METRICS = {
  'Novecentowide-Medium': { ascent: 16.8, descent: -2.4, lineSpacing: 19.2, fontSize: 16, characterPadding: 1 },
};


export function fontMetrics(family, fontPx, measure) {
  const unity = UNITY_FONT_METRICS[family];
  if (unity) {
    const k = fontPx / unity.fontSize;
    return {
      ascent: unity.ascent * k,
      descent: unity.descent * k,
      lineHeight: unity.lineSpacing * k,


      padding: (Number(unity.characterPadding) || 0) * k,
    };
  }


  const probe = measure.measureText('0');
  const ascent = Number.isFinite(probe.fontBoundingBoxAscent) ? probe.fontBoundingBoxAscent : fontPx * 1.05;
  const descent = Number.isFinite(probe.fontBoundingBoxDescent) ? probe.fontBoundingBoxDescent : fontPx * 0.15;
  return { ascent, descent: -descent, lineHeight: ascent + descent, padding: 0 };
}


export function sliceQuads(slice, x, y, w, h, unitPx) {
  const sw = Number(slice && slice.spriteW);
  const sh = Number(slice && slice.spriteH);
  if (!(sw > 0) || !(sh > 0)) return null;
  const src = { top: Number(slice.top) || 0, right: Number(slice.right) || 0, bottom: Number(slice.bottom) || 0, left: Number(slice.left) || 0 };
  if (!(src.top || src.right || src.bottom || src.left)) return null;


  let top = src.top * unitPx;
  let bottom = src.bottom * unitPx;
  let left = src.left * unitPx;
  let right = src.right * unitPx;
  if (top + bottom > h) { const k = h / (top + bottom); top *= k; bottom *= k; }
  if (left + right > w) { const k = w / (left + right); left *= k; right *= k; }
  const us = [0, src.left / sw, 1 - src.right / sw, 1];
  const vs = [0, src.top / sh, 1 - src.bottom / sh, 1];
  const xs = [x, x + left, x + w - right, x + w];
  const ys = [y, y + top, y + h - bottom, y + h];
  const out = [];




  const zeroCenter = Math.abs(sw - src.left - src.right) <= 1e-6
    || Math.abs(sh - src.top - src.bottom) <= 1e-6;
  for (let j = 0; j < 3; j += 1) {
    const sw2 = xs[j + 1] - xs[j];
    const duRaw = us[j + 1] - us[j];
    const fillU = zeroCenter && Math.abs(duRaw) <= 1e-6;
    if (!(sw2 > 1e-4) || (!fillU && !(duRaw > 1e-6))) continue;
    for (let i = 0; i < 3; i += 1) {
      const sh2 = ys[i + 1] - ys[i];
      const dvRaw = vs[i + 1] - vs[i];
      const fillV = zeroCenter && Math.abs(dvRaw) <= 1e-6;
      if (!(sh2 > 1e-4) || (!fillV && !(dvRaw > 1e-6))) continue;
      const u0 = fillU ? us[1] : us[j];
      const v0 = fillV ? vs[1] : vs[i];
      out.push({ x: xs[j], y: ys[i], w: sw2, h: sh2, u0, v0, du: fillU ? 0 : duRaw, dv: fillV ? 0 : dvRaw });
    }
  }
  return out;
}

const rgba = (hex, fallback = [1, 1, 1, 1]) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255, a];
};

const tileOf = (t) => (Array.isArray(t) && t[0] > 0 && t[1] > 0 ? [t[0], t[1]] : [1, 1]);


export function create(canvas, card, view, options = {}) {
  const search = String(options.search || '');
  const debugStats = !!options.debugStats || search.includes('stats');
  const reportError = (message) => {
    if (typeof options.onError === 'function') options.onError(String(message));
  };
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true, stencil: true });
  if (!gl) { reportError('no webgl2'); return null; }
  // The stage owns every GL object it creates, so it has to survive both a failed compile/link and a lost
  // context: a half-linked program must be deleted before returning null, and every later call runs on a
  // context that may already be gone. The host falls back to the old shop bar when `lost` turns true.
  let lost = false;
  let destroyed = false;
  const onContextLost = () => { lost = true; };
  if (canvas && typeof canvas.addEventListener === 'function') canvas.addEventListener('webglcontextlost', onContextLost);
  let program = null;
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
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    shaders.push(vs);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    shaders.push(fs);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      reportError(gl.getProgramInfoLog(program) || 'link failed');
      discardProgram();
      return null;
    }
  } catch (err) {
    discardProgram();
    reportError(String(err && err.message ? err.message : err));
    return null;
  }
  // A linked program keeps working after its shader objects are detached and deleted.
  for (const sh of shaders) { gl.detachShader(program, sh); gl.deleteShader(sh); }
  shaders.length = 0;
  gl.useProgram(program);

  const U = {};
  for (const name of ['uRect', 'uView', 'uBase', 'uMask', 'uDiss', 'uSoft', 'uSoftWeights', 'uSoftRect', 'uSoftMix', 'uAngle', 'uPivot', 'uScale', 'uFlipV', 'uFlipDiss', 'uRawUv', 'uRawFlipV', 'uBaseChannel',
    'uBaseTile', 'uBaseOffset', 'uMaskTile', 'uMaskOffset', 'uDissTile', 'uDissOffset', 'uHasBase', 'uHasMask',
    'uHasDiss', 'uMaskInvert', 'uDissInvert', 'uProgress', 'uSmooth', 'uAlphaClip', 'uTint', 'uIsText']) {
    U[name] = gl.getUniformLocation(program, name);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  const aUV = gl.getAttribLocation(program, 'aUV');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

  const textures = new Map();


  const resolveUrl = typeof options.resolveUrl === 'function' ? options.resolveUrl : (file) => file;
  const loadTexture = (url) => {
    if (!url) return null;
    const resolved = resolveUrl(url);
    if (!resolved) return null;
    if (textures.has(resolved)) return textures.get(resolved);
    const tex = gl.createTexture();
    const entry = { tex, ready: false, url: resolved };
    textures.set(resolved, entry);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const image = new Image();
    image.onload = () => {
      // The stage may have been destroyed (or lost its context) while the image was in flight.
      if (destroyed || lost) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      entry.ready = true;
    };
    image.src = resolved;
    return entry;
  };


  let whiteEntry = null;
  const whiteTexture = () => {
    if (whiteEntry) return whiteEntry;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    whiteEntry = { tex, ready: true, url: 'uGUI/white' };
    return whiteEntry;
  };






  // Glyph textures are per-string atlases, so a shop browsed for a while (prices, names, bond text)
  // would grow `textCache` without bound. Keep an LRU bounded by TEXT_CACHE_LIMIT and delete the
  // evicted texture: an entry is only resolved during the draw that uses it, then bound and drawn.
  // The limit covers the full glyph set of 5 cards + the panel + the money item (~60-70 steady-state
  // strings) and leaves headroom for the old names a purchase/refresh transition keeps on screen; a
  // limit near the working set would evict and rebuild glyph textures every frame.
  const maxTextureSize = Math.max(1, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096);
  const TEXT_CACHE_LIMIT = 256;
  const textCache = new Map();
  const touchText = (key) => {
    const entry = textCache.get(key);
    if (entry) { textCache.delete(key); textCache.set(key, entry); }
    return entry || null;
  };
  const textTexture = (text, rectW = Infinity, rectH = Infinity) => {

    const bestFit = !!text.bestFit;
    const key = `${text.font}|${text.size}|${text.color}|${text.value}|${text.align}|${bestFit ? rectW + 'x' + rectH : ''}`;
    const cached = touchText(key);
    if (cached) return cached;
    const measure = document.createElement('canvas').getContext('2d');
    // The family names encode the face weight (SourceHanSansCN-Bold/Heavy, Novecentowide-Medium,
    // NotoSansHans-Medium). Ask for that weight so the canvas selects the installed @font-face instead of
    // relying on synthesis/fallback when the face itself is declared 700/900/500.
    const weightOf = (family) => {
      const name = String(family || '');
      if (/-Heavy$/.test(name)) return 900;
      if (/-Bold$/.test(name)) return 700;
      if (/-Medium$/.test(name)) return 500;
      return 400;
    };
    const fontOf = (px) => `${weightOf(text.font)} ${px}px "${text.font}", "Noto Sans SC", sans-serif`;
    let fontPx = Math.max(1, text.size);
    if (bestFit) {
      let low = Math.max(1, Number(text.minSize) || 1);
      let high = Math.max(low, Number(text.maxSize) || text.size);
      for (let i = 0; i < 18; i += 1) {
        const mid = (low + high) / 2;
        measure.font = fontOf(mid);
        const metrics = fontMetrics(text.font, mid, measure);


        const advance = measure.measureText(text.value).width + metrics.padding * text.value.length;
        const fits = advance <= rectW && metrics.lineHeight <= rectH;
        if (fits) low = mid; else high = mid;
      }
      fontPx = Math.max(1, low);
    }
    measure.font = fontOf(fontPx);
    const metrics = fontMetrics(text.font, fontPx, measure);
    const advance = measure.measureText(text.value).width;
    // A long string at a large unitPx can exceed GL_MAX_TEXTURE_SIZE; texImage2D would then fail with
    // INVALID_VALUE and the glyph would disappear. Truncate the glyph canvas to the driver limit.
    const width = Math.min(maxTextureSize, Math.max(1, Math.ceil(advance) + 2));
    const height = Math.min(maxTextureSize, Math.max(1, Math.round(metrics.lineHeight)));
    const baseline = Math.round(metrics.ascent);
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const ctx = surface.getContext('2d');
    ctx.font = fontOf(fontPx);
    ctx.fillStyle = text.color || '#FFFFFF';
    ctx.textBaseline = 'alphabetic';
    const align = Number(text.align) || 4;
    ctx.textAlign = align % 3 === 1 ? 'center' : (align % 3 === 2 ? 'right' : 'left');
    const x = ctx.textAlign === 'center' ? width / 2 : (ctx.textAlign === 'right' ? width - 1 : 1);
    ctx.fillText(text.value, x, baseline);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, surface);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const entry = { tex, ready: true, width, height, baseline, fontPx: fontPx / unitPx, bestFit };
    textCache.set(key, entry);
    while (textCache.size > TEXT_CACHE_LIMIT) {
      const oldest = textCache.keys().next().value;
      if (oldest === key) break;
      const evicted = textCache.get(oldest);
      textCache.delete(oldest);
      if (evicted && evicted.tex) gl.deleteTexture(evicted.tex);
    }
    return entry;
  };

  let clock = 0;

  const particleRenderer = (options.particles && !search.includes('noparticles'))
    ? options.particles.create(canvas, card, loadTexture, (view && view.mounted) || null)
    : null;
  const skipParticleDraw = search.includes('nodraw');
  let particleSim = 0;
  let unitPx = 1;

  let padPx = { left: 0, top: 0 };
  const resize = (widthPx, heightPx, ratio, pad) => {
    if (destroyed) return;
    const padding = pad || { left: 0, right: 0, top: 0, bottom: 0 };
    const cardW = (card.size && card.size[0]) || 157;
    const gridW = cardW + (Number(padding.left) || 0) + (Number(padding.right) || 0);
    canvas.width = Math.max(1, Math.round(widthPx * ratio));
    canvas.height = Math.max(1, Math.round(heightPx * ratio));

    unitPx = (widthPx / gridW) * ratio;
    padPx = { left: (Number(padding.left) || 0) * unitPx, top: (Number(padding.top) || 0) * unitPx };


    canvas.style.width = `${canvas.width / ratio}px`;
    canvas.style.height = `${canvas.height / ratio}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniform2f(U.uView, canvas.width, canvas.height);
  };

  const mat = (key) => {
    if (!key) return null;
    return (card.materials && card.materials[key])
      || Object.values(card.sub || {}).map((s) => s.materials && s.materials[key]).find(Boolean) || null;
  };

  // Per-node diagnostics are opt-in: rebuilding rects/last (and one object per drawn node) fed the GC for
  // data nothing reads. The arrays are reused, and the objects are only built for `?stats` /
  // options.debugStats; the counters the host does read (external, quads, materials, sprites, texts) stay.
  const stats = { quads: 0, texts: 0, materials: 0, sprites: 0, scissored: 0, particles: 0, last: [], external: null, externalError: null, rects: [] };




  let externalQuad = typeof options.externalQuad === 'function' ? options.externalQuad : null;
  let externalTex = null;
  let externalUploadMs = 0;
  const externalUploadSamples = [];

  
  const drawExternalQuad = (entry, orderIndex = null, path = null, recordClip = null) => {
    const source = entry && entry.source;
    const box = entry && entry.box;
    if (!source || !box) return false;
    const sw0 = Number(source.width) || 0;
    const sh0 = Number(source.height) || 0;
    if (!(sw0 > 0 && sh0 > 0)) return false;
    if (gl.isContextLost && gl.isContextLost()) return false;
    const x = box.x * unitPx + padPx.left;
    const y = box.y * unitPx + padPx.top;
    const w = box.w * unitPx;
    const h = box.h * unitPx;
    if (!(w > 0.5 && h > 0.5)) return false;
    if (x + w < 0 || y + h < 0 || x > canvas.width || y > canvas.height) return false;
    if (!externalTex) {
      externalTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, externalTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, externalTex);

    const prevPremul = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const prevFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const uploadStart = performance.now();
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
      return false;
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlipY);
    }
    const uploadCost = performance.now() - uploadStart;

    externalUploadMs = externalUploadMs ? externalUploadMs * 0.8 + uploadCost * 0.2 : uploadCost;
    externalUploadSamples.push(uploadCost);
    if (externalUploadSamples.length > 30) externalUploadSamples.shift();
    const premultiplied = entry.premultiplied !== false;
    gl.enable(gl.BLEND);
    if (premultiplied) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniform1i(U.uBase, 0);
    gl.uniform1i(U.uMask, 1);
    gl.uniform1i(U.uDiss, 2);
    gl.uniform1i(U.uSoft, 3);
    for (const unit of [1, 2, 3]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, externalTex);
    }
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform4f(U.uRect, x, y, w, h);
    gl.uniform2f(U.uPivot, x + w * 0.5, y + h * 0.5);
    gl.uniform2f(U.uScale, 1, 1);
    gl.uniform1f(U.uAngle, 0);
    const alpha = entry.alphaApplied ? 1
      : Math.max(0, Math.min(1, entry.alpha == null ? 1 : Number(entry.alpha)));
    gl.uniform4f(U.uTint, 1, 1, 1, alpha);

    gl.uniform1f(U.uHasBase, 1);
    gl.uniform1f(U.uIsText, 0);
    gl.uniform1f(U.uFlipV, 0);
    gl.uniform1f(U.uFlipDiss, 0);
    gl.uniform1f(U.uRawUv, 0);
    gl.uniform1f(U.uRawFlipV, 0);
    gl.uniform1f(U.uBaseChannel, 0);
    gl.uniform2f(U.uBaseTile, 1, 1);
    gl.uniform2f(U.uBaseOffset, 0, 0);

    gl.uniform1f(U.uHasMask, 0);
    gl.uniform1f(U.uMaskInvert, 0);
    gl.uniform2f(U.uMaskTile, 1, 1);
    gl.uniform2f(U.uMaskOffset, 0, 0);
    gl.uniform1f(U.uHasDiss, 0);
    gl.uniform1f(U.uDissInvert, 0);
    gl.uniform1f(U.uProgress, 0);
    gl.uniform1f(U.uSmooth, 1);
    gl.uniform2f(U.uDissTile, 1, 1);
    gl.uniform2f(U.uDissOffset, 0, 0);
    gl.uniform1f(U.uSoftMix, 0);
    gl.uniform4f(U.uSoftWeights, 0, 0, 0, 0);
    gl.uniform4f(U.uSoftRect, 0, 0, 1, 1);
    gl.uniform1f(U.uAlphaClip, 0);

    const clip = intersectClip(entry.clipRect, recordClip);
    if (clip) {
      const sx = Math.round(clip.x * unitPx + padPx.left);
      const sy = Math.round(canvas.height - ((clip.y + clip.h) * unitPx + padPx.top));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.max(0, sx), Math.max(0, sy),
        Math.max(0, Math.round(clip.w * unitPx)), Math.max(0, Math.round(clip.h * unitPx)));
      stats.scissored += 1;
    } else {
      gl.disable(gl.SCISSOR_TEST);
    }

    gl.stencilMask(0xff);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    stats.quads += 1;
    stats.external = {
      path,
      orderIndex,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      source: [source.width, source.height],
      premultiplied,
      uploadMs: Math.round(externalUploadMs * 1000) / 1000,
      uploadMeanMs: externalUploadSamples.length
        ? Math.round((externalUploadSamples.reduce((a, b) => a + b, 0) / externalUploadSamples.length) * 1000) / 1000
        : null,
      uploadSamples: externalUploadSamples.length,
    };
    if (debugStats) {
      stats.rects.push({
        name: entry.name || 'external', path, material: null,
        x: box.x, y: box.y, w: box.w, h: box.h, alpha, colourWrite: true, blend: 'external',
        intensity: null, tint: [1, 1, 1, alpha], slices: null,

        entryAlpha: entry.alpha == null ? null : Number(entry.alpha),
        alphaApplied: !!entry.alphaApplied,
      });
    }
    return true;
  };

  const draw = (dt) => {
    // A destroyed stage or a context the browser has taken away cannot submit GL work; the host watches
    // `lost` and falls back instead of drawing into the void.
    if (destroyed || lost) return;
    if (gl.isContextLost && gl.isContextLost()) { lost = true; return; }
    clock = (options.cardTime && options.cardTime() != null) ? Number(options.cardTime()) : clock + Math.max(0, dt || 0);
    gl.useProgram(program);


    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.scissor(0, 0, canvas.width, canvas.height);
    stats.quads = 0;
    stats.texts = 0;
    stats.materials = 0;
    stats.sprites = 0;
    stats.scissored = 0;
    stats.last.length = 0;
    stats.rects.length = 0;
    stats.external = null;
    stats.externalError = null;





    if (particleRenderer) {


      const rects = new Map();
      for (const rec of view.order()) {
        if (!rec.active) continue;
        if (!particleRenderer.has(rec.node)) continue;
        const shift = rec.delta || { x: 0, y: 0 };
        rects.set(rec.node, {
          node: rec.node,
          x: (rec.abs.x + shift.x) * unitPx + padPx.left,
          y: (rec.abs.y + shift.y) * unitPx + padPx.top,
          w: rec.abs.w * unitPx,
          h: rec.abs.h * unitPx,
        });
      }


      // Advance by the real frame interval (clamped to 0.1 s, the particle simulation's own step cap)
      // instead of min(1/60, target - sim): at the host's ~20 fps ambient paint that old cap moved the
      // particles at a third of wall time. A pinned frame (cardTime / still) freezes them, which keeps
      // the still pose deterministic.
      const targetTime = options.particleTime ? options.particleTime() : null;
      const forced = options.cardTime ? options.cardTime() : null;
      const still = !!(options.cardStill && options.cardStill());
      let particleDt;
      if (forced != null || still) {
        particleDt = 0;
      } else if (targetTime != null) {
        const delta = Number(targetTime) - particleSim;
        particleDt = delta > 0 ? Math.min(0.1, delta) : 0;
        particleSim += particleDt;
      } else {
        particleDt = Math.max(0, Math.min(0.1, Number(dt) || 0));
        particleSim += particleDt;
      }
      try { particleRenderer.advance(particleDt, rects, unitPx); } catch {  }
    }


    let orderIndex = -1;
    for (const rec of view.order()) {
      orderIndex += 1;
      const node = rec.node;
      if (!rec.active) continue;








      if (externalQuad) {
        try {
          const external = externalQuad(rec, orderIndex);
          if (external && external.ready && drawExternalQuad(external, orderIndex, rec.node.path || null, rec.clipRect)) continue;
        } catch (err) {


          stats.externalError = String((err && err.message) || err || 'external quad failed');
          stats.external = null;
        }
      }



      if (particleRenderer && !skipParticleDraw && particleRenderer.has(node)) {
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.STENCIL_TEST);
        gl.colorMask(true, true, true, true);
        particleRenderer.draw(node);

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(aUV);
        gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);
        gl.colorMask(true, true, true, true);
      }
      const pose = rec.pose || {};


      const base = rec.abs;
      const shift = rec.delta;
      const box = shift ? { x: base.x + shift.x, y: base.y + shift.y, w: base.w, h: base.h } : base;
      const w = box.w * unitPx;
      const h = box.h * unitPx;
      if (w < 0.5 || h < 0.5) continue;

      const x = box.x * unitPx + padPx.left;
      const y = box.y * unitPx + padPx.top;
      if (x + w < 0 || y + h < 0 || x > canvas.width || y > canvas.height) continue;



      const clip = rec.clipRect;
      if (clip) {
        const sx = Math.round(clip.x * unitPx + padPx.left);
        const sy = Math.round(canvas.height - ((clip.y + clip.h) * unitPx + padPx.top));
        const sw = Math.round(clip.w * unitPx);
        const sh = Math.round(clip.h * unitPx);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(Math.max(0, sx), Math.max(0, sy), Math.max(0, sw), Math.max(0, sh));
        stats.scissored += 1;
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }





      const stencil = rec.stencil;
      let colourWrite = true;
      if (stencil) {
        gl.enable(gl.STENCIL_TEST);
        if (stencil.mode === 'write') {
          gl.stencilFunc(gl.ALWAYS, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
          colourWrite = false;
        } else {
          gl.stencilFunc(gl.EQUAL, 1, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        }
      } else if (rec.stencilRead) {
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.EQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      } else {
        gl.disable(gl.STENCIL_TEST);
      }
      gl.colorMask(colourWrite, colourWrite, colourWrite, colourWrite);
      if (rec.stencilClear) {
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.disable(gl.STENCIL_TEST);
      }

      gl.uniform4f(U.uRect, x, y, w, h);
      const pivot = (rec.node.rect && rec.node.rect.pivot) || [0.5, 0.5];

      const poseRot = rec.pose && rec.pose.rot != null ? Number(rec.pose.rot) : 0;
      gl.uniform1f(U.uAngle, ((-((Number(rec.node.rot) || 0) + poseRot)) * Math.PI) / 180);
      gl.uniform2f(U.uPivot, x + pivot[0] * w, y + pivot[1] * h);



      const nodeScale = rec.node.scale || [1, 1, 1];
      const poseScale = rec.pose && rec.pose.scale;
      const inheritScale = (rec.inheritScale && rec.inheritScale.length === 2) ? rec.inheritScale : [1, 1];
      const scaleX = (Number(nodeScale[0]) || 1) * (poseScale ? Number(poseScale[0]) : 1) * inheritScale[0];
      const scaleY = (Number(nodeScale[1]) || 1) * (poseScale ? Number(poseScale[1]) : 1) * inheritScale[1];
      gl.uniform2f(U.uScale, scaleX, rec.mirroredY ? Math.abs(scaleY) : scaleY);
      gl.uniform1f(U.uIsText, 0);
      gl.uniform1f(U.uFlipV, 0);
      gl.uniform1f(U.uFlipDiss, 0);
      gl.uniform1f(U.uRawUv, rec.rawUv ? 1 : 0);
      gl.uniform1f(U.uBaseChannel, 0);
      gl.uniform1f(U.uHasBase, 0);
      gl.uniform1f(U.uHasMask, 0);
      gl.uniform1f(U.uHasDiss, 0);
      gl.uniform1f(U.uSoftMix, 0);
      gl.uniform1f(U.uAlphaClip, 0);
      gl.uniform2f(U.uBaseTile, 1, 1);
      gl.uniform2f(U.uBaseOffset, 0, 0);
      gl.uniform4f(U.uSoftWeights, 0, 0, 0, 0);

      let maskBound = false;

      let sliced = null;

      let materialIntensity = 1;
      let materialKey = null;
      let additive = false;
      const image = node.image || null;
      const raw = node.raw || null;
      if (raw && raw.mat) materialKey = raw.mat;
      else if (image && (image.mat || (image.material && image.material.name))) materialKey = image.mat || image.material.name;
      const material = materialKey ? mat(materialKey) : null;

      let tint = rgba((image && image.color) || (raw && raw.color) || '#FFFFFF');



      const rgbCtrl = !!(material && material.draw && material.draw.rgbCtrl);
      if (rgbCtrl) {
        const mt = rgba((material.draw && material.draw.tint) || '#FFFFFF');
        tint = [mt[0], mt[1], mt[2], tint[3]];
      }
      if (pose.colour) {
        tint = [
          pose.colour.r != null && !rgbCtrl ? pose.colour.r : tint[0],
          pose.colour.g != null && !rgbCtrl ? pose.colour.g : tint[1],
          pose.colour.b != null && !rgbCtrl ? pose.colour.b : tint[2],
          (pose.colour.a != null ? pose.colour.a : tint[3]) * (pose.alpha != null ? pose.alpha : 1),
        ];
        if (rgbCtrl && pose.colour.g != null) tint[3] *= pose.colour.g;
      } else if (pose.alpha != null) {
        tint[3] *= pose.alpha;
      }




      const confirmSweepAlpha = rec.rawUv
        && /\/group_upgrade\/group_normal\/fx_upgrade\/sweep[12]$/.test((rec.node && rec.node.path) || '');
      if (confirmSweepAlpha) {
        const baseAlpha = rgba((raw && raw.color) || '#FFFFFF')[3];
        const animAlpha = pose.colour && pose.colour.a != null ? pose.colour.a : 1;
        tint[3] = baseAlpha * animAlpha * (pose.alpha != null ? pose.alpha : 1);
      }

      if (rec.inheritAlpha != null && rec.inheritAlpha !== 1) tint[3] *= rec.inheritAlpha;


      if (node.tintMul) {
        tint = [tint[0] * node.tintMul[0], tint[1] * node.tintMul[1], tint[2] * node.tintMul[2], tint[3] * (node.tintMul[3] == null ? 1 : node.tintMul[3])];
      }

      if (node.text) {


        const text = {
          font: node.text.font || 'NotoSansHans-Medium',
          size: (Number(node.text.fontSize) || 16) * unitPx,
          minSize: (Number(node.text.minSize) || 1) * unitPx,
          maxSize: (Number(node.text.maxSize) || Number(node.text.fontSize) || 16) * unitPx,
          bestFit: !!node.text.bestFit,
          color: node.text.color || '#FFFFFF',
          value: node.text.text || '',
          align: node.text.align,
        };
        if (!text.value) continue;
        const glyph = textTexture(text, w, h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glyph.tex);
        gl.uniform1i(U.uBase, 0);
        gl.uniform1f(U.uHasBase, 1);
        gl.uniform1f(U.uIsText, 1);
        gl.uniform1f(U.uFlipV, 0);
        gl.uniform1f(U.uFlipDiss, 0);
        gl.uniform4f(U.uTint, tint[0], tint[1], tint[2], tint[3]);



        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);


        const gh = glyph.height;
        const gw = glyph.width;
        const align = Number(node.text.align) || 4;
        const horizontal = align % 3;
        const vertical = Math.floor(align / 3);
        const gx = horizontal === 1 ? x + (w - gw) / 2 : (horizontal === 2 ? x + w - gw : x);
        const gy = vertical === 1 ? y + (h - gh) / 2 : (vertical === 2 ? y + h - gh : y);
        gl.uniform4f(U.uRect, gx, gy, gw, gh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        stats.texts += 1;
        if (debugStats) stats.rects.push({ name: rec.node.name, path: rec.node.path || null, x: gx / unitPx, y: gy / unitPx, w: gw / unitPx, h: gh / unitPx, alpha: tint[3], colourWrite, blend: 'alpha', textSize: glyph.fontPx, bestFit: glyph.bestFit });
        continue;
      }

      let baseUrl = null;
      if (material) {
        const drawRec = material.draw || {};
        baseUrl = drawRec.baseFile || (image && image.file) || null;
        const base = loadTexture(baseUrl);
        const mask = loadTexture(drawRec.maskFile);
        const diss = loadTexture(drawRec.dissolve && drawRec.dissolve.file);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, (base || mask || diss) ? (base || mask || diss).tex : null);
        gl.uniform1i(U.uBase, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, (mask || base) ? (mask || base).tex : null);
        gl.uniform1i(U.uMask, 1);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, (diss || base) ? (diss || base).tex : null);
        gl.uniform1i(U.uDiss, 2);
        gl.uniform1f(U.uHasBase, base ? 1 : 0);
        gl.uniform1f(U.uHasMask, mask ? 1 : 0);

        gl.uniform1f(U.uBaseChannel, material.floats && Number(material.floats._BaseTex_Channel) === 1 ? 1 : 0);
        maskBound = !!mask;




        const baseTile = tileOf(drawRec.tile);
        const baseOffset = drawRec.offset || [0, 0];
        const identitySt = baseTile[0] === 1 && baseTile[1] === 1 && !baseOffset[0] && !baseOffset[1];
        gl.uniform1f(U.uFlipV, !drawRec.baseFile && identitySt ? 0 : 1);
        gl.uniform1f(U.uFlipDiss, 0);
        gl.uniform1f(U.uHasDiss, diss && !search.includes('nodiss') ? 1 : 0);
        gl.uniform2f(U.uBaseTile, baseTile[0], baseTile[1]);

        const confirmSweep = rec.rawUv
          && /\/group_upgrade\/group_normal\/fx_upgrade\/sweep[12]$/.test((rec.node && rec.node.path) || '');
        gl.uniform1f(U.uRawFlipV, confirmSweep ? 1 : 0);
        const spin = drawRec.speed || [0, 0];
        const dissSpeed = (drawRec.dissolve && drawRec.dissolve.speed) || [0, 0];



        const texPose = pose.tex || {};
        gl.uniform2f(U.uBaseOffset,
          texPose.x != null ? texPose.x : (baseOffset[0] || 0) + spin[0] * clock,
          texPose.y != null ? texPose.y : (baseOffset[1] || 0) + spin[1] * clock);
        gl.uniform2f(U.uMaskTile, ...tileOf(drawRec.maskTile));
        gl.uniform2f(U.uMaskOffset, (drawRec.maskOffset?.[0] || 0), (drawRec.maskOffset?.[1] || 0));
        gl.uniform2f(U.uDissTile, ...tileOf(drawRec.dissolveTile));


        gl.uniform2f(U.uDissOffset,
          (drawRec.dissolveOffset?.[0] || 0) + dissSpeed[0] * clock,
          (drawRec.dissolveOffset?.[1] || 0) + (rec.rawUv ? dissSpeed[1] : -dissSpeed[1]) * clock);
        gl.uniform1f(U.uMaskInvert, drawRec.maskInvert ? 1 : 0);
        gl.uniform1f(U.uDissInvert, drawRec.dissolve && drawRec.dissolve.invert ? 1 : 0);
        gl.uniform1f(U.uProgress, drawRec.dissolve ? Number(drawRec.dissolve.threshold ?? 0) : 0);
        gl.uniform1f(U.uSmooth, drawRec.dissolve ? Math.max(0.0001, Number(drawRec.dissolve.smoothness ?? 0.1)) : 1);
        gl.uniform1f(U.uAlphaClip, drawRec.alphaClip ? 1 : 0);



        const dst = drawRec.dst == null ? null : Number(drawRec.dst);
        additive = dst != null ? dst === 1 : (!!drawRec.additive || drawRec.blend === 'add');




        if (additive) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);





        const intensity = drawRec.intensity != null ? Number(drawRec.intensity) : 1;
        const colIntensity = drawRec.colIntensity != null ? Number(drawRec.colIntensity) : 1;
        materialIntensity = (Number.isFinite(intensity) ? intensity : 1) * (Number.isFinite(colIntensity) ? colIntensity : 1);
        if (materialIntensity !== 1) {
          tint = [tint[0] * materialIntensity, tint[1] * materialIntensity, tint[2] * materialIntensity, tint[3]];
        }
        stats.materials += 1;
      } else if (image && (image.file || image.color)) {


        const tex = image.file ? loadTexture(image.file) : whiteTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex ? tex.tex : null);
        gl.uniform1i(U.uBase, 0);
        gl.uniform1f(U.uHasBase, tex ? 1 : 0);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);


        if (rec.slice && image.file) sliced = sliceQuads(rec.slice, x, y, w, h, unitPx);
        stats.sprites += 1;
      } else {
        continue;
      }

      if (rec.softMask) {
        const soft = loadTexture(rec.softMask.file);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, soft ? soft.tex : null);
        gl.uniform1i(U.uSoft, 3);
        const wgt = rec.softMask.weights || { r: 1, g: 0, b: 0, a: 0 };
        gl.uniform4f(U.uSoftWeights, wgt.r || 0, wgt.g || 0, wgt.b || 0, wgt.a || 0);
        const sr = rec.softMask.rect || { x: 0, y: 0, w: 157, h: 207 };



        const softShift = rec.delta || { x: 0, y: 0 };
        gl.uniform4f(U.uSoftRect,
          (sr.x + softShift.x) * unitPx + padPx.left,
          (sr.y + softShift.y) * unitPx + padPx.top,
          sr.w * unitPx, sr.h * unitPx);
        gl.uniform1f(U.uSoftMix, soft ? 1 : 0);
      }
      gl.uniform4f(U.uTint, tint[0], tint[1], tint[2], tint[3]);
      if (sliced) {


        for (const s of sliced) {
          gl.uniform4f(U.uRect, s.x, s.y, s.w, s.h);
          gl.uniform2f(U.uBaseTile, s.du, s.dv);
          gl.uniform2f(U.uBaseOffset, s.u0, s.v0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        stats.quads += sliced.length;
      } else {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        stats.quads += 1;
      }
      if (debugStats) {
        stats.rects.push({
          name: rec.node.name,
          path: rec.node.path || null,
          material: materialKey,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          alpha: tint[3],

          colourWrite,
          blend: materialKey ? (additive ? 'add' : 'alpha') : 'alpha',
          intensity: materialKey ? materialIntensity : null,

          tint: [tint[0], tint[1], tint[2], tint[3]],

          slices: sliced ? sliced.map((s) => ({ x: (s.x - padPx.left) / unitPx, y: (s.y - padPx.top) / unitPx, w: s.w / unitPx, h: s.h / unitPx })) : null,
        });
        stats.last.push(`${rec.node.name}:${material ? 'mat' : 'sprite'}:mask${maskBound ? 1 : 0}`);
      }
      void baseUrl;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    if (particleRenderer) stats.particles = particleRenderer.aliveCount();
    gl.colorMask(true, true, true, true);
  };

  // Release every GL object this stage owns. Idempotent: the host calls it from dispose, possibly after
  // the context was already lost (delete* on a lost context is a no-op) or a second time.
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    lost = true;
    if (particleRenderer && typeof particleRenderer.destroy === 'function') {
      try { particleRenderer.destroy(); } catch { /* the context may be gone */ }
    }
    for (const entry of textCache.values()) gl.deleteTexture(entry.tex);
    textCache.clear();
    for (const entry of textures.values()) gl.deleteTexture(entry.tex);
    textures.clear();
    if (whiteEntry) gl.deleteTexture(whiteEntry.tex);
    whiteEntry = null;
    if (externalTex) gl.deleteTexture(externalTex);
    externalTex = null;
    externalUploadSamples.length = 0;
    gl.deleteBuffer(quad);
    if (program) gl.deleteProgram(program);
    program = null;
    if (canvas && typeof canvas.removeEventListener === 'function') canvas.removeEventListener('webglcontextlost', onContextLost);
  };

  return {
    resize,
    draw,
    stats,
    destroy,
    get gl() { return gl; },
    get lost() { return lost || !!(gl.isContextLost && gl.isContextLost()); },
    get destroyed() { return destroyed; },
    get particles() { return particleRenderer; },
    
    get textures() { return textures; },
    
    setExternalQuad(fn) {
      externalQuad = typeof fn === 'function' ? fn : null;
      return externalQuad != null;
    },
    
    get metrics() { return { unitPx, padPx, canvas: [canvas.width, canvas.height], css: [canvas.style.width, canvas.style.height], clock, particleSim }; },
  };
}


function intersectClip(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (!(w > 0 && h > 0)) return { x, y, w: 0, h: 0 };
  return { x, y, w, h };
}


export const CardStage = { create };

