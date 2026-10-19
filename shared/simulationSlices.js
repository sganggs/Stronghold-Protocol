// Optional scheduling hook. A battle's steps and results never read the permit state.
let gate = null, depth = 0;

export function configureSimulationSlices(acquire) {
  const previous = gate;
  gate = acquire;
  return () => { if (gate === acquire) gate = previous; };
}

export function runSimulationSlice(run, bounded = true) {
  if (!gate || depth || !bounded) return run();
  let release;
  try { release = gate(); } catch { return false; }
  if (typeof release !== 'function') return false;
  depth++;
  try { return run(); }
  finally { depth--; try { release(); } catch { /* scheduling failures cannot skip the caller's continuation */ } }
}
