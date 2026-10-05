// 玩法说明 (How to play): viewer for the 19 official tutorial pages of the mode (local-client art, DESIGN §13:
// data/local-assets.json → guide/autochess_{home 1–9, shop 1–6, handbook 1–4}). The pages are stored squashed to
// 1024² and are displayed stretched back to 16:9. Three chapters (基础规则 / 调度手册 / 进阶图鉴), ‹ › buttons,
// ←/→ (A/D) keys, page dots, thumbnails; Esc or the backdrop closes. Adjacent pages are preloaded.
// Without the local art the viewer shows the official loading-screen tips (config.tips) instead.
//
// Global & imperative so every screen can open it: `openGuide(page?)`; <GuideHost/> is mounted once by main.js
// (and by the dev mock harness); <GuideButton/> is the standard trigger (title, lobby, room, in-match menu).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, Spinner } from './components.js';
import { createStore, useStore } from '../store.js';
import { data, useData, localAsset } from '../data.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Page catalogue in reading order (titles transcribed from the pages). */
export const GUIDE_CHAPTERS = [
  { id: 'home', name: '基础规则', micro: 'BASICS', pages: [
    ['autochess_home_1', '卫戍协议已运行'], ['autochess_home_2', '攻防战'], ['autochess_home_3', '休整期 · 区域'],
    ['autochess_home_4', '休整期 · 资金与调度'], ['autochess_home_5', '机变阶段'], ['autochess_home_6', '限时战斗'],
    ['autochess_home_7', '作战期'], ['autochess_home_8', '协同战斗'], ['autochess_home_9', '盟约'],
  ] },
  { id: 'shop', name: '调度手册', micro: 'HANDBOOK', pages: [
    ['autochess_shop_1', '调度手册'], ['autochess_shop_2', '干员晋级'], ['autochess_shop_3', '加成情况'],
    ['autochess_shop_4', '卫戍能力'], ['autochess_shop_5', '盟约'], ['autochess_shop_6', '助战及自选编队'],
  ] },
  { id: 'handbook', name: '进阶图鉴', micro: 'ADVANCED', pages: [
    ['autochess_handbook_1', '敌人类型'], ['autochess_handbook_2', '盟约激活与叠加'], ['autochess_handbook_3', '追加盟约'],
    ['autochess_handbook_4', '策略与轮选'],
  ] },
];

/**
 * Flat page list with URLs (only pages the local manifest lists).
 * @returns {Array<{ key: string, title: string, chapter: number, url: string }>}
 */
export function guidePages() {
  const out = [];
  GUIDE_CHAPTERS.forEach((ch, ci) => {
    for (const [key, title] of ch.pages) {
      const url = localAsset('guide', key);
      if (url) out.push({ key, title, chapter: ci, url });
    }
  });
  return out;
}

/** Open/closed + current page. */
export const guideStore = createStore({ open: false, page: 0, kind: 'play' });

/** Open the viewer (optionally at a page index). */
export function openGuide(page = 0) {
  data.load('local');
  data.load('config');
  guideStore.set({ open: true, page: Math.max(0, page | 0), kind: 'play' });
}
export const closeGuide = () => guideStore.set({ open: false });

/** Standard 玩法说明 trigger button. */
export function GuideButton({ class: cls, size = 'sm', variant = 'ghost', label = '玩法说明', square = false }) {
  return html`<${Button} variant=${variant} size=${size} icon="book" square=${square} class=${cx('guide-btn', cls)}
    onClick=${() => openGuide(0)} title="玩法说明" aria-label="玩法说明">${square ? null : label}<//>`;
}

/** Local host's connection instructions use the same viewer and trigger style. */
export function RemoteGuideButton({ class: cls, size = 'sm', variant = 'ghost' }) {
  return html`<${Button} variant=${variant} size=${size} icon="book" class=${cx('guide-btn', cls)}
    onClick=${() => guideStore.set({ open: true, page: 0, kind: 'remote' })} title="远程指南" aria-label="远程指南">远程指南<//>`;
}

