#!/usr/bin/env node
// tools/botbench.mjs — measure the AI player (server/match/bot.js): seeded bot-only matches (virtual time, the real
// simulation, the match's default layout rehearsal) with the bot's outcomes, its economy and its decision time.
//
// Usage:
//   node tools/botbench.mjs [--configs solo:FUNNY,solo:HARD,coop4:FUNNY,coop4:HARD] [--seeds N] [--seed S]
//                           [--rehearsal N] [--json out.json] [--quiet]
//   node tools/botbench.mjs --compare old.json new.json      A/B tables (markdown) of two --json runs
//   --configs   comma list of <solo|coopN>:<FUNNY|NORMAL|HARD|ABYSS> (coopN = N bot seats, 1–4)
//   --seeds N   matches per config (seeds S..S+N−1, default 10)
//   --rehearsal layouts each bot rehearses per prep (default: the Match default)
//   --json F    write the raw per-match records to F (the input of --compare)
//   --jobs N    run the matches in N worker threads (outcomes are identical; the timings are then inflated by the
//               parallel load — measure decision time with --jobs 1)
//   --band ID   solo configs only: the bot plays strategy ID (e.g. band_cannot) instead of its weighted pick — a band's
//               mechanic in isolation (坎诺特 banking, 杜宾's 教鞭, 昆图斯's 突变细胞)
//
// Per match: victory, rounds passed, LP left (the alive players at the end; a won Final Assault: the team LP), and per
// bot and round: LP, shop level, deployed units, active bonds and Σ bond tiers, activated layers, board value (Σ shop
// price of the deployed chess, an elite = goldenCopies copies), elites deployed, items equipped, funds lost at the prep
// end (leftover funds are lost, PlayerState.endPrep), leaks (bounty leaks apart) and the bounty cards taken — with the
// bot's own kill-chance estimate when the bot has one (bot.bountyKillChance) for a calibration table, and the best
// estimate among the draft's cards (was a likelier card on offer?).
// Decision time: every bot prep runs in one scheduler callback in virtual time (Match.scheduleBotPrep); the tool times
// those callbacks (Match.later on the instance; wall clock and process CPU time) and splits off the rehearsal battles'
// stepping (Battle.step of the rehearsal fields 'r:<pid>') — "heuristics" = the prep minus the rehearsal. A 机变 pick is
// the SP_DRAFT callback in which a bot's pick landed. Wall-clock numbers depend on the host load: compare runs made
// back to back with --jobs 1.

import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Match } from '../server/match/Match.js';
import * as bot from '../server/match/bot.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { getData } from '../server/data.js';

const argv = isMainThread ? process.argv.slice(2) : workerData.argv;
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  opt[k] = v;
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

