#!/usr/bin/env node
// tools/matchrun.mjs — run whole bot matches headlessly (virtual time, real simulation) and print a per-round
// balancing summary: LP over time, shop level, deployed units, kills/leaks, 联防, Final Assault outcome.
//
// Usage:
//   node tools/matchrun.mjs [--mode solo|coop] [--difficulty FUNNY|NORMAL|HARD|ABYSS|ALL] [--players 1..4] [--seed 1]
//                           [--seeds N] [--lp N] [--humans N] [--content full|generic|none] [--check] [--errors]
//                           [--odds] [--json] [--quiet] [--rehearsal N] [--bot ID]
//   --players   co-op seats (default 2; solo is always 1)
//   --humans N  the first N seats are human seats on "AI 托管" (exercises the human views / m.private paths)
//   --seeds N   run N consecutive seeds and print an aggregate (rounds survived, LP by round, outcomes)
//   --lp N      override every player's starting LP (reach later rounds / the Final Assault while balancing)
//   --layers N  at the boss round's prep, add N layers to every bond of every player (reach the Hidden Core); a raw
//               write (no onLayers milestones) that stops at BOND_LAYER_CAP (999, shared/constants.js) like every gain
//   --difficulty ALL  sweep all four difficulties
//   --content   sim content mode (default full)
//   --rehearsal N  layouts each bot rehearses per prep with the real sim (default: the Match default, 3; 0 = off,
//               faster sweeps with the heuristic placement only)
//   --check     audit every match: engine invariants at every phase change + rule checks (server/match/audit.js:
//               income, upgrade price, freeze, shop odds/bans, temp overflow lifetime (no piece outlives the prep it is
//               due at), drafts, 联防 helpers, settle LP, final assault pairing/pool, hidden core, titles, deadlines).
//               Exit code 1 when anything is violated.
//   --errors    per-source error summary over all runs: sim/content errors grouped by content module + handler label
//               (+ unit) with occurrence and battle counts, meta handler errors by registry key, match engine errors
//   --odds      shop tier distribution of rolled chess slots per shop level (all runs)
//   --json      print machine-readable results
//   --tuning off     play on the research-faithful numbers (data/tuning.json ignored; docs/BALANCE.md)
//   --legacy-time    read combat limits as game seconds (the reading before docs/BALANCE.md §2.1)
// Examples:
//   node tools/matchrun.mjs --mode solo --difficulty FUNNY --seed 3
//   node tools/matchrun.mjs --mode coop --difficulty HARD --players 4 --seeds 20
//   node tools/matchrun.mjs --mode coop --difficulty ALL --players 4 --humans 2 --seeds 10 --check --errors

import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { attachAudit } from '../server/match/audit.js';
import { Battle } from '../server/sim/Battle.js';
import { getData } from '../server/data.js';
import { layerGainRoom } from '../shared/constants.js';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  opt[k] = v;
}
if (opt.help) {
  console.log(Buffer.from(await (await import('node:fs')).promises.readFile(new URL(import.meta.url))).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

const DIFFS = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
const mode = opt.mode === 'solo' ? 'solo' : 'coop';
const diffArg = String(opt.difficulty || 'NORMAL').toUpperCase();
const difficulties = diffArg === 'ALL' ? DIFFS : [DIFFS.includes(diffArg) ? diffArg : 'NORMAL'];
const players = mode === 'solo' ? 1 : Math.max(1, Math.min(4, Number(opt.players) || 2));
const humans = mode === 'solo' ? (opt.humans != null ? 1 : 0) : Math.max(0, Math.min(players, Number(opt.humans) || 0));
const seed0 = Number(opt.seed) || 1;
const seeds = Math.max(1, Number(opt.seeds) || 1);
const lpOverride = Number(opt.lp) > 0 ? Number(opt.lp) : null;
const layerBoost = Number(opt.layers) > 0 ? Math.floor(Number(opt.layers)) : null;
const quiet = !!opt.quiet || seeds > 1 || difficulties.length > 1;
const rehearsal = opt.rehearsal != null && opt.rehearsal !== true ? Math.max(0, Math.floor(Number(opt.rehearsal) || 0)) : undefined;
let data = getData({ log: { warn() {}, error() {}, info() {} } });
if (opt.tuning === 'off') { const { tuning, ...rest } = data; void tuning; data = Object.freeze(rest); }
if (opt['legacy-time']) data = Object.freeze({ ...data, config: { ...data.config, combatTimeScale: 1 } });

// ---- error collection (--errors) ------------------------------------------------------------------------------
// Battle errors are logged once per unique key inside the sim; to count every occurrence the tool runs a Battle
// subclass that observes the sim's error sink. If that internal hook ever disappears the summary falls back to the
// unique records each match collects in m.simErrorLog.
const simErrors = new Map();
let current = { seed: 0, difficulty: '', battle: 0 };
const moduleOf = (stack) => {
  const lines = String(stack || '').split('\n').slice(1);
  const pick = (re) => { for (const l of lines) { const mm = re.exec(l); if (mm) return mm[1]; } return null; };
  return pick(/server\/sim\/(content\/[^\s):]+:\d+)/) || pick(/server\/(sim\/[^\s):]+:\d+)/) || pick(/server\/(match\/[^\s):]+:\d+)/) || '?';
};
function noteSimError(label, who, message, stack, n = 1, battleKey = null) {
  const src = moduleOf(stack);
  const key = `${src}|${label}|${who}|${message}`;
  let r = simErrors.get(key);
  if (!r) { r = { src, label, who, message, count: 0, battles: new Set(), seeds: new Set() }; simErrors.set(key, r); }
  r.count += n;
  r.battles.add(battleKey ?? `${current.difficulty}:${current.seed}:${current.battle}`);
  r.seeds.add(`${current.difficulty[0] || ''}${current.seed}`);
}
const canCount = typeof Battle.prototype._handlerError === 'function';
class CountingBattle extends Battle {
  constructor(o) { current.battle++; super(o); }
  _handlerError(label, owner, e, internal) {
    try {
      const who = owner && owner.defId ? owner.defId : (owner && owner.name) || '';
      noteSimError(String(label), String(who), String(e && e.message), e && e.stack);
    } catch { /* diagnostics only */ }
    return super._handlerError(label, owner, e, internal);
  }
}

