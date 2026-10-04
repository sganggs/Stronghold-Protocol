#!/usr/bin/env node
// aldus/i18n/extract.mjs — list the interface text of the original client, and say what a catalog lacks.
//
//   node aldus/i18n/extract.mjs            the coverage of every catalog of locales/
//   node aldus/i18n/extract.mjs --missing  also every source string without a translation
//
// The source text is the message id (translator.js), so there is no key file to keep: this script reads the text out
// of public/index.html, public/js and shared/ again each time. A "fragment" is a run of text with Chinese in it between
// the delimiters of the source (quotes, tags, `${…}`): what the page shows as one text node, or as one piece of one.
// After a merge from the original project, run it: new text shows as missing, and stays Chinese on the page until a
// translation is added to locales/<locale>.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator, CJK } from './translator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
const RUN = /[^'"`<>{}$\n\\|]*[一-鿿][^'"`<>{}$\n\\|]*/g;

function jsFiles(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'vendor' && d.name !== 'dev') out.push(...jsFiles(p)); } else if (d.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** JavaScript without its comments (line comments only where they cannot be part of a string or a URL). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat(m.split('\n').length - 1)).split('\n').map((line) => {
    const m = /(^|[\s;{}(),])\/\//.exec(line);
    return m ? line.slice(0, m.index + m[1].length) : line;
  }).join('\n');
}

/** The interface fragments of the original client: `[text, [files]]`, in the order they are found. */
export function extractFragments(root = ROOT) {
  const files = [path.join(root, 'public', 'index.html'), ...jsFiles(path.join(root, 'public', 'js')), ...jsFiles(path.join(root, 'shared'))];
  const seen = new Map();
  for (const file of files) {
    let src = fs.readFileSync(file, 'utf8');
    src = file.endsWith('.js') ? stripComments(src) : src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');
    for (const m of src.matchAll(RUN)) {
      let t = m[0].trim().replace(/^[)\];:,.\s=+([]+/, '');
      if (!/[：:]$/.test(t)) t = t.replace(/[\s([=+:,;]+$/, '');
      t = t.trim();
      // a regular expression or a statement of the source, not text for a person
      if (!t || !CJK.test(t) || /\.test\(|=>|\bif \(/.test(t)) continue;
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (!seen.has(t)) seen.set(t, []);
      if (!seen.get(t).includes(rel)) seen.get(t).push(rel);
    }
  }
  return [...seen.entries()];
}

/** How much of the interface text a catalog translates. */
export function coverage(catalog, fragments = extractFragments()) {
  const { translate } = createTranslator(catalog);
  const missing = fragments.filter(([t]) => translate(t) == null);
  return { total: fragments.length, translated: fragments.length - missing.length, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fragments = extractFragments();
  for (const f of fs.readdirSync(path.join(HERE, 'locales')).filter((n) => n.endsWith('.json')).sort()) {
    const catalog = JSON.parse(fs.readFileSync(path.join(HERE, 'locales', f), 'utf8'));
    const c = coverage(catalog, fragments);
    console.log(`${catalog.locale}: ${c.translated} of ${c.total} interface fragments (${((100 * c.translated) / c.total).toFixed(1)} %)`);
    if (process.argv.includes('--missing')) for (const [t, files] of c.missing) console.log(`  ${t}\t${files[0]}`);
  }
}
