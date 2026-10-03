// check-patches.mjs — mirror build-webroot's applyPatches() assertions WITHOUT touching
// files: for every {file, find, replace} verify the anchor exists (or the replace is
// already applied, or the entry is skippable via minApp/maxApp/optional). argv is the
// tree under test — an extracted upstream zip or a built webroot; the patch DEFINITIONS
// always come from the repo shipping this script.
//
//   node tools/apk/check-patches.mjs [upstreamTree]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ownRepo = path.resolve(here, '..', '..');
const patchesDir = path.join(ownRepo, 'tools', 'apk', 'patches');
const repo = path.resolve(process.argv[2] || ownRepo);

const layouts = (rel) => [path.join(repo, rel), path.join(repo, 'public', rel)];

function appVersionOf() {
  for (const base of [repo, path.join(repo, 'public')]) {
    try {
      const t = fs.readFileSync(path.join(base, 'shared', 'constants.js'), 'utf-8');
      const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(t) || /APP_VERSION\s*=\s*"([^"]+)"/.exec(t);
      if (m) return m[1];
    } catch { /* try next layout */ }
  }
  return null;
}

function cmpVer(a, b) {
  if (a == null) return 0;
  const A = String(a).split('.'), B = String(b).split('.');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? '0', y = B[i] ?? '0';
    const nx = Number(x), ny = Number(y);
    const c = (Number.isFinite(nx) && Number.isFinite(ny)) ? Math.sign(nx - ny) : (x < y ? -1 : x > y ? 1 : 0);
    if (c) return c;
  }
  return 0;
}

if (!fs.existsSync(patchesDir)) { console.error(`no patches dir at ${patchesDir}`); process.exit(1); }
const files = fs.readdirSync(patchesDir).filter((n) => n.endsWith('.json')).sort();
if (!files.length) { console.error('no patch files'); process.exit(1); }

const app = appVersionOf();
console.log(`tree app version: ${app ?? 'unknown (conditions treat as matching)'}`);

let ok = 0, skipped = 0, failed = 0;
for (const pf of files) {
  const spec = JSON.parse(fs.readFileSync(path.join(patchesDir, pf), 'utf-8'));
  for (const p of spec.patches || []) {
    const tag = `${pf} → ${p.file}`;
    if (p.minApp && cmpVer(app, p.minApp) < 0) { skipped++; console.log(`skip (app ${app} < minApp ${p.minApp}): ${tag}`); continue; }
    if (p.maxApp && cmpVer(app, p.maxApp) > 0) { skipped++; console.log(`skip (app ${app} > maxApp ${p.maxApp}): ${tag}`); continue; }
    const hit = layouts(p.file).find((t) => fs.existsSync(t));
    if (!hit) { failed++; console.error(`ANCHOR FAIL (${pf}): target missing: ${p.file} (also public/${p.file})`); continue; }
    const text = fs.readFileSync(hit, 'utf-8');
    if (text.includes(p.find)) { ok++; console.log(`ok: ${tag}`); continue; }
    if (p.replace && text.includes(p.replace)) { skipped++; console.log(`already applied: ${tag}`); continue; }
    if (p.shrink) {
      const first = p.find.split('\n').find((l) => l.trim() !== '');
      if (first != null && text.includes(first)) { ok++; console.log(`ok (shrink-first-line): ${tag}`); continue; }
    }
    if (p.optional) { skipped++; console.log(`optional anchor absent: ${tag}`); continue; }
    failed++; console.error(`ANCHOR FAIL (${pf}): ${p.file} lacks ${JSON.stringify(String(p.find).slice(0, 90))}`);
  }
}
console.log(`\nanchors: ${ok} ok, ${skipped} skipped, ${failed} failed (${files.length} patch files; app=${app ?? '?'})`);
process.exit(failed ? 1 : 0);
