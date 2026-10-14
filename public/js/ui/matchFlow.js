// 房间与搜寻流程的公共部件 (2026-10-13, the owner's request: the event's room / matchmaking flow, video 5:22–6:29; every
// drawing here is original):
//   SearchPanel — 搜寻中 (Ns): the brand line, the search tags (精确搜寻 · the difficulty), a pixel scout running over a
//                 skyline, a rotating tip, 停止搜寻;
//   FoundPanel  — 搜寻成功！正在连接中…: green, the search lines converging on the seats;
//   RadarScene  — 选择同盟方式's left picture: a sweeping radar with live bearing / range read-outs;
//   CreateArt / JoinArt — the two cards' pictures (an emblem with circuit lines; a row of isometric blocks).
// Styles: css/screens/lobby.css (mf-*).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { getConfig } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];

/** The loading tips (config.json `tips`, else a few built-in ones). */
export function tipList() {
  const cfg = getConfig();
  const list = Array.isArray(cfg?.tips) ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x) : [];
  return list.length ? list : FALLBACK_TIPS.map((x) => t(x));
}

/** Seconds → '12s' / '1:05'. */
export function searchClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** The rook in brackets used as the brand mark. */
export function BrandMark({ class: cls = '' }) {
  return html`<span class=${`mf-brand ${cls}`}><span class="mf-brand__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span>STRONGHOLD PROTOCOL</span>`;
}

/** A little pixel scout (an original square bot) running over a scrolling skyline. */
export function PixelScout({ happy = false }) {
  return html`<svg class=${`mf-scout${happy ? ' is-happy' : ''}`} viewBox="0 0 240 90" aria-hidden="true" focusable="false">
    <path class="mf-scout__wave" d="M0 58 C30 40 50 76 80 58 S130 40 160 58 S210 76 240 58" />
    <g class="mf-scout__sky">
      <path d="M10 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
      <path d="M130 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
    </g>
    <g class="mf-scout__bot">
      <rect x="104" y="34" width="26" height="22" rx="3" />
      <rect class="mf-scout__eye" x="110" y="41" width="4" height="5" />
      <rect class="mf-scout__eye mf-scout__eye--r" x="120" y="41" width="4" height="5" />
      <rect x="114" y="26" width="6" height="8" />
      <rect x="112" y="22" width="10" height="4" />
      <rect class="mf-scout__leg mf-scout__leg--a" x="108" y="56" width="5" height="7" />
      <rect class="mf-scout__leg mf-scout__leg--b" x="121" y="56" width="5" height="7" />
    </g>
    <line class="mf-scout__ground" x1="60" y1="70" x2="180" y2="70" />
    <text x="120" y="84" text-anchor="middle">${happy ? 'CONNECTED' : 'SCANNING · · ·'}</text>
  </svg>`;
}

/**
 * 搜寻中 panel.
 * @param {{ elapsed: number, tags?: Array<{ key: string, label: string, color?: string, icon?: any }>, onStop?: (() => void)|null,
 *   stopping?: boolean, note?: string|null, class?: string }} props
 */
export function SearchPanel({ elapsed = 0, tags = [], onStop = null, stopping = false, note = null, class: cls = '' }) {
  const [tips] = useState(tipList);
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)));
  useEffect(() => { const id = setInterval(() => setI((x) => x + 1), 5000); return () => clearInterval(id); }, []);
  const dots = '.'.repeat((Math.floor(elapsed) % 3) + 1);
  return html`<aside class=${`mf-search ${cls}`} role="status" aria-live="polite">
    <${BrandMark} />
    <h3 class="mf-search__title">${t('搜寻中')}<span class="mf-search__dots" aria-hidden="true">${dots}</span><small class="num">(${searchClock(elapsed)})</small></h3>
    ${tags.length ? html`<div class="mf-search__tags">${tags.map((g) => html`<span key=${g.key} class="mf-tag" style=${g.color ? `--tag:${g.color}` : undefined}>${g.icon || null}${g.label}</span>`)}</div>` : null}
    <div class="mf-search__scene"><i class="mf-cross mf-cross--tl"></i><i class="mf-cross mf-cross--tr"></i><${PixelScout} /><i class="mf-cross mf-cross--bl"></i><i class="mf-cross mf-cross--br"></i></div>
    <p key=${i} class="mf-search__tip">${tips.length ? tips[i % tips.length] : ''}</p>
    ${note ? html`<p class="mf-search__note">${note}</p>` : null}
    ${onStop ? html`<button type="button" class="mf-stop" onClick=${onStop} disabled=${stopping}><span class="mf-stop__x"><${Icon} name="close" /></span>${t('停止搜寻')}</button>` : null}
  </aside>`;
}

/** 搜寻成功 panel (green, lines converging on `seats` nodes); it breaks in with a green glitch (css tr-glitch-*). */
export function FoundPanel({ seats = 4, text = null, class: cls = '' }) {
  const n = Math.max(1, Math.min(10, seats | 0));
  const xs = Array.from({ length: n }, (_, k) => 40 + (k + 0.5) * (200 / n));
  const paths = [];
  for (let k = 0; k < 14; k++) {
    const from = 10 + k * 17;
    const to = xs[k % n];
    paths.push(html`<path key=${k} style=${`--k:${k}`} d=${`M${from} -10 C${from} 120 ${to + (k % 2 ? 30 : -30)} 140 ${to} 250`} />`);
  }
  return html`<aside class=${`mf-found ${cls}`} role="status" aria-live="assertive">
    <${BrandMark} />
    <svg class="mf-found__lines" viewBox="0 0 280 270" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      ${paths}
      ${xs.map((x, k) => html`<rect key=${`n${k}`} class="mf-found__node" x=${x - 6} y="246" width="12" height="12" />`)}
    </svg>
    <div class="mf-found__face" aria-hidden="true">
      <svg viewBox="0 0 64 64"><rect x="6" y="8" width="52" height="48" rx="8" /><rect class="mf-found__eye" x="18" y="24" width="7" height="8" /><path class="mf-found__wink" d="M37 29h10" /><path class="mf-found__smile" d="M22 42q10 7 20 0" /></svg>
    </div>
    <b class="mf-found__title">${t('搜寻成功！')}</b>
    <span class="mf-found__sub">${text || t('正在连接中…')}</span>
  </aside>`;
}

