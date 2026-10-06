#!/usr/bin/env node
// tools/i18n.mjs — UI string tooling for the gettext-style i18n (shared/i18n.js, public/i18n/<lang>.json; docs/I18N.md).
//
//   node tools/i18n.mjs extract [paths…] [--list] [--json]
//       per file: the msgids passed to t() / tc() / tParts() / N_() / msg(), and the Chinese literals still shown untranslated
//       (string literals, template literals, html`` text and attribute values outside those calls; comments,
//       console.* and Error messages are ignored). --list prints each literal with its line.
//   node tools/i18n.mjs check [paths…] [--lang en] [--strict] [--stale]
//       msgids the code uses that public/i18n/<lang>.json lacks (exit 1 with --strict when any); --stale also lists
//       entries no scanned code uses (not an error: phase 2 wraps the rest of the UI later).
//   node tools/i18n.mjs codemod <files…> [--write]
//       wrap Chinese literals: html`` text runs / attribute values → ${t('…')}, plain strings → t('…'), template
//       literals → t('…{name}…', { name }); adds the import. Module-level literals (evaluated once, before a language
//       can change) are only marked N_('…') and listed: call t() where they are shown. Literals compared, used as keys,
//       or passed to string methods are left alone, and so is a line marked `// i18n-ignore`. A text run with a child
//       that is not a plain value (`${a || b}`, a vnode) is split into its static pieces. Prints a summary; --write saves
//       the files. Review the result.
//   node tools/i18n.mjs seed --from <file.json> [--lang en] [--all] [--write]
//       fill public/i18n/<lang>.json from a flat { msgid: translation } map for the msgids the code uses (--all: also
//       for the Chinese literals not wrapped yet, under the msgid the codemod would give them). Existing entries win.
//
// Default paths: public/js, shared, server (extract / seed skip server/sim, whose strings are game logic; check reads
// its msg() and ctx.toast texts too). Server texts: a Chinese literal passed to m.toast / ctx.toast / tickerText is a
// msgid (the client translates the text it receives), as is the first argument of msg(). Message ids: the Chinese text itself; a template literal's expressions become named params (paramName()).
// Needs the dev dependencies (oxc-parser).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff01-\uff60]/;
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const DEFAULT_ROOTS = ['public/js', 'shared', 'server'];
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'assets', 'fonts', 'dev']);
/** Calls whose first argument is a msgid (tc: the second, keyed `context::msgid`). */
const MSGID_CALLS = new Set(['t', 'tParts', 'N_', 'msg']);
/**
 * Server messaging methods (m.toast, ctx.toast, this.tickerText …, called on an object): a Chinese string literal they
 * get is sent as text and translated by the client as a msgid (main.js translateWire).
 */
const SERVER_TEXT_CALLS = new Set(['toast', 'tickerText', 'ticker']);
/** Calls whose arguments are never UI text to wrap. */
const SKIP_CALLS = new Set(['t', 'tc', 'tParts', 'N_', 'msg', 'tName', 'dn', 'format', 'renderMessage', 'require', 'import']);
/** String methods: a literal argument is data, not display text. */
const STRING_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'replace', 'replaceAll', 'split',
  'match', 'matchAll', 'test', 'search', 'has', 'get', 'set', 'delete', 'localeCompare', 'padStart', 'padEnd', 'join', 'add']);
/**
 * Object tables of msgids defined without N_() (their values are translated where they are shown): file → names.
 * `check` treats their string values as msgids.
 */
const MSGID_TABLES = [
  ['shared/constants.js', ['ERR_TEXT', 'DIFFICULTY_NAMES']],
  ['public/js/net.js', ['CLIENT_ERR_TEXT']],
  ['public/js/main.js', ['CLOSE_REASON']],
];

// ===== message ids ===================================================================================================

/**
 * The param name of a template-literal expression: an identifier keeps its name, `a.b.c` → `c` (`x.length` → `n`);
 * anything else is positional (`0`, `1` …, its index among the expressions).
 * @param {string} src expression source
 * @param {number} index
 */
