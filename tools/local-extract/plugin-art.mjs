// Repository-owned bridge: discovery and Spine metadata, never a plugin module or network request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedArtReferences } from '../../server/plugins/artReferences.js';
import { parseSkel } from '../assets/skel.mjs';
import { resolveRoles } from '../assets/anim-roles.mjs';

const [mode, arg] = process.argv.slice(2);
if (mode === '--spine') {
  const sk = parseSkel(fs.readFileSync(arg));
  process.stdout.write(JSON.stringify({ pma: true,
    anims: resolveRoles(sk.animations, { skillIndices: [0, 1, 2], durations: sk.durations }),
    animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds }));
} else {
  const root = mode || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  process.stdout.write(JSON.stringify(installedArtReferences(root)));
}
