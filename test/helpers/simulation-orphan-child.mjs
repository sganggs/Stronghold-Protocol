import { HeadlessJob } from '../../server/match/fields.js';
import fs from 'node:fs';

// Bare node --test also discovers helpers; only an actual fork has a parent to coordinate with.
const connected = typeof process.send === 'function' && process.connected;
if (connected && process.argv[2] === 'broker') {
  process.send({ ready: true });
  setInterval(() => {}, 1000);
} else if (connected && process.argv[2] === 'executor') {
  process.on('message', (msg) => {
    if (msg?.type !== 'run') return;
    const job = new HeadlessJob({ time: 0, tickCount: 0, finished: false,
      step() {
        process.send({ started: true });
        const until = performance.now() + 10000;
        while (!fs.existsSync(process.argv[3]) && performance.now() < until) { /* loop-cap: ten seconds */ }
        this.finished = true; this.tickCount++;
      },
      result: () => ({ perPlayer: {}, time: 0 }), forceEnd() { this.finished = true; },
    });
    job.run(1); process.exit(0);
  });
  process.send({ ready: true });
}
