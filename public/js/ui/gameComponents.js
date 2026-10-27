// Shared in-match building blocks (Preact + htm): data hook, images with fallbacks, rich text,
// unit thumbnails, LP tower, coin badge, official UI sprites. Styles: css/screens/game*.css.

import { useState, useMemo } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, Tooltip } from './components.js';
import { data, useData, localAsset } from '../data.js';
import { parseRichText, rtClassName } from './richText.js';
import { t as tr } from '../../../shared/i18n.js';
import { useStore, store } from '../store.js';
import { skinsStore, ownerSkin, tokenSkinShown } from './skins.js';
import { settingsStore } from './settingsStore.js';
import {
  uiUrl, chessAvatarUrl, chessPortraitUrl, itemIconUrl, tokenAvatarUrl, enemyIconUrl, bondIconUrl, bandIconUrl,
} from './assetUrls.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Data files the in-match screens use (`backups`: the 补位 stand-ins' bodies — cards, the board model, the detail card). */
export const GAME_FILES = ['config', 'assets', 'chess', 'bonds', 'items', 'bands', 'enemies', 'bosses', 'stages', 'tokens',
  'choices', 'effects', 'garrisons', 'factions', 'local', 'backups'];

/**
 * Load every in-match data file; returns lookups (sync, null until loaded).
 * @returns {{ ready: boolean, m: any, config: any, chess: (id:string)=>any, bond: (id:string)=>any, item: (id:string)=>any,
 *   band: (id:string)=>any, enemy: (k:string)=>any, boss: (id:string)=>any, stage: (id:string)=>any, token: (id:string)=>any,
 *   effect: (id:string)=>any, garrison: (id:string)=>any, factions: any, choices: any, backups: any, list: (name:string)=>any[] }}
 */
export function useGameData() {
  const ready = useData(...GAME_FILES);
  // (config / factions / choices are read once per memo: a language switch reads them again in the new locale, a
  // content switch — a version or a plugin set — from the new files)
  return useMemo(() => makeLookups(ready), [ready, data.locale(), data.contentId()]);
}

/** A 自选 operator's summon record (data/backups.json `tokens`, 0.2.0), or null. */
export function diyToken(id) {
  const t = typeof id === 'string' ? data.get('backups')?.tokens : null;
  return t && Object.hasOwn(t, id) ? t[id] : null;
}

/** Non-hook lookups (for event handlers). */
export function makeLookups(ready = true) {
  return {
    ready,
    m: data.get('assets'),
    config: data.get('config'),
    chess: (id) => data.lookup('chess', id),
    bond: (id) => data.lookup('bonds', id),
    item: (id) => data.lookup('items', id),
    band: (id) => data.lookup('bands', id),
    enemy: (k) => data.lookup('enemies', k),
    boss: (id) => data.lookup('bosses', id),
    stage: (id) => data.lookup('stages', id),
    // (a 自选 operator's summons are data/backups.json tokens — 0.2.0, the hand piece of a placeable one)
    token: (id) => data.lookup('tokens', id) || diyToken(id),
    effect: (id) => data.lookup('effects', id),
    garrison: (id) => data.lookup('garrisons', id),
    factions: data.get('factions'),
    choices: data.get('choices'),
    backups: data.get('backups'),
    list: (name) => data.list(name),
  };
}

/**
 * <img> that swaps to a fallback node when the URL is missing or fails.
 * @param {{ src?: string|null, class?: string, alt?: string, fallback?: any, style?: string }} props
 */
export function Img({ src, class: cls, alt = '', fallback = null, style }) {
  const [bad, setBad] = useState(null);
  if (!src || bad === src) return fallback;
  return html`<img class=${cls} src=${src} alt=${alt} draggable=${false} loading="lazy" style=${style} onError=${() => setBad(src)} />`;
}

/** Owner-aware operator pictures, with live selection / settings updates even on an already open card.
 * `ownerId` omitted = local picker; null = unowned catalogue art. Callers resolve stand-ins / DIY first.
 * B6, maintainer option A (2026-10-18); docs/SKINS.md and §35.4. Model outfits retain their models.
 */
