// 转场 (2026-10-13, the owner's request: the event's screen changes, video 5:22–6:29 — the old screen fades to black,
// the new one comes up from black with its panels sliding in one after another; overlays leave the same way). The
// keyframes live in css/screens/lobby.css (tr-*); these hooks only keep a view mounted while its leaving animation plays.
// With prefers-reduced-motion nothing waits.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { reducedMotion } from './device.js';

/** How long a full-screen overlay takes to leave (its content fades, then the black lifts off what is below). */
export const LEAVE_MS = 300;

/**
 * [leaving, leave]: leave() marks the view as leaving (class is-leaving fades it out) and calls `done` once that has
 * played; a second call while leaving is ignored.
 * @param {() => void} done @param {number} [ms]
 */
export function useLeave(done, ms = LEAVE_MS) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => () => clearTimeout(timer.current), []);
  const leave = () => {
    if (timer.current) return;
    if (reducedMotion()) { doneRef.current(); return; }
    setLeaving(true);
    timer.current = setTimeout(() => doneRef.current(), ms);
  };
  return [leaving, leave];
}

/** Resolves once a leaving animation of `ms` has played (at once with reduced motion). @param {number} [ms] */
export function afterLeave(ms = LEAVE_MS) {
  return new Promise((resolve) => { setTimeout(resolve, reducedMotion() ? 0 : ms); });
}

/**
 * Keeps a view mounted for `ms` after `show` turns false so its leaving animation can play: [mounted, leaving].
 * @param {boolean} show @param {number} [ms]
 */
export function usePresence(show, ms = 220) {
  const [kept, setKept] = useState(!!show);
  useEffect(() => {
    if (show) { setKept(true); return undefined; }
    if (!kept) return undefined;
    if (reducedMotion()) { setKept(false); return undefined; }
    const id = setTimeout(() => setKept(false), ms);
    return () => clearTimeout(id);
  }, [!!show]);
  return [!!show || kept, !show && kept];
}

/**
 * True for `ms` after `value` turns truthy — not on the first render (a seat that is already ready when the room
 * opens does not flash).
 * @param {any} value @param {number} [ms]
 */
export function useRise(value, ms = 700) {
  const prev = useRef(!!value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = !!value;
    if (!value) { setOn(false); return undefined; }
    if (was || reducedMotion()) return undefined;
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [!!value]);
  return on;
}