if (opt.compare) {
  const files = [opt.compare, ...argv.filter((a) => !a.startsWith('--') && a !== opt.compare)];
  compare(files.map((f) => JSON.parse(readFileSync(f, 'utf8'))), files.map((f) => f.replace(/^.*\//, '').replace(/\.json$/, '')));
  process.exit(0);
}

const data = getData({ log: { warn() {}, error() {}, info() {} } });
const configs = String(opt.configs || 'solo:FUNNY,solo:HARD,coop4:FUNNY,coop4:HARD').split(',').map((s) => {
  const [m, d] = s.split(':');
  const solo = m === 'solo';
  return { name: s, mode: solo ? 'solo' : 'coop', players: solo ? 1 : Math.max(1, Math.min(4, Number(m.replace('coop', '')) || 4)), difficulty: String(d || 'NORMAL').toUpperCase() };
});
const seeds = Math.max(1, Number(opt.seeds) || 10);
const seed0 = Number(opt.seed) || 1;
const rehearsal = opt.rehearsal != null && opt.rehearsal !== true ? Math.max(0, Math.floor(Number(opt.rehearsal) || 0)) : undefined;

function runOne(cfg, seed) {
  const sched = new VirtualScheduler();
  const seats = [];
  for (let i = 0; i < cfg.players; i++) seats.push({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true });
  let summary = null;
  const errors = [];
  const log = { info() {}, debug() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) };
  const m = new Match({
    roomCode: 'BENCH', mode: cfg.mode, difficulty: cfg.difficulty, seats, seed, data, log, scheduler: sched, botRehearsal: rehearsal,
    send: () => true, broadcast: () => {}, onEnd: (s) => { summary = s; },
  });
  // --band: the only strategy on offer (botPickBand draws from gd.bandIds()) — also one built around a bond the mode
  // switches off, which botPickBand would otherwise skip for the default band (DESIGN §21.26)
  if (opt.band && cfg.mode === 'solo') { m.gd.bandIds = () => [String(opt.band)]; m.gd.bandBondIds = () => []; }
  const rec = { config: cfg.name, seed, stageId: m.stageId, bossId: m.bossId, preps: [], picks: [], rounds: [], bounties: [] };
  // rehearsal stepping time (Battle.step of the rehearsal fields)
  let rehMs = 0;
  const newBattle = m.newBattle.bind(m);
  m.newBattle = (o) => {
    const b = newBattle(o);
    if (o && typeof o.fieldId === 'string' && o.fieldId.startsWith('r:') && typeof b.step === 'function') {
      const step = b.step.bind(b);
      b.step = () => { const t0 = performance.now(); try { return step(); } finally { rehMs += performance.now() - t0; } };
    }
    return b;
  };
  // every scheduler callback timed; a callback during which a bot became ready in PREP was that bot's prep
  const later = m.later.bind(m);
  let calMs = 0; // the tool's own calibration work inside a callback (subtracted)
  m.later = (ms, fn) => later(ms, () => {
    const before = new Map([...m.players.values()].map((p) => [p.playerId, p.ready]));
    const picked = m.sp ? Object.keys(m.sp.picks).length : 0;
    const phase = m.phase;
    const round = m.round;
    const r0 = rehMs;
    const c0 = calMs;
    const u0 = process.cpuUsage();
    const t0 = performance.now();
    fn();
    const wall = performance.now() - t0;
    const u = process.cpuUsage(u0);
    const dt = wall - (calMs - c0);
    // CPU time of the callback (less sensitive to the host load than wall clock; the rehearsal's share by wall ratio)
    const cpu = Math.max(0, (u.user + u.system) / 1000 - (calMs - c0));
    if (phase === 'SP_DRAFT' && m.sp && Object.keys(m.sp.picks).length > picked) rec.picks.push({ round, ms: dt });
    if (phase !== 'PREP') return;
    for (const p of m.players.values()) {
      if (p.isBot && before.get(p.playerId) === false && p.ready) rec.preps.push({ round, pid: p.playerId, ms: dt, rehMs: rehMs - r0, cpu, rehCpu: dt > 0 ? cpu * ((rehMs - r0) / dt) : 0 });
    }
  });
  // 机变 picks (cheap, timed per call) and bounties taken
  const apply = m._applyCard.bind(m);
  m._applyCard = (ps, idx) => {
    const card = m.sp && m.sp.cards[idx];
    if (card && card.kind === 'bounty') {
      // the bot's own kill-chance estimate (when this bot version has one), for the calibration table
      const c0 = performance.now();
      const p = typeof bot.bountyKillChance === 'function' ? bot.bountyKillChance(m, ps, card) : null;
      // the best estimate among the draft's bounty cards still untaken (was a likelier one on offer?)
      const best = p == null ? null : Math.max(p, ...m.sp.cards.filter((c) => c && c.kind === 'bounty' && m.sp.taken[c.idx] == null).map((c) => bot.bountyKillChance(m, ps, c)));
      calMs += performance.now() - c0;
      rec.bounties.push({ round: m.round, pid: ps.playerId, enemyKey: card.enemyKey, count: card.count, tier: card.tier, payout: card.payout, battles: card.rounds, p, best });
    }
    return apply(ps, idx);
  };
  // funds a player still holds when the prep ends (lost unless its band keeps them)
  const lost = {};
  for (const ps of m.players.values()) {
    const endPrep = ps.endPrep.bind(ps);
    ps.endPrep = () => { (lost[m.round] ||= {})[ps.playerId] = m.gd.leftoverKeptBands.includes(ps.bandId) ? 0 : ps.funds; return endPrep(); };
  }
  let last = '';
  const t0 = performance.now();
  m.start();
  sched.runUntil(() => {
    const key = `${m.phase}:${m.round}`;
    if (key !== last) {
      last = key;
      if (m.phase === 'SETTLE' || (m.phase === 'RESULT' && (m.round === m.gd.bossRound || m.round === m.gd.hiddenRound))) {
        const row = { round: m.round, players: {} };
        for (const ps of m.order) {
          const r = m.lastResults.get(ps.playerId);
          let value = 0;
          let elites = 0;
          for (const p of ps.board.values()) {
            if (p.kind !== 'chess') continue;
            const golden = m.gd.isGolden(p.id);
            if (golden) elites++;
            value += m.gd.chessPrice(m.gd.baseIdOf(p.id)) * (golden ? m.gd.goldenCopies : 1);
          }
          const active = Object.values(ps.bonds).filter((b) => b.active);
          const leaked = r ? (r.leaked || []).filter((l) => l.counted !== false) : [];
          row.players[ps.playerId] = {
            lp: ps.lp, alive: ps.alive, level: ps.shop.level, units: ps.deployCount, bonds: active.length,
            tiers: active.reduce((s, b) => s + (b.tier || 0), 0), layers: ps.activatedLayers(), value, elites,
            items: [...ps.board.values()].reduce((s, p) => s + (p.kind === 'chess' ? (p.items || []).length : 0), 0),
            lost: lost[m.round] ? lost[m.round][ps.playerId] ?? null : null,
            killed: r ? r.killed : null, total: r ? r.total : null,
            leaks: leaked.length, bountyLeaks: leaked.filter((l) => l.tag === 'bounty').length,
            bountyKeys: leaked.filter((l) => l.tag === 'bounty').map((l) => l.enemyKey),
          };
        }
        if (m.teamLp != null) row.teamLp = m.teamLp;
        rec.rounds.push(row);
      }
    }
    return summary != null;
  }, { maxSteps: 5e6 });
  rec.ms = performance.now() - t0;
  rec.errors = errors.length + m.errorCount;
  // Keep diagnostics in the JSON so a nonzero benchmark count is actionable.
  if (errors.length) rec.errorMessages = errors;
  if (m.errors.length) rec.matchErrors = m.errors;
  rec.victory = !!(summary && summary.victory);
  rec.roundsPassed = summary ? summary.roundsPassed : 0;
  rec.hidden = !!(summary && summary.hiddenReached);
  rec.bossRound = m.gd.bossRound;
  const alive = m.order.filter((p) => p.alive);
  rec.lpLeft = rec.victory && m.teamLp != null ? m.teamLp : alive.reduce((s, p) => s + Math.max(0, p.lpAtFinal ?? p.lp), 0);
  rec.players = (summary && summary.players ? summary.players : []).map((p) => ({ pid: p.playerId, band: p.bandId, rounds: p.roundsPassed, merges: p.stats.merges, spent: p.stats.gold }));
  m.dispose();
  return rec;
}

const tasks = [];
for (const cfg of configs) for (let i = 0; i < seeds; i++) tasks.push([cfg, seed0 + i]);
const jobs = Math.max(1, Math.min(16, Number(opt.jobs) || 1));
if (!isMainThread) {
  for (const i of workerData.indexes) parentPort.postMessage({ i, rec: runOne(...tasks[i]) });
} else {
  const all = new Array(tasks.length);
  const note = (r) => { if (!opt.quiet) process.stderr.write(`${r.config} seed ${r.seed}: ${r.victory ? 'WIN ' : 'loss'} rounds ${r.roundsPassed} lp ${r.lpLeft} · ${Math.round(r.ms)} ms\n`); };
  if (jobs === 1) {
    tasks.forEach((t, i) => { all[i] = runOne(...t); note(all[i]); });
  } else {
    await Promise.all(Array.from({ length: jobs }, (_, j) => new Promise((resolve, reject) => {
      const indexes = tasks.map((_, i) => i).filter((i) => i % jobs === j);
      const w = new Worker(new URL(import.meta.url), { workerData: { argv, indexes } });
      w.on('message', ({ i, rec }) => { all[i] = rec; note(rec); });
      w.on('error', reject);
      w.on('exit', resolve);
    })));
  }
  if (opt.json) writeFileSync(opt.json, JSON.stringify(all));
  compare([all], ['run']);
}

// ---- tables ---------------------------------------------------------------------------------------------------
function stats(records) {
  const preps = records.flatMap((r) => r.preps);
  const heur = preps.map((p) => p.ms - p.rehMs);
  const rounds = records.flatMap((r) => r.rounds.flatMap((row) => Object.values(row.players).filter((p) => p.alive || p.leaks != null).map((p) => ({ ...p, round: row.round }))));
  const at = (rd, f) => avg(rounds.filter((p) => p.round === rd && p.alive).map(f));
  const lostPerPrep = rounds.filter((p) => p.lost != null).map((p) => p.lost);
  const merges = records.flatMap((r) => r.players.map((p) => p.merges));
  const bountyLeaks = records.reduce((s, r) => s + r.rounds.reduce((t, row) => t + Object.values(row.players).reduce((u, p) => u + (p.bountyLeaks || 0), 0), 0), 0);
  const leaksAll = records.reduce((s, r) => s + r.rounds.reduce((t, row) => t + Object.values(row.players).reduce((u, p) => u + (p.leaks || 0), 0), 0), 0);
  return {
    n: records.length,
    wins: records.filter((r) => r.victory).length,
    rounds: avg(records.map((r) => r.roundsPassed)),
    lpLeft: avg(records.map((r) => r.lpLeft)),
    // alive when the Final Assault began: rounds passed ≥ boss round − 1 (results.js: a lost Final Assault = bossRound − 1)
    reachedBoss: records.filter((r) => r.roundsPassed >= r.bossRound - 1).length,
    hidden: records.filter((r) => r.hidden).length,
    lost: avg(lostPerPrep),
    merges: avg(merges),
    leaks: leaksAll / Math.max(1, records.length),
    bounties: records.reduce((s, r) => s + r.bounties.length, 0),
    bountyLeaks,
    errors: records.reduce((s, r) => s + r.errors, 0),
    value: [4, 7, 10, 13].map((rd) => at(rd, (p) => p.value)),
    tiers: [4, 7, 10, 13].map((rd) => at(rd, (p) => p.tiers)),
    layers: [4, 7, 10, 13].map((rd) => at(rd, (p) => p.layers)),
    elites: [4, 7, 10, 13].map((rd) => at(rd, (p) => p.elites)),
    level: [4, 7, 10, 13].map((rd) => at(rd, (p) => p.level)),
    prepN: preps.length,
    prepP50: pct(preps.map((p) => p.ms), 50), prepP95: pct(preps.map((p) => p.ms), 95),
    // the same rounds for both bots: R1–R10 (a stronger bot plays more of the expensive late rounds)
    early: (() => { const e = preps.filter((p) => p.round <= 10); return { n: e.length, p50: pct(e.map((p) => p.ms), 50), p95: pct(e.map((p) => p.ms), 95), h50: pct(e.map((p) => p.ms - p.rehMs), 50), h95: pct(e.map((p) => p.ms - p.rehMs), 95) }; })(),
    cpuP50: pct(preps.map((p) => p.cpu ?? 0), 50), cpuP95: pct(preps.map((p) => p.cpu ?? 0), 95),
    hcpuP50: pct(preps.map((p) => (p.cpu ?? 0) - (p.rehCpu ?? 0)), 50), hcpuP95: pct(preps.map((p) => (p.cpu ?? 0) - (p.rehCpu ?? 0)), 95),
    cpuSum: preps.reduce((a, p) => a + (p.cpu ?? 0), 0), hcpuSum: preps.reduce((a, p) => a + (p.cpu ?? 0) - (p.rehCpu ?? 0), 0),
    pickP50: pct(records.flatMap((r) => r.picks.map((x) => x.ms)), 50), pickP95: pct(records.flatMap((r) => r.picks.map((x) => x.ms)), 95),
    pickN: records.reduce((n, r) => n + r.picks.length, 0),
    heurP50: pct(heur, 50), heurP95: pct(heur, 95),
    rehP50: pct(preps.map((p) => p.rehMs), 50), rehP95: pct(preps.map((p) => p.rehMs), 95),
    ms: records.reduce((s, r) => s + r.ms, 0),
  };
}

function compare(runs, names) {
  const cfgs = [...new Set(runs.flatMap((rs) => rs.map((r) => r.config)))];
  const f1 = (x) => x.toFixed(1);
  const f2 = (x) => x.toFixed(2);
  const four = (a, f = f1) => a.map(f).join(' / ');
  console.log('\n| config | run | matches | wins | rounds passed | LP left | reached boss | leaks/match | bounties (leaked) | funds lost/prep | merges/bot | errors |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of cfgs) runs.forEach((rs, i) => {
    const s = stats(rs.filter((r) => r.config === c));
    if (!s.n) return;
    console.log(`| ${c} | ${names[i]} | ${s.n} | ${s.wins} (${Math.round((100 * s.wins) / s.n)} %) | ${f2(s.rounds)} | ${f1(s.lpLeft)} | ${s.reachedBoss} | ${f1(s.leaks)} | ${s.bounties} (${s.bountyLeaks}) | ${f2(s.lost)} | ${f2(s.merges)} | ${s.errors} |`);
  });
  console.log('\n| config | run | shop level R4/7/10/13 | board value R4/7/10/13 | Σ bond tiers | activated layers | elites deployed |');
  console.log('|---|---|---|---|---|---|---|');
  for (const c of cfgs) runs.forEach((rs, i) => {
    const s = stats(rs.filter((r) => r.config === c));
    if (!s.n) return;
    console.log(`| ${c} | ${names[i]} | ${four(s.level)} | ${four(s.value)} | ${four(s.tiers)} | ${four(s.layers, (x) => x.toFixed(0))} | ${four(s.elites)} |`);
  });
  console.log('\n| config | run | leaks per alive bot and round R1…R15 |');
  console.log('|---|---|---|');
  for (const c of cfgs) runs.forEach((rs, i) => {
    const recs = rs.filter((r) => r.config === c);
    if (!recs.length) return;
    const cells = [];
    for (let rd = 1; rd <= 15; rd++) {
      const v = recs.flatMap((r) => r.rounds.filter((row) => row.round === rd).flatMap((row) => Object.values(row.players).filter((p) => p.leaks != null && p.total != null)));
      if (v.length) cells.push(`${rd}:${avg(v.map((p) => p.leaks)).toFixed(1)}`);
    }
    console.log(`| ${c} | ${names[i]} | ${cells.join(' ')} |`);
  });
  const calib = runs.map((rs) => {
    const bins = [[0, 0.2], [0.2, 0.5], [0.5, 0.8], [0.8, 0.95], [0.95, 1.01]].map(([lo, hi]) => ({ lo, hi, n: 0, units: 0, leaked: 0 }));
    for (const r of rs) for (const b of r.bounties) {
      if (b.p == null) continue;
      const bin = bins.find((x) => b.p >= x.lo && b.p < x.hi);
      const battles = Math.max(1, Math.min(2, b.battles || 1));
      let leaked = 0;
      for (const row of r.rounds) if (row.round >= b.round && row.round < b.round + battles) leaked += ((row.players[b.pid] || {}).bountyKeys || []).filter((k) => k === b.enemyKey).length;
      bin.n++; bin.units += (b.count || 1) * battles; bin.leaked += leaked;
    }
    return bins;
  });
  if (calib.some((bins) => bins.some((b) => b.n))) {
    console.log('\n| run | bounty kill-chance estimate (bot.bountyKillChance) → share of bounty enemies actually killed, picks per bin |');
    console.log('|---|---|');
    runs.forEach((rs, i) => { if (calib[i].some((b) => b.n)) console.log(`| ${names[i]} | ${calib[i].filter((b) => b.n).map((b) => `p ${b.lo}–${Math.min(1, b.hi)}: ${(100 * (1 - b.leaked / Math.max(1, b.units))).toFixed(0)} % (${b.n})`).join(' · ')} |`); });
    // the picks against what the draft offered (records with `best`)
    console.log('\n| config | run | bounty picks | p < 0.5 picked while a p ≥ 0.5 card was offered | drafts with no card p ≥ 0.5 |');
    console.log('|---|---|---|---|---|');
    for (const c of cfgs) runs.forEach((rs, i) => {
      const b = rs.filter((r) => r.config === c).flatMap((r) => r.bounties).filter((x) => x.best != null);
      if (b.length) console.log(`| ${c} | ${names[i]} | ${b.length} | ${b.filter((x) => x.p < 0.5 && x.best >= 0.5).length} | ${b.filter((x) => x.best < 0.5).length} |`);
    });
  }
  console.log('\n| config | run | bot preps | prep CPU ms p50 / p95 | heuristics CPU ms p50 / p95 | Σ prep CPU s | Σ heuristics CPU s | per match: prep CPU s |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const c of cfgs) runs.forEach((rs, i) => {
    const s = stats(rs.filter((r) => r.config === c));
    if (!s.n) return;
    console.log(`| ${c} | ${names[i]} | ${s.prepN} | ${f1(s.cpuP50)} / ${f1(s.cpuP95)} | ${f1(s.hcpuP50)} / ${f1(s.hcpuP95)} | ${f1(s.cpuSum / 1000)} | ${f1(s.hcpuSum / 1000)} | ${f2(s.cpuSum / 1000 / s.n)} |`);
  });
  console.log('\n| config | run | bot preps | prep ms p50 / p95 | heuristics ms p50 / p95 | rehearsal ms p50 / p95 | R1–R10 preps: prep / heuristics p50 / p95 | 机变 pick ms p50 / p95 (n) | match wall s |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const c of cfgs) runs.forEach((rs, i) => {
    const s = stats(rs.filter((r) => r.config === c));
    if (!s.n) return;
    const e = s.early;
    console.log(`| ${c} | ${names[i]} | ${s.prepN} | ${f1(s.prepP50)} / ${f1(s.prepP95)} | ${f1(s.heurP50)} / ${f1(s.heurP95)} | ${f1(s.rehP50)} / ${f1(s.rehP95)} | ${e.n}: ${f1(e.p50)} / ${f1(e.p95)} · ${f1(e.h50)} / ${f1(e.h95)} | ${f2(s.pickP50)} / ${f2(s.pickP95)} (${s.pickN}) | ${f1(s.ms / 1000)} |`);
  });
}
