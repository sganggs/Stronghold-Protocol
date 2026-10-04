// tools/i18n/check.mjs <chunk-name> — validate translations in tools/i18n/out/<chunk-name>*.jsonl against the chunk.
// Checks: every id answered, no CJK left, rich-text tags / {placeholders} / newlines preserved. Exit 1 on problems.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const name = (process.argv[2] || '').replace(/\.jsonl$/, '');
if (!name) { console.error('usage: node tools/i18n/check.mjs <chunk-name e.g. texts-03>'); process.exit(2); }
const want = fs.readFileSync(path.join(DIR, 'chunks', `${name}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const got = new Map();
const bad = [];
for (const f of fs.readdirSync(path.join(DIR, 'out')).filter((f) => f.startsWith(name) && f.endsWith('.jsonl')).sort()) {
  fs.readFileSync(path.join(DIR, 'out', f), 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { const o = JSON.parse(l); got.set(o.id, o.en); } catch (e) { bad.push(`${f}:${i + 1} invalid JSON: ${e.message}`); }
  });
}
const CJK = /[㐀-鿿豈-﫿]/;
/** Phrases the client still pattern-matches on translated text (shared/loadoutRecord.js attackRangeGrid). */
export const REQUIRED = [['被动效果：攻击范围扩大', 'Passive: Attack Range expanded'], ['攻击范围扩大', 'Attack Range expanded'], ['集成战略', 'Integrated Strategies']];
const tags = (s) => (s.match(/<[@$][A-Za-z0-9_.\-]+>|<\/>/g) || []).sort().join(' ');
const ph = (s) => (s.match(/\{\d+(?::[^}]*)?\}/g) || []).sort().join(' ');
const nl = (s) => (s.match(/\n|\\n/g) || []).length;
for (const e of want) {
  const en = got.get(e.id);
  if (typeof en !== 'string' || !en.trim()) { bad.push(`#${e.id} missing`); continue; }
  if (CJK.test(en)) bad.push(`#${e.id} still contains Chinese: ${en.slice(0, 80)}`);
  if (tags(en) !== tags(e.zh)) bad.push(`#${e.id} rich-text tags differ: zh[${tags(e.zh)}] en[${tags(en)}]`);
  if (ph(en) !== ph(e.zh)) bad.push(`#${e.id} placeholders differ: zh[${ph(e.zh)}] en[${ph(en)}]`);
  if (nl(en) !== nl(e.zh)) bad.push(`#${e.id} line-break count differs (${nl(e.zh)} vs ${nl(en)})`);
  for (const [zh, phrase] of REQUIRED) if (e.zh.includes(zh) && !en.includes(phrase)) bad.push(`#${e.id} must contain the exact phrase "${phrase}"`);
}
const extra = [...got.keys()].filter((id) => !want.some((e) => e.id === id));
if (extra.length) bad.push(`ids not in this chunk: ${extra.slice(0, 20).join(', ')}`);
console.log(`${name}: ${want.length} wanted, ${got.size} answered, ${bad.length} problems`);
for (const b of bad.slice(0, 60)) console.log('  ' + b);
process.exit(bad.length ? 1 : 0);
