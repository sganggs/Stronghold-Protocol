// Host test console (DESIGN §34.8 phase 2). Shown only when m.public.test is true and the viewer is the
// room host. Commands go out as g.test; the server applies them. The studio battle sandbox is a different
// page and does not touch this match.
//
// [ASSUMED] The panel is a floating field panel, collapsed to a 测试 button until the host opens it. The open
// state and the dragged position are remembered in this browser (localStorage, try/catch). Backquote toggles
// it and is ignored while typing and when that key is bound to a game shortcut. Escape closes it. Enter in a
// field runs the command. The host drags it by the header. The default sits on the field only (right of the
// team roster, below the bond strip, above the hand) at 1280×720 and 1920×1080. At ≤720px it stays the top sheet.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { data, useData } from '../data.js';
import { net } from '../net.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';
import { actionForKey } from './gameLogic/shortcuts.js';
import { settingsStore } from './settings.js';
import { formatAuditLine, newestFirst, testRefusalText } from './testAudit.js';
import { clampDock, dockHome, dockMetricsFromStyle, DOCK_REM, readDockPos, writeDockPos } from './testDock.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const DOCK_KEY = 'sp.testConsoleOpen';

function storedOpen() {
  try { return globalThis.localStorage?.getItem(DOCK_KEY) === '1'; } catch { return false; }
}
function rememberOpen(open) {
  try { globalThis.localStorage?.setItem(DOCK_KEY, open ? '1' : '0'); } catch { /* private mode */ }
}

/** The amber 测试 mark on a room card, the HUD, the step header and the result. */
export function TestMark({ class: cls = '' }) {
  return html`<span class=${cx('testmark', cls)} data-testid="test-mark">${t('测试')}</span>`;
}