function RemoteGuide() {
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/connect/info', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Connection information unavailable');
        const body = await response.json();
        if (!body.ok || !Array.isArray(body.lan)) throw new Error('Invalid connection information');
        if (!controller.signal.aborted) setInfo(body);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return html`<div class="guide__tips remote-guide">
    <section>
      <${MicroLabel} tone="mint">LAN // 局域网联机<//>
      <p>同一 Wi-Fi 或路由器下的设备，在本机初始界面选择“远程”，在“链接地址”处输入以下任一局域网链接，再次点击“远程”连接。</p>
      <div class="remote-guide__addresses">
        ${info ? info.lan.length ? info.lan.map((url) => html`<code key=${url} class="num">${url}</code>`)
          : html`<span class="t-lo">暂无局域网地址，请连接 Wi-Fi 后重新打开指南。</span>`
          : html`<span class="t-lo">${failed ? '无法读取地址，请查看后端终端的 LAN 地址。' : '正在读取本机局域网地址…'}</span>`}
      </div>
      ${info?.lanAvailable === false ? html`<p class="t-lo">当前服务仅允许本机访问。请让服务监听局域网接口后再联机。</p>` : null}
      <p>以上地址与后端终端的 LAN 输出一致。无法连接时，请检查防火墙是否允许游戏端口，以及路由器是否开启了访客网络或 AP 隔离。</p>
    </section>
    <section>
      <${MicroLabel} tone="mint">PUBLIC // 公网联机<//>
      <p>不在同一局域网时，由开服方使用内网穿透，将游戏服务${info ? `（本机端口 ${info.port}）` : ''}映射到公网；其他玩家输入穿透服务提供的公网 IP 与端口，或完整的 http / https 服务器地址。局域网地址不能直接用于公网连接。</p>
      <p>也可在云服务器部署游戏，并提供服务器地址。穿透或反向代理需支持 WebSocket（/ws），游戏应部署在域名根路径。若链接需要访问验证，先完成验证再连接。</p>
    </section>
    <section>
      <${MicroLabel} tone="mint">ALLIANCE // 加入同盟<//>
      <p>连接地址用于进入同一游戏服务器，同盟密钥用于选择该服务器内的房间。房主选择“同盟模拟”并创建房间，将同盟密钥或邀请链接发给同伴；同伴连接后输入博士代号，再加入同盟。所有玩家准备就绪后，由房主开始。</p>
    </section>
  </div>`;
}

function preload(url) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = url;
}

/** Fallback body when the tutorial art is not installed: the official tips as a numbered list. */
function TipsFallback() {
  const tips = (Array.isArray(data.get('config')?.tips) ? data.get('config').tips : []).map((t) => t?.tip).filter(Boolean);
  return html`<div class="guide__tips">
    <${MicroLabel} tone="mint">TIPS // 模拟要点</${MicroLabel}>
    <ol>${tips.map((t, i) => html`<li key=${i}>${t}</li>`)}</ol>
    ${!tips.length ? html`<p class="t-lo">暂无说明内容</p>` : null}
  </div>`;
}

