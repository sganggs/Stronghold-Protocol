// Import boundaries for the sim and the match layer.
//
// server/sim is served to the browser, so it must not import the match, the lobby, the HTTP entry,
// the net layer, public/, or any Node builtin. server/match must not import public/ or that net layer.
// server/data.js is allowed (the Node loader reaches it on purpose).
//
// Default exit code is 0 even when violations are listed. --strict exits 1 when any are listed.
// Usage: node tools/check-imports.mjs [--strict] [--root <dir>]

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSync, Visitor } from 'oxc-parser';

const HTTP_SPECS = new Set([
  'http', 'https', 'http2', 'net', 'tls', 'dgram', 'ws',
  'node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram',
]);

const builtins = new Set(builtinModules);

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

/**
 * @param {string} src raw source
 * @returns {{ spec: string, line: number }[]}
 */
export function findSpecifiers(src) {
  const { program, errors } = parseSync('imports.js', src, { sourceType: 'unambiguous' });
  if (errors.length) throw new Error(`Cannot parse imports: ${errors.map((e) => e.message).join('; ')}`);
  /** @type {{ spec: string, line: number }[]} */
  const found = [];
  const add = (node) => {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
      found.push({ spec: node.value, line: lineOf(src, node.start) });
    } else if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
      found.push({ spec: node.quasis[0].value.cooked, line: lineOf(src, node.start) });
    }
  };
  new Visitor({
    ImportDeclaration: (node) => add(node.source),
    ExportNamedDeclaration: (node) => add(node.source),
    ExportAllDeclaration: (node) => add(node.source),
    ImportExpression: (node) => add(node.source),
    CallExpression: (node) => {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') add(node.arguments[0]);
    },
  }).visit(program);
  return found;
}

function isBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return builtins.has(spec);
}

function isHttp(spec, resolved) {
  if (HTTP_SPECS.has(spec)) return true;
  if (spec === 'ws' || spec.startsWith('ws/')) return true;
  if (resolved === 'server/net.js' || resolved === 'server/index.js') return true;
  return false;
}

/**
 * @param {string} spec
 * @param {string} fromFile posix path relative to the root
 * @param {'sim'|'match'} area
 * @returns {{ code: string, resolved: string } | { note: true, resolved: string } | null}
 */
export function classify(spec, fromFile, area) {
  const fromDir = path.posix.dirname(fromFile);
  let resolved = spec;
  if (spec.startsWith('.')) {
    resolved = path.posix.normalize(path.posix.join(fromDir, spec));
  }
  const escaped = resolved.startsWith('..') || path.posix.isAbsolute(spec);
  if (area === 'sim') {
    if (resolved === 'server/match' || resolved.startsWith('server/match/')) return { code: 'sim-match', resolved };
    if (resolved === 'server/lobby.js' || resolved.startsWith('server/lobby/')) return { code: 'sim-lobby', resolved };
    if (resolved === 'server/index.js') return { code: 'sim-entry', resolved };
    if (isHttp(spec, resolved)) return { code: 'sim-http', resolved };
    if (resolved === 'public' || resolved.startsWith('public/')) return { code: 'sim-client', resolved };
    // This Node-only loader is never served. Keep the exception limited to its data-loading builtins.
    if (fromFile === 'server/sim/nodeData.js' && ['node:fs', 'node:path', 'node:url'].includes(spec)) return { note: true, resolved };
    if (escaped || isBuiltin(spec)) return { code: 'sim-node', resolved };
    if (resolved === 'server/data.js') return { note: true, resolved };
    return null;
  }
  if (resolved === 'public' || resolved.startsWith('public/')) return { code: 'match-client', resolved };
  if (isHttp(spec, resolved)) return { code: 'match-http', resolved };
  return null;
}

function walkJs(dir, rel, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const abs = path.join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walkJs(abs, child, out);
    else if (/\.(?:js|mjs|cjs)$/.test(name)) out.push(child.split(path.sep).join('/'));
  }
}

/**
 * @param {string} root absolute repository root
 * @returns {{ violations: { file: string, line: number, spec: string, code: string, resolved: string }[], notes: { file: string, line: number, spec: string, resolved: string }[] }}
 */
export function scan(root) {
  const files = [];
  walkJs(path.join(root, 'server', 'sim'), 'server/sim', files);
  walkJs(path.join(root, 'server', 'match'), 'server/match', files);
  /** @type {{ file: string, line: number, spec: string, code: string, resolved: string }[]} */
  const violations = [];
  /** @type {{ file: string, line: number, spec: string, resolved: string }[]} */
  const notes = [];
  for (const file of files) {
    const area = file.startsWith('server/sim/') ? 'sim' : 'match';
    let src;
    try { src = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const hit of findSpecifiers(src)) {
      const result = classify(hit.spec, file, area);
      if (!result) continue;
      if (result.note) notes.push({ file, line: hit.line, spec: hit.spec, resolved: result.resolved });
      else violations.push({ file, line: hit.line, spec: hit.spec, code: result.code, resolved: result.resolved });
    }
  }
  const byPos = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.spec.localeCompare(b.spec);
  violations.sort(byPos);
  notes.sort(byPos);
  return { violations, notes };
}

export function formatReport({ violations, notes }) {
  const lines = [];
  if (violations.length === 0) lines.push('no import-boundary violations');
  else {
    lines.push(`${violations.length} import-boundary violation(s):`);
    for (const v of violations) lines.push(`${v.file}:${v.line}: ${v.spec} [${v.code}]`);
  }
  if (notes.length) {
    lines.push(`${notes.length} allowed note(s):`);
    for (const n of notes) lines.push(`note ${n.file}:${n.line}: ${n.spec} -> ${n.resolved}`);
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  let strict = false;
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') strict = true;
    else if (a === '--root') {
      const dir = argv[++i];
      if (!dir || dir.startsWith('--')) {
        console.error('check-imports: --root needs a directory');
        return 1;
      }
      root = path.resolve(dir);
    } else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/check-imports.mjs [--strict] [--root <dir>]');
      return 0;
    } else {
      console.error(`check-imports: unknown argument ${a}`);
      return 1;
    }
  }
  const report = scan(root);
  process.stdout.write(formatReport(report));
  if (strict && report.violations.length) return 1;
  return 0;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invoked) process.exit(main(process.argv.slice(2)));
