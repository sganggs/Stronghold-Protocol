// Title screen: season-style backdrop, big title 卫戍协议：盟约, remembered nickname, 开始.
//
// Pressing 开始 validates the nickname (1..NAME_MAX_LEN chars, no control characters), stores it,
// marks this tab as "entered" (so reloads skip the title) and hands the name to net.js, which
// sends `hello` (now, or as soon as the socket is open). The router then shows the lobby.
//
// Backdrop art: if data/assets.json lists a UI backdrop (`ui.titleBackdrop`, or one of the
// entry/loading illustration names) it is layered under the CSS art; otherwise the screen is
// pure CSS/SVG (radar, ridgelines, glow), so it never issues a request that can 404.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { NAME_MAX_LEN, APP_VERSION } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, TextField, PingPill, alertDialog, confirmDialog } from '../ui/components.js';
import { GuideButton } from '../ui/guide.js';
import { toast } from '../ui/toasts.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { FullscreenButton, detectFeatures } from '../ui/device.js';
import { androidBridge, isLoopbackHost, normalizeRemoteUrl, probeRemoteGame } from '../connect.js';

// Same character classes as server/net.js sanitizeName (control, zero-width, bidi, BOM), so a name
// the client accepts is never rejected by the server's hello validation.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
// Lone surrogates are removed by a scan, not a regex: the lookbehind such a regex needs is a *syntax error* in Safari
// < 16.4, which would stop the whole client from loading there.
export function stripLoneSurrogates(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) { out += str[i] + str[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    out += str[i];
  }
  return out;
}

/**
 * Normalise a nickname like the server does (NFC, strip lone surrogates / control / invisible /
 * bidi characters, collapse whitespace, trim), then clamp to NAME_MAX_LEN UTF-16 code units — the
 * protocol's `hello.name` limit — without splitting a surrogate pair.
 * @param {any} raw
 * @returns {string}
 */