// ---- one match ------------------------------------------------------------------------------------------------
function runOne(seed, difficulty) {
  current = { seed, difficulty, battle: 0 };
  const sched = new VirtualScheduler();
  const errors = [];
  const log = { info() {}, debug() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) };
  const seats = [];
  for (let i = 0; i < players; i++) {
    const human = i < humans;
    seats.push({ seat: i, playerId: human ? `p_${i}` : `ai_${i}`, name: human ? `P${i + 1}` : `AI-${i + 1}`, isBot: !human, connected: true });
  }
  let summary = null;
  let frames = 0;
  const m = new Match({
    roomCode: 'RUN', mode, difficulty, seats, seed, data, log, scheduler: sched,
    battleContent: opt.content || 'full',
    botRehearsal: rehearsal,
    botStrategy: opt.bot || 'legacy',
    BattleClass: opt.errors && canCount ? CountingBattle : undefined,
    send: () => { frames++; return true; }, broadcast: () => {}, onEnd: (s) => { summary = s; },
  });
  for (const ps of m.players.values()) if (!ps.isBot) ps.autoplay = true;
  const audit = opt.check || opt.odds ? attachAudit(m, { invariants: !!opt.check }) : null;
  const rounds = [];
  let last = '';
  const t0 = Date.now();
  m.start();
  sched.runUntil(() => {
    const key = `${m.phase}:${m.round}`;
    if (key !== last) {
      last = key;
      if (lpOverride && m.phase === 'PREP' && m.round === 1) for (const ps of m.players.values()) ps.lp = lpOverride;
      if (layerBoost && m.phase === 'PREP' && m.round === m.gd.bossRound) {
        for (const ps of m.alivePlayers()) { for (const id of m.gd.bondIds) { const before = ps.layers[id] || 0; ps.layers[id] = before + layerGainRoom(before, layerBoost); } ps.recompute(); }
      }
      if (m.phase === 'SETTLE' || ((m.phase === 'RESULT') && (m.round === m.gd.bossRound || m.round === m.gd.hiddenRound))) {
        const row = { round: m.round, unite: !!m.unitePlan, players: {} };
        for (const ps of m.order) {
          const r = m.lastResults.get(ps.playerId);
          row.players[ps.playerId] = {
            lp: ps.lp, alive: ps.alive, level: ps.shop.level, units: ps.deployCount,
            killed: r ? r.killed : null, total: r ? r.total : null, leaks: r ? (r.leaked || []).filter((l) => l.counted !== false).length : null,
            bonds: Object.entries(ps.bonds).filter(([, b]) => b.active).map(([id, b]) => `${data.bonds[id]?.name ?? id}${b.tier > 1 ? b.tier : ''}`).join(' '),
          };
        }
        if (m.teamLp != null) row.teamLp = m.teamLp;
        if (m.bossPool) row.boss = { hp: Math.round(m.bossPool.hp), max: m.bossPool.maxHp };
        rounds.push(row);
      }
    }
    return summary != null;
  }, { maxSteps: 5e6 });
  if (!summary) errors.push(`match did not end (stuck in ${m.phase} R${m.round})`);
  if (opt.errors) {
    if (!canCount) for (const r of m.simErrorLog.values()) noteSimError(r.label, r.who, r.message, r.stack, r.count, `${difficulty}:${seed}`);
    for (const e of m.errors) noteSimError(`match ${e.label}`, '', e.message, e.stack || '', 1, `${difficulty}:${seed}:match`);
    for (const [k, r] of m.dispatcher.errorsByKey) {
      const i = k.indexOf(': ');
      noteSimError(`meta ${i > 0 ? k.slice(0, i) : k}`, '', i > 0 ? k.slice(i + 2) : '', r.stack, r.count, `${difficulty}:${seed}:meta`);
    }
  }
  m.dispose();
  return {
    seed, difficulty, summary, rounds, errors, matchErrors: m.errorCount, simErrors: m.simErrors, metaErrors: m.dispatcher.errors,
    ms: Date.now() - t0, stageId: m.stageId, bossId: m.bossId, frames, audit,
  };
}

