// tools/i18n/ui-check.mjs [--json] — the UI-text check of the language switch (js/i18n.js T()).
//
// Scans the client (public/js) for display texts that would not switch language:
//   cjk-raw     a Chinese literal / htm text not inside T() / TC() / TH() (or another allowed wrapper)
//   en-raw      an English-looking htm text node or display attribute (label / title / placeholder / aria-label /
//               text / micro excluded) — likely a leftover of the in-place English translation
//   missing     a T('中文') text with no entry in the English dictionary (public/i18n/en.json)
//   slots       a dictionary entry whose {n} slots differ from its key's
// Exit 1 when cjk-raw / en-raw / slots findings exist (missing is a warning).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexChunks, CJK, unescapeJs } from './jslex.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const JS = path.join(ROOT, 'public', 'js');
// files whose CJK literals are not display texts (logic / data matching) or that are the i18n layer itself
const SKIP = new Set(['i18n.js']);
const WRAPPERS = new Set(['T', 'TC', 'TH', 'tr']);
const DISPLAY_ATTRS = /(?:^|\s)(label|title|placeholder|aria-label|alt|text|tip|hint|confirm|cancel|heading)\s*=\s*["']?$/i;
// a CJK literal that is a logic pattern (regex / data key match) — allowed by an inline `// i18n-ok` marker too
const LOGIC_CONTEXT = /(===|!==|\.(?:test|includes|startsWith|endsWith|indexOf|replace|split|match|has|get)\s*\()\s*$/;

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
}

const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', 'en.json'), 'utf8'));
const findings = { 'cjk-raw': [], 'en-raw': [], missing: [], slots: [] };
const seenMissing = new Set();

for (const abs of walk(JS)) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (SKIP.has(path.basename(abs))) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  for (const c of lexChunks(src)) {
    const lineText = lines[c.line - 1] || '';
    if (/i18n-ok/.test(lineText) || /i18n-ok \(next line\)/.test(lines[c.line - 2] || '')) continue;
    const before = src.slice(Math.max(0, c.start - 60), c.start);
    if (CJK.test(c.text)) {
      const wrapped = c.callee && WRAPPERS.has(c.callee.split('.').pop());
      const ctxArg = /\bTC\(\s*'[^']*'\s*,\s*$/.test(before); // TC(ctx, '中文')
      if (wrapped || ctxArg) {
        if (c.kind === 'str') {
          const key = unescapeJs(c.text);
          if (!(key in dict) && !seenMissing.has(key)) { seenMissing.add(key); findings.missing.push({ file: rel, line: c.line, text: key }); }
        }
        continue;
      }
      if (c.kind === 'str' && LOGIC_CONTEXT.test(before)) continue;
      if (/^\s*(\/\/|\*)/.test(lineText)) continue;
      findings['cjk-raw'].push({ file: rel, line: c.line, kind: c.kind, text: c.text.slice(0, 80) });
      continue;
    }
    // English leftovers: htm text nodes with words, display attributes
    const words = c.text.replace(/\$\{\d+\}/g, ' ').trim();
    if (!/[A-Za-z]{3,}\s+[A-Za-z]{2,}|^[A-Z][a-z]{2,}/.test(words)) continue;
    // micro labels (CALLSIGN, TARGET POINT, v0.1.2 · WEB SIMULATION …) are English in both languages
    if (/^[A-Z0-9 _·/:.#\-]+$/.test(words.replace(/^v(?=[\s·])/, ''))) continue;
    if (c.kind === 'text') findings['en-raw'].push({ file: rel, line: c.line, kind: c.kind, text: c.text.slice(0, 80) });
    else if (c.kind === 'attr' && DISPLAY_ATTRS.test(src.slice(Math.max(0, c.start - 20), c.start))) findings['en-raw'].push({ file: rel, line: c.line, kind: c.kind, text: c.text.slice(0, 80) });
  }
}

for (const [k, v] of Object.entries(dict)) {
  const a = [...k.matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join();
  const b = [...String(v).matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join();
  if (a !== b) findings.slots.push({ key: k.slice(0, 80), value: String(v).slice(0, 80) });
}

if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 1));
else {
  for (const [k, list] of Object.entries(findings)) {
    console.log(`${k}: ${list.length}`);
    for (const f of list.slice(0, k === 'missing' ? 15 : 60)) console.log('  ' + (f.file ? `${f.file.replace('public/js/', '')}:${f.line} ` : '') + JSON.stringify(f.text ?? `${f.key} → ${f.value}`));
  }
}
process.exitCode = findings['cjk-raw'].length || findings['en-raw'].length || findings.slots.length ? 1 : 0;