export function paramName(src, index) {
  const s = String(src).trim();
  if (/^[A-Za-z_$][\w$]*$/.test(s)) return s;
  const m = s.match(/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/);
  if (m) {
    const last = s.split(/\??\./).pop();
    return last === 'length' ? 'n' : last;
  }
  return String(index);
}

/**
 * Msgid and params of a template literal from its static parts and expression sources.
 * @param {string[]} quasis cooked static parts (n + 1)
 * @param {string[]} exprs expression sources (n)
 * @returns {{ msgid: string, params: { name: string, src: string }[] }}
 */
export function templateMsgid(quasis, exprs) {
  const names = new Map(); // src → name
  const used = new Set();
  const params = [];
  let msgid = quasis[0] ?? '';
  exprs.forEach((src, i) => {
    let name = names.get(src);
    if (!name) {
      let base = paramName(src, i);
      name = base;
      for (let k = 2; used.has(name); k++) name = `${base}${k}`;
      names.set(src, name);
      used.add(name);
      params.push({ name, src });
    }
    msgid += `{${name}}${quasis[i + 1] ?? ''}`;
  });
  return { msgid, params };
}

/** JS source of a single-quoted string. */
export function quote(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
}

/** Source of a params object for t(): `{ a, b: expr, 0: expr }`. */
function paramsSource(params) {
  if (!params.length) return '';
  return `, { ${params.map(({ name, src }) => (name === src ? name : `${name}: ${src}`)).join(', ')} }`;
}

// ===== AST helpers ===================================================================================================

/** Generic AST walk with ancestors (enter(node, ancestors) → false skips the children). */
function walk(node, enter, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  if (enter(node, ancestors) === false) return;
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, enter, ancestors); } else if (v && typeof v.type === 'string') walk(v, enter, ancestors);
  }
  ancestors.pop();
}

const calleeName = (call) => {
  const c = call?.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  return null;
};
const isConsoleCall = (call) => call?.callee?.type === 'MemberExpression' && call.callee.object?.type === 'Identifier' && call.callee.object.name === 'console';
/** A logger call (`log.warn(…)`, `this.m.log?.warn?.(…)`): developer text, like console.*. */
const isLogCall = (call) => {
  const c = call?.callee;
  if (!c || c.type !== 'MemberExpression') return false;
  const o = c.object;
  const LOG = /^(log|logger)$/;
  return (o.type === 'Identifier' && LOG.test(o.name)) || (o.type === 'MemberExpression' && !o.computed && o.property.type === 'Identifier' && LOG.test(o.property.name));
};
/** The developer detail of an error result (`{ error: 'BAD_TARGET', detail: '…' }`, `ev.detail = '…'`): never shown to players. */
const isDetail = (node, parent) => (parent.type === 'Property' && parent.value === node && !parent.computed && (parent.key.name ?? parent.key.value) === 'detail')
  || (parent.type === 'AssignmentExpression' && parent.right === node && parent.left.type === 'MemberExpression' && !parent.left.computed && parent.left.property.name === 'detail');

