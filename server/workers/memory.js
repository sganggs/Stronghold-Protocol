/** RSS covers the whole Node process; these heap/external counters belong to the reporting thread. */
export function memorySample() {
  const { heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  return { sampledAt: Date.now(), heapUsed, heapTotal, external, arrayBuffers };
}
