// server/plugins/forgeKits.js — Forge kit files (`kits/<id>.js`) → the one sim entry of a script plugin (DESIGN §32.12,
// (i18n-ignore-file: the reasons are author-facing and bilingual by design, 中文 · English — as forgeImport.js)
// docs/PLUGINS.md §16). Original code. A pack is untrusted: its files are parsed with acorn and rewritten by source
// offsets. Nothing is import()ed, eval()ed or require()d here, and nothing runs during the import.
//
// Production script plugins allow only self-contained entries (PLUGINS.md §13: readScripts reads the entries, the
// descriptors carry their sources, and scriptCheck refuses every import but sp:sdk@1). So the kit and every `./` file
// of the pack it imports are carried in that one entry, each Forge file in a function scope of its own, in dependency
// order. Only their import and export lines change:
//   @kit/tier1.js { name }      → sp:sdk@1 kit.name       (the 24 helpers of the SDK's `kit`, tier1 signatures)
//   @sim/constants.js { name }  → sp:sdk@1 constants.name
//   @sim/detmath.js { name }    → sp:sdk@1 math.name
//   ./x.js (a file of the pack) → the scope of that file, carried in the same entry
// Every other specifier (@kit/tier2–6, @kit/summoner, @ops/…, a bare name, an absolute path,
// `..`) refuses the file, and with it every kit that imports it. A file must also keep the sandbox's syntax
// (shared/plugins/sandbox.js compileModule: no dynamic import, import.meta, async, generators or **), and the written
// entry must pass shared/plugins/scriptCheck.js, the registry's own scan. A file that fails is named and not written.
//
// [ASSUMED] — listed in IMPORT-REPORT.md and PLUGINS.md §16:
//   * One script plugin for the pack, one sim entry, one `sp.kits.register(id, builder)` per kit.
//   * A helper name of the SDK's `kit` is the same helper as Forge's tier1 export of that name. The SDK's record
//     helpers return frozen copies, so a kit that writes into such a record fails when it runs, not here.
//   * Imports are initialization-time bindings, as in the sandbox: an export is read once, after its file ran.
//   * At most 64 Forge files a kit and 1 MiB for the whole entry (the sandbox's per-plugin limit, SANDBOX_LIMITS).

import * as SIM_CONSTANTS from '../sim/constants.js';
import * as DETMATH from '../sim/detmath.js';
import { checkScript } from '../../shared/plugins/scriptCheck.js';

/** The helpers `sp:sdk@1` exports as `kit` (shared/plugins/sdk.js; test/plugins/forgeImport.test.js pins the list). */
export const SDK_KIT_NAMES = Object.freeze(['num', 'talentBb', 'talentGrid', 'moduleBb', 'traitBb', 'moduleOn', 'up', 'cheb',
  'isMainHit', 'byEnemyAttack', 'skillBusy', 'giveSp', 'onHitBy', 'onHitOn', 'onDamagedOn', 'enemiesInGrid', 'alliesInGridOf',
  'enemyInRange', 'statBuff', 'toggleBuff', 'instantKind', 'skillRec', 'skillBbOf', 'batMod']);

/** Forge's SDK specifiers this importer rewrites to `sp:sdk@1`: the SDK member, and the names it has. */
export const FORGE_IMPORT_MAP = Object.freeze({
  '@kit/tier1.js': Object.freeze({ member: 'kit', names: SDK_KIT_NAMES }),
  '@sim/constants.js': Object.freeze({ member: 'constants', names: Object.freeze(Object.keys(SIM_CONSTANTS)) }),
  '@sim/detmath.js': Object.freeze({ member: 'math', names: Object.freeze(Object.keys(DETMATH)) }),
  '@sim/dir.js': Object.freeze({ member: 'dir', names: Object.freeze(['dirVec', 'offsetTile']) }),
  '@sim/targeting.js': Object.freeze({ member: 'targeting', names: Object.freeze(['absoluteRangeKeys']) }),
});

/** The sandbox's per-plugin source cap (shared/plugins/sandbox.js SANDBOX_LIMITS.bytes; the test pins it). */
export const KIT_BUNDLE_BYTES = 1024 * 1024;
/** [ASSUMED] The Forge files one kit may pull in (the sandbox's SANDBOX_LIMITS.files). */
export const KIT_MODULES_MAX = 64;
const SDK_SPEC = 'sp:sdk@1';
const SDK_ALIAS = { kit: '__forgeKit', math: '__forgeMath', constants: '__forgeConstants', dir: '__forgeDir', targeting: '__forgeTargeting' };
const RESERVED = /^(__forge|__spSandbox)/;

