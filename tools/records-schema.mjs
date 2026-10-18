#!/usr/bin/env node
// Write schemas/records.schema.json from the runtime RECORDS_SCHEMA (DESIGN §32.5, PLUGINS §10).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAIT_RECORDS_SCHEMA as RECORDS_SCHEMA, OPERATOR_TRAIT_SCHEMA } from '../server/plugins/traitSchema.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'schemas/records.schema.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(RECORDS_SCHEMA, null, 2)}\n`);

if (!process.argv[2]) fs.writeFileSync(path.join(root, 'schemas/operator-trait.schema.json'), `${JSON.stringify(OPERATOR_TRAIT_SCHEMA, null, 2)}\n`);
