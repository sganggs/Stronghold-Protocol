// tools/i18n/extract.mjs — collect every Chinese display string of data/*.json into translation chunks.
//
// Output: tools/i18n/chunks/<phase>-NN.jsonl, one `{"id":N,"ctx":"…","zh":"…"}` per line, and tools/i18n/source.json
// (the full id → zh table plus derived entries). Translators answer with tools/i18n/out/<same name> lines
// `{"id":N,"en":"…"}`; tools/i18n/build.mjs merges them into public/i18n/en.json.
//   * a rich-text string (`<@ba.vup>…</>`) and its markup-free twin: only the rich one is translated, the plain one is
//     derived from it (richTextPlain) at build time;
//   * operator / summon names with an English `appellation` are prefilled (no chunk);
//   * the server's multi-round bounty rewrite (server/match/choices.js bountyText) is added as extra source strings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { richTextPlain } from '../../public/js/ui/richText.js';
import { bountyText } from '../../server/match/choices.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'tools', 'i18n');
const CJK = /[㐀-鿿豈-﫿]/;
const SKIP = new Set(['assets.json', 'local-assets.json', 'waves.json']);
const SHORT = 16;

/** zh → { ctx, order } in order of first appearance. */
const seen = new Map();
const add = (s, ctx) => { if (typeof s === 'string' && CJK.test(s) && !seen.has(s)) seen.set(s, { ctx }); };

function walk(o, ctx) {
  if (typeof o === 'string') { add(o, ctx); return; }
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const v of o) walk(v, ctx); return; }
  for (const [k, v] of Object.entries(o)) walk(v, /^[a-z]+(?:[A-Z][a-z]*)*$/.test(k) ? `${ctx.split('.').slice(-2).join('.')}.${k}` : ctx);
}

const files = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => f.endsWith('.json') && !SKIP.has(f)).sort();
const prefill = {};
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const base = f.replace(/\.json$/, '');
  walk(json, base);
  if (base === 'chess' || base === 'tokens') {
    for (const r of Object.values(json)) {
      if (r && typeof r.name === 'string' && CJK.test(r.name) && typeof r.appellation === 'string'
        && r.appellation.trim() && !CJK.test(r.appellation)) prefill[r.name] ??= r.appellation.trim();
    }
  }
  // the server rewrites multi-round bounty texts before sending them (choices.js bountyText): translate those too
  if (base === 'choices' || base === 'effects') {
    const fake = { multiRound: true };
    for (const s of [...seen.keys()]) { const b = bountyText(s, fake); if (b !== s) add(b, `${base}.bounty`); }
  }
}

// rich strings make their plain twins derivable
const plainOfRich = new Set();
for (const s of seen.keys()) if (/<[@$][A-Za-z0-9_.\-]+>/.test(s)) plainOfRich.add(richTextPlain(s));

const source = {};   // id → zh (translatable)
const derived = [];  // plain twins
let id = 0;
const short = [], long = [];
for (const [zh, { ctx }] of seen) {
  if (prefill[zh]) continue;
  if (plainOfRich.has(zh) && !/<[@$]/.test(zh)) { derived.push(zh); continue; }
  const e = { id: ++id, ctx, zh };
  source[id] = zh;
  (zh.length <= SHORT ? short : long).push(e);
}

/** Split entries into chunks of about `budget` Chinese characters. */
function chunks(list, budget) {
  const out = [[]]; let n = 0;
  for (const e of list) {
    if (n + e.zh.length > budget && out[out.length - 1].length) { out.push([]); n = 0; }
    out[out.length - 1].push(e); n += e.zh.length;
  }
  return out;
}
const cdir = path.join(DIR, 'chunks');
fs.rmSync(cdir, { recursive: true, force: true });
fs.mkdirSync(cdir, { recursive: true });
fs.mkdirSync(path.join(DIR, 'out'), { recursive: true });
const write = (name, list) => fs.writeFileSync(path.join(cdir, name), list.map((e) => JSON.stringify(e)).join('\n') + '\n');
const shortChunks = chunks(short, Number(process.env.SHORT_BUDGET) || 6000);
shortChunks.forEach((c, i) => write(`names-${String(i + 1).padStart(2, '0')}.jsonl`, c));
const longChunks = chunks(long, Number(process.env.LONG_BUDGET) || 16000);
longChunks.forEach((c, i) => write(`texts-${String(i + 1).padStart(2, '0')}.jsonl`, c));
fs.writeFileSync(path.join(DIR, 'source.json'), JSON.stringify({ source, prefill, derived }, null, 1));
const sum = (l) => l.reduce((a, e) => a + e.zh.length, 0);
console.log(`strings ${seen.size}: prefilled ${Object.keys(prefill).length}, derived ${derived.length}, `
  + `short ${short.length} (${sum(short)} chars, ${shortChunks.length} chunks), long ${long.length} (${sum(long)} chars, ${longChunks.length} chunks)`);
