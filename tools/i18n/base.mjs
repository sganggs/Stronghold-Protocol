// tools/i18n/base.mjs — the agents' dictionary before the SPA Database overrides: the translations
// (tools/i18n/out/*.jsonl), the prefilled operator names (source.json prefill) and the markup-free twin of every
// rich-text string (richTextPlain of both sides). Shared by build.mjs and apply-spa.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { richTextPlain } from '../../public/js/ui/richText.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DIR = path.join(ROOT, 'tools', 'i18n');
const CJK = /[㐀-鿿豈-﫿]/;

/**
 * The agents' translation folder (*.jsonl): $I18N_OUT, else tools/i18n/out, else the archived copy next to the repo
 * (../translation agent data/out, where commit 0dfd156 moved the finished chunks/ and out/), else null. Read only.
 */
export function outDir() {
  const candidates = [process.env.I18N_OUT, path.join(DIR, 'out'), path.join(ROOT, '..', 'translation agent data', 'out')].filter(Boolean);
  return candidates.find((d) => fs.existsSync(d)) ?? null;
}

/**
 * The agents' dictionary. Without the out/ folder it is the committed snapshot tools/i18n/fallback-en.json — only the
 * entries no better source (official EN game data, SPA DB 2.1, the UI layers) covers, written by
 * `node tools/i18n/build.mjs --refresh-fallback` while out/ is reachable.
 * @returns {{ dict: Record<string, string>, missing: string[], lostTwins: string[], twins: number, fromOut: boolean }}
 */
export function buildBase() {
  const { source, prefill, derived } = JSON.parse(fs.readFileSync(path.join(DIR, 'source.json'), 'utf8'));
  const OUT = outDir();
  if (!OUT) {
    let dict = {};
    try { dict = JSON.parse(fs.readFileSync(path.join(DIR, 'fallback-en.json'), 'utf8')); } catch { /* none */ }
    return { dict: { ...prefill, ...dict }, missing: [], lostTwins: [], twins: 0, fromOut: false };
  }
  const en = new Map();
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const l of fs.readFileSync(path.join(OUT, f), 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const o = JSON.parse(l); if (typeof o.en === 'string' && o.en.trim()) en.set(Number(o.id), o.en); } catch { /* check.mjs reports it */ }
    }
  }
  const dict = { ...prefill };
  const missing = [];
  for (const [id, zh] of Object.entries(source)) {
    const t = en.get(Number(id));
    if (t && !CJK.test(t)) dict[zh] = t; else missing.push(zh);
  }
  // markup-free twins of the rich strings
  let twins = 0;
  for (const [zh, t] of Object.entries({ ...dict })) {
    if (!/<[@$][A-Za-z0-9_.\-]+>/.test(zh)) continue;
    const p = richTextPlain(zh);
    if (p !== zh && !(p in dict)) { dict[p] = richTextPlain(t); twins++; }
  }
  const lostTwins = derived.filter((z) => !(z in dict));
  return { dict, missing, lostTwins, twins, fromOut: true };
}