const say = (zh, en) => ({ zh, en });
/** Untrusted text (a specifier, an export name) as it is shown in the report: one line, at most 80 characters. */
const shown = (v) => String(v).replace(/[\u0000-\u001f\u007f`]/g, '?').slice(0, 80);

/** Forge's own rule for a pack-relative specifier (`./a.js`, `./lib/b.js`): `.js`, no `..`, `%`, query, `\\` or empty part. */
export function isPackRelative(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('./') || spec.length > 200) return false;
  if (/[%?#\\]/.test(spec) || !spec.endsWith('.js')) return false;
  const parts = spec.slice(2).split('/');
  return parts.every((p) => p && p !== '.' && p !== '..' && /^[A-Za-z0-9_.-]+$/.test(p));
}

function resolveRelative(from, spec) {
  const dir = from.split('/').slice(0, -1);
  return [...dir, ...spec.slice(2).split('/')].join('/');
}

const specName = (n) => (n.type === 'Literal' ? String(n.value) : n.name);

/** The sandbox's syntax rules, and the importer's reserved names. Returns the first offence or null. */
function syntaxOffence(ast) {
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'ImportExpression') return say('动态 import()', 'a dynamic import()');
    if (n.type === 'MetaProperty' && n.meta?.name === 'import') return say('import.meta', 'import.meta');
    if (n.type === 'AwaitExpression') return say('await', 'await');
    if (n.type === 'YieldExpression' || n.generator) return say('生成器函数', 'a generator function');
    if (n.async) return say('async 函数', 'an async function');
    if (n.operator === '**' || n.operator === '**=') return say('** 运算符（改用 sp.math.powi）', 'the ** operator (use sp.math.powi)');
    if (n.type === 'Identifier' && RESERVED.test(n.name)) return say(`保留名 ${n.name}`, `the reserved name ${n.name}`);
    for (const v of Object.values(n)) if (v && typeof v === 'object') { if (Array.isArray(v)) stack.push(...v); else stack.push(v); }
  }
  return null;
}

/** A default export that is certainly not a kit function (an object, an array, a literal, a class). */
function notAFunction(decl) {
  return ['ObjectExpression', 'ArrayExpression', 'Literal', 'TemplateLiteral', 'ClassDeclaration', 'ClassExpression'].includes(decl?.type);
}

/**
 * Parse one Forge file and plan its rewrite (source offsets only). Dependencies stay symbolic (`deps[i].path`) until
 * the caller has every file of the graph.
 */
function readModule(path, bytes, parse) {
  const fail = (zh, en) => ({ path, error: { zh: `${path}：${zh}`, en: `${path}: ${en}` } });
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('不是 UTF-8 文本。', 'it is not UTF-8 text.'); }
  if (Buffer.byteLength(source) > KIT_BUNDLE_BYTES) return fail('超过 1 MiB。', 'it is larger than 1 MiB.');
  let ast;
  try { ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true }); }
  catch (e) { return fail(`解析不了（${String(e?.message || e).slice(0, 120)}）。`, `it does not parse (${String(e?.message || e).slice(0, 120)}).`); }
  const bad = syntaxOffence(ast);
  if (bad) return fail(`用了沙箱不支持的${bad.zh}。`, `it uses ${bad.en}, which the sandbox does not run.`);
  /** @type {{ spec: string, path?: string, sdk?: string }[]} */
  const deps = [];
  /** @type {{ local: string, from: number, name: string | null }[]} */
  const imports = [];
  /** @type {[string, { from?: number, name?: string, local?: string }][]} */
  const exports = [];
  /** @type {[number, number, string][]} */
  const edits = [];
  const mapped = [];
  const depOf = (spec, n) => {
    if (spec === SDK_SPEC) return { error: null, index: deps.push({ spec, sdk: SDK_SPEC }) - 1 };
    if (Object.hasOwn(FORGE_IMPORT_MAP, spec)) return { error: null, index: deps.push({ spec, sdk: FORGE_IMPORT_MAP[spec].member }) - 1 };
    if (isPackRelative(spec)) return { error: null, index: deps.push({ spec, path: resolveRelative(path, spec) }) - 1 };
    const line = n.loc?.start?.line ?? 0;
    return { error: fail(`第 ${line} 行的 import「${shown(spec)}」映射不到 sp:sdk@1（只认 ${Object.keys(FORGE_IMPORT_MAP).join('、')} 和包里的 ./ 文件）。`,
      `the import "${shown(spec)}" on line ${line} has no sp:sdk@1 equivalent (only ${Object.keys(FORGE_IMPORT_MAP).join(', ')} and the pack's own ./ files map).`) };
  };
  const sdkName = (dep, name, n) => {
    const d = deps[dep];
    if (!d.sdk) return null;
    const line = n.loc?.start?.line ?? 0;
    if (d.sdk === SDK_SPEC) {
      if (!Object.hasOwn(SDK_ALIAS, name)) return fail(`第 ${line} 行从 sp:sdk@1 取「${shown(name)}」：只能取 kit、math、constants、dir、targeting。`, `line ${line} takes "${shown(name)}" from sp:sdk@1: only kit, math, constants, dir and targeting can be taken.`);
      return null;
    }
    const map = FORGE_IMPORT_MAP[d.spec];
    if (d.spec === '@sim/targeting.js' && name === 'sortEnemyTargets') return fail('sortEnemyTargets 会改写候选数组并读取活的战场对象，没有安全的纯函数映射。', 'sortEnemyTargets mutates the candidate array and reads live battle objects; no safe pure mapping is exposed.');
    if (!map.names.includes(name)) return fail(`第 ${line} 行从 ${d.spec} 取的「${shown(name)}」不在 sp:sdk@1 的 ${map.member} 里。`, `"${shown(name)}" on line ${line} is not in the ${map.member} of sp:sdk@1 (from ${d.spec}).`);
    return null;
  };
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      const dep = depOf(n.source.value, n);
      if (dep.error) return dep.error;
      const d = deps[dep.index];
      for (const s of n.specifiers) {
        if (s.type === 'ImportNamespaceSpecifier' || s.type === 'ImportDefaultSpecifier') {
          if (d.sdk) return fail(`第 ${n.loc.start.line} 行整体或默认引入 ${d.spec}：只能按名字引入。`, `line ${n.loc.start.line} imports ${d.spec} as a whole or as a default: import it by name.`);
          imports.push({ local: s.local.name, from: dep.index, name: s.type === 'ImportDefaultSpecifier' ? 'default' : null });
          continue;
        }
        const name = specName(s.imported);
        const err = sdkName(dep.index, name, n);
        if (err) return err;
        imports.push({ local: s.local.name, from: dep.index, name });
        if (d.sdk && d.sdk !== SDK_SPEC) mapped.push(`${d.spec} { ${name} } → ${SDK_SPEC} ${d.sdk}.${name}`);
      }
      edits.push([n.start, n.end, '']);
    } else if (n.type === 'ExportDefaultDeclaration') {
      const decl = n.declaration;
      if (notAFunction(decl)) return fail('默认导出不是函数（Forge 的 kit 契约是 export default function kit(bb, chess, def)）。', 'the default export is not a function (Forge\'s kit contract is export default function kit(bb, chess, def)).');
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
        edits.push([n.start, decl.start, '']);
        exports.push(['default', { local: decl.id.name }]);
      } else {
        edits.push([n.start, decl.start, 'const __forgeDefault = ']);
        edits.push([n.end, n.end, ';']);
        exports.push(['default', { local: '__forgeDefault' }]);
      }
    } else if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) {
        const d = n.declaration;
        if (d.type === 'VariableDeclaration') {
          if (d.kind !== 'const' || d.declarations.some((v) => v.id.type !== 'Identifier')) return fail(`第 ${n.loc.start.line} 行的导出要写成简单的 const（沙箱不接受 let、var 或解构导出）。`, `line ${n.loc.start.line} must export a simple const (the sandbox takes no let, var or destructuring export).`);
          for (const v of d.declarations) exports.push([v.id.name, { local: v.id.name }]);
        } else exports.push([d.id.name, { local: d.id.name }]);
        edits.push([n.start, d.start, '']);
      } else {
        let from = null;
        if (n.source) {
          const dep = depOf(n.source.value, n);
          if (dep.error) return dep.error;
          from = dep.index;
        }
        for (const s of n.specifiers) {
          const local = specName(s.local);
          if (from != null) {
            const err = sdkName(from, local, n);
            if (err) return err;
            exports.push([specName(s.exported), { from, name: local }]);
          } else exports.push([specName(s.exported), { local }]);
        }
        edits.push([n.start, n.end, '']);
      }
    } else if (n.type === 'ExportAllDeclaration') {
      return fail(`第 ${n.loc.start.line} 行的 export * 沙箱不支持。`, `the export * on line ${n.loc.start.line} is not supported by the sandbox.`);
    }
  }
  const names = new Set();
  for (const [name] of exports) {
    if (names.has(name)) return fail(`导出名「${shown(name)}」重复。`, `the export name "${shown(name)}" is duplicated.`);
    names.add(name);
  }
  return { path, source, deps, imports, exports, edits, mapped, hasDefault: names.has('default') };
}

