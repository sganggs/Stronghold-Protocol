// Title-screen connectivity check. Each row is one stage: signaling, one STUN server, then
// a data channel to a second browser. The detail line says which stage stopped.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { toast } from './toasts.js';
import { signalingUrl } from '../p2p/boot.js';
import { STUN_SERVERS, makeProbeRoom, runLinkProbe } from '../p2p/probe.js';

const ROOM_RE = /^[A-Z0-9]{4,8}$/;

function initialRows() {
  return [
    { id: 'signal', label: '信令', state: 'wait', detail: '还没检测' },
    ...STUN_SERVERS.map((server) => ({ id: server.id, label: server.label, state: 'wait', detail: '还没检测' })),
    { id: 'peer', label: '与同伴直连', state: 'wait', detail: '还没检测' },
  ];
}

const STATE_TEXT = { wait: '未测', run: '检测中', ok: '通', bad: '不通' };

/**
 * @param {{ rows: { id: string, label: string, state: string, detail: string }[], room: string }} report
 */
export function formatProbeReport(report) {
  const lines = report.room ? [`测试号 ${report.room}`] : [];
  for (const row of report.rows) lines.push(`${row.label}：${STATE_TEXT[row.state] || row.state}　${row.detail}`);
  return lines.join('\n');
}

/** @param {{ class?: string }} [props] */
export function LinkProbe({ class: cls = '' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [room, setRoom] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [rows, setRows] = useState(() => initialRows());
  const stopRef = useRef(/** @type {null | (() => void)} */ (null));

  useEffect(() => () => { stopRef.current?.(); }, []);

  const patch = (id, next) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...next } : row)));
  };

  const run = async (code) => {
    const chosen = String(code || '').trim().toUpperCase();
    if (code != null && code !== '' && !ROOM_RE.test(chosen)) {
      toast('测试号是 4 到 8 位字母或数字', 'warn');
      return;
    }
    stopRef.current?.();
    const ctrl = new AbortController();
    stopRef.current = () => ctrl.abort();
    const nextRoom = chosen || makeProbeRoom();
    setRoom(nextRoom);
    setRows(initialRows());
    setOpen(true);
    setBusy(true);
    try {
      await runLinkProbe({
        signalingUrl: signalingUrl(),
        room: nextRoom,
        signal: ctrl.signal,
        onStep: patch,
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = formatProbeReport({ rows, room });
    try {
      await navigator.clipboard.writeText(text);
      toast('检测结果已复制', 'success');
    } catch {
      toast('复制失败，请手动选择结果', 'warn');
    }
  };

  return html`<div class=${`title-probe ${cls}`}>
    <div class="title-probe__actions">
      <${Button} variant="ghost" size="sm" loading=${busy} onClick=${() => run()}>检测连通<//>
      ${open ? html`<${Button} variant="ghost" size="sm" onClick=${copy}>复制结果<//>` : null}
    </div>
    <form class="title-probe__join" onSubmit=${(ev) => { ev.preventDefault(); run(joinCode); }}>
      <input class="title-probe__code" aria-label="同伴的测试号" maxlength="8" placeholder="同伴的测试号"
        value=${joinCode} onInput=${(ev) => setJoinCode(ev.currentTarget.value.toUpperCase())} />
      <${Button} variant="ghost" size="sm" type="submit" loading=${busy}>加入这个测试号<//>
    </form>
    ${open ? html`<div class="title-probe__panel" aria-live="polite">
      ${room ? html`<p class="title-probe__room">测试号 <b>${room}</b></p>` : null}
      <ul class="title-probe__rows">
        ${rows.map((row) => html`<li key=${row.id} class=${`title-probe__row is-${row.state}`}>
          <span class="title-probe__mark">${STATE_TEXT[row.state] || row.state}</span>
          <span class="title-probe__label">${row.label}</span>
          <span class="title-probe__detail">${row.detail}</span>
        </li>`)}
      </ul>
    </div>` : null}
  </div>`;
}
