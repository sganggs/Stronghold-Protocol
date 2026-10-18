// server/plugins/forgePanels.js — decide whether a Forge client panel can run in our ui iframe.
// (i18n-ignore-file: the import report and its reasons are author-facing and bilingual by design, 中文 · English — as
// forgeImport.js; never player UI)
// A pack is untrusted. This module parses with acorn and rewrites by source offsets. It never import()s, eval()s or
// require()s a file from the pack. A panel that passes is still not run here: the player's browser runs the classic
// bundle inside the existing sandboxed frame (shared/plugins/forgePanel.js).
//
// [ASSUMED] caps, also listed in the report: 256 KB a file, 1 MB a panel, 64 files. Only `./` and `../` that stay
// inside the pack, and only .js / .css / .json. The one absolute specifier rewritten is `/shared/i18n.js` (the pack's
// own strings, the player's language). A mount that touches none of ctx.host / net / me / data / session / log / t
// stays a skeleton. A panel that subscribes to room.state on root.guide is shown in room.panel; other supported
// panels on an unmapped Forge mount use the existing suggestion. Those display slots are not Forge's positions.
// The iframe document gets .screen.result only for result.tab and .room-screen only for room.panel. It never gets .st.

import { FORGE_SHIM_TEXT } from '../../shared/plugins/forgePanel.js';
import { UI_SLOT_IDS } from '../../shared/plugins/manifest.js';

/** [ASSUMED] per file. */
export const PANEL_FILE_MAX = 256 * 1024;
/** [ASSUMED] per panel, every file of the closure plus its styles. */
export const PANEL_TOTAL_MAX = 1024 * 1024;
/** [ASSUMED] files in one panel closure. */
export const PANEL_FILES_MAX = 64;

const I18N_SPEC = '/shared/i18n.js';
const CTX_SURFACES = new Set(['host', 'net', 'me', 'data', 'session', 'log', 't']);
const DATA_TABLES = new Set(['chess', 'assets']);
const PANEL_SLOT = { 'screen.game.hud': 'hud.right', 'screen.game.aside': 'hud.right', 'screen.result.footer': 'result.tab' };
const PANEL_REWRITE = {
  'root.overlays': 'hud.right', 'root.guide': 'stats.tab', 'screen.game.overlay': 'hud.right',
  'screen.game.shopCard': 'hud.right', 'screen.game.bondStrip': 'hud.right', 'screen.loadout.detail': 'room.panel',
};

const propName = (node) => {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
};

/**
 * Where a supported panel is shown. Unmapped mounts stay manual until the scan passes.
 * @param {string} forgeSlot
 * @param {{ compatible: boolean, listensRoom: boolean }} info
 */
export function forgeDisplaySlot(forgeSlot, { compatible, listensRoom }) {
  const mapped = PANEL_SLOT[forgeSlot];
  if (mapped && UI_SLOT_IDS.includes(mapped)) return { slot: mapped, assumed: false, marker: markerOf(mapped), suggested: mapped };
  const suggested = PANEL_REWRITE[forgeSlot] || 'room.panel';
  if (!compatible) return { slot: null, assumed: false, marker: null, suggested };
  if (forgeSlot === 'root.guide' && listensRoom) return { slot: 'room.panel', assumed: true, marker: 'room', suggested: 'room.panel' };
  if (UI_SLOT_IDS.includes(suggested)) return { slot: suggested, assumed: true, marker: markerOf(suggested), suggested };
  return { slot: null, assumed: false, marker: null, suggested };
}

function markerOf(slot) {
  if (slot === 'result.tab') return 'result';
  if (slot === 'room.panel') return 'room';
  return null;
}