/** 选择同盟方式's radar: rings, a sweep, blips and bearing / range read-outs that keep changing. */
export function RadarScene() {
  const [read, setRead] = useState({ deg: 139, range: 2732 });
  useEffect(() => {
    const id = setInterval(() => setRead((r) => ({ deg: (r.deg + 37) % 360, range: 2600 + Math.floor(Math.random() * 260) })), 1400);
    return () => clearInterval(id);
  }, []);
  return html`<svg class="mf-radar" viewBox="0 0 600 460" aria-hidden="true" focusable="false">
    <g class="mf-radar__grid">${Array.from({ length: 11 }, (_, k) => html`<line key=${`v${k}`} x1=${k * 60} y1="0" x2=${k * 60} y2="460" />`)}
      ${Array.from({ length: 8 }, (_, k) => html`<line key=${`h${k}`} x1="0" y1=${k * 60 + 20} x2="600" y2=${k * 60 + 20} />`)}</g>
    <g class="mf-radar__land"><path d="M210 120l40-18 52 6 30-14 46 20 20 34-8 30 26 22-14 34-40 10-22 30-46-6-30 18-28-26 6-34-26-20 10-36-24-22z" /></g>
    <circle class="mf-radar__ring mf-radar__ring--far" cx="270" cy="250" r="190" />
    <circle class="mf-radar__ring" cx="270" cy="250" r="130" />
    <circle class="mf-radar__ring mf-radar__ring--core" cx="270" cy="250" r="70" />
    <g class="mf-radar__sweep"><path d="M270 250 L270 60 A190 190 0 0 1 404 116 Z" /><line x1="270" y1="250" x2="404" y2="116" /></g>
    <circle class="mf-radar__blip" cx="350" cy="196" r="7" />
    <circle class="mf-radar__blip mf-radar__blip--b" cx="200" cy="320" r="5" />
    <path class="mf-radar__cross" d="M262 250h16M270 242v16" />
    <g class="mf-radar__read"><rect x="384" y="236" width="74" height="26" /><text x="421" y="254" text-anchor="middle">${read.deg}°</text>
      <rect x="384" y="276" width="74" height="26" /><text x="421" y="294" text-anchor="middle">${read.range}</text></g>
    <path class="mf-radar__frame" d="M120 110v-16h16M420 94h16v16M120 390v16h16M420 406h16v-16" />
  </svg>`;
}

/** 创建同盟's picture: an octagon emblem with a plus and circuit lines. */
export function CreateArt() {
  return html`<svg class="mf-art mf-art--create" viewBox="0 0 400 130" aria-hidden="true" focusable="false">
    <path class="mf-art__wire" d="M0 50h90l20 14h50M0 80h96l18-12h46M400 50h-90l-20 14h-50M400 80h-96l-18-12h-46M30 30h60M310 30h60M40 104h44M316 104h44" />
    <path class="mf-art__oct" d="M180 28h40l18 18v40l-18 18h-40l-18-18V46z" />
    <path class="mf-art__plus" d="M193 66h14M200 52v28" />
    <path class="mf-art__brk" d="M156 46q-10 20 0 40M244 46q10 20 0 40" />
    <rect class="mf-art__dot" x="176" y="16" width="6" height="6" transform="rotate(45 179 19)" /><rect class="mf-art__dot" x="218" y="16" width="6" height="6" transform="rotate(45 221 19)" />
    <rect class="mf-art__dot" x="176" y="110" width="6" height="6" transform="rotate(45 179 113)" /><rect class="mf-art__dot" x="218" y="110" width="6" height="6" transform="rotate(45 221 113)" />
    <text x="200" y="12" text-anchor="middle">FORM AN ALLIANCE</text>
  </svg>`;
}

/** 加入同盟's picture: a row of isometric blocks, the middle ones lit, a target over them. */
export function JoinArt() {
  const blocks = [];
  for (let k = 0; k < 10; k++) {
    const x = 18 + k * 38, lit = k >= 2 && k <= 7;
    blocks.push(html`<g key=${k} class=${`mf-blk${lit ? ' is-lit' : ''}`} style=${`--k:${k}`}>
      <path class="mf-blk__top" d=${`M${x} 70l18-9 18 9-18 9z`} />
      <path class="mf-blk__l" d=${`M${x} 70l18 9v26l-18-9z`} />
      <path class="mf-blk__r" d=${`M${x + 36} 70l-18 9v26l18-9z`} />
    </g>`);
  }
  return html`<svg class="mf-art mf-art--join" viewBox="0 0 400 120" aria-hidden="true" focusable="false">
    <path class="mf-art__wire" d="M200 0v14M150 30h28M222 30h28" />
    <path class="mf-art__tri" d="M193 14h14l-7 8z" />
    <rect class="mf-art__target" x="186" y="26" width="28" height="30" />
    <path class="mf-art__x" d="M193 34l14 14M207 34l-14 14" />
    ${blocks}
    <text x="330" y="22" text-anchor="middle">JOIN AN ALLIANCE</text>
  </svg>`;
}
