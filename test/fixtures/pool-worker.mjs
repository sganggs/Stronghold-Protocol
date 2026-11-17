import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

parentPort?.on('message', ({ id, type, payload }) => {
  if (type === 'crash') process.exit(1);
  if (type === 'hang') { for (;;) {} }
  const until = performance.now() + (payload.ms || 0);
  while (performance.now() < until) {} // intentionally occupy another core
  parentPort.postMessage({ id, value: payload.value });
});