function resolveSpec(from, spec, files) {
  if (typeof spec !== 'string' || !spec) return { error: 'import:' };
  if (spec === I18N_SPEC) return { i18n: true };
  if (spec.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(spec) || !spec.startsWith('.')) return { error: `import:${spec.slice(0, 80)}` };
  if (/[\\%?#\0]/.test(spec)) return { error: `import:${spec.slice(0, 40)}` };
  const parts = from.split('/');
  parts.pop();
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return { error: `import:${spec.slice(0, 40)}` };
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const rel = parts.join('/');
  const cands = /\.(?:js|css|json)$/.test(rel) ? [rel] : [`${rel}.js`, `${rel}.json`];
  for (const cand of cands) if (files.has(cand)) return { path: cand };
  return { error: `import:${spec.slice(0, 80)}` };
}

function walk(node, visit, fnDepth, seen, depth) {
  if (!node || typeof node !== 'object' || depth > 80) return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node, fnDepth);
  const next = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
    ? fnDepth + 1 : fnDepth;
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'range' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) {
      const n = v.length < 100000 ? v.length : 100000;
      for (let i = 0; i < n; i += 1) if (v[i] && typeof v[i].type === 'string') walk(v[i], visit, next, seen, depth + 1);
    } else if (v && typeof v.type === 'string') walk(v, visit, next, seen, depth + 1);
  }
}

/**
 * @param {string} path
 * @param {Buffer} bytes
 * @param {Function} parse
 * @param {Map<string, Buffer>} files
 */
