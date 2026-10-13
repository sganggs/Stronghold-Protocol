// public/dev/render-demo.js — dev harness for the battlefield renderer (render/app.js):
//   * prep scene: fake private state (hand / temp / board pieces, items, token stack), draggable; drops are
//     applied locally as if the server accepted them (swap when occupied, equip items onto operators)
//   * recordings (public/dev/recordings/*.json, tools/record-battle.mjs): real battles replayed at real speed
//     through the same pushSnapshot/pushEvents path as the game, with play/pause, speed, scrub and scene select
//   * stress scene: 120 units + projectiles / damage numbers every frame (FPS check)
//   * fx scene: a small normal field (incl. art-less / unknown units, a crate and a turret device) cycling through
//     every sim fx kind (render/fx.js FX_KINDS), every projectile kind (boomerang included) and every status icon; at
//     'lock' it plays 蕾缪安's S3 as the sim does (a lock every 0.5 s, then one shell every 0.3 s with its bombard)
// Query: ?scene=prep|<recording>|stress|numbers &stage=<stageId> &t=<seconds> &speed=<x> &paused=1 &panel=0 &quality=high|medium|low
//        &pen=<recording> (prep: that recording's round preview — m.private.nextEnemies — in the enemy preview pen)
//        &ops=<chessId>,… (stress: up to 6 given chess in the crowd's front row, ids 6, 8, 10, …)
//        &fa=L|R (prep on that half of the Final Assault boss field, view.setCamera('bossPrep', { side }))
//        &board=2d|3d (the official 3D board scene, DESIGN §15; default 3D when the local art + WebGL2 are available)
//        &cam=prep|normal|unite|boss|pen|bossPrep [&side=L|R &half=1 &shop=0] (official configBlackBoard framings)
// Puppeteer hook: window.__demo = { ready, view, seek(t), play(), pause(), setScene(name), stats(), log,
//   refuseDrops (true ⇒ prep drops are silently ignored, like a server that rejects the move) }

import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { GEO } from '../../shared/constants.js';
import { FX_KINDS } from '../js/render/fx.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const logLines = [];
function log(...a) {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  logLines.push(s);
  if (logLines.length > 12) logLines.shift();
  $('log').textContent = logLines.join('\n');
}
window.addEventListener('error', (e) => log('ERROR', e.message));
window.addEventListener('unhandledrejection', (e) => log('REJECT', String(e.reason?.message || e.reason)));

const demo = { ready: false, errors: [], log: logLines };
window.__demo = demo;

let demoHover = null;
const STAGE_IDS = ['act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04', 'act1autochess_m01', 'act1autochess_m02', 'act1autochess_m03', 'act1autochess_m04'];

