// 规程 HUD pieces drawn from the active official theme pack (乌萨斯齐心团, 可露希尔; ac_n_initial keeps the hand-made
// HUD of PR #643 / #827): the top bar (group_hud), the countdown (panel_countdown) and the ready button
// (panel_prep_ready). The values go where the client's own controllers put them, found by their field names in
// prefabs.json (`_roundText`, `_playerHpText`, `_enemyCurCountText`, `_bossHpSlider`, `_textCountDown`, …), and each
// state is the prefab's status driver entry (hud_rest_settled …, countdown / cd_color_last / content_timer …) or the
// ready button's own switch clip, drawn at the end of its clips (ui/prefab/anim.js applyStatuses).

import { useMemo, useRef } from '../../../vendor/hooks.module.js';
import { html, useTicker, secondsLeft } from '../components.js';
import { t } from '../../../../shared/i18n.js';
import { PHASE } from '../../../../shared/constants.js';
import { isCombatPhase, isBossPhase, prepCapsuleLabel, bossFrac } from '../gameLogic.js';
import { PrefabView, buildPose } from './view.js';
import { scriptRef, layoutPrefab } from './layout.js';

/** Official units → our rem at the official size (the client draws its ~1334-unit canvas 1.44× at 16:9). */
export const OFFICIAL_SCALE = 1.44;

/** @param {any} root @param {string} field */
const ref = (root, field) => scriptRef(root, field);

/**
 * The top bar's mid-screen status for a phase: hud_boss_settled (final assault / hidden core), hud_coop (联防: the
 * prefabs have no settled variant), hud_battle_settled (other combat, and settling with a kill count), else
 * hud_rest_settled.
 * @param {string|undefined} phase @param {any} hud
 */
export function hudStatus(phase, hud) {
  if (isBossPhase(phase)) return 'hud_boss_settled';
  if (phase === PHASE.UNITE) return 'hud_coop';
  if (isCombatPhase(phase) || (phase === PHASE.SETTLE && hud?.total != null)) return 'hud_battle_settled';
  return 'hud_rest_settled';
}

/**
 * Text, slider and visibility bindings of group_hud (pure; ids are prefabs.json node ids).
 * @param {any} prefab
 * @param {{ phase?: string, round: string, lp: number|null, pending: number, hud: any, miss: number|null, boss: any }} v
 */
export function hudBinds(prefab, v) {
  /** @type {Map<number, string|null>} */
  const texts = new Map();
  /** @type {Map<number, number>} */
  const alpha = new Map();
  /** @type {Map<number, boolean>} */
  const active = new Map();
  /** @type {Map<number, number>} */
  const sliders = new Map();
  const put = (id, text) => { if (Number.isInteger(id)) texts.set(id, text); };
  put(ref(prefab, '_roundText'), v.round);
  put(ref(prefab, '_playerHpText'), v.lp == null ? '--' : String(v.lp));
  const lostGrp = ref(prefab, '_loseHpGrp');
  if (Number.isInteger(lostGrp)) alpha.set(lostGrp, v.pending > 0 ? 1 : 0);
  put(ref(prefab, '_lostHpText'), v.pending > 0 ? `-${v.pending}` : '');
  const killed = String(v.hud?.resolved ?? v.hud?.killed ?? 0);
  const total = v.hud?.total != null ? String(v.hud.total) : '--';
  // the battle, 联防 and boss panels each have their own controller with the same field names
  for (const key of ['_normalPanel', '_helpPanel', '_bossPanel']) {
    const panelId = ref(prefab, key);
    const panel = panelId != null ? findId(prefab, panelId) : null;
    if (!panel) continue;
    put(ref(panel, '_enemyCurCountText'), killed);
    put(ref(panel, '_enemyTotalCountText'), total);
    const miss = ref(panel, '_lostEnemyGrp');
    if (Number.isInteger(miss)) active.set(miss, v.miss != null && key === '_helpPanel');
    put(ref(panel, '_lostEnemyText'), v.miss != null ? String(v.miss) : '');
    const slider = ref(panel, '_bossHpSlider');
    if (Number.isInteger(slider)) {
      const frac = bossFrac(v.boss);
      sliders.set(slider, frac == null ? 1 : frac);
    }
  }
  return { texts, alpha, active, sliders };
}

