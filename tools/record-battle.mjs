#!/usr/bin/env node
// tools/record-battle.mjs — run real battles headlessly with the simulation engine (server/sim, docs/SIM.md) and
// record exactly what a watching client receives, for the render demo (public/dev/render-demo.html):
//
//   { version: 1, name, title, kind, stageId, modeId, round, tick: 1/30, snapEvery: 3, duration,
//     field: <m.field payload>, frames: [ { snap: <b.snap payload>, ev: [ …b.ev tuples… ] } ], result: {…} }
//
// One frame per 3 ticks (= one b.snap, 20 Hz real at the forced 2× speed); `ev` holds the events drained at
// that point (on the wire the match sends that `b.ev` right BEFORE its `b.snap`, both stamped with the snapshot's
// game time `gt`; the demo replays them the same way). Scenarios: a normal round with a real lineup vs the real
// wave template on each of the active stages, a 联防 unite field (2 players, escaped-multi template) and a
// Final Assault boss field (2 players, shared boss pool). Late rounds (`wave: 'official'`) use the match's own wave
// generator (server/match/waves.js setupMatchWaves + buildNormalWave: the official per-round composition and counts,
// research 08 §2) and also store the round's prep preview (`preview` = m.private.nextEnemies, previewOf) for the
// enemy-pen demo (render-demo ?pen=<name>). Also writes public/dev/recordings/index.json.
//
// Usage: node tools/record-battle.mjs [--only name,name] [--out dir] [--seed n] [--max seconds]
// (`--max` caps every scenario; without it a scenario's own `max` — else 90 game s — applies, so a plain run
// reproduces the committed recordings byte for byte.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Battle } from '../server/sim/Battle.js';
import { getDefaultSource, spawnsFromTemplate } from '../server/sim/simdata.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave, previewOf } from '../server/match/waves.js';
import { createRng } from '../server/sim/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  opt[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
}
const OUT = path.resolve(ROOT, typeof opt.out === 'string' ? opt.out : 'public/dev/recordings');
const ONLY = typeof opt.only === 'string' ? new Set(opt.only.split(',')) : null;
const SEED = Number(opt.seed ?? 20260927) >>> 0;
const MAX_SECONDS = Number(opt.max ?? 90);
/** Game seconds recorded at most for scenario `sc`: `--max`, else its own `max`, else 90. */
const maxSecondsOf = (sc) => (opt.max != null ? MAX_SECONDS : Number(sc.max ?? MAX_SECONDS));

const quiet = { warn() {}, error() {}, info() {}, debug() {} };
const ds = getDefaultSource();
const data = getData({ log: quiet });
const config = data.config ?? {};

function chessByName(name, golden = false) {
  for (const id of ds.chessIds()) {
    const r = ds.rawChess(id);
    if (r && r.name === name && !r.isGolden && r.visible !== false) return golden ? (r.goldenId || id.replace(/_a$/, '_b')) : id;
  }
  throw new Error(`unknown chess ${name}`);
}

/**
 * Place a lineup on the stage's deployable tiles: melee operators on melee tiles closest to the enemy lane
 * (row 9, towards the gate), ranged operators on high ground first, then the remaining tiles.
 * `names`: ['name', 'name*' (elite)…] → PlayerBattleInput units (board coordinates).
 */
function lineup(stageId, names, uid0 = 1) {
  const st = data.stages?.[stageId] ?? ds.getStage?.(stageId);
  const dt = st?.deployTiles?.normal || { melee: [], rangedOnly: [] };
  const melee = [...dt.melee].sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  const ranged = [...(dt.rangedOnly || [])];
  const taken = new Set();
  const units = [];
  let uid = uid0;
  for (const raw of names) {
    const golden = raw.endsWith('*');
    const name = golden ? raw.slice(0, -1) : raw;
    const chessId = chessByName(name, golden);
    const rec = ds.rawChess(chessId);
    const isMelee = rec?.position === 'MELEE';
    const pool = isMelee ? melee : [...ranged, ...melee.slice().reverse()];
    const tile = pool.find(([r, c]) => !taken.has(`${r},${c}`));
    if (!tile) continue;
    taken.add(`${tile[0]},${tile[1]}`);
    units.push({ uid: uid++, kind: 'chess', chessId, row: tile[0], col: tile[1] });
  }
  return units;
}

