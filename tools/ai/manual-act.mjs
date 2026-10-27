#!/usr/bin/env node
// §37.26 [ASSUMED] Atomic no-clobber answer for the current seat observation.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readJSON, writeJSON, actionReply } from './manual-files.mjs';

try {
  const [dir, value, ...extra] = process.argv.slice(2);
  if (!dir || extra.length) throw new Error('Usage: manual-act.mjs <seat-dir> [json | @file | --status]');
  const folder = path.resolve(dir), status = readJSON(path.join(folder, 'status.json'));
  console.log(status.obs || path.join(folder, 'result.md'));
  const expired = status.expiresAt != null && Date.now() >= status.expiresAt;
  if (!value || value === '--status') {
    console.log(`${status.state}${expired && status.state === 'waiting' ? ' (deadline elapsed; the phase timer decides)' : ''}; seat ${status.seat}; round ${status.round}; ${status.phase || ''} ${status.kind || ''}; intents left ${status.remaining ?? '—'}`);
    if (status.match && existsSync(status.match)) {
      const match = readJSON(status.match), seat = match.players.find(p => p.seat === status.seat);
      console.log(`Match: round ${match.round} ${match.phase}; LP ${seat?.lp ?? '—'}${seat?.alive === false ? '; eliminated' : ''}`);
    }
    if (status.error) console.log(status.error);
    if (status.state === 'waiting' && existsSync(path.join(folder, `act-${status.n}.json`))) console.log('Answer queued.');
  } else {
    if (status.state !== 'waiting' || expired) throw new Error('No live unanswered observation; inspect --status and wait for the next obs');
    const action = JSON.parse(value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value);
    actionReply(action, status);
    const file = path.join(folder, `act-${status.n}.json`);
    writeJSON(file, action, { exclusive: true });
    console.log(`Wrote ${file}`);
  }
} catch (e) {
  console.error(`manual-act: ${e.code === 'EEXIST' ? 'This observation already has an answer' : e.message}`);
  process.exitCode = 1;
}
