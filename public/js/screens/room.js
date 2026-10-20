// Room screen (同盟等待室), laid out like the event's room: 4 tall seat cards (the 名片干员 portrait or the avatar frame,
// 创建者, the ready state at the bottom, the name plate under the card; an empty seat offers 邀请 — copies the key — and,
// to the host, 添加 AI 队友; the host's 移出 / 移除 AI 队友 at a card's top right), the top bar (leave, mode and ping, 统计 /
// 设置 / 玩法说明, 干员调配 and the 同盟密钥 with 复制 / the link), the bottom: the ready count and status line, the
// difficulty pill — the host opens 选择模拟协议 (screens/lobby.js ProtocolSelect) with 确认 — and ⚙ 同盟设置 (the
// 「AI 队友最后选择」 switch, co-op), and the big 开始模拟 / 准备就绪 button.
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// 名片干员 (PR #643 split 6): a doctor's seat card shows an operator's portrait — the one the player picked (更换立绘 on
// one's own seat opens the picker: search, rarity, 默认; kept as a pref and sent as room.card, so the room sees it as
// seats[].card), else one of the 5★/6★ operators chosen by the player id (ui/seatArt.js), the same on every client.
// Without the art pack the card keeps its avatar frame; a bot keeps its robot frame.
// Texts go through t() (docs/I18N.md).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SEATS, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyIcon, Tooltip, Spinner, confirmDialog, doctorNo, Modal,
  TextField,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { TestMark } from '../ui/testConsole.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, loadPref, savePref } from '../store.js';
import { data, useData } from '../data.js';
import { chessAvatarUrl, chessPortraitUrl } from '../ui/assetUrls.js';
import { CARD_PREF, cardOperators, cardContext, seatOperator } from '../ui/seatArt.js';
import { difficultyInfo, ProtocolSelect } from './lobby.js';
import { useRise } from '../ui/transitions.js';
import { t, tc } from '../../../shared/i18n.js';

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = room?.mode === 'solo' ? 1 : MAX_SEATS;
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
  // a room with gameplay plugins (DESIGN §32.6): every player's page has loaded and checked its content (the host's too)
  const modded = isModdedRoom(room);
  const contentReady = !modded || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    contentReady,
    myContent: modded ? (mine?.content || 'loading') : 'ready',
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
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

/** A picker tile's avatar; the name's first character when the art pack has none or it fails to load. */
function CardThumb({ src, name }) {
  const [bad, setBad] = useState(false);
  return html`<span class="cardpick__img">${src && !bad
    ? html`<img src=${src} alt="" loading="lazy" draggable=${false} onError=${() => setBad(true)} />`
    : html`<span class="cardpick__glyph">${[...(name || '?')][0]}</span>`}</span>`;
}

/**
 * 名片干员 picker (更换立绘 on one's own seat card): the operators a seat card can show (ui/seatArt.js cardOperators —
 * search by name, rarity tabs) and 默认, no pick: the card shows the operator chosen by the player id. Picking closes it;
 * the current choice takes the focus (no on-screen keyboard on a phone).
 */
function CardPicker({ current, list, m, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  const stars = useMemo(() => [...new Set(list.map((c) => c.rarity).filter((r) => r > 0))].sort((a, b) => b - a), [list]);
  const known = !!current && list.some((c) => c.charId === current);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => (!star || c.rarity === star)
    && (!needle || [c.name, c.appellation].some((v) => String(v || '').toLowerCase().includes(needle))));
  return html`<${Modal} open=${true} class="cardpick" micro="SEAT CARD OPERATOR" title=${t('名片干员')} width="min(10.4rem, 96vw)"
      onClose=${onClose} actions=${html`<${Button} variant="ghost" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="cardpick__bar">
      <${TextField} class="cardpick__search" size="sm" icon="search" value=${q} onInput=${setQ} placeholder=${t('搜索干员')} />
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[0, ...stars].map((v) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => setStar(v)}>${v ? html`<span class="num">${v}★</span>` : t('全部')}</button>`)}
      </div>
    </div>
    <div class="cardpick__grid" data-testid="card-picker">
      <button type="button" class=${`cardpick__op cardpick__op--auto${known ? '' : ' is-on'}`} aria-pressed=${known ? 'false' : 'true'}
          data-char="" data-autofocus=${known ? undefined : ''} title=${t('按博士编号自动分配')} onClick=${() => onPick('')}>
        <span class="cardpick__img"><${Icon} name="refresh" /></span><span class="cardpick__name">${t('默认')}</span>
      </button>
      ${shown.map((c) => {
        const src = chessAvatarUrl(m, c);
        const on = known && c.charId === current;
        return html`<button key=${c.charId} type="button" class=${`cardpick__op r${c.rarity}${on ? ' is-on' : ''}`} aria-pressed=${on ? 'true' : 'false'}
            data-char=${c.charId} data-autofocus=${on ? '' : undefined} title=${c.name} onClick=${() => onPick(c.charId)}>
          <${CardThumb} src=${src} name=${c.name} />
          <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class="cardpick__star num">${c.rarity}★</span>` : null}
        </button>`;
      })}
    </div>
    ${shown.length ? null : html`<p class="cardpick__empty">${t('没有符合条件的干员')}</p>`}
    <p class="cardpick__note"><${Icon} name="info" />${t('选择后，同盟里的博士都会看到这张立绘')}</p>
  <//>`;
}