/** The viewer (mounted once near the root). */
export function GuideHost() {
  const { open, page, kind } = useStore((s) => s, Object.is, guideStore);
  const remote = kind === 'remote';
  const ready = useData('local', 'config');
  const pages = useMemo(() => (ready ? guidePages() : []), [ready]);
  const [loaded, setLoaded] = useState(() => new Set());
  const [failed, setFailed] = useState(() => new Set());
  const boxRef = useRef(null);
  const n = remote ? 0 : pages.length;
  const i = n ? Math.min(Math.max(0, page), n - 1) : 0;
  const cur = pages[i] || null;
  const go = (k) => { if (n) guideStore.set({ open: true, page: ((k % n) + n) % n }); };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape') closeGuide();
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'PageDown') go(guideStore.get().page + 1);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'PageUp') go(guideStore.get().page - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(n - 1);
      else handled = (!!k && k.length === 1) || k === ' '; // swallow game shortcuts (R/F/D/Space) while open
      if (handled) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, [open, n]);

  useEffect(() => {
    if (!open || !n) return;
    preload(pages[(i + 1) % n]?.url);
    preload(pages[(i + n - 1) % n]?.url);
  }, [open, i, n]);

  if (!open) return null;
  const chapter = cur ? GUIDE_CHAPTERS[cur.chapter] : null;
  const firstOf = (ci) => pages.findIndex((p) => p.chapter === ci);
  const isLoaded = cur && loaded.has(cur.url);
  return html`<div class="guide" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) closeGuide(); }}>
    <div class=${cx('guide__box brackets', remote && 'guide__box--remote')} role="dialog" aria-modal="true" aria-label=${remote ? '远程指南' : '玩法说明'} tabindex="-1" ref=${boxRef}>
      <header class="guide__head">
        <div class="guide__titles">
          <${MicroLabel} tone="mint">${remote ? 'REMOTE GUIDE // STRONGHOLD PROTOCOL' : 'HOW TO PLAY // STRONGHOLD PROTOCOL'}</${MicroLabel}>
          <h2 class="guide__title">${remote ? '远程指南' : '玩法说明'}</h2>
        </div>
        ${n ? html`<nav class="guide__chapters" aria-label="章节">
          ${GUIDE_CHAPTERS.map((ch, ci) => {
            const at = firstOf(ci);
            if (at < 0) return null;
            return html`<button key=${ch.id} type="button" class=${cx('guide__chapter', cur?.chapter === ci && 'is-on')} onClick=${() => go(at)}>
              <span class="guide__chname">${ch.name}</span><span class="guide__chmicro">${ch.micro}</span>
            </button>`;
          })}
        </nav>` : null}
        <button type="button" class="guide__close" aria-label="关闭" title="关闭 (Esc)" onClick=${closeGuide}><${Icon} name="close" /></button>
      </header>

      ${n ? html`<div class="guide__stage">
        <button type="button" class="guide__nav guide__prev" aria-label="上一页" onClick=${() => go(i - 1)}><${Icon} name="chevronLeft" /></button>
        <div class=${cx('guide__page', isLoaded && 'is-loaded')}>
          ${cur && !failed.has(cur.url) ? html`<img key=${cur.url} src=${cur.url} alt=${cur.title} draggable=${false}
            onLoad=${() => setLoaded((s) => new Set(s).add(cur.url))}
            onError=${() => setFailed((s) => new Set(s).add(cur.url))} />` : html`<div class="guide__missing"><${Icon} name="info" />该页面暂时无法显示</div>`}
          ${!isLoaded && cur && !failed.has(cur.url) ? html`<span class="guide__loading"><${Spinner} size="md" /></span>` : null}
        </div>
        <button type="button" class="guide__nav guide__next" aria-label="下一页" onClick=${() => go(i + 1)}><${Icon} name="chevronRight" /></button>
      </div>` : html`<div class="guide__stage guide__stage--text">${remote ? html`<${RemoteGuide} />` : html`<${TipsFallback} />`}</div>`}

      ${n ? html`<footer class="guide__foot">
        <div class="guide__label">
          <span class="guide__chtag">${chapter?.name || ''}</span>
          <b class="guide__ptitle">${cur?.title || ''}</b>
        </div>
        <div class="guide__dots" role="tablist" aria-label="页码">
          ${pages.map((p, k) => html`<button key=${p.key} type="button" role="tab" aria-selected=${k === i ? 'true' : 'false'} title=${p.title}
            class=${cx('guide__dot', k === i && 'is-on', k > 0 && pages[k - 1].chapter !== p.chapter && 'is-first')} onClick=${() => go(k)}></button>`)}
        </div>
        <span class="guide__count num">${i + 1} / ${n}</span>
      </footer>` : null}
    </div>
  </div>`;
}