function readModule(path, bytes, parse, files) {
  const fail = (surface, zh, en) => ({ path, error: { surface, zh, en } });
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('encoding', `${path} 不是 UTF-8。`, `${path} is not UTF-8.`); }
  if (Buffer.byteLength(source) > PANEL_FILE_MAX) return fail('cap:file', `${path} 超过 256 KB。`, `${path} is over 256 KB.`);
  let ast;
  try { ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' }); }
  catch (e) { return fail('parse', `${path} 解析不了（${String(e?.message || e).slice(0, 120)}）。`, `${path} does not parse (${String(e?.message || e).slice(0, 120)}).`); }
  /** @type {{ spec: string, path?: string, i18n?: boolean }[]} */
  const deps = [];
  /** @type {{ local: string, from: number, name: string | null }[]} */
  const imports = [];
  /** @type {[string, string][]} */
  const exports = [];
  /** @type {[number, number, string][]} */
  const edits = [];
  const surfaces = new Set();
  let supported = false;
  let listensRoom = false;
  const depOf = (spec) => {
    const got = resolveSpec(path, spec, files);
    if (got.error) { surfaces.add(got.error); return { error: got.error }; }
    return { index: deps.push(got) - 1 };
  };
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      const dep = depOf(n.source.value);
      if (dep.error) continue;
      for (const s of n.specifiers) {
        const binding = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportSpecifier' ? propName(s.imported) : null;
        if (deps[dep.index].i18n && binding != null && binding !== 't') surfaces.add(`i18n:export:${binding}`);
        if (s.type === 'ImportNamespaceSpecifier') imports.push({ local: s.local.name, from: dep.index, name: null });
        else if (s.type === 'ImportDefaultSpecifier') imports.push({ local: s.local.name, from: dep.index, name: 'default' });
        else imports.push({ local: s.local.name, from: dep.index, name: propName(s.imported) });
      }
      edits.push([n.start, n.end, '']);
    } else if (n.type === 'ExportAllDeclaration') {
      surfaces.add('export-star');
    } else if (n.type === 'ExportDefaultDeclaration') {
      const decl = n.declaration;
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
        edits.push([n.start, decl.start, '']);
        exports.push(['default', decl.id.name]);
      } else if (decl.type === 'Identifier') {
        edits.push([n.start, n.end, '']);
        exports.push(['default', decl.name]);
      } else {
        edits.push([n.start, decl.start, 'const __spDefault = ']);
        edits.push([n.end, n.end, ';']);
        exports.push(['default', '__spDefault']);
      }
    } else if (n.type === 'ExportNamedDeclaration') {
      if (n.source) {
        surfaces.add('export-from');
        edits.push([n.start, n.end, '']);
        continue;
      }
      if (n.declaration) {
        const d = n.declaration;
        if (d.type === 'VariableDeclaration') {
          if (d.declarations.some((v) => v.id.type !== 'Identifier')) surfaces.add('export-pattern');
          else for (const v of d.declarations) exports.push([v.id.name, v.id.name]);
        } else if (d.id) exports.push([d.id.name, d.id.name]);
        else surfaces.add('export-pattern');
        edits.push([n.start, d.start, '']);
      } else {
        for (const s of n.specifiers) {
          const local = propName(s.local);
          if (!local) surfaces.add('export-pattern');
          else exports.push([propName(s.exported) || local, local]);
        }
        edits.push([n.start, n.end, '']);
      }
    }
  }
  walk(ast, (node, fnDepth) => {
    // [ASSUMED] A frame has neither the host URL/desktop bridge nor callers of controllers published on its
    // global, and our fixed-seat server has no expanded capacity. Reject these dependencies conservatively.
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression'
      && ['globalThis', 'window', 'self'].includes(node.left.object?.name)) surfaces.add('host-controller');
    if (node.type === 'MetaProperty') surfaces.add('import.meta');
    if (node.type === 'AwaitExpression' && fnDepth === 0) surfaces.add('top-level-await');
    if (node.type === 'ImportExpression') {
      const src = node.source;
      if (!src || src.type !== 'Literal' || typeof src.value !== 'string') { surfaces.add('import:'); return; }
      if (src.value === I18N_SPEC) { edits.push([node.start, node.end, 'Promise.resolve({ t: globalThis.__spForgeT })']); return; }
      const got = resolveSpec(path, src.value, files);
      if (got.error) { surfaces.add(got.error); return; }
      if (got.i18n) { edits.push([node.start, node.end, 'Promise.resolve({ t: globalThis.__spForgeT })']); return; }
      const dep = deps.push(got) - 1;
      edits.push([node.start, node.end, `Promise.resolve(__spMod[${JSON.stringify(got.path)}])`]);
      void dep;
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ClassDeclaration') && node.id && node.id.name === 'appearance') {
      surfaces.add('appearance');
    }
    if (node.type === 'MemberExpression' || node.type === 'ChainExpression') {
      const member = node.type === 'ChainExpression' ? node.expression : node;
      if (member && (member.type === 'MemberExpression')) {
        const name = propName(member.property);
        const obj = member.object;
        const global = obj?.type === 'Identifier' && ['globalThis', 'window', 'self'].includes(obj.name);
        if (global && name === 'location') surfaces.add('host-location');
        if (global && (name === 'desktop' || name === 'Android')) surfaces.add('desktop');
        if (name === 'playerCapacity' || name === 'seatCap') surfaces.add('room.capacity');
        if (obj?.type === 'Identifier') {
          const imported = imports.find((i) => i.local === obj.name && i.name == null && deps[i.from]?.i18n);
          if (imported && name !== 't') surfaces.add(`i18n:export:${name || '?'}`);
        }
        if (obj && obj.type === 'Identifier' && obj.name === 'ctx' && name && CTX_SURFACES.has(name)) supported = true;
        if (name === 'documentElement') surfaces.add('documentElement');
        if (name === 'serviceWorker') surfaces.add('serviceWorker');
        if (name === 'subtle') surfaces.add('webCrypto');
        if (name === 'fetch') {
          const base = obj && obj.type === 'Identifier' ? obj.name : '';
          if (base === 'globalThis' || base === 'window' || base === 'self') surfaces.add('fetch');
        }
        if ((name === 'parent' || name === 'top') && obj && obj.type === 'Identifier' && (obj.name === 'window' || obj.name === 'globalThis')) {
          surfaces.add('parent');
        }
        if (obj && obj.type === 'Identifier' && (obj.name === 'parent' || obj.name === 'top')) surfaces.add('parent');
      }
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      const name = callee && callee.type === 'Identifier' ? callee.name : propName(callee && callee.property);
      if (name === 'fetch') surfaces.add('fetch');
      if (name === 'send' || name === 'sendResourceMessage' || name === 'setPreload') surfaces.add(name === 'send' ? 'send' : name);
      if (name === 'postMessage') surfaces.add('postMessage');
      if (name === 'XMLHttpRequest' || name === 'WebSocket' || name === 'EventSource') surfaces.add(name);
      if (name === 'on') {
        const arg = node.arguments && node.arguments[0];
        if (arg && arg.type === 'Literal' && arg.value === 'room.state') listensRoom = true;
      }
      if (name === 'get') {
        const obj = callee && callee.object;
        const objName = obj && (obj.type === 'MemberExpression' || obj.type === 'ChainExpression')
          ? propName(obj.type === 'ChainExpression' ? obj.expression && obj.expression.property : obj.property) : null;
        const arg = node.arguments && node.arguments[0];
        if (objName === 'data' && arg && arg.type === 'Literal' && typeof arg.value === 'string' && !DATA_TABLES.has(arg.value)) {
          surfaces.add(`data:${arg.value.slice(0, 40)}`);
        }
      }
    }
    if (node.type === 'Identifier' && (node.name === 'caches' || node.name === 'serviceWorker')) {
      /* a bare mention is not a call; property access is handled above */
    }
  }, 0, new WeakSet(), 0);
  if (nodeMentionsCaches(ast)) surfaces.add('cacheStorage');
  const names = new Set();
  for (const [name] of exports) {
    if (names.has(name)) surfaces.add('export-dup');
    names.add(name);
  }
  return { path, source, deps, imports, exports, edits, surfaces, supported, listensRoom, hasMount: names.has('mount') || names.has('default') };
}