/** Why a literal must not be wrapped (null = wrap it). `aliases`: local name → shared/i18n.js export (`t as tr`). */
function skipReason(node, ancestors, aliases = new Map()) {
  const parent = ancestors[ancestors.length - 1];
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'CallExpression') {
      if (isConsoleCall(a) || isLogCall(a)) return 'console';
      const name = calleeName(a);
      if (a.callee.type === 'Identifier' && SKIP_CALLS.has(aliases.get(name) ?? name)) return 'in-call';
    }
    if (a.type === 'NewExpression' && a.callee.type === 'Identifier' && /Error$/.test(a.callee.name)) return 'error';
    if (a.type === 'ThrowStatement') return 'error';
    if (a.type === 'ImportDeclaration' || a.type === 'ExportAllDeclaration' || (a.type === 'ExportNamedDeclaration' && a.source)) return 'import';
  }
  if (!parent) return null;
  // (inside a detail too: `detail: \`… ${x ? '甲' : '乙'}\``)
  if (isDetail(node, parent) || ancestors.some((a, i) => i > 0 && isDetail(a, ancestors[i - 1]))) return 'detail';
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return 'key';
  if (parent.type === 'MemberExpression' && parent.property === node) return 'key';
  if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!=', 'in', 'instanceof'].includes(parent.operator)) return 'compare';
  if (parent.type === 'SwitchCase' && parent.test === node) return 'compare';
  if (parent.type === 'CallExpression' && parent.arguments.includes(node)) {
    const name = calleeName(parent);
    if (parent.callee.type === 'MemberExpression' && STRING_METHODS.has(name)) return 'string-method';
  }
  if (parent.type === 'TaggedTemplateExpression') return 'tagged';
  return null;
}

