// js/ui/shellPanels.js — in-page shell panels styled exactly like the game's own settings modal
// (Modal frame + .set-list/.set-row/.set-seg — same components the QUALITY row uses).
// Two panels: 服务器 (line switching) and 参数 (host-server parameters, App only).
// Domains are never shown: lines are identified by name only.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, MicroLabel } from './components.js';

/** Panel store: 'servers' | 'params' | null, broadcast on a window event so the shell can drive it too. */
let panelState = null;
const listeners = new Set();

function setPanel(kind) {
  panelState = kind;
  for (const fn of listeners) fn(kind);
  try { window.dispatchEvent(new CustomEvent('sp-panel', { detail: kind })); } catch (e) { /* old browser */ }
}

export function openShellPanel(kind) {
  setPanel(kind);
}

export function useShellPanel() {
  const [kind, set] = useState(panelState);
  useEffect(() => {
    const fn = (k) => set(k);
    listeners.add(fn);
    const onEvt = (e) => set(e.detail || null);
    window.addEventListener('sp-panel', onEvt);
    return () => { listeners.delete(fn); window.removeEventListener('sp-panel', onEvt); };
  }, []);
  return [kind, () => setPanel(null)];
}

// ---------------------------------------------------------------------------------------------------
// Server switching (name-only list; URLs stay inside the shell)
// ---------------------------------------------------------------------------------------------------

/** Web (no shell) line list: 自动线路 + 自定义线路 only — no 离线服务 (browsers cannot host). */
const WEB_LINES = [
  { id: 'auto', label: '自动线路', note: '当前' },
  { id: 'custom', label: '自定义线路', note: '' },
];

function fmtRtt(ms) {
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) + 'ms' : '--';
}

function readServerList() {
  try {
    if (window.shell && window.shell.getServerList) {
      const o = JSON.parse(window.shell.getServerList());
      if (o && Array.isArray(o.entries)) return o;
    }
  } catch (e) { /* ignore */ }
  return { source: '', entries: [] };
}

