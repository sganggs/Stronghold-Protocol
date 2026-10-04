// DOM fallback for the Pixi field view (DESIGN §9 API). Used when public/js/render/app.js is missing or
// fails to initialise, so the match stays playable: a flat tile board + 整备区, pieces as avatars with
// tier chips, pointer drag & drop (same events as the render engine), and a simple battle view (units as
// avatars with HP/SP bars, interpolated by CSS transitions, optional damage numbers).
//
// API (same as createFieldView): setStage, setCamera, setPrep, enterBattle, pushSnapshot, pushEvents,
// highlightTiles, on, off, pieceScreenRect, resize, destroy (+ setSettings), plus the direction-step hooks of
// ui/facingWheel.js: tileScreen(row, col) (client geometry of a tile), holdPiece(uid, tile|null) (a dropped piece
// stays drawn on the target tile while its direction is chosen) and setPieceDir(uid, dir) (the facing wedge of a
// board piece). highlightTiles accepts `{ group }` styles: an empty list with a group clears only that group.
// setCamera('pen') shows the enemy preview pen (research 09 §2): the coming round's enemies (m.private.nextEnemies, or the
// scouted teammate's m.field { prep: true, nextEnemies }) placed
// like the official client and exactly where the render engine puts them (gameLogic penPlacement = render/pen.js
// layoutPen: rows 14–18 × cols 7–13, upper gate rows 17–18, lower gate 14–15, row 16 empty, ≤ 50 models, ≤ 3 per tile);
// tapping one emits pieceClick { enemyKey, preview: true, unit: { side: 'enemy', defId } }. setCamera('bossPrep') (the
// Final Assault prep) keeps the own board layout here — every coordinate the UI exchanges is a board coordinate anyway —
// but draws the tiles of the player's half of the boss field (gameLogic fieldTile, the legality the highlights use: act2
// m01's fence tiles are floor there, not the normal field's walls; user playtest #5 item 7).

import { render } from '../../vendor/preact.module.js';
import { html, TierChip } from './components.js';
import { GEO } from '../../../shared/constants.js';
import { chessAvatarUrl, itemIconUrl, tokenAvatarUrl, enemyIconUrl } from './assetUrls.js';
import { tileKey, hasFlag, UF, penPlacement, PEN, fieldTile } from './gameLogic.js';
import { T } from '../i18n.js';
const DRAG_PX = 6;
const DMG_TTL = 900;
const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Avatar URL for a UnitInfo `avatar` asset id (chars / E2 / tokens / enemies). */
function unitArt(m, info) {
  const id = info?.avatar || info?.defId;
  if (!m || !id) return null;
  if (info.side === 'enemy' || String(id).startsWith('enemy_')) return enemyIconUrl(m, id);
  if (String(id).startsWith('token_')) return tokenAvatarUrl(m, id);
  const chars = m.chars || {};
  if (chars[id]?.avatar) return chars[id].avatar;
  if (String(id).endsWith('_2') && chars[id.slice(0, -2)]) return chars[id.slice(0, -2)].avatarE2 || chars[id.slice(0, -2)].avatar;
  return null;
}

/** Look of the stage tile (row, col) on the fallback board (stage coordinates). */
export function fallbackTileClass(stage, row, col) {
  const rows = stage?.rows;
  const glyph = Array.isArray(rows) && typeof rows[row] === 'string' ? rows[row][col] : 'r';
  const t = stage?.tiles?.[glyph];
  if (glyph === 'S') return 'gate';
  if (glyph === 'E') return 'goal';
  if (!t) return 'void';
  if (t.tileKey === 'tile_forbidden') return 'void';
  if (t.height === 'HIGH') return t.buildable === 'NONE' ? 'void' : 'high';
  if (t.special === 'mire' || glyph === 'm') return 'mire';
  if (glyph === 'g') return 'smog';
  if (glyph === 'd') return 'deep';
  if (glyph === 'i') return 'infect';
  if (t.buildable === 'NONE') return 'lane';
  return 'floor';
}

/**
 * Create the DOM fallback view.
 * @param {HTMLElement} host
 * @param {{ data: any, assets?: any, settings?: any }} opts
 */
