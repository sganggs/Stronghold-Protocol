// Playback consumes the game's real m.field, b.snap and b.ev shapes; no browser re-simulation or script execution.
import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { data } from '../../../js/data.js';
import { createAssets } from '../../../js/assets.js';
import { createFieldView } from '../../../js/render/app.js';
import { t } from '../../../../shared/i18n.js';

export function TrialReplay({ replay, playing, speed, reset, board = '3d', effects = 'lite' }) {
  const host = useRef(null);
  const playback = useRef({ playing, speed });
  playback.current = { playing, speed };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true, view = null, raf = 0, renderTime = 0;
    setFailed(false);
    host.current.dataset.ready = 'false';
    (async () => {
      const assets = createAssets();
      assets.seed(replay.fxAssets ? { ...data.getRaw('assets'), fx: replay.fxAssets } : data.getRaw('assets'));
      const source = { get: file => file === 'stages' ? { ...data.get('stages'), [replay.field.stageId]: replay.stage }
        : file === 'backups' && replay.renderRecords ? { ...data.get('backups'), units: { ...data.get('backups')?.units, ...replay.renderRecords.backups.units } }
          : replay.renderRecords?.[file] ? { ...data.get(file), ...replay.renderRecords[file] } : data.get(file),
        lookup: (file, id) => file === 'stages' && id === replay.field.stageId ? replay.stage : replay.renderRecords?.[file]?.[id] || data.lookup(file, id) };
      view = await createFieldView(host.current, { data: source, assets, playbackTime: () => renderTime, settings: { quality: 'high', damageNumbers: true, officialFx: effects } });
      if (!alive) { view.destroy(); return; }
      await view.setBoardMode(board);
      if (!alive) { view.destroy(); return; }
      view.setStage(replay.stage);
      view.enterBattle(replay.field);
      view.setCamera(replay.field.kind, { rect: replay.field.rect, instant: true });
      view.setLocalFeed({ on: true, speed: 1 });
      // Same exact-snapshot clock as the standalone test console: pause freezes sprites and official particles.
      view.debug.interp.update = () => view.debug.interp.snapToNewest();
      let time = 0, index = 0, previous = performance.now();
      const frame = now => {
        if (!alive) return;
        const controls = playback.current;
        if (controls.playing) time += Math.min((now - previous) / 1000, 0.2) * controls.speed;
        previous = now;
        while (index < replay.frames.length && replay.frames[index].snap.t <= time) { // loop-cap: recorded replay.frames length
          const f = replay.frames[index++];
          renderTime = f.snap.t;
          view.pushEvents({ t: 'b.ev', fieldId: replay.field.fieldId, gt: f.snap.t, ev: f.ev });
          view.pushSnapshot({ ...f.snap, t: 'b.snap', gt: f.snap.t });
        }
        raf = requestAnimationFrame(frame);
      };
      host.current.dataset.ready = 'true';
      raf = requestAnimationFrame(frame);
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; cancelAnimationFrame(raf); view?.destroy(); };
  }, [replay, reset, board, effects]);
  return html`<div><div ref=${host} class="st-trial-canvas" data-testid="trial-replay" />${failed ? html`<p class="st-error">${t('游戏画面没有载入（需要 WebGL）。图片和声音的预览不受影响。')}</p>` : null}</div>`;
}