function num(raw) {
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** `chess:id,item:id` → slots, or null when the text is not that shape. */
function shopSlots(raw) {
  const parts = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const slots = [];
  for (const part of parts) {
    const i = part.indexOf(':');
    if (i <= 0) return null;
    const kind = part.slice(0, i);
    const id = part.slice(i + 1).trim();
    if ((kind !== 'chess' && kind !== 'item') || !id) return null;
    slots.push({ kind, id });
  }
  return slots;
}

function typingTarget(el) {
  const tag = el && typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}

function pieceName(id) {
  const rec = (data.get('chess') || {})[id] || (data.get('tokens') || {})[id];
  return data.localeName(rec?.name || id || '');
}

/** Placeable tokens of chess the host already holds. Suggestions only; the server still checks. */
function ownedTokenIds(owned) {
  const chess = data.get('chess') || {};
  const tokens = data.get('tokens') || {};
  const ids = [];
  const seen = new Set();
  for (const p of owned) {
    const rec = chess[p?.id];
    for (const tid of rec?.tokens || []) {
      const tok = tokens[tid];
      if (!tok || tok.kind !== 'summon' || tok.placeable !== true || seen.has(tid)) continue;
      seen.add(tid);
      ids.push(tid);
    }
  }
  return ids;
}

/**
 * Collapsible host dock. Returns null unless this match is a test match and the viewer commands it.
 */
export function TestConsole() {
  const pub = useStore((s) => s.match.public);
  useData('chess', 'items', 'tokens', 'bonds', 'bands', 'enemies');
  const mine = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const hostId = useStore((s) => s.room && s.room.hostId);
  const [open, setOpenState] = useState(storedOpen);
  const [cmd, setCmd] = useState('funds');
  const [amount, setAmount] = useState('0');
  const [id, setId] = useState('');
  const [ownerUid, setOwnerUid] = useState('');
  const [layers, setLayers] = useState('0');
  const [resetLp, setResetLp] = useState(false);
  const [round, setRound] = useState('1');
  const [count, setCount] = useState('0');
  const [shop, setShop] = useState('');
  const [choiceIdx, setChoiceIdx] = useState('0');
  const [choiceId, setChoiceId] = useState('');
  const dock = useRef(null);
  const [sheet, setSheet] = useState(false);
  const [box, setBox] = useState(null);
  const boxRef = useRef(null);
  boxRef.current = box;
  const dragRef = useRef(null);
  useEffect(() => {
    const place = () => {
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      if (vw <= 720) { setSheet(true); setBox(null); return; }
      let metrics = DOCK_REM;
      try {
        const host = document.querySelector('.gm') || dock.current;
        if (host) metrics = dockMetricsFromStyle(getComputedStyle(host));
      } catch { metrics = DOCK_REM; }
      // the real layout root (界面大小's --sp-ui and the 异形屏适配 box included), as fieldHost.js / settle.js read it
      let rem;
      try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 0; } catch { rem = 0; }
      const home = dockHome({ width: vw, height: vh, rem }, metrics);
      if (home.sheet) { setSheet(true); setBox(null); return; }
      setSheet(false);
      const stored = readDockPos(globalThis.localStorage);
      const pos = clampDock(stored || { x: home.x, y: home.y }, { width: vw, height: vh }, home);
      setBox({ x: pos.x, y: pos.y, width: home.width, height: home.height });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);
  const setOpen = (next) => {
    setOpenState((cur) => {
      const value = typeof next === 'function' ? next(cur) : next;
      rememberOpen(value);
      return value;
    });
  };
  const runRef = useRef(() => {});
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const onKey = (e) => {
      if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      const typing = typingTarget(el);
      if (e.key === 'Escape') {
        if (!openRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (typing) {
        if (e.key === 'Enter' && dock.current && dock.current.contains(el) && el.tagName !== 'TEXTAREA') {
          e.preventDefault();
          e.stopPropagation();
          runRef.current();
        }
        return;
      }
      if (e.repeat || e.code !== 'Backquote') return;
      if (actionForKey(e, settingsStore.get()?.keys)) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (!pub || pub.test !== true || !myId || myId !== hostId) return null;
  const table = { chess: 'chess', item: 'items', token: 'tokens', bond: 'bonds', strategy: 'bands', bounty: 'enemies' }[cmd];
  const owned = [...(mine?.hand || []), ...(mine?.temp || []), ...(mine?.board || []).map((x) => x.piece || x)].filter((x) => x?.kind === 'chess');
  const tokenIds = cmd === 'token' ? ownedTokenIds(owned) : null;
  const choices = tokenIds
    ? tokenIds.map((key) => [key, (data.get('tokens') || {})[key] || {}])
    : Object.entries(table ? data.get(table) || {} : {});
  const names = new Map((pub.players || []).map((p) => [p.playerId, p.name]));
  const log = newestFirst(pub.testLog);
  const send = (command, args) => {
    const fields = { cmd: command };
    if (args && Object.keys(args).length) fields.args = args;
    return net.request('g.test', fields).catch((err) => {
      toast(testRefusalText(err), 'error');
    });
  };
  // send is used by run(), which closed over the previous send. Rebind by calling the latest via ref.
  runRef.current = () => {
    const go = send;
    if (cmd === 'funds' || cmd === 'lp' || cmd === 'hp' || cmd === 'teamLp') {
      const n = num(amount);
      if (n == null) return toast(t('无效的目标'), 'error');
      return go(cmd, { [cmd === 'funds' ? 'amount' : 'value']: n });
    }
    if (cmd === 'chess' || cmd === 'item' || cmd === 'bounty') {
      if (!id.trim()) return toast(t('无效的目标'), 'error');
      return go(cmd, { [cmd === 'bounty' ? 'enemyKey' : 'id']: id.trim() });
    }
    if (cmd === 'token') {
      const uid = num(ownerUid);
      if (!id.trim() || uid == null) return toast(t('无效的目标'), 'error');
      return go('token', { id: id.trim(), ownerUid: uid });
    }
    if (cmd === 'bond') {
      const n = num(layers);
      const extra = num(count);
      if (!id.trim() || n == null || extra == null) return toast(t('无效的目标'), 'error');
      return go('bond', { id: id.trim(), layers: n, count: extra });
    }
    if (cmd === 'strategy') {
      if (!id.trim()) return toast(t('无效的目标'), 'error');
      const args = { id: id.trim() };
      if (resetLp) args.resetLp = true;
      return go('strategy', args);
    }
    if (cmd === 'round') {
      const n = num(round);
      if (n == null) return toast(t('无效的目标'), 'error');
      return go('round', { round: n });
    }
    if (cmd === 'shop') {
      const slots = shopSlots(shop);
      if (!slots) return toast(t('无效的目标'), 'error');
      return go('shop', { slots });
    }
    if (cmd === 'choice') {
      const n = num(choiceIdx);
      if (n == null) return toast(t('无效的目标'), 'error');
      const args = { idx: n };
      if (choiceId.trim()) args.choiceId = choiceId.trim();
      return go('choice', args);
    }
    if (cmd === 'level') return go('level', {});
    return null;
  };
  const style = !sheet && box ? {
    left: `${box.x}px`, top: `${box.y}px`,
    ...(open ? { width: `${box.width}px`, maxHeight: `${box.height}px` } : {}),
  } : undefined;
  const onHeadDown = (e) => {
    if (sheet || !boxRef.current || (e.button != null && e.button !== 0)) return;
    const target = e.target;
    if (target && typeof target.closest === 'function' && target.closest('button, a, input, select, textarea')) return;
    const rect = dock.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onHeadMove = (e) => {
    const d = dragRef.current;
    const cur = boxRef.current;
    if (!d || e.pointerId !== d.id || !cur) return;
    const height = dock.current?.offsetHeight || cur.height;
    const pos = clampDock(
      { x: e.clientX - d.dx, y: e.clientY - d.dy },
      { width: window.innerWidth, height: window.innerHeight },
      { width: cur.width, height },
    );
    setBox({ ...cur, x: pos.x, y: pos.y });
  };
  const onHeadUp = (e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    const cur = boxRef.current;
    if (cur) writeDockPos(cur, globalThis.localStorage);
  };
  return html`<aside class=${cx('testconsole', open && 'is-open', sheet && 'is-sheet')} data-testid="test-console" ref=${dock} style=${style}>
    <button type="button" class="testconsole__tab" aria-expanded=${open ? 'true' : 'false'} title=${t('按反引号键（Backquote）开关测试面板')} onClick=${() => setOpen(!open)}>
      ${open ? t('收起') : t('测试')}
    </button>
    ${open ? html`<div class="testconsole__body">
      <header class="testconsole__head" onPointerDown=${onHeadDown} onPointerMove=${onHeadMove} onPointerUp=${onHeadUp} onPointerCancel=${onHeadUp}>
        <${TestMark} />
        <b>${t('测试指令')}</b>
        <span class="t-dim">${t('已执行 {n} 次', { n: pub.testActions | 0 })}</span>
      </header>
      <div class="testconsole__row">
        <button type="button" onClick=${() => send('timers', { on: false })}>${t('关闭计时')}</button>
        <button type="button" onClick=${() => send('timers', { on: true })}>${t('开启计时')}</button>
        <span class="t-dim">${pub.testTimers === false ? t('计时已关闭') : t('计时进行中')}</span>
      </div>
      <div class="testconsole__row">
        <button type="button" onClick=${() => send('phase', { name: 'advance' })}>${t('继续被暂停的阶段')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'battleCheck' })}>${t('结束策略选择')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'prep' })}>${t('进入休整')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'sp' })}>${t('进入机变')}</button>
        <button type="button" onClick=${() => send('phase', { name: 'combat' })}>${t('开始作战')}</button>
      </div>
      <label class="testconsole__field">${t('测试指令')}
        <select value=${cmd} onChange=${(e) => setCmd(e.target.value)}>
          <option value="funds">${t('资金')}</option>
          <option value="chess">${t('干员')}</option>
          <option value="item">${t('装备')}</option>
          <option value="token">${t('召唤物')}</option>
          <option value="lp">${t('目标生命')}</option>
          <option value="hp">${t('领袖生命')}</option>
          <option value="teamLp">${t('队伍生命')}</option>
          <option value="round">${t('回合')}</option>
          <option value="shop">${t('下一轮商店')}</option>
          <option value="bond">${t('盟约')}</option>
          <option value="strategy">${t('策略')}</option>
          <option value="level">${t('升级调度中心')}</option>
          <option value="bounty">${t('悬赏目标')}</option>
          <option value="choice">${t('机变')}</option>
        </select>
      </label>
      <div class="testconsole__row">
      ${cmd === 'funds' || cmd === 'lp' || cmd === 'hp' || cmd === 'teamLp' ? html`<label class="testconsole__field">${cmd === 'funds' ? t('资金') : cmd === 'lp' ? t('目标生命') : cmd === 'hp' ? t('领袖生命') : t('队伍生命')}
        <input value=${amount} onInput=${(e) => setAmount(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'chess' || cmd === 'item' || cmd === 'bond' || cmd === 'strategy' || cmd === 'bounty' || cmd === 'token' ? html`<label class="testconsole__field">${cmd === 'item' ? t('装备') : cmd === 'bond' ? t('盟约') : cmd === 'strategy' ? t('策略') : cmd === 'bounty' ? t('悬赏目标') : cmd === 'token' ? t('召唤物') : t('干员')}
        <input list="test-content-ids" value=${id} onInput=${(e) => setId(e.target.value)} />
      </label>` : null}
      ${cmd === 'token' ? html`<label class="testconsole__field">${t('所属棋子 uid')}
        <input list="test-owner-uids" value=${ownerUid} onInput=${(e) => setOwnerUid(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'bond' ? html`<label class="testconsole__field">${t('额外盟约人数')}<input value=${count} onInput=${(e) => setCount(e.target.value)} inputmode="numeric" /></label><label class="testconsole__field">${t('层数')}
        <input value=${layers} onInput=${(e) => setLayers(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'strategy' ? html`<label class="testconsole__check"><input type="checkbox" checked=${resetLp} onChange=${(e) => setResetLp(e.target.checked)} />${t('重置为目标生命初始值')}</label>` : null}
      ${cmd === 'round' ? html`<label class="testconsole__field">${t('回合')}
        <input value=${round} onInput=${(e) => setRound(e.target.value)} inputmode="numeric" />
      </label>` : null}
      ${cmd === 'shop' ? html`<label class="testconsole__field">${t('下一轮商店')}
        <input value=${shop} placeholder="chess:id,item:id" onInput=${(e) => setShop(e.target.value)} />
      </label>` : null}
      ${cmd === 'choice' ? html`<label class="testconsole__field">${t('机变序号')}
        <input value=${choiceIdx} onInput=${(e) => setChoiceIdx(e.target.value)} inputmode="numeric" aria-label=${t('机变序号')} />
      </label><label class="testconsole__field">${t('机变选项')}
        <input value=${choiceId} onInput=${(e) => setChoiceId(e.target.value)} aria-label=${t('机变选项')} />
      </label>` : null}
      <button type="button" class="testconsole__run" onClick=${() => runRef.current()}>${t('执行')}</button>
      </div>
      <datalist id="test-content-ids">${choices.map(([key, rec]) => html`<option key=${key} value=${key}>${data.localeName(rec.name || key)}</option>`)}</datalist>
      <datalist id="test-owner-uids">${owned.map((p) => html`<option key=${p.uid} value=${p.uid}>${pieceName(p.id)} ${p.uid}</option>`)}</datalist>
      <ul class="testconsole__log">
        ${log.length ? log.map((e) => html`<li key=${e.seq} class=${e.ok ? 'is-ok' : 'is-bad'}>${formatAuditLine(e, names.get(e.playerId))}</li>`) : html`<li class="t-dim">${t('尚无测试指令')}</li>`}
      </ul>
    </div>` : null}
  </aside>`;
}