/** The scope text of one file: its imports first (they are hoisted in a module), its body, its frozen exports. */
function renderModule(m, varOf) {
  const ref = (dep, name) => {
    const d = m.deps[dep];
    if (d.sdk === SDK_SPEC) return SDK_ALIAS[name];
    const base = d.sdk ? SDK_ALIAS[d.sdk] : varOf(d.path);
    return name == null ? base : `${base}[${JSON.stringify(name)}]`;
  };
  let body = m.source;
  for (const [start, end, value] of [...m.edits].sort((a, b) => b[0] - a[0] || b[1] - a[1])) body = body.slice(0, start) + value + body.slice(end);
  const head = m.imports.map((i) => `const ${i.local} = ${ref(i.from, i.name)};`).join('\n');
  const out = m.exports.map(([name, e]) => `${JSON.stringify(name)}: ${e.local ?? ref(e.from, e.name)}`).join(', ');
  return `const ${varOf(m.path)} = (() => {\n${head}${head ? '\n' : ''}${body}\nreturn __forgeFreeze({ ${out} });\n})();`;
}

/**
 * Bundle the kits of a pack into one sim entry. Never runs a file. A kit that cannot be carried is refused, named,
 * and left out; the others are still written.
 * @param {{ files: Map<string, Buffer>, kits: { file: string, register: string }[], parse: Function | null, header?: string[] }} opts
 * @returns {{ source: string | null, registered: { file: string, register: string, carried: string[] }[], refused: { path: string, zh: string, en: string }[], mapped: string[], notes: { path: string, zh: string, en: string }[] }}
 */