/**
 * One seat: a tall card — the top strip (P#), the 名片干员 portrait (or the avatar frame: a bot, no art pack), 创建者, the
 * state at the bottom (准备中 / 待命中 / 已就绪 with its box) — and the name plate under it. One's own card offers 更换立绘
 * (`onPickCard`); the host gets 移出 / 移除 AI 队友 at the top right. An empty seat: 邀请 (copies the key) and, for the
 * host of a co-op room, 添加 AI 队友.
 */
function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick, onInvite, portrait = null, operator = null, onPickCard = null }) {
  const [badArt, setBadArt] = useState(null);
  const coop = room.mode !== 'solo';
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId));
  if (!seat) {
    const canAdd = coop && facts.isHost;
    const invitable = coop && !facts.spectating;
    return html`<article class="seat seat--empty rseat rseat--empty" style=${`--i:${index}`}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
      <div class="rseat__art">
        ${invitable
          ? html`<button type="button" class="rseat__invite" onClick=${onInvite} title=${t('复制同盟密钥以邀请队友')}>
              <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('复制同盟密钥以邀请队友')}</small></button>`
          : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        ${canAdd ? html`<${Button} variant="secondary" size="sm" icon="robot" class="rseat__add" loading=${busy === 'add'} onClick=${onAddBot}>${t('添加 AI 队友')}<//>` : null}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty"><span class="seat__state t-dim">${t('空位')}</span></div>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  const lit = state === 'ready' || state === 'host';
  const art = !seat.isBot && portrait && badArt !== portrait ? portrait : null;
  const canPick = isMe && !seat.isBot && !!onPickCard;
  return html`<article class=${`seat rseat${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''}${art ? ' has-art' : ''}${lit ? ' is-lit' : ''}${flash ? ' is-flash' : ''} is-${state}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
    <div class="seat__art rseat__art">
      ${art
        ? html`<img class="seat__portrait" src=${art} alt="" draggable=${false} onError=${() => setBadArt(art)} />`
        : html`<${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />`}
      ${art ? html`<span class="seat__op">${operator?.name || ''}</span>` : null}
      ${isHostSeat ? html`<span class="rseat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
      ${seat.isBot ? html`<span class="rseat__bot"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
      ${canPick ? html`<button type="button" class="rseat__pick" data-testid="seat-card-pick" onClick=${onPickCard}
        title=${t('更换名片干员')} aria-label=${t('更换名片干员')}><${Icon} name="edit" /><span>${t('更换立绘')}</span></button>` : null}
      ${consent ? html`<span class="rseat__tag" data-testid="script-consented">${t('已同意')}</span>` : null}
      ${facts.modded && !seat.isBot ? html`<span class=${`rseat__tag seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
        ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
      </span>` : null}
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('连接中断')}</span>` : null}
      <span class=${`rseat__state seat__state--${state}`}>
        <span class="rseat__box">${lit ? html`<${Icon} name="check" />` : null}</span>
        ${state === 'ready' ? t('已就绪') : state === 'host' ? t('待命中') : state === 'offline' ? t('连接中断') : t('准备中')}
      </span>
    </div>
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)}
      title=${t('移除该 AI 队友')} aria-label=${t('移除 AI 队友')}><${Icon} name="robot" /><${Icon} name="close" /></button>` : null}
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    <div class="rseat__plate">
      ${isMe ? html`<span class="rseat__me" title=${t('你')}><${Icon} name="info" /></span>` : null}
      <${AvatarFrame} size="sm" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} />
      <span class="rseat__who"><b class="seat__name">${seat.name || t('博士')}</b>${isMe ? html`<span class="seat__you">${t('你')}</span>` : null}</span>
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

/** ⚙ of the bottom pill (co-op): 同盟设置 — the 「AI 队友最后选择」 switch. Closes on a click outside it or Esc. */
function RoomOptions({ option, busy, onAiLast, onClose }) {
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  return html`<div class="rs-opts" role="dialog" aria-label=${t('同盟设置')}>
    <h4>${t('同盟设置')}</h4>
    <${AiLastToggle} option=${option} busy=${busy} onToggle=${onAiLast} />
  </div>`;
}

/** A gear (the pill's ⚙). */
function GearGlyph() {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" /></svg>`;
}