// ---- run ------------------------------------------------------------------------------------------------------
const results = [];
for (const difficulty of difficulties) {
  for (let i = 0; i < seeds; i++) {
    const r = runOne(seed0 + i, difficulty);
    results.push(r);
    if (!quiet && !opt.json) {
      const s = r.summary || {};
      console.log(`== ${mode} ${difficulty} · ${players} seat(s)${humans ? ` (${humans} human on AI 托管)` : ''} · seed ${r.seed} · stage ${r.stageId} · boss ${r.bossId}`);
      for (const row of r.rounds) {
        const cells = Object.entries(row.players).map(([id, p]) => `${id.replace(/^(ai|p)_/, 'P')}:${p.alive ? `LP${String(p.lp).padStart(3)}` : ' dead '} L${p.level} u${p.units} ${p.killed != null ? `${p.killed}/${p.total}` : '-'}${p.leaks ? ` −${p.leaks}` : ''}`).join(' | ');
        const extra = [row.unite ? '联防' : '', row.teamLp != null ? `teamLP ${row.teamLp}` : '', row.boss ? `boss ${row.boss.hp}/${row.boss.max}` : ''].filter(Boolean).join(' ');
        console.log(`R${String(row.round).padStart(2)}  ${cells}${extra ? '  · ' + extra : ''}`);
      }
      console.log(`=> ${s.victory ? 'VICTORY' : 'DEFEAT'} · rounds passed ${s.roundsPassed}${s.hiddenReached ? ` · hidden ${s.hiddenCleared ? 'cleared' : 'failed'}` : ''} · reason ${s.reason} · ${r.ms} ms · match errors ${r.matchErrors} · meta errors ${r.metaErrors} · sim errors ${r.simErrors}`);
      for (const p of s.players || []) console.log(`   ${p.name}: band ${data.bands[p.bandId]?.name ?? p.bandId} · rounds ${p.roundsPassed} · title ${p.title ? p.title.name : '-'} · dmg ${p.stats.dmgDealt} · kills ${p.stats.kills} · merges ${p.stats.merges} · spent ${p.stats.gold}`);
      if (r.errors.length) console.log('   errors:', r.errors.slice(0, 5));
      if (r.audit && r.audit.violations.length) console.log(`   audit: ${r.audit.violations.length} violation(s)\n     ${r.audit.violations.slice(0, 10).join('\n     ')}`);
    }
  }
}

