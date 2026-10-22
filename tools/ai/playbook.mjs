#!/usr/bin/env node
// §35.12: offline regeneration/audit. Writes JSON only to stdout; no network or game mutations.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { strategyCandidates } from '../../server/ai/strategy.js';
import { COMMUNITY } from '../../server/ai/strategy-community.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--data-dir', '--mode', '--community', '--observation'].includes(key) || !value || value.startsWith('--')) throw new Error('arguments');
    options[key] = value;
  }
  const data = {}, inputHashes = {};
  for (const name of ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'choices', 'enemies', 'factions', 'bosses']) {
    const bytes = readFileSync(resolve(options['--data-dir'] || 'data', `${name}.json`));
    inputHashes[name] = hash(bytes); data[name] = JSON.parse(bytes);
  }
  const modeId = options['--mode'] || 'mode_multi_normal';
  if (!data.config.modes?.[modeId]) throw new Error('unknown mode');
  const community = options['--community'] ? JSON.parse(readFileSync(options['--community'], 'utf8')) : COMMUNITY;
  const playbook = buildPlaybook(data, { modeId, community });
  const codeHashes = Object.fromEntries(['../../server/ai/playbook.js', '../../server/ai/strategy.js', '../../server/ai/cycles.js',
    '../../server/ai/cycle-candidates.js', '../../server/ai/community-candidates.js', '../../server/match/gamedata.js',
    '../../shared/bandBonds.js', '../../shared/constants.js', '../../docs/AI-STRATEGY.md'].map(p => [p, hash(readFileSync(new URL(p, import.meta.url)))]));
  const observation = options['--observation'] ? JSON.parse(readFileSync(options['--observation'], 'utf8')) : null;
  process.stdout.write(`${JSON.stringify({ schema: 'sp-strategy-audit/1', inputHashes, codeHashes, community, playbook,
    ...(observation ? { observation, strategy: strategyCandidates(playbook, observation.digest || observation, observation.previousPlan) } : {}) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`Playbook generation failed: ${error.message}\nUsage: node tools/ai/playbook.mjs [--data-dir DIR] [--mode ID] [--community JSON] [--observation JSON]\n`);
  process.exitCode = 1;
}