/** Whether a node sits in a function (render time) rather than at module level (evaluated once at load). */
const inFunction = (ancestors) => ancestors.some((a) => a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression' || a.type === 'MethodDefinition');

/**
 * Split an html`` template into its text runs and attribute values with Chinese (htm syntax: the static parts are
 * HTML-like, `${}` are children or attribute values). A text run is the text between two tags, `${}` children included
 * when they are simple values (identifiers, member chains, literals, String(…)); a run with other children (vnodes,
 * components, conditionals) is split into its static pieces.
 * @param {any} tpl TemplateLiteral node of an html`` tag
 * @returns {{ kind: 'text'|'attr', start: number, end: number, quasis: string[], exprs: any[], attr?: string }[]}
 */
function htmlSegments(tpl) {
  const out = [];
  const qs = tpl.quasis;
  let state = 'TEXT';
  let quoteCh = null;
  /** @type {{ parts: ({ text: string, from: number, to: number } | { expr: any, from: number, to: number })[] } | null} */
  let run = null;
  let attr = null;
  const simple = (e) => e.type === 'Identifier' || e.type === 'MemberExpression' || e.type === 'Literal' || (e.type === 'CallExpression' && calleeName(e) === 'String');
  const textSeg = (parts) => {
    const quasis = [];
    const exprs = [];
    let cur = '';
    for (const p of parts) { if ('expr' in p) { quasis.push(cur); cur = ''; exprs.push(p.expr); } else cur += p.text; }
    quasis.push(cur);
    const lead = quasis[0].match(/^\s*/)[0];
    const trail = quasis[quasis.length - 1].match(/\s*$/)[0];
    if (quasis.length === 1 && lead.length === quasis[0].length) return null;
    quasis[0] = quasis[0].slice(lead.length);
    quasis[quasis.length - 1] = quasis[quasis.length - 1].slice(0, quasis[quasis.length - 1].length - trail.length);
    const first = parts[0];
    const last = parts[parts.length - 1];
    const start = first.from + ('expr' in first ? 0 : lead.length);
    const end = last.to - ('expr' in last ? 0 : trail.length);
    return { kind: 'text', start, end, quasis, exprs };
  };
  const flushRun = () => {
    if (!run) return;
    const parts = run.parts;
    run = null;
    if (!parts.some((p) => !('expr' in p) && HAN.test(p.text))) return;
    if (parts.every((p) => !('expr' in p) || simple(p.expr))) {
      const seg = textSeg(parts);
      if (seg) out.push(seg);
      return;
    }
    // split around the non-simple children: each piece of static text (with its simple neighbours) on its own
    let piece = [];
    const flushPiece = () => {
      if (piece.some((p) => !('expr' in p) && HAN.test(p.text))) {
        // drop simple exprs at the edges of a piece only if they are not adjacent to text? keep them: they are values
        const seg = textSeg(piece);
        if (seg) out.push(seg);
      }
      piece = [];
    };
    for (const p of parts) {
      if ('expr' in p && !simple(p.expr)) { flushPiece(); continue; }
      piece.push(p);
    }
    flushPiece();
  };
  for (let qi = 0; qi < qs.length; qi++) {
    const q = qs[qi];
    const text = q.value.raw;
    const base = q.start;
    let i = 0;
    while (i < text.length) {
      if (state === 'TEXT') {
        const lt = text.indexOf('<', i);
        const stop = lt < 0 ? text.length : lt;
        if (stop > i) {
          if (!run) run = { parts: [] };
          run.parts.push({ text: text.slice(i, stop), from: base + i, to: base + stop });
        }
        if (lt < 0) break;
        flushRun();
        if (text.startsWith('<!--', lt)) { state = 'COMMENT'; i = lt + 4; continue; }
        state = 'TAG';
        i = lt + 1;
        continue;
      }
      if (state === 'COMMENT') {
        const e = text.indexOf('-->', i);
        if (e < 0) break;
        state = 'TEXT';
        i = e + 3;
        continue;
      }
      if (state === 'TAG') {
        const c = text[i];
        if (c === '>') { state = 'TEXT'; i++; continue; }
        if (c === '"' || c === "'") {
          const nm = text.slice(0, i).match(/([A-Za-z_:][-\w:.]*)\s*=\s*$/);
          attr = { name: nm ? nm[1] : null, start: base + i, parts: [] };
          quoteCh = c;
          state = 'ATTRV';
          i++;
          continue;
        }
        i++;
        continue;
      }
      // ATTRV
      const e = text.indexOf(quoteCh, i);
      if (e < 0) { attr.parts.push({ text: text.slice(i) }); break; }
      attr.parts.push({ text: text.slice(i, e) });
      const quasis = [];
      const exprs = [];
      let cur = '';
      for (const p of attr.parts) { if ('expr' in p) { quasis.push(cur); cur = ''; exprs.push(p.expr); } else cur += p.text; }
      quasis.push(cur);
      if (attr.name && quasis.some((x) => HAN.test(x))) out.push({ kind: 'attr', attr: attr.name, start: attr.start, end: base + e + 1, quasis, exprs });
      attr = null;
      state = 'TAG';
      i = e + 1;
    }
    if (qi < tpl.expressions.length) {
      const ex = tpl.expressions[qi];
      // the `${…}` spans from the end of this static part to the start of the next one
      if (state === 'TEXT') {
        if (!run) run = { parts: [] };
        run.parts.push({ expr: ex, from: q.end, to: qs[qi + 1].start });
      } else if (state === 'ATTRV') {
        attr.parts.push({ expr: ex });
      }
    }
  }
  flushRun();
  return out;
}

// ===== scanning a file ===============================================================================================

/**
 * Scan a source file.
 * @param {string} src
 * @param {string} file label
 * @returns {Promise<{ msgids: { msgid: string, line: number }[], literals: any[] }>}
 *   literals: { kind: 'str'|'tpl'|'text'|'attr', start, end, line, msgid, params, module: boolean, reason: string|null }
 */
export async function scanSource(src, file = '<src>') {
  const { program: ast, errors } = parseSync(file, src, { lang: 'js', sourceType: 'module' });
  if (errors.length) throw new Error(`${file}: cannot parse (${errors.map((e) => e.message).join('; ')})`);
  const msgids = [];
  const literals = [];
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  // shared/i18n.js functions imported under another name (`import { t as tr }` where `t` is a local variable)
  const aliases = new Map();
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration' || !/shared\/i18n\.js$/.test(String(n.source.value))) continue;
    for (const sp of n.specifiers) if (sp.type === 'ImportSpecifier' && sp.imported.name !== sp.local.name) aliases.set(sp.local.name, sp.imported.name);
  }
  const fnName = (callee) => (callee.type === 'Identifier' ? aliases.get(callee.name) ?? callee.name : null);
  // a line marked `i18n-ignore` (in a comment) holds no UI text (font samples, data keys …)
  const ignored = new Set(src.split('\n').map((l, i) => (/i18n-ignore/.test(l) ? i + 1 : 0)).filter(Boolean));
  // a file marked `i18n-ignore-file` (developer reports, bilingual error pages) holds no UI text to translate
  const fileIgnored = /\/\/[^\n]*i18n-ignore-file/.test(src);
  walk(ast, (node, ancestors) => {
    if (node.type === 'CallExpression' && fnName(node.callee) === 'tc') {
      const [c, a] = node.arguments;
      if (c?.type === 'Literal' && a?.type === 'Literal' && typeof a.value === 'string') msgids.push({ msgid: `${c.value}::${a.value}`, line: lineOf(a.start), via: 'tc' });
    }
    if (node.type === 'CallExpression' && MSGID_CALLS.has(fnName(node.callee))) {
      const a = node.arguments[0];
      const via = fnName(node.callee);
      if (a && a.type === 'Literal' && typeof a.value === 'string') msgids.push({ msgid: a.value, line: lineOf(a.start), via });
      else if (a && a.type === 'TemplateLiteral' && !a.expressions.length) msgids.push({ msgid: a.quasis[0].value.cooked, line: lineOf(a.start), via });
    }
    if (node.type === 'TaggedTemplateExpression' && node.tag.type === 'Identifier' && node.tag.name === 'html') {
      for (const seg of htmlSegments(node.quasi)) {
        const { msgid, params } = templateMsgid(seg.quasis, seg.exprs.map((e) => src.slice(e.start, e.end)));
        const line = lineOf(seg.start);
        literals.push({ kind: seg.kind, attr: seg.attr, start: seg.start, end: seg.end, line, msgid, params, exprs: seg.exprs.map((e) => [e.start, e.end]), module: !inFunction(ancestors), reason: fileIgnored || ignored.has(line) ? 'ignored' : null });
      }
      // expressions inside are walked normally (nested html``, strings in ${…})
      return true;
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && HAN.test(node.value)) {
      const parent = ancestors[ancestors.length - 1];
      if (parent && parent.type === 'TemplateLiteral') return true;
      // an argument of m.toast / ctx.toast / tickerText, directly or as a branch of `a ? '…' : '…'` / `x || '…'`
      let arg = node;
      let k = ancestors.length - 1;
      while (k >= 0 && ((ancestors[k].type === 'ConditionalExpression' && ancestors[k].test !== arg) || ancestors[k].type === 'LogicalExpression')) { arg = ancestors[k]; k--; }
      const call = ancestors[k];
      if (call && call.type === 'CallExpression' && call.callee.type === 'MemberExpression' && SERVER_TEXT_CALLS.has(calleeName(call)) && call.arguments.includes(arg)) {
        msgids.push({ msgid: node.value, line: lineOf(node.start), via: 'server' });
        return true;
      }
      const line = lineOf(node.start);
      const reason = fileIgnored || ignored.has(line) ? 'ignored' : skipReason(node, ancestors, aliases);
      literals.push({ kind: 'str', start: node.start, end: node.end, line, msgid: node.value, params: [], module: !inFunction(ancestors), reason });
      return true;
    }
    if (node.type === 'TemplateLiteral') {
      const parent = ancestors[ancestors.length - 1];
      if (parent && parent.type === 'TaggedTemplateExpression') return true;
      const cooked = node.quasis.map((q) => q.value.cooked ?? q.value.raw);
      if (!cooked.some((s) => HAN.test(s))) return true;
      const reason = fileIgnored || ignored.has(lineOf(node.start)) ? 'ignored' : skipReason(node, ancestors, aliases);
      const { msgid, params } = templateMsgid(cooked, node.expressions.map((e) => src.slice(e.start, e.end)));
      literals.push({ kind: 'tpl', start: node.start, end: node.end, line: lineOf(node.start), msgid, params, exprs: node.expressions.map((e) => [e.start, e.end]), module: !inFunction(ancestors), reason });
      return true;
    }
    return true;
  });
  return { msgids, literals };
}

