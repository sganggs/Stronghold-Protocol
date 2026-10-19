// Preload only in room children to delay an ordinary publication independently of admission IPC.
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(new URL('../../server/rooms/entry.js', import.meta.url))) {
  const send = process.send.bind(process);
  let holding = false;
  const held = [];
  process.send = (msg, ...args) => {
    if (!holding || msg?.channel !== 'rooms' || msg.method !== 'update') return send(msg, ...args);
    held.push(args);
    send({ type: 'fixture.roomUpdates', action: 'blocked', value: msg.value });
    return true;
  };
  process.on('message', (msg) => {
    if (msg?.type !== 'fixture.roomUpdates') return;
    holding = msg.hold;
    if (!holding) {
      // Retry from the publisher's latest dirty state instead of delivering an older held snapshot late.
      for (const args of held.splice(0)) args.findLast((arg) => typeof arg === 'function')?.(new Error('delayed publication'));
    }
    send({ type: 'fixture.roomUpdates', action: 'ready', hold: holding });
  });
}
