// tools/i18n/build.mjs — merge the translations (tools/i18n/out/*.jsonl) into public/i18n/en.json ({ zh: en }).
// The base dictionary (base.mjs: translations, prefilled operator names, plain twins), then the SPA Database
// (season 2.1) overrides of tools/i18n/spa-overrides.json (apply-spa.mjs), then the official EN game data of
// tools/i18n/official-overrides.json (official-en.mjs). Precedence for game texts, lowest to highest:
// agent translations < SPA DB 2.1 < official EN game data. Reports what is still untranslated.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIR, buildBase } from './base.mjs';

const { dict, missing, lostTwins, twins, fromOut } = buildBase();
const agentDict = { ...dict };
const betterKeys = {}; // every key a better layer (UI, SPA DB, official EN) provides
const readLayer = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return {}; } };

// The UI texts of the client (T('中文') in public/js, Chinese server templates): recovered from the branch's in-place
// English (recover-ui.mjs → ui-en.seed.json), then the hand-written / reviewed entries (ui-en.*.json, file name order).
// Both override the agents' base (the seed is the branch's reviewed in-place English); the SPA / official game data
// layers below still win for game texts.
const UI_LAYERS = fs.readdirSync(DIR).filter((f) => /^ui-en\..+\.json$/.test(f) && f !== 'ui-en.seed.json').sort();
for (const f of ['ui-en.seed.json', ...UI_LAYERS]) {
  for (const [k, v] of Object.entries(readLayer(f))) {
    betterKeys[k] = true;
    dict[k] = v;
  }
}

// SPA Database (season 2.1) wording wins (tools/i18n/apply-spa.mjs), then the official EN game data
// (ArknightsGamedata/en, tools/i18n/official-en.mjs) over everything: the last layer
for (const f of ['spa-overrides.json', 'official-overrides.json']) {
  const layer = readLayer(f);
  Object.assign(betterKeys, Object.fromEntries(Object.keys(layer).map((k) => [k, true])));
  Object.assign(dict, layer);
}
// --refresh-fallback (needs the agents' out/ folder, base.mjs outDir): snapshot the entries that only the agents'
// translations provide into tools/i18n/fallback-en.json, so later builds need neither out/ nor the archive.
if (process.argv.includes('--refresh-fallback')) {
  if (!fromOut) throw new Error('--refresh-fallback needs the out/ folder (tools/i18n/out, ../translation agent data/out or $I18N_OUT)');
  const better = new Set(Object.keys(betterKeys));
  const fallback = Object.fromEntries(Object.entries(agentDict).filter(([k]) => !better.has(k) && dict[k] === agentDict[k]).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(path.join(DIR, 'fallback-en.json'), JSON.stringify(fallback, null, 1) + '\n');
  console.log(`fallback-en.json: ${Object.keys(fallback).length} agent-only entries`);
}
fs.mkdirSync(path.join(ROOT, 'public', 'i18n'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public', 'i18n', 'en.json'), JSON.stringify(dict));
console.log(`en.json: ${Object.keys(dict).length} entries (${twins} plain twins); untranslated ${missing.length}, plain strings without twin ${lostTwins.length}`);
for (const z of [...missing, ...lostTwins].slice(0, 15)) console.log('  ' + z.slice(0, 100).replace(/\n/g, '⏎'));
