import { useAccount, AccountTag } from '../ui/accounts.js';
import { TrophyBadge } from '../ui/trophies.js';
import { isOwnerName, decorateOwnerName } from '../ui/ownerName.js';
import { enabled as federationEnabled, currentNode } from '../federation.js';
// Room screen (同盟等待室). 2026-10-13 (the owner's request: the event's room, video 5:22–6:29): tall seat cards side by
// side — a portrait per doctor (名片干员: the player's own pick — room.card, room.state seats[].card; one's own screen shows
// it at once, the others once the server takes room.card — else an operator chosen from the player id), 创建者, 已就绪 / 准备中
// / 失去信号, the name plate with the account avatar and #tag, the host's 移出; an empty seat is 邀请 (copies the
// alliance key) or, while searching, a waiting glyph. Top: leave, the time waited, latency, 统计 / 设置 / 玩法说明, the
// alliance key with 复制 / 链接. Bottom: 干员调配, the status line, the 精确搜寻 | difficulty | ⚙ pill (the host picks the
// difficulty in 选择模拟协议 over the room and keeps 私密房间 / 人数上限 / AI 队友最后选择 / 无限火力 branch under ⚙),
// 开始搜寻 and 开始模拟 (host) or 准备就绪. 开始搜寻 runs the server's room queue (match.queue: same mode and
// difficulty) and keeps it running until stopped or full (the server ends a room's turn after 10 s without bots: the
// host's client queues again); everybody sees 搜寻中 (ui/matchFlow.js), then 搜寻成功 when the seats fill or a player
// arrives through match.found. 人数上限 only shows when shared/constants.js allows more than DEFAULT_SEATS.
// Motion (the event's, css tr-*): the room comes up from black card by card and fades out when left; a doctor turning
// 已就绪 flashes green; 选择模拟协议, ⚙, 搜寻中 and 搜寻成功 stay mounted while they fade out (ui/transitions.js).
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SPECTATORS } from '../../../shared/constants.js';
// seat counts through the namespace: the live constants (before the 10-seat package) have MAX_SEATS 4 and no DEFAULT_SEATS
import * as SEAT_CONST from '../../../shared/constants.js';
import { RANDOM_MODE, RANDOM_MODE_NAME } from '../../../shared/randomMode.js';
import {
  html, Button, Icon, MicroLabel, AvatarFrame, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Spinner, Modal,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { openFriends } from '../ui/friends.js';
import { NameCardLayer } from '../ui/namecards.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, serverNow, loadPref, savePref } from '../store.js';
import { data, useData } from '../data.js';
import { chessAvatarUrl } from '../ui/assetUrls.js';
import { CARD_PREF, cardOperators, seatPortrait } from '../ui/seatArt.js';
import { C2S } from '../../../shared/protocol.js';
import { difficultyInfo, ProtoCard } from './lobby.js';
import { ProtocolScene } from '../ui/protocolScene.js';
import { SearchPanel, FoundPanel } from '../ui/matchFlow.js';
import { usePresence, useRise, afterLeave } from '../ui/transitions.js';
import { t, tc } from '../../../shared/i18n.js';

const MAX_SEATS = Number(SEAT_CONST.MAX_SEATS) || 4;
const DEFAULT_SEATS = Number(SEAT_CONST.DEFAULT_SEATS) || MAX_SEATS;

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = room?.mode === 'solo' ? 1 : Math.min(MAX_SEATS, Math.max(DEFAULT_SEATS, Number(room?.maxSeats) || (Array.isArray(room?.seats) ? room.seats.length : DEFAULT_SEATS)));
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine,
    othersReady,
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * The co-op room option 「AI 队友最后选择」 (GitHub #338; room.setAiPicksLast, room.state.aiPicksLast): in the strategy and
 * 机变 drafts every human picks before the AI teammates. null in a solo room (no AI teammates); otherwise its state (off
 * when the server sends none) and whether this player may switch it — the host only, the others see it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}${federationEnabled ? '&node='+currentNode() : ''}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

// 名片干员 portraits (the pick, else one chosen by the player id): ui/seatArt.js, shared with the strategy draft's rows
export { CARD_PREF, cardOperators, seatPortrait };
/** The server takes room.card (shared/protocol.js of the 10-seat package on): teammates then see one's pick. */
export const CARD_SYNC = !!C2S && Object.hasOwn(C2S, 'room.card');
// what else the server offers (its own shared/protocol.js): 开始搜寻 needs match.queue, 私密房间 room.setPrivate
const CAN_QUEUE = !!C2S && Object.hasOwn(C2S, 'match.queue');
const CAN_PRIVATE = !!C2S && Object.hasOwn(C2S, 'room.setPrivate');


/** 名片干员 picker: search, rarity, the operators' avatars; 默认 clears the pick. */
function CardPicker({ current, list, m, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => (!star || c.rarity === star) && (!needle || String(c.name || '').toLowerCase().includes(needle)
    || String(c.appellation || '').toLowerCase().includes(needle)));
  return html`<${Modal} open=${true} title=${t('名片干员')} micro="SEAT CARD" onClose=${onClose} width="min(9.6rem, 94vw)" class="cardpick">
    <div class="cardpick__bar">
      <label class="cardpick__search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('搜索干员')} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[[0, t('全部')], [6, '6★'], [5, '5★'], [4, '4★']].map(([v, label]) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => setStar(v)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardpick__grid">
      <button type="button" class=${`cardpick__op cardpick__op--auto${!current ? ' is-on' : ''}`} onClick=${() => onPick('')} title=${t('按博士编号自动分配')}>
        <span class="cardpick__img"><${Icon} name="refresh" /></span><span class="cardpick__name">${t('默认')}</span></button>
      ${shown.map((c) => html`<button key=${c.charId} type="button" class=${`cardpick__op${current === c.charId ? ' is-on' : ''}`} onClick=${() => onPick(c.charId)} title=${c.name}>
        <span class="cardpick__img"><img src=${chessAvatarUrl(m, c)} alt="" loading="lazy" draggable=${false} /></span>
        <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class=${`cardpick__star r${c.rarity}`}>${c.rarity}★</span>` : null}</button>`)}
    </div>
    <p class="cardpick__note"><${Icon} name="info" />${CARD_SYNC ? t('选择后，同盟里的博士都会看到这张立绘') : t('目前只有你自己看得到；服务器下次更新后，同盟里的其他博士也能看到你的选择')}</p>
  <//>`;
}

