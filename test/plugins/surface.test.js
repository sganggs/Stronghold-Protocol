import { TRAIT_SURFACE } from '../../server/plugins/operatorTraits.js';
import { GAMEPLAY_RECORD_SURFACE } from '../../server/plugins/gameplayRecords.js';
// test/plugins/surface.test.js — the frozen plugin API v1 (DESIGN §32.13, docs/PLUGIN-API.md).
// Three things must agree: the markdown table, buildSurface(), and the closed sets themselves (enumerated in this
// file, not by calling buildSurface's helpers). A new export means a new member of one of those sets — a manifest
// field, permission, class, patch op, compact-record field, overlay leaf, DSL word, postMessage name, slot, studio
// route, error code, catalogue field or SDK member — not every new function. surface.stable.json records { name,
// anchor } for stability === 'stable'. Removing, renaming or adding a stable row fails until that file is updated
// on purpose, even when the document and buildSurface are changed together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_API } from '../../shared/constants.js';
import { MANIFEST_FIELDS, PERMISSIONS, PLUGIN_CLASSES, UI_SLOT_IDS } from '../../shared/plugins/manifest.js';
import { RULE_NAMES } from '../../shared/plugins/rules.js';
import { PATCH_OPS } from '../../shared/plugins/patch.js';
import { RECORD_SCHEMA } from '../../shared/plugins/recordsSchema.js';
import { ASSET_CONTAINERS } from '../../shared/plugins/visual.js';
import { UI_HOST_MESSAGES, UI_PLUGIN_MESSAGES } from '../../shared/plugins/ui.js';
import { PLUGIN_ERRORS } from '../../shared/plugins/errors.js';
import { CATALOG_ENTRY_FIELDS, CATALOG_FIELDS } from '../../shared/plugins/catalog.js';
import { SDK_ID, SDK_MEMBERS } from '../../shared/plugins/sdk.js';
import * as sdk from '../../shared/plugins/sdk.js';
import { SURFACE_MARKERS, SURFACE_SINCE, SURFACE_SINCE_NEXT, buildSurface, uncoveredSdkExports } from '../../shared/plugins/surface.js';
import { STUDIO_ROUTES } from '../../server/studio/index.js';
import * as vocab from '../../server/sim/content/dsl/vocab.js';
import { pluginFxSurface } from '../../public/js/render/vfx/pluginFormat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Overlay leaves, copied so a drift in surface.js is visible. A string kind is one leaf. */
function overlayLeaves(containers) {
  const out = [];
  const walk = (kind, prefix) => {
    if (typeof kind === 'string') { out.push(prefix); return; }
    if (kind && kind.fields) {
      for (const [k, v] of Object.entries(kind.fields)) walk(v, `${prefix}.${k}`);
      return;
    }
    if (kind && kind.each) { out.push(`${prefix}.*`); return; }
    throw new Error(`unknown asset kind at ${prefix}`);
  };
  for (const c of containers) {
    const base = `overlay.${c.path.join('.')}`;
    if (Array.isArray(c.keys)) for (const k of c.keys) walk(c.record, `${base}.${k}`);
    else if (typeof c.record === 'string' || (c.record && c.record.each)) out.push(`${base}.*`);
    else walk(c.record, base);
  }
  return out;
}

const DSL_GROUPS = [
  ['trigger', 'TRIGGERS'],
  ['condition', 'CONDITIONS'],
  ['action', 'ACTIONS'],
  ['target', 'TARGETS'],
  ['metaTrigger', 'META_TRIGGERS'],
  ['metaAction', 'META_ACTIONS'],
  ['value', 'VALUE_OPS'],
  ['skillKind', 'SKILL_KINDS'],
  ['stat', 'STAT_NAMES'],
];

