import { cpus } from 'node:os';

// System-wide CPU use over the observation interval, including other applications.
export function observeHostLoad() {
  const sample = () => cpus().reduce((sum, cpu) => {
    sum.idle += cpu.times.idle;
    sum.total += Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return sum;
  }, { idle: 0, total: 0 });
  const before = sample();
  return () => {
    const after = sample(), total = after.total - before.total;
    return { cpuBusyFraction: total > 0 ? 1 - (after.idle - before.idle) / total : null };
  };
}
