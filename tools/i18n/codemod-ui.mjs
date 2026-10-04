// tools/i18n/codemod-ui.mjs [--dry] — one-off: turn the English UI literals of the client (public/js) back into
// their Chinese source texts wrapped in T() / TH() (js/i18n.js), using tools/i18n/ui-pairs.json (recover-ui.mjs).
//
//   'English' / `English ${a}`          → T('中文', a)          (string / template literal)
//   htm text node  English ${a}          → ${T('中文', a)}       (TH when a slot holds markup)
//   htm attribute  label="English"       → label=${T('中文')}
//
// A pair is applied only when the file is unchanged since HEAD, its zh and English slots use the same expressions,
// and its span does not overlap another pair. Object keys are skipped. Everything skipped, plus conversions in a
// comparison / string-method context (=== 'x', .replace('x' …), .includes('x')…), is listed in ui-codemod-report.json
// for review. Adds the `import { T, TH } from '…/i18n.js'` each file needs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const DRY = process.argv.includes('--dry');
const SKIP_FILES = new Set(['public/js/screens/title.js', 'public/js/i18n.js']); // converted by hand
const pairs = JSON.parse(fs.readFileSync(path.join(DIR, 'ui-pairs.json'), 'utf8'));

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
const MARKUP = /html`|<\$\{|\bh\(|Icon\b|<[A-Za-z]/;
const RISKY_BEFORE = /(===|!==|==|!=|\.(?:replace|replaceAll|includes|startsWith|endsWith|indexOf|split|test|match)\s*\(\s*)\s*$/;
const RISKY_AFTER = /^\s*(===|!==|==|!=|\.(?:test|match|includes))/;

const report = { skipped: [], risky: [], files: {} };
for (const [file, list] of Object.entries(pairs)) {
  if (!file.startsWith('public/js/') || SKIP_FILES.has(file)) continue;
  const abs = path.join(ROOT, file);
  const src = fs.readFileSync(abs, 'utf8');
  const head = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (src.replace(/\r\n/g, '\n') !== head.replace(/\r\n/g, '\n')) { report.skipped.push({ file, why: 'changed since HEAD' }); continue; }
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const edits = [];
  let needT = false, needTH = false;
  sorted.forEach((p, k) => {
    const where = { file, line: p.line, zh: p.zh, en: p.en };
    const overlaps = sorted.some((o, j) => j !== k && o.start < p.end && p.start < o.end);
    if (overlaps) { report.skipped.push({ ...where, why: 'nested in / around another pair' }); return; }
    const slots = [...p.zh.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
    const used = new Set([...p.en.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1])));
    if (p.exprs.some((_, i) => !used.has(i)) || slots.some((i) => i >= p.exprs.length)) {
      report.skipped.push({ ...where, why: 'zh and English slots differ' }); return;
    }
    const before = src.slice(Math.max(0, p.start - 40), p.start), after = src.slice(p.end, p.end + 12);
    if ((p.kind === 'str' || p.kind === 'tpl') && /[{,]\s*$/.test(before) && /^\s*:/.test(after)) {
      report.skipped.push({ ...where, why: 'object key' }); return;
    }
    const args = p.exprs.length ? ', ' + p.exprs.join(', ') : '';
    let rep;
    if (p.kind === 'text') {
      const markup = p.exprs.some((e) => MARKUP.test(e));
      rep = `\${${markup ? 'TH' : 'T'}(${q(p.zh)}${args})}`;
      if (markup) needTH = true; else needT = true;
    } else if (p.kind === 'attr') {
      rep = `\${T(${q(p.zh)}${args})}`; needT = true;
    } else {
      rep = `T(${q(p.zh)}${args})`; needT = true;
    }
    if (RISKY_BEFORE.test(before) || RISKY_AFTER.test(after)) report.risky.push({ ...where, context: (before.slice(-30) + '⟦' + src.slice(p.start, p.end).slice(0, 40) + '⟧' + after).replace(/\s+/g, ' ') });
    edits.push([p.start, p.end, rep]);
  });
  if (!edits.length) continue;
  let out = src;
  for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
  // import { T, TH } from the file's relative path to public/js/i18n.js (merged into an existing i18n.js import)
  const names = [needT && 'T', needTH && 'TH'].filter(Boolean);
  let rel = path.relative(path.dirname(abs), path.join(ROOT, 'public', 'js', 'i18n.js')).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  const impRe = new RegExp(`import \\{([^}]*)\\} from '${rel.replace(/[.]/g, '\\.')}';`);
  const m = impRe.exec(out);
  if (m) {
    const have = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...names, ...have])];
    out = out.replace(m[0], `import { ${merged.join(', ')} } from '${rel}';`);
  } else {
    const imports = [...out.matchAll(/^import [^;]*;\s*$/gm)];
    const last = imports[imports.length - 1];
    const line = `import { ${names.join(', ')} } from '${rel}';\n`;
    out = last ? out.slice(0, last.index + last[0].length).replace(/\s*$/, '\n') + line + out.slice(last.index + last[0].length).replace(/^\n/, '') : line + out;
  }
  report.files[file] = edits.length;
  if (!DRY) fs.writeFileSync(abs, out);
}
fs.writeFileSync(path.join(DIR, 'ui-codemod-report.json'), JSON.stringify(report, null, 1) + '\n');
const n = Object.values(report.files).reduce((a, b) => a + b, 0);
console.log(`${DRY ? '[dry] ' : ''}${n} conversions in ${Object.keys(report.files).length} files · ${report.skipped.length} skipped · ${report.risky.length} risky (see ui-codemod-report.json)`);
