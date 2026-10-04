// tools/i18n/restore-zh.mjs <file>… [--dry] — one-off: put the Chinese source literals (tools/i18n/ui-pairs.json) back
// into files whose English literals are not displayed through T() at the site: shared tables translated where shown
// (shared/constants.js) and server texts the client formats (server/**). Plain '…' strings and `…` templates whose
// slots match only; the file must be unchanged since HEAD. Reports what it skipped.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const DRY = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const pairs = JSON.parse(fs.readFileSync(path.join(DIR, 'ui-pairs.json'), 'utf8'));

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const tick = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

for (const file of files) {
  const list = pairs[file];
  if (!list) { console.log(`${file}: no pairs`); continue; }
  const abs = path.join(ROOT, file);
  let src = fs.readFileSync(abs, 'utf8');
  const head = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (src.replace(/\r\n/g, '\n') !== head.replace(/\r\n/g, '\n')) { console.log(`${file}: changed since HEAD, skipped`); continue; }
  let n = 0;
  const skipped = [];
  for (const p of [...list].sort((a, b) => b.start - a.start)) {
    if (p.kind === 'str' && !p.exprs.length) { src = src.slice(0, p.start) + quote(p.zh) + src.slice(p.end); n++; continue; }
    if (p.kind === 'tpl') {
      // zh slots {n} back to ${expr} (zh expression order)
      const body = tick(p.zh).replace(/\{(\d)\}/g, (_, i) => '${' + p.exprs[Number(i)] + '}');
      src = src.slice(0, p.start) + '`' + body + '`' + src.slice(p.end); n++; continue;
    }
    skipped.push(`${p.line}: [${p.kind}] ${p.en.slice(0, 60)}`);
  }
  if (!DRY) fs.writeFileSync(abs, src);
  console.log(`${DRY ? '[dry] ' : ''}${file}: ${n} restored${skipped.length ? `, skipped ${skipped.length}:\n  ` + skipped.join('\n  ') : ''}`);
}