export function sanitizeName(raw) {
  let s = String(raw ?? '');
  try { s = s.normalize('NFC'); } catch { /* keep as is */ }
  s = stripLoneSurrogates(s).replace(/\s+/g, ' ').replace(CONTROL_CHARS, '').replace(/ {2,}/g, ' ').trim();
  if (s.length > NAME_MAX_LEN) {
    s = s.slice(0, NAME_MAX_LEN);
    // Don't leave half a surrogate pair at the end.
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s;
}

/** @param {any} raw @returns {boolean} */
export const isValidName = (raw) => sanitizeName(raw).length > 0;

/**
 * Enter the game shell with a nickname (title → lobby).
 * @param {string} rawName
 * @returns {boolean} false when the name is invalid
 */
export function enterSession(rawName) {
  const name = sanitizeName(rawName);
  if (!name) return false;
  identity.saveName(name);
  identity.setEntered(true);
  store.set((s) => ({ me: { ...s.me, name }, session: { ...s.session, entered: true } }));
  net.setName(name);
  return true;
}

// data/assets.json `ui` keys are 'group/key' (docs/ASSETS.md).
const BACKDROP_KEYS = ['titleBackdrop', 'entry/bkg_01', 'entry/bkg_02'];
const RIDGE_KEYS = ['titleRidges', 'entry/bg_mountains_tiled'];

/**
 * Find a UI image URL in data/assets.json (tolerant of a few plausible shapes).
 * @param {any} assets
 * @param {string[]} names
 * @returns {string|null}
 */
export function findUiAsset(assets, names) {
  if (!assets || typeof assets !== 'object') return null;
  const asUrl = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.url || v.path || v.src || null;
    return null;
  };
  const ui = assets.ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    for (const n of names) {
      const u = asUrl(ui[n]);
      if (u) return u;
    }
  }
  const lists = [Array.isArray(ui) ? ui : null, Array.isArray(assets.files) ? assets.files : null].filter(Boolean);
  for (const list of lists) {
    for (const n of names) {
      const hit = list.map(asUrl).find((u) => typeof u === 'string' && u.includes('/ui/') && u.toLowerCase().split('/').pop().startsWith(n.toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

// Dot-matrix watchtower emblem (13×14 bitmap; dots grow toward the base for depth).
const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

function Emblem() {
  const dots = useMemo(() => {
    const out = [];
    EMBLEM.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== 'X') return;
        const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
        const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
        out.push({ cx: c + 0.5, cy: r + 0.5, r: rad, accent, d: (r * 13 + c) % 7 });
      });
    });
    return out;
  }, []);
  return html`<div class="emblem" aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">
      ${dots.map((d, i) => html`<circle key=${i} cx=${d.cx} cy=${d.cy} r=${d.r} class=${d.accent ? 'is-accent' : `d${d.d}`} />`)}
    </svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
}

function Ridges() {
  return html`<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#16231f" /><stop offset="1" stop-color="#0a0e0d" />
      </linearGradient>
      <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1714" /><stop offset=".6" stop-color="#080b0a" />
      </linearGradient>
      <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#17f9b7" stop-opacity="0" />
        <stop offset=".3" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset=".7" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset="1" stop-color="#17f9b7" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)"
      d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z" />
    <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)"
      d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z" />
  </svg>`;
}

const STATUS_TEXT = {
  idle: '准备连接', connecting: '正在连接服务器', connected: '已连接服务器', handshaking: '正在验证身份',
  online: '已连接服务器', reconnecting: '连接中断，正在重连', closed: '连接已关闭',
};

function EntryLabel({ remote }) {
  const previous = useRef(remote);
  const [morphing, setMorphing] = useState(false);
  useLayoutEffect(() => {
    if (previous.current === remote) return;
    previous.current = remote;
    setMorphing(true);
    const timer = setTimeout(() => setMorphing(false), 680);
    return () => clearTimeout(timer);
  }, [remote]);

  // Clip the existing font's glyphs into short stroke fragments. Each fragment moves
  // independently, then the complete text takes over to avoid seams at small scales.
  return html`<span class=${`entry-label${morphing ? ' is-morphing' : ''}`} data-mode=${remote ? 'remote' : 'local'}>
    <span class="sr-only">${remote ? '链接地址' : '博士代号'}</span>
    ${[['local', '博士代号'], ['remote', '链接地址']].map(([mode, text]) => html`
      <span key=${mode} class=${`entry-label__word entry-label__word--${mode}`} aria-hidden="true">
        <span class="entry-label__whole">${text}</span>
        <span class="entry-label__strokes">${[...text].map((ch, i) => html`
          <span key=${i} class="entry-label__glyph">${Array.from({ length: 18 }, (_, n) => {
            const row = Math.floor(n / 3), col = n % 3;
            return html`<span key=${n} class="entry-label__stroke" style=${{
              clipPath: `inset(${row * 100 / 6}% ${(2 - col) * 100 / 3}% ${(5 - row) * 100 / 6}% ${col * 100 / 3}%)`,
              '--stroke-x': `${(col - 1) * .4 + (i - 1.5) * .1}em`,
              '--stroke-y': `${(row - 2.5) * .18}em`,
              '--stroke-turn': `${((i + row + col) % 3 - 1) * 18}deg`,
              '--stroke-out-delay': `${i * 24 + row * 6 + col * 8}ms`,
              '--stroke-in-delay': `${190 + i * 28 + row * 5 + col * 6}ms`,
            }}>${ch}</span>`;
          })}</span>
        `)}</span>
      </span>
    `)}
  </span>`;
}

function openRemoteTarget(url) {
  const bridge = androidBridge();
  if (bridge && typeof bridge.openRemote === 'function') bridge.openRemote(url);
  else if (typeof location !== 'undefined') location.href = url;
}

function openRemotePreview(url) {
  const bridge = androidBridge();
  if (bridge && typeof bridge.openExternal === 'function') return bridge.openExternal(url) === true;
  return false;
}

/** Title screen component. */
export function TitleScreen() {
  const conn = useStore((s) => s.connection, shallowEqual);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  const [name, setName] = useState(() => store.get().me.name || identity.loadName() || '');
  const localEntry = isLoopbackHost();
  const [entryMode, setEntryMode] = useState(() => localEntry && name.trim() ? 'local' : null);
  const selectionPress = useRef(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  useEffect(() => {
    if (!localEntry || !androidBridge()) return;
    const remoteEvent = async ({ detail }) => {
      if (detail?.kind === 'certificate') {
        const accepted = await confirmDialog({ title: '链接证书需要确认', micro: 'REMOTE CERTIFICATE', tone: 'amber',
          text: `该网页的 HTTPS 证书无法通过验证，无法确认服务器身份。\n${detail.url}\n仅在你信任此地址和证书来源时继续，本次确认不会关闭全局证书校验。`,
          okText: '仅本次继续', cancelText: '返回本地' });
        androidBridge()?.answerCertificate?.(String(detail.token), accepted);
      } else if (detail?.kind === 'error') {
        await alertDialog({ title: '远程页面无法打开', micro: 'REMOTE LINK',
          text: detail.message || '请检查网络连接或完成网页访问验证。', okText: '知道了' });
      } else if (detail?.kind === 'invalid') {
        await alertDialog({ title: '请输入有效链接', micro: 'REMOTE LINK',
          text: '该页面未能显示游戏主界面，请输入有效的游戏服务地址。', okText: '知道了' });
      }
    };
    window.addEventListener('sp-remote-event', remoteEvent);
    return () => window.removeEventListener('sp-remote-event', remoteEvent);
  }, [localEntry]);
  const assetsSettled = useData('assets');
  const assets = data.get('assets');
  const backdrop = findUiAsset(assets, BACKDROP_KEYS);
  const ridges = findUiAsset(assets, RIDGE_KEYS);
  // Track load/fail per URL (not as booleans reset in effects: an image can load before an effect runs).
  const [bgLoadedUrl, setBgLoadedUrl] = useState(null);
  const [ridgesLoadedUrl, setRidgesLoadedUrl] = useState(null);
  const [ridgesFailedUrl, setRidgesFailedUrl] = useState(null);
  const bgLoaded = !!backdrop && bgLoadedUrl === backdrop;
  const ridgesLoaded = !!ridges && ridgesLoadedUrl === ridges;
  const ridgesFailed = !!ridges && ridgesFailedUrl === ridges;
  // CSS ridgelines only when there is no ridge art (avoids a swap flash when the art arrives).
  const cssRidges = assetsSettled && (!ridges || ridgesFailed);

  const valid = isValidName(name);
  const start = () => {
    if (!valid) { toast('请输入博士代号', 'warn'); return; }
    enterSession(name);
  };

  const chooseEntryMode = (next) => {
    if (remoteBusy || entryMode === next) return;
    // Keep a callsign typed before selecting Local. Switching sides clears the old
    // value because a callsign and a URL have different validation rules.
    if (entryMode) setName('');
    setEntryMode(next);
  };

  const selectOnPress = (mode, event) => {
    selectionPress.current = null;
    if (remoteBusy || event.button !== 0 || event.isPrimary === false || entryMode === mode) return;
    // Start resizing when pressed, then consume this click so the first press only selects.
    selectionPress.current = mode;
    chooseEntryMode(mode);
  };
  const clickEntry = (mode, confirm) => {
    const selectedOnPress = selectionPress.current === mode;
    selectionPress.current = null;
    if (!selectedOnPress) confirm();
  };
  const clearSelectionPress = () => { selectionPress.current = null; };

  const submitRemote = async () => {
    if (remoteBusy) return;
    const url = normalizeRemoteUrl(name);
    if (!url) {
      await alertDialog({ title: '请输入有效链接', text: '请输入合法的 http / https 网络地址，例如域名或 IP 与端口。不能输入代号、普通文本或 localhost 地址。', okText: '知道了', micro: 'REMOTE LINK' });
      return;
    }
    setRemoteBusy(true);
    const probe = await probeRemoteGame(url);
    setRemoteBusy(false);
    if (probe.valid) {
      openRemoteTarget(url);
      return;
    }
    if (probe.blocked) {
      const inAppPreview = openRemotePreview(url);
      if (inAppPreview) return;
      const open = await confirmDialog({
        title: '链接需要验证',
        text: '该链接需要在浏览器中验证。打开后，请自行确认网页或证书提示；若无法进入游戏，可使用浏览器返回本机界面。',
        okText: '打开验证页面', cancelText: '返回本机', micro: 'REMOTE CHECK',
      });
      if (open && typeof location !== 'undefined') location.href = url;
      return;
    }
    await alertDialog({ title: '请输入有效链接', text: '该地址不是可识别的游戏服务。', okText: '知道了', micro: 'REMOTE LINK' });
  };

  const localMode = localEntry && entryMode === 'local';
  const remoteMode = localEntry && entryMode === 'remote';
  const entryInput = (value) => {
    setName(value);
    if (localEntry && !entryMode && value.trim()) setEntryMode('local');
  };
  const enterLocal = () => {
    if (!localMode) { chooseEntryMode('local'); return; }
    start();
  };
  const enterRemote = () => {
    if (!remoteMode) { chooseEntryMode('remote'); return; }
    submitRemote().catch((err) => {
      setRemoteBusy(false);
      toast(`远程连接失败：${String(err?.message || err).slice(0, 100)}`, 'warn');
    });
  };

  const online = conn.status === 'online' || conn.status === 'connected';
  const dotClass = online ? 'is-on' : conn.status === 'reconnecting' || conn.status === 'connecting' || conn.status === 'handshaking' ? 'is-warn' : 'is-bad';

  // touch screens: no autofocus (it would pop the on-screen keyboard over a landscape phone's whole view)
  const touchUi = useMemo(() => detectFeatures().coarse, []);
  return html`<div class="screen title-screen">
    <div class=${`title-bg${bgLoaded ? ' has-art' : ''}${ridgesLoaded ? ' has-ridges' : ''}`} aria-hidden="true">
      ${backdrop ? html`<img class="title-bg__art" src=${backdrop} alt="" draggable=${false}
        onLoad=${() => setBgLoadedUrl(backdrop)} />` : null}
      <div class="title-bg__glow"></div>
      <div class="title-bg__radar"><div class="title-bg__sweep"></div></div>
      <div class="title-bg__target"></div>
      ${cssRidges ? html`<${Ridges} />` : null}
      ${ridges && !ridgesFailed ? html`<div class="title-bg__ridge-art" style=${`background-image:url("${ridges}")`}>
        <img src=${ridges} alt="" hidden onLoad=${() => setRidgesLoadedUrl(ridges)} onError=${() => setRidgesFailedUrl(ridges)} />
      </div>` : null}
      <div class="title-bg__haze"></div>
      <span class="cross" style="left:7%;top:22%"></span>
      <span class="cross" style="left:93%;top:30%"></span>
      <span class="cross" style="left:14%;top:70%"></span>
      <span class="cross" style="left:88%;top:62%"></span>
      <span class="cross" style="left:60%;top:12%"></span>
    </div>

    <div class="title-corner title-corner--tl">
      <span class="title-corner__mark"></span>
      <div><${MicroLabel} tone="mint">RHODES ISLAND // SIMULATION SERVICE<//><br /><${MicroLabel}>TACTICAL CO-OP NODE · 02<//></div>
    </div>
    <div class="title-corner title-corner--tr">
      <${MicroLabel} tone="hi">TARGET POINT<//><br /><${MicroLabel}>STRONGHOLD PROTOCOL<//>
    </div>

    <main class="title-main">
      <${Emblem} />
      <div class="title-en">
        <span class="title-en__a">STRONGHOLD PROTOCOL</span>
        <span class="title-en__b">ALLIANCE</span>
      </div>
      <h1 class="title-cn">卫戍协议<span class="title-cn__colon">：</span><em>盟约</em></h1>
      <p class="title-tag">调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。</p>

      <div class=${localEntry ? `title-login entry-console${remoteMode ? ' is-remote' : ''}` : 'title-login'}>
        ${pendingJoin ? html`<div class="title-invite">
          <${Icon} name="key" />
          <span>收到同盟邀请</span><b class="num">${pendingJoin}</b><span class="t-lo">· 输入代号后将自动加入</span>
        </div>` : null}
        ${localEntry ? html`
          <${TextField} label=${html`<${EntryLabel} remote=${remoteMode} />`}
            micro=${html`<span class="entry-micro" data-mode=${remoteMode ? 'remote' : 'local'}>
              <span class="entry-micro__word entry-micro__word--local" aria-hidden=${remoteMode}>CALLSIGN</span>
              <span class="entry-micro__word entry-micro__word--remote" aria-hidden=${!remoteMode}>LINK ADDRESS</span>
            </span>`} size="lg"
            icon=${remoteMode ? 'link' : 'user'} value=${name} maxLength=${remoteMode ? 2048 : NAME_MAX_LEN}
            placeholder=${remoteMode ? '输入链接地址（可能需验证）' : `输入你的代号（最多 ${NAME_MAX_LEN} 字）`}
            autoFocus=${!touchUi} onInput=${entryInput} onEnter=${remoteMode ? enterRemote : enterLocal} />
          <div class=${`entry-split${localMode ? ' is-local' : ''}${remoteMode ? ' is-remote' : ''}`}>
            <${Button} variant="primary" size="xl" class="entry-btn entry-btn--local" block=${true}
              aria-label="本地" aria-pressed=${localMode} disabled=${remoteBusy}
              onPointerDown=${(e) => selectOnPress('local', e)} onPointerCancel=${clearSelectionPress} onKeyDown=${clearSelectionPress}
              onClick=${() => clickEntry('local', enterLocal)}>本地<//>
            <${Button} variant="primary" size="xl" class="entry-btn entry-btn--remote" block=${true}
              aria-label="远程" aria-pressed=${remoteMode} disabled=${remoteBusy}
              onPointerDown=${(e) => selectOnPress('remote', e)} onPointerCancel=${clearSelectionPress} onKeyDown=${clearSelectionPress}
              onClick=${() => clickEntry('remote', enterRemote)}>远程<//>
          </div>
        ` : html`
          <${TextField} label="博士代号" micro="CALLSIGN" size="lg" icon="user" value=${name} maxLength=${NAME_MAX_LEN}
            placeholder="输入你的代号（最多 ${NAME_MAX_LEN} 字）" autoFocus=${!touchUi}
            onInput=${setName} onEnter=${start} />
          <${Button} variant="primary" size="xl" block=${true} iconRight="chevrons" disabled=${!valid} onClick=${start}>开始<//>
        `}
        <div class="title-conn">
          <span class=${`status-dot ${dotClass}`}></span>
          <span>${STATUS_TEXT[conn.status] || conn.status}</span>
          ${conn.status === 'online' ? html`<${PingPill} ms=${conn.ping} />` : null}
          <${GuideButton} class="title-guide" />
          <${FullscreenButton} class="title-fs" />
        </div>
      </div>
    </main>

    <footer class="title-foot">
      <span>非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有</span>
      <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
    </footer>
  </div>`;
}