/** The big button of the bottom right (开始模拟 / 准备就绪 / 已就绪 / 观战中), styled like 选择模拟协议's. */
function GoButton({ label, onClick, disabled, loading = false, ready = null, title, icon = null }) {
  return html`<button type="button" class=${`proto-start rs-go${ready ? ' is-ready' : ''}`} disabled=${disabled} onClick=${onClick} title=${title}
      aria-busy=${loading ? 'true' : 'false'}>
    ${ready == null
      ? html`<span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>`
      : html`<span class="rs-go__box" aria-hidden="true">${ready ? html`<${Icon} name="check" />` : null}</span>`}
    <span class="proto-start__label">${loading ? html`<${Spinner} size="sm" />` : icon ? html`<${Icon} name=${icon} />` : null}${label}</span>
    <span class="proto-start__deco" aria-hidden="true"></span>
  </button>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);
  // 名片干员: the operators a seat card can show and the default pool (ui/seatArt.js), one's own pick (a pref)
  useData('chess', 'assets');
  const chess = data.get('chess');
  const cardList = useMemo(() => cardOperators(data.list('chess')), [chess]);
  const cards = useMemo(() => cardContext(cardList), [cardList]);
  const [myCard, setMyCard] = useState(() => { const v = loadPref(CARD_PREF, ''); return typeof v === 'string' ? v : ''; });
  const [picking, setPicking] = useState(false);
  // 选择模拟协议 over the room (the host's pick before 确认) and the ⚙ menu
  const [proto, setProto] = useState(null);
  const [opts, setOpts] = useState(false);
  // the room sees one's pick once the server has it (seats[].card): sent, once the operators are loaded, whenever the
  // seat's card differs — a pick this client does not have counts as 默认, as on one's own card. One the server refuses
  // stays local and is not asked again until the pick, the room or its content changes (a rate refusal is retried at
  // the next room.state).
  const mySeat = room ? roomFacts(room, me.playerId).mine : null;
  const seatCard = mySeat?.card || '';
  const seated = !!mySeat;
  const sentCard = useRef('');
  useEffect(() => {
    if (!seated || conn.status !== 'online' || !cards.byChar.size) return;
    const want = cards.byChar.has(myCard) ? myCard : '';
    const key = `${room.code}|${room.content?.cs || ''}|${want}`;
    if (seatCard === want || sentCard.current === key) return;
    sentCard.current = key;
    net.request('room.card', { charId: want }).catch((err) => { if (err?.code === 'RATE') sentCard.current = ''; });
  }, [room?.code, room?.content?.cs, seated, seatCard, myCard, cards, conn.status]);
  const pickCard = (charId) => { setMyCard(charId); savePref(CARD_PREF, charId); setPicking(false); };

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const facts = roomFacts(room, me.playerId);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

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
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code, ...(room.test ? { testAck: true } : {}) }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
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

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  const copy = async (what) => {
    // the copied link carries an invitation line (#103): 「{name}邀请你加入卫戍协议：盟约【{difficulty}】」
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: me.name ?? '', difficulty: DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : '' });
    const ok = await copyText(what === 'code' ? room.code : `${inviteLink(room.code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code: room.code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  // 选择模拟协议 over the room (the host): the difficulty is sent on 确认 (none when it did not change)
  const confirmDifficulty = () => {
    const d = proto;
    if (!d || d === room.difficulty) { setProto(null); return; }
    setDifficulty(d).then(() => { if (alive.current) setProto(null); });
  };
  const aiLast = aiLastOption(room, me.playerId);
  const modeName = coop ? t('同盟模拟') : t('独立模拟');

  return html`<div class=${`screen room-screen rs${coop ? '' : ' rs--solo'}`} style=${`--d-color:${DIFFICULTY_COLORS[room.difficulty] || 'var(--amber)'}; --n:${facts.seats.length}`}>
    <div class="rs__bg" aria-hidden="true"></div>
    <header class="topbar rs-top">
      <div class="topbar__left rs-top__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <button type="button" class="rs-exit" disabled=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')}><${Icon} name="exit" /></button>
        <//>
        <div class="rs-clock">
          <b>${modeName}${room.test ? html` <${TestMark} />` : null}
            ${room.content?.modeId ? html`<span class="rs-clock__sep"></span><span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}</b>
          <span class="rs-clock__ping">${t('当前延迟')}<${PingPill} ms=${conn.ping} online=${online} /></span>
        </div>
        <div class="rs-tools">
          <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')} />
          <${SettingsButton} class="room-settings" variant="secondary" square=${true} />
          <${GuideButton} class="room-guide" variant="secondary" square=${true} />
        </div>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="rs-top__right">
        <${LoadoutButton} from="room" size="md" class="hub-plate hub-plate--loadout rs-loadout room-loadout" label=${t('干员调配')} />
        ${coop ? html`<div class="rs-key">
          <span class="rs-key__k">${t('同盟密钥')}</span>
          <b class="rs-key__code num selectable" aria-label=${t('同盟密钥 {code}', { code: room.code })}>${room.code}</b>
          <button type="button" class="rs-key__copy" onClick=${() => copy('code')} title=${t('复制密钥')}>${t('复制')}</button>
          <button type="button" class="rs-key__link" onClick=${() => copy('link')} title=${t('复制链接')} aria-label=${t('复制链接')}><${Icon} name="link" /></button>
        </div>` : html`<div class="rs-key rs-key--solo"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class=${`seats rs-seats${coop ? '' : ' seats--solo'}`}>
      ${facts.seats.map((s, i) => {
        const op = seatOperator(s, cards, { myId: me.playerId, myCard });
        return html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
          myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} onInvite=${() => copy('code')}
          portrait=${op ? chessPortraitUrl(data.get('assets'), op.chess) : null} operator=${op?.chess} onPickCard=${() => setPicking(true)} />`;
      })}
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

    <footer class="room-bar rs-foot">
      <div class="rs-foot__left" aria-hidden="true"></div>
      <div class="rs-foot__center">
        <p class="rs-hint">${coop ? html`<span class="rs-ready num" title=${t('已就绪')}>${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}<b>${facts.readyHumans}</b>/${facts.humans.length}</span>` : null}<span class="room-bar__status">${statusLine}</span></p>
        <div class="rs-pill">
          <button type="button" class="rs-pill__diff" disabled=${!facts.isHost || !!busy} onClick=${() => setProto(room.difficulty)}
            title=${facts.isHost ? t('模拟难度') : t('由创建者选择')}><${DifficultyIcon} difficulty=${room.difficulty} />${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num rs-pill__code">${info.code}</span></button>
          ${aiLast ? html`<button type="button" class=${`rs-pill__gear${opts ? ' is-on' : ''}`} onClick=${() => setOpts((v) => !v)} title=${t('同盟设置')} aria-label=${t('同盟设置')}
            aria-expanded=${opts ? 'true' : 'false'}><${GearGlyph} /></button>` : null}
          ${opts && aiLast ? html`<${RoomOptions} option=${aiLast} busy=${busy} onAiLast=${setAiLast} onClose=${() => setOpts(false)} />` : null}
        </div>
      </div>
      <div class="room-bar__right rs-foot__right">
        ${facts.isHost
          ? html`<${GoButton} label=${t('开始模拟')} loading=${busy === 'start'} disabled=${!facts.canStart || !online || busy === 'start'} onClick=${start}
              title=${facts.canStart ? undefined : !facts.contentReady ? t('仍有博士未载入房间的插件内容') : t('仍有博士未准备就绪')} />`
          : facts.spectating
            ? html`<${GoButton} label=${t('观战中')} icon="eye" disabled=${true} />`
          : html`<${GoButton} label=${myReady ? t('已就绪') : t('准备就绪')} ready=${myReady} loading=${busy === 'ready'}
              disabled=${!online || !facts.mine || busy === 'ready' || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}
              title=${!myReady && facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : undefined} />`}
      </div>
    </footer>
    ${picking ? html`<${CardPicker} current=${myCard} list=${cardList} m=${data.get('assets')} onPick=${pickCard} onClose=${() => setPicking(false)} />` : null}
    ${proto ? html`<${ProtocolSelect} roomMode=${room.mode} difficulty=${proto} onDifficulty=${setProto} onClose=${() => setProto(null)}
      onCreate=${confirmDifficulty} busy=${busy === 'diff' ? 'create' : null} online=${online} action=${t('确认')} hint="" />` : null}
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
