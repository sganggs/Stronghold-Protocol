// test/plugins/catalog.test.js — a community catalogue (DESIGN §32.13, docs/PLUGINS.md §17).
// schemas/catalog.schema.json and shared/plugins/catalog.js readCatalog agree on one fixture set: a document is
// accepted exactly when the check finds neither a problem nor a warning. That set includes duplicate ids (the
// repository validator's uniqueItemProperties), an app string that is not a version range, an empty app, and a
// $schema that is not a string or is longer than 200 characters. Identical duplicate entries are in it too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaValidator } from '../helpers/jsonSchema.js';
import { APP_VERSION } from '../../shared/constants.js';
import { APP_RANGE_PATTERN, annotateCatalog, compareSemver, entryStatus, isCatalogUrl, readCatalog } from '../../shared/plugins/catalog.js';
import { isVersionRange } from '../../shared/plugins/manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const v = schemaValidator(path.join(ROOT, 'schemas'));
const HASH = 'ab'.repeat(32);
const ZERO = '0'.repeat(64);

const entry = (extra = {}) => ({
  id: 'demo-skin', name: 'Demo skin', version: '1.0.0', class: 'cosmetic',
  url: 'https://example.invalid/plugins/demo-skin.zip', sha256: HASH, ...extra,
});
const doc = (plugins, extra = {}) => ({ catalog: 1, name: 'Catalogue', plugins, ...extra });
const copy = (o) => JSON.parse(JSON.stringify(o));

/** [name, document] — accepted by both, or by neither. */
const FIXTURES = [
  ['one plugin', doc([entry()])],
  ['the example shape: description, bytes, homepage, license, authors, app', doc([entry({
    description: 'A note', bytes: 1024, homepage: 'https://example.invalid/demo-skin', license: 'CC-BY-4.0',
    authors: ['Example'], app: '>=0.3.0 <0.4.0',
  })])],
  ['authors as one string, app *', doc([entry({ authors: 'Example', app: '*' })])],
  ['two different ids', doc([entry(), entry({ id: 'demo-pack', class: 'lang', name: 'Demo language', version: '0.1.0', sha256: ZERO })])],
  ['an empty list', doc([])],
  ['a $schema', doc([entry()], { $schema: '../schemas/catalog.schema.json' })],
  ['every class the game names', doc(['lang', 'cosmetic', 'content', 'script', 'ui', 'trusted'].map((cls, i) => entry({ id: `demo-${cls}`, class: cls, name: cls, sha256: (i % 10).toString(16).repeat(64) })))],
  ['bytes 0 and the largest class ceiling (512 MB)', doc([entry({ bytes: 0, id: 'demo-zero' }), entry({ bytes: 209715200, id: 'demo-cap', sha256: ZERO }), entry({ bytes: 536870912, class: 'cosmetic', id: 'demo-big', sha256: ZERO })])],
  // broken — both refuse
  ['not an object', []],
  ['catalog is not 1', doc([entry()], { catalog: 2 })],
  ['no name', { catalog: 1, plugins: [entry()] }],
  ['an empty name', doc([entry()], { name: '' })],
  ['a name of 81 characters', doc([entry()], { name: 'n'.repeat(81) })],
  ['plugins is not a list', { catalog: 1, name: 'Catalogue', plugins: {} }],
  ['an unknown top-level field', doc([entry()], { market: true })],
  ['an entry that is not an object', doc(['demo-skin'])],
  ['an unknown entry field', doc([entry({ colour: 'red' })])],
  ['no id', doc([((e) => { delete e.id; return e; })(entry())])],
  ['an id that is not a plugin id', doc([entry({ id: 'Demo' })])],
  ['no sha256', doc([((e) => { delete e.sha256; return e; })(entry())])],
  ['a sha256 that is not 64 lowercase hex digits', doc([entry({ sha256: 'AB'.repeat(32) })])],
  ['no url', doc([((e) => { delete e.url; return e; })(entry())])],
  ['an http url', doc([entry({ url: 'http://example.invalid/a.zip' })])],
  ['a user and a password in the url', doc([entry({ url: 'https://user:pass@example.invalid/a.zip' })])],
  ['a single-label host', doc([entry({ url: 'https://localhost/a.zip' })])],
  ['no version', doc([((e) => { delete e.version; return e; })(entry())])],
  ['a version that is not semver', doc([entry({ version: '1.0' })])],
  ['an unknown class', doc([entry({ class: 'skin' })])],
  ['a description of 401 characters', doc([entry({ description: 'd'.repeat(401) })])],
  ['bytes past the largest class ceiling', doc([entry({ bytes: 536870913 })])],
  ['bytes that are not a whole number', doc([entry({ bytes: 1.5 })])],
  ['seventeen authors', doc([entry({ authors: Array.from({ length: 17 }, (_, i) => `a${i}`) })])],
  ['the same entry twice', doc([entry(), copy(entry())])],
  ['the same id on two different entries', doc([entry(), entry({ name: 'Other name' })])],
  ['an app that is not a version range', doc([entry({ app: 'latest' })])],
  ['an empty app', doc([entry({ app: '' })])],
  ['an app that is only whitespace', doc([entry({ app: '   ' })])],
  ['a $schema that is not a string', doc([entry()], { $schema: 5 })],
  ['a $schema of 201 characters', doc([entry()], { $schema: 's'.repeat(201) })],
  ['an empty $schema string', doc([entry()], { $schema: '' })],
];