export function OperatorImage({ m, chess, ownerId, skin = null, portrait = false, avatarFallback = false,
  portraitClass, avatarClass, ...props }) {
  useData('assets');
  m = data.get('assets') || m;
  const localSkins = useStore((s) => s.skins, Object.is, skinsStore);
  const otherSkins = useStore((s) => s.otherSkins, Object.is, settingsStore);
  const selected = useStore((s) => ownerSkin(chess?.charId, { ownerId, skin, myId: s.me.playerId,
    players: s.match.public?.players || [], localSkins, otherSkins }));
  const art = portrait ? chessPortraitUrl(m, chess, { skin: selected }) : null;
  const src = art || (!portrait || avatarFallback ? chessAvatarUrl(m, chess, { skin: selected }) : null);
  return html`<${Img} ...${props} src=${src} class=${art ? portraitClass ?? props.class : avatarClass ?? props.class} />`;
}

/** Official UI sprite by 'group/key' with a fallback. */
export function Sprite({ k, class: cls, fallback = null }) {
  return html`<${Img} src=${uiUrl(data.get('assets'), k)} class=${cx('sprite', cls)} fallback=${fallback} />`;
}

/** Official promotion phase from the resolved record's status (not its shop tier or normal / golden form). */
export function PromotionIcon({ m, phase, class: cls }) {
  if (!Number.isInteger(phase) || phase < 0 || phase > 2) return null;
  return html`<${Img} src=${uiUrl(m, `elite/elite_${phase}`)} class=${cls}
    fallback=${html`<small class=${cls}>E${phase}</small>`} />`;
}

/**
 * Official sprite from the local-client extraction (data/local-assets.json, DESIGN §13) with a fallback node when the
 * manifest / entry is missing or the image fails.
 * @param {{ group?: string, name: string, class?: string, fallback?: any }} props
 */
export function LocalSprite({ group = 'ui/battle', name, class: cls, fallback = null }) {
  return html`<${Img} src=${localAsset(group, name)} class=${cx('lsprite', cls)} fallback=${fallback} />`;
}

/**
 * Rich text (official markup) → spans. Newlines become <br>.
 * @param {{ text: any, class?: string, as?: string }} props
 */
export function RichText({ text, class: cls, as = 'span' }) {
  const segs = useMemo(() => parseRichText(text), [text]);
  const Tag = as;
  return html`<${Tag} class=${cx('rt', cls)}>${segs.map((s, i) => (s.br
    ? html`<br key=${i} />`
    : s.cls.length || s.term
      ? html`<span key=${i} class=${cx(s.cls.map((c) => rtClassName(c)), s.term && 'rt-term')}>${s.text}</span>`
      : s.text))}<//>`;
}

/** Golden (elite) chess? */
export const isGoldenPiece = (piece, chess) => !!(piece?.golden || chess?.isGolden || (typeof piece?.id === 'string' && /_b$/.test(piece.id) && piece.kind !== 'item'));

/**
 * Square unit thumbnail for a piece / chess / item / token / enemy: art + tier chip + elite frame.
 * @param {{ kind?: 'chess'|'item'|'token'|'enemy', id: string, golden?: boolean, size?: 'xs'|'sm'|'md'|'lg', tier?: number,
 *   showTier?: boolean, class?: string, dim?: boolean, badge?: any, title?: string, rec?: any, ownerId?: string|null, skin?: string|null }} props
 *   `rec`: the chess record to draw instead of the data's (a 自选 piece's composed record — 0.2.0, gameLogic/diy.js; a
 *   补位 stand-in's — gameLogic/standIn.js: drawn with a small 「替补」 mark in the corner)
 */
/** The summon outfit this viewer may see (#876; round-54 audit): read without hooks — thumbnails and the detail head are
 * also rendered as plain functions — and only when there is a skin to gate. */
function shownTokenSkin(skin, ownerId) {
  if (!skin) return null;
  return tokenSkinShown(skin, { ownerId, myId: store.get()?.me?.playerId ?? null, otherSkins: settingsStore.get()?.otherSkins !== false });
}

