// The Python extractor calls this repository-owned reader, never a pack's JavaScript.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedFxReferences } from '../../server/plugins/fxReferences.js';
const root = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.stdout.write(JSON.stringify(installedFxReferences(root)));
