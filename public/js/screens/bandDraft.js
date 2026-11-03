// Band draft — BAND_DRAFT "2/2 选择策略" (research 06 §4.2, D1). Left = the draft order as name cards (OrderRow: the
// doctor's 名片干员 art, avatar, name, state 等待中 / 决策中 / the picked strategy, the strategy box and ✓), the current
// picker framed; centre = the wall of every strategy allowed for the mode type (portrait and name); one a teammate already
// picked reads 已被选择 and cannot be chosen again (research 09 §5, guidebook 策略与轮选; the server refuses it too);
// right = the detail pane once a portrait is tapped (icon, 初始生命值, name, effect name + rich description) with
// 确认选择. 跳过选择 / 无法跳过 (co-op, once) sits in the step header's turn line on the player's own turn.
// One countdown (user playtest #4 item 4): every turn has the same clock (Match BAND_TURN_SECONDS, m.public.draft
// turnSeconds) and the step header counts it down — m.public.deadline IS the turn's end; the order rows carry no
// seconds of their own. The highlighted band (the detail pane's) is what a turn that runs out takes: every change of it
// is reported (g.bandFocus) and the server assigns it while it is free, else 「华法琳」, else the first free strategy
// (timeoutBand). It starts on that default, so the tip under the order list always names what a timeout gives.
// Solo, and a co-op match with a single human (the server's soloUntimed: draft.untimed): no clock at all.
// A strategy built around a bond the mode switches off (bands.json bondIds ∩ the mode's inactive bonds — 标准: 潘格尼尼
// 拉特兰, 克莱门莎 阿戈尔, 玛恩纳 卡西米尔; the bot never picks one) reads 本局禁用 on its card and in the detail pane
// (BandOffTag / BandOffNote, DESIGN §21.26, §21.7's look); it stays selectable — information only.
// 本局信息 (GitHub #8 item 1 and #484): the step header's entry beside the difficulty opens the briefing's leader, battlefield,
// special enemies (ui/matchEnemies.js), bond rows, legend and 本局禁用干员 again, read-only (MatchInfoDialog).
// The draft runs on underneath: its status line repeats the current turn and the countdown (draftInfoStatus),
// a turn change (a pick, a skip, a turn that runs out, an AI pick) closes it, the end of the draft unmounts it, and it
// never touches the highlighted band or the buttons.
// The event's layout and motion (PR #643, video 6:29–7:51): the step header says whose turn it is (👆 请选择策略 with
// 跳过选择 / 无法跳过, X 正在选择策略…, 策略选择完成 · 正在进入模拟…) and carries 本局信息 beside the difficulty; the order rows
// are name cards (the doctor's 名片干员 art — ui/seatArt.js, as on the room's seat cards — avatar, name, state) with the
// strategy box beside them (⌛ 决策中, •••, or the picked strategy with 🔍 — it opens that strategy read-only) and ✓
// outside; the grid is a 4-wide wall of portraits (已被选择 across a teammate's; the official orange corner badge,
// statistics/strategyBadge, on a strategy that has earned it — the official bands victorCount, 3 for all 40, counted
// over this browser's records by ui/stats.js strategyBadgeIds, the stats page's own rule); the detail pane slides in
// only once a portrait is tapped (the order list narrows) and says 已通过模拟 N 次 for a strategy won with here;
// after the pick the wall gives way to 已选定策略, and a beam runs along a row when its pick lands. When the pick becomes
// the player's, the 轮到你 sound and the official 请选择策略 band (ui/turnBanner.js) play — in 独立模拟 too, the same as
// co-op (the maintainer's decision of 2026-10-21; [ASSUMED] the official solo draft does so: the footage shows co-op
// turns only). After the draft screens/game.js keeps this screen on 已选定策略 for a moment (`held`, DRAFT_HOLD_MS),
// inert, before 协议启动！.
// [ASSUMED] the corner badge, the count and the name card's trophy medal read this browser's records (ui/stats.js,
// read once after the screen is up) in place of the event's account data — there are no accounts here.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, BandIcon, RichText, PlayerAvatar, Sprite, Img } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchInfoDialog, matchInfoModel } from '../ui/matchInfo.js';
import { MatchEnemies } from '../ui/matchEnemies.js';
import { actions, act } from '../ui/gameActions.js';
import { normalizeDraft, sortedPlayers } from '../ui/gameLogic.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
import { TurnBanner, TURN_BANNER_LATE_MS } from '../ui/turnBanner.js';
import { onBootArt, preloadBootArt } from '../ui/protocolBoot.js';
import { reducedMotion } from '../ui/device.js';
import { useRise } from '../ui/transitions.js';
import { CARD_KEY, cardStore, cardOperators, cardContext, seatOperator, seatCardSkin, seatArtSrc } from '../ui/seatArt.js';
import { skinsStore, SKINS_KEY } from '../ui/skins.js';
import { settingsStore } from '../ui/settingsStore.js';
import { chessPortraitUrl, uiUrl } from '../ui/assetUrls.js';
import { aggregateStats, peekStatsRecords, strategyBadgeIds, trophyMedalOf } from '../ui/stats.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '../ui/gameLogic.js';
import { t, tParts, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 本局禁用 on a strategy card whose bonds `names` the mode switches off (bandOffBonds); nothing otherwise. */
export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

/** The detail pane's note for such a strategy: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥" (the bond names struck through). */
export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

/**
 * Bands selectable in a mode (modeTypeList contains the mode's type), sorted by sortId.
 * @param {any[]} bands
 * @param {string|null} modeType 'SINGLE'|'MULTI'
 */
export function allowedBands(bands, modeType) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

/** The official default strategy of an automatic assignment (data/config.json bandDraft.timeoutBandId). */
export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

/**
 * The strategy the server assigns me when my turn times out (server/match/match/phases.js defaultBand): the official default
 * 「华法琳」 while no teammate holds it, else the first free strategy in draft order (sortId) — never one a teammate
 * already picked (队友已选).
 * @param {any[]} bands allowedBands(...) (sortId order)
 * @param {Map<string, any>} taken teammateBands(...)
 * @param {string} [defaultId]
 * @returns {string|null}
 */
export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

/**
 * Bands taken by teammates (队友已选): bandId → the picking players (never the viewer).
 * @param {Map<string, string>} picks normalizeDraft(...).picks (playerId → bandId)
 * @param {string} myId
 */
export function teammateBands(picks, myId) {
  const out = new Map();
  for (const [pid, bid] of picks instanceof Map ? picks : []) {
    if (pid === myId || typeof bid !== 'string') continue;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  }
  return out;
}

/**
 * The band the detail pane shows (= the highlighted band a turn that runs out takes): the current one, else my pick,
 * else the band a timeout would give me (timeoutBand: 「华法琳」 while free, else the first free one). When it is my
 * turn and the shown band was taken meanwhile (队友已选), that default instead (confirm would be disabled).
 * @param {string|null} sel
 * @param {{ bands: any[], taken: Map<string, any>, myPick: string|null, myTurn: boolean, defaultId?: string }} o
 */
export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

/**
 * The strategy a turn that runs out assigns me (server Match.timeoutBand): the highlighted band while it is one of
 * the mode's and no teammate holds it, else timeoutBand. Null after my pick.
 * @param {string|null} sel the highlighted band
 * @param {{ bands: any[], taken: Map<string, any>, myPick?: string|null, defaultId?: string }} o
 */
export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

/**
 * The tip under the co-op draft order: the one skip, the turn clock and what a turn that runs out assigns me (the
 * highlighted band while free — autoPickBand). Untimed drafts (a single human) name no clock.
 * @param {{ timed: boolean, turnSeconds?: number|null, autoName?: string|null, selected?: boolean }} o
 *   selected: the auto pick is the highlighted band (not the default standing in for a band a teammate holds)
 */
export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true }) {
  const skip = t('联合模拟在选择策略时可以进行一次跳过');
  if (!timed) return t('{skip}；本局不限时', { skip });
  const clock = Number(turnSeconds) > 0 ? t('每位博士有 {n} 秒', { n: Math.round(turnSeconds) }) : t('每位博士限时决策');
  if (!autoName) return t('{skip}；{clock}', { skip, clock });
  return selected ? t('{skip}；{clock}，超时将自动选择当前选中的「{autoName}」', { skip, clock, autoName })
    : t('{skip}；{clock}，超时将自动选择「{autoName}」', { skip, clock, autoName });
}

