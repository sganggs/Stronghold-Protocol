// tools/i18n/recover-ui.mjs [--base master] — recover the Chinese UI texts the en-translation branch replaced with
// English literals in place, so the code can go back to Chinese source texts wrapped in t() (js/i18n.js).
//
// For every client / shared / server file changed since <base>, both versions are lexed into display-text chunks
// (jslex.mjs); an LCS over the chunk texts anchors the unchanged ones, and inside each changed run a Chinese chunk
// of <base> is paired with the English chunk at the same position of HEAD (runs of equal length only).
//
// Writes (tools/i18n/):
//   ui-pairs.json     { file: [{ zh, en, exprs, line, kind, start, end }] } — the English chunk at HEAD (source span)
//                     and the zh text / expressions (zh order) replacing it; drives codemod-ui.mjs
//   ui-en.seed.json   { zh: en }                          — UI dictionary seed (template slots as {0}, {1}…)
//   ui-unpaired.json  { file: { zh: [...], en: [...] } }  — leftovers for review
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexChunks, CJK, unescapeJs } from './jslex.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'master';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

const files = git('diff', '--name-only', `${base}...HEAD`, '--', 'public/js', 'shared', 'server')
  .trim().split('\n').filter((f) => f.endsWith('.js'));

/** Chunk text with ${n} markers → dictionary form {n} (escapes decoded), slots renumbered to the zh expression order. */
function toDictForm(chunk, zhExprs) {
  let ok = true;
  const raw = chunk.kind === 'str' || chunk.kind === 'tpl' ? unescapeJs(chunk.text) : chunk.text;
  const text = raw.replace(/\$\{(\d+)\}/g, (_, n) => {
    const idx = zhExprs.indexOf(chunk.exprs[Number(n)]);
    if (idx < 0) ok = false;
    return `{${idx}}`;
  });
  return ok ? text : null;
}

function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

const pairsOut = {}, seed = {}, unpaired = {}, conflicts = [];
let nPairs = 0;
for (const f of files) {
  let oldSrc;
  try { oldSrc = git('show', `${base}:${f}`); } catch { continue; } // new on this branch
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  const newSrc = git('show', `HEAD:${f}`);
  const A = lexChunks(oldSrc), B = lexChunks(newSrc);
  const anchors = lcs(A.map((c) => c.kind + c.text), B.map((c) => c.kind + c.text));
  anchors.push([A.length, B.length]);
  let pa = 0, pb = 0;
  const filePairs = [], left = { zh: [], en: [] };
  for (const [ai, bi] of anchors) {
    const runA = A.slice(pa, ai), runB = B.slice(pb, bi);
    const zhA = runA.filter((c) => CJK.test(c.text));
    if (zhA.length) {
      if (runA.length === runB.length) {
        runA.forEach((za, k) => {
          const en = runB[k];
          if (!CJK.test(za.text)) return;
          if (CJK.test(en.text)) { left.zh.push(za.text); return; }
          const zh = toDictForm(za, za.exprs), enText = toDictForm(en, za.exprs);
          if (zh == null || enText == null) { left.zh.push(za.text); left.en.push(en.text); return; }
          filePairs.push({ zh, en: enText, exprs: za.exprs, line: en.line, kind: en.kind, start: en.start, end: en.end });
          if (seed[zh] != null && seed[zh] !== enText) conflicts.push({ file: f, zh, a: seed[zh], b: enText });
          else seed[zh] = enText;
        });
      } else {
        left.zh.push(...zhA.map((c) => c.text));
        left.en.push(...runB.filter((c) => /[A-Za-z]{2}/.test(c.text)).map((c) => c.text));
      }
    }
    pa = ai + 1; pb = bi + 1;
  }
  if (filePairs.length) { pairsOut[f] = filePairs; nPairs += filePairs.length; }
  if (left.zh.length) unpaired[f] = left;
}

const write = (name, v) => fs.writeFileSync(path.join(DIR, name), JSON.stringify(v, null, 1) + '\n');
write('ui-pairs.json', pairsOut);
write('ui-en.seed.json', seed);
write('ui-unpaired.json', { conflicts, files: unpaired });
const nLeft = Object.values(unpaired).reduce((s, v) => s + v.zh.length, 0);
console.log(`${files.length} files · ${nPairs} pairs (${Object.keys(seed).length} distinct) · ${nLeft} unpaired zh · ${conflicts.length} conflicts`);