/** @param {any} root @param {number} id */
function findId(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const hit = findId(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Texts that have no controller: the round title, the stage words, the n/m splitter. textId → our words. */
function staticText(node, phase) {
  const id = node?.text?.textId || '';
  if (id.endsWith('HUD_ROUND_TEXT')) return t('回合');
  if (id.endsWith('HUD_REST_STAGE_TIP')) return prepCapsuleLabel(phase);
  if (id.endsWith('HUD_BATTLE_STAGE_TIP')) return t('开始作战');
  if (id.endsWith('HUD_HELP_STAGE_TIP')) return t('联防开始');
  if (id.endsWith('PREP_READY')) return t('准备就绪');
  if (id.endsWith('PREP_CANCEL_READY')) return t('取消准备');
  if (node?.name === 'text_split' || node?.name === 'text_splitter') return '/';
  return null;
}

/**
 * The top bar band drawn from group_hud.
 * @param {{ pack: any, phase?: string, round: string, lp: number|null, pending: number, hud: any, miss: number|null, boss: any, still?: boolean }} props
 */
export function RegHudBand({ pack, phase, round, lp, pending, hud, miss, boss, still = false }) {
  const prefab = pack?.doc?.prefabs?.group_hud;
  // the settled status on the first drawing (no transition when the HUD appears or a player reconnects); after the first
  // change, the plain one, whose trans_* clip plays as the mid screen switches (ui/prefab/view.js)
  const settled = hudStatus(phase, hud);
  const first = useRef(/** @type {string|null} */ (null));
  const moved = useRef(false);
  if (first.current == null) first.current = settled;
  else if (settled !== first.current) moved.current = true;
  const status = moved.current ? settled.replace(/_settled$/, '') : settled;
  const key = `${round}|${lp}|${pending}|${hud?.resolved ?? hud?.killed}|${hud?.total}|${miss}|${bossFrac(boss)}`;
  const binds = useMemo(() => (prefab ? hudBinds(prefab, { phase, round, lp, pending, hud, miss, boss }) : null), [prefab, key]);
  const textFor = useMemo(() => (node) => staticText(node, phase), [phase]);
  if (!prefab || !binds) return null;
  return html`<${PrefabView} pack=${pack} prefab=${prefab} status=${[status]} texts=${binds.texts} alpha=${binds.alpha}
    active=${binds.active} sliders=${binds.sliders} textFor=${textFor} scale=${OFFICIAL_SCALE} className="pf--hud" still=${still} />`;
}

/**
 * Countdown statuses: the timer or the 「continue」 picture once the own seat is ready ([ASSUMED] what ready_continue
 * is for), the last-seconds colour from warnAt, the timer or the single picture (no time limit: the solo rest).
 * @param {{ remain: number|null, ready: boolean, warnAt?: number }} v
 */
export function countdownStatus({ remain, ready, warnAt = 10 }) {
  return [
    ready ? 'ready_continue' : 'countdown',
    remain != null && remain <= warnAt && remain > 0 ? 'cd_color_last' : 'cd_color_normal',
    remain == null ? 'content_single_plain' : 'content_timer',
  ];
}

/**
 * @param {{ pack: any, remain: number|null, total?: number|null, ready?: boolean, still?: boolean, warnAt?: number, prefabKey?: string }} props
 *   prefabKey: panel_countdown (the top right), or panel_countdown_effect_choose (乌萨斯齐心团's 机变 pick)
 */
export function RegCountdown({ pack, remain, total = null, ready = false, still = false, warnAt = 10, prefabKey = 'panel_countdown' }) {
  const prefab = pack?.doc?.prefabs?.[prefabKey];
  const frac = remain != null && Number.isFinite(total) && total > 0 ? Math.max(0, Math.min(1, remain / total)) : 1;
  const binds = useMemo(() => {
    if (!prefab) return null;
    const texts = new Map();
    const sliders = new Map();
    const fills = new Map();
    const active = new Map();
    const text = ref(prefab, '_textCountDown');
    if (Number.isInteger(text)) texts.set(text, remain == null ? '' : String(Math.min(99, Math.max(0, remain))).padStart(2, '0'));
    const bar = ref(prefab, '_progressBar');
    if (Number.isInteger(bar)) sliders.set(bar, frac);
    for (const n of prefab.scripts || []) for (const id of (Array.isArray(n?.refs?._progressImgsFill) ? n.refs._progressImgsFill : [])) fills.set(id, frac);
    return { texts, sliders, fills, active };
  }, [prefab, remain, frac]);
  if (!prefab || !binds) return null;
  // [ASSUMED] root_sp's hand is a tutorial pointer: the theme previews never show it
  return html`<${PrefabView} pack=${pack} prefab=${prefab} status=${countdownStatus({ remain, ready, warnAt })} texts=${binds.texts}
    sliders=${binds.sliders} fills=${binds.fills} active=${binds.active} hide=${CD_HIDE} scale=${OFFICIAL_SCALE} className="pf--cd" still=${still} />`;
}

const CD_HIDE = Object.freeze(['root_sp']);

/**
 * The ready button's picture: btn_ready_switch at its end when ready (取消准备), at its start when not (准备就绪).
 * The player list under it stays hidden (its rows are another prefab).
 * @param {{ pack: any, ready: boolean, still?: boolean }} props
 */
export function RegReadyFace({ pack, ready, still = false }) {
  const prefab = pack?.doc?.prefabs?.panel_prep_ready;
  const binds = useMemo(() => {
    if (!prefab) return null;
    const active = new Map();
    const player = ref(prefab, '_panelPlayer');
    if (Number.isInteger(player)) active.set(player, false);
    let on = null;
    for (const s of prefab.scripts || []) if (s?.anims?._animationLocation?.on != null) on = s.anims._animationLocation.on;
    return { active, on };
  }, [prefab]);
  const textFor = useMemo(() => (node) => staticText(node, null), []);
  if (!prefab || !binds) return null;
  return html`<${PrefabView} pack=${pack} prefab=${prefab} active=${binds.active} textFor=${textFor}
    poses=${[{ on: binds.on, clip: 'btn_ready_switch', at: ready ? 'end' : 'start' }]} scale=${OFFICIAL_SCALE} className="pf--ready" still=${still} />`;
}

/**
 * Where the ready button sits on the countdown: both prefabs' roots stretch over the same top-right holder in the
 * official HUD ([ASSUMED] one point: it puts 可露希尔's button over the lower TV and 乌萨斯齐心团's under the tubes, as
 * the theme previews show). Rem offset of the ready face's box from the countdown's box, at OFFICIAL_SCALE.
 * @param {any} pack
 * @returns {{ x: string, y: string } | null}
 */
export function cornerOffset(pack) {
  const cd = pack?.doc?.prefabs?.panel_countdown;
  const ready = pack?.doc?.prefabs?.panel_prep_ready;
  if (!cd || !ready) return null;
  const skip = (n) => !!n.fx;
  const a = layoutPrefab(cd, { skip, pose: buildPose(pack, cd, { status: countdownStatus({ remain: 1, ready: false }), hide: CD_HIDE }) }).bounds;
  let on = null;
  for (const s of ready.scripts || []) if (s?.anims?._animationLocation?.on != null) on = s.anims._animationLocation.on;
  const b = layoutPrefab(ready, { skip, pose: buildPose(pack, ready, { poses: [{ on, clip: 'btn_ready_switch', at: 'start' }] }) }).bounds;
  const rem = (u) => `${Number(((u * OFFICIAL_SCALE) / 100).toFixed(4))}rem`;
  return { x: rem(b.left - a.left), y: rem(b.top - a.top) };
}

/**
 * A countdown that follows a server deadline by itself (the 机变 pick's): ticks every second.
 * @param {{ pack: any, deadline?: number|null, total?: number|null, still?: boolean, prefabKey?: string }} props
 */
export function RegDeadlineCountdown({ pack, deadline = null, total = null, still = false, prefabKey = 'panel_countdown' }) {
  const remain = secondsLeft(deadline);
  useTicker(remain != null && remain > 0 ? 1000 : 0);
  if (remain == null) return null;
  return html`<div class="pfclock" role="timer" aria-label=${t('剩余{remain}秒', { remain })}>
    <${RegCountdown} pack=${pack} remain=${remain} total=${total} still=${still} prefabKey=${prefabKey} />
  </div>`;
}

/** Whether a pack draws these pieces. @param {any} pack */
export function packHud(pack) {
  const p = pack?.doc?.prefabs || {};
  return { band: !!p.group_hud, countdown: !!p.panel_countdown, ready: !!p.panel_prep_ready };
}