/** String values of `const NAME = { … }` / `Object.freeze({ … })` object tables (MSGID_TABLES). */
async function tableMsgids(src, names) {
  const { program: ast, errors } = parseSync('msgids.js', src, { sourceType: 'module' });
  if (errors.length) throw new Error(`Cannot parse message table: ${errors.map((e) => e.message).join('; ')}`);
  const out = [];
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || node.id.type !== 'Identifier' || !names.includes(node.id.name)) return true;
    walk(node.init, (n) => {
      if (n.type === 'Property' && n.value.type === 'Literal' && typeof n.value.value === 'string' && HAN.test(n.value.value)) out.push(n.value.value);
      return true;
    });
    return false;
  });
  return out;
}

/**
 * JS files under the paths. server/sim is skipped unless `sim` (its strings are game logic and data; only the messages
 * it sends through ctx.toast matter, and `check` reads those).
 */
function listFiles(paths, { sim = false } = {}) {
  const out = [];
  const visit = (abs) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        const rel = path.relative(ROOT, path.join(abs, name)).split(path.sep).join('/');
        if (rel === 'server/sim' && !sim) continue;
        visit(path.join(abs, name));
      }
    } else if (/\.(m?js)$/.test(abs)) out.push(abs);
  };
  for (const p of paths) visit(path.resolve(ROOT, p));
  return out;
}

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// ===== codemod =======================================================================================================

