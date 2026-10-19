// Tool-only instrumentation, preloaded into room children by measure-room-processes.mjs.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Match } from '../../server/match/Match.js';
import { getData } from '../../server/data.js';

const histogram = monitorEventLoopDelay({ resolution: 1 });
let matches = [], completed = 0, errors = [];
let cpuStart, wallStart, loopStart;

export function resetDelay() {
  histogram.enable(); histogram.reset();
  cpuStart = process.cpuUsage(); wallStart = performance.now(); loopStart = performance.eventLoopUtilization();
}
export function readDelay() {
  const result = { p50Ms: histogram.percentile(50) / 1e6, p99Ms: histogram.percentile(99) / 1e6,
    maxMs: histogram.max / 1e6, samples: histogram.count,
    cpuCoreEquivalents: Object.values(process.cpuUsage(cpuStart)).reduce((a, b) => a + b, 0) / ((performance.now() - wallStart) * 1000),
    eventLoopUtilization: performance.eventLoopUtilization(loopStart).utilization };
  histogram.disable();
  return result;
}
export function startHeavy(count) {
  const data = getData();
  const create = (index) => {
    const match = new Match({ roomCode: `LOAD${index}`, mode: 'coop', difficulty: 'HARD', seed: 7000 + index,
      data, seats: Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `ai_${index}_${seat}`,
        name: `AI${seat}`, isBot: true, connected: true })),
      clientCombat: true, verify: 'off', botRehearsal: 8, botSliceMs: 10, headlessSliceMs: 10, timerScale: 0.05,
      botRehearsalDelegate: false, botStrategy: 'legacy',
      send: () => true, broadcast() {},
      log: { info() {}, debug() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
      onEnd() { completed++; },
    });
    matches.push(match);
    match.start();
  };
  for (let i = 0; i < count; i++) create(i);
  return { count, seatsPerMatch: 4, difficulty: 'HARD', botRehearsal: 8, sliceMs: 10, phaseTimerScale: 0.05,
    combat: 'headless bot fields with explicit 10 ms slices' };
}
export function loadStats() {
  return { completed, errors, matches: matches.map((m) => ({ round: m.round, phase: m.phase,
    errors: m.errorCount, simErrors: m.simErrors, fields: m.fields.length })) };
}
export function stopHeavy() {
  const result = loadStats();
  for (const m of matches) m.dispose();
  matches = []; completed = 0; errors = [];
  histogram.disable();
  return result;
}

if (process.env.SP_ROOM_LOAD_PROBE === '1' && /[/\\]rooms[/\\]entry\.js$/.test(process.argv[1] || '')) {
  process.on('message', async (message) => {
    if (message?.type !== 'measure.roomLoad') return;
    let value, error;
    try {
      if (message.action === 'start') value = startHeavy(message.count);
      else if (message.action === 'reset') { resetDelay(); value = true; }
      else if (message.action === 'read') value = { delay: readDelay(), load: loadStats() };
      else if (message.action === 'load') value = loadStats();
      else if (message.action === 'stop') value = stopHeavy();
      else throw new Error('unknown load probe action');
    } catch (caught) { error = caught.message; }
    process.send?.({ type: 'measure.roomLoad.reply', id: message.id, value, error });
  });
  process.on('disconnect', stopHeavy);
}