let exitCode = 0;
if (opt.json) {
  console.log(JSON.stringify(results.map((r) => ({
    seed: r.seed, difficulty: r.difficulty, stageId: r.stageId, bossId: r.bossId, victory: r.summary?.victory, roundsPassed: r.summary?.roundsPassed,
    reason: r.summary?.reason, rounds: r.rounds, errors: r.errors.length + r.matchErrors, simErrors: r.simErrors, metaErrors: r.metaErrors,
    violations: r.audit ? r.audit.violations : undefined,
  })), null, 1));
} else if (quiet) {
  for (const difficulty of difficulties) {
    const rs = results.filter((r) => r.difficulty === difficulty);
    const passed = rs.map((r) => r.summary?.roundsPassed ?? 0);
    const wins = rs.filter((r) => r.summary?.victory).length;
    const avg = passed.reduce((a, b) => a + b, 0) / passed.length;
    const hist = {};
    for (const p of passed) hist[p] = (hist[p] || 0) + 1;
    console.log(`${mode} ${difficulty} · ${players} seat(s)${humans ? ` (${humans} human)` : ''} · seeds ${seed0}..${seed0 + seeds - 1}`);
    console.log(`  rounds passed: avg ${avg.toFixed(2)} · min ${Math.min(...passed)} · max ${Math.max(...passed)} · wins ${wins}/${rs.length} · hidden ${rs.filter((r) => r.summary?.hiddenReached).length}`);
    console.log(`  distribution: ${Object.entries(hist).map(([k, v]) => `${k}:${v}`).join('  ')}`);
    const maxR = Math.max(...rs.map((r) => (r.rounds.length ? r.rounds[r.rounds.length - 1].round : 0)));
    const line = [];
    for (let rr = 1; rr <= maxR; rr++) {
      const lps = [];
      for (const r of rs) {
        const row = r.rounds.find((x) => x.round === rr);
        if (!row) continue;
        for (const p of Object.values(row.players)) if (p.alive) lps.push(p.lp);
      }
      if (lps.length) line.push(`R${rr}:${(lps.reduce((a, b) => a + b, 0) / lps.length).toFixed(1)}(${lps.length})`);
    }
    console.log(`  avg LP of alive players after each round: ${line.join(' ')}`);
    const errs = rs.reduce((n, r) => n + r.errors.length + r.matchErrors, 0);
    console.log(`  engine errors: ${errs} · meta errors: ${rs.reduce((n, r) => n + r.metaErrors, 0)} · sim errors: ${rs.reduce((n, r) => n + r.simErrors, 0)} · total ${rs.reduce((n, r) => n + r.ms, 0)} ms`);
  }
}

if (opt.check) {
  const bad = results.filter((r) => r.audit && r.audit.violations.length);
  const stuck = results.filter((r) => !r.summary);
  const checks = results.reduce((n, r) => n + (r.audit ? r.audit.checks : 0), 0);
  console.log(`\ncheck: ${results.length} match(es), ${checks} rule checks, ${results.reduce((n, r) => n + (r.audit ? r.audit.phases : 0), 0)} invariant passes → ${bad.length ? `${bad.length} match(es) with violations` : 'no violations'}${stuck.length ? `, ${stuck.length} stuck` : ''}`);
  for (const r of bad.slice(0, 10)) console.log(`  ${r.difficulty} seed ${r.seed}:\n    ${r.audit.violations.slice(0, 8).join('\n    ')}`);
  if (bad.length || stuck.length || results.some((r) => r.matchErrors > 0)) exitCode = 1;
}

if (opt.odds) {
  const tot = {};
  for (const r of results) for (const [lv, row] of Object.entries(r.audit?.odds || {})) for (const [t, n] of Object.entries(row)) { (tot[lv] ||= {})[t] = (tot[lv][t] || 0) + n; }
  console.log('\nshop odds (rolled chess slots per shop level → tier shares):');
  for (const lv of Object.keys(tot).sort()) {
    const n = Object.values(tot[lv]).reduce((a, b) => a + b, 0);
    console.log(`  L${lv} (${n} rolls): ${Object.keys(tot[lv]).sort().map((t) => `T${t} ${((tot[lv][t] / n) * 100).toFixed(1)}%`).join('  ')}`);
  }
}

if (opt.errors) {
  const list = [...simErrors.values()].sort((a, b) => b.count - a.count);
  const total = list.reduce((n, r) => n + r.count, 0);
  console.log(`\nerrors by source: ${total} occurrence(s), ${list.length} unique${canCount ? '' : ' (unique records only: the sim error sink was not observable)'}`);
  if (list.length) {
    console.log('   count  battles  seeds         source                              label (unit) — message');
    for (const r of list.slice(0, Number(opt.errors) > 0 ? Number(opt.errors) : 40)) {
      const seedsStr = [...r.seeds].slice(0, 4).join(',') + (r.seeds.size > 4 ? '…' : '');
      console.log(`  ${String(r.count).padStart(6)}  ${String(r.battles.size).padStart(7)}  ${seedsStr.padEnd(12)}  ${r.src.padEnd(34)}  ${r.label}${r.who ? ` (${r.who})` : ''} — ${String(r.message).slice(0, 140)}`);
    }
    const byModule = new Map();
    for (const r of list) byModule.set(r.src.replace(/:\d+$/, ''), (byModule.get(r.src.replace(/:\d+$/, '')) || 0) + r.count);
    console.log(`  by module: ${[...byModule.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  repro: node tools/matchrun.mjs --mode ${mode} --difficulty <D> --players ${players} --seed <n> --errors (seeds are listed per row, prefixed by the difficulty initial)`);
  }
}

process.exitCode = exitCode;
