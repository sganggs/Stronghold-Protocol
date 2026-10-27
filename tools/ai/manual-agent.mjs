#!/usr/bin/env node
// Dev-only sp-ai/1 agent; one independent file mailbox per seat, no model/provider/API.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { mkdirSync, readdirSync, existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { publish, writeJSON, readJSON, seatDir, actionReply } from './manual-files.mjs';
import { observationMarkdown, actionList } from './manual-report.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string' }, mode: { type: 'string', default: 'solo' } } });
if (!values.dir || !['solo', 'coop'].includes(values.mode)) throw new Error('manual-agent --dir <dir> --mode solo|coop');
const dir = path.resolve(values.dir), active = new Map(), sequences = new Map();
let pack = null;
const send = reply => process.stdout.write(`${JSON.stringify(reply)}\n`);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

async function decide(o) {
  const seat = o.private.seat, folder = seatDir(dir, values.mode, seat);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // A timed-out co-op request has no cancellation frame in sp-ai/1. A new request for that seat
  // supersedes its old file waiter. An old act file never becomes an answer to a new request.
  active.get(seat)?.abort();
  const controller = new AbortController();
  active.set(seat, controller);
  const previous = sequences.get(seat) ?? Math.max(0, ...readdirSync(folder).map(f => /^obs-(\d+)\.json$/.exec(f)?.[1] || 0).map(Number));
  const n = previous + 1;
  sequences.set(seat, n);
  if (pack && !existsSync(path.join(folder, 'knowledge.json'))) writeJSON(path.join(folder, 'knowledge.json'), pack);
  const base = path.join(folder, `obs-${n}`), act = path.join(folder, `act-${n}.json`);
  const status = { state: 'waiting', n, id: o.id, seat, round: o.context.round, phase: o.context.phase,
    kind: o.context.kind, remaining: o.context.remaining, obs: `${base}.md`, match: path.join(dir, 'match.json'),
    expiresAt: o.context.deadline > 0 ? Date.now() + Math.max(0, o.context.deadline - o.public.serverNow) : null };
  writeJSON(`${base}.json`, o.digest);
  writeJSON(`${base}.request.json`, o);
  publish(`${base}.actions.md`, actionList(o));
  publish(`${base}.md`, observationMarkdown(o, pack, n));
  writeJSON(path.join(folder, 'status.json'), status);
  let invalid = 0;
  try {
    for (;;) { // loop-cap: cancelled on supersession/EOF; intentionally waits for a human in untimed solo
      if (controller.signal.aborted) return;
      if (existsSync(act)) {
        let reply;
        try { reply = actionReply(readJSON(act), o.context); }
        catch (e) {
          renameSync(act, path.join(folder, `act-${n}.invalid-${++invalid}.json`));
          writeJSON(path.join(folder, 'status.json'), { ...status, error: e.message });
        }
        if (reply) {
          writeJSON(path.join(folder, 'status.json'), { ...status, state: 'submitted' });
          send({ v: o.v, id: o.id, ...reply });
          return;
        }
      }
      await delay(100, undefined, { signal: controller.signal });
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  finally { if (active.get(seat) === controller) active.delete(seat); }
}
input.on('line', line => {
  try {
    const o = JSON.parse(line);
    if (o.type === 'hello') {
      pack = o.knowledge;
      send({ v: o.v, id: o.id, type: 'hello', knowledgeVersion: pack.version });
    } else if (o.v !== 'sp-ai/1' || o.context?.mode !== 'direct') throw new Error('Expected sp-ai/1 direct');
    else void decide(o).catch(() => { process.exitCode = 1; input.close(); });
  } catch { process.exitCode = 1; input.close(); }
});
input.on('close', () => { for (const c of active.values()) c.abort(); });