export function createFallbackView(host, opts = {}) {
  const dataStore = opts.data;
  const m = () => opts.assets || dataStore?.get?.('assets') || null;
  const lookup = (file, id) => dataStore?.lookup?.(file, id) ?? null;
  const listeners = new Map();
  const root = document.createElement('div');
  root.className = 'ff';
  host.appendChild(root);

  const st = {
    stage: null, camera: 'prep', rect: { ...GEO.NORMAL_RECT }, side: 'L', deployField: 'normal',
    mode: 'prep', priv: null, editable: false, canPlace: null,
    field: null, units: new Map(), snapUnits: new Map(), highlight: new Map(), hlGroups: new Map(), held: new Map(), dirs: new Map(),
    drag: null, hoverTarget: null, floats: [], settings: { damageNumbers: true, ...(opts.settings || {}) },
    size: { w: 0, h: 0 }, destroyed: false, pen: [],
  };

  const emit = (type, payload) => {
    for (const fn of [...(listeners.get(type) || [])]) {
      try { fn(payload); } catch (err) { console.error('[fallback-field] listener failed', err); }
    }
  };

  let raf = 0;
  const schedule = () => {
    if (raf || st.destroyed) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  };

  // ---- geometry ----------------------------------------------------------------------------------------
  function layout() {
    const w = st.size.w || host.clientWidth || 1;
    const h = st.size.h || host.clientHeight || 1;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
    const r = st.rect;
    const cols = r.c1 - r.c0 + 1;
    const prep = st.mode === 'prep';
    const hasTemp = prep && Array.isArray(st.priv?.temp) && st.priv.temp.some(Boolean);
    const rows = r.r1 - r.r0 + 1 + (prep ? 2.6 + (hasTemp ? 1.2 : 0) : 0); // + gap + hand (+ temp) rows
    // keep clear of the HUD: top bar + bond strip above, shop bar (prep) / switcher (combat) below
    const top0 = rem * 2.0;
    const bottom0 = h - rem * (prep ? 3.3 : 1.1);
    const availW = w * (prep ? 0.58 : 0.8);
    const availH = Math.max(rem, bottom0 - top0);
    const tile = Math.max(24, Math.floor(Math.min(availW / cols, availH / rows)));
    const bw = tile * cols;
    const bh = tile * rows;
    const left = Math.round(w * (prep ? 0.44 : 0.5) - bw / 2);
    const top = Math.round(top0 + (availH - bh) / 2);
    return { tile, left, top, cols, rows: r.r1 - r.r0 + 1, bw, bh };
  }

  const tilePos = (L, row, col) => ({ x: (col - st.rect.c0) * L.tile, y: (st.rect.r1 - row) * L.tile });
  const handPos = (L, idx) => ({ x: idx * L.tile, y: (L.rows + 0.6) * L.tile });
  const tempPos = (L, idx) => ({ x: (GEO.TEMP_C0 + idx) * L.tile, y: (L.rows + 1.72) * L.tile });

  // ---- pieces (prep) ---------------------------------------------------------------------------------------
  function pieceArt(p) {
    const mm = m();
    if (p.kind === 'item') return itemIconUrl(mm, lookup('items', p.id));
    if (p.kind === 'token') return tokenAvatarUrl(mm, p.id);
    return chessAvatarUrl(mm, lookup('chess', p.id));
  }
  function pieceName(p) {
    if (p.kind === 'item') return lookup('items', p.id)?.name || T('道具');
    if (p.kind === 'token') return lookup('tokens', p.id)?.name || T('召唤物');
    return lookup('chess', p.id)?.name || T('干员');
  }

  function Piece({ p, x, y, L, area }) {
    const src = pieceArt(p);
    const dragging = st.drag?.uid === p.uid && st.drag.moved;
    const golden = !!p.golden;
    const tier = p.tier || lookup('chess', p.id)?.tier || lookup('items', p.id)?.tier;
    const dir = st.dirs.get(p.uid) || (typeof p.dir === 'string' ? p.dir.toUpperCase() : 'RIGHT');
    const wedge = (area === 'board' || st.held.has(p.uid)) && p.kind !== 'item';
    return html`<div class=${cx('ff-piece', `ff-piece--${p.kind}`, golden && 'is-golden', dragging && 'is-lifted', st.editable && 'is-draggable', area === 'temp' && 'is-temp', wedge && `ff-dir--${dir.toLowerCase()}`)}
        data-uid=${p.uid} style=${`transform:translate(${x}px,${y}px);width:${L.tile}px;height:${L.tile}px`}
        onPointerDown=${(e) => onDown(e, p)} onContextMenu=${(e) => { e.preventDefault(); emit('pieceClick', { uid: p.uid, button: 2, clientX: e.clientX, clientY: e.clientY }); }}
        onPointerEnter=${() => emit('pieceHover', { uid: p.uid })} onPointerLeave=${() => emit('pieceHover', { uid: null })}
        title=${pieceName(p)}>
      <div class="ff-piece__art">${src ? html`<img src=${src} alt="" draggable=${false} />` : html`<span>${[...pieceName(p)][0]}</span>`}</div>
      ${tier && p.kind !== 'token' ? html`<${TierChip} tier=${tier} golden=${golden} size="sm" class="ff-piece__tier" />` : null}
      ${p.kind === 'chess' && Array.isArray(p.items) && p.items.length ? html`<div class="ff-piece__items">${p.items.slice(0, 2).map((it) => html`<i key=${it.uid}></i>`)}</div>` : null}
      ${p.kind === 'token' && p.count > 1 ? html`<b class="ff-piece__count">×${p.count}</b>` : null}
      ${wedge ? html`<i class="ff-piece__dir" aria-hidden="true"></i>` : null}
    </div>`;
  }

  function onDown(e, p) {
    if (e.button !== 0) return;
    e.preventDefault();
    st.drag = { uid: p.uid, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId, piece: p };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function targetAt(clientX, clientY) {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      if (!root.contains(el)) continue;
      const t = el.closest?.('[data-drop]');
      if (!t) continue;
      if (t.dataset.drop === 'board') return { area: 'board', row: Number(t.dataset.row), col: Number(t.dataset.col) };
      if (t.dataset.drop === 'hand') return { area: 'hand', idx: Number(t.dataset.idx) };
    }
    return { area: 'outside', clientX, clientY };
  }

  function onMove(e) {
    const d = st.drag;
    if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.sx, d.y - d.sy) > DRAG_PX) {
      if (!st.editable) return;
      d.moved = true;
      emit('pieceDragStart', { uid: d.uid });
    }
    if (d.moved) {
      const t = targetAt(e.clientX, e.clientY);
      st.hoverTarget = t;
      emit('tileHover', t.area === 'board' ? { row: t.row, col: t.col } : null);
      schedule();
    }
  }

  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  function onUp(e) {
    const d = st.drag;
    endDrag();
    st.drag = null;
    st.hoverTarget = null;
    if (!d) return;
    if (!d.moved) emit('pieceClick', { uid: d.uid, button: 0, clientX: e.clientX, clientY: e.clientY });
    else emit('pieceDrop', { uid: d.uid, target: targetAt(e.clientX, e.clientY) });
    schedule();
  }

  function onCancel() {
    const d = st.drag;
    endDrag();
    st.drag = null;
    st.hoverTarget = null;
    if (d?.moved) emit('pieceDrop', { uid: d.uid, target: { area: 'outside', clientX: -1, clientY: -1 } });
    schedule();
  }

  // ---- tiles ----------------------------------------------------------------------------------------------
  // the stage tile a board tile shows: in a boss round's prep the player's half of the boss field (fieldTile)
  function tileClass(row, col) {
    const [r, c] = st.mode === 'prep' ? fieldTile(st.deployField, row, col) : [row, col];
    return fallbackTileClass(st.stage, r, c);
  }

  function dropState(target) {
    if (!st.drag?.moved || !target || typeof st.canPlace !== 'function') return null;
    try { return st.canPlace(st.drag.uid, target) ? 'legal' : 'illegal'; } catch { return null; }
  }

  // ---- battle ---------------------------------------------------------------------------------------------------
  function BattleUnit({ id, L }) {
    const info = st.units.get(id);
    const s = st.snapUnits.get(id);
    if (!info || !s) return null;
    const [, x, y, hp, maxHp, sp, spMax, flags, anim] = s;
    const px = (x - st.rect.c0 + 0.5) * L.tile;
    const py = (st.rect.r1 - y + 0.5) * L.tile;
    const enemy = info.side === 'enemy';
    const size = info.boss ? L.tile * 1.3 : L.tile * 0.86;
    const src = unitArt(m(), info);
    const dead = anim === 4;
    const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
    const spPct = spMax > 0 ? Math.max(0, Math.min(100, (sp / spMax) * 100)) : 0;
    return html`<div class=${cx('ff-unit', enemy ? 'is-enemy' : 'is-ally', info.golden && 'is-golden', info.boss && 'is-boss', dead && 'is-dead',
        hasFlag(flags, UF.SKILL) && 'is-skill', hasFlag(flags, UF.STUNNED | UF.FROZEN | UF.SLEEP) && 'is-stunned', hasFlag(flags, UF.FLYING) && 'is-fly')}
        style=${`transform:translate(${px - size / 2}px,${py - size / 2}px);width:${size}px;height:${size}px`}
        onPointerDown=${(e) => { if (e.button === 0) emit('pieceClick', { unitId: id, uid: info.uid ?? null, unit: info, button: 0, clientX: e.clientX, clientY: e.clientY }); }}
        onContextMenu=${(e) => { e.preventDefault(); emit('pieceClick', { unitId: id, uid: info.uid ?? null, unit: info, button: 2, clientX: e.clientX, clientY: e.clientY }); }}>
      <div class="ff-unit__art">${src ? html`<img src=${src} alt="" draggable=${false} />` : html`<span>${[...(info.name || '?')][0]}</span>`}</div>
      <div class="ff-unit__bars"><i class="hp" style=${`width:${hpPct}%`}></i>${!enemy && spMax > 0 ? html`<i class="sp" style=${`width:${spPct}%`}></i>` : null}</div>
    </div>`;
  }

  // ---- enemy preview pen (setCamera('pen')) ------------------------------------------------------------------------
  function penView() {
    const w = st.size.w || host.clientWidth || 1;
    const h = st.size.h || host.clientHeight || 1;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
    const cols = PEN.c1 - PEN.c0 + 1;
    const rows = PEN.r1 - PEN.r0 + 1;
    const top0 = rem * 1.3;
    const tile = Math.max(28, Math.floor(Math.min((w * 0.62) / cols, (h - top0 - rem * 0.5) / rows)));
    const bw = tile * cols;
    const left = Math.round(w / 2 - bw / 2);
    const top = Math.round(top0 + (h - top0 - rem * 0.5 - tile * rows) / 2);
    const models = penPlacement(st.pen, { stage: st.stage });
    const cells = [];
    for (let r = PEN.r1; r >= PEN.r0; r--) {
      for (let c = PEN.c0; c <= PEN.c1; c++) {
        // the pen's own start tiles (15,7) / (18,7) are its gates (research 09 §2.1)
        const gate = c === PEN.c0 && (r === PEN.anchors.upper[0] || r === PEN.anchors.lower[0]);
        const cls = gate ? 'gate' : r === PEN.emptyRow ? 'void' : 'floor';
        cells.push(html`<div key=${`${r},${c}`} class=${cx('ff-tile', `ff-tile--${cls}`)}
          style=${`transform:translate(${(c - PEN.c0) * tile}px,${(PEN.r1 - r) * tile}px);width:${tile}px;height:${tile}px`}></div>`);
      }
    }
    const size = tile * 0.62;
    const off = [[0, 0], [-0.22, 0.14], [0.22, 0.14], [-0.2, -0.16], [0.2, -0.16]];
    const figs = models.map((mdl) => {
      const o = off[mdl.slot % off.length];
      const x = (mdl.col - PEN.c0 + 0.5 + o[0]) * tile - size / 2;
      const y = (PEN.r1 - mdl.row + 0.5 + o[1]) * tile - size / 2;
      const src = unitArt(m(), { side: 'enemy', defId: mdl.enemyKey, avatar: mdl.enemyKey });
      const name = lookup('enemies', mdl.enemyKey)?.name || mdl.enemyKey;
      const tap = (e) => { if (e.button == null || e.button === 0) emit('pieceClick', { enemyKey: mdl.enemyKey, preview: true, unit: { side: 'enemy', defId: mdl.enemyKey, name }, button: 0, clientX: e.clientX, clientY: e.clientY }); };
      return html`<button key=${mdl.k} type="button" class=${cx('ff-unit', 'is-enemy', 'ff-pen__enemy', (mdl.elite || mdl.boss) && 'is-boss', mdl.fly && 'is-fly')}
          data-enemy=${mdl.enemyKey} title=${name} aria-label=${name}
          style=${`transform:translate(${x}px,${y}px);width:${size}px;height:${size}px;z-index:${10 + mdl.slot}`} onClick=${tap}>
        <div class="ff-unit__art">${src ? html`<img src=${src} alt="" draggable=${false} />` : html`<span>${[...name][0]}</span>`}</div>
      </button>`;
    });
    return html`<div class="ff-board ff-board--pen" style=${`left:${left}px;top:${top}px;width:${bw}px;height:${tile * rows}px;--tile:${tile}px`}>
      ${cells}${figs}
      ${models.length ? null : html`<p class="ff-pen__empty">${T('暂无敌方情报')}</p>`}
    </div>`;
  }

  // ---- paint -----------------------------------------------------------------------------------------------------
  function paint() {
    if (st.destroyed) return;
    const L = layout();
    const r = st.rect;
    const tiles = [];
    for (let row = r.r1; row >= r.r0; row--) {
      for (let col = r.c0; col <= r.c1; col++) {
        const p = tilePos(L, row, col);
        const k = tileKey(row, col);
        let hl = st.highlight.get(k);
        for (const g of st.hlGroups.values()) if (g.tiles.has(k)) hl = g.name;
        const hov = st.hoverTarget?.area === 'board' && st.hoverTarget.row === row && st.hoverTarget.col === col ? dropState(st.hoverTarget) : null;
        tiles.push(html`<div key=${k} class=${cx('ff-tile', `ff-tile--${tileClass(row, col)}`, hl && `is-${hl}`, hov && `is-hover-${hov}`)}
          data-drop="board" data-row=${row} data-col=${col}
          style=${`transform:translate(${p.x}px,${p.y}px);width:${L.tile}px;height:${L.tile}px`}></div>`);
      }
    }
    const pieces = [];
    const hand = [];
    const now = performance.now();
    if (st.mode === 'prep' && st.priv) {
      const heldPos = (p) => { const t = st.held.get(p.uid); return t ? tilePos(L, t.row, t.col) : null; };
      for (const p of Array.isArray(st.priv.board) ? st.priv.board : []) {
        if (!p || !Number.isInteger(p.row)) continue;
        const pos = heldPos(p) || tilePos(L, p.row, p.col);
        pieces.push(html`<${Piece} key=${p.uid} p=${p} x=${pos.x} y=${pos.y} L=${L} area="board" />`);
      }
      for (let i = 0; i < GEO.HAND_SIZE; i++) {
        const pos = handPos(L, i);
        const hov = st.hoverTarget?.area === 'hand' && st.hoverTarget.idx === i ? dropState(st.hoverTarget) : null;
        hand.push(html`<div key=${`h${i}`} class=${cx('ff-slot', hov && `is-hover-${hov}`)} data-drop="hand" data-idx=${i}
          style=${`transform:translate(${pos.x}px,${pos.y}px);width:${L.tile}px;height:${L.tile}px`}><span class="num">${i + 1}</span></div>`);
        const p = st.priv.hand?.[i];
        if (p) { const hp = heldPos(p) || pos; pieces.push(html`<${Piece} key=${p.uid} p=${p} x=${hp.x} y=${hp.y} L=${L} area="hand" />`); }
      }
      const temp = Array.isArray(st.priv.temp) ? st.priv.temp : [];
      if (temp.some(Boolean)) {
        for (let i = 0; i < GEO.TEMP_SIZE; i++) {
          const pos = tempPos(L, i);
          hand.push(html`<div key=${`t${i}`} class="ff-slot ff-slot--temp" style=${`transform:translate(${pos.x}px,${pos.y}px);width:${L.tile}px;height:${L.tile}px`}></div>`);
          const p = temp[i];
          if (p) { const hp = heldPos(p) || pos; pieces.push(html`<${Piece} key=${p.uid} p=${p} x=${hp.x} y=${hp.y} L=${L} area="temp" />`); }
        }
      }
    }
    const units = st.mode === 'battle' ? [...st.snapUnits.keys()].map((id) => html`<${BattleUnit} key=${id} id=${id} L=${L} />`) : null;
    st.floats = st.floats.filter((f) => now - f.at < DMG_TTL);
    const floats = st.mode === 'battle' && st.settings.damageNumbers ? st.floats.map((f) => {
      const s = st.snapUnits.get(f.id);
      if (!s) return null;
      const px = (s[1] - r.c0 + 0.5) * L.tile;
      const py = (r.r1 - s[2] + 0.5) * L.tile - L.tile * 0.4;
      return html`<span key=${f.key} class=${`ff-float ff-float--${f.type}`} style=${`left:${px}px;top:${py}px`}>${f.text}</span>`;
    }) : null;
    const d = st.drag;
    const ghost = d?.moved ? (() => {
      const hr = root.getBoundingClientRect();
      const src = pieceArt(d.piece);
      return html`<div class=${cx('ff-ghost', d.piece.golden && 'is-golden')} style=${`left:${d.x - hr.left - L.tile / 2}px;top:${d.y - hr.top - L.tile / 2}px;width:${L.tile}px;height:${L.tile}px`}>
        ${src ? html`<img src=${src} alt="" />` : null}</div>`;
    })() : null;
    if (st.camera === 'pen') { render(html`${penView()}<div class="ff-badge">SIMPLIFIED VIEW</div>`, root); return; }
    render(html`<div class=${cx('ff-board', `ff-board--${st.mode}`, `ff-cam--${st.camera}`)} style=${`left:${L.left}px;top:${L.top}px;width:${L.bw}px;height:${L.bh}px;--tile:${L.tile}px`}>
      ${st.mode === 'prep' ? html`<div class="ff-hand-label" style=${`top:${(L.rows + 0.18) * L.tile}px`}><span>${T('整备区')}</span><i></i></div>` : null}
      ${tiles}${hand}${units}${pieces}${floats}
    </div>${ghost}
    <div class="ff-badge">SIMPLIFIED VIEW</div>`, root);
    if (st.floats.length) schedule();
  }

  // ---- public API -------------------------------------------------------------------------------------------------
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => view.resize()) : null;
  ro?.observe(host);

  const view = {
    kind: 'fallback',
    setStage(stage) { st.stage = stage || null; schedule(); },
    setCamera(kind, o = {}) {
      st.camera = kind || 'prep';
      if (kind === 'pen') { schedule(); return; } // the board keeps its rect for the way back
      if (o && o.rect && Number.isFinite(o.rect.r0)) st.rect = { ...o.rect };
      else if (kind === 'prep' || kind === 'bossPrep' || kind === 'normal') st.rect = { ...GEO.NORMAL_RECT };
      st.deployField = kind === 'bossPrep' ? (o?.side === 'R' ? 'bossR' : 'bossL') : 'normal';
      if (kind === 'bossPrep') st.camera = 'prep';
      else if (kind === 'unite') st.rect = { ...GEO.UNITE_RECT };
      else if (kind === 'boss') st.rect = { ...GEO.BOSS_RECT };
      st.side = o?.side || 'L';
      schedule();
    },
    setPrep(priv, o = {}) {
      st.mode = 'prep';
      st.priv = priv || null;
      st.pen = Array.isArray(priv?.nextEnemies) ? priv.nextEnemies : [];
      st.editable = !!o.editable;
      st.canPlace = typeof o.canPlace === 'function' ? o.canPlace : null;
      if (st.camera !== 'prep' && st.camera !== 'pen') { st.camera = 'prep'; st.rect = { ...GEO.NORMAL_RECT }; }
      if (!st.editable && st.drag) { endDrag(); st.drag = null; st.hoverTarget = null; }
      schedule();
    },
    enterBattle(field) {
      st.mode = 'battle';
      st.field = field || null;
      // a scouted teammate's prep board brings their pen; a real battle empties it
      st.pen = field?.prep && Array.isArray(field.nextEnemies) ? field.nextEnemies : [];
      st.units.clear();
      st.snapUnits.clear();
      st.floats = [];
      if (field?.rect && Number.isFinite(field.rect.r0)) st.rect = { ...field.rect };
      for (const u of Array.isArray(field?.units) ? field.units : []) if (u && u.id != null) {
        st.units.set(u.id, u);
        st.snapUnits.set(u.id, [u.id, u.x, u.y, u.maxHp, u.maxHp, 0, 0, 0, 0]);
      }
      schedule();
    },
    pushSnapshot(snap) {
      if (st.mode !== 'battle' || !snap || !Array.isArray(snap.units)) return;
      if (st.field && snap.fieldId && st.field.fieldId && snap.fieldId !== st.field.fieldId) return;
      const seen = new Set();
      for (const t of snap.units) {
        if (!Array.isArray(t) || t.length < 9) continue;
        seen.add(t[0]);
        st.snapUnits.set(t[0], t);
      }
      for (const id of [...st.snapUnits.keys()]) if (!seen.has(id)) st.snapUnits.delete(id);
      schedule();
    },
    pushEvents(payload) {
      const ev = Array.isArray(payload) ? payload : payload && Array.isArray(payload.ev) ? payload.ev : null;
      if (!ev) return;
      if (!Array.isArray(payload) && st.field?.fieldId && payload.fieldId && payload.fieldId !== st.field.fieldId) return;
      const now = performance.now();
      for (const e of ev) {
        if (!Array.isArray(e)) continue;
        if (e[0] === 'spawn' && e[1] && e[1].id != null) {
          st.units.set(e[1].id, e[1]);
          if (!st.snapUnits.has(e[1].id)) st.snapUnits.set(e[1].id, [e[1].id, e[1].x, e[1].y, e[1].maxHp, e[1].maxHp, 0, 0, 0, 6]);
        } else if ((e[0] === 'dmg' || e[0] === 'heal') && st.settings.damageNumbers && st.floats.length < 60) {
          const amount = Math.round(Number(e[2]) || 0);
          if (amount <= 0) continue;
          const type = e[0] === 'heal' ? 'heal' : (e[3] === 'arts' ? 'arts' : e[3] === 'true' ? 'true' : 'phys');
          st.floats.push({ key: `${now}:${Math.random()}`, id: e[1], text: e[0] === 'heal' ? `+${amount}` : String(amount), type, at: now });
        }
      }
      schedule();
    },
    highlightTiles(tiles, style) {
      if (!tiles || !style) { st.highlight.clear(); st.hlGroups.clear(); schedule(); return; }
      if (typeof style === 'object' && style.group) {
        // a named group (direction wheel / selected unit range): replaced as a whole, drawn as a range tile
        const set = new Set();
        for (const t of Array.isArray(tiles) ? tiles : []) {
          const row = Array.isArray(t) ? t[0] : t?.row;
          const col = Array.isArray(t) ? t[1] : t?.col;
          if (Number.isInteger(row) && Number.isInteger(col)) set.add(tileKey(row, col));
        }
        if (set.size) st.hlGroups.set(style.group, { name: 'range', tiles: set }); else st.hlGroups.delete(style.group);
        schedule();
        return;
      }
      for (const t of Array.isArray(tiles) ? tiles : []) {
        const row = Array.isArray(t) ? t[0] : t?.row;
        const col = Array.isArray(t) ? t[1] : t?.col;
        if (Number.isInteger(row) && Number.isInteger(col)) st.highlight.set(tileKey(row, col), style);
      }
      schedule();
    },
    setSettings(s) { st.settings = { ...st.settings, ...(s || {}) }; schedule(); },
    on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    pieceScreenRect(uid) {
      const el = root.querySelector(`[data-uid="${Number(uid)}"]`);
      return el ? el.getBoundingClientRect() : null;
    },
    /** Client geometry of a tile: centre, px per tile, corners (board tiles and 整备区 slots of the prep layout). */
    tileScreen(row, col) {
      const L = layout();
      const br = root.querySelector('.ff-board')?.getBoundingClientRect();
      if (!br) return null;
      let p = null;
      if (row === GEO.HAND_ROW && col >= 0 && col < GEO.HAND_SIZE && st.mode === 'prep') p = handPos(L, col);
      else if (row === GEO.TEMP_ROW && col >= GEO.TEMP_C0 && col < GEO.TEMP_C0 + GEO.TEMP_SIZE && st.mode === 'prep') p = tempPos(L, col - GEO.TEMP_C0);
      else if (row >= st.rect.r0 && row <= st.rect.r1 && col >= st.rect.c0 && col <= st.rect.c1) p = tilePos(L, row, col);
      if (!p) return null;
      const x0 = br.left + p.x, y0 = br.top + p.y, s = L.tile;
      return { x: x0 + s / 2, y: y0 + s / 2, s, poly: [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]] };
    },
    holdPiece(uid, tile) {
      if (tile && Number.isInteger(tile.row) && Number.isInteger(tile.col)) st.held.set(uid, { row: tile.row, col: tile.col });
      else st.held.delete(uid);
      schedule();
    },
    setPieceDir(uid, dir) {
      const d = typeof dir === 'string' ? dir.toUpperCase() : null;
      if (d && ['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(d)) st.dirs.set(uid, d); else st.dirs.delete(uid);
      schedule();
    },
    resize() {
      st.size = { w: host.clientWidth, h: host.clientHeight };
      schedule();
    },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      endDrag();
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      try { render(null, root); } catch { /* ignore */ }
      root.remove();
      listeners.clear();
    },
  };
  view.resize();
  return view;
}
