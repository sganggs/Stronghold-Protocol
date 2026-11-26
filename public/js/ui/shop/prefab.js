

export function cloneNode(node) {
  return typeof structuredClone === 'function' ? structuredClone(node) : JSON.parse(JSON.stringify(node));
}

export function countNodes(node) {
  if (!node) return 0;
  let n = 1;
  for (const child of node.children || []) n += countNodes(child);
  return n;
}

export function indexNodes(root) {
  const byPath = new Map();
  const byName = new Map();
  const byId = new Map();
  (function walk(node) {
    if (!node) return;
    if (node.path) byPath.set(node.path, node);
    if (!byName.has(node.name)) byName.set(node.name, node);
    if (node.id != null) byId.set(String(node.id), node);
    for (const child of node.children || []) walk(child);
  })(root);
  return { byPath, byName, byId };
}

export function findPath(root, path) {
  let node = root;
  for (const part of String(path).split('/').filter(Boolean)) {
    if (!node) return null;
    node = (node.children || []).find((child) => child.name === part) || null;
  }
  return node;
}

export function findName(root, name) {
  if (!root) return null;
  if (root.name === name) return root;
  for (const child of root.children || []) {
    const hit = findName(child, name);
    if (hit) return hit;
  }
  return null;
}

export function findAllByComponent(root, className) {
  const out = [];
  (function walk(node) {
    if (!node) return;
    if ((node.components || []).some((c) => c && c.class === className)) out.push(node);
    for (const child of node.children || []) walk(child);
  })(root);
  return out;
}

export function hideRuntimeImages(node) {
  if (!node) return node;
  if (node.image && !node.image.file && !node.image.sprite && !node.image.mat && !(node.image.material && node.image.material.name)) {
    node.active = false;
    node.__unresolved = node.__unresolved || 'runtime-filled-slot';
  }
  for (const child of node.children || []) hideRuntimeImages(child);
  return node;
}

export function hidePlatformHints(root) {
  if (!root) return root;
  const classes = (root.components || []).map((c) => c && c.class);
  const isPcHint = classes.includes('PCKeyCardUIButtonDisplay') || classes.includes('UIButtonKeyBoardConfig');

  if (isPcHint && !classes.includes('UIButton')) {
    root.active = false;
    root.__unresolved = root.__unresolved || 'pc-only';
  }
  for (const child of root.children || []) hidePlatformHints(child);
  return root;
}

function materialHasTexture(mat) {
  if (!mat || !mat.draw) return false;
  const d = mat.draw;
  return !!(d.baseFile || d.maskFile || (d.dissolve && d.dissolve.file));
}

export function hideExternalSprites(root, materials) {
  if (!root) return root;
  const image = root.image;
  if (image && image.sprite && !image.file) {
    const key = (root.raw && root.raw.mat) || image.mat || (image.material && image.material.name) || null;
    const mat = key && materials ? materials[key] : null;
    if (!materialHasTexture(mat)) {
      if (root.active !== false) root.__unresolved = root.__unresolved || 'sprite-missing';
      root.active = false;
    }
  }
  for (const child of root.children || []) hideExternalSprites(child, materials);
  return root;
}

export function hideRuntimeSources(root, runtime, index, materials) {
  if (!runtime) return root;
  const rel = (path) => {
    if (!path) return null;
    const base = root.path ? `${root.path}/` : null;
    return base && path.startsWith(base) ? path.slice(base.length) : path;
  };
  for (const entry of Object.values(runtime)) {
    const node = entry && entry.node != null
      ? index.byId.get(String(entry.node))
      : (entry && entry.path ? findPath(root, rel(entry.path)) : null);
    if (!node || !node.image) continue;
    const image = node.image;
    if (image.file) continue;
    const key = (node.raw && node.raw.mat) || image.mat || (image.material && image.material.name) || null;
    const mat = key && materials ? materials[key] : null;
    if (mat && materialHasTexture(mat)) continue;
    if (node.active !== false) node.__unresolved = node.__unresolved || 'runtime-source';
    node.active = false;
  }
  return root;
}

export function componentRefs(node, index) {
  const out = new Map();
  const scripts = node && Array.isArray(node.scripts) ? node.scripts : [];
  const resolved = new Map();
  for (const entry of scripts) {
    const refs = {};
    for (const [field, value] of Object.entries((entry && entry.refs) || {})) {
      if (Array.isArray(value)) refs[field] = value.map((id) => index.byId.get(String(id)) || null);
      else refs[field] = index.byId.get(String(value)) || null;
    }
    const anims = {};
    for (const [field, value] of Object.entries((entry && entry.anims) || {})) {
      anims[field] = { clip: value && value.clip, on: value && value.on != null ? index.byId.get(String(value.on)) || null : null };
    }
    resolved.set(entry.class, { refs, anims, script: entry.script, namespace: entry.namespace });
  }
  for (const comp of node.components || []) {
    if (!comp || !comp.class) continue;
    out.set(comp.class, { ...(comp.fields || {}), ...(resolved.get(comp.class)?.refs || {}) });
    const anims = resolved.get(comp.class)?.anims;
    if (anims && Object.keys(anims).length) out.get(comp.class)._anims = anims;
  }
  return out;
}

export function setActive(node, value) {
  if (!node) return;
  node.active = !!value;
}

export function setText(node, value, color) {
  if (!node || !node.text) return;
  node.text = { ...node.text, text: value == null ? '' : String(value) };
  if (color) node.text = { ...node.text, color };
}

export function setSprite(node, file, extra = {}) {
  if (!node) return;

  node.image = { ...(node.image || {}), ...extra, ...(file ? { file } : {}) };
}

export function documentMaterials(doc) {
  const out = {};
  Object.assign(out, (doc && doc.materials) || {});
  for (const sub of Object.values((doc && doc.sub) || {})) {
    if (sub && sub.materials) Object.assign(out, sub.materials);
  }
  return out;
}

export function scriptsOf(node, className) {
  return ((node && node.scripts) || []).filter((s) => s && s.class === className);
}

export function resolveScriptRefs(entry, index) {
  const refs = {};
  for (const [field, value] of Object.entries((entry && entry.refs) || {})) {
    if (Array.isArray(value)) refs[field] = value.map((id) => index.byId.get(String(id)) || null);
    else refs[field] = index.byId.get(String(value)) || null;
  }
  const anims = {};
  for (const [field, value] of Object.entries((entry && entry.anims) || {})) {
    anims[field] = { clip: value && value.clip, on: value && value.on != null ? index.byId.get(String(value.on)) || null : null };
  }
  return { refs, anims };
}

