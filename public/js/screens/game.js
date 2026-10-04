// Game screen — every in-match screen, dispatched by m.public.phase (DESIGN §10):
//   INFO_CHECK → Briefing (screens/briefing.js), BAND_DRAFT → Band draft (screens/bandDraft.js),
//   RESULT / m.result → Result (screens/result.js), everything else → MatchScreen below.
//
// MatchScreen = full-screen field view (render engine per DESIGN §9, DOM fallback when it can't load)
// with the DOM HUD layered on top: top bar, bond strip + popup, team panel (click = g.watch), effects,
// shop bar (prep), merge-reward and 机变 overlays, detail panel, enemy / match-info drawer, combat HUD
// (DP, "作战结束，等待队友完成作战" + teammates' progress, observing pill, 联防 / 最终攻势 ‹ › camera halves),
// phase banners, ticker, emote wheel + bubbles,
// settings, exit flow. Drag & drop from the view: pieceDrop on a board tile (also the piece's own tile) opens the
// direction wheel (ui/facingWheel.js, research 09 §1.2) and its release sends g.move {uid, to, dir} (g.art {…, dir}
// for 画卷); pieceDrop on a bench slot → g.move; items → g.equip (confirm when replacing) / g.art. Equipment
// released over an operator's sprite equips that operator even when the tile under the pointer is the one behind
// it; a refused drop toasts the reason (gameLogic dropFailureReason / canPlace). Tapping an own piece selects it:
// its underframe (ui/underframe.js: 撤退 / 出售 +N / 销毁), its rotated range tiles and its detail card; right-click /
// long-press opens the detail card only. There is no drag-to-sell. The own board is drawn and checked with the
// player's stage overrides (terrain 机变 cards: gameLogic stageOverrides / effectiveStage); in a boss round's prep the
// legality reads the player's half of the boss field (gameLogic deployFieldOf, user playtest #5 item 7).
// Shortcuts: R refresh, F freeze, D level-up, Space ready, Esc closes the topmost popup.
// The UI never mutates match state locally; it re-renders from m.public / m.private / m.field pushes.
// Client-side combat (DESIGN §14, m.public.combatMode 'client'): battles are simulated in this browser by
// battle/runner.js, which publishes the battle's field meta into store.match.field and feeds the view the same b.snap /
// b.ev frames the server used to stream. Observing follows research 09 §3.1 (battle/observe.js): no looking elsewhere
// while the own normal battle runs; afterwards a teammate row → 前往查看 → a local replica, 返回战场 goes back; in
// 联防 / 最终攻势 the ‹ › pill switches the camera between the field's halves and 全景.
// Enemy preview pen (research 09 §2 / §6.2 item 3): in 休整期 the right HUD 🔍▶▶ pans the camera to the pen
// (view.setCamera('pen')); the left button turns into 🔍◀◀ and returns to the camera in use before (the grey right
// button, Esc or any camera change of the game flow return too). The shop bar folds away while the pen is shown and
// comes back as it was. Tapping an enemy in the pen (view pieceClick with `enemyKey` / a `preview` enemy unit) opens its
// detail card; the old enemy list lives on as the 敌方情报 tab of the 本局信息 dialog (left 🔍).
// Every camera request of this screen goes through setCam (it remembers the camera the pen returns to);
// `.gm[data-camera]` mirrors the current camera kind (E2E / styling). Folding the shop bar (收起) on the own prep board
// flies the camera to the official shop-collapsed framing and unfolding back to the shop camera (public issue #5:
// gameLogic prepCameraFor / foldCamera — never over the pen, a teammate's board or a battle; deferred while a piece is
// dragged or its direction is chosen).
// Equipment dropped on an operator whose two slots are used opens the equip-replace dialog (ui/equipReplace.js): the
// player picks the equipped item to destroy → g.equip {itemUid, targetUid, replaceUid}; 取消 sends nothing. 销毁 is only
// offered for loose items (equipped ones are locked, ui/facing.js itemDestroyable).
// Solo battles (ui/matchStatus.js pauseAvailable): the top bar's pause button / Space send g.pause {on}; m.public.paused
// shows the paused overlay (继续作战 / 放弃模拟) and freezes the HUD clocks. Boss rounds: the top bar shows the level's
// 120 s countdown and the red DOT overtime warning (m.public.overtimeAt).
// User playtest #3: the own LP drops live while the own battle's enemies enter the blue gate (item 2: the runner's
// state().leaks → ui/hud.js liveLp → top bar + own team row; teammates' rows from m.public players[].pendingLp; in 联防 a
// leaker's enemies still standing — runner state().uniteLeft / m.public players[].uniteLeft, the ×N tag — user
// playtest #6 item 7); while the temp overflow row (临时整备区) holds pieces it is framed and labelled on the board
// (ui/underframe.js TempRowNotice) and 准备就绪 / Space say why they are refused (item 3).
// User playtest #4: the detail card shows live stats (item 7) — in battle the local sim's unit (battle/runner.js
// unitStats), in prep an own board unit's start-of-battle stats (g.unitStats → m.unitStats); 机变 cards take two taps
// (item 2, ui/choiceOverlay.js).
// Merges (user playtest #6 follow-up, PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置"): a shop /
// reward card armed for a purchase that completes a merge lights, in gold, the board tile its elite will take (the
// deployed copy that deploys first, gameLogic.mergeTarget — none when no copy is deployed: the elite goes to the hand);
// the elite then appears there with the promotion cue (render/app.js setPrep → fx.promote).
// The bond strip, its popup and a unit card's bond chips follow the player on screen (DESIGN §20.15, ui/watchBonds.js):
// a scouted / watched / auto-observed teammate's field → that teammate's bonds (m.public players[].bonds, tagged
// "👁 name"); 联防 / 最终攻势 → the player on the ‹ › half (全景: yours when you fight there, else the teammate picked
// with 前往查看 — `watchWho` — or the field's first player, never the viewer's own); in battle with the live layers of
// the battle on screen (battle/runner.js state().bondLayers). Picking a teammate on such a field (a 联防 leaker, an
// eliminated spectator) frames their half and keeps the ‹ › pill (with 返回战场); an open bond popup closes when the
// strip changes hands.
// Spectator seats (community report #26, a remake feature): a spectator has no m.private and plays like an ELIMINATED
// player — no shop, no ready, no emotes (▸ [ASSUMED] off), the server auto-observes the first field of every battle, a
// team row → 前往查看 any player; in 休整期 / 机变 / round start it is shown the first player's board by itself (once per
// phase). Its pill reads 观战中, never "你已被淘汰"; its exit only leaves the seat (ui/matchChrome.js ExitModal).

import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { PHASE, GEO } from '../../../shared/constants.js';
import { fxForm } from '../../../shared/protocol.js';
import { html, Spinner, PhaseBanner, Icon, Button, MicroLabel, confirmDialog, closeAllDialogs, useTicker } from '../ui/components.js';
import { useGameData, GIcon } from '../ui/gameComponents.js';
import { useFieldView } from '../ui/fieldHost.js';
import { TopBar, liveLp, ownLeaks, uniteRemaining, tempInfo, tempReadyReason } from '../ui/hud.js';
import { BondStrip, BondPopup } from '../ui/bondStrip.js';
import { TeamPanel } from '../ui/teamPanel.js';
import { ShopBar } from '../ui/shopBar.js';
import { DetailPanel, resolveDetail } from '../ui/detailPanel.js';
import { RewardOverlay } from '../ui/rewardOverlay.js';
import { ChoiceOverlay } from '../ui/choiceOverlay.js';
import { EnemyDrawer } from '../ui/enemyDrawer.js';
import { Ticker } from '../ui/ticker.js';
import { EmoteWheel } from '../ui/emotes.js';
import { EffectsList } from '../ui/effectsList.js';
import { CombatHud } from '../ui/combatHud.js';
import { SettingsModal } from '../ui/settings.js';
import { ExitModal, AwayOverlay, awayStore } from '../ui/matchChrome.js';
import { openGuide } from '../ui/guide.js';
import { actions } from '../ui/gameActions.js';
import { FacingWheel, holdPiece, setPieceDir, syncPieceDirs, showRange, useTileScreen } from '../ui/facingWheel.js';
import { Underframe, underframeRect, TempRowNotice } from '../ui/underframe.js';
import { needsFacing, facingIntent, previewGrid, pieceDir, underframeActions, retreatSlot, itemDestroyable } from '../ui/facing.js';
import { EquipReplaceDialog, replaceRequest, replaceIntent } from '../ui/equipReplace.js';
import { pauseAvailable, isPaused, frozenNow } from '../ui/matchStatus.js';
import { pieceTile } from '../render/drag.js';
import {
  phaseMode, phaseBanner, isCombatPhase, showDeadPill, isBossPhase, placementContext, canPlace, boardTargets, dropIntent,
  snapHud, activeBubbles, shortcutFor, shortcutBlocked, closesOnFieldPress, phaseTotalSeconds, homeFieldId, ownFieldId, normalizeSp, sortedPlayers,
  countdownState, shopBlockReason, stageOverrides, effectiveStage, watchTarget, dropFailureReason,
  previewEnemyKey, prepCamera, prepCameraFor, foldCamera, deployFieldOf, panelSide, panelSlots, bondPopupPlace, chessLoadout, unitLoadout,
  mergeTarget, modeOffBonds, readyFundsPrompt,
} from '../ui/gameLogic.js';
import { toast } from '../ui/toasts.js';
import { BriefingScreen } from './briefing.js';
import { BandDraftScreen } from './bandDraft.js';
import { ResultScreen } from './result.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, serverNow, emptyMatch, isSpectating } from '../store.js';
import { battleRunner } from '../battle/runner.js';
import { isClientCombat, observeTarget, teammateProgress, cameraLayers, layerCamera, sidesOf, resumedWatch } from '../battle/observe.js';
import { screenStrip, playerBonds, playerLayer, detailBondOwner, toggleBond, popupView } from '../ui/watchBonds.js';
import { data, localAsset, getMode } from '../data.js';
import { audio } from '../audio.js';
import { useDocClass, FullscreenButton } from '../ui/device.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const HUD_HZ_MS = 200;
/** Range tiles of the selected unit (its own highlight group: the wheel's 'facing' group may be up at the same time). */
const SEL_RANGE = Object.freeze({ group: 'selRange', color: 0xff9c33, fill: 0.3, line: 0.95 });
/** The tile an armed merge-completing card's elite will take (its own group; gold like the promotion cue, render/fx.js). */
const MERGE_HL = Object.freeze({ group: 'mergeTile', color: 0xffd45a, fill: 0.34, line: 1 });
const STATE_EV = new Set(['spawn', 'die', 'deploy', 'status', 'skill']);
/** Event tuples replayed when a field is entered late: the state-bearing kinds and the fx that change an enemy's model
 *  form (shared/protocol.js fxForm — the field meta's UnitInfo `form` predates them). */