/** Relative import path from a file to shared/i18n.js. */
function importPath(absFile) {
  let r = path.relative(path.dirname(absFile), path.join(ROOT, 'shared', 'i18n.js')).split(path.sep).join('/');
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
}

/**
 * Rewrite a source: wrap its Chinese literals. Returns the new source and what was done.
 * @param {string} src
 * @param {string} absFile
 */
export async function codemodSource(src, absFile) {
  const { literals } = await scanSource(src, rel(absFile));
  const manual = [];
  const skipped = [];
  let needT = false;
  let needN = false;
  /** literal → { start, end, make(paramSrc) } (the text is built once nested edits are known) */
  const plans = [];
  for (const l of literals) {
    if (l.reason) { skipped.push(l); continue; }
    if (l.kind === 'text' || l.kind === 'attr') {
      plans.push({ l, start: l.start, end: l.end, make: (p) => `\${t(${quote(l.msgid)}${p})}` });
      needT = true;
      if (l.module) manual.push(l);
      continue;
    }
    if (l.module) {
      if (l.kind === 'str') { plans.push({ l, start: l.start, end: l.end, make: () => `N_(${src.slice(l.start, l.end)})` }); needN = true; }
      manual.push(l);
      continue;
    }
    plans.push({ l, start: l.start, end: l.end, make: (p) => `t(${quote(l.msgid)}${p})` });
    needT = true;
  }
  // a plan inside another one (a string in a template's ${…}) is applied to that template's param source instead
  const inner = (outer, x) => x !== outer && x.start >= outer.start && x.end <= outer.end;
  const top = plans.filter((p) => !plans.some((o) => inner(o, p)));
  const rewrite = (from, to, nested) => {
    let text = src.slice(from, to);
    for (const n of nested.filter((x) => x.start >= from && x.end <= to).sort((a, b) => b.start - a.start)) {
      text = text.slice(0, n.start - from) + build(n) + text.slice(n.end - from);
    }
    return text;
  };
  const build = (plan) => {
    const nested = plans.filter((x) => inner(plan, x) && !plans.some((o) => o !== plan && inner(plan, o) && inner(o, x)));
    const { params = [], exprs = [] } = plan.l;
    // params come from the expressions in order; the same expression source maps to one param
    const srcOf = new Map();
    exprs.forEach(([a, b]) => { const orig = src.slice(a, b); if (!srcOf.has(orig)) srcOf.set(orig, rewrite(a, b, nested)); });
    const ps = params.map(({ name, src: orig }) => ({ name, src: srcOf.get(orig) ?? orig }));
    return plan.make(paramsSource(ps));
  };
  const edits = top.map((p) => ({ start: p.start, end: p.end, text: build(p) })).sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const names = [needT && 't', needN && 'N_'].filter(Boolean);
  if (names.length) {
    const imp = importPath(absFile);
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${imp.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"];?`);
    const m = out.match(re);
    if (m) {
      const have = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const want = [...new Set([...have, ...names])];
      out = out.replace(re, `import { ${want.join(', ')} } from '${imp}';`);
    } else {
      // after the last import statement
      const imports = [...out.matchAll(/^import[^;]*;[^\n]*\n/gm)];
      const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
      out = `${out.slice(0, at)}import { ${names.join(', ')} } from '${imp}';\n${out.slice(at)}`;
    }
  }
  return { src: out, edits: plans.length, manual, skipped };
}

// ===== commands ======================================================================================================

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (['from', 'lang'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else flags._.push(a);
  }
  return flags;
}

const catalogPath = (lang) => path.join(ROOT, 'public', 'i18n', `${lang}.json`);
function readCatalog(lang) {
  const p = catalogPath(lang);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}
function writeCatalog(lang, cat) {
  const meta = Object.entries(cat).filter(([k]) => k.startsWith('_'));
  const rest = Object.entries(cat).filter(([k]) => !k.startsWith('_'));
  writeFileSync(catalogPath(lang), `${JSON.stringify(Object.fromEntries([...meta, ...rest]), null, 2)}\n`);
}

async function usedMsgids(files) {
  const used = new Map(); // msgid → first "file:line"
  for (const f of files) {
    const { msgids } = await scanSource(readFileSync(f, 'utf8'), rel(f));
    // server code never translates: its t() / N_() are other helpers (blackboard lookups in the sim); only msg() and
    // the texts it sends count there
    const server = rel(f).startsWith('server/');
    for (const m of msgids) {
      if (server && m.via !== 'msg' && m.via !== 'server') continue;
      if (!used.has(m.msgid)) used.set(m.msgid, `${rel(f)}:${m.line}`);
    }
  }
  for (const [file, names] of MSGID_TABLES) {
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) continue;
    for (const m of await tableMsgids(readFileSync(abs, 'utf8'), names)) if (!used.has(m)) used.set(m, file);
  }
  return used;
}