function expectedNames() {
  const names = [];
  for (const field of MANIFEST_FIELDS) names.push(`manifest.field.${field}`);
  for (const name of RULE_NAMES) names.push(`rule.${name}`);
  for (const name of Object.keys(PERMISSIONS)) names.push(`permission.${name}`);
  for (const name of Object.keys(PLUGIN_CLASSES)) names.push(`class.${name}`);
  for (const op of PATCH_OPS) names.push(`patch.op.${op}`);
  const [operator, generic] = RECORD_SCHEMA.anyOf;
  for (const name of Object.keys(operator.properties)) names.push(`record.operator.${name}`);
  for (const name of Object.keys(generic.properties)) names.push(`record.generic.${name}`);
  for (const name of overlayLeaves(ASSET_CONTAINERS)) names.push(name);
  for (const [group, key] of DSL_GROUPS) for (const name of vocab[key]) names.push(`dsl.${group}.${name}`);
  for (const name of UI_PLUGIN_MESSAGES) names.push(`ui.message.plugin.${name}`);
  for (const name of UI_HOST_MESSAGES) names.push(`ui.message.host.${name}`);
  for (const name of UI_SLOT_IDS) names.push(`ui.slot.${name}`);
  for (const route of STUDIO_ROUTES) names.push(`studio.route.${route}`);
  for (const code of Object.keys(PLUGIN_ERRORS)) names.push(`error.${code}`);
  for (const name of CATALOG_FIELDS) names.push(`catalog.field.${name}`);
  for (const name of CATALOG_ENTRY_FIELDS) names.push(`catalog.entry.${name}`);
  names.push(`sdk.${SDK_ID}`);
  names.push('sdk.SDK_MEMBERS');
  for (const name of SDK_MEMBERS) names.push(`sdk.${SDK_ID}.${name}`);
  // from the real module, not from surface.js: every export but the id and the member list
  for (const name of Object.keys(sdk).filter((k) => k !== 'SDK_ID' && k !== 'SDK_MEMBERS').sort()) names.push(`sdk.export.${name}`);
  names.push('api.PLUGIN_API.min', 'api.PLUGIN_API.current');
  names.push('record.file.bonds', 'record.file.items', 'record.operator.forms.tags', 'record.operator.forms.tokens');
  names.push('record.operator.fx', 'overlay.fx.index', 'overlay.fx.flipbooks', 'overlay.fx.bind', 'overlay.fx.silentPhases', 'dsl.fx.plugin');
  names.push(...TRAIT_SURFACE.map(r => r.name));
  return names;
}

function parseTable(md) {
  const a = md.indexOf(SURFACE_MARKERS.start);
  const b = md.indexOf(SURFACE_MARKERS.end);
  assert.ok(a >= 0 && b > a, 'docs/PLUGIN-API.md has the surface markers');
  const rows = [];
  for (const line of md.slice(a, b).split('\n')) {
    const m = /^\| `([^`]+)` \| (stable|experimental|internal) \| ([^|]+) \| `([^`]+)` \|$/.exec(line);
    if (m) rows.push({ name: m[1], stability: m[2], since: m[3].trim(), anchor: m[4] });
  }
  return rows;
}

const rows = [...buildSurface({ dsl: vocab, studioRoutes: STUDIO_ROUTES }), ...GAMEPLAY_RECORD_SURFACE, ...pluginFxSurface(), ...TRAIT_SURFACE];
const doc = parseTable(fs.readFileSync(path.join(ROOT, 'docs/PLUGIN-API.md'), 'utf8'));

test('the document table and buildSurface are the same rows', () => {
  assert.ok(rows.length > 50, `${rows.length} rows`);
  assert.deepEqual(doc, rows.map(({ name, stability, since, anchor }) => ({ name, stability, since, anchor })));
  assert.equal(SURFACE_SINCE, '0.3.0');
  assert.ok(rows.every((r) => ['0.3.0', '0.3.1'].includes(r.since)));
  assert.equal(rows.find(r => r.name === 'record.operator.origin').since, '0.3.1');
  for (const name of ['manifest.field.offers', 'permission.offers', 'error.PLUGIN_OFFER_SHAPE', 'error.PLUGIN_OFFER_ROUNDS', 'error.PLUGIN_OFFER_REFERENCE']) {
    assert.equal(rows.find(r => r.name === name).since, '0.3.1', name);
  }
  assert.deepEqual(PLUGIN_API, { current: 2, min: 1 });
  for (const r of rows) assert.doesNotMatch(r.since, /-dev$/, `${r.name}: since names a release`);
  assert.ok(rows.some((r) => r.since === SURFACE_SINCE), 'the frozen rows still name 0.3.0');
});

test('every closed-set member is a row, and the table has no extra name', () => {
  assert.deepEqual(rows.map((r) => r.name), expectedNames());
});

test('stable names match the baseline, including ones added or removed on purpose', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/plugins/surface.stable.json'), 'utf8'));
  const stable = rows.filter((r) => r.stability === 'stable').map(({ name, anchor }) => ({ name, anchor }));
  assert.deepEqual(stable, baseline);
});

