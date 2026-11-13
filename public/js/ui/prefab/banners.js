// 规程 banners drawn from the active official pack (乌萨斯齐心团, 可露希尔; §37.145): the round start (round_start: 回合
// NN rolling over, 获得 +N, the 剩余 N 回合 tag), the round result (round_result: 全员无伤！ / 作战结束 / 生命值减少 −N),
// the 联防 plate (help_battle) and 轮到你选 (effect_choose_self_select). Each plays its own clips (ui/prefab/player.js):
// round_start its in clip, then its out clip when it leaves; the others one clip that comes in, holds and goes. The
// layout is the pose at the clip's peak (the end of an in clip, the middle of an in-hold-out one); the clip then runs
// from its start with its own fades. Still (设置「主题动画」 off, reduced motion): the peak pose for the same time.
// 可露希尔's window shows the theme's UI Spine where the prefab has its SkeletonGraphic ([ASSUMED] idle, as in the
// funds card; the prefab's spine view loads it at run time and names no clip).

import { useEffect, useMemo, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../components.js';
import { t } from '../../../../shared/i18n.js';
import { PrefabView } from './view.js';
import { scriptRef } from './layout.js';

/** Official units → rem at the official size (ui/prefab/hud.js OFFICIAL_SCALE; not imported: no cycle). */
const SCALE = 1.44;

/** A controller's clip field (`_showAnim`, `_inAnim` …) under the prefab: { clip, on } or null. */
export function scriptAnim(prefab, field) {
  let hit = null;
  (function walk(n) {
    if (hit || !n) return;
    for (const s of n.scripts || []) {
      const a = s?.anims?.[field];
      if (a?.clip) { hit = { clip: a.clip, on: Number.isInteger(a.on) ? a.on : null }; return; }
    }
    for (const c of n.children || []) walk(c);
  })(prefab);
  return hit;
}

/**
 * Where a clip peaks: its end when it ends shown (an in clip), else its middle (it comes in, holds, goes: the top-level
 * fades end at 0).
 * @param {any} clip
 */
export function clipPeak(clip) {
  const len = Number(clip?.len) || 0;
  const ends = [];
  for (const [path, prop, keys] of clip?.curves || []) {
    if (prop !== 'alpha' || String(path).split('/').length > 2 || !Array.isArray(keys) || !keys.length) continue;
    ends.push(Number(keys[keys.length - 1][1]));
  }
  const fadesOut = ends.length > 0 && ends.every((v) => v <= 0.01);
  return fadesOut ? len / 2 : len;
}

/** Two-digit round number (matchPopups.js roundDigits). @param {number} n */
const digits = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/**
 * One banner: laid out at its show clip's peak, played once, then `onDone` after the clip (or after `holdMs` and the out
 * clip, for an in / out pair: the out clip starts after `holdMs`).
 * @param {{ pack: any, prefab: any, show: { clip: string, on: number|null } | null, out?: { clip: string, on: number|null } | null,
 *   texts?: Map<number, string|null>|null, active?: Map<number, boolean>|null, textFor?: ((node: any) => string|null)|null,
 *   leave?: boolean, outMs?: number, onDone?: (() => void)|null, still?: boolean, label?: string, testid?: string, spine?: any,
 *   hide?: string[]|null }} props
 *   leave: an in / out pair plays its out clip, fitted into outMs (the plate's fold: the official out clip runs faster
 *   when it is longer — [ASSUMED] so the round start still leaves inside 回合开始's 2 s); the parent then unmounts it.
 *   An in-hold-out clip calls onDone at its end. hide: node names drawn inactive.
 */
export function PrefabBanner({ pack, prefab, show, out = null, texts = null, active = null, textFor = null, leave = false,
  outMs = 280, onDone = null, still = false, label = '', testid = undefined, spine = null, hide = null }) {
  const clips = pack?.doc?.clips || {};
  const clip = show ? clips[show.clip] : null;
  const peak = clip ? clipPeak(clip) : 0;
  const len = Number(clip?.len) || 0;
  const outLen = out && clips[out.clip] ? Number(clips[out.clip].len) || 0 : 0;
  const [phase, setPhase] = useState(/** @type {'in'|'out'} */ ('in'));
  const done = useRef(onDone);
  done.current = onDone;
  // an in-hold-out clip ends the banner by itself; an in / out pair holds, then plays its out clip
  useEffect(() => {
    if (out) return undefined;
    const id = setTimeout(() => done.current?.(), Math.max(400, len * 1000));
    return () => clearTimeout(id);
  }, [show?.clip]);
  useEffect(() => { if (out && leave) setPhase('out'); }, [leave]);
  const poses = useMemo(() => (show ? [{ on: show.on, clip: show.clip, at: peak }] : null), [show?.clip, show?.on, peak]);
  const play = useMemo(() => {
    if (phase === 'out' && out) return [{ clip: out.clip, on: out.on, rate: outLen * 1000 > outMs ? (outLen * 1000) / outMs : 1 }];
    return show ? [{ clip: show.clip, on: show.on }] : null;
  }, [phase, show?.clip, out?.clip]);
  if (!pack || !prefab || !clip) return null;
  return html`<div class="mpop mpop--pf" role="status" aria-live="polite" aria-label=${label || undefined} data-testid=${testid}>
    <${PrefabView} pack=${pack} prefab=${prefab} poses=${poses} texts=${texts} active=${active} textFor=${textFor} hide=${hide}
      play=${play} playKey=${phase} scale=${SCALE} still=${still} className="pf--banner" spine=${spine} />
  </div>`;
}

/** Words of the banners' texts that have no controller (their official text ids → ours). */
function bannerText(node, extra = {}) {
  const id = node?.text?.textId || '';
  if (id.endsWith('BATTLE_ROUND')) return t('回合');
  if (id.endsWith('ROUND_GAIN')) return t('获得');
  if (id.endsWith('ROUND_END')) return t('作战结束');
  if (id.endsWith('ROUND_END_PERFECT')) return t('全员无伤！');
  if (id.endsWith('ROUND_END_LOST')) return t('生命值减少');
  if (id.endsWith('HELP_BATTLE')) return extra.help ?? t('联防');
  if (id.endsWith('SELF_CHOOSE_BANNER_TIP')) return t('当前轮到你决策');
  return null;
}

/**
 * The round start: the round rolls from the last one, 获得 +N (not for an eliminated player or a spectator seat), the
 * 剩余 N 回合 tag when the final assault is three rounds or fewer away.
 * @param {{ pack: any, round: number, gain?: number|null, left?: number|null, watching?: boolean, leave?: boolean, outMs?: number,
 *   still?: boolean, spine?: any }} props  leave / outMs: ui/matchPopups.js RoundPopup's fold (it unmounts the banner)
 */
export function RegRoundStart({ pack, round, gain = null, left = null, watching = false, leave = false, outMs = 280, still = false, spine = null }) {
  const prefab = pack?.doc?.prefabs?.['banner/round_start'];
  const binds = useMemo(() => {
    if (!prefab) return null;
    const texts = new Map();
    const active = new Map();
    const put = (field, v) => { const id = scriptRef(prefab, field); if (Number.isInteger(id)) texts.set(id, v); };
    put('_roundText', digits(round));
    put('_roundBeforeText', digits(round - 1));
    const n = !watching && Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
    // the row draws its own plus (round_plus / img_sources_plus) before the number
    put('_goldCountText', n ? String(n) : '');
    put('_roundTipText', left ? t('剩余 {n} 回合', { n: left }) : '');
    const tip = scriptRef(prefab, '_roundTipGrp');
    if (Number.isInteger(tip)) active.set(tip, !!left);
    return { texts, active, show: scriptAnim(prefab, '_inAnim'), out: scriptAnim(prefab, '_outAnim') };
  }, [prefab, round, gain, left, watching]);
  const textFor = useMemo(() => (node) => bannerText(node), []);
  if (!binds?.show) return null;
  return html`<${PrefabBanner} pack=${pack} prefab=${prefab} show=${binds.show} out=${binds.out} texts=${binds.texts} active=${binds.active}
    textFor=${textFor} leave=${leave} outMs=${outMs} still=${still} label=${t('第 {r} 回合', { r: round })} testid="round-popup" spine=${spine}
    hide=${watching ? WATCH_HIDE : null} />`;
}

/** A watcher gets no income: the 获得 cell goes (GitHub #236 / #237, as on the plate without the pack). */
const WATCH_HIDE = Object.freeze(['panel_sources']);

/**
 * The round result: `perfect` (全员无伤！, panel_perfect), `miss` (生命值减少 −N), `done` (作战结束 alone: a 联防 leaked
 * but the viewer paid nothing) — the round_result controller's three clips.
 * @param {{ pack: any, kind: 'perfect'|'miss'|'done', loss?: number|null, onDone?: (() => void)|null, still?: boolean, spine?: any }} props
 */
export function RegRoundResult({ pack, kind, loss = null, onDone = null, still = false, spine = null }) {
  const prefab = pack?.doc?.prefabs?.['banner/round_result'];
  const binds = useMemo(() => {
    if (!prefab) return null;
    const texts = new Map();
    const active = new Map();
    const perfect = scriptRef(prefab, '_perfectGrp');
    const miss = scriptRef(prefab, '_missGrp');
    if (Number.isInteger(perfect)) active.set(perfect, kind === 'perfect');
    if (Number.isInteger(miss)) active.set(miss, kind !== 'perfect');
    const lost = scriptRef(prefab, '_lostHpText');
    if (Number.isInteger(lost)) texts.set(lost, kind === 'miss' && Number.isFinite(loss) ? `-${Math.trunc(Number(loss))}` : '');
    const show = scriptAnim(prefab, kind === 'perfect' ? '_allPerfectAnim' : kind === 'miss' ? '_missAnim' : '_perfectAnim');
    return { texts, active, show };
  }, [prefab, kind, loss]);
  const textFor = useMemo(() => (node) => bannerText(node), []);
  if (!binds?.show) return null;
  const label = kind === 'perfect' ? `${t('作战结束')} ${t('全员无伤！')}` : kind === 'miss' ? `${t('作战结束')} ${t('生命值减少 −{n}', { n: loss ?? 0 })}` : t('作战结束');
  return html`<${PrefabBanner} pack=${pack} prefab=${prefab} show=${binds.show} texts=${binds.texts} active=${binds.active}
    textFor=${textFor} onDone=${onDone} still=${still} label=${label} testid="result-dialog" spine=${spine} />`;
}

/**
 * The 联防 plate. `title` is the phase banner's words (the same as the plate without the pack).
 * @param {{ pack: any, title?: string|null, onDone?: (() => void)|null, still?: boolean, spine?: any }} props
 */
export function RegHelpBattle({ pack, title = null, onDone = null, still = false, spine = null }) {
  const prefab = pack?.doc?.prefabs?.['banner/help_battle'];
  const show = useMemo(() => (prefab ? scriptAnim(prefab, '_showAnim') : null), [prefab]);
  const textFor = useMemo(() => (node) => bannerText(node, { help: title || undefined }), [title]);
  if (!show) return null;
  return html`<${PrefabBanner} pack=${pack} prefab=${prefab} show=${show} textFor=${textFor} onDone=${onDone} still=${still}
    label=${title || t('联防')} testid="phase-popup" spine=${spine} />`;
}

/**
 * 轮到你选: the 机变 pick reached this seat.
 * @param {{ pack: any, onDone?: (() => void)|null, still?: boolean, spine?: any }} props
 */
export function RegYourTurn({ pack, onDone = null, still = false, spine = null }) {
  const prefab = pack?.doc?.prefabs?.['banner/effect_choose_self_select'];
  const binds = useMemo(() => {
    if (!prefab) return null;
    const texts = new Map();
    const title = scriptRef(prefab, '_title');
    if (Number.isInteger(title)) texts.set(title, t('当前轮到你决策'));
    return { texts, show: scriptAnim(prefab, '_showAnim') };
  }, [prefab]);
  const textFor = useMemo(() => (node) => bannerText(node), []);
  if (!binds?.show) return null;
  return html`<${PrefabBanner} pack=${pack} prefab=${prefab} show=${binds.show} texts=${binds.texts} textFor=${textFor}
    onDone=${onDone} still=${still} label=${t('当前轮到你决策')} testid="your-turn-banner" spine=${spine} />`;
}

/** Which banners a pack draws. @param {any} pack */
export function packBanners(pack) {
  const p = pack?.doc?.prefabs || {};
  return {
    roundStart: !!p['banner/round_start'], roundResult: !!p['banner/round_result'],
    helpBattle: !!p['banner/help_battle'], yourTurn: !!p['banner/effect_choose_self_select'],
  };
}
