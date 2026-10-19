// One bounded step exposes the interval between requesting host termination and actual executor exit.
import fs from 'node:fs';
import { HeadlessJob } from '../../../server/match/fields.js';

export class Match {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() { this.disposed = true; clearTimeout(this.timer); }
  handle() {
    const { started, release } = this.opts;
    const battle = { time: 0, tickCount: 0, finished: false,
      step() {
        fs.writeFileSync(started, String(process.pid));
        const until = performance.now() + 10000;
        while (!fs.existsSync(release) && performance.now() < until) { /* loop-cap: ten seconds */ }
        this.tickCount++; this.finished = true;
      },
      result: () => ({ perPlayer: {}, time: 0 }), forceEnd() { this.finished = true; },
    };
    const job = new HeadlessJob(battle);
    const drive = () => { if (!this.disposed && !job.run(1)) this.timer = setTimeout(drive, 1); };
    drive(); return { ok: true };
  }
}
