// Sandbox-only adapter, injected explicitly with developmentFrames: installDevelopmentFrames.
// Never replace SnapshotBuffer.prototype or the clock/feed of any other renderer instance.
import { fxForm } from '../../shared/protocol.js';
import { frameTime } from '../js/render/interp.js';
import { FORMS } from '../js/render/units.js';

export function installDevelopmentFrames(view, { canPresent, processEvents, syncBattle }) {
  const { interp, views } = view.debug;
  const update = interp.update.bind(interp);
  const enterBattle = view.enterBattle.bind(view), pushSnapshot = view.pushSnapshot.bind(view);
  let time = null;
  interp.update = (now) => time ?? update(now);
  view.enterBattle = (meta) => {
    const accepted = enterBattle(meta);
    if (accepted) time = null;
    return accepted;
  };
  view.pushSnapshot = (snap) => {
    const accepted = pushSnapshot(snap);
    if (accepted) time = null;
    return accepted;
  };
  view.presentLocalFrame = (snap, ev = []) => {
    const t = frameTime(snap);
    if (!Number.isFinite(t) || !Array.isArray(ev) || !canPresent(snap)) return false;
    interp.reset();
    if (!pushSnapshot(snap)) return false;
    const closing = [];
    const events = ev.map((e) => {
      const form = fxForm(e);
      if (form === undefined) return e;
      const v = views.get(e[4].id), forms = v && FORMS[v.info.spine || v.info.defId];
      const prev = forms?.[v?.form], next = forms?.[form];
      if (prev?.next === form && prev.end) closing.push({ v, roles: next?.roles, clip: prev.end });
      return next?.end ? [...e.slice(0, 4), { ...e[4], dur: 0 }] : e;
    });
    view.pushEvents({ fieldId: snap.fieldId, gt: t, ev: events });
    interp.renderT = time = t;
    processEvents(t);
    syncBattle(t);
    for (const { v, roles, clip } of closing) v.actor?.setForm(roles, clip);
    return true;
  };
}