function nodeMentionsCaches(ast) {
  let hit = false;
  walk(ast, (node) => {
    if (hit) return;
    if ((node.type === 'MemberExpression') && propName(node.property) === 'caches') hit = true;
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'caches') hit = true;
  }, 0, new WeakSet(), 0);
  return hit;
}

function renderModule(mod) {
  let body = mod.source;
  const edits = [...mod.edits].sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [start, end, value] of edits) body = body.slice(0, start) + value + body.slice(end);
  const head = mod.imports.map((i) => {
    const dep = mod.deps[i.from];
    if (!dep) return '';
    const base = dep.i18n ? '{ t: globalThis.__spForgeT }' : `__spMod[${JSON.stringify(dep.path)}]`;
    return i.name == null ? `const ${i.local} = ${base};` : `const ${i.local} = ${base}[${JSON.stringify(i.name)}];`;
  }).filter(Boolean).join('\n');
  const out = mod.exports.map(([name, local]) => `${JSON.stringify(name)}: ${local}`).join(', ');
  return `__spMod[${JSON.stringify(mod.path)}] = (function () {\n${head}${head ? '\n' : ''}${body}\nreturn { ${out} };\n})();\n`;
}

function declaredData(panel) {
  const raw = panel && (panel.data || panel.tables);
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  /** @type {string[]} */
  const bad = [];
  /** @type {string[]} */
  const ok = [];
  for (const name of list) {
    if (typeof name !== 'string') continue;
    if (DATA_TABLES.has(name)) ok.push(name);
    else bad.push(`data:${name.slice(0, 40)}`);
  }
  return { ok, bad };
}

function packRequires(requires) {
  /** @type {string[]} */
  const out = [];
  const list = Array.isArray(requires) ? requires : [];
  for (const name of list) {
    if (name === 'serviceWorker' || name === 'cacheStorage' || name === 'webCrypto') out.push(name);
  }
  return out;
}

/**
 * Plan one panel. Does not run it.
 * @param {{ files: Map<string, Buffer>, entry: string, panel?: any, parse: Function | null, requires?: unknown }} opts
 */
