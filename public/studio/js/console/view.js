import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { data, useData } from '../../../js/data.js';
import { useLang } from '../../../js/ui/lang.js';
import { createAssets } from '../../../js/assets.js';
import { createFieldView } from '../../../js/render/app.js';
import { loadBrowserSim } from '../../../js/battle/runner.js';
import { t } from '../../../../shared/i18n.js';
import { SPEEDS } from '../../../../shared/studio/scenario.js';
import { makeRunner, makeLog, observeCombat, observeEffects, inspectUnit, pauseIfHidden } from './runtime.js';
import { Select } from './editor.js';

const hooks = { ready: false, runner: null, view: null, compiled: null, errors: [] };
globalThis.__console = hooks;
let simPromise;
export function ConsoleView({ compiled, valid, onTile, onSelect, onReroll }) {
  useLang();
  useData('chess', 'tokens', 'enemies', 'assets', 'stages');
  const host = useRef(null), state = useRef(null), callback = useRef({ onTile, onSelect });
  callback.current = { onTile, onSelect };
  const [ready, setReady] = useState(false), [failed, setFailed] = useState('');
  const [revision, refresh] = useState(0), [reset, setReset] = useState(0);
  const [board, setBoard] = useState('3d'), [fx, setFx] = useState('lite'), [ranges, setRanges] = useState(true);
  const [selected, setSelected] = useState(null), [speed, setSpeed] = useState(1);
  const viewSettings = useRef({ board, fx, ranges }); viewSettings.current = { board, fx, ranges };
  useEffect(() => {
    if (!compiled) return;
    let alive = true, view, raf = 0, onHide = null, unobserve = () => {}, uncombat = () => {};
    const controller = new AbortController();
    setReady(false); setFailed(''); hooks.ready = false;
    (async () => {
      const sim = await (simPromise ||= loadBrowserSim().catch(e => { simPromise = null; throw e; }));
      if (!alive) return;
      const b = sim.spec.createBattleFromSpec(compiled.spec, sim.ds, { quiet: true });
      // An empty exercise remains available for deployment/skill inspection until the runner's cap.
      if (!compiled.spec.spawns.length) b.autoFinish = false;
      const combat = makeLog(), effects = makeLog();
      uncombat = observeCombat(b, combat);
      const assets = createAssets(); assets.seed(data.getRaw('assets'));
      view = await createFieldView(host.current, { data, assets, signal: controller.signal, playbackTime: () => b.time,
        settings: { quality: 'high', damageNumbers: true, officialFx: viewSettings.current.fx } });
      if (!alive) { view.destroy(); return; }
      await view.setBoardMode(viewSettings.current.board);
      if (!alive) return;
      view.setStage(data.lookupRaw('stages', compiled.spec.stageId));
      view.enterBattle(b.fieldMeta()); view.setCamera(compiled.spec.kind, { rect: compiled.spec.rect, instant: true });
      view.setLocalFeed({ on: true, speed: 1 });
      // The sandbox displays the exact tick selected (no network interpolation/extrapolation).
      view.debug.interp.update = () => view.debug.interp.snapToNewest();
      unobserve = observeEffects(view, effects, () => b.time);
      const runner = makeRunner(b, { cap: compiled.cap, preview: true, onFrame: (snap, ev) => {
        view.pushEvents({ t: 'b.ev', fieldId: snap.fieldId, gt: snap.t, ev });
        view.pushSnapshot({ ...snap, t: 'b.snap', gt: snap.t });
      } });
      runner.speedTo(speed);
      // Placement stays open until the user plays or steps. The preview clock is already past 0.
      view.on('tileClick', tile => { if (!runner.touched) callback.current.onTile(tile); });
      if (!alive) return;
      // requestAnimationFrame does not run while the tab is hidden, so pause here.
      onHide = () => { pauseIfHidden(runner, document.hidden); if (document.hidden) refresh(v => v + 1); };
      document.addEventListener('visibilitychange', onHide);
      view.on('pieceClick', hit => { setSelected(hit.unitId); callback.current.onSelect(hit.uid); });
      state.current = { runner, view, combat, effects };
      Object.assign(hooks, { ready: true, runner, view, compiled, combat, effects }); setReady(true);
      let previous = performance.now(), lastPaint = 0;
      const frame = now => {
        if (!alive) return;
        // Background tabs pause instead of accumulating work; resume is explicit.
        if (document.hidden) runner.pause(); else runner.advance((now - previous) / 1000);
        previous = now;
        if (now - lastPaint > 100) { refresh(v => v + 1); lastPaint = now; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch(e => { if (alive) { setFailed(String(e?.message || e)); hooks.errors.push(String(e)); } });
    return () => {
      alive = false; controller.abort(); cancelAnimationFrame(raf);
      if (onHide) document.removeEventListener('visibilitychange', onHide);
      state.current?.runner.pause(); unobserve(); uncombat(); view?.destroy(); state.current = null;
      Object.assign(hooks, { ready: false, runner: null, view: null, combat: null, effects: null });
    };
  }, [compiled, reset]);
  useEffect(() => { state.current?.view.setBoardMode(board).catch(e => setFailed(String(e))); }, [board]);
  useEffect(() => { state.current?.view.setSettings({ officialFx: fx }); }, [fx]);
  useEffect(() => { state.current?.runner.speedTo(speed); }, [speed]);
  useEffect(() => { if (!valid) state.current?.runner.pause(); }, [valid]);
  const st = state.current, b = st?.runner.battle;
  const u = b?.units.find(v => v.id === selected), detail = inspectUnit(u);
  useEffect(() => { st?.view.highlightTiles(ranges && u ? (u.rangeKeys || []).map(k => [Math.floor(k / 21), k % 21]) : [], 'range'); }, [revision, selected, ranges]);
  const action = fn => { fn(st.runner); refresh(v => v + 1); };
  return html`<section class="sc-live" data-testid="console-live">
    <div class="sc-toolbar">
      <button type="button" disabled=${!ready || !valid || b?.finished} onClick=${() => action(r => r.playing ? r.pause() : r.play())} data-testid="console-play">${st?.runner.playing ? t('暂停') : t('开始')}</button>
      <button type="button" disabled=${!ready || !valid || b?.finished} onClick=${() => action(r => r.step(1))} data-testid="console-tick">${t('步进一帧')}</button>
      <button type="button" disabled=${!ready || !valid || b?.finished} onClick=${() => action(r => r.step(30))} data-testid="console-second">${t('步进一秒')}</button>
      <button type="button" disabled=${!ready || !valid} onClick=${() => setReset(v => v + 1)}>${t('同种子重启')}</button>
      <button type="button" onClick=${onReroll}>${t('重掷种子')}</button>
      <${Select} label=${t('速度')} value=${speed} options=${SPEEDS.map(v => [v, `${v}×`])} onChange=${v => setSpeed(+v)} />
      <${Select} label=${t('画面')} value=${board} options=${[['3d', '3D'], ['2d', '2D']]} onChange=${setBoard} />
      <${Select} label=${t('官方特效')} value=${fx} options=${[['off', t('关闭')], ['lite', t('精简')], ['full', t('完整')]]} onChange=${setFx} />
      <label><input type="checkbox" checked=${ranges} onChange=${e => setRanges(e.currentTarget.checked)} />${t('显示所选单位范围')}</label>
    </div>
    <div class="sc-canvas" ref=${host} data-testid="console-canvas" data-ready=${ready} />
    ${failed ? html`<p role="alert">${t('画面载入失败：{detail}', { detail: failed })}</p>` : !ready ? html`<p>${t('正在载入游戏画面…')}</p>` : null}
    <p role="status">${t('时间 {time} 秒 · 击杀 {kills} / {total}', { time: (b?.time || 0).toFixed(3), kills: b?.killed || 0, total: b?.total || 0 })} ${b?.finished ? t('已结束') : ''}</p>
    ${ready ? html`<p>${t('实际渲染：{board} · 官方特效：{fx}', { board: st.view.stats().board3d?.on ? '3D' : '2D', fx: st.view.stats().officialFx?.tier || 'off' })}</p>` : null}
    <details open><summary>${t('单位检查器')}</summary>
      <${Select} label=${t('选择单位')} value=${selected ?? ''} options=${[['', t('无')], ...(b?.units || []).map(v => [v.id, `${v.id} · ${data.localeName(v.name || v.defId)}`])]} onChange=${v => setSelected(v ? +v : null)} />
      ${detail ? html`<pre data-testid="console-inspector">${JSON.stringify(detail, null, 2)}</pre>` : html`<p>${t('点击场上单位查看属性、增益与技力。')}</p>`}
    </details>
    <div class="sc-logs"><details open><summary>${t('伤害 / 治疗日志')}</summary><pre data-testid="console-combat-log">${(st?.combat.entries || []).slice(-100).map(e => `${e.time.toFixed(3)} ${e.key === 'heal' ? t('治疗') : t('伤害')} ${data.localeName(e.source)} → ${data.localeName(e.target)} ${e.amount.toFixed(2)}`).join('\n')}</pre></details>
      <details open><summary>${t('特效日志（本视图）')}</summary><p>${t('official 为实际加载的特效实例；procedural 为程序特效调用。仅保留最近 300 条。')}</p><pre data-testid="console-effect-log">${[...(st?.effects.counts || [])].map(([key, n]) => `${key} ×${n}`).join('\n')}</pre><pre>${(st?.effects.entries || []).slice(-40).map(e => `${e.time.toFixed(3)} ${e.key}`).join('\n')}</pre></details></div>
    ${b?.errors?.length ? html`<pre role="alert">${JSON.stringify(b.errors, null, 2)}</pre>` : null}
  </section>`;
}