function ServerPanel({ onClose }) {
  const native = typeof window !== 'undefined' && window.shell && typeof window.shell.setServer === 'function';
  const [lines, setLines] = useState(() => {
    if (native) {
      try {
        const arr = JSON.parse(window.shell.getServers());
        return Array.isArray(arr) && arr.length ? arr : [
          { id: 'auto', label: '自动线路', note: '测速选最优' },
          { id: 'local', label: '离线服务', note: '单机自开房推荐' },
          { id: 'custom', label: '自定义线路', note: '' },
        ];
      } catch (e) { return []; }
    }
    return WEB_LINES;
  });
  const [list, setList] = useState(readServerList);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);

  // the shell pushes a fresh (verified, probed) list after refreshServerList()
  useEffect(() => {
    const onServers = (e) => { try { setList(JSON.parse(e.detail)); } catch (err) { /* ignore */ } };
    window.addEventListener('sp-servers', onServers);
    if (native && window.shell.refreshServerList) {
      try { window.shell.refreshServerList(); } catch (e) { /* ignore */ }
    }
    return () => window.removeEventListener('sp-servers', onServers);
  }, []);

  function pick(line) {
    if (line.id === 'custom') { setCustomOpen(true); return; }
    if (native) {
      try { window.shell.setServer(line.id); } catch (e) { /* ignore */ }
      onClose();
      return;
    }
    onClose();
  }

  function pickEntry(entry) {
    if (!entry.enabled || !entry.compatible) return; // 不兼容 / 已停用：禁止加入
    if (native) {
      try { window.shell.setServer(entry.id); } catch (e) { /* ignore */ }
      onClose();
    }
  }

  /** 房间制部署（CF Workers 版）：socket 要房号+鉴权，只能用对方自己的客户端进。 */
  function useRemote(entry, on) {
    if (!native || !window.shell.useRemoteClient) return;
    try { window.shell.useRemoteClient(entry.id, on); } catch (e) { /* ignore */ }
    onClose();
  }

  function applyCustom() {
    let v = String(custom || '').trim();
    if (!v) return;
    if (!/^https?:\/\//.test(v)) v = 'https://' + v;
    v = v.replace(/\/+$/, '');
    if (native) {
      try { window.shell.setServer('custom:' + v); } catch (e) { /* ignore */ }
      onClose();
      return;
    }
    location.href = v + '/' + (location.search || '');
  }

  const entries = list.entries || [];
  const rowStyle = 'display:block;width:100%;margin:4px 0;padding:8px 10px;background:transparent;'
    + 'border:1px solid #2c3a35;color:#d8e3de;border-radius:4px;font-size:13px;cursor:pointer;text-align:left';
  const dim = 'opacity:.45;cursor:not-allowed';

  return html`<${Modal} open=${true} onClose=${onClose} title="服务器" micro="SERVER" width="10.4rem"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>完成<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">线路选择<${MicroLabel}>LINE<//></span>
        <div class="set-seg" role="radiogroup">
          ${lines.map((l) => html`<button key=${l.id} type="button" role="radio"
            aria-checked=${l.current ? 'true' : 'false'}
            class=${l.current ? 'is-on' : ''}
            title=${l.note || ''}
            onClick=${() => pick(l)}>${l.label}${l.note ? html`<i class="set-seg__note">${l.note}</i>` : null}</button>`)}
        </div>
      </div>
      <div class="set-row">
        <span class="set-row__label">服务器清单<${MicroLabel}>${list.source || 'LIST'}<//></span>
        ${entries.length
          ? html`<div>${entries.map((e) => html`<div key=${e.id}>
              <button type="button"
                style=${rowStyle + ((!e.enabled || !e.compatible) ? ';' + dim : '')}
                title=${e.note || ''}
                onClick=${() => pickEntry(e)}>
                ${e.name} · ${fmtRtt(e.rttMs)}${e.humans >= 0 ? ' · ' + e.humans + ' 人' : ''}${e.rooms >= 0 ? ' · ' + e.rooms + ' 房' : ''}${e.roomScoped ? ' · 房间制' : (e.compatible ? '' : ' · 不兼容')}
              </button>
              ${e.roomScoped
                ? html`<button type="button" style=${rowStyle + ';border-color:#4ed8af;color:#4ed8af;font-size:12px;margin-top:-2px'}
                    onClick=${() => useRemote(e, !e.remoteClient)}>
                    ${e.remoteClient ? '改回本地客户端' : '使用对方客户端进入'}
                  </button>`
                : null}
            </div>`)}</div>`
          : html`<p class="set-hint set-hint--tight">${list.loading ? '正在获取清单…' : '暂无可用服务器'}</p>`}
        ${native && window.shell.refreshServerList
          ? html`<button type="button" class="set-apply" onClick=${() => { try { window.shell.refreshServerList(); } catch (e) { /* ignore */ } }}>刷新清单</button>`
          : null}
      </div>
      <div class="set-row">
        <span class="set-row__label">自定义服务器<${MicroLabel}>CUSTOM<//></span>
        <input class="set-input" type="text" value=${custom} placeholder="输入地址"
          onFocus=${() => setCustomOpen(true)}
          onInput=${(e) => setCustom(e.currentTarget.value)} />
        <button type="button" class="set-apply" disabled=${!customOpen || custom === ''} onClick=${applyCustom}>应用</button>
      </div>
      <p class="set-hint">
        清单为签名清单，验签失败会自动回退内置；延迟由本机实测。不兼容（客户端版本不同）的服务器禁止加入。
        标「房间制」的服务器（CF Workers 版）socket 需要房号与鉴权，只能用对方自己的客户端进入 ——
        点「使用对方客户端进入」即切换（首次会走第三方内容提示）。自动线路 = 启动时按实测延迟选最优；离线服务 = 本机自开房。
      </p>
      ${native && window.shell.clearConsent
        ? html`<button type="button" class="set-apply" style="border-color:#2c3a35;color:#8a9a93"
            onClick=${() => { try { window.shell.clearConsent(); } catch (e) { /* ignore */ } }}>清除第三方内容授权</button>`
        : null}
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------
// 跨服邀请码（v2.7.0）：输入 4 位码 → shell-join.js 并发探针（目录 + 各 node 服 WS 试探）→
// 单一命中直接加入；多服命中弹本选择器（按本机延迟排序，域名不出现在界面）。
// ---------------------------------------------------------------------------------------------------

const FONT_SEG = [['0.85', '较小'], ['0.95', '标准'], ['1.05', '较大'], ['1.15', '特大']];
const PAD_SEG = [['0', '无'], ['8', '小'], ['16', '中'], ['24', '大']];

function JoinPanel({ onClose }) {
  const native = typeof window !== 'undefined' && window.shell && typeof window.shell.joinOnOrigin === 'function';
  const [code, setCode] = useState('');
  const [state, setState] = useState('idle'); // idle | probing | pick | none | cooldown
  const [entries, setEntries] = useState([]);
  const [note, setNote] = useState('');

  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  function pick(entry) {
    if (native) {
      try { window.shell.joinOnOrigin(entry.id, normalized); } catch (e) { /* ignore */ }
      onClose();
      return;
    }
    // plain web build: navigate with the deep link (same-origin probe hit)
    try { location.href = location.origin + '/?room=' + normalized; } catch (e) { /* ignore */ }
  }

  function go() {
    if (normalized.length !== 4) return;
    if (!window.__SP_JOIN) { setNote('探测模块未加载（较旧版本）'); setState('none'); return; }
    setState('probing');
    setNote('正在跨服查找 ' + normalized + ' …');
    window.__SP_JOIN.resolveCode(normalized).then((r) => {
      if (r.kind === 'directory') {
        // phone-host room: hand the code to the existing room-code join flow
        if (native && window.shell.join) { try { window.shell.join(); } catch (e) { /* ignore */ } }
        setState('none');
        setNote('这是手机房主的房间：请在弹出的房号框直接输入 ' + normalized);
      } else if (r.kind === 'single') {
        pick(r.entry);
      } else if (r.kind === 'conflict') {
        setEntries(r.entries);
        setState('pick');
      } else {
        setState(r.kind === 'cooldown' ? 'cooldown' : 'none');
        setNote(r.note || '未找到该房间');
      }
    }).catch(() => { setState('none'); setNote('查找失败，请稍后重试'); });
  }

  return html`<${Modal} open=${true} onClose=${onClose} title="邀请码加入" micro="INVITE" width="10.4rem"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>完成<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">邀请码<${MicroLabel}>CODE<//></span>
        <input class="set-input" type="text" value=${code} placeholder="4 位字母或数字"
          maxLength="4" style="text-transform:uppercase;letter-spacing:.08em"
          onInput=${(e) => setCode(e.currentTarget.value)} />
        <button type="button" class="set-apply" disabled=${normalized.length !== 4 || state === 'probing'}
          onClick=${go}>${state === 'probing' ? '查找中…' : '查找'}</button>
      </div>
      ${state === 'pick' ? html`
        <div class="set-row">
          <span class="set-row__label">选择服务器<${MicroLabel}>PICK<//></span>
          <div>${entries.map((e) => html`<button key=${e.id} type="button"
            style=${'display:block;width:100%;margin:4px 0;padding:8px 10px;background:transparent;'
              + 'border:1px solid #2c3a35;color:#d8e3de;border-radius:4px;font-size:13px;cursor:pointer;text-align:left'}
            onClick=${() => pick(e)}>
            ${e.name} · ${fmtRtt(e.rttMs)}${e.humans >= 0 ? ' · ' + e.humans + ' 人' : ''}${e.note ? ' · ' + e.note : ''}
          </button>`)}</div>
        </div>` : null}
      ${note ? html`<p class="set-hint set-hint--tight">${note}</p>` : null}
      <p class="set-hint">
        同一邀请码可能存在于多台服务器；查找会并发试探清单内全部服务器（约 3 秒），
        多处命中时按本机延迟排序供选择。手机房主的房间仍走房号直连。
      </p>
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------
// Host-server parameters (App only) — segmented controls in the game's own style, hot-switched
// ---------------------------------------------------------------------------------------------------

const HOST_BIND = [['::', '全部网卡'], ['127.0.0.1', '仅本机']];
const COMBAT = [['client', '各自模拟'], ['server', '房主统一']];
const VERIFY = [['off', '不校验'], ['sample', '抽查'], ['all', '全量']];
const PROXY = [['auto', 'auto'], ['1', '信任'], ['0', '不信任']];

function readParams() {
  try {
    if (window.shell && window.shell.getParams) return JSON.parse(window.shell.getParams());
  } catch (e) { /* fall through to defaults */ }
  return { port: 3000, hostBind: '::', spCombat: 'client', spVerify: 'off', trustProxy: 'auto' };
}

function SegRow({ label, micro, options, value, onChange, note }) {
  return html`<div class="set-row">
    <span class="set-row__label">${label}<${MicroLabel}>${micro}<//></span>
    <div class="set-seg" role="radiogroup">
      ${options.map(([id, text]) => html`<button key=${id} type="button" role="radio"
        aria-checked=${value === id ? 'true' : 'false'} class=${value === id ? 'is-on' : ''}
        onClick=${() => onChange(id)}>${text}</button>`)}
    </div>
    ${note ? html`<p class="set-hint set-hint--tight">${note}</p>` : null}
  </div>`;
}

function ParamsPanel({ onClose }) {
  const native = typeof window !== 'undefined' && window.shell && typeof window.shell.setParamsJson === 'function';
  const [p, setP] = useState(readParams);
  const upd = (k, v) => setP((old) => ({ ...old, [k]: v }));

  if (!native) {
    return html`<${Modal} open=${true} onClose=${onClose} title="参数" micro="PARAMS" width="10.4rem"
      actions=${html`<${Button} variant="primary" onClick=${onClose}>完成<//>`}>
      <div class="set-list"><p class="set-hint">房主参数仅在 App 版可用。</p></div>
    <//>`;
  }

  function save() {
    try {
      window.shell.setParamsJson(JSON.stringify(p));
      if (window.shell.restartHost) window.shell.restartHost();
    } catch (e) { /* ignore */ }
    onClose();
  }

  return html`<${Modal} open=${true} onClose=${onClose} title="参数" micro="PARAMS" width="10.4rem"
    actions=${html`<${Button} variant="secondary" onClick=${() => setP(readParams())}>恢复默认<//>
      <${Button} variant="primary" icon="check" onClick=${save}>保存并重启房主服务<//>`}>
    <div class="set-list">
      <div class="set-row">
        <span class="set-row__label">端口<${MicroLabel}>PORT<//></span>
        <input class="set-input" type="number" min="1024" max="65535" value=${p.port}
          onInput=${(e) => upd('port', Number(e.currentTarget.value) || 3000)} />
      </div>
      <${SegRow} label="监听地址" micro="HOST" options=${HOST_BIND} value=${p.hostBind}
        onChange=${(v) => upd('hostBind', v)} note="全部网卡 = 朋友可直连（推荐）；仅本机 = 单机练习" />
      <${SegRow} label="战斗模拟" micro="COMBAT" options=${COMBAT} value=${p.spCombat}
        onChange=${(v) => upd('spCombat', v)} note="各自模拟省电（推荐）；房主统一模拟耗电高，仅设备强时选" />
      <${SegRow} label="结果校验" micro="VERIFY" options=${VERIFY} value=${p.spVerify}
        onChange=${(v) => upd('spVerify', v)} note="全量校验最耗性能；抽查为折中" />
      <${SegRow} label="信任代理" micro="TRUST PROXY" options=${PROXY} value=${p.trustProxy}
        onChange=${(v) => upd('trustProxy', v)} note="直连场景保持 auto 即可" />
      <p class="set-hint">保存后自动热切换（仅重启内嵌房主服务，约 2 秒），无需重启应用。</p>
    </div>
  <//>`;
}

// ---------------------------------------------------------------------------------------------------

export function ShellPanelHost() {
  const [kind, close] = useShellPanel();
  if (kind === 'servers') return html`<${ServerPanel} onClose=${close} />`;
  if (kind === 'params') return html`<${ParamsPanel} onClose=${close} />`;
  if (kind === 'join') return html`<${JoinPanel} onClose=${close} />`;
  return null;
}

// Shell menu / notification can open panels without touching the Preact tree.
try {
  window.__SP_SHELL = window.__SP_SHELL || {};
  window.__SP_SHELL.openPanel = openShellPanel;
  // the shell pushes a freshly verified + probed list here (see MainActivity.pushServerList)
  window.__SP_SHELL.onServers = (json) => {
    try {
      window.dispatchEvent(new CustomEvent('sp-servers', { detail: json }));
    } catch (e) { /* old browser */ }
  };
} catch (e) { /* no window (tests) */ }