const keepEarly = (e) => Array.isArray(e) && (STATE_EV.has(e[0]) || fxForm(e) !== undefined);

/** Router for the in-match screens. */
export function GameScreen() {
  const pub = useStore((s) => s.match.public);
  const hasResult = useStore((s) => !!s.match.result);
  const ended = useStore((s) => !!s.room && !s.room.inMatch && !!s.match.public);
  const away = useStore((s) => s.away, Object.is, awayStore);
  const autoplay = useStore((s) => !!(Array.isArray(s.match.public?.players) && s.match.public.players.find((p) => p && p.playerId === s.me.playerId)?.autoplay));
  const gd = useGameData();
  if (!pub || !gd.ready) {
    return html`<div class="screen gload">
      <${Spinner} size="lg" label=${pub ? 'LOADING DATA' : 'ENTERING SIMULATION'} />
      <p class="t-lo">${pub ? '正在载入模拟数据…' : '正在进入模拟…'}</p>
    </div>`;
  }
  const mode = phaseMode(pub.phase);
  let body;
  if (hasResult || mode === 'result') body = html`<${ResultScreen} />`;
  else if (mode === 'briefing') body = html`<${BriefingScreen} />`;
  else if (mode === 'draft') body = html`<${BandDraftScreen} />`;
  else body = html`<${MatchScreen} />`;
  return html`${body}
    ${(away || autoplay) && !hasResult && mode !== 'result' && !ended ? html`<${AwayOverlay} />` : null}
    ${ended && !hasResult && mode !== 'result' ? html`<${MatchEnded} />` : null}`;
}

/** The room went back to its lobby without a result (match aborted): offer the way back. */
function MatchEnded() {
  return html`<div class="awayov" role="dialog" aria-label="模拟已结束">
    <div class="awayov__box brackets">
      <${MicroLabel} tone="mint">SIMULATION CLOSED</${MicroLabel}>
      <h2>本局模拟已结束</h2>
      <p class="t-lo">同盟已返回等待室</p>
      <${Button} variant="primary" size="lg" icon="chevronLeft" onClick=${() => store.set({ match: emptyMatch() })}>返回同盟<//>
    </div>
  </div>`;
}