/** A summon's avatar in its owner's outfit (#876) under the operators' 显示其他玩家的皮肤 gate (round-54 audit). */
export function TokenAvatar({ m, tokenId, ownerId = null, skin = null, fallback = null }) {
  return html`<${Img} src=${tokenAvatarUrl(m, tokenId, { skin: shownTokenSkin(skin, ownerId) })} fallback=${fallback} />`;
}

export function UnitThumb({ kind = 'chess', id, golden, size = 'md', tier, showTier = true, class: cls, dim = false, badge = null, title, rec = null, ownerId, skin = null }) {
  const m = data.get('assets');
  // a summon wears its owner's outfit (#876) under the operators' 显示其他玩家的皮肤 gate (round-54 audit)
  const tokenSkin = kind === 'token' ? shownTokenSkin(skin, ownerId) : null;
  let src = null;
  let name = '';
  let t = tier;
  let si = null;
  if (kind === 'chess') {
    const c = rec || data.lookup('chess', id);
    si = rec && typeof rec.standInFor === 'string' && rec.standInFor ? rec : null;
    name = c?.name || '';
    t = t ?? c?.tier;
    golden = golden ?? !!c?.isGolden;
  } else if (kind === 'item') {
    const it = data.lookup('items', id);
    src = itemIconUrl(m, it);
    name = it?.name || '';
    t = t ?? it?.tier;
    golden = golden ?? !!it?.isGolden;
  } else if (kind === 'token') {
    const tk = data.lookup('tokens', id);
    src = tokenAvatarUrl(m, id, { skin: tokenSkin });
    name = tk?.name || '';
  } else if (kind === 'enemy') {
    const e = data.lookup('enemies', id);
    src = enemyIconUrl(m, id);
    name = e?.name || '';
  }
  const glyph = [...(name || '?')][0] || '?';
  return html`<span class=${cx('uthumb', `uthumb--${size}`, `uthumb--${kind}`, golden && 'is-golden', dim && 'is-dim', t && `uthumb--t${Math.max(1, Math.min(6, t | 0))}`, cls)}
      title=${title ?? name}>
    <span class="uthumb__art">
      ${kind === 'chess'
        ? html`<${OperatorImage} m=${m} chess=${rec || data.lookup('chess', id)} ownerId=${ownerId} skin=${skin} fallback=${html`<span class="uthumb__glyph">${glyph}</span>`} />`
        : html`<${Img} src=${src} fallback=${html`<span class="uthumb__glyph">${glyph}</span>`} />`}
    </span>
    ${showTier && t && kind !== 'enemy' && kind !== 'token' ? html`<${TierChip} tier=${t} golden=${golden} size="sm" class="uthumb__tier" />` : null}
    ${kind === 'token' ? html`<span class="uthumb__tag">${tr('召唤')}</span>` : null}
    ${si ? html`<span class="uthumb__si" data-standin=${si.charId} aria-hidden="true">${tr('替补')}</span>` : null}
    ${badge}
  </span>`;
}

/** Thumbnail for an m.private Piece. */
export function PieceThumb({ piece, size = 'md', class: cls, badge }) {
  if (!piece) return null;
  return html`<${UnitThumb} kind=${piece.kind === 'item' ? 'item' : piece.kind === 'token' ? 'token' : 'chess'} id=${piece.id}
    golden=${!!piece.golden} tier=${piece.tier} size=${size} class=${cls} badge=${badge} />`;
}

/**
 * A regular gear centred in the 24×24 box (even-odd path): `teeth` trapezoid teeth (width tipW at the tip circle
 * rTip, rootW at the root circle rRoot; the first one straight up), arcs along both circles, and a round hole. The
 * settings button's gear (user playtest #5 item 8): the hand-written path it replaces had teeth of different sizes
 * and spacing on a rim that was not round (it bulged at 9 o'clock and was cut flat elsewhere) — a deformed icon.
 * @param {{ teeth?: number, rTip?: number, rRoot?: number, tipW?: number, rootW?: number, rHole?: number }} [o]
 */