export function planForgePanel({ files, entry, panel, parse, requires }) {
  const surfaces = new Set();
  const empty = (extra) => ({ ok: false, surfaces: [...surfaces].sort(), listensRoom: false, bundle: '', css: '', copies: [], declared: [], ...extra });
  for (const name of packRequires(requires)) surfaces.add(name);
  for (const name of declaredData(panel).bad) surfaces.add(name);
  if (Array.isArray(panel?.messages) && panel.messages.length) surfaces.add('pack.messages');
  if (panel?.wraps != null) surfaces.add('wraps');
  if (panel?.readonly === false || panel?.readOnly === false) surfaces.add('readonly');
  if (typeof parse !== 'function') {
    surfaces.add('parse');
    return empty({ zh: '没有 JavaScript 解析器，面板脚本没有复制。', en: 'No JavaScript parser is available, so the panel script was not copied.' });
  }
  if (!files.has(entry)) {
    surfaces.add('missing');
    return empty({ zh: '面板脚本不在包里。', en: 'The panel script is not in the pack.' });
  }
  /** @type {Map<string, any>} */
  const mods = new Map();
  const load = (rel) => {
    if (mods.has(rel)) return mods.get(rel);
    const bytes = files.get(rel);
    let mod;
    if (!bytes) mod = { path: rel, error: { surface: 'missing', zh: `${rel} 不在包里。`, en: `${rel} is not in the pack.` } };
    else if (rel.endsWith('.css') || rel.endsWith('.json')) {
      const source = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      mod = { path: rel, asset: true, bytes, source, css: rel.endsWith('.css'), json: rel.endsWith('.json') };
    }
    else mod = readModule(rel, bytes, parse, files);
    mods.set(rel, mod);
    return mod;
  };
  const order = [];
  const state = new Map();
  const visit = (rel) => {
    if (state.get(rel) === 'done') return null;
    if (state.get(rel) === 'open') return { surface: 'cycle', zh: `${rel} 的 import 成环。`, en: `${rel} has a cyclic import.` };
    // Count every unique file before descending, including CSS/JSON assets and the entry itself.
    if (state.size >= PANEL_FILES_MAX) return { surface: 'cap:count', zh: `面板要带的文件超过 ${PANEL_FILES_MAX} 个。`, en: `The panel needs more than ${PANEL_FILES_MAX} files.` };
    const mod = load(rel);
    if (mod.error) return mod.error;
    state.set(rel, 'open');
    if (mod.asset) { state.set(rel, 'done'); order.push(rel); return null; }
    for (const dep of mod.deps) {
      if (!dep.path) continue;
      const why = visit(dep.path);
      if (why) return why;
    }
    state.set(rel, 'done');
    order.push(rel);
    return null;
  };
  const styleList = typeof panel?.styles === 'string' ? [panel.styles] : Array.isArray(panel?.styles) ? panel.styles : [];
  if (panel?.styles != null && typeof panel.styles !== 'string' && !Array.isArray(panel.styles)) surfaces.add('style-type');
  for (const rel of styleList) {
    if (typeof rel !== 'string') { surfaces.add('style-type'); continue; }
    const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!norm.endsWith('.css')) { surfaces.add('style-type'); continue; }
    if (!files.has(norm)) { surfaces.add('style-missing'); continue; }
    const why = visit(norm);
    if (why) surfaces.add(why.surface || 'style');
  }
  const whyEntry = visit(entry);
  if (whyEntry) surfaces.add(whyEntry.surface || 'graph');
  let total = 0;
  let listensRoom = false;
  let supported = false;
  let hasMount = false;
  /** @type {{ src: string, dest: string, text: string }[]} */
  const copies = [];
  let css = '';
  for (const rel of order) {
    const mod = mods.get(rel);
    if (!mod || mod.error) continue;
    const bytes = mod.asset ? mod.bytes : Buffer.from(mod.source);
    if (bytes.length > PANEL_FILE_MAX) surfaces.add('cap:file');
    total += bytes.length;
    if (mod.css) css += `${mod.source}\n`;
    if (!mod.asset) {
      for (const name of mod.surfaces) surfaces.add(name);
      if (mod.supported) supported = true;
      if (mod.listensRoom) listensRoom = true;
      if (mod.hasMount) hasMount = true;
    }
    const text = bytes.toString('utf8');
    copies.push({ src: rel, dest: `ui/mod/${rel}`, text });
  }
  if (total > PANEL_TOTAL_MAX) surfaces.add('cap:total');
  if (!hasMount) surfaces.add('no-mount');
  else if (!supported) {
    surfaces.add('no-surface');
    if (css.trim()) surfaces.add('host-stylesheet');
  }
  if (surfaces.has('no-mount') || surfaces.has('no-surface') || [...surfaces].some((name) => name !== 'no-surface' && name !== 'no-mount')) {
    const list = [...surfaces].sort();
    return {
      ok: false, surfaces: list, listensRoom, bundle: '', css: '', copies: [], declared: declaredData(panel).ok,
      zh: `面板脚本没有复制（${list.join('、')}）。`,
      en: `The panel script was not copied (${list.join(', ')}).`,
    };
  }
  /** @type {string[]} */
  const parts = ['var __spMod = Object.create(null);\n'];
  // Install the translation wrapper before module initialization, so static imports bind a callable function.
  parts.push('globalThis.__spForgeT = function (msgid, vars) {\n');
  parts.push('  var api = globalThis.__spForge;\n');
  parts.push('  return api && api.__t ? api.__t(msgid, vars) : String(msgid);\n};\n');
  for (const rel of order) {
    const mod = mods.get(rel);
    if (!mod || mod.error) continue;
    if (mod.css) {
      parts.push(`__spMod[${JSON.stringify(rel)}] = { default: null };\n`);
      continue;
    }
    if (mod.json) {
      let value;
      try { value = JSON.parse(mod.source); }
      catch { return { ok: false, surfaces: ['json'], listensRoom, bundle: '', css: '', copies: [], declared: [], zh: `${rel} 不是 JSON。`, en: `${rel} is not JSON.` }; }
      parts.push(`__spMod[${JSON.stringify(rel)}] = { default: ${JSON.stringify(value)} };\n`);
      continue;
    }
    parts.push(renderModule(mod));
  }
  parts.push(`globalThis.__spForgeMount = (__spMod[${JSON.stringify(entry)}] || {}).mount || (__spMod[${JSON.stringify(entry)}] || {})["default"];\n`);
  const bundle = parts.join('');
  try { parse(bundle, { ecmaVersion: 2022, sourceType: 'script' }); }
  catch (e) {
    return {
      ok: false, surfaces: ['rewrite'], listensRoom, bundle: '', css: '', copies: [], declared: [],
      zh: `面板脚本转不成经典脚本（${String(e?.message || e).slice(0, 120)}）。`,
      en: `The panel script could not be rewritten as a classic script (${String(e?.message || e).slice(0, 120)}).`,
    };
  }
  return { ok: true, surfaces: [], listensRoom, bundle, css, copies, declared: declaredData(panel).ok, zh: '', en: '' };
}

