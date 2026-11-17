#!/usr/bin/env node
// Dev-only manual launcher. Solo uses botbench's virtual clock; co-op uses the live wall clock
// so several human/agent seats must actually keep up with the ordinary preparation deadlines.
import { toolVersion } from '../versions/runtime.mjs';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler, RealScheduler } from '../../server/match/scheduler.js';
import { getData } from '../../server/data.js';
import { llmIntegrationEnabledNow } from '../../server/match/llmGate.js';
import { traceLayers } from './layer-trace.mjs';
import { runMatch } from './run-match.mjs';
import { seatDir, writeJSON, publish, readJSON } from './manual-files.mjs';
import { resultMarkdown } from './manual-report.mjs';

export async function manualMatch(options, { MatchClass = Match, scheduler } = {}) {
  if (!llmIntegrationEnabledNow) throw new Error('Manual seats are development-only');
  const { dir, mode = 'solo', difficulty = 'ABYSS', seed = 1, seats = mode === 'solo' ? '0' : '0,1,2,3' } = options;
  if (!dir || !['solo', 'coop'].includes(mode) || !['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(difficulty)) throw new Error('Expected --dir <new-dir> --mode solo|coop --difficulty FUNNY|NORMAL|HARD|ABYSS');
  if (!Number.isSafeInteger(Number(seed))) throw new Error('--seed must be an integer');
  const selected = String(seats).split(',').map(Number), count = mode === 'solo' ? 1 : 4;
  if (!/^\d(?:,\d)*$/.test(String(seats)) || new Set(selected).size !== selected.length || selected.some(s => s < 0 || s >= count)) throw new Error('--seats must be unique seat indices (solo: 0; coop: 0..3)');
  const data = getData();
  if (!data.config.modes[`mode_${mode === 'solo' ? 'single' : 'multi'}_${difficulty.toLowerCase()}`]) throw new Error(`${difficulty} is unavailable in ${toolVersion}; choose a supported difficulty`);
  const root = path.resolve(dir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (readdirSync(root).length) throw new Error('--dir must be empty; use a new directory for each match');
  writeJSON(path.join(root, 'session.json'), { mode, difficulty, seed: Number(seed), version: toolVersion, seats: selected }, { exclusive: true });
  for (const seat of selected) {
    const folder = seatDir(root, mode, seat);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeJSON(path.join(folder, 'status.json'), { state: 'starting', seat, round: 0 });
    console.log(`Seat ${seat}: ${folder}`);
  }
  let summary, resolveEnd;
  const ended = new Promise(resolve => { resolveEnd = resolve; });
  const record = { version: toolVersion, seed: Number(seed), mode, difficulty, fa: null };
  const m = new MatchClass({ roomCode: 'MANUAL', mode, difficulty, seed: Number(seed), version: toolVersion,
    data, scheduler: scheduler || (mode === 'solo' ? new VirtualScheduler() : new RealScheduler()),
    // Use the existing unlimited option for historical solo too. Never set it for co-op.
    soloUnlimited: mode === 'solo',
    seats: Array.from({ length: count }, (_, seat) => ({ seat, playerId: `manual_${seat}`, name: `Seat ${seat}`, isBot: true, connected: true })),
    botStrategy: 'legacy', botStrategySeats: Object.fromEntries(selected.map(s => [s, 'external'])),
    externalAI: { transport: 'stdio', command: [process.execPath, fileURLToPath(new URL('./manual-agent.mjs', import.meta.url)), '--dir', root, '--mode', mode],
      mode: 'direct', knowledge: true, manualWait: true, timeoutMs: 300000, maxIntents: 256 },
    send: () => true, broadcast: () => {}, onEnd: result => { summary = result; resolveEnd(); },
    log: { info() {}, debug() {}, warn: s => console.error(s), error: s => console.error(s) },
  });
  // Record an ended decision immediately. §37.30: the built-in bot never plays a manual seat; an expired window is left
  // to the phase timer (as for a human) and a broken reply is followed by a new observation while the window lasts.
  const fail = m.externalAI.fail.bind(m.externalAI);
  m.externalAI.fail = (job, reason = 'error') => {
    const file = path.join(seatDir(root, mode, job.ps.seat), 'status.json');
    if (m.externalAI.jobs.get(job.id) === job && existsSync(file)) {
      const status = readJSON(file);
      if (status.id === job.id) writeJSON(file, { ...status, state: reason === 'timeout' ? 'expired' : 'error',
        error: reason === 'timeout' ? 'timeout; the phase timer decides as for a human' : `${reason}; a new observation follows while the window lasts` });
    }
    return fail(job, reason);
  };
  const snapshot = traceLayers(m, record);
  for (const key of ['settle', '_finishFinal']) {
    const base = m[key].bind(m);
    m[key] = (...args) => { const out = base(...args); snapshotPhase(); return out; };
  }
  function snapshotPhase() {
    snapshot();
    if (m.round === m.gd.bossRound && m.bossPool) record.fa = { pool: m.bossPool.maxHp, remaining: m.bossPool.hp,
      damageBySeat: Object.fromEntries(m.order.map(p => [p.seat, Math.round(p.stats.bossDamage)])) };
  }
  const stop = () => { m.dispose(); resolveEnd(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // RealScheduler's timers are unref'ed, but an interactive launcher must stay alive between requests.
  const liveStatus = () => writeJSON(path.join(root, 'match.json'), { round: m.round, phase: m.phase,
    deadline: m.deadline, players: m.order.map(p => ({ seat: p.seat, lp: p.lp, alive: p.alive,
      disabled: m.externalAI.states.get(p.playerId)?.disabled || false })) });
  const keepAlive = setInterval(liveStatus, 1000);
  try {
    m.start();
    liveStatus();
    if (m.sched.virtual) await runMatch(m, () => m.disposed || !!summary);
    else await ended;
    if (!summary) throw new Error('Manual match interrupted before result');
    snapshotPhase();
    liveStatus();
    // §37.32 each seat's last battle (the Final Assault too) for the result page, named like the observation's report
    const label = id => (m.gd.chess(id) || m.gd.token(id) || m.gd.enemy(id))?.name || id;
    const lastBattle = Object.fromEntries(m.order.map(p => {
      const b = m.externalAI.battleFor(p);
      return [p.seat, b && { ...b, leaks: b.leaks.map(l => ({ ...l, name: label(l.enemyKey) })), units: b.units.map(u => ({ ...u, name: label(u.id) })) }];
    }));
    Object.assign(record, { summary, round: m.round, external: m.externalAI.metrics, lastBattle, finalFeedback: Object.fromEntries(m.order.map(p => [p.seat, m.externalAI.states.get(p.playerId)?.results || []])) });
    const names = Object.fromEntries(m.gd.bondIds.map(id => [id, m.gd.bond(id).name]));
    for (const seat of selected) {
      const folder = seatDir(root, mode, seat);
      writeJSON(path.join(folder, 'result.json'), record);
      publish(path.join(folder, 'result.md'), resultMarkdown(record, seat, names));
      writeJSON(path.join(folder, 'status.json'), { state: 'finished', seat, round: m.round, phase: 'RESULT', obs: path.join(folder, 'result.md') });
      console.log(`Result seat ${seat}: ${path.join(folder, 'result.md')}`);
    }
    if (m.errorCount || m.sched.errors?.length) throw new Error('Match reported errors; inspect the launcher log');
    return record;
  } catch (e) {
    for (const seat of selected) {
      const folder = seatDir(root, mode, seat), file = path.join(folder, 'status.json');
      const old = existsSync(file) ? readJSON(file) : {};
      writeJSON(file, { ...old, state: 'stopped', error: e.message });
    }
    throw e;
  } finally {
    clearInterval(keepAlive); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); m.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['dir', 'mode', 'difficulty', 'seed', 'seats', 'version'].map(k => [k, { type: 'string' }])) });
    await manualMatch(values);
  } catch (e) { console.error(`manual-match: ${e.message}`); process.exitCode = 1; }
}