export function bundleForgeKits({ files, kits, parse, header = [] }) {
  /** @type {{ path: string, zh: string, en: string }[]} */
  const refused = [];
  if (typeof parse !== 'function') {
    for (const k of kits) refused.push({ path: k.file, zh: `${k.file}：没有 JavaScript 解析器，转不成脚本插件。`, en: `${k.file}: no JavaScript parser is available, so it was not converted.` });
    return { source: null, registered: [], refused, mapped: [], notes: [] };
  }
  /** @type {Map<string, any>} */
  const modules = new Map();
  const vars = new Map();
  const varOf = (p) => vars.get(p);
  const load = (p) => {
    if (modules.has(p)) return modules.get(p);
    let m;
    if (!files.has(p)) m = { path: p, error: { zh: `${p}：包里没有这个文件。`, en: `${p}: the pack has no such file.` } };
    else m = readModule(p, files.get(p), parse);
    if (!m.error) vars.set(p, `__forgeModule${vars.size}`);
    modules.set(p, m);
    return m;
  };
  /** Every file of a kit's graph in dependency order, or the first reason it cannot be carried. */
  const graphOf = (entry) => {
    const order = [];
    const state = new Map();
    const visit = (p, chain) => {
      if (state.get(p) === 'done') return null;
      if (state.get(p) === 'open') return { zh: `${[...chain, p].join(' → ')}：循环 import。`, en: `${[...chain, p].join(' → ')}: a cyclic import.` };
      const m = load(p);
      if (m.error) return m.error;
      state.set(p, 'open');
      for (const d of m.deps) {
        if (!d.path) continue;
        const why = visit(d.path, [...chain, p]);
        if (why) return why;
        const dep = modules.get(d.path);
        const wanted = [...m.imports.filter((i) => m.deps[i.from] === d && i.name != null).map((i) => i.name),
          ...m.exports.filter(([, e]) => e.from != null && m.deps[e.from] === d).map(([, e]) => e.name)];
        for (const name of wanted) {
          if (!dep.exports.some(([n]) => n === name)) return { zh: `${p}：${d.path} 没有导出「${shown(name)}」。`, en: `${p}: ${d.path} does not export "${shown(name)}".` };
        }
      }
      state.set(p, 'done');
      order.push(p);
      if (order.length > KIT_MODULES_MAX) return { zh: `${entry}：要带的文件超过 ${KIT_MODULES_MAX} 个。`, en: `${entry}: it needs more than ${KIT_MODULES_MAX} files.` };
      return null;
    };
    const why = visit(entry, []);
    return why ? { error: why } : { order };
  };
  const checked = new Map();
  const renderChecked = (p) => {
    if (checked.has(p)) return checked.get(p);
    const text = renderModule(modules.get(p), varOf);
    const problems = checkScript(text).problems;
    const got = problems.length
      ? { error: { zh: `${p}：没有通过脚本检查（${problems[0].message}）。`, en: `${p}: it fails the script check (${problems[0].message}).` } }
      : { text };
    checked.set(p, got);
    return got;
  };
  /** @type {{ file: string, register: string, carried: string[] }[]} */
  const accepted = [];
  const emitted = [];
  const seen = new Set();
  for (const k of kits) {
    const g = graphOf(k.file);
    let why = g.error || null;
    if (!why && !modules.get(k.file).hasDefault) why = { zh: `${k.file}：没有默认导出（Forge 读的是 mod.default）。`, en: `${k.file}: it has no default export (Forge reads mod.default).` };
    if (!why) for (const p of g.order) { const r = renderChecked(p); if (r.error) { why = r.error; break; } }
    if (why) { refused.push({ path: k.file, zh: why.zh, en: why.en }); continue; }
    accepted.push({ file: k.file, register: k.register, carried: g.order.filter((p) => p !== k.file) });
    for (const p of g.order) if (!seen.has(p)) { seen.add(p); emitted.push(p); }
  }
  if (!accepted.length) return { source: null, registered: [], refused, mapped: [], notes: [] };
  const used = new Set();
  for (const p of emitted) for (const d of modules.get(p).deps) if (d.sdk && d.sdk !== SDK_SPEC) used.add(d.sdk);
  for (const p of emitted) {
    const m = modules.get(p);
    for (const i of m.imports) if (m.deps[i.from].sdk === SDK_SPEC) used.add(i.name);
    for (const [, e] of m.exports) if (e.from != null && m.deps[e.from].sdk === SDK_SPEC) used.add(e.name);
  }
  const sdkLine = used.size ? `import { ${Object.keys(SDK_ALIAS).filter((m) => used.has(m)).map((m) => `${m} as ${SDK_ALIAS[m]}`).join(', ')} } from '${SDK_SPEC}';\n\n` : '';
  // Number the scopes in the order they are written (the checks above used the load order; names are not checked).
  vars.clear();
  emitted.forEach((p, i) => vars.set(p, `__forgeModule${i}`));
  const comment = header.map((l) => `// ${l}`.trimEnd()).join('\n');
  const parts = emitted.map((p) => `// ---- ${p} ----\n${renderModule(modules.get(p), varOf)}`);
  const register = accepted.map((k) => `  sp.kits.register(${JSON.stringify(k.register)}, ${varOf(k.file)}["default"]);`).join('\n');
  // taken before any Forge file runs, so a file's own top-level `Object` cannot change how its exports are frozen
  const freezeLine = 'const __forgeFreeze = Object.freeze;\n\n';
  const source = `${comment}${comment ? '\n\n' : ''}${sdkLine}${freezeLine}${parts.join('\n\n')}\n\nexport default function setup(sp) {\n${register}\n}\n`;
  const all = (zh, en) => {
    for (const k of accepted) refused.push({ path: k.file, zh: `${k.file}：${zh}`, en: `${k.file}: ${en}` });
    return { source: null, registered: [], refused, mapped: [], notes: [] };
  };
  if (Buffer.byteLength(source) > KIT_BUNDLE_BYTES) return all('合在一起的入口超过 1 MiB（沙箱的上限）。', 'the combined entry is larger than 1 MiB (the sandbox limit).');
  const final = checkScript(source);
  if (final.problems.length) return all(`合在一起的入口没有通过脚本检查（${final.problems[0].message}）。`, `the combined entry fails the script check (${final.problems[0].message}).`);
  const mapped = [...new Set(emitted.flatMap((p) => modules.get(p).mapped))].sort();
  // Not a refusal: our engine (and Forge's, the same rule) sets a kit up before the unit is alive, and addBuff refuses a
  // unit that is not alive unless the buff says allowDead. A plain text search, so it is advice only.
  const notes = emitted.filter((p) => /\baddBuff\s*\(/.test(modules.get(p).source) && !/\ballowDead\b/.test(modules.get(p).source)).map((p) => ({
    path: p,
    zh: `${p} 调用 addBuff 时没有写 allowDead：在 install 里（开战前，干员还没部署）加的 buff 会被引擎拒掉。常驻的天赋 buff 要写 persist: true 和 allowDead: true（和 kit.statBuff 一样）。`,
    en: `${p} calls addBuff without allowDead: a buff added in install (before the battle starts, when the unit is not deployed yet) is refused by the engine. A permanent talent buff needs persist: true and allowDead: true (as kit.statBuff does).`,
  }));
  return { source, registered: accepted, refused, mapped, notes };
}