/** Solo pause (m.public.paused): the field dims under the 暂停中 plate; 继续作战 resumes (g.pause off). */
function PausedOverlay({ canResume, busy, onResume, onExit }) {
  const plate = localAsset('ui/battle', 'matte_pause');
  return html`<div class="pauseov" role="dialog" aria-label="暂停中" data-testid="paused">
    <div class="pauseov__box">
      <div class="pauseov__plate" style=${plate ? `--pause-plate:url("${plate}")` : ''}>
        <span class="pauseov__micro">PAUSED</span>
        <h2>暂停中</h2>
      </div>
      <p class="pauseov__note">作战已暂停，计时与敌人行动均已停止</p>
      <div class="pauseov__btns">
        ${onExit ? html`<${Button} variant="secondary" size="lg" icon="exit" onClick=${onExit}>放弃模拟<//>` : null}
        ${canResume ? html`<${Button} variant="primary" size="lg" icon="play" loading=${busy} onClick=${onResume} data-autofocus>继续作战<//>` : null}
      </div>
    </div>
  </div>`;
}

// ---- match screen ----------------------------------------------------------------------------------------

function MatchScreen() {
  useDocClass('sp-in-match');
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const field = useStore((s) => s.match.field);
  const myId = useStore((s) => s.me.playerId);
  const conn = useStore((s) => s.connection, shallowEqual);
  const emotes = useStore((s) => s.emotes);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const spectator = useStore((s) => isSpectating(s.room, s.me.playerId));
  const gd = useGameData();

  const hostRef = useRef(null);
  const barRef = useRef(null);
  const hudElRef = useRef(null);                         // .gm__hud (inside the safe-area insets: the panels' frame)
  const { view, kind: viewKind } = useFieldView(hostRef);

  const [watching, setWatching] = useState(null);        // fieldId the player chose to watch (null = home)
  const [watchWho, setWatchWho] = useState(null);        // { fieldId, playerId }: the teammate picked with 前往查看
  const [drawer, setDrawer] = useState(null);            // 'enemies' | 'info' | null
  const [bondOpen, setBondOpen] = useState(null);        // { id, ownerId, from }: the bond popup and whose bond it shows
  const [detail, setDetail] = useState(null);            // detail target
  const [collapsed, setCollapsed] = useState(false);
  const [rewardMin, setRewardMin] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [drag, setDrag] = useState(null);                // { uid, kind, id } while dragging a piece
  const [facing, setFacing] = useState(null);            // direction step: { uid, piece, row, col, grid, name }
  const [sel, setSel] = useState(null);                  // tapped own piece: { uid }
  const [selBusy, setSelBusy] = useState(false);
  const [holdSeq, setHoldSeq] = useState(0);             // bumped when a held piece is released (re-apply the prep state)
  const [hud, setHud] = useState(null);
  const [banner, setBanner] = useState(null);
  const [readyBusy, setReadyBusy] = useState(false);
  const [spBusy, setSpBusy] = useState(null);
  const [layer, setLayer] = useState('ALL');             // 联防 / 最终攻势 camera: 'L' | 'ALL' | 'R'
  const [pen, setPen] = useState(false);                 // the camera shows the enemy preview pen (research 09 §2)
  const [camKind, setCamKind] = useState('prep');        // kind of the last camera request (data-camera)
  const [replace, setReplace] = useState(null);          // equip-replace dialog: { request, resolve }
  const [pauseBusy, setPauseBusy] = useState(false);
  const [armedCard, setArmedCard] = useState(null);     // the shop bar's armed card { kind, id } (merge tile cue)
  const cc = isClientCombat(pub);
  const battleState = useStore((s) => s.match.battle, shallowEqual); // local battle runner (client-side combat)

  const phase = pub?.phase;
  const mode = phaseMode(phase);
  const combat = isCombatPhase(phase);
  const solo = roomSolo || String(pub?.modeId || '').includes('single');
  const players = sortedPlayers(pub);
  const meP = players.find((p) => p.playerId === myId) || null;
  // a spectator seat watches like an eliminated player (it has no m.private and no row in m.public)
  const alive = spectator ? false : priv ? priv.alive !== false : meP?.alive !== false;
  const home = homeFieldId(pub, myId);
  const watchingOther = !!watching && watching !== home && watching !== ownFieldId(myId);
  const editable = phase === PHASE.PREP && !!priv && alive && !priv.ready && !watchingOther;
  const showShop = !!priv && alive && (phase === PHASE.PREP || phase === PHASE.SP_DRAFT || phase === PHASE.ROUND_START) && !watchingOther;
  const layersDisabled = phase === PHASE.UNITE || isBossPhase(phase);
  const sp = phase === PHASE.SP_DRAFT ? normalizeSp(pub?.sp, players) : null;
  const total = phaseTotalSeconds(pub, gd.config, myId);
  // solo pause: offered in the own battle; while m.public.paused every HUD clock stops at the pause moment
  const paused = isPaused(pub);
  const pauseSeenRef = useRef(null);
  if (!paused) pauseSeenRef.current = null;
  else if (pauseSeenRef.current == null) pauseSeenRef.current = serverNow();
  const frozenAt = paused ? frozenNow(pub, serverNow(), pauseSeenRef.current) : null;
  // live LP (user playtest #3 item 2): the own normal battle's counted leaks — the local runner's count (authoritative
  // or display replica) and the server's m.public players[].pendingLp, whichever is further (both only grow during a
  // round; a display replica stands still while the player watches a teammate's field, the server's count then moves
  // on) — cost min(lpCapPerRound, n) at settlement; shown at once until the settled m.private lands (ui/hud.js liveLp
  // keeps the base between renders); 联防 (user playtest #6 item 7): a leaker's enemies still standing on the 联防 field —
  // the local replica's count while it runs, else m.public players[].uniteLeft (ui/hud.js uniteRemaining) — replace it;
  // the teammates' rows take the same local counts (`uniteLocal`, ui/teamPanel.js rowLp)
  const lpBaseRef = useRef(null);
  const localLeaks = battleState && battleState.leaks ? battleState.leaks[ownFieldId(myId)] : undefined;
  const uniteLocal = phase === PHASE.UNITE && battleState && battleState.uniteLeft ? battleState.uniteLeft : null;
  const leaker = phase === PHASE.UNITE && Array.isArray(pub?.unite?.leakers) && pub.unite.leakers.includes(myId);
  const localLeft = leaker && uniteLocal ? (uniteLocal[myId] ?? 0) : undefined;
  const liveLpNow = liveLp(lpBaseRef.current, {
    phase, round: pub?.round, lp: priv?.lp, statsLeaks: priv?.stats?.leaks, alive,
    leaks: ownLeaks(localLeaks, meP?.pendingLp), cap: gd.config?.lpCapPerRound,
    uniteLeft: leaker ? uniteRemaining(localLeft, meP?.uniteLeft) : null,
  });
  lpBaseRef.current = liveLpNow.base;

  // latest values for event handlers bound once
  const live = useRef({});
  // the field the own pieces are deployed on: the own board, or the player's half of the boss field in a boss round's
  // prep (user playtest #5 item 7: legality and the legal-tile highlights read THOSE tiles, like the server)
  const deployField = deployFieldOf(pub, myId);
  const placeCtx = useMemo(() => placementContext({
    priv, stage: gd.stage(pub?.stageId), editable, field: deployField,
    getChess: gd.chess, getToken: gd.token, getItem: gd.item, getEffect: gd.effect,
  }), [priv, pub?.stageId, editable, gd.ready, deployField]);
  live.current = { pub, priv, field, editable, placeCtx, watching, watchWho, home, myId, detail, drawer, bondOpen, emoteOpen, settingsOpen, exitOpen, drag, facing, sel, pen, collapsedNow: collapsed, localDone: false, canPause: false, paused };

  // ---- camera: every request goes through setCam, which remembers it for the pen's way back -----------------------
  // the own prep board: the normal board, or — in the prep of a boss round — the player's half of the boss field
  // (research 09 §1.2: the right-hand player's board mirrored; gameLogic prepCamera). The DOM fallback view keeps the
  // own board's layout there (every coordinate the UI handles is a board coordinate either way) and draws the tiles of
  // that half (ui/fallbackField.js: the legal fence tiles are floor, not the normal field's walls; user playtest #5 item 7).
  const prepCam = prepCamera(pub, myId);
  const prepCamKey = `${prepCam.kind}:${prepCam.opts.side}`;
  const prepCamSeen = useRef(prepCamKey);                // the prep camera last requested
  const camRef = useRef({ kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L' } });
  const penRef = useRef({ on: false, collapsed: false });
  // the shop bar is shown folded (收起; the pen folds it for itself: the player's own state is the one it returns to) —
  // the own prep board then takes the official shop-collapsed camera (public issue #5, gameLogic prepCameraFor)
  const shopFolded = showShop && (pen ? penRef.current.collapsed : collapsed);
  const cancelFacingRef = useRef(() => {});
  const setCam = useCallback((kind, opts) => {
    camRef.current = { kind, opts: opts || {} };
    setCamKind(kind);
    if (penRef.current.on) { penRef.current.on = false; setPen(false); setCollapsed(penRef.current.collapsed); }
    view?.setCamera(kind, opts);
  }, [view]);
  // 休整期 only; never while a piece is being placed (the wheel sits on a tile of the board camera)
  const penAvail = phase === PHASE.PREP && !!view && viewKind !== 'loading';
  /** Pan to the enemy preview pen (on) or back to the camera in use before (off). */
  const togglePen = useCallback((on) => {
    const P = penRef.current;
    if (!view || on === P.on) return;
    if (on) {
      const L = live.current;
      if (L.pub?.phase !== PHASE.PREP) return;
      if (L.facing) return;
      P.on = true;
      P.collapsed = L.collapsedNow;
      setPen(true);
      setSel(null);
      setDrawer(null);                                   // the pen replaces the list
      setBondOpen(null);                                 // the bond strip hides: its popup must not float over the pen
      setDetail((d) => (d?.kind === 'enemy' ? d : null)); // a shop card / unit card belongs to the board view
      setCollapsed(true);
      view.setCamera('pen', { side: camRef.current.opts?.side || 'L' });
      audio.sfx('click', { volume: 0.5 });
    } else {
      P.on = false;
      setPen(false);
      setCollapsed(P.collapsed);
      const c = camRef.current;
      view.setCamera(c.kind, c.opts);
      audio.sfx('back', { volume: 0.5 });
    }
  }, [view]);
  const togglePenRef = useRef(togglePen);
  togglePenRef.current = togglePen;

  // the stage as the own board looks: terrain 机变 cards open / reclassify tiles and remove crates (stageOverrides)
  const baseStage = gd.ready ? gd.stage(pub?.stageId) : null;
  const overrides = stageOverrides(priv, gd.effect);
  const overridesKey = JSON.stringify(overrides);
  const ownStage = useMemo(() => effectiveStage(baseStage, overrides), [baseStage, overridesKey]);

  // ---- field view wiring ---------------------------------------------------------------------------------
  const lastFieldRef = useRef(null);
  const viewModeRef = useRef(null);
  const snapUnitsRef = useRef(new Map());
  const hudRef = useRef(null);
  // b.ev / b.snap that arrive before the UI entered their field (the battle's first ticks race the m.public /
  // m.field re-render): kept per fieldId and replayed on enter so no unit's 'spawn' UnitInfo is ever lost.
  const evBufRef = useRef(new Map());   // fieldId → ev tuples since that field's m.field
  const snapBufRef = useRef(new Map()); // fieldId → latest snapshot
  // a new m.field for the field already on screen (a resync, or the runner re-showing it after a hidden-tab backlog
  // overflowed): its frames are buffered like a new field's until the enter effect re-enters it — enterBattle resets
  // the view, so a 'spawn' or form fx pushed in between used to be lost (placeholder views, the old model)
  const reentryRef = useRef(null);

  // prep rendering (own board) vs battle rendering (m.field). The field object present when prep starts is stale
  // (last round's battle): combat only enters an m.field pushed after that (a new object), and every new m.field
  // push (watch switch, reconnect) re-enters the battle view.
  const showPrep = (mode === 'prep' || mode === 'boot') && !watchingOther;

  // own board (prep, or a battle field the player fights on) → the stage with the player's overrides; a teammate's
  // board → the plain stage (their overrides are not known here)
  const shownField = showPrep ? null : field;
  const shownMembers = shownField ? ((Array.isArray(pub?.fields) ? pub.fields : []).find((f) => f && f.fieldId === shownField.fieldId)?.players
    || (Array.isArray(shownField.players) ? shownField.players : null)) : null;
  const ownView = showPrep || (shownField ? (shownMembers ? shownMembers.includes(myId) : shownField.fieldId === ownFieldId(myId)) : !watchingOther);
  useEffect(() => {
    if (!view) return;
    const st = ownView ? ownStage : baseStage;
    if (st) view.setStage(st);
  }, [view, ownView, ownStage, baseStage]);
  const staleFieldRef = useRef(null);
  const enteredFieldRef = useRef(null);
  const pressSel = useRef(null);                         // the selected piece when the current field press began
  useEffect(() => {
    if (!view) return;
    if (showPrep) {
      if (field?.prep) staleFieldRef.current = field; // a prep scouting board is never a battle to enter
      if (viewModeRef.current !== 'prep') {
        // the battle we just left (or whatever was stored before mount) must not be re-entered next combat;
        // an m.field that arrives during prep (the upcoming battle) is a new object and will be entered
        staleFieldRef.current = field;
        const pc = prepCameraFor(pub, myId, shopFolded);
        setCam(pc.kind, pc.opts);
        prepCamSeen.current = prepCamKey;
        viewModeRef.current = 'prep';
        lastFieldRef.current = null;
        enteredFieldRef.current = null;
        reentryRef.current = null;
        setHud(null);
      }
      if (priv) {
        view.setPrep(priv, { editable, canPlace: (uid, target) => canPlace(live.current.placeCtx, uid, target).ok });
        // stored facings (m.private board `dir`); the piece in the direction step shows the wheel's preview instead
        syncPieceDirs(view, priv, live.current.facing?.uid ?? null);
      }
      return;
    }
    const wanted = combat || mode === 'settle' || watchingOther;
    if (!wanted || !field || !field.fieldId || field === staleFieldRef.current || field === enteredFieldRef.current) return;
    if (watchingOther && !combat && field.fieldId !== watching) return; // an older push while switching
    if (lastFieldRef.current && lastFieldRef.current !== field.fieldId) setDetail((d) => (d?.kind === 'unit' ? null : d));
    enteredFieldRef.current = field;
    lastFieldRef.current = field.fieldId;
    reentryRef.current = null;
    viewModeRef.current = 'battle';
    snapUnitsRef.current = new Map();
    view.enterBattle(field);
    const early = evBufRef.current.get(field.fieldId);
    evBufRef.current.delete(field.fieldId);
    const earlySnap = snapBufRef.current.get(field.fieldId);
    snapBufRef.current.delete(field.fieldId);
    const kind = field.kind === 'hidden' ? 'boss' : field.kind || 'normal';
    const pf = (Array.isArray(pub?.fields) ? pub.fields : []).find((f) => f && f.fieldId === field.fieldId);
    const members = Array.isArray(pf?.players) ? pf.players : Array.isArray(field.players) ? field.players : [];
    const sides = field.sides && typeof field.sides === 'object' ? field.sides : null;
    const side = sides && sides[myId] ? sides[myId] : members.length > 1 && members.indexOf(myId) === 1 ? 'R' : 'L';
    // local simulation (client-side combat) feeds a frame per animation frame: no network jitter buffer
    view.raw?.setLocalFeed?.({ on: !!field.local, speed: field.speed });
    setLayer('ALL');
    // a lone player's boss field (solo modes, the odd player of a co-op Final Assault: the `_s` templates route every
    // enemy to the left objective) is framed on its own half like the ‹ › half view; pairs start on 全景
    const lone = kind === 'boss' && members.length === 1;
    setCam(kind, lone ? { rect: field.rect, side, half: true } : { rect: field.rect, side });
    audio.setFieldUnits(field.units);
    if (early && early.length) {
      // replay state-bearing events only (a burst of stale hit sparks / damage numbers would look wrong)
      view.pushEvents(early);
      audio.handleBattleEvents(early.filter((e) => e[0] === 'spawn'));
    }
    if (!earlySnap && (field.prep || !combat) && Array.isArray(field.units)) {
      // prep scouting: no battle snapshots follow. A later m.field for this board (the teammate moved) re-enters
      // above and places the units again, including an empty board (GitHub #87).
      view.pushSnapshot({
        fieldId: field.fieldId, gt: 0,
        units: field.units.filter((u) => u && u.id != null).map((u) => [u.id, Number(u.x) || 0, Number(u.y) || 0, u.maxHp || 1, u.maxHp || 1, 0, 0, 0, 0]),
      });
    }
    if (earlySnap) {
      view.pushSnapshot(earlySnap);
      hudRef.current = snapHud(earlySnap);
      setHud(hudRef.current);
    }
  }, [view, showPrep, priv, editable, field, combat, mode, watchingOther, watching, holdSeq]);

  // battle frames straight from the socket (server-run combat, 20 Hz) or from the local simulation (client-side combat,
  // battle/runner.js, every animation frame) — never through the store. Frames go to the view as received: the game
  // time travels as `gt` and the render engine reads it (render/interp.js frameTime).
  useEffect(() => {
    let last = 0;
    let pending = null;
    const flush = () => { pending = null; last = performance.now(); setHud(hudRef.current); };
    const onFieldMeta = (msg) => {
      if (!msg || typeof msg.fieldId !== 'string') return;
      evBufRef.current.set(msg.fieldId, []);
      snapBufRef.current.delete(msg.fieldId);
      if (msg.fieldId === lastFieldRef.current) reentryRef.current = msg.fieldId;
    };
    // the field the view shows now (null while a re-entry of it is pending: its frames are buffered)
    const shownId = () => (reentryRef.current && reentryRef.current === lastFieldRef.current ? null : lastFieldRef.current);
    const onSnap = (snap) => {
      const cur = shownId();
      if (!snap || typeof snap !== 'object') return;
      if (!cur || (snap.fieldId && snap.fieldId !== cur)) {
        if (typeof snap.fieldId === 'string') snapBufRef.current.set(snap.fieldId, snap);
        return;
      }
      view?.pushSnapshot(snap);
      if (Array.isArray(snap.units)) {
        const mp = new Map();
        for (const t of snap.units) if (Array.isArray(t)) mp.set(t[0], t);
        snapUnitsRef.current = mp;
      }
      hudRef.current = snapHud(snap);
      const dt = performance.now() - last;
      if (dt >= HUD_HZ_MS) flush();
      else if (!pending) pending = setTimeout(flush, HUD_HZ_MS - dt);
    };
    const onEv = (msg) => {
      const cur = shownId();
      if (!msg || !Array.isArray(msg.ev)) return;
      if (!cur || (msg.fieldId && msg.fieldId !== cur)) {
        if (typeof msg.fieldId !== 'string') return;
        const buf = evBufRef.current.get(msg.fieldId) || [];
        // only state-bearing tuples are replayed later (see the enter effect)
        for (const e of msg.ev) if (keepEarly(e)) buf.push(e);
        if (buf.length > 1500) buf.splice(0, buf.length - 1500);
        evBufRef.current.set(msg.fieldId, buf);
        if (evBufRef.current.size > 8) evBufRef.current.delete(evBufRef.current.keys().next().value);
        return;
      }
      view?.pushEvents(msg);
      audio.handleBattleEvents(msg.ev);
    };
    const offs = [net.on('m.field', onFieldMeta), net.on('b.snap', onSnap), net.on('b.ev', onEv)];
    if (battleRunner) offs.push(battleRunner.on('field', onFieldMeta), battleRunner.on('snap', onSnap), battleRunner.on('ev', onEv));
    return () => { for (const off of offs) { try { off(); } catch { /* ignore */ } } clearTimeout(pending); };
  }, [view]);

  // the prep board moves while prep is shown (a boss round's prep begins, or a teammate left and the pairs changed):
  // the next camera of the own board (the direction wheel sits on a board tile — it closes first)
  useEffect(() => {
    if (prepCamSeen.current === prepCamKey) return;
    prepCamSeen.current = prepCamKey;
    if (!view || viewModeRef.current !== 'prep' || !showPrep) return;
    if (live.current.facing) cancelFacingRef.current();
    setSel(null);
    const pc = prepCameraFor(pub, myId, shopFolded);
    setCam(pc.kind, pc.opts);
  }, [view, prepCamKey, showPrep]);

  // the shop bar folded (收起) or unfolded on the own prep board (public issue #5: the board did not grow, while the
  // battle and scouting views had no bar to make room for): the official shop-collapsed camera or the shop camera
  // again, flown like any camera change. Never over the pen or a teammate's board or in battle; deferred while a piece
  // is dragged or its direction is chosen (the drop target and the wheel sit on tiles of the camera in use) — this
  // effect runs again when that ends (gameLogic foldCamera). Picking reads the camera of every frame (render/pick.js).
  useEffect(() => {
    const next = foldCamera({
      pub, myId, folded: shopFolded, ownPrep: !!view && viewModeRef.current === 'prep' && showPrep,
      pen, busy: !!drag || !!facing, current: camRef.current,
    });
    if (next) setCam(next.kind, next.opts);
  }, [view, shopFolded, showPrep, pen, !!drag, !!facing, prepCamKey]);

  // 联防 / 最终攻势: the ‹ › pill moves the camera between the field's halves and 全景 (research 09 §3.1)
  useEffect(() => {
    if (!view || !field || !field.local || !isCombatPhase(phase)) return;
    if (!cameraLayers(field, pub, myId).length) return;
    const kind = field.kind === 'hidden' ? 'boss' : field.kind;
    setCam(kind, layerCamera(field, layer, sidesOf(field)[myId] || 'L'));
  }, [layer]);

  // 前往查看 of a teammate on a two-half shared field (a 联防 leaker / an eliminated spectator tapping a helper or a pair
  // player): the camera goes to that player's half, so the ‹ › pill reads "👁 name" like the strip's tag (DESIGN §20.15;
  // official observing targets a player, research 09 §3.1). Once per pick and per field entered (entering resets 全景).
  const whoAppliedRef = useRef({ who: null, field: null });
  useEffect(() => {
    const who = watchWho;
    if (!view || !who || !field || field.fieldId !== who.fieldId || !field.local || !isCombatPhase(phase)) return;
    const A = whoAppliedRef.current;
    if (A.who === who && A.field === field) return;
    whoAppliedRef.current = { who, field };
    const k = playerLayer(field, pub, myId, who.playerId);
    if (!k) return;
    setLayer(k);
    // the camera directly too: when the layer state already equals k the [layer] effect would not run
    setCam(field.kind === 'hidden' ? 'boss' : field.kind, layerCamera(field, k, sidesOf(field)[myId] || 'L'));
  }, [view, watchWho, field, phase]);

  // graceful degradation: without WebGL / the render engine the DOM view takes over — say so once per match
  useEffect(() => {
    if (viewKind !== 'fallback') return;
    let asked = null;
    try { asked = new URLSearchParams(globalThis.location?.search || '').get('render'); } catch { asked = null; }
    if (asked === 'fallback' || globalThis.__SP_RENDER__ === 'fallback') return;
    toast('当前设备无法启用 3D / WebGL 渲染，已切换为简化视图（功能不受影响）', 'info', { ttl: 5000 });
  }, [viewKind]);

  // phase changes: banners, sounds, resets
  const phaseKey = `${phase}:${pub?.round}`;
  const prevPhase = useRef(null);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;
    const b = phaseBanner(phase, pub);
    if (b) setBanner({ ...b, key: phaseKey });
    if (phase === PHASE.ROUND_START) audio.sfx('roundStart');
    else if (phase === PHASE.PREP) audio.sfx('rest', { volume: 0.7 });
    else if (phase === PHASE.COMBAT) audio.sfx('battleStart');
    else if (phase === PHASE.UNITE) audio.sfx('defenceUnite');
    else if (phase === PHASE.FINAL_ASSAULT) audio.sfx(solo ? 'bossRoundSingle' : 'bossRoundTeam');
    else if (phase === PHASE.HIDDEN_CORE) audio.sfx('bossRoundSecret');
    else if (phase === PHASE.SP_DRAFT) audio.sfx('draft');
    setWatching(null); // the server resets every watcher to its own field on phase changes
    setWatchWho(null);
    // the pen is a 休整期 view: leaving prep returns the camera (the next setCam would, too)
    if (phase !== PHASE.PREP && penRef.current.on) togglePenRef.current(false);
    // a battle unit's panel (live HP of a unit of the fight that just ended) never outlives its battle
    if (!isCombatPhase(phase) && phase !== PHASE.SETTLE) setDetail((d) => (d?.kind === 'unit' ? null : d));
    if (isCombatPhase(phase)) { setCollapsed(false); setDrag(null); view?.highlightTiles(null, null); }
    setSel(null);
    if (phase !== PHASE.PREP) setRewardMin(false);
    setSpBusy(null);
  }, [phaseKey]);

  // a reload / reconnect while watching a teammate's battle after the own one (client-side combat): the server resends
  // the watched field, the fresh screen adopts it as watched once per battle — the observing pill, 返回战场 and the own
  // row work again, and the bond strip's "👁 name" matches the HUD (battle/observe.js resumedWatch)
  const seenBattleRef = useRef(null);
  useEffect(() => {
    const r = resumedWatch(battleState, { pub, myId, alive, watching, seen: seenBattleRef.current });
    seenBattleRef.current = r.seen;
    if (r.fieldId) setWatching(r.fieldId);
  }, [battleState?.battleId, battleState?.loading, !!pub]);

  // timer ticks (≤ 10 s) while the player still has something to do
  const cd = countdownState(pub?.deadline, serverNow(), total);
  useTicker(cd.remain != null && cd.remain <= 10 ? 1000 : 0);
  const lastTick = useRef(null);
  useEffect(() => {
    if (cd.remain == null || cd.remain > 10 || cd.remain === lastTick.current) return;
    lastTick.current = cd.remain;
    const busyPrep = phase === PHASE.PREP && priv && !priv.ready && alive;
    const myPick = sp && (solo || sp.turnPid === myId) && !sp.pickOf.has(myId);
    if ((busyPrep || myPick) && cd.remain > 0) audio.sfx('timer', { volume: 0.6 });
  });

  // your turn cue in the 机变 draft
  const spMine = !!sp && !solo && sp.turnPid === myId && !sp.pickOf.has(myId);
  useEffect(() => { if (spMine) audio.sfx('yourTurn'); }, [spMine]);

  // promotion (merge reward offered) and bond activation cues; a special refresh's offer (凯瑟琳 定向投放 …) plays the
  // shop's refresh sound instead of the promotion cue
  const offerCue = priv?.shop?.rewardOffer ? (priv.shop.rewardOffer.source === 'special' ? 'refresh' : 'merge') : null;
  useEffect(() => { if (offerCue) audio.sfx(offerCue); }, [offerCue]);
  // a shop / reward card armed for a purchase that completes a merge lights the tile its elite will take (the deployed
  // copy that deploys first — PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置", gameLogic.mergeTarget)
  const mergeAt = armedCard?.kind === 'chess' && editable && showPrep ? mergeTarget(priv, armedCard.id, gd.chess) : null;
  const mergeAtKey = mergeAt ? `${mergeAt.row},${mergeAt.col}` : '';
  useEffect(() => {
    if (!view) return;
    try { view.highlightTiles(mergeAt ? [[mergeAt.row, mergeAt.col]] : [], MERGE_HL); } catch { /* cosmetic */ }
  }, [view, mergeAtKey]);
  const activeBonds = (priv?.bonds || []).filter((b) => b && b.active).length;
  const prevActive = useRef(activeBonds);
  useEffect(() => {
    if (activeBonds > prevActive.current && phase === PHASE.PREP) audio.sfx('bondUp', { volume: 0.7 });
    prevActive.current = activeBonds;
  }, [activeBonds]);

  // emote bubbles (and a sound for teammates' emotes)
  const bubbleMs = (gd.config?.timers?.chatBubble ?? 3) * 1000;
  const bubbles = activeBubbles(emotes, Date.now(), bubbleMs);
  useTicker(bubbles.size ? 500 : 0); // re-render only while a bubble is showing (to expire it)
  const lastEmote = useRef(emotes.length ? emotes[emotes.length - 1].seq : 0);
  useEffect(() => {
    const e = emotes[emotes.length - 1];
    if (e && e.seq > lastEmote.current) { lastEmote.current = e.seq; if (e.playerId !== myId) audio.sfx('emote', { volume: 0.6 }); }
  }, [emotes]);

  // ---- actions ----------------------------------------------------------------------------------------------
  const buy = useCallback((i) => actions.buy(i), []);
  // 准备 with funds left asks first: the prep's end wipes them (community report #4; not 坎诺特, not at 0 funds, not
  // under AI 托管 — gameLogic.readyFundsPrompt). The button and Space both come here.
  const askingReady = useRef(false);
  const toggleReady = useCallback(async (r) => {
    const L = live.current;
    const me = Array.isArray(L.pub?.players) ? L.pub.players.find((p) => p && p.playerId === L.myId) : null;
    const ask = r ? readyFundsPrompt(L.priv, { keptBands: data.get('config')?.economy?.leftoverFundsKeptByBands, autoplay: !!me?.autoplay }) : null;
    if (ask) {
      if (askingReady.current) return;
      askingReady.current = true;
      const ok = await confirmDialog(ask);
      askingReady.current = false;
      const now = live.current;
      if (!ok || now.pub?.phase !== PHASE.PREP || now.priv?.ready) return;
    }
    setReadyBusy(true);
    await actions.ready(r);
    setReadyBusy(false);
  }, []);
  // the prep ended (timer) while the question was open: drop it — the funds are gone either way
  useEffect(() => { if (phase !== PHASE.PREP && askingReady.current) closeAllDialogs(); }, [phase]);

  /** 出售 (operators, underframe +N) / 销毁 (items and Arts, confirmed: they cannot be sold). */
  const sellPiece = useCallback(async (piece) => {
    if (!piece) return false;
    const closeIt = () => { setDetail((d) => (d?.kind === 'piece' && d.uid === piece.uid ? null : d)); setSel((x) => (x && x.uid === piece.uid ? null : x)); };
    if (piece.kind === 'item') {
      // an equipped item is locked (the server refuses g.destroy): replacing it is the equip-replace dialog's job
      if (!itemDestroyable(live.current.placeCtx, piece.uid)) { toast('已配发的装备无法销毁', 'warn'); audio.sfx('error', { volume: 0.5 }); return false; }
      const it = data.lookup('items', piece.id);
      const ok = await confirmDialog({ title: '销毁道具', text: `道具无法出售。确定要销毁「${it?.name || '道具'}」吗？`, okText: '销毁', danger: true });
      if (ok && await actions.destroy(piece.uid)) { closeIt(); return true; }
      return false;
    }
    if (await actions.sell(piece.uid)) { closeIt(); return true; }
    return false;
  }, []);

  // The watched field only changes once the server accepted g.watch: a refused target (an eliminated teammate, the
  // other pair's boss field) must not move the eye icon / switcher label away from what is actually on screen.
  // `playerId`: the teammate picked (a team row) — a shared field shows two players, the strip follows the picked one
  // (DESIGN §20.15); null for a field picked as such (the legacy switcher).
  const requestWatch = useCallback(async (fid, playerId = null) => {
    const prev = live.current.watching;
    const prevWho = live.current.watchWho;
    const who = playerId ? { fieldId: fid, playerId } : null;
    setWatching(fid);
    setWatchWho(who);
    const ok = await actions.watch(fid);
    if (!ok) {
      setWatching((w) => (w === fid ? prev : w));
      setWatchWho((w) => (w === who ? prevWho : w));
    }
    return ok;
  }, []);

  /** Back to the own field (返回战场 / the own row). */
  const backHome = useCallback(() => {
    const L = live.current;
    if (L.watching && L.watching !== L.home) {
      const target = isCombatPhase(L.pub?.phase) ? L.home : ownFieldId(L.myId);
      // client-side combat without an own field to go back to (a 联防 leaker, an eliminated player): the screen keeps
      // the field it shows — g.watch of a field that does not exist would only be refused (an error toast)
      const exists = !isClientCombat(L.pub) || !isCombatPhase(L.pub?.phase) || (Array.isArray(L.pub?.fields) && L.pub.fields.some((f) => f && f.fieldId === target));
      if (exists) actions.watch(target);
    }
    setWatching(null);
    setWatchWho(null);
  }, []);

  const watchPlayer = useCallback((p) => {
    const L = live.current;
    if (isClientCombat(L.pub)) {
      const observing = !!L.watching && L.watching !== L.home && L.watching !== ownFieldId(L.myId);
      const t = observeTarget(p, L.pub, L.myId, { observing, ownDone: L.localDone });
      if (t.back) { backHome(); return; }
      if (t.reason) { toast(t.reason, 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
      if (t.fieldId) requestWatch(t.fieldId, p.playerId);
      return;
    }
    const self = p.playerId === L.myId;
    if (self) {
      if (L.watching && L.watching !== L.home) actions.watch(isCombatPhase(L.pub?.phase) ? L.home : ownFieldId(L.myId));
      setWatching(null);
      setWatchWho(null);
      return;
    }
    const t = watchTarget(p, L.pub, L.myId);
    if (t.reason) { toast(t.reason, 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
    requestWatch(t.fieldId, p.playerId);
  }, []);

  const watchField = useCallback((fid) => { requestWatch(fid); }, []);

  // a spectator seat has no board of its own: in 休整期 / 机变 / round start it is shown the first player still in (as a
  // tap on that row would — g.watch 'n:<pid>', the read-only board), once per phase; a row switches to another player
  const scoutedRef = useRef(null);
  useEffect(() => {
    if (!spectator || watching || !pub || scoutedRef.current === phaseKey) return;
    if (phase !== PHASE.PREP && phase !== PHASE.SP_DRAFT && phase !== PHASE.ROUND_START) return;
    const first = players.find((p) => p.alive !== false && p.status !== 'left');
    if (!first) return;
    scoutedRef.current = phaseKey;
    requestWatch(ownFieldId(first.playerId), first.playerId);
  }, [spectator, phaseKey, watching]);

  // ---- view events (drag & drop, clicks) ----------------------------------------------------------------------
  useEffect(() => {
    if (!view) return undefined;
    let moveOff = null;
    // the drop target is the tile under the pointer (render/drag.js; an item dropped on a unit's tile equips that unit —
    // user playtest #4 item 1); `tile` = the last target tile (tileHover), `released` = the pointer went up (not a cancel)
    const ptr = { released: false, tile: null };
    const lookups = { getChess: gd.chess, getToken: gd.token, getItem: gd.item, chessRecord: (rec) => chessLoadout(rec, live.current.priv?.loadout ?? null, gd.chess)?.record };
    const runIntent = async (intent) => {
      const L = live.current;
      if (intent.confirmReplace) {
        // both slots used: the player picks the equipped item to destroy (cancel ⇒ nothing is sent)
        const request = replaceRequest(L.placeCtx, intent, gd.chess, gd.item);
        if (request) {
          const uid = await openReplaceRef.current(request);
          if (!Number.isInteger(uid)) { audio.sfx('back', { volume: 0.5 }); return; }
          const r = replaceIntent(intent, uid);
          await actions.equip(r.fields.itemUid, r.fields.targetUid, r.fields.replaceUid);
          return;
        }
      }
      const f = intent.fields;
      if (intent.t === 'g.move') await actions.move(f.uid, f.to);
      else if (intent.t === 'g.equip') await actions.equip(f.itemUid, f.targetUid);
      else if (intent.t === 'g.art') await actions.art(f.itemUid, f.row, f.col);
    };
    const refuse = (reason) => {
      audio.sfx('error', { volume: 0.5 });
      if (reason) toast(reason, 'warn');
    };
    const endDrag = () => {
      moveOff?.(); moveOff = null;
      setDrag(null);
      view.highlightTiles(null, null);
    };
    /** Open the direction wheel for a legal board drop (the piece stays on the tile meanwhile). */
    const openFacing = (entry, t) => {
      const piece = entry.piece;
      const rec = piece.kind === 'item' ? gd.item(piece.id) : piece.kind === 'token' ? gd.token(piece.id) : gd.chess(piece.id);
      holdPiece(view, piece.uid, { row: t.row, col: t.col });
      setSel(null);
      setFacing({ uid: piece.uid, piece, row: t.row, col: t.col, grid: previewGrid(lookups, piece), name: rec?.name || '' });
      audio.sfx('pick', { volume: 0.5 });
    };
    const offs = [
      view.on('pieceDragStart', (e) => {
        const L = live.current;
        const entry = L.placeCtx?.pieces.get(e?.uid);
        if (!entry || !L.editable) return;
        audio.sfx('pick', { volume: 0.6 });
        setSel(null);
        // a new placement: a piece's detail card (right-click / long-press) would sit beside the wheel showing another unit
        setDetail((d) => (d?.kind === 'piece' ? null : d));
        setDrag({ uid: entry.piece.uid, kind: entry.piece.kind, id: entry.piece.id, area: entry.area });
        const { legal } = boardTargets(L.placeCtx, entry.piece.uid);
        view.highlightTiles(null, null);
        view.highlightTiles(legal, 'legal');
        ptr.released = false; ptr.tile = null;
        // capture phase: marked before the drag controller (canvas listener) ends the drag
        const onUp = () => { ptr.released = true; };
        window.addEventListener('pointerup', onUp, { passive: true, capture: true });
        moveOff = () => window.removeEventListener('pointerup', onUp, { capture: true });
      }),
      view.on('tileHover', (t) => { ptr.tile = t && typeof t === 'object' ? t : null; }),
      view.on('pieceDrop', async (e) => {
        endDrag();
        const L = live.current;
        if (!e || !L.editable) return;
        const entry = L.placeCtx?.pieces.get(e.uid);
        if (!entry) return;
        const t = e.target || {};
        if (t.area === 'outside') return; // no drag-to-sell (research 09 §5): the piece goes back
        const res = canPlace(L.placeCtx, e.uid, t);
        if (needsFacing(L.placeCtx, e.uid, t, res)) { openFacing(entry, t); return; }
        const intent = dropIntent(L.placeCtx, e.uid, t);
        if (!intent) {
          if (res.code && res.code !== 'ALREADY') refuse(res.reason);
          return;
        }
        await runIntent(intent);
      }),
      view.on('pieceDragEnd', (e) => {
        // a cancelled drag (no pieceDrop) must not leave the highlights behind; a release on a tile that takes nothing
        // (the drag controller found no legal target there) says why
        const released = ptr.released;
        const tile = ptr.tile;
        endDrag();
        const L = live.current;
        if (!e || e.dropped || !released || !L.editable) return;
        const src = L.placeCtx?.pieces.get(e.uid);
        if (!src) return;
        const onOwnSlot = !!tile && ((src.area === 'board' && tile.area === 'board' && tile.row === src.row && tile.col === src.col)
          || (src.area !== 'board' && tile.area === src.area && (tile.idx ?? tile.col) === src.idx));
        if (onOwnSlot) return; // put back where it was
        const reason = dropFailureReason(L.placeCtx, e.uid, tile);
        if (reason) refuse(reason);
      }),
      view.on('pieceClick', (e) => {
        if (!e) return;
        audio.sfx('click', { volume: 0.4 });
        // an enemy of the preview pen (research 09 §2.2 "Intel": tap it for its detail card)
        const penKey = previewEnemyKey(e);
        if (penKey) { setDetail({ kind: 'enemy', id: penKey }); return; }
        if (e.unitId != null || e.unit) { setDetail({ kind: 'unit', unit: e.unit || null, unitId: e.unitId, uid: e.uid }); return; }
        if (!Number.isInteger(e.uid)) return;
        setDetail({ kind: 'piece', uid: e.uid });
        // a tap selects an own piece (underframe + range); right-click / long-press only opens its detail card. A tap on
        // the piece that was selected when the press started deselects it.
        const L = live.current;
        if (e.detail || e.button === 2 || !L.editable || L.facing) return;
        const wasSel = pressSel.current === e.uid;
        pressSel.current = null;
        setSel(wasSel ? null : { uid: e.uid });
        if (wasSel) setDetail((d) => (d?.kind === 'piece' && d.uid === e.uid ? null : d));
      }),
    ];
    return () => { moveOff?.(); for (const off of offs) { try { off?.(); } catch { /* ignore */ } } };
  }, [view]);

  // ---- equip-replace dialog (ui/equipReplace.js): one at a time; resolves the picked replaceUid or null (cancel) ----------
  const replaceRef = useRef(null);
  replaceRef.current = replace;
  const closeReplace = useCallback((uid) => {
    const cur = replaceRef.current;
    if (!cur) return;
    replaceRef.current = null;
    setReplace(null);
    try { cur.resolve(Number.isInteger(uid) ? uid : null); } catch { /* ignore */ }
  }, []);
  const openReplaceRef = useRef(null);
  openReplaceRef.current = (request) => new Promise((resolve) => {
    if (replaceRef.current) { try { replaceRef.current.resolve(null); } catch { /* ignore */ } }
    const next = { request, resolve };
    replaceRef.current = next;
    setSel(null);
    setReplace(next);
    audio.sfx('click', { volume: 0.5 });
  });
  // the dialog closes (nothing sent) when editing stops or its operator / item / equipped items changed meanwhile
  useEffect(() => {
    if (!replace) return;
    const r = replace.request;
    const target = placeCtx.pieces.get(r.targetUid)?.piece;
    const items = Array.isArray(target?.items) ? target.items : [];
    const still = editable && !!target && !!placeCtx.pieces.get(r.item.uid) && r.options.every((o) => items.some((x) => x && x.uid === o.uid));
    if (!still) closeReplace(null);
  }, [replace, placeCtx, editable]);
  useEffect(() => () => { const cur = replaceRef.current; replaceRef.current = null; try { cur?.resolve(null); } catch { /* ignore */ } }, []);

  // ---- solo pause (g.pause; m.public.paused) ---------------------------------------------------------------------------
  const togglePause = useCallback(async (on) => {
    setPauseBusy(true);
    await actions.pause(on);
    setPauseBusy(false);
  }, []);
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  // a press on the field deselects (a tap on a piece selects it again at release — see pieceClick)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onDown = () => {
      const L = live.current;
      pressSel.current = L.sel ? L.sel.uid : null;
      if (L.sel) setSel(null);
      // tapping elsewhere closes the selection and a card opened from the field — by a tap, a right-click or a long
      // press (a press on a piece re-opens its card at release, pieceClick)
      setDetail((d) => (closesOnFieldPress(d) ? null : d));
    };
    host.addEventListener('pointerdown', onDown, true);
    return () => host.removeEventListener('pointerdown', onDown, true);
  }, []);

  // ---- direction step (research 09 §1.2) and the selected piece's underframe ------------------------------------
  // DESIGN §16: previews show the range the unit fights with under the player's loadout (an elite's module grid)
  const lookups = useMemo(() => ({ getChess: gd.chess, getToken: gd.token, getItem: gd.item,
    chessRecord: (rec) => chessLoadout(rec, live.current.priv?.loadout ?? null, gd.chess)?.record }), [gd.ready]);
  const heldRef = useRef(new Map());                     // uid → { row, col, t } committed placements awaiting m.private
  const releaseHold = useCallback((uid) => {
    heldRef.current.delete(uid);
    holdPiece(view, uid, null);
    setHoldSeq((n) => n + 1);                           // re-apply the prep state: the piece settles where the server says
  }, [view]);
  const cancelFacing = useCallback(() => {
    const f = live.current.facing;
    if (!f) return;
    setFacing(null);
    if (f.piece.kind !== 'item') setPieceDir(view, f.uid, pieceDir(f.piece));
    releaseHold(f.uid);
    audio.sfx('back', { volume: 0.5 });
  }, [view, releaseHold]);
  cancelFacingRef.current = cancelFacing;
  const previewFacing = useCallback((dir) => {
    const f = live.current.facing;
    if (!f || f.piece.kind === 'item') return;
    setPieceDir(view, f.uid, dir || pieceDir(f.piece));
  }, [view]);
  const commitFacing = useCallback(async (dir) => {
    const f = live.current.facing;
    if (!f) return;
    setFacing(null);
    const intent = facingIntent(f.piece, { row: f.row, col: f.col }, dir);
    heldRef.current.set(f.uid, { row: f.row, col: f.col, t: Date.now() });
    const ok = intent.t === 'g.art'
      ? await actions.art(intent.fields.itemUid, intent.fields.row, intent.fields.col, intent.fields.dir)
      : await actions.move(intent.fields.uid, intent.fields.to, intent.fields.dir);
    if (!ok) {
      if (f.piece.kind !== 'item') setPieceDir(view, f.uid, pieceDir(f.piece));
      releaseHold(f.uid);
      return;
    }
    // accepted: the piece stays on the tile until m.private shows it there (or a short grace passes)
    setTimeout(() => { if (heldRef.current.has(f.uid)) releaseHold(f.uid); }, 1500);
  }, [view, releaseHold]);
  // m.private caught up with a committed placement → stop holding it; a summon stack of several copies (凯瑟琳's 2
  // devices, user playtest #6) stays in the hand and one copy — another piece — lands on the tile: release it too
  useEffect(() => {
    const splitLanded = (e, h) => e.piece.kind === 'token' && [...placeCtx.pieces.values()].some((x) => x.area === 'board' && x.piece.kind === 'token'
      && x.piece.id === e.piece.id && x.piece.uid !== e.piece.uid && x.row === h.row && x.col === h.col);
    for (const [uid, h] of [...heldRef.current]) {
      const e = placeCtx.pieces.get(uid);
      if (!e || (e.area === 'board' && e.row === h.row && e.col === h.col) || (e.area !== 'board' && splitLanded(e, h))) releaseHold(uid);
    }
  }, [placeCtx]);
  // the wheel closes when editing stops (ready, phase end, observing) or its piece is gone (merged, sold)
  useEffect(() => {
    if (facing && (!editable || !placeCtx.pieces.get(facing.uid))) cancelFacing();
  }, [editable, placeCtx, facing]);
  // the selected piece: gone / not editable → deselect; on the board its range tiles show (rotated to its facing)
  const selEntry = sel ? placeCtx.pieces.get(sel.uid) || null : null;
  useEffect(() => { if (sel && (!selEntry || !editable || !showPrep)) setSel(null); }, [sel, selEntry, editable, showPrep]);
  const selRangeKey = selEntry && selEntry.area === 'board' ? `${selEntry.piece.uid}:${selEntry.row},${selEntry.col}:${pieceDir(selEntry.piece)}` : '';
  useEffect(() => {
    if (!view || !selRangeKey) return undefined;
    showRange(view, previewGrid(lookups, selEntry.piece), selEntry.row, selEntry.col, pieceDir(selEntry.piece), SEL_RANGE);
    return () => showRange(view, null, 0, 0, null, SEL_RANGE);
  }, [view, selRangeKey]);
  // the selected piece's underframe on screen: the detail card docks on the side away from it (user playtest #2
  // item 8 — at some aspect ratios a bench unit's 出售 sat under the left card); the underframe is drawn above every
  // panel anyway (css z-index), this keeps it visible too
  const ufTile = selEntry && editable && showPrep ? pieceTile(selEntry) : null;
  const ufGeo = useTileScreen(view, ufTile ? ufTile.row : null, ufTile ? ufTile.col : null);
  // the gold tile of an armed merge card (mergeAt): the detail card the first tap opened docks away from it (QA 6b — at
  // 1920×1080 the left card covered half of a target tile in the leftmost legal column)
  const mergeGeo = useTileScreen(view, mergeAt ? mergeAt.row : null, mergeAt ? mergeAt.col : null);
  const retreatSel = useCallback(async () => {
    const L = live.current;
    const uid = L.sel?.uid;
    const to = uid != null ? retreatSlot(L.placeCtx, uid) : null;
    if (!to) { toast('整备区已满', 'warn'); audio.sfx('error', { volume: 0.5 }); return; }
    setSelBusy(true);
    if (await actions.move(uid, to)) {
      setSel(null);
      setDetail((d) => (d?.kind === 'piece' && d.uid === uid ? null : d)); // its card would cover the bench
    }
    setSelBusy(false);
  }, []);
  const sellSel = useCallback(async () => {
    const e = live.current.sel ? live.current.placeCtx.pieces.get(live.current.sel.uid) : null;
    if (!e) return;
    setSelBusy(true);
    await sellPiece(e.piece);
    setSelBusy(false);
  }, []);

  // unit clicks from the engine may only carry an id: resolve through m.field / spawn infos
  const detailTarget = useMemo(() => {
    if (detail?.kind !== 'unit' || detail.unit) return detail;
    const u = (Array.isArray(field?.units) ? field.units : []).find((x) => x && x.id === detail.unitId);
    return u ? { ...detail, unit: u } : detail;
  }, [detail, field]);
  const resolved = useMemo(() => resolveDetail(detailTarget, placeCtx.pieces), [detailTarget, placeCtx]);
  useEffect(() => { if (detail && !resolved && detail.kind === 'piece') setDetail(null); }, [resolved]);
  const snapHp = (() => {
    const id = resolved?.unitId;
    const t = id != null ? snapUnitsRef.current.get(id) : null;
    return t ? { hp: t[3], max: t[4] } : null;
  })();

  // ---- live stats of the detail card (user playtest #4 item 7) ------------------------------------------------------
  // battle: the local sim's unit (battle/runner.js unitStats — a getter the panel re-reads 4× a second; any unit of the
  // battle on screen: own, a teammate's, an enemy). Prep: an own board unit's stats at the start of its next battle,
  // asked from the server (g.unitStats → m.unitStats; only the newest request's answer counts) whenever m.private or the
  // phase changes while such a card is open — the last answer stays on show until the next one lands
  const [unitStats, setUnitStats] = useState(null);      // m.unitStats: { seq, round, units: Map<uid, entry> }
  const statsSeqRef = useRef(0);
  useEffect(() => net.on('m.unitStats', (msg) => {
    if (!msg || msg.seq !== statsSeqRef.current || !Array.isArray(msg.units)) return;
    setUnitStats({ seq: msg.seq, round: msg.round, units: new Map(msg.units.filter((u) => u && Number.isInteger(u.uid)).map((u) => [u.uid, u])) });
  }), []);
  const prepStatsUid = (phase === PHASE.PREP || phase === PHASE.SP_DRAFT || phase === PHASE.ROUND_START) && showPrep && alive
    && !!resolved?.piece && (resolved.type === 'chess' || resolved.type === 'token') && placeCtx.pieces.get(resolved.piece.uid)?.area === 'board'
    ? resolved.piece.uid : null;
  useEffect(() => {
    if (prepStatsUid == null) return undefined;
    const t = setTimeout(() => {
      statsSeqRef.current = (statsSeqRef.current % 1e9) + 1;
      try { Promise.resolve(net.request('g.unitStats', { seq: statsSeqRef.current })).catch(() => {}); } catch { /* offline */ }
    }, 120);
    return () => clearTimeout(t);
  }, [prepStatsUid, priv, phase]);
  const liveStats = (() => {
    if (prepStatsUid != null) {
      const e = unitStats && unitStats.round === pub?.round ? unitStats.units.get(prepStatsUid) : null;
      return e ? { ...e, src: 'prep' } : null;
    }
    // a battle unit's card, or an own board piece's card left open into the battle (its unit found by uid)
    const id = resolved?.unitId;
    const pieceUid = id == null && Number.isInteger(resolved?.piece?.uid) ? resolved.piece.uid : null;
    if ((id == null && pieceUid == null) || !cc || !battleRunner || !field?.local || showPrep) return null;
    const fid = field.fieldId;
    return () => {
      const uid = id ?? battleRunner.unitIdOf(pieceUid, myId, fid);
      const e = uid != null ? battleRunner.unitStats(uid, fid) : null;
      return e ? { ...e, src: 'battle' } : null;
    };
  })();

  // ---- keyboard ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = async (e) => {
      const act = shortcutFor(e);
      const L = live.current;
      // dialogs / the guide own the keyboard; behind the 本局信息 / 敌方情报 drawer only Esc (closing it) acts
      if (shortcutBlocked(act, { modal: !!document.querySelector('.modal, .guide'), drawer: !!L.drawer })) return;
      if (act === 'escape') {
        if (L.emoteOpen) setEmoteOpen(false);
        else if (L.pen && !L.detail) togglePenRef.current(false);
        else if (L.bondOpen) setBondOpen(null);
        else if (L.detail) setDetail(null);
        else if (L.drawer) setDrawer(null);
        else return;
        e.preventDefault();
        return;
      }
      // Space pauses / resumes a solo battle (the official battle key)
      if (act === 'ready' && (L.canPause || L.paused)) {
        e.preventDefault();
        if (e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur();
        togglePauseRef.current(!L.paused);
        return;
      }
      if (L.pub?.phase !== PHASE.PREP || !L.priv) return;
      e.preventDefault(); // a focused HUD button must not also activate (Space) — see shortcutFor
      if (act === 'ready' && e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) e.target.blur();
      if (act === 'ready') {
        const refused = !L.priv.ready ? shopBlockReason('ready', { priv: L.priv, editable: true }) : null;
        // the temp overflow row blocks it: say why (the button shows it too — user playtest #3 item 3)
        if (refused) { audio.sfx('error', { volume: 0.5 }); toast(tempReadyReason(L.priv) || refused, 'warn'); return; }
        toggleReady(!L.priv.ready);
        return;
      }
      if (!L.editable) return;
      const reason = shopBlockReason(act, { priv: L.priv, editable: L.editable });
      if (reason) { audio.sfx('error', { volume: 0.5 }); return; }
      if (act === 'refresh') actions.refresh();
      else if (act === 'freeze') actions.freeze();
      else if (act === 'levelUp') actions.levelUp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- render ---------------------------------------------------------------------------------------------------
  const readyCount = players.filter((p) => p.ready || p.status === 'ready').length;
  const aliveCount = players.filter((p) => p.alive !== false && p.status !== 'left').length;
  // the own battle is over: the server says so (status done) or — client-side combat — the local simulation just ended
  const localDone = cc && !!battleState && battleState.own && !battleState.watch && battleState.done && battleState.fieldId === ownFieldId(myId);
  // (client-side combat: only in 各自行动 — 联防 observers just watch the 联防 field, research 09 §3.1)
  const myDone = combat && (cc ? phase === PHASE.COMBAT && (meP?.status === 'done' || localDone) : meP?.status === 'done');
  live.current.localDone = localDone;
  // the solo pause button: only while the own battle still runs (the server refuses it afterwards)
  const canPause = pauseAvailable(pub, { solo, alive, done: meP?.status === 'done' || localDone });
  live.current.canPause = canPause;
  // client-side combat: observing a teammate's battle (research 09 §3.1) and the 联防 / 最终攻势 camera halves
  // (an eliminated player auto-observes a teammate's normal field — research 09 "keep-watching" — without asking)
  const watchedFid = watchingOther ? watching : (cc && combat && !alive && battleState && battleState.watch && battleState.kind === 'normal' ? battleState.fieldId : null);
  // the ‹ › pill: on the 联防 / 最终攻势 field on screen — also one watched with 前往查看 (a leaker, an eliminated spectator)
  const layers = cc && combat && field && field.local && (!watchingOther || field.fieldId === watching) ? cameraLayers(field, pub, myId) : [];
  const progress = cc && phase === PHASE.COMBAT ? teammateProgress(pub, myId) : null;
  // the bond strip follows the player on screen (DESIGN §20.15, ui/watchBonds.js): a teammate's board / battle (前往查看,
  // an eliminated player's auto-observed field) → their bonds; a 联防 / 最终攻势 field → the player on the ‹ › half (全景:
  // yours when you fight there, else the teammate picked with 前往查看 / the field's first player); in battle with the
  // live layers of the battle on screen (the runner's bondLayers)
  const settleMode = mode === 'settle';
  const strip = screenStrip({
    pub, priv, myId, combat, settle: settleMode, watchingOther, watching, home,
    battleFieldId: cc ? (battleState?.fieldId || null) : (combat || settleMode ? lastFieldRef.current : null),
    field, layers, layer, who: watchWho, bondLayers: battleState?.bondLayers || null,
  });
  const stripFid = strip.fieldId;
  const liveLayers = (combat || settleMode) && battleState?.bondLayers ? battleState.bondLayers : null;
  // the observing pill names the player whose bonds the strip shows (the same teammate as the strip's "👁 name" tag)
  const observingName = cc && combat && watchedFid ? (!strip.self && stripFid === watchedFid ? strip.name : (players.find((p) => p.fieldId === watchedFid || ownFieldId(p.playerId) === watchedFid)?.name || '队友')) : null;
  const watchedP = watchingOther ? (players.find((p) => p.playerId !== myId && (watching === ownFieldId(p.playerId) || (watching === p.fieldId && String(watching).startsWith('n:')))) || null) : null;
  const watchedName = watchingOther ? (watchedP?.name || players.find((p) => watching === p.fieldId)?.name || '队友') : null;
  const stripBonds = strip.bonds;
  // a popup opened from the strip closes when the strip changes hands (another teammate scouted / a ‹ › half / back to
  // the own bonds); one opened from a card's chip keeps its unit owner (it carries its own player either way)
  const stripOwnerRef = useRef(strip.ownerId);
  useEffect(() => {
    if (stripOwnerRef.current === strip.ownerId) return;
    stripOwnerRef.current = strip.ownerId;
    setBondOpen((b) => (b && b.from === 'strip' ? null : b));
  }, [strip.ownerId]);
  // the popup shows the player it was opened for (ui/watchBonds.js popupView): their entry + live layers, their name,
  // and as members your pieces or their operators on the field on screen — under client-side combat the battle's own
  // (the runner's field meta is taken before they deploy); their hand is never sent
  const popOps = cc && battleRunner && field?.local && bondOpen && bondOpen.ownerId !== myId ? battleRunner.ownerOps(bondOpen.ownerId, field.fieldId) : null;
  const bondPop = popupView({ open: bondOpen, pub, priv, myId, field, units: popOps, live: liveLayers });
  const openBond = (id, ownerId, from) => { setBondOpen((b) => toggleBond(b, id, ownerId, from)); audio.sfx('click', { volume: 0.4 }); };
  const watchingNow = combat ? (watching || field?.fieldId || home) : watching;
  const shopOpen = showShop && !collapsed;
  const ufShown = !!(selEntry && editable && !facing && !drag && showPrep && ufGeo);
  // the temp overflow row holds pieces (user playtest #3 item 3): framed and labelled on the own prep board
  const temp = tempInfo(priv);
  const tempNotice = temp.count > 0 && !!view && viewKind !== 'loading' && showPrep && alive && !pen && !sp;
  // the ready button shows why it is refused under it (ui/hud.js ReadyToggle): the effects column moves down a line
  const readyWhy = phase === PHASE.PREP && alive && !priv?.ready && temp.count > 0;
  // the frame the panels are laid out in: the HUD layer (client px; inside the safe-area insets of a notched phone),
  // and the root font size (1rem)
  const panelFrame = () => {
    let rem = 100;
    try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
    let b = null;
    try { b = hudElRef.current?.getBoundingClientRect() || null; } catch { b = null; }
    const vp = b && b.width > 0 && b.height > 0 ? { left: b.left, top: b.top, width: b.width, height: b.height }
      : { left: 0, top: 0, width: globalThis.innerWidth || 1920, height: globalThis.innerHeight || 1080 };
    return { rem, vp };
  };
  const dSide = (() => {
    if (ufShown) {
      const { rem, vp } = panelFrame();
      return panelSide(underframeRect(ufGeo, rem), panelSlots(vp, rem, { shopOpen }));
    }
    if (mergeGeo && resolved) {
      const { rem, vp } = panelFrame();
      const half = (mergeGeo.s > 0 ? mergeGeo.s : 64) * 1.05; // the tile diamond's box (underframeRect's)
      return panelSide({ left: mergeGeo.x - half, right: mergeGeo.x + half, top: mergeGeo.y - half, bottom: mergeGeo.y + half }, panelSlots(vp, rem, { shopOpen }));
    }
    return 'left';
  })();
  // the bond popup: next to the card, never over the selected unit's underframe when a place is free (bondPopupPlace)
  const bpPlace = (() => {
    if (!bondOpen) return 'left';
    const { rem, vp } = panelFrame();
    return bondPopupPlace(ufShown ? underframeRect(ufGeo, rem) : null, vp, rem, resolved ? dSide : null);
  })();
  // the player's own operators (and the shop / bond member cards) show the loadout's skill / module (DESIGN §16);
  // a teammate's unit (前往查看 in prep, 联防 / 最终攻势 fields, an observed battle) shows ITS owner's choice, carried by
  // the unit (UnitInfo skillIndex / moduleId: the sim's, or Match.prepFieldMeta's) — never the viewer's loadout
  const detailLoadout = (() => {
    if (!resolved || resolved.type !== 'chess') return null;
    if (detailTarget?.kind === 'unit') {
      const u = detailTarget.unit;
      const owner = u?.ownerId;
      if (resolved.piece || (owner != null && owner === myId)) return priv?.loadout ?? null;
      return unitLoadout(resolved.chess, u);
    }
    return priv?.loadout ?? null; // own pieces, shop / reward / bond-member cards
  })();
  // the card's bond chips — and the popup a chip opens: a battle / scouted unit's OWNER's bonds (yours, or that
  // teammate's — m.public + live layers), your own piece's yours, a popup member card the popup's player; shop / reward
  // cards read the strip's (ui/watchBonds.js detailBondOwner)
  const detailOwner = detailBondOwner(detailTarget, { pub, myId, stripOwnerId: strip.ownerId });
  const detailBonds = detailOwner === strip.ownerId ? stripBonds : playerBonds({ pub, priv, myId, ownerId: detailOwner, live: liveLayers });
  // bonds this mode never activates (标准: 10 of 23, 奥术 among them) — shown 本局禁用 on cards, chips and the popup
  const offBonds = modeOffBonds(getMode(pub?.modeId));

  return html`<div class=${cx('screen', 'gm', `gm--${mode}`, drag && 'is-dragging', collapsed && 'is-collapsed', sp && 'has-sp', pen && 'is-pen', readyWhy && 'has-readywhy')}
      data-camera=${pen ? 'pen' : camKind}>
    <div class="gm__field" ref=${hostRef} onContextMenu=${(e) => e.preventDefault()}></div>
    ${viewKind === 'loading' ? html`<div class="gm__loading"><${Spinner} label="LOADING FIELD" /></div>` : null}
    <div class="gm__vignette" aria-hidden="true"></div>
    ${tempNotice ? html`<${TempRowNotice} view=${view} count=${temp.count} items=${temp.items} label=${!drag && !facing}
      ready=${phase === PHASE.PREP && !!priv?.ready} />` : null}

    <div class="gm__hud" ref=${hudElRef}>
      <${TopBar} pub=${pub} priv=${priv} conn=${conn} hud=${hud} total=${total} drawer=${drawer}
        onExit=${() => setExitOpen(true)} onDrawer=${(t) => setDrawer((d) => (d ? null : t))} onReady=${toggleReady}
        readyBusy=${readyBusy} readyCount=${readyCount} playerCount=${solo ? 1 : aliveCount}
        pen=${pen} penAvail=${penAvail} onPen=${togglePen} config=${gd.config} frozenAt=${frozenAt}
        pause=${canPause || paused ? { show: canPause, paused, busy: pauseBusy, onToggle: () => togglePause(!paused) } : null}
        live=${liveLpNow} spectator=${spectator} />

      <div class="gm__bonds">
        <${BondStrip} bonds=${stripBonds} layersDisabled=${layersDisabled} openId=${bondPop && bondPop.ownerId === strip.ownerId ? bondPop.bondId : null}
          owner=${strip.name} onOpen=${(id) => openBond(id, strip.ownerId, 'strip')} />
      </div>

      <${TeamPanel} pub=${pub} myId=${myId} watching=${watchingNow} bubbles=${bubbles} onWatch=${watchPlayer} cap=${gd.config?.lpCapPerRound ?? 10} uniteLocal=${uniteLocal}
        self=${Number.isFinite(priv?.lp) ? { lp: priv.lp, pending: liveLpNow.pending, unite: liveLpNow.unite, left: liveLpNow.left } : null}
        observe=${cc ? { canObserve: (p) => observeTarget(p, pub, myId, { observing: watchingOther, ownDone: localDone }), observing: watchingOther, onBack: backHome } : null} />

      <div class="gm__effects"><${EffectsList} effects=${priv?.effects} /></div>

      ${watchingOther && !combat ? html`<div class="gm__watching" role="status">
        <${GIcon} name="eye" /><span>正在查看 <b>${watchedName}</b> 的阵地（只读）</span>
        ${spectator ? null : html`<${Button} size="sm" variant="primary" icon="back" onClick=${() => watchPlayer({ playerId: myId })}>返回自己<//>`}
      </div>` : null}

      ${showShop ? html`<${ShopBar} priv=${priv} editable=${editable} collapsed=${collapsed} onCollapse=${setCollapsed}
        barRef=${barRef} offBonds=${offBonds}
        onBuy=${buy} onLevel=${() => actions.levelUp()} onRefresh=${() => actions.refresh()} onFreeze=${() => actions.freeze()}
        onDetail=${(id, kind, hint) => setDetail({ kind: kind === 'item' ? 'item' : 'chess', id, hint: hint || null })}
        onDetailClose=${() => setDetail((d) => (d?.kind === 'chess' || d?.kind === 'item' ? null : d))}
        onRefuse=${(reason) => { toast(reason, 'warn'); audio.sfx('error', { volume: 0.5 }); }}
        reward=${phase === PHASE.PREP && !rewardMin ? priv?.shop?.rewardOffer || null : null}
        onReward=${(i) => actions.reward(i)} onRewardLater=${() => setRewardMin(true)} onArm=${setArmedCard} />` : null}

      ${phase === PHASE.PREP && priv?.shop?.rewardOffer ? html`<${RewardOverlay} priv=${priv} minimized=${rewardMin || collapsed}
        onMinimize=${(m) => { setRewardMin(m); if (!m) setCollapsed(false); }} />` : null}

      ${combat || mode === 'settle' ? html`<${CombatHud} pub=${pub} myId=${myId} watching=${watchingNow} hud=${hud} myDone=${!!myDone && alive}
        spectating=${!alive} spectator=${spectator} onWatch=${watchField}
        client=${cc ? { progress, observing: observingName ? { name: observingName } : null, onBack: alive ? backHome : null, layers, layer, onLayer: setLayer } : null} />` : null}

      ${showDeadPill(alive, phase) ? (spectator
        ? html`<div class="gm__dead gm__dead--spectator" role="status"><${GIcon} name="eye" />观战中 · 点击左侧成员头像切换查看</div>`
        : html`<div class="gm__dead" role="status"><${Icon} name="close" />你已被淘汰 · 可继续观战队友</div>`) : null}

      <${Ticker} />

      <div class="gm__corner">
        ${spectator ? null : html`<${EmoteWheel} open=${emoteOpen} onToggle=${setEmoteOpen} onSend=${(id) => actions.emote(id)} disabled=${conn.status !== 'online'} />`}
        <button type="button" class="gm__gear" aria-label="设置" title="设置" onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
        <button type="button" class="gm__gear gm__guide" aria-label="玩法说明" title="玩法说明" onClick=${() => openGuide(0)}><${Icon} name="book" /></button>
        <${FullscreenButton} class="gm__gear gm__fs" />
      </div>

      ${drawer ? html`<${EnemyDrawer} tab=${drawer} onTab=${setDrawer} pub=${pub} priv=${priv} onClose=${() => setDrawer(null)}
        onEnemy=${(k, n) => setDetail({ kind: 'enemy', id: k, count: n })} onChess=${(id) => setDetail({ kind: 'chess', id })} />` : null}

      ${bondPop ? html`<${BondPopup} bondId=${bondPop.bondId} entry=${bondPop.entry} priv=${bondPop.priv} banned=${pub?.bannedChess || []} owner=${bondPop.name}
        off=${offBonds.has(bondPop.bondId)}
        place=${bpPlace} over=${!!resolved && bpPlace === dSide}
        onClose=${() => setBondOpen(null)} onMember=${(id, items) => setDetail({ kind: 'chess', id, owner: bondPop.ownerId, items: items || null })} />` : null}

      ${resolved ? html`<${DetailPanel} detail=${resolved} snapHp=${snapHp} onClose=${() => { setDetail(null); setSel(null); }}
        bonds=${detailBonds} offBonds=${offBonds} loadout=${detailLoadout} side=${dSide} shopOpen=${shopOpen} live=${liveStats}
        onBond=${(id) => openBond(id, detailOwner, 'detail')} />` : null}

      ${selEntry && editable && !facing && !drag && showPrep ? html`<${Underframe} key=${sel.uid} view=${view} uid=${sel.uid}
        row=${pieceTile(selEntry)?.row} col=${pieceTile(selEntry)?.col} actions=${underframeActions(placeCtx, sel.uid)} busy=${selBusy}
        name=${(selEntry.piece.kind === 'item' ? gd.item(selEntry.piece.id) : selEntry.piece.kind === 'token' ? gd.token(selEntry.piece.id) : gd.chess(selEntry.piece.id))?.name || ''}
        onRetreat=${retreatSel} onSell=${sellSel} onDestroy=${sellSel} />` : null}
    </div>

    ${sp ? html`<${ChoiceOverlay} pub=${pub} sp=${sp} myId=${myId} solo=${solo} busyIdx=${spBusy} total=${total}
      onPick=${async (i) => { setSpBusy(i); await actions.choice(i); setSpBusy(null); }} />` : null}

    ${banner ? html`<${PhaseBanner} key=${banner.key} mode="overlay" title=${banner.title} sub=${banner.sub} micro=${banner.micro}
      tone=${banner.tone} duration=${banner.duration || 1500} onDone=${() => setBanner(null)} />` : null}

    ${facing && view ? html`<${FacingWheel} key=${`${facing.uid}:${facing.row},${facing.col}`} view=${view} row=${facing.row} col=${facing.col}
      grid=${facing.grid} name=${facing.name} onPreview=${previewFacing} onCommit=${commitFacing} onCancel=${cancelFacing} />` : null}

    ${paused ? html`<${PausedOverlay} canResume=${solo} busy=${pauseBusy} onResume=${() => togglePause(false)} onExit=${() => setExitOpen(true)} />` : null}

    ${replace ? html`<${EquipReplaceDialog} request=${replace.request} getItem=${gd.item}
      onConfirm=${(uid) => closeReplace(uid)} onCancel=${() => closeReplace(null)} />` : null}

    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />
    <${ExitModal} open=${exitOpen} onClose=${() => setExitOpen(false)} solo=${solo} />
  </div>`;
}