function scriptSafe(text) {
  return String(text).replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * The entry page. The shim and the rewritten panel are inline, so they run under script-src 'unsafe-inline'.
 * The copied modules are also written beside this file and are not referenced from here.
 * @param {{ slot: string, title: string, bundle: string, css: string, strings: Record<string, Record<string, string>>, marker: string | null, declared: string[], packId: string, panelId: string, order: number }} opts
 */
export function forgePanelPage(opts) {
  const title = String(opts.title || opts.slot || 'panel').replace(/[<>&]/g, '');
  const boot = {
    id: opts.panelId || '',
    pack: opts.packId || '',
    slot: opts.slot,
    order: typeof opts.order === 'number' ? opts.order : 0,
    gate: null,
    hostKey: null,
    marker: opts.marker || null,
    strings: opts.strings || {},
    declared: opts.declared || [],
    lang: 'zh',
  };
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  const css = scriptSafe(String(opts.css || '')).replace(/<\/(style)/gi, '<\\/$1');
  // [ASSUMED] Scroll the shim's panel host at its current width, keeping narrow panels and other slots unchanged.
  const scroll = opts.slot === 'result.tab' ? '\n<style>body.sp-forge-result > div{max-width:100%;overflow-x:auto}</style>' : '';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>html{color-scheme:dark}html,body{margin:0;background:transparent;color:#e8e0d0;font:12px/1.4 sans-serif}body{padding:6px}</style>
<style>${css}</style>${scroll}
</head>
<body${opts.slot === 'result.tab' ? ' class="sp-forge-result"' : ''}>
<script>
${scriptSafe(FORGE_SHIM_TEXT)}
${scriptSafe(opts.bundle)}
__spForge.__t = function (msgid, vars) {
  var feed = __spForge.__feed;
  if (!feed || !feed.ctx || typeof feed.ctx.t !== 'function') return String(msgid);
  return feed.ctx.t(msgid, vars);
};
var __spBoot = ${bootJson};
var __spCreate = __spForge.create;
__spForge.create = function (opts) {
  var feed = __spCreate(opts);
  __spForge.__feed = feed;
  return feed;
};
__spForge.boot(__spBoot);
</script>
</body>
</html>
`;
}

export { FORGE_SHIM_TEXT };
