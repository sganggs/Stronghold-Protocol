// tools/i18n/spa-extract.mjs [db-dir] — copy the "Second Season" (2.1) tables of the SPA Database
// (https://ak-spa-database.pages.dev, source repo stronghold-protocol-alliance-database: src/data/alliance/season2.1)
// into tools/i18n/spa-db.json. db-dir defaults to the repo checkout at the project root.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, 'stronghold-protocol-alliance-database-main/src/data/alliance/season2.1'));
const J = (f, key) => {
  const v = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))[key];
  if (!Array.isArray(v)) throw new Error(`${f}: no array "${key}"`);
  return v;
};

const out = {
  attributes: J('operators.json', 'operators'),
  alliances: J('alliances.json', 'bondInfo'),
  items: J('items.json', 'shopitems'),
  strategies: J('strategies.json', 'bandInfo'),
  tacticalDecisions: J('tacticalDecisions.json', 'tacticalDecisions'),
  bountyDecisions: J('bountyDecisions.json', 'bountyDecisions'),
  tacticalTraining: J('tacticalTraining.json', 'tacticalTraining').map(({ id, name, enemies }) => ({ id, name, enemies: enemies.map((e) => e.name) })),
  leaders: J('leaders.json', 'leaders').map((l) => l.name),
};
for (const [k, v] of Object.entries(out)) console.log(k, v.length, JSON.stringify(v[0]).slice(0, 160));
fs.writeFileSync(path.join(DIR, 'spa-db.json'), JSON.stringify(out, null, 1));