async function cmdExtract(flags) {
  const files = listFiles(flags._.length ? flags._ : DEFAULT_ROOTS);
  const rows = [];
  let tCount = 0, litCount = 0;
  for (const f of files) {
    const { msgids, literals } = await scanSource(readFileSync(f, 'utf8'), rel(f));
    const open = literals.filter((l) => !l.reason || l.reason === 'compare' || l.reason === 'string-method' || l.reason === 'key');
    const shown = literals.filter((l) => !l.reason);
    tCount += msgids.length;
    litCount += shown.length;
    if (msgids.length || shown.length) rows.push({ file: rel(f), t: msgids.length, untranslated: shown.length, literals: shown, other: open.length - shown.length });
  }
  if (flags.json) { console.log(JSON.stringify(rows.map(({ literals, ...r }) => ({ ...r, literals: literals.map((l) => ({ line: l.line, kind: l.kind, msgid: l.msgid, module: l.module })) })), null, 1)); return; }
  for (const r of rows) {
    console.log(`${r.file.padEnd(48)} t() ${String(r.t).padStart(4)}   untranslated ${String(r.untranslated).padStart(4)}`);
    if (flags.list) for (const l of r.literals) console.log(`    ${String(l.line).padStart(5)} ${l.kind.padEnd(4)}${l.module ? ' (module)' : ''} ${l.msgid.replace(/\n/g, '⏎').slice(0, 90)}`);
  }
  const cat = readCatalog(flags.lang || 'en');
  const ready = rows.reduce((n, r) => n + r.literals.filter((l) => typeof cat[l.msgid] === 'string' && cat[l.msgid]).length, 0);
  console.log(`total: ${tCount} msgids in t() / tc() / tParts() / N_() / msg(); ${litCount} Chinese literals not wrapped, in ${rows.filter((r) => r.untranslated).length} files`
    + ` (${ready} of them already translated in public/i18n/${flags.lang || 'en'}.json, ready for the codemod)`);
}