test('the schema and readCatalog agree on the fixture set', () => {
  assert.ok(FIXTURES.length >= 20);
  for (const [name, value] of FIXTURES) {
    const schemaOk = v.validate('catalog.schema.json', value).length === 0;
    const read = readCatalog(value);
    assert.equal(read.ok, schemaOk, `${name}: schema ${schemaOk} check ${read.ok} ${read.problems.map((p) => p.detail).join('; ')} / ${v.validate('catalog.schema.json', value).join('; ')}`);
    if (read.ok) assert.equal(read.catalog.catalog, 1);
    else assert.equal(read.catalog, null);
  }
});

test('the documentation example is accepted, and its addresses are not real hosts we would ship', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/plugin-catalog.example.json'), 'utf8'));
  assert.equal(v.validate('catalog.schema.json', example).length, 0);
  assert.equal(readCatalog(example).ok, true);
  for (const e of example.plugins) assert.match(e.url, /^https:\/\/example\.invalid\//);
});

test('the app pattern matches isVersionRange, except a present empty range', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/catalog.schema.json'), 'utf8'));
  assert.equal(schema.$defs.entry.properties.app.pattern, APP_RANGE_PATTERN);
  assert.deepEqual(schema.properties.plugins.uniqueItemProperties, ['id']);
  const re = new RegExp(APP_RANGE_PATTERN, 'u');
  for (const s of ['*', 'x', '>=0.3.0', '1.2', '1.2.3', '^0.2.0', '~0.2.1', '>=0.2.0 <0.4.0', '* || >=1', 'v1.2.3', ' >=0.3.0 ', 'latest', '1.2.3.4', '', '   ']) {
    const schemaOk = re.test(s);
    const rangeOk = s.trim() !== '' && isVersionRange(s);
    assert.equal(schemaOk, rangeOk, JSON.stringify(s));
  }
});

test('compareSemver uses the core only; an unreadable version compares equal', () => {
  assert.ok(compareSemver('1.0.0', '1.2.0') < 0);
  assert.ok(compareSemver('2.0.0', '1.9.9') > 0);
  assert.equal(compareSemver('1.2.3-beta.1', '1.2.3'), 0);
  assert.equal(compareSemver('nope', '1.0.0'), 0);
});

test('entry status: incompatible wins, then updatable, installed, available; a missing app is compatible', () => {
  const e = entry({ version: '2.0.0', app: '*' });
  assert.deepEqual(entryStatus(e, undefined), { status: 'available', installedVersion: null });
  assert.deepEqual(entryStatus(e, '2.0.0'), { status: 'installed', installedVersion: '2.0.0' });
  assert.deepEqual(entryStatus(e, '1.0.0'), { status: 'updatable', installedVersion: '1.0.0' });
  assert.deepEqual(entryStatus(e, null), { status: 'installed', installedVersion: null });
  const old = entry({ id: 'demo-old', app: '>=9.0.0' });
  assert.equal(entryStatus(old, '1.0.0', APP_VERSION).status, 'incompatible');
  assert.equal(entryStatus(old, '1.0.0', APP_VERSION).installedVersion, '1.0.0');
  assert.equal(entryStatus(entry({ app: '' }), undefined).status, 'incompatible');
  assert.equal(entryStatus(entry({ app: '   ' }), undefined).status, 'incompatible');
  assert.equal(entryStatus(entry({ app: 'latest' }), undefined).status, 'incompatible');
  assert.equal(entryStatus(entry(), undefined).status, 'available');
  const rows = annotateCatalog(readCatalog(doc([e, old])).catalog, (id) => (id === 'demo-skin' ? '1.0.0' : undefined));
  assert.deepEqual(rows.map((r) => r.status), ['updatable', 'incompatible']);
});

test('isCatalogUrl refuses http, a userinfo, and a single-label host', () => {
  assert.equal(isCatalogUrl('https://example.invalid/a.zip'), true);
  // Syntax only. server/plugins/install.js refuses this address before any download.
  assert.equal(isCatalogUrl('https://127.0.0.1/a.zip'), true);
  assert.equal(isCatalogUrl('http://example.invalid/a.zip'), false);
  assert.equal(isCatalogUrl('https://user:pass@example.invalid/a.zip'), false);
  assert.equal(isCatalogUrl('https://localhost/a.zip'), false);
});