test('surface.js does not import Node builtins or server modules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'shared/plugins/surface.js'), 'utf8');
  // Anchors name server files in strings. Only an import or require of one is a violation.
  assert.doesNotMatch(src, /from ['"]node:/);
  assert.doesNotMatch(src, /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*server\//);
});

/**
 * Method and path of every route `api()` can answer, from the function source (not from STUDIO_ROUTES).
 * Top-level `route ===` conditions carry the method (`read` is GET; HEAD is the same row). Inside the plugin-id
 * matcher, `sub ===` maps onto the templates STUDIO_ROUTES already uses.
 * @param {string} src
 * @returns {string[]}
 */
function studioRoutesFromApi(src) {
  const start = src.indexOf('async function api(');
  const end = src.indexOf('async function handle(', start);
  if (start < 0 || end < start) throw new Error('api() slice not found');
  const body = src.slice(start, end);
  /** @type {string[]} */
  const found = [];
  const add = (method, route) => {
    const row = `${method} /studio/api/${route}`;
    if (!found.includes(row)) found.push(row);
  };
  const conditions = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    let i = m.index + m[0].length;
    let depth = 1;
    const from = i;
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === "'" || c === '"' || c === '`') {
        const q = c;
        i += 1;
        while (i < body.length && body[i] !== q) {
          if (body[i] === '\\') i += 1;
          i += 1;
        }
      } else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    conditions.push(body.slice(from, i - 1));
  }
  for (const cond of conditions) {
    const names = [...cond.matchAll(/route === '([^']+)'/g)].map((x) => x[1]);
    if (!names.length) continue;
    /** @type {string[]} */
    const methods = [];
    if (/\bread\b/.test(cond)) methods.push('GET');
    if (/method === 'POST'/.test(cond)) methods.push('POST');
    if (/method === 'PUT'/.test(cond)) methods.push('PUT');
    if (/method === 'DELETE'/.test(cond)) methods.push('DELETE');
    if (/method === 'GET'/.test(cond) && !methods.includes('GET')) methods.push('GET');
    for (const name of names) for (const method of methods) add(method, name);
  }
  const marker = body.indexOf('const m = /^plugins\\/');
  if (marker < 0) throw new Error('plugin id matcher not found');
  const tail = body.slice(marker);
  const getAt = tail.indexOf("if (method === 'GET' || method === 'HEAD')");
  const getBlock = braceBlock(tail, getAt);
  if (getBlock.includes("sub === ''")) add('GET', 'plugins/:id');
  if (getBlock.includes("sub === 'preview'")) add('GET', 'plugins/:id/preview');
  if (getBlock.includes("sub === 'zip'")) add('GET', 'plugins/:id/zip');
  if (getBlock.includes('[0-9a-f]{8}') && getBlock.includes('files')) {
    add('GET', 'plugins/:id/f/:hash8/*');
    add('GET', 'plugins/:id/files/*');
  }
  if (/method === 'PUT' && sub === 'manifest'/.test(tail)) add('PUT', 'plugins/:id/manifest');
  if (/fileRoute && \(method === 'PUT' \|\| method === 'DELETE'\)/.test(tail)) {
    add('PUT', 'plugins/:id/files/*');
    add('DELETE', 'plugins/:id/files/*');
  }
  const postAt = tail.indexOf("if (method !== 'POST') return false;");
  const postTail = postAt < 0 ? '' : tail.slice(postAt);
  for (const sub of ['slot', 'meta', 'sections', 'ref', 'clear', 'fix', 'pack', 'authoring']) {
    if (postTail.includes(`sub === '${sub}'`)) add('POST', `plugins/:id/${sub}`);
  }
  return found;
}

/** The brace block that starts at or after `from`. @param {string} src @param {number} from */
function braceBlock(src, from) {
  const brace = src.indexOf('{', from);
  if (brace < 0) return '';
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(brace + 1, i);
    }
  }
  return '';
}

test('every sdk.js export is a row anchored at that export', () => {
  assert.deepEqual(uncoveredSdkExports(sdk, rows), []);
  const extra = { ...sdk, registerKit() {} };
  assert.deepEqual(uncoveredSdkExports(extra, rows), ['registerKit']);
});

test('STUDIO_ROUTES and the routes api() dispatches are the same set', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/studio/index.js'), 'utf8');
  const discovered = studioRoutesFromApi(src).sort();
  assert.deepEqual(discovered, [...STUDIO_ROUTES].sort());
  assert.ok(discovered.includes('POST /studio/api/catalog'));
  assert.ok(discovered.includes('POST /studio/api/catalog/install'));
  assert.equal(PLUGIN_API.current, 2);
  const disabled = src.replace("route === 'targets'", 'false');
  assert.equal(studioRoutesFromApi(disabled).includes('GET /studio/api/targets'), false);
  const method = src.replace("route === 'authors' && method === 'POST'", "route === 'authors' && method === 'GET'");
  const changed = studioRoutesFromApi(method);
  assert.equal(changed.includes('POST /studio/api/authors'), false);
  assert.equal(changed.includes('GET /studio/api/authors'), true);
  assert.notDeepEqual(changed.sort(), [...STUDIO_ROUTES].sort());
});
