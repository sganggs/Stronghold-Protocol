// OfficialFx.update intentionally caps one frame at 0.25 s. Author-controlled stepping must retain the whole delta.
export function advanceEffectClock(effects, seconds) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) { effects.update(0); return; }
  while (seconds > 0.25) { effects.update(0.25); seconds -= 0.25; }
  effects.update(seconds);
}