async function main() {
  if (q.get('panel') === '0') $('panel').classList.add('is-hidden');
  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
  await assets.ready();
  const index = await fetch('/dev/recordings/index.json').then((r) => (r.ok ? r.json() : []), () => []);
  const view = await createFieldView($('field'), {
    data, assets, settings: { quality: q.get('quality') || 'high', damageNumbers: true },
    ...(q.has('aa') ? { antialias: q.get('aa') !== '0' } : {}),
  });
  demo.view = view;
  window.__view = view;

  // ---- UI --------------------------------------------------------------------------------------------------
  const sceneSel = $('scene');
  const scenes = [{ name: 'prep', title: '休整期 · 拖拽演示' }, ...index.map((r) => ({ name: r.name, title: r.title, rec: r })), { name: 'stress', title: '压力测试 · 120 单位' }, { name: 'fx', title: '特效图鉴 · 全部 fx' }, { name: 'numbers', title: '伤害数字 · 重叠测试' }];
  for (const s of scenes) sceneSel.append(new Option(s.title, s.name));
  const stageSel = $('stage');
  for (const id of STAGE_IDS) { const st = data.lookup('stages', id); if (st) stageSel.append(new Option(st.name || id, id)); }

  let current = null;       // active scene controller
  let playing = q.get('paused') !== '1';
  let speed = Number(q.get('speed')) || 1;
  $('speed').value = String(speed);
  const setPlay = (p) => { playing = p; $('play').textContent = p ? '❚❚' : '▶'; };
  setPlay(playing);
  $('play').onclick = () => setPlay(!playing);
  $('speed').onchange = () => { speed = Number($('speed').value) || 1; };
  sceneSel.onchange = () => setScene(sceneSel.value);
  stageSel.onchange = () => setScene(sceneSel.value, stageSel.value);
  $('scrub').oninput = () => current?.seek?.((Number($('scrub').value) / 1000) * (current.duration || 0));
  $('editable').onclick = () => { const on = !$('editable').classList.contains('is-on'); $('editable').classList.toggle('is-on', on); current?.setEditable?.(on); };
  // board layer toggle (3D official scene ⇄ 2D atlas board) and the official camera framings
  const syncBoardBtn = () => { const on = !!view.stats().board3d?.on; $('board3d').classList.toggle('is-on', on); $('board3d').textContent = on ? '3D' : '2D'; };
  $('board3d').onclick = async () => { await view.setBoardMode?.(view.stats().board3d?.on ? '2d' : '3d'); syncBoardBtn(); };
  setTimeout(syncBoardBtn, 0);
  $('cam').onchange = () => {
    const v = $('cam').value;
    if (!v) return;
    const [kind, side] = v.split('-');
    if (kind === 'prep') view.setCamera('prep', { shop: side !== 'noshop' });
    else if (kind === 'fa') view.setCamera('bossPrep', { side: side || 'L' });
    else view.setCamera(kind, { side: side || 'L', half: !!side });
  };

  async function setScene(name, stageId) {
    try { current?.stop?.(); } catch { /* ignore */ }
    const s = scenes.find((x) => x.name === name) || scenes[0];
    sceneSel.value = s.name;
    $('title').textContent = s.title;
    if (s.name === 'prep') current = await prepScene(view, stageId || q.get('stage') || 'act2autochess_m01', index);
    else if (s.name === 'numbers') current = numbersScene(view, stageId || q.get('stage') || 'act2autochess_m02');
    else if (s.name === 'stress') current = stressScene(view, stageId || q.get('stage') || 'act2autochess_m01');
    else if (s.name === 'fx') current = fxScene(view, stageId || q.get('stage') || 'act2autochess_m03');
    else current = await recordingScene(view, s.rec);
    if (current.stageId) stageSel.value = current.stageId;
    demo.scene = current;
    return current;
  }
  demo.setScene = setScene;
  demo.showRange = (uid) => (demoHover ? demoHover(uid) : false);
  demo.seek = (t) => current?.seek?.(t);
  demo.play = () => setPlay(true);
  demo.pause = () => setPlay(false);
  demo.stats = () => ({ ...view.stats(), scene: sceneSel.value, t: current?.time ?? 0, duration: current?.duration ?? 0 });

  await setScene(q.get('scene') || 'prep');
  const t0 = Number(q.get('t'));
  if (Number.isFinite(t0) && t0 > 0) current?.seek?.(t0);
  // ?cam=prep|normal|unite|boss|pen|bossPrep[&side=L|R&half=1&shop=0]: override the scene's camera (official framings)
  if (q.get('cam')) {
    view.setCamera(q.get('cam'), { side: q.get('side') || 'L', half: q.get('half') === '1', shop: q.get('shop') === '0' ? false : undefined, instant: true });
  }

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (current?.tick) {
      try { current.tick(playing ? dt * speed : 0); } catch (err) { log('tick', err.message); }
      if (current.duration) {
        $('scrub').value = String(Math.round((current.time / current.duration) * 1000));
        $('time').textContent = `${current.time.toFixed(1)} / ${current.duration.toFixed(1)} s`;
      }
    }
    const st = view.stats();
    $('stats').textContent = `fps ${st.fps.toFixed(0)}  frame ${st.frameMs.toFixed(1)} ms  units ${st.units}  particles ${st.particles}  proj ${st.projectiles}  nums ${st.numbers}\nspine ${st.spine ? `${st.spine.ready} ready / ${st.spine.loading} loading / ${st.spine.failed} failed` : '-'}  rate ${st.rate?.toFixed?.(2) ?? '-'}  buffered ${st.buffered}\nboard ${st.board3d?.on ? `3D · ${st.board3d.calls} calls · ${st.board3d.triangles} tris · ${st.board3d.cpuMs} ms` : '2D atlas'}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  demo.ready = true;
}

// =============================================================================================================
// prep scene

async function prepScene(view, stageId, index = []) {
  const stage = data.lookup('stages', stageId);
  view.setStage(stage);
  const fa = q.get('fa');
  if (fa === 'L' || fa === 'R') view.setCamera('bossPrep', { side: fa });
  else view.setCamera('prep', { rect: { ...GEO.NORMAL_RECT }, side: 'L' });
  // the enemy preview pen: a recording's round preview (m.private.nextEnemies shape), else a small R4-like wave
  let nextEnemies = [
    { enemyKey: 'enemy_1007_slime', count: 2, gate: 'lower', t: 3, fly: false, elite: false, source: 'wave' },
    { enemyKey: 'enemy_1000_gopro_2', count: 3, gate: 'upper', t: 3, fly: false, elite: false, source: 'wave' },
    { enemyKey: 'enemy_1019_jshoot', count: 3, gate: 'lower', t: 12, fly: false, elite: false, source: 'wave' },
    { enemyKey: 'enemy_1006_shield', count: 1, gate: 'lower', t: 13, fly: false, elite: true, source: 'wave' },
    { enemyKey: 'enemy_1005_yokai', count: 2, gate: 'upper', t: 7, fly: true, elite: false, source: 'wave' },
  ];
  const penRec = q.get('pen') ? index.find((r) => r.name === q.get('pen')) : null;
  if (penRec) {
    const rec = await fetch(`/dev/recordings/${penRec.file}`).then((r) => r.json(), () => null);
    if (Array.isArray(rec?.preview)) nextEnemies = rec.preview;
  } else if (q.get('pen') === '0') nextEnemies = [];
  const chess = data.list('chess').filter((c) => c.visible && !c.isGolden);
  const pick = (name) => chess.find((c) => c.name === name);
  const golden = (c) => data.lookup('chess', c.goldenId) || c;
  const items = data.list('items').filter((i) => i.itemType === 'EQUIP' && !i.isGolden);
  let uid = 1;
  const P = (c, extra = {}) => ({ uid: uid++, kind: 'chess', id: c.chessId, golden: !!c.isGolden, tier: c.tier, items: [], ...extra });
  const deploy = stage?.deployTiles?.normal || { melee: [], rangedOnly: [] };
  const meleeTiles = deploy.melee.slice().sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const rangedTiles = [...(deploy.rangedOnly || []), ...meleeTiles.slice().reverse()];
  const state = { hand: Array(10).fill(null), temp: Array(5).fill(null), board: [], nextEnemies };
  const taken = new Set();
  const place = (c) => {
    const list = c.position === 'MELEE' ? meleeTiles : rangedTiles;
    const t = list.find(([r, cc]) => !taken.has(`${r},${cc}`));
    if (!t) return;
    taken.add(`${t[0]},${t[1]}`);
    state.board.push({ ...P(c), row: t[0], col: t[1] });
  };
  for (const n of ['塞雷娅', '银灰', '德克萨斯', '能天使', '莫斯提马', '白面鸮', '伊内丝']) { const c = pick(n); if (c) place(n === '银灰' || n === '能天使' ? golden(c) : c); }
  const it0 = items[3];
  if (state.board[0] && it0) state.board[0].items = [{ uid: uid++, id: it0.id }];
  const handNames = ['斯卡蒂', '夕', '史尔特尔', '缇缇', '蕾缪安', '异客'];
  handNames.forEach((n, i) => { const c = pick(n); if (c) state.hand[i] = P(c); });
  if (items[0]) state.hand[6] = { uid: uid++, kind: 'item', id: items[0].id, golden: false, tier: items[0].tier };
  if (items[12]) state.hand[7] = { uid: uid++, kind: 'item', id: items[12].id, golden: false, tier: items[12].tier };
  const tok = data.list('tokens').find((t) => t.kind === 'summon' && t.displayType === 'DEFAULT');
  if (tok) state.hand[8] = { uid: uid++, kind: 'token', id: tok.tokenId, golden: false, tier: 1, count: 3 };
  const c1 = pick('角峰'), c2 = pick('格雷伊');
  if (c1) state.temp[0] = P(c1);
  if (c2) state.temp[1] = P(c2);

  let editable = true;
  const find = (u) => {
    for (let i = 0; i < 10; i++) if (state.hand[i]?.uid === u) return { area: 'hand', idx: i, piece: state.hand[i] };
    for (let i = 0; i < 5; i++) if (state.temp[i]?.uid === u) return { area: 'temp', idx: i, piece: state.temp[i] };
    const b = state.board.find((p) => p.uid === u);
    return b ? { area: 'board', piece: b } : null;
  };
  const at = (t) => (t.area === 'hand' ? state.hand[t.idx] : state.board.find((p) => p.row === t.row && p.col === t.col) || null);
  const tileOk = (piece, r, c) => {
    const rec = data.lookup('chess', piece.id);
    const inMelee = deploy.melee.some(([a, b]) => a === r && b === c);
    const inRanged = (deploy.rangedOnly || []).some(([a, b]) => a === r && b === c);
    return rec?.position === 'MELEE' ? inMelee : inMelee || inRanged;
  };
  const canPlace = (u, target) => {
    const src = find(u);
    if (!src || !editable) return false;
    const occ = at(target);
    if (src.piece.kind === 'item') return !!occ && occ.kind === 'chess' && (occ.items || []).length < 2;
    if (target.area === 'hand') return !occ || src.area !== 'board' || occ.kind !== 'item';
    if (src.piece.kind !== 'chess' && src.piece.kind !== 'token') return false;
    if (!tileOk(src.piece, target.row, target.col) && src.piece.kind === 'chess') return false;
    if (occ && src.area === 'board' && !tileOk(occ, src.piece.row, src.piece.col)) return false;
    return true;
  };
  const apply = (u, target) => {
    const src = find(u);
    if (!src) return;
    const occ = at(target);
    if (src.piece.kind === 'item') {
      if (occ && occ.kind === 'chess') { occ.items = [...(occ.items || []), { uid: src.piece.uid, id: src.piece.id }]; remove(src); }
      return;
    }
    const moved = { ...src.piece };
    remove(src);
    if (occ) {
      const o = { ...occ };
      removeAt(target);
      putAt(o, src.area === 'board' ? { area: 'board', row: src.piece.row, col: src.piece.col } : { area: src.area, idx: src.idx });
    }
    putAt(moved, target);
  };
  const remove = (loc) => {
    if (loc.area === 'hand') state.hand[loc.idx] = null;
    else if (loc.area === 'temp') state.temp[loc.idx] = null;
    else state.board = state.board.filter((p) => p.uid !== loc.piece.uid);
  };
  const removeAt = (t) => {
    if (t.area === 'hand') state.hand[t.idx] = null;
    else state.board = state.board.filter((p) => !(p.row === t.row && p.col === t.col));
  };
  const putAt = (p, t) => {
    const { row, col, ...rest } = p; // eslint-disable-line no-unused-vars
    if (t.area === 'hand') state.hand[t.idx] = rest;
    else if (t.area === 'temp') state.temp[t.idx] = rest;
    else state.board.push({ ...rest, row: t.row, col: t.col });
  };
  const push = () => view.setPrep(JSON.parse(JSON.stringify(state)), { editable, canPlace });
  push();
  const offs = [
    view.on('pieceDrop', (e) => {
      log('pieceDrop', { uid: e.uid, target: e.target });
      if (e.target.area === 'outside' || demo.refuseDrops) return;
      // simulate the server round trip
      setTimeout(() => { apply(e.uid, e.target); push(); }, 90);
    }),
    view.on('pieceClick', (e) => log('pieceClick', { uid: e.uid, detail: e.detail })),
    view.on('pieceDragStart', (e) => { view.highlightTiles(null); log('pieceDragStart', { uid: e.uid, from: e.from }); }),
    // hover a board operator ⇒ its attack range (orange) + its tile (mint), like the original
    view.on('pieceHover', (e) => {
      view.highlightTiles(null);
      const p = e.uid != null ? state.board.find((x) => x.uid === e.uid) : null;
      const rec = p ? data.lookup('chess', p.id) : null;
      if (!rec || !Array.isArray(rec.rangeGrid)) return;
      const tiles = rec.rangeGrid.map(([dr, dc]) => [p.row + dr, p.col + dc]).filter(([r, c]) => !(r === p.row && c === p.col));
      view.highlightTiles(tiles, { color: 0xff9c33, fill: 0.28, line: 0.85, group: 'range' });
      view.highlightTiles([[p.row, p.col]], { color: 0x4ed8af, fill: 0.3, line: 0.9, group: 'rangeStand' });
    }),
  ];
  demoHover = (uid) => {
    const p = state.board.find((x) => x.uid === uid);
    const rec = p ? data.lookup('chess', p.id) : null;
    if (!rec) return false;
    view.highlightTiles(rec.rangeGrid.map(([dr, dc]) => [p.row + dr, p.col + dc]).filter(([r, c]) => !(r === p.row && c === p.col)), 'range');
    view.highlightTiles([[p.row, p.col]], 'rangeStand');
    return true;
  };
  let hl = 0;
  return {
    stageId,
    duration: 0,
    time: 0,
    setEditable(on) { editable = on; push(); },
    tick(dt) {
      hl += dt;
      // periodic range preview of the first ranged board piece (demo of highlightTiles 'range')
      void hl;
    },
    stop() { for (const off of offs) off(); view.highlightTiles(null); },
    state,
  };
}

// =============================================================================================================
// recording scene

async function recordingScene(view, meta) {
  const rec = await fetch(`/dev/recordings/${meta.file}`).then((r) => r.json());
  const stage = data.lookup('stages', rec.stageId);
  const frames = rec.frames;
  const t0 = frames[0].snap.t;
  const duration = frames[frames.length - 1].snap.t - t0;
  const kind = rec.kind === 'hidden' ? 'boss' : rec.kind;
  const fieldId = rec.field.fieldId;
  let idx = 0, gameT = t0, endWait = 0;

  const start = () => {
    view.setStage(stage);
    view.enterBattle(rec.field);
    view.setCamera(kind, { rect: rec.field.rect, side: 'L' });
    idx = 0; gameT = t0 - 0.001; endWait = 0;
  };
  start();

  const feed = () => {
    while (idx < frames.length && frames[idx].snap.t <= gameT) {
      const f = frames[idx++];
      // like the match server: b.ev first, then the b.snap of the same drain, both with the game time `gt`
      // (the recorded snapshot keeps its numeric `t`, which the engine also accepts)
      if (f.ev.length) view.pushEvents({ t: 'b.ev', fieldId, gt: f.snap.t, ev: f.ev });
      view.pushSnapshot(f.snap);
    }
  };

  const seek = (t) => {
    const target = t0 + Math.max(0, Math.min(duration, t));
    view.enterBattle(rec.field);
    view.setCamera(kind, { rect: rec.field.rect, side: 'L', instant: true });
    let k = 0;
    while (k + 1 < frames.length && frames[k + 1].snap.t <= target) k++;
    const infos = new Map();
    for (let i = 0; i <= k; i++) for (const e of frames[i].ev) if (e[0] === 'spawn') infos.set(e[1].id, e[1]);
    const present = new Set(frames[k].snap.units.map((u) => u[0]));
    const spawns = [...infos.values()].filter((u) => present.has(u.id)).map((u) => ['spawn', u]);
    if (spawns.length) view.pushEvents({ fieldId, ev: spawns });
    // replay the last few snapshots so the interpolation buffer has a history
    const from = Math.max(0, k - 3);
    for (let i = from; i <= k; i++) view.pushSnapshot(frames[i].snap);
    view.debug.interp.snapToNewest();
    idx = k + 1;
    gameT = frames[k].snap.t;
  };

  return {
    stageId: rec.stageId,
    duration,
    get time() { return Math.max(0, gameT - t0); },
    seek,
    tick(dt) {
      if (dt <= 0) return;
      if (idx >= frames.length) {
        endWait += dt;
        if (endWait > 3) start();
        return;
      }
      gameT += dt * 2; // combat runs at 2× real time
      feed();
    },
    stop() {},
    rec,
  };
}

// =============================================================================================================
// stress scene: 120 units, constant projectiles / numbers

function stressScene(view, stageId) {
  const stage = data.lookup('stages', stageId);
  view.setStage(stage);
  const rect = { r0: 9, r1: 12, c0: 0, c1: 20 };
  const chess = data.list('chess').filter((c) => c.visible && !c.isGolden);
  const enemies = data.list('enemies').filter((e) => assets.spineEntry(e.key) && e.rank !== 'BOSS');
  // &ops=<chessId>,… : these chess take every other place of the front row from col 7 (ids 6, 8, 10, …) — given models
  // inside a crowded, impostor-rendered field, clear of the screen edge (GitHub #542: impostor-bounds.browser.test.js)
  const ops = (q.get('ops') || '').split(',').map((s) => data.lookup('chess', s.trim())).filter(Boolean);
  const opAt = (i) => (i >= 5 && i % 2 === 1 && i < 17 ? ops[(i - 5) / 2] : null);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const units = [];
  let id = 1;
  for (let i = 0; i < 40; i++) {
    const c = opAt(i) || chess[(i * 7) % chess.length];
    units.push({ id: id++, kind: 'op', side: 'ally', defId: c.chessId, name: c.name, tier: c.tier, golden: i % 6 === 0, spine: c.assets?.spine, avatar: c.assets?.avatar, x: 2 + (i % 17), y: 9 + ((i / 17) | 0) % 4, facing: 1, maxHp: 3000 });
  }
  for (let i = 0; i < 80; i++) {
    const e = enemies[(i * 5) % enemies.length];
    units.push({ id: id++, kind: 'enemy', side: 'enemy', defId: e.key, name: e.name, tier: 1, golden: false, spine: e.spine || e.key, avatar: e.iconId || e.key, x: 20 - (i % 20), y: 9 + (i % 4) + 0.3, facing: -1, maxHp: 5000 });
  }
  const field = { fieldId: 'stress', kind: 'unite', rect, stageId, units };
  view.enterBattle(field);
  view.setCamera('unite', { rect });
  let t = 0, acc = 0;
  const hp = new Map(units.map((u) => [u.id, u.maxHp]));
  const kinds = ['arrow', 'bolt', 'orb', 'none', 'bomb', 'chain'];
  return {
    stageId,
    duration: 0,
    time: 0,
    tick(dt) {
      if (dt <= 0) return;
      acc += dt * 2;
      while (acc >= 0.1) {
        acc -= 0.1;
        t += 0.1;
        const tuples = units.map((u) => {
          let x = u.x, y = u.y;
          if (u.side === 'enemy') { x = 1 + ((u.x - t * 0.35 + 40) % 19); y = u.y + Math.sin(t + u.id) * 0.25; }
          let h = hp.get(u.id);
          if (h <= 0) h = u.maxHp;
          hp.set(u.id, h);
          const flags = (u.id % 11 === 0 ? 2 : 0) | (u.id % 13 === 0 ? 16 : 0);
          return [u.id, Math.round(x * 100) / 100, Math.round(y * 100) / 100, h, u.maxHp, (t * 3 + u.id) % 20, 20, flags, u.side === 'enemy' ? 1 : 0];
        });
        const ev = [];
        for (let k = 0; k < 14; k++) {
          const a = units[(rnd() * 40) | 0], b = units[40 + ((rnd() * 80) | 0)];
          ev.push(['atk', a.id, b.id, kinds[(rnd() * kinds.length) | 0]]);
          const d = 100 + ((rnd() * 900) | 0);
          hp.set(b.id, hp.get(b.id) - d);
          ev.push(['dmg', b.id, d, rnd() < 0.6 ? 'phys' : 'arts']);
        }
        for (let k = 0; k < 4; k++) { const b = units[(rnd() * 40) | 0]; ev.push(['heal', b.id, 150]); }
        if (rnd() < 0.2) ev.push(['skill', units[(rnd() * 40) | 0].id, 1]);
        view.pushEvents({ t: 'b.ev', fieldId: 'stress', gt: t, ev });
        view.pushSnapshot({ t: 'b.snap', fieldId: 'stress', gt: t, units: tuples, dp: 10, killed: 0, total: 80 });
      }
    },
    stop() {},
  };
}

// =============================================================================================================
// fx gallery: every fx kind, projectile kind and status on a small static field

function fxScene(view, stageId) {
  const stage = data.lookup('stages', stageId);
  view.setStage(stage);
  const rect = { ...GEO.NORMAL_RECT };
  const pick = (name) => data.list('chess').find((c) => c.name === name && !c.isGolden);
  const op = (id, name, x, y) => { const c = pick(name); return c ? { id, kind: 'op', side: 'ally', defId: c.chessId, name, tier: c.tier, golden: false, spine: c.assets?.spine, avatar: c.assets?.avatar, x, y, facing: 1, maxHp: 3000 } : null; };
  const en = (id, key, x, y, extra = {}) => { const e = data.lookup('enemies', key); return { id, kind: 'enemy', side: 'enemy', defId: key, name: e?.name || key, tier: 1, golden: false, spine: e?.spine || key, avatar: e?.iconId || key, x, y, facing: -1, maxHp: 4000, ...extra }; };
  const units = [
    op(1, '银灰', 4, 9), op(2, '能天使', 3, 11), op(3, '塞雷娅', 5, 10), op(4, '莫斯提马', 6, 12),
    en(20, 'enemy_1007_slime', 7, 9), en(21, 'enemy_5601_entlec', 8, 10), en(22, 'enemy_nonexistent_x', 7.4, 11),
    en(23, 'enemy_1042_frostd', 9, 9.2), en(24, 'enemy_2016_csphtm', 8.6, 12, { boss: true, maxHp: 90000 }),
    { id: 30, kind: 'device', side: 'ally', defId: 'trap_1105_accrate', name: 'crate', x: 6, y: 9, facing: 1, maxHp: 100 },
    { id: 31, kind: 'device', side: 'ally', defId: 'trap_1104_aclasert', name: 'turret', x: 5, y: 12, facing: 1, maxHp: 3000 },
  ].filter(Boolean);
  view.enterBattle({ fieldId: 'fx', kind: 'normal', rect, stageId, units });
  view.setCamera('normal', { rect });
  const kinds = Object.keys(FX_KINDS);
  const projs = ['arrow', 'bolt', 'orb', 'bomb', 'lob', 'drone', 'enemy', 'boomerang', 'chain', 'chainHeal', 'beam', 'none'];
  const statuses = ['stun', 'ab:frost', 'reed2:scorch', 'fragile', 'sleep', 'silence', 'levitate', 'skill:shotst_shred', 'lumen:resist'];
  let t = 0, acc = 0, i = 0;
  const hp = new Map(units.map((u) => [u.id, u.maxHp]));
  const unitAt = (id) => units.find((u) => u.id === id) || units[0];
  const extraFor = (k) => {
    const base = { id: [1, 20, 21, 3, 23][i % 5] };
    switch (FX_KINDS[k].a) {
      case 'beam': case 'bolt': return { ...base, from: 1, to: 20, src: 2 };
      case 'volley': return { ...base, id: 2, src: 2, targets: [20, 21, 23] };
      case 'blink': return { ...base, id: 21, fx: 9, fy: 11 };
      case 'move': return { ...base, id: 20, fromX: 9, fromY: 9 };
      case 'zone': case 'telegraph': return { ...base, r: 1.5, dur: 2, tiles: k === 'telegraph' ? 'box' : undefined };
      case 'dp': return { ...base, id: 3, n: 10 };
      case 'element': return { ...base, id: 21, element: ['burn', 'neural', 'apoptosis'][i % 3] };
      case 'shell': return { id: 2, r: 1.5, t: 0.3, i: 0 };                  // 蕾缪安 (id = the shooter) shelling an enemy
      case 'flame': return { id: 1, target: 20, r: 1, n: 1, dur: 1 };        // 炎佑's jet (id = the dragon) onto its target
      default: return k === 'lock' ? { id: 21, src: 2 } : FX_KINDS[k].pt ? { id: 2, r: 1.5 } : base;
    }
  };
  // `pt` kinds name the shooter in `id` and happen at an enemy's spot; a 'flame' happens at its target
  const posFor = (k, ex) => unitAt(FX_KINDS[k].pt ? [21, 23, 20][i % 3] : FX_KINDS[k].a === 'flame' ? ex.target : ex.id);
  // 蕾缪安 S3 as the sim plays it (sim/content/kits/ops/chess_char_6_01-lemuen.js): a lock every 0.5 s, then after the skill one shell every
  // 0.3 s on the locks in order, each landing 0.3 s later with its bombard — queued [game time, event]
  const queue = [];
  const lemuenS3 = () => {
    const locks = [21, 23, 20, 21, 24];
    locks.forEach((id, k) => queue.push([t + 0.5 * k, ['fx', 'lock', unitAt(id).x, unitAt(id).y, { id, src: 2 }]]));
    const end = t + 0.5 * locks.length;
    queue.push([end - 0.5, ['skill', 2, 0]]);
    locks.forEach((id, k) => {
      const x = unitAt(id).x + ((k * 37) % 7 - 3) * 0.05, y = unitAt(id).y + ((k * 53) % 7 - 3) * 0.05;
      queue.push([end + 0.3 * k, ['fx', 'bombardShell', x, y, { id: 2, r: 1.5, t: 0.3, i: k }]]);
      queue.push([end + 0.3 * k + 0.3, ['fx', 'bombard', x, y, { id: 2, r: 1.5 }]]);
    });
  };
  return {
    stageId, duration: 0, time: 0,
    get kind() { return kinds[(i - 1 + kinds.length) % kinds.length]; },
    tick(dt) {
      if (dt <= 0) return;
      acc += dt * 2;
      while (acc >= 0.1) {
        acc -= 0.1;
        t += 0.1;
        const ev = [];
        for (let q = queue.length - 1; q >= 0; q--) if (queue[q][0] <= t + 1e-6) ev.unshift(queue.splice(q, 1)[0][1]);
        if (Math.round(t * 10) % 5 === 0) {
          const k = kinds[i % kinds.length];
          const ex = extraFor(k);
          const at = posFor(k, ex);
          if (k === 'lock' && !queue.length) { ev.push(['skill', 2, 1]); lemuenS3(); }
          ev.push(['fx', k, at.x, at.y, ex]);
          $('title').textContent = `特效图鉴 · ${k} (${FX_KINDS[k].a})`;
          const a = units[i % 4], b = units[4 + (i % 5)];
          const pk = projs[i % projs.length];
          ev.push(['atk', pk === 'chain' ? 20 : a.id, b.id, pk]);
          ev.push(['dmg', b.id, 120 + (i * 37) % 900, ['phys', 'arts', 'true', 'burn'][i % 4]]);
          if (i % 3 === 0) ev.push(['heal', units[i % 4].id, 240]);
          const st = statuses[i % statuses.length];
          ev.push(['status', b.id, st, 1], ['status', units[4 + ((i + 2) % 5)].id, statuses[(i + 4) % statuses.length], 0]);
          if (i % 6 === 0) ev.push(['skill', units[i % 4].id, 1]);
          if (i % 6 === 3) ev.push(['skill', units[(i - 3) % 4].id, 0]);
          hp.set(b.id, Math.max(1, hp.get(b.id) - 300));
          i++;
        }
        const tuples = units.map((u) => {
          const h = hp.get(u.id);
          const flags = u.id === 21 ? 1 : u.id === 23 ? 128 : u.id === 2 ? 32 : 0;
          return [u.id, u.x, u.y, h, u.maxHp, (t * 2 + u.id) % 20, u.kind === 'op' ? 20 : 0, flags, u.side === 'enemy' ? 2 : 0];
        });
        view.pushEvents({ t: 'b.ev', fieldId: 'fx', gt: t, ev });
        view.pushSnapshot({ t: 'b.snap', fieldId: 'fx', gt: t, units: tuples, dp: 10, killed: 0, total: 5 });
      }
    },
    stop() {},
  };
}

// =============================================================================================================
// damage numbers: a boss and a knot of minions standing on top of each other take rapid mixed hits (the '41509' /
// '201625' overlap cases: numbers of different units side by side must never read as one)

function numbersScene(view, stageId) {
  const stage = data.lookup('stages', stageId);
  view.setStage(stage);
  const rect = { ...GEO.BOSS_RECT };
  const pick = (name) => data.list('chess').find((c) => c.name === name && !c.isGolden);
  const op = (id, name, x, y) => { const c = pick(name); return c ? { id, kind: 'op', side: 'ally', defId: c.chessId, name, tier: c.tier, golden: false, spine: c.assets?.spine, avatar: c.assets?.avatar, x, y, facing: 1, dir: 'RIGHT', maxHp: 4000 } : null; };
  const en = (id, key, x, y, extra = {}) => { const e = data.lookup('enemies', key); return { id, kind: 'enemy', side: 'enemy', defId: key, name: e?.name || key, tier: 1, golden: false, spine: e?.spine || key, avatar: e?.iconId || key, x, y, facing: -1, maxHp: 6000, ...extra }; };
  const units = [
    op(1, '史尔特尔', 6, 3), op(2, '能天使', 5, 4), op(3, '莫斯提马', 5, 2), op(4, '白面鸮', 4, 3),
    en(20, 'enemy_1001_bigbo', 7.2, 3.1, { boss: true, maxHp: 400000 }),
    en(21, 'enemy_1007_slime', 7.35, 3.0), en(22, 'enemy_1007_slime', 7.1, 2.9), en(23, 'enemy_1000_gopro_2', 7.5, 3.2),
    en(24, 'enemy_1006_shield', 8.1, 3.05, { maxHp: 12000 }), en(25, 'enemy_1019_jshoot', 7.6, 4.1),
  ].filter(Boolean);
  view.enterBattle({ fieldId: 'nums', kind: 'boss', rect, stageId, units });
  view.setCamera('boss', { rect, side: 'L', half: true });
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const hp = new Map(units.map((u) => [u.id, u.maxHp]));
  const enemies = units.filter((u) => u.side === 'enemy');
  let t = 0, acc = 0;
  return {
    stageId, duration: 0, time: 0,
    tick(dt) {
      if (dt <= 0) return;
      acc += dt * 2;
      while (acc >= 0.1) {
        acc -= 0.1;
        t += 0.1;
        const ev = [];
        for (let k = 0; k < 3; k++) {
          const b = enemies[(rnd() * enemies.length) | 0];
          const boss = !!b.boss;
          const style = ['phys', 'arts', 'phys', 'true', 'burn'][(rnd() * 5) | 0];
          const n = boss ? 2000 + ((rnd() * 200000) | 0) : 40 + ((rnd() * 900) | 0);
          ev.push(['atk', units[(rnd() * 4) | 0].id, b.id, 'none'], ['dmg', b.id, n, style]);
          hp.set(b.id, Math.max(1, hp.get(b.id) - n * 0.02));
        }
        if (rnd() < 0.5) ev.push(['heal', units[(rnd() * 4) | 0].id, 60 + ((rnd() * 400) | 0)]);
        const tuples = units.map((u) => [u.id, u.x, u.y, hp.get(u.id), u.maxHp, 5, 20, u.side === 'enemy' && u.x < 7.4 ? 1 : 0, 0]);
        view.pushEvents({ t: 'b.ev', fieldId: 'nums', gt: t, ev });
        view.pushSnapshot({ t: 'b.snap', fieldId: 'nums', gt: t, units: tuples, dp: 10, killed: 0, total: 6 });
      }
    },
    stop() {},
  };
}

main().catch((err) => { log('FATAL', err.message); console.error(err); demo.error = err.message; });