export function gearPath({ teeth = 8, rTip = 10, rRoot = 7.4, tipW = 3.2, rootW = 4.4, rHole = 3.3 } = {}) {
  const c = 12;
  const f = (v) => String(Math.round(v * 100) / 100 + 0);
  const pt = (a, r) => `${f(c + r * Math.cos(a))} ${f(c + r * Math.sin(a))}`;
  const at = Math.asin(tipW / 2 / rTip), ar = Math.asin(rootW / 2 / rRoot), step = (2 * Math.PI) / teeth;
  let d = `M${pt(-Math.PI / 2 - ar, rRoot)}`;
  for (let i = 0; i < teeth; i++) {
    const t = -Math.PI / 2 + i * step;
    d += `L${pt(t - at, rTip)}A${f(rTip)} ${f(rTip)} 0 0 1 ${pt(t + at, rTip)}L${pt(t + ar, rRoot)}`
      + `A${f(rRoot)} ${f(rRoot)} 0 0 1 ${pt(t + step - ar, rRoot)}`;
  }
  return `${d}ZM${f(c)} ${f(c - rHole)}A${f(rHole)} ${f(rHole)} 0 1 0 ${f(c)} ${f(c + rHole)}`
    + `A${f(rHole)} ${f(rHole)} 0 1 0 ${f(c)} ${f(c - rHole)}Z`;
}

/** Extra 24×24 glyphs used by the in-match HUD (original shapes). */
export const GLYPHS = Object.freeze({
  gear: gearPath(),
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  emote: 'M8.2 2h7.6L22 8.2v7.6L15.8 22H8.2L2 15.8V8.2zM8.5 8.5v3h2v-3zm5 0v3h2v-3zM7.8 14.2a5.5 5.5 0 0 0 8.4 0l-1.5-1.3a3.5 3.5 0 0 1-5.4 0z',
  dp: 'M13 2 4 13.5h6.2L9 22l11-12.5h-6.4z',
  skull: 'M12 2a8.5 8.5 0 0 0-5 15.4V21h3v-2h1v2h2v-2h1v2h3v-3.6A8.5 8.5 0 0 0 12 2zM8.5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sell: 'M12 2 3 7v10l9 5 9-5V7zm-1 5h2v2.1c1.3.3 2.3 1.2 2.4 2.4h-2c-.1-.4-.6-.7-1.4-.7-.9 0-1.3.3-1.3.7 0 .4.3.6 1.6.9 1.9.4 3.2 1 3.2 2.6 0 1.2-1 2.1-2.5 2.4V19h-2v-1.6c-1.4-.3-2.5-1.2-2.6-2.6h2c.1.5.7.9 1.6.9 1 0 1.5-.3 1.5-.8 0-.4-.4-.6-1.8-.9-1.8-.4-3-1-3-2.5 0-1.2 1-2 2.3-2.3z',
  trash: 'M9 2h6l1 2h4v2H4V4h4zM5 7h14l-1.2 15H6.2zm4 3v9h2v-9zm4 0v9h2v-9z',
  back: 'M10 5 3 12l7 7 1.4-1.4L6.8 13H21v-2H6.8l4.6-4.6z',
  flag: 'M5 2h2v20H5zm3 1h11l-2.5 4.5L19 12H8z',
  target: 'M11 2h2v3.1A7 7 0 0 1 18.9 11H22v2h-3.1A7 7 0 0 1 13 18.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
});

/** Extra HUD glyph. */
export function GIcon({ name, class: cls, title }) {
  const d = GLYPHS[name];
  if (!d) return html`<${Icon} name=${name} class=${cls} title=${title} />`;
  return html`<svg class=${cx('icon', cls)} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden=${title ? undefined : 'true'} focusable="false">
    ${title ? html`<title>${title}</title>` : null}<path d=${d} fill-rule="evenodd" /></svg>`;
}

/**
 * Green LP tower + number. `pending` (> 0): the loss the running battle's leaks will cost at settlement (user
 * playtest #3 item 2) — the number keeps the settled LP (owner-approved #479 / #504),
 * shown in red with a −N tick that pops again on every change (keyed); `note` a
 * small tag after it (联防中); `tip` the title text.
 * @param {{ value: any, size?: 'sm'|'md'|'lg', class?: string, tone?: string|null, pending?: number, note?: string|null, tip?: string|null }} props
 */
