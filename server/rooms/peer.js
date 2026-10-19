// Bounded request/reply messages on the private parent/child IPC channel.
export function createPeer(channel, handlers = {}, timeoutMs = 15000) {
  let seq = 0, closed = false;
  const pending = new Map();
  const send = (msg) => new Promise((resolve, reject) => {
    if (closed || !channel.connected) { reject(new Error('room process disconnected')); return; }
    try { channel.send(msg, (error) => error ? reject(error) : resolve()); } catch (error) { reject(error); }
  });
  const close = () => {
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('room process disconnected')); }
    pending.clear();
  };
  channel.on('disconnect', close);
  channel.on('message', async (msg) => {
    if (closed || !msg || msg.channel !== 'rooms') return;
    if (msg.reply != null) {
      const p = pending.get(msg.reply);
      if (!p) return;
      pending.delete(msg.reply); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.value);
      return;
    }
    try {
      if (!Object.hasOwn(handlers, msg.method)) throw new Error('unknown room operation');
      const value = await handlers[msg.method](msg.value);
      if (msg.id != null) await send({ channel: 'rooms', reply: msg.id, value });
    } catch (error) {
      if (msg.id != null) await send({ channel: 'rooms', reply: msg.id, error: error.message }).catch(() => {});
    }
  });
  return {
    // One-way lifecycle events bypass the request cap. IPC delivery is ordered; disconnection invalidates the slot.
    notify(method, value) { return send({ channel: 'rooms', method, value }); },
    request(method, value, requestTimeoutMs = timeoutMs, { critical = false } = {}) {
      if (closed || (!critical && pending.size >= 1024)) return Promise.reject(new Error('room IPC unavailable'));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('room IPC timed out')); }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        send({ channel: 'rooms', id, method, value }).catch((error) => {
          clearTimeout(timer); pending.delete(id); reject(error);
        });
      });
    },
    close,
  };
}