function modsFor(modeId, round) {
  const sc = config.modes?.[modeId]?.enemyScale?.[String(round)];
  return { hpMul: sc?.hp ?? 1, atkMul: sc?.atk ?? 1, speedMul: sc?.speed ?? 1 };
}

const SCENARIOS = [
  {
    name: 'normal-m01', title: '常规作战 · 源石流发生装置 · R5', kind: 'normal', stageId: 'act2autochess_m01', modeId: 'mode_multi_normal', round: 5,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m01', ['角峰', '德克萨斯', '艾丝黛尔*', '隐现', '格雷伊', '赫默', '能天使']) }],
  },
  {
    name: 'normal-m02', title: '常规作战 · 沼泽控制 · R8', kind: 'normal', stageId: 'act2autochess_m02', modeId: 'mode_multi_hard', round: 8,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['星熊', '银灰', '斯卡蒂', '莫斯提马', '白面鸮', '寒芒克洛丝', '阿罗玛', '远牙']) }],
  },
  {
    name: 'normal-m03', title: '常规作战 · 排气格栅 · R11', kind: 'normal', stageId: 'act2autochess_m03', modeId: 'mode_multi_hard', round: 11,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m03', ['塞雷娅*', '山', '史尔特尔', '夕', '缇缇', '烛煌', '铃兰', '号角*']) }],
  },
  {
    name: 'normal-m04', title: '常规作战 · 涨潮控制 · R6', kind: 'normal', stageId: 'act2autochess_m04', modeId: 'mode_multi_normal', round: 6,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m04', ['蛇屠箱', '忍冬', '断崖', '流星', '空弦', '调香师', '初雪']) }],
  },
  {
    name: 'archet-fx', title: '空弦 · 箭矢·暴风特效', kind: 'normal', stageId: 'act2autochess_m04', modeId: 'mode_multi_normal', round: 6,
    previewOnly: true, demoSkillUid: 1, max: 36,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m04', ['空弦', '蛇屠箱', '初雪']) }],
  },
  {
    name: 'volley-snipers-fx', title: '连击 · 能天使／寒芒克洛丝／新约能天使', kind: 'normal', stageId: 'act2autochess_m02', modeId: 'mode_multi_hard', round: 8,
    previewOnly: true, demoSkillUids: [1, 2, 3], max: 45,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['能天使', '寒芒克洛丝', '新约能天使'])
      .map((u, i) => i === 2 ? { ...u, skillIndex: 2 } : u) }],
  },
  {
    name: 'angel-skills-fx', title: '连击 · 能天使一／二技能', kind: 'normal', stageId: 'act2autochess_m02', modeId: 'mode_multi_hard', round: 8,
    previewOnly: true, demoSkillUids: [1, 2], max: 35,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['能天使', '能天使'])
      .map((u, skillIndex) => ({ ...u, skillIndex })) }],
  },
  {
    name: 'volley-other-fx', title: '连击 · 送葬人／信仰搅拌机／灵知', kind: 'normal', stageId: 'act2autochess_m02', modeId: 'mode_multi_hard', round: 8,
    previewOnly: true, demoSkillUids: [1, 2, 3], max: 45,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['送葬人', '信仰搅拌机', '灵知'])
      .map((u, i) => i === 0 ? u : { ...u, skillIndex: 0 }) }],
  },
  {
    name: 'scattershot-fx', title: '散射光波 · 送葬人／松果', kind: 'normal', stageId: 'act2autochess_m02', modeId: 'mode_multi_hard', round: 8,
    previewOnly: true, demoSkillUids: [1, 2], max: 35,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['送葬人', '松果', '蛇屠箱']) }],
  },
  // late rounds with the official composition and counts (perf profiling, research 08 §2.7; 57 / 55 enemies)
  {
    name: 'late-m03-r12', title: '常规作战 · 排气格栅 · R12（官方波次）', kind: 'normal', stageId: 'act2autochess_m03', modeId: 'mode_multi_hard', round: 12,
    wave: 'official', waveSeed: 3,
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m03', ['塞雷娅*', '星熊*', '山*', '史尔特尔*', '夕*', '莫斯提马*', '铃兰*', '号角*']) }],
  },
  {
    name: 'late-m01-r13', title: '常规作战 · 源石流发生装置 · R13（官方波次）', kind: 'normal', stageId: 'act2autochess_m01', modeId: 'mode_multi_hard', round: 13,
    wave: 'official', waveSeed: 5, max: 110, // the whole round (55 real s = 110 game s)
    players: () => [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m01', ['星熊*', '银灰*', '斯卡蒂*', '莫斯提马*', '白面鸮', '寒芒克洛丝*', '阿罗玛', '远牙*']) }],
  },
  {
    name: 'unite-m01', title: '联防 · 源石流发生装置 · R9', kind: 'unite', stageId: 'act2autochess_m01', modeId: 'mode_multi_normal', round: 9,
    wave: 'act1autochess_escaped_multi', timeLimit: 60,
    players: () => [
      { playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m01', ['星熊', '德克萨斯', '能天使', '赫默', '格雷伊', '银灰']) },
      { playerId: 'P2', seat: 1, side: 'L', colOffset: 8, units: lineup('act2autochess_m01', ['塞雷娅', '拉普兰德', '莫斯提马', '白面鸮', '远牙', '缇缇'], 101) },
    ],
  },
  {
    name: 'boss-m02', title: '最终攻势 · 卢西恩，“猩红血钻” · R14', kind: 'boss', stageId: 'act2autochess_m02', modeId: 'mode_multi_normal', round: 14,
    wave: 'act2autochess_h07_05', timeLimit: 75, bossId: 'boss_5',
    players: () => [
      { playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: lineup('act2autochess_m02', ['塞雷娅*', '山*', '史尔特尔*', '夕*', '缇缇', '烛煌*', '铃兰', '异客']) },
      { playerId: 'P2', seat: 1, side: 'R', colOffset: 0, units: lineup('act2autochess_m02', ['余*', '耀骑士临光', '锏*', '蕾缪安*', '焰影苇草', '迷迭香*', '流明', '纯烬艾雅法拉'], 101) },
    ],
  },
];

/** The match's own round composition (server/match/waves.js): spawns, routes, overrides, time limit, preview. */
function officialWave(sc) {
  const gd = new GameData(data, sc.modeId);
  const setup = setupMatchWaves(gd, createRng(sc.waveSeed ?? 1));
  const w = buildNormalWave(gd, createRng((sc.waveSeed ?? 1) + sc.round), setup.factions, sc.round);
  if (!w.templateId || !w.spawns.length) throw new Error(`no official wave for ${sc.name}`);
  return { waveId: w.templateId, conv: { spawns: w.spawns, routes: w.routes, overrides: w.overrides, maxPlayTime: w.timeLimit }, preview: previewOf(w.spawns) };
}

function record(sc) {
  const modeId = sc.modeId;
  const round = sc.round;
  const roundCfg = config.modes?.[modeId]?.rounds?.[String(round)];
  let waveId, conv, preview = null;
  if (sc.wave === 'official') ({ waveId, conv, preview } = officialWave(sc));
  else {
    waveId = sc.wave || roundCfg?.template;
    const tpl = ds.getWave(waveId);
    if (!tpl) throw new Error(`unknown wave ${waveId}`);
    conv = spawnsFromTemplate(tpl, { mods: modsFor(modeId, round) });
  }
  let sharedBoss = null;
  if (sc.kind === 'boss') {
    const boss = data.bosses?.[sc.bossId];
    const hp = Math.round((boss?.bloodPoint?.NORMAL ?? 400000) * 0.5);
    sharedBoss = { hp, maxHp: hp, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } };
  }
  const timeLimit = sc.timeLimit ?? conv.maxPlayTime ?? roundCfg?.combatTimeLimit ?? 60;
  const b = new Battle({
    seed: SEED ^ hash(sc.name), kind: sc.kind, modeId, round, stageId: sc.stageId,
    timeLimit: sc.kind === 'boss' ? Infinity : timeLimit, routes: conv.routes, spawns: conv.spawns,
    players: sc.players(), sharedBoss, enemyOverrides: conv.overrides ?? {}, fieldId: sc.kind === 'normal' ? 'n:P1' : sc.kind === 'unite' ? 'u' : 'b1',
    flags: { layerGainsEnabled: sc.kind === 'normal', dpInit: 10, dpPerSec: 1, dpMax: 99 }, logger: quiet,
  });
  const frames = [];
  let field = null;
  let ticks = 0;
  const demoSkillsActivated = new Set();
  const maxT = Math.min(maxSecondsOf(sc), sc.kind === 'boss' ? timeLimit : timeLimit + 1);
  while (!b.finished) {
    b.step();
    ticks++;
    // A preview-only free cast, once an enemy reaches the operator; the recording still uses real attacks and damage.
    for (const uid of sc.demoSkillUids ?? (sc.demoSkillUid ? [sc.demoSkillUid] : [])) {
      if (demoSkillsActivated.has(uid)) continue;
      const u = b.allyUnits.find((unit) => unit.id === uid);
      if (u?.skill && b.enemies.some((e) => e.alive && Math.hypot(e.x - u.x, e.y - u.y) < 4)) {
        if (u.skill.activate('demo', { free: true })) demoSkillsActivated.add(uid);
      }
    }
    if (!field) field = b.fieldMeta();
    if (ticks % 3 === 0) {
      frames.push({ snap: b.snapshot(), ev: b.drainEvents() });
    }
    if (b.time >= maxT) b.forceEnd(sc.kind === 'boss' ? 'forced' : 'timeout');
  }
  // final frame (end state); when the battle ended on a snapshot tick, only its trailing events are appended
  const tail = { snap: b.snapshot(), ev: b.drainEvents() };
  const last = frames[frames.length - 1];
  if (!last || tail.snap.t > last.snap.t) frames.push(tail);
  else last.ev.push(...tail.ev);
  const r = b.result();
  const counts = {};
  for (const f of frames) for (const e of f.ev) counts[e[0]] = (counts[e[0]] || 0) + 1;
  return {
    version: 1, name: sc.name, title: sc.title, kind: sc.kind, stageId: sc.stageId, modeId, round, wave: waveId,
    tick: 1 / 30, snapEvery: 3, duration: Math.round(b.time * 100) / 100, recordedAt: '2026-09-27',
    field,
    ...(preview ? { preview } : {}),
    frames,
    result: {
      reason: r.reason, time: Math.round(r.time * 10) / 10, killed: r.killed, total: r.total, bossHpLeft: r.bossHpLeft ?? null,
      perPlayer: Object.fromEntries(Object.entries(r.perPlayer).map(([k, v]) => [k, { killed: v.killed, total: v.total, leaked: v.leaked.length, deaths: v.deaths }])),
      events: counts, errors: b.errors?.length ?? 0,
    },
  };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

fs.mkdirSync(OUT, { recursive: true });
const index = [];
const prev = fs.existsSync(path.join(OUT, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')) : [];
for (const sc of SCENARIOS) {
  if (!ONLY && sc.previewOnly) continue;
  if (ONLY && !ONLY.has(sc.name)) { const p = prev.find((x) => x.name === sc.name); if (p) index.push(p); continue; }
  const t0 = performance.now();
  const rec = record(sc);
  const file = path.join(OUT, `${sc.name}.json`);
  const json = JSON.stringify(rec);
  fs.writeFileSync(file, json);
  const maxUnits = Math.max(...rec.frames.map((f) => f.snap.units.length));
  index.push({ name: sc.name, title: sc.title, kind: sc.kind, stageId: sc.stageId, duration: rec.duration, frames: rec.frames.length, maxUnits, file: `${sc.name}.json`, bytes: json.length, result: { reason: rec.result.reason, killed: rec.result.killed, total: rec.result.total } });
  console.log(`${sc.name.padEnd(12)} ${rec.kind.padEnd(7)} ${rec.duration.toFixed(1).padStart(5)} s  frames ${String(rec.frames.length).padStart(4)}  units≤${String(maxUnits).padStart(3)}  ${(json.length / 1024).toFixed(0).padStart(5)} KB  ${rec.result.reason} ${rec.result.killed}/${rec.result.total}  errors ${rec.result.errors}  (${(performance.now() - t0).toFixed(0)} ms)  events ${JSON.stringify(rec.result.events)}`);
}
// recordings made by other scenario lists (kept files) stay listed
for (const p of prev) if (p && !index.some((x) => x.name === p.name) && fs.existsSync(path.join(OUT, p.file || `${p.name}.json`))) index.push(p);
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`wrote ${index.length} recordings → ${path.relative(ROOT, OUT)}`);
