// Keep the accepting server independent of the simultaneous client-construction loop.
import { startServer } from '../../server/index.js';
import { createPeer } from '../../server/rooms/peer.js';

let srv;
createPeer(process, {
  async init({ exitOnRoomFailure, ...opts }) {
    srv = await startServer({ ...opts, ...(exitOnRoomFailure ? { roomFailure: () => { process.exitCode = 1; process.disconnect(); } } : {}) });
    return { port: srv.port };
  },
  stats() { return { connections: srv.network.connectionCount, children: srv.roomSupervisor?.slots.length ?? 0, health: srv.roomSupervisor?.health() }; },
  crash() { for (const slot of srv.roomSupervisor.slots) slot.child.kill('SIGKILL'); return true; },
  async stop() { await srv?.close(); return true; },
});
process.on('disconnect', async () => { await srv?.close(); process.exit(process.exitCode || 0); });
