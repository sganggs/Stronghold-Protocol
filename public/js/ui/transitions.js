// 转场 helpers (PR #643): small hooks for the one-off motion of the room and the pre-game screens. With
// prefers-reduced-motion nothing plays.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { reducedMotion } from './device.js';

/**
 * True for `ms` after `value` turns truthy — not on the first render, so a seat already ready when the room opens (or a
 * pick already made when the draft opens) does not flash; never with reduced motion. screens/room.js (a seat turns
 * ready), screens/bandDraft.js (a pick lands on an order row).
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