export function LpTower({ value, size = 'md', class: cls, tone, pending = 0, note = null, tip = null }) {
  const ok = Number.isFinite(value);
  const p = ok && Number(pending) > 0 ? Math.min(value, Math.trunc(Number(pending))) : 0;
  return html`<span class=${cx('lp', `lp--${size}`, tone && `lp--${tone}`, p > 0 && 'is-pending', cls)} title=${tip || tr('目标生命值')}
      data-pending=${p > 0 ? p : null}>
    <${Sprite} k="hudPanel/icon_hp" class="lp__icon" fallback=${html`<${Icon} name="rook" class="lp__icon" />`} />
    <b class="num lp__val">${ok ? Math.max(0, value) : '--'}</b>
    ${p > 0 ? html`<span key=${p} class="lp__pend num" aria-label=${tr('结算时扣除 {p}', { p })}>−${p}</span>` : null}
    ${note ? html`<span class="lp__note">${note}</span>` : null}
  </span>`;
}

/** Coin glyph (three stacked gold triangles). */
export function CoinGlyph({ class: cls }) {
  return html`<svg class=${cx('coin-glyph', cls)} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5 16.2 10H7.8z" /><path d="M7 11.5 11.2 18H2.8z" /><path d="M17 11.5 21.2 18h-8.4z" />
  </svg>`;
}

/** Bond glyph image (white mask tinted by CSS) or first-letter fallback. */
export function BondGlyph({ bondId, class: cls }) {
  const b = data.lookup('bonds', bondId);
  const src = bondIconUrl(data.get('assets'), bondId);
  return html`<span class=${cx('bglyph', cls)} title=${b?.name || bondId}>
    <${Img} src=${src} fallback=${html`<span class="bglyph__txt">${[...(b?.name || '?')][0]}</span>`} />
  </span>`;
}

/** Band (strategy) icon. */
export function BandIcon({ bandId, class: cls, size = 'md' }) {
  const b = data.lookup('bands', bandId);
  return html`<span class=${cx('bandicon', `bandicon--${size}`, cls)} title=${b?.name || ''}>
    <${Img} src=${bandIconUrl(data.get('assets'), bandId)} fallback=${html`<span class="bandicon__txt">${[...(b?.name || '?')][0]}</span>`} />
  </span>`;
}

/** Item (equipment) icon with tier chip. */
export function ItemIcon({ itemId, class: cls, size = 'md', showTier = true }) {
  return html`<${UnitThumb} kind="item" id=${itemId} size=${size} class=${cls} showTier=${showTier} />`;
}

/** Tooltip-wrapped help text with rich markup. */
export function RichTip({ text, children, placement = 'top' }) {
  return html`<${Tooltip} text=${text ? html`<${RichText} text=${text} />` : null} placement=${placement}>${children}<//>`;
}

/**
 * Seat-coloured player avatar: band icon when a band is picked, else glyph/robot.
 * @param {{ player: any, size?: 'sm'|'md', self?: boolean, class?: string }} props
 */
export function PlayerAvatar({ player, size = 'md', self = false, class: cls }) {
  const src = player?.bandId ? bandIconUrl(data.get('assets'), player.bandId) : null;
  const glyph = [...(player?.name || '').trim()][0] || '?';
  const dead = player?.alive === false || player?.status === 'dead';
  const left = player?.status === 'left';
  const hue = [162, 196, 38, 280][((player?.seat | 0) % 4 + 4) % 4];
  return html`<span class=${cx('pavatar', `pavatar--${size}`, self && 'is-self', dead && 'is-dead', left && 'is-left', player?.isBot && 'is-bot',
      player?.connected === false && !player?.isBot && 'is-offline', cls)} style=${`--seat-hue:${hue}`}>
    <span class="pavatar__img">
      <${Img} src=${src} fallback=${player?.isBot ? html`<${Icon} name="robot" class="pavatar__bot" />` : html`<span class="pavatar__glyph">${glyph}</span>`} />
    </span>
    ${dead ? html`<span class="pavatar__x" aria-label=${tr('已淘汰')}><${Icon} name="close" /></span>` : null}
    ${left ? html`<span class="pavatar__door" aria-label=${tr('已离开')}><${Icon} name="exit" /></span>` : null}
  </span>`;
}