async function cmdCheck(flags) {
  const lang = flags.lang || 'en';
  const files = listFiles(flags._.length ? flags._ : DEFAULT_ROOTS, { sim: true });
  const used = await usedMsgids(files);
  const cat = readCatalog(lang);
  const missing = [...used].filter(([m]) => !(typeof cat[m] === 'string' && cat[m]));
  for (const [m, where] of missing) console.log(`missing  ${where.padEnd(40)} ${m.replace(/\n/g, '⏎')}`);
  if (flags.stale) {
    for (const k of Object.keys(cat)) if (!k.startsWith('_') && !used.has(k)) console.log(`unused   ${k.replace(/\n/g, '⏎')}`);
  }
  console.log(`${used.size} msgids used, ${used.size - missing.length} translated in public/i18n/${lang}.json, ${missing.length} missing`);
  if (flags.strict && missing.length) process.exitCode = 1;
}

async function cmdCodemod(flags) {
  if (!flags._.length) throw new Error('codemod needs file paths');
  for (const p of flags._) {
    const abs = path.resolve(ROOT, p);
    const src = readFileSync(abs, 'utf8');
    const res = await codemodSource(src, abs);
    console.log(`${rel(abs)}: ${res.edits} literals wrapped, ${res.skipped.length} left (compare / key / string method / console / error)`);
    for (const l of res.manual) console.log(`    manual  line ${l.line}: module-level ${l.kind} — call t() where it is shown: ${l.msgid.slice(0, 70)}`);
    if (flags.write && res.src !== src) writeFileSync(abs, res.src);
  }
}

async function cmdSeed(flags) {
  if (!flags.from) throw new Error('seed needs --from <file.json>');
  const lang = flags.lang || 'en';
  const from = JSON.parse(readFileSync(path.resolve(ROOT, flags.from), 'utf8'));
  const files = listFiles(flags._.length ? flags._ : DEFAULT_ROOTS);
  const want = new Map(await usedMsgids(files));
  if (flags.all) {
    for (const f of files) {
      const { literals } = await scanSource(readFileSync(f, 'utf8'), rel(f));
      for (const l of literals) if ((!l.reason || l.reason === 'tagged') && !want.has(l.msgid)) want.set(l.msgid, `${rel(f)}:${l.line}`);
    }
  }
  const cat = readCatalog(lang);
  let added = 0;
  for (const [m] of want) {
    if (typeof cat[m] === 'string' && cat[m]) continue;
    const tr = from[m];
    if (typeof tr === 'string' && tr && !HAN.test(tr)) { cat[m] = tr; added++; }
  }
  console.log(`${want.size} msgids considered, ${added} added to public/i18n/${lang}.json${flags.write ? '' : ' (dry run: --write saves)'}`);
  if (flags.write) writeCatalog(lang, cat);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const cmds = { extract: cmdExtract, check: cmdCheck, codemod: cmdCodemod, seed: cmdSeed };
  if (!cmds[cmd]) {
    console.log('usage: node tools/i18n.mjs extract|check|codemod|seed … (see the header of tools/i18n.mjs)');
    process.exitCode = cmd ? 2 : 0;
    return;
  }
  await cmds[cmd](flags);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`i18n: ${e.message}`); process.exitCode = 2; });
}

export { CJK, MSGID_TABLES };