/**
 * The step header's countdown during the draft: the current turn's (m.public.deadline = draft.turnDeadline) with a
 * turn's length as the gauge total — null when the draft is untimed.
 * @param {any} pub m.public
 * @returns {{ deadline: number, total: number|null } | null}
 */
export function draftClock(pub) {
  const d = pub && typeof pub.draft === 'object' ? pub.draft : null;
  if (!d || d.untimed) return null;
  const deadline = Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

/**
 * The status line of the 本局信息 dialog: what the draft does while the dialog covers it — my pick, else whose turn it is
 * with the turn's seconds left (the step header's number; none when untimed), warning at ≤ 10 s like the countdown.
 * @param {{ myPick?: string|null, pickName?: string|null, myTurn: boolean, turnName?: string|null, secs?: number|null,
 *   waiting?: boolean }} o waiting: teammates still have to pick after my pick
 * @returns {{ text: string, secs: number|null, tone: 'mint'|'gold'|'warn'|'dim' }}
 */
export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

/** Nothing known yet (before the records are read, or none). */
const NO_RECORDS = Object.freeze({ won: Object.freeze({}), badges: new Set(), trophies: 0 });

/**
 * What the wall shows from this browser's records (ui/stats.js): `won` bandId → runs won with it (the detail pane's
 * 已通过模拟 N 次), `badges` the strategies with the official corner badge — strategyBadgeIds, the stats page's rule: the
 * band's own victorCount (3 for all 40 in activity_table / data/bands.json) of clears, quit, test and 入门协议 runs left
 * out — and `trophies` for the name card's medal.
 * @param {any[]} records peekStatsRecords()
 * @param {Record<string, any>|any[]} bands data.get('bands')
 * @returns {{ won: Record<string, number>, badges: Set<string>, trophies: number }}
 */
export function draftRecords(records, bands) {
  try {
    const agg = aggregateStats(records);
    const won = Object.fromEntries(Object.entries(agg.bands || {}).map(([id, b]) => [id, b.wins | 0]).filter(([, n]) => n > 0));
    return { won, badges: new Set(strategyBadgeIds(records, bands)), trophies: agg.trophies || 0 };
  } catch { return NO_RECORDS; }
}

/** 「【effect】 description」 of a strategy (the data's description usually opens with the 【effect】 already). */
function BandText({ band, class: cls }) {
  const text = band.descRaw || band.desc || '';
  const head = band.effectName && !String(text).includes(`【${band.effectName}】`) ? `【${band.effectName}】` : '';
  return html`<p class=${cls}>${head}<${RichText} text=${text} /></p>`;
}

/**
 * One doctor of the draft order: the name card (the 名片干员 art, avatar, name, state), the strategy box (⌛ 决策中 / •••
 * / the pick with 🔍, which opens it) and ✓ outside it; a beam runs along the row when the pick lands (useRise).
 * `arts`: the 名片干员 pictures in order of preference (the outfit's, then the operator's default — an outfit file that fails
 * to load falls back to the default as on the seat cards, §35.51), null for none.
 * @param {{ p: any, i: number, picked: string|null, cur: boolean, self: boolean, arts: (string|null)[]|null, medal: string|null,
 *   gd: any, onPeek: (bandId: string) => void }} props
 */
function OrderRow({ p, i, picked, cur, self, arts, medal, gd, onPeek }) {
  const flash = useRise(!!picked, 1100);
  const [badArt, setBadArt] = useState([]);
  const art = seatArtSrc(arts, badArt);
  const pband = picked ? gd.band(picked) : null;
  return html`<div class=${cx('dorder', cur && 'is-cur', picked && 'is-done', self && 'is-self', flash && 'is-flash')} style=${`--i:${i}`}>
    <div class="dorder__card">
      ${art ? html`<img key=${art} class="dorder__art" src=${art} alt="" aria-hidden="true" draggable=${false}
        onError=${() => setBadArt((b) => (b.includes(art) ? b : [...b, art]))} />` : null}
      <span class="dorder__face"><${PlayerAvatar} player=${p} self=${self} />${self ? html`<span class="dorder__me" title=${t('你')}><${Icon} name="user" /></span>` : null}</span>
      <div class="dorder__text">
        <b class="dorder__name">${medal ? html`<${Img} src=${medal} class="dorder__medal" />` : null}<span>${p.name || t('博士')}</span>${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
        <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}</span>`
          : cur ? html`<span class="t-gold">${t('决策中')}</span>` : html`<span class="t-dim">${t('等待中')}</span>`}</span>
      </div>
    </div>
    ${picked ? html`<button type="button" class="dorder__box is-band" onClick=${() => onPeek(picked)} title=${t('查看「{name}」', { name: pband?.name || '' })}>
        <${BandIcon} bandId=${picked} size="md" /><${Icon} name="search" class="dorder__zoom" />
      </button>`
      : cur ? html`<span class="dorder__box is-cur">${p.isBot ? null : html`<${Icon} name="hourglass" />`}<span>${t('决策中')}</span></span>`
      : html`<span class="dorder__box is-wait"><${Icon} name="dots" /></span>`}
    <span class="dorder__check" aria-hidden="true">${picked ? html`<${Icon} name="check" />` : null}</span>
  </div>`;
}

/** BAND_DRAFT screen. */
export function BandDraftScreen({ held = null } = {}) {
  // `held`: the draft as it ended, while screens/game.js keeps this screen on 已选定策略 after the draft (heldDraftPub)
  const livePub = useStore((s) => s.match.public);
  const pub = held || livePub;
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const roomSeats = useStore((s) => s.room?.seats);
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(false);   // the detail pane: only once a portrait (or a row's pick) is tapped
  const [peek, setPeek] = useState(null);    // a teammate's / my own pick opened from its row (read-only)
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode); // the bonds this mode never activates (标准: 10 of 23)
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const bands = useMemo(() => allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [gd.ready, mode?.type, solo, data.locale(), data.contentId()]);
  const players = sortedPlayers(pub);
  const draft = normalizeDraft(pub?.draft, players);
  const myPick = draft.picks.get(myId) || priv?.bandId || null;
  const inOrder = solo || draft.order.includes(myId);
  const myTurn = !myPick && (solo || draft.turnPid === myId);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  // the last doctor still to pick cannot skip (no one to pass the turn to)
  const canSkip = !solo && myTurn && skipsLeft > 0 && draft.order.filter((pid) => !draft.picks.has(pid)).length > 1;
  const taken = solo ? new Map() : teammateBands(draft.picks, myId);
  const pickers = new Map(); // bandId → players
  for (const [pid, bid] of draft.picks) {
    const p = players.find((x) => x.playerId === pid);
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(p || { playerId: pid, name: '?' });
  }

  // default selection: my pick, else what a timeout gives me (华法琳 while free); when my turn comes while the selected
  // band has been taken by a teammate meanwhile (队友已选), move the selection back to that default
  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken, myPick, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPick, myTurn, takenKey]);
  // "your turn" cue: the sound and the event's 请选择策略 band (ui/turnBanner.js) once its art is in — co-op and solo
  // alike (the maintainer's decision of 2026-10-21, as in PR #643; [ASSUMED] for solo, see the header). The sprites are
  // fetched early (a room entered, the match screen, this screen's mount); a turn whose art is still loading plays the
  // band as soon as it arrives — never blocking input — up to TURN_BANNER_LATE_MS after the turn began, past which the
  // header's 请选择策略 says it alone.
  useEffect(() => { preloadBootArt(); }, []);
  const [turnBanner, setTurnBanner] = useState(0);
  useEffect(() => {
    if (!myTurn) return undefined;
    setPeek(null);
    audio.sfx('yourTurn');
    if (reducedMotion()) return undefined;
    const since = Date.now();
    return onBootArt(() => { if (Date.now() - since <= TURN_BANNER_LATE_MS) setTurnBanner((n) => n + 1); });
  }, [myTurn]);
  // the 本局信息 dialog never outlives the turn it was opened in: a turn change (a pick, a skip, a turn that ran out, an
  // AI pick) or my pick closes it, so whoever's turn begins sees the draft
  const turnKey = `${draft.turnPid || ''}|${myPick || ''}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);
  // the held screen (inert) keeps no dialog open over it
  useEffect(() => { if (held) { setInfoOpen(false); setExit(false); } }, [!!held]);

  // one countdown (user playtest #4 item 4): the current turn's — m.public.deadline
  const clock = solo ? null : draftClock(pub);
  // the highlighted band is what a turn that runs out takes (Match.timeoutBand): report every change before my pick
  const timed = !solo && !!pub?.draft && !pub.draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    // (a spectator seat — community report #26 — is in no draft order: it never reports)
    if (!timed || myPick || !sel || focusSent.current === sel || !draft.order.includes(myId)) return;
    focusSent.current = sel;
    act('g.bandFocus', { bandId: sel }, { sfx: false, quiet: true });
  }, [sel, timed, myPick]);

  // what a timeout gives me: the highlighted band while free, else the default (never 队友已选 — match/phases.js timeoutBand)
  const autoId = autoPickBand(sel, { bands, taken, myPick, defaultId });
  const autoName = (autoId && gd.band(autoId)?.name) || gd.band(defaultId)?.name || tName('华法琳');

  const band = sel ? gd.band(sel) : null;
  const selTaken = !!band && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId);
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip()) setSkipped(true);
    setBusy(null);
  };
  const pickTile = (id) => { setSel(id); setOpen(true); setPeek(null); audio.sfx('tab', { volume: 0.5 }); };
  const peekBand = (id) => { setPeek(id); setOpen(true); audio.sfx('tab', { volume: 0.5 }); };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock ? 250 : 0);
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(pub?.draft?.turnSeconds) > 0 ? Math.round(pub.draft.turnSeconds) : null;
  // 本局信息: the briefing's blocks (built only while the dialog is open) and the draft's state under it
  const info = infoOpen ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick, pickName: myPick ? gd.band(myPick)?.name : null, myTurn, turnName, secs: turnSecs,
    waiting: !solo && !draft.done }) : null;

  // 名片干员 art of the order rows (as on the room's seat cards: the doctor's pick, else one chosen by the player id), in
  // the doctor's outfit for that operator (B6 picture-only outfits, docs/SKINS.md; the maintainer's decision 4 of 2026-10-21
  // for the seat cards; ui/seatArt.js seatCardSkin): one's own choice at once, a teammate's from the match's public
  // players (m.public.players[].skins), none for another seat while 「显示其他玩家的皮肤」 is off, the default art when the
  // outfit's pictures are not here (chessPortraitUrl) — or fail to load (the row falls back to them: §35.51)
  // (gd.backups: the room version's 自选编队 pool joins the card list, as on the room's seat cards)
  const cards = useMemo(() => cardContext(cardOperators(gd.list('chess'), gd.backups), { pending: !gd.backups }), [gd.ready, gd.backups]);
  const myCard = useStore((s) => s[CARD_KEY], Object.is, cardStore);
  const localSkins = useStore((s) => s[SKINS_KEY], Object.is, skinsStore);
  const otherSkins = useStore((s) => s.otherSkins !== false, Object.is, settingsStore);
  const artOf = (p) => {
    if (p.isBot) return null;
    const seat = (Array.isArray(roomSeats) && roomSeats.find((x) => x && x.playerId === p.playerId)) || { playerId: p.playerId };
    const op = seatOperator(seat, cards, { myId, myCard });
    const skin = op ? seatCardSkin(p, op.chess.charId, { myId, localSkins, players, otherSkins }) : null;
    return op ? [chessPortraitUrl(data.get('assets'), op.chess, { skin }), skin ? chessPortraitUrl(data.get('assets'), op.chess) : null] : null;
  };
  // this browser's records (up to the stats store's size): read once, after the screen and its entry are up, not while
  // it mounts
  const [local, setLocal] = useState(NO_RECORDS);
  useEffect(() => {
    const later = globalThis.requestIdleCallback ? (fn) => globalThis.requestIdleCallback(fn, { timeout: 1200 }) : (fn) => setTimeout(fn, 300);
    const cancel = globalThis.cancelIdleCallback && globalThis.requestIdleCallback ? (id) => globalThis.cancelIdleCallback(id) : (id) => clearTimeout(id);
    const id = later(() => setLocal(draftRecords(peekStatsRecords(), data.get('bands'))));
    return () => cancel(id);
  }, []);
  const myMedal = useMemo(() => {
    const medal = trophyMedalOf(local.trophies, gd.config?.trophies?.medals);
    return medal ? uiUrl(data.get('assets'), `medalIcon/${medal.iconId}`) : null;
  }, [gd.ready, local]);

  // what the right side shows: 已选定策略 after my pick, else the detail pane once opened, else only the wall
  const allPicked = !!draft.done || (draft.order.length > 0 && draft.order.every((pid) => draft.picks.has(pid)));
  const view = peek ? 'detail' : inOrder && myPick ? 'done' : open && band ? 'detail' : 'grid';
  const shownBand = peek ? gd.band(peek) : band;
  const rows = solo ? players.filter((p) => p.playerId === myId) : draft.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean);

  const head = allPicked ? html`<div class="dturn is-done"><span class="dturn__txt"><b>${t('策略选择完成')}</b><span>${t('正在进入模拟…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : myTurn ? html`<div class="dturn is-turn">
        <span class="dturn__go"><${Sprite} k="bandChoose/youturn_finger" class="dturn__finger" fallback=${html`<${Icon} name="chevronLeft" class="dturn__finger" />`} />
          <b>${t('请选择策略')}</b></span>
        ${!solo ? html`<button type="button" class="draft-skip" disabled=${!canSkip || !!busy} aria-busy=${busy === 'skip' ? 'true' : undefined} onClick=${skip}
            title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19v-5a7 7 0 0 1 7-7h7V3.5L22.5 9 17 14.5V11h-7a3 3 0 0 0-3 3v5z" /></svg>
          <span>${skipsLeft > 0 ? t('跳过选择') : t('无法跳过')}</span></button>` : null}
      </div>`
    : turnName ? html`<div class="dturn"><span class="dturn__txt"><b>${turnName}</b><span>${t('正在选择策略…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : null;

  // held after the draft (the server is already in BATTLE_CHECK): only to look at — 离开, 本局信息 and the 🔍 boxes would
  // open dialogs the match screen tears down a moment later
  return html`<div class=${cx('screen draft', `draft--${view}`, held && 'is-held', head && 'has-status')} inert=${held ? true : undefined} aria-busy=${held ? 'true' : undefined}>
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${2} of=${2} title=${t('选择策略')} micro="STRATEGY // BAND CHECK" pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)}
      extra=${html`<button type="button" class="stephead__info" data-testid="match-info-open" aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}
        title=${t('本局信息')}><${Icon} name="search" /><span>${t('本局信息')}</span></button>`}
      status=${head} />
    <main class="draft__main">
      <aside class="draft-order">
        <div class="draft-order__deco" aria-hidden="true"><i></i><i></i><span>STRONGHOLD PROTOCOL<br />${solo ? 'SINGLE OPERATOR' : 'COLLABORATIVE SYSTEM'}</span></div>
        <div class="draft-order__rows">
          ${rows.map((p, i) => {
            const picked = draft.picks.get(p.playerId) || (p.playerId === myId ? myPick : p.bandId) || null;
            const cur = !picked && !allPicked && (solo || draft.turnPid === p.playerId);
            return html`<${OrderRow} key=${p.playerId} p=${p} i=${i} picked=${picked} cur=${cur} self=${p.playerId === myId}
              arts=${artOf(p)} medal=${p.playerId === myId ? myMedal : null} gd=${gd} onPeek=${peekBand} />`;
          })}
        </div>
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip">${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: open && autoId === sel })}</p>` : null}
      </aside>
      <i class="draft__link" aria-hidden="true"></i>

      ${view === 'done' ? html`<section class="draft-done" key=${myPick} aria-live="polite">
          <div class="draft-done__art"><${BandIcon} bandId=${myPick} size="xl" /></div>
          <div class="draft-done__head">
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-done__title">${t('已选定策略')}</h2>
            <b class="draft-done__name">${gd.band(myPick)?.name || ''}</b>
          </div>
          <div class="draft-done__hp">${t('初始生命值')}<b class="num">${gd.band(myPick)?.totalHp ?? '--'}</b></div>
          ${gd.band(myPick) ? html`<${BandText} band=${gd.band(myPick)} class="draft-done__desc" />` : null}
          <p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选择「{name}」', { name: gd.band(myPick)?.name || '' })}${!solo && !allPicked ? t('，等待其他博士') : ''}</p>
        </section>` : html`
        <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
          ${bands.map((b, i) => {
            const isTaken = taken.has(b.bandId);
            const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id); // 本局禁用 (still selectable)
            const on = view === 'detail' && !peek && sel === b.bandId;
            const badged = local.badges.has(b.bandId); // (the count is the detail pane's 已通过模拟 N 次)
            return html`<button key=${b.bandId} type="button" role="option" aria-selected=${on ? 'true' : 'false'} data-band=${b.bandId}
                aria-disabled=${isTaken ? 'true' : 'false'} title=${isTaken ? t('已被选择') : offNames.length ? bandOffLine(offNames) : b.name}
                class=${cx('dband', on && 'is-sel', myPick === b.bandId && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} style=${`--n:${Math.min(i, 15)}`}
                onClick=${() => pickTile(b.bandId)}>
              <span class="dband__frame"><${BandIcon} bandId=${b.bandId} size="lg" /></span>
              <span class="dband__name">${b.name}</span>
              ${badged ? html`<span class="dband__badge" data-testid="band-badge" aria-hidden="true">
                <${Sprite} k="statistics/strategyBadge" class="dband__badge-art" fallback=${html`<span class="dband__medal"><${Icon} name="rook" /></span>`} /></span>` : null}
              <${BandOffTag} names=${offNames} />
              ${isTaken ? html`<span class="dband__taken">${t('已被选择')}</span>` : null}
              ${on ? html`<span class="dband__selmark" aria-hidden="true">SELECTED</span>` : null}
            </button>`;
          })}
        </section>
        ${view === 'detail' && shownBand ? html`<aside class="draft-detail" key="detail">
          <div class="draft-detail__body" key=${shownBand.bandId}>
            <div class="draft-detail__art"><${BandIcon} bandId=${shownBand.bandId} size="xl" /></div>
            ${local.won[shownBand.bandId] ? html`<span class="draft-detail__medal">${t('已通过模拟{n}次', { n: local.won[shownBand.bandId] })}</span>` : null}
            <div class="draft-detail__hp">${t('初始生命值')}<b class="num">${shownBand.totalHp ?? '--'}</b></div>
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-detail__name">${shownBand.name}</h2>
            <${BandOffNote} names=${bandOffBonds(shownBand, offBonds).map((id) => gd.bond(id)?.name || id)} />
            <span class="draft-tag">INTRO</span>
            <div class="draft-detail__eff"><${BandText} band=${shownBand} class="draft-detail__desc" /></div>
          </div>
          <div class="draft-detail__actions">
            ${peek ? html`<p class="draft-detail__status"><${Icon} name="search" />${myPick === peek ? t('你选择的策略') : t('{names} 选择的策略', { names: (pickers.get(peek) || []).map((x) => x.name).join('、') || t('博士') })}</p>
              <div class="draft-detail__btns"><${Button} variant="secondary" size="lg" icon="chevronLeft" onClick=${() => setPeek(null)}>${t('返回')}<//></div>`
            : html`${selTaken ? html`<p class="draft-detail__status draft-detail__status--taken"><${Icon} name="close" />${t('队友已选，请选择其他策略')}</p>`
                : !myTurn ? html`<p class="draft-detail__status"><${Icon} name="hourglass" />${!inOrder ? t('观战中') : turnName ? t('{turnName} 正在决策…', { turnName }) : t('等待轮到你')}</p>` : null}
              <div class="draft-detail__btns">
                <${Button} variant="primary" size="lg" icon="check" class="draft-confirm" disabled=${!myTurn || !band || selTaken} loading=${busy === 'pick'} onClick=${confirm}>${selTaken ? t('已被选择') : t('确认选择')}<//>
              </div>`}
          </div>
        </aside>` : null}`}
    </main>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info}
      enemies=${infoOpen ? html`<${MatchEnemies} pub=${pub} gd=${gd} idScope="minfo" />` : null}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
    ${turnBanner ? html`<${TurnBanner} key=${turnBanner} onDone=${() => setTurnBanner(0)} />` : null}
  </div>`;
}
