import { createPeer } from '../../server/rooms/peer.js';
import { createSimulationPermitClient } from '../../server/rooms/simulationClient.js';
import { configureSimulationSlices } from '../../shared/simulationSlices.js';
import { HeadlessJob } from '../../server/match/fields.js';

// Require an explicit fork mode so bare test discovery never starts an IPC peer.
const peer = process.argv[2] === 'client' && typeof process.send === 'function' && process.connected ? createPeer(process, {
  async run() {
    const client = createSimulationPermitClient({
      acquire: (request) => peer.request('acquire', { request }, 1000),
      cancel: (request) => peer.notify('cancel', { request }),
      begin: (lease) => peer.request('begin', { lease }, 1000),
      release: (lease) => peer.notify('release', { lease }),
    });
    const remove = configureSimulationSlices(() => client.enter()), intervals = [];
    try {
      for (let i = 0; i < 16; i++) {
        const battle = { finished: false, tickCount: 0, time: 0,
          step() {
            const start = Number(process.hrtime.bigint()) / 1e6;
            const until = start + 3;
            while (Number(process.hrtime.bigint()) / 1e6 < until) { /* loop-cap: 3 ms */ }
            intervals.push([start, Number(process.hrtime.bigint()) / 1e6]);
            this.finished = true; this.tickCount++;
          },
          result: () => ({ perPlayer: {}, time: 0 }), forceEnd() { this.finished = true; },
        };
        const job = new HeadlessJob(battle);
        while (!job.run(1)) await new Promise((resolve) => setTimeout(resolve, 1)); // loop-cap: parent request timeout
      }
      await peer.request('done', intervals);
      return true;
    } finally { remove(); client.close(); }
  },
}) : null;
if (peer) process.on('disconnect', () => process.exit(0));