function SeatCard({ seat, index, room, facts, myId, busy, onKick, onInvite, searching, portraits, onPickCard = null }) {
  const seatAccount = useAccount(seat && !seat.isBot ? seat.playerId : null);
  const [bad, setBad] = useState(null);
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId));
  if (!seat) {
    const invitable = room.mode !== 'solo' && !facts.spectating;
    return html`<article class=${`rseat rseat--empty${searching ? ' is-searching' : ''}`} style=${`--i:${index}`}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
      <div class="rseat__art">
        ${searching
          ? html`<span class="rseat__wait"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2l5 5-5 5-5-5z" /><rect x="10" y="16" width="14" height="22" rx="3" /><path d="M24 22h10l-4 7 4 7H24" /></svg><small>STRONGHOLD PROTOCOL</small></span>`
          : invitable
            ? html`<button type="button" class="rseat__invite" onClick=${onInvite} title=${t('复制同盟密钥以邀请队友')}>
                <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('复制同盟密钥以邀请队友')}</small></button>`
            : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty" aria-hidden="true"></div>
    </article>`;
  }
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  const ready = seat.ready || seat.isBot || isHostSeat;
  const src = seat.isBot ? null : seatPortrait(seat, portraits);
  const owner = isOwnerName(seat.name);
  const canPick = isMe && !seat.isBot && !!onPickCard;
  return html`<article class=${`rseat${ready ? ' is-ready' : ''}${flash ? ' is-flash' : ''}${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${offline ? ' is-offline' : ''}${seat.isBot ? ' is-bot' : ''}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
    <div class=${`rseat__art${canPick ? ' is-pickable' : ''}`} onClick=${canPick ? onPickCard : undefined} title=${canPick ? t('点击更换名片干员') : undefined}>
      ${src && bad !== src ? html`<img src=${src} alt="" draggable=${false} loading="lazy" onError=${() => setBad(src)} />`
        : html`<span class="rseat__glyph">${seat.isBot ? html`<${Icon} name="robot" />` : [...(seat.name || '?')][0]}</span>`}
      ${canPick ? html`<button type="button" class="rseat__pick" onClick=${(e) => { e.stopPropagation(); onPickCard(); }} aria-label=${t('更换名片干员')}><${Icon} name="edit" /><span>${t('更换立绘')}</span></button>` : null}
      ${isHostSeat ? html`<span class="rseat__host">${t('创建者')}</span>` : null}
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('失去信号')}</span>` : null}
      <span class="rseat__state">${ready
        ? html`<span class="rseat__box"><${Icon} name="check" /></span>${isHostSeat && !seat.ready ? t('待命中') : t('已就绪')}`
        : html`<span class="rseat__box"></span>${t('准备中')}`}</span>
    </div>
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    <div class=${`rseat__plate${seatAccount?.card ? ' has-nc' : ''}`}>
      <${NameCardLayer} card=${seatAccount?.card} />
      ${isMe ? html`<span class="rseat__me" title=${t('你')}><${Icon} name="info" /></span>` : null}
      <${AvatarFrame} size="sm" name=${seat.name} src=${seatAccount?.avatar || undefined} seat=${index} bot=${seat.isBot} self=${isMe} />
      <span class="rseat__who">
        <${TrophyBadge} count=${seatAccount?.trophies} class="tbadge--inline" /><b class=${`rseat__name${owner ? ' sp-owner-name' : ''}`}>${seat.name || t('博士')}</b><${AccountTag} playerId=${seat.isBot ? null : seat.playerId} />
        ${owner ? html`<span class="sp-owner-badge">服主</span>` : null}
      </span>
      <small class="rseat__doc">${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}</small>
    </div>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

/** The 「AI 队友最后选择」 switch (co-op): the host toggles it, everybody else sees its state. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

/** mm:ss of a duration in seconds. */
const clock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s)) % 60).padStart(2, '0')}`;

/** 选择模拟协议 over the room (host): the difficulty cards and 确认. */
function RoomProtocol({ room, variant, onClose, onPick, busy, leaving = false }) {
  const [pick, setPick] = useState(room.difficulty);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`<div class=${`rs-proto${leaving ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[pick]}`} role="dialog" aria-label=${t('选择模拟协议')}
      onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="rs-proto__scene" aria-hidden="true"><${ProtocolScene} key=${pick} difficulty=${pick} /></div>
    <section class="rs-proto__side">
      <h2 class="rs-proto__title">${t('选择模拟协议')}</h2>
      <div class="proto-list rs-proto__list" role="radiogroup" aria-label=${t('模拟难度')}>
        ${DIFFICULTIES.map((d) => html`<${ProtoCard} key=${d} roomMode=${room.mode} difficulty=${d} selected=${pick === d} onSelect=${setPick}
          random=${room.random === true} variant=${variant} />`)}
      </div>
      <button type="button" class="proto-start rs-proto__ok" disabled=${!!busy} onClick=${() => (pick === room.difficulty ? onClose() : onPick(pick))}>
        <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
        <span class="proto-start__label">${busy === 'diff' ? html`<${Spinner} size="sm" />` : null}${t('确认')}</span>
        <span class="proto-start__deco" aria-hidden="true"></span>
      </button>
    </section>
  </div>`;
}

/** ⚙ of the bottom pill: 私密房间, 人数上限 (with the 10-seat constants), AI 队友最后选择, 无限火力 branch. */
function RoomOptions({ room, facts, myId, busy, online, variant, onPrivate, onMaxSeats, onAiLast, onVariant, onClose, leaving = false }) {
  const coop = room.mode !== 'solo';
  const host = facts.isHost;
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away); addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  return html`<div class=${`rs-opts${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('同盟设置')}>
    <h4>${t('同盟设置')}${host ? null : html`<small>${t('由创建者设置')}</small>`}</h4>
    ${coop && CAN_PRIVATE ? html`<label class="rs-opt"><input type="checkbox" checked=${room.private === true} disabled=${!host || !!busy || !online} onChange=${(e) => onPrivate(e.currentTarget.checked)} />
      <span>${t('私密房间')}<small>${room.private ? t('仅凭同盟密钥或邀请加入，不能搜寻队友') : t('公开大厅可见，可以搜寻队友')}</small></span></label>` : null}
    ${coop && MAX_SEATS > DEFAULT_SEATS ? html`<label class="rs-opt rs-opt--cap"><span>${t('人数上限')}<small>${facts.seats.length > DEFAULT_SEATS ? t('仅邀请加入 · 卡池扩大') : t('可搜寻队友')}</small></span>
      <select value=${String(facts.seats.length)} disabled=${!host || !!busy || !online} onChange=${(e) => onMaxSeats(Number(e.currentTarget.value))}>
        ${Array.from({ length: MAX_SEATS - DEFAULT_SEATS + 1 }, (_, k) => DEFAULT_SEATS + k).map((n) => html`<option key=${n} value=${String(n)} selected=${n === facts.seats.length}>${t('{n} 人', { n })}</option>`)}
      </select></label>` : null}
    <${AiLastToggle} option=${aiLastOption(room, myId)} busy=${busy} onToggle=${onAiLast} />
    ${room.random === true ? html`<div class="rs-opt rs-opt--variant"><span>${t('模式分支')}</span>
      <div class="dpick" role="radiogroup" aria-label=${t('模式分支')}>
        ${[['blitz', `快速突袭 ${RANDOM_MODE.totalRounds} 回合`], ['endurance', `持久鏖战 ${RANDOM_MODE.endurance.totalRounds} 回合`], ['marathon', `最长时赛 ${RANDOM_MODE.marathon.totalRounds} 回合`]].map(([v, label]) => html`
          <button key=${v} type="button" role="radio" aria-checked=${variant === v ? 'true' : 'false'} class=${`dpick__opt${variant === v ? ' is-active' : ''}`}
            disabled=${!!busy || !host} onClick=${() => variant !== v && host && onVariant(v)}>${label}</button>`)}
      </div></div>` : null}
  </div>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const mm = useStore((s) => s.matchmaking, shallowEqual);
  const [busy, setBusy] = useState(null);
  const [picker, setPicker] = useState(false);
  const [opts, setOpts] = useState(false);
  const [searchWant, setSearchWant] = useState(false); // the host asked to search and has not stopped
  const [searchSince, setSearchSince] = useState(0);
  const [found, setFound] = useState(false);
  const [lastMatching, setLastMatching] = useState(0); // a short grace while the host's client queues the room again
  const [since] = useState(() => Date.now());
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  const requeue = useRef(false);
  const prevEmpty = useRef(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => { clearInterval(id); alive.current = false; }; }, []);
  useData('chess', 'assets');
  const m = data.get('assets');
  // 名片干员: the pickable operators, the default pool (5★/6★ by charId, the same order on every client), one's pick
  const cardList = useMemo(() => cardOperators(data.list('chess')), [data.get('chess')]);
  const [myCard, setMyCard] = useState(() => { const v = loadPref(CARD_PREF, ''); return typeof v === 'string' ? v : ''; });
  const [picking, setPicking] = useState(false);
  const portraits = useMemo(() => ({
    pool: cardList.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
    byChar: new Map(cardList.map((c) => [c.charId, c])), m, myId: me.playerId, myCard,
  }), [cardList, m, me.playerId, myCard]);
  const pickCard = (charId) => {
    setMyCard(charId); savePref(CARD_PREF, charId); setPicking(false);
  };
  // tell the server (teammates see it) once it knows room.card; a refused id stays local
  const seatCard = room ? (roomFacts(room, me.playerId).mine?.card || '') : '';
  useEffect(() => {
    if (!CARD_SYNC || !room || conn.status !== 'online' || seatCard === (myCard || '')) return;
    if (myCard && !portraits.byChar.has(myCard)) return;
    net.request('room.card', { charId: myCard || '' }).catch(() => {});
  }, [room?.code, myCard, seatCard, conn.status]);

  // arrived through 搜寻队友 (match.found for this room): 搜寻成功 once
  useEffect(() => {
    if (room && mm?.status === 'found' && mm.roomCode === room.code) {
      setFound(true);
      store.patch('matchmaking', { status: 'idle' });
    }
  }, [room?.code, mm?.status]);
  useEffect(() => { if (!found) return undefined; const id = setTimeout(() => alive.current && setFound(false), 1900); return () => clearTimeout(id); }, [found]);

  const online = conn.status === 'online';
  const coop = room ? room.mode !== 'solo' : false;
  const facts = room ? roomFacts(room, me.playerId) : null;
  const searchable = CAN_QUEUE && !!room && coop && facts.isHost && room.private !== true && facts.seats.length <= DEFAULT_SEATS && !room.inMatch;
  const firepower = room?.random === true;
  const variant = room?.variant === 'endurance' || room?.variant === 'marathon' ? room.variant : 'blitz';

  // the server ends a room's search turn after 10 s without bots: queue again while the host still wants it
  const prevMatching = useRef(null);
  const endedAt = useRef(0);
  useEffect(() => {
    if (!room) return undefined;
    // the end of a search turn: the others keep the panel for a moment while the host's client queues again
    if (prevMatching.current && !room.matching) { endedAt.current = Date.now(); setLastMatching(endedAt.current); }
    prevMatching.current = room.matching || null;
    if (room.matching) return undefined;
    if (!searchWant || !searchable || facts.emptySeats === 0 || !online || requeue.current) return undefined;
    requeue.current = true;
    const id = setTimeout(() => {
      net.request('match.queue', { mode: room.mode, difficulty: room.difficulty, random: firepower, ...(firepower ? { variant } : {}), fillBots: false })
        .catch((err) => { if (alive.current) { setSearchWant(false); toastError(err); } })
        .finally(() => { requeue.current = false; });
    }, 400);
    return () => { clearTimeout(id); requeue.current = false; };
  }, [room?.matching, searchWant, searchable, facts?.emptySeats, online]);
  // seats filled while searching → 搜寻成功; a stale wish is dropped
  useEffect(() => {
    if (!facts) return;
    const empty = facts.emptySeats;
    const wasSearching = searchWant || !!room.matching || Date.now() - endedAt.current < 2500;
    if (prevEmpty.current != null && empty < prevEmpty.current && wasSearching && empty === 0) setFound(true);
    if (empty === 0 && searchWant) setSearchWant(false);
    prevEmpty.current = empty;
  }, [facts?.emptySeats]);
  useEffect(() => { if (!searchable && searchWant) setSearchWant(false); }, [searchable]);
  const searching = !!room && coop && facts.emptySeats > 0 && (!!room.matching || (facts.isHost ? searchWant : Date.now() - lastMatching < 1600));
  // the overlays stay mounted while they fade out; 离开同盟 fades the room before the request goes out
  const [searchShown, searchLeaving] = usePresence(searching && !found, 220);
  const [foundShown, foundLeaving] = usePresence(found, 320);
  const [protoShown, protoLeaving] = usePresence(picker && !!facts?.isHost, 220);
  const [optsShown, optsLeaving] = usePresence(opts, 160);
  const [exiting, setExiting] = useState(false);

  if (!room) return null;
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty, { random: firepower, variant });
  const variantName = variant === 'endurance' ? '持久鏖战' : variant === 'marathon' ? '最长时赛' : '快速突袭';
  const modeName = firepower ? `${RANDOM_MODE_NAME} · ${variantName}` : coop ? t('同盟模拟') : t('独立模拟');
  const searchElapsed = facts.isHost && searchSince ? (Date.now() - searchSince) / 1000
    : room.matching?.startedAt ? (serverNow() - room.matching.startedAt) / 1000 : 0;

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const queueMatch = () => run('match', async () => {
    await net.request('match.queue', { mode: room.mode, difficulty: room.difficulty, random: firepower, ...(firepower ? { variant } : {}), fillBots: false });
    setSearchWant(true); setSearchSince(Date.now());
  });
  // 房主切换无限火力分支（blitz / endurance）——room.setRandom 带 variant
  const setVariant = (v) => run('variant', () => net.request('room.setRandom', { random: true, variant: v }));
  const cancelMatch = () => { setSearchWant(false); setLastMatching(0); if (room.matching) run('cancel-match', () => net.request('match.cancel', {})); };
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setPrivate = (isPrivate) => run('privacy', () => net.request('room.setPrivate', { private: isPrivate }));
  const setMaxSeats = (n) => run('cap', () => net.request('room.setMaxSeats', { n })); // 2026-10-12: 4–10 seats
  const setDifficulty = (difficulty) => run('diff', async () => { await net.request('room.setDifficulty', { difficulty }); setPicker(false); });
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const copy = async (what) => {
    const modeLabel = firepower ? `${RANDOM_MODE_NAME} · ` : '';
    const ok = await copyText(what === 'code' ? room.code : `${inviteLink(room.code)} ${me.name}邀请你加入卫戍协议：盟约【${modeLabel}${DIFFICULTY_NAMES[room.difficulty]}】`);
    if (ok) toast(what === 'code' ? t('同盟密钥复制成功，可前往邀请队友') : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    setExiting(true);
    await afterLeave(200);
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toFill = Math.max(0, Math.min(DEFAULT_SEATS, facts.seats.length) - facts.occupied.length);
  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.isHost
      ? facts.canStart
        ? facts.emptySeats && searchable
          ? html`<span>${t('精确搜寻：将搜寻 {n} 位同难度的博士', { n: toFill })}<span class="t-mint"> · ${t('也可直接开始模拟')}</span></span>`
          : html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  return html`<div class=${`screen room-screen rs${coop ? '' : ' rs--solo'}${facts.seats.length > DEFAULT_SEATS ? ' rs--big' : ''}${exiting ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[room.difficulty]}; --n:${facts.seats.length}`}>
    <div class="rs__bg" aria-hidden="true"></div>
    <header class="rs-top">
      <div class="rs-top__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <button type="button" class="rs-exit" disabled=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')}><${Icon} name="exit" /></button>
        <//>
        <div class="rs-clock">
          <b>${modeName}<span class="rs-clock__sep"></span>${t('同盟已等待')} <span class="num">${clock((Date.now() - since) / 1000)}</span></b>
          <span>${t('当前延迟')}<b class=${`num rs-ping rs-ping--${!online || !Number.isFinite(conn.ping) ? 'off' : conn.ping < 60 ? 'low' : conn.ping < 200 ? 'mid' : 'high'}`}>${online && Number.isFinite(conn.ping) ? Math.round(conn.ping) : '--'}</b>ms</span>
        </div>
        <div class="rs-tools">
          <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')} />
          ${coop && !openFriends.unavailable ? html`<${Button} variant="secondary" size="sm" square=${true} icon="users" class="rs-friends" onClick=${() => openFriends()} title=${t('好友 · 邀请好友加入')} aria-label=${t('好友')} />` : null}
          <${SettingsButton} class="room-settings" variant="secondary" square=${true} />
          <${GuideButton} class="room-guide" variant="secondary" square=${true} />
        </div>
      </div>
      <div class="rs-top__right">
        <${LoadoutButton} from="room" size="md" class="hub-plate hub-plate--loadout rs-loadout" label=${t('干员调配')} />
        ${coop ? html`<div class="rs-key">
          <span class="rs-key__k">${t('同盟密钥')}</span>
          <b class="rs-key__code num selectable" aria-label=${t('同盟密钥 {code}', { code: room.code })}>${room.code}</b>
          <button type="button" class="rs-key__copy" onClick=${() => copy('code')}>${t('复制')}</button>
          <button type="button" class="rs-key__link" onClick=${() => copy('link')} title=${t('复制邀请链接')} aria-label=${t('复制邀请链接')}><${Icon} name="link" /></button>
          ${openFriends.unavailable ? null : html`<button type="button" class="rs-key__friends" onClick=${() => openFriends('list')} title=${t('从好友列表邀请好友加入同盟')}><${Icon} name="users" /><span>${t('邀请好友')}</span></button>`}
        </div>` : html`<div class="rs-key rs-key--solo"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class="rs-seats">
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onKick=${kick} onInvite=${() => copy('code')} searching=${searching} portraits=${portraits}
        onPickCard=${cardList.length ? () => setPicking(true) : null} />`)}
      ${coop ? null : html`<aside class="solo-brief rs-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />

    <footer class="rs-foot">
      <div class="rs-foot__left" aria-hidden="true"></div>
      <div class="rs-foot__center">
        <p class="rs-hint">${coop ? html`<span class="rs-ready num" title=${t('已就绪')}>${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}<b>${facts.readyHumans}</b>/${facts.humans.length}</span>` : null}${statusLine}</p>
        <div class="rs-pill">
          ${coop && CAN_QUEUE ? html`<span class="rs-pill__mode" title=${t('精确搜寻：只与选择相同难度的博士组成同盟')}><${Icon} name="search" />${t('精确搜寻')}</span><i class="rs-pill__sep"></i>` : null}
          <button type="button" class="rs-pill__diff" disabled=${!facts.isHost || !!busy} onClick=${() => setPicker(true)}
            title=${facts.isHost ? t('更改模拟难度') : t('由创建者选择')}><${DifficultyIcon} difficulty=${room.difficulty} />${t(DIFFICULTY_NAMES[room.difficulty])}</button>
          <button type="button" class=${`rs-pill__gear${opts ? ' is-on' : ''}`} onClick=${() => setOpts((v) => !v)} title=${t('同盟设置')} aria-label=${t('同盟设置')} aria-expanded=${opts ? 'true' : 'false'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill-rule="evenodd" /></svg>
          </button>
          ${optsShown ? html`<${RoomOptions} room=${room} facts=${facts} myId=${me.playerId} busy=${busy} online=${online} variant=${variant}
            onPrivate=${setPrivate} onMaxSeats=${setMaxSeats} onAiLast=${setAiLast} onVariant=${setVariant} onClose=${() => setOpts(false)} leaving=${optsLeaving} />` : null}
        </div>
      </div>
      <div class="rs-foot__right">
        ${facts.isHost && searchable && facts.emptySeats > 0 && !searching
          ? html`<button type="button" class="rs-search" disabled=${!online || busy === 'match'} onClick=${queueMatch}>
              <${Icon} name="search" />${t('开始搜寻')}${busy === 'match' ? html`<${Spinner} size="sm" />` : null}</button>` : null}
        ${facts.isHost
          ? html`<button type="button" class="proto-start rs-go" disabled=${!facts.canStart || !online || busy === 'start'} onClick=${start}
              title=${facts.canStart ? undefined : t('仍有博士未准备就绪')}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${busy === 'start' ? html`<${Spinner} size="sm" />` : null}${t('开始模拟')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span></button>`
          : facts.spectating
            ? html`<button type="button" class="proto-start rs-go" disabled=${true}><span class="proto-start__label"><${Icon} name="eye" />${t('观战中')}</span></button>`
          : html`<button type="button" class=${`proto-start rs-go${myReady ? ' is-ready' : ''}`} disabled=${!online || !facts.mine || busy === 'ready'} onClick=${toggleReady}
              title=${myReady ? t('再次点击取消就绪') : undefined}>
              <span class="rs-go__box" aria-hidden="true">${myReady ? html`<${Icon} name="check" />` : null}</span>
              <span class="proto-start__label">${busy === 'ready' ? html`<${Spinner} size="sm" />` : null}${myReady ? t('已就绪') : t('准备就绪')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span></button>`}
      </div>
    </footer>

    ${searchShown ? html`<${SearchPanel} class=${`rs-searchpanel${searchLeaving ? ' is-leaving' : ''}`} elapsed=${searchElapsed}
      onStop=${facts.isHost ? cancelMatch : null} stopping=${busy === 'cancel-match'}
      note=${facts.isHost ? t('搜寻期间可随时直接开始模拟') : t('创建者正在搜寻队友')}
      tags=${[{ key: 'mode', label: t('精确搜寻'), icon: html`<${Icon} name="search" />` },
        { key: 'diff', label: t(DIFFICULTY_NAMES[room.difficulty]), color: DIFFICULTY_COLORS[room.difficulty], icon: html`<${DifficultyIcon} difficulty=${room.difficulty} />` }]} />` : null}
    ${foundShown ? html`<${FoundPanel} class=${foundLeaving ? 'is-leaving' : ''} seats=${facts.seats.length} text=${t('同盟集结完毕')} />` : null}
    ${picking ? html`<${CardPicker} current=${myCard} list=${cardList} m=${m} onPick=${pickCard} onClose=${() => setPicking(false)} />` : null}
    ${protoShown ? html`<${RoomProtocol} room=${room} variant=${variant} busy=${busy} onClose=${() => setPicker(false)} onPick=${setDifficulty} leaving=${protoLeaving} />` : null}
  </div>`;
}
