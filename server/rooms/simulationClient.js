// Asynchronous acquisition, synchronous slice entry. Denials and transport errors return false to the existing pump.
export function createSimulationPermitClient(authority, { timeoutMs = 1000, idleMs = 1000,
  retryMinMs = 25, retryMaxMs = 200, now = () => performance.now() } = {}) {
  let seq = 0, waiting = null, grant = null, waitTimer = null, idleTimer = null, closed = false;
  let retryAt = 0, retryMs = retryMinMs;
  function backoff() {
    retryAt = now() + retryMs;
    retryMs = Math.min(retryMaxMs, retryMs * 2);
  }
  const safe = (fn, value) => {
    try { Promise.resolve(fn(value)).catch(() => {}); } catch { /* fail closed; the authority owns recovery */ }
  };
  function cancel(request) {
    if (waiting !== request) return;
    waiting = null; clearTimeout(waitTimer);
    backoff();
    safe(authority.cancel, request);
  }
  function discard(value) {
    clearTimeout(value.claimTimer);
    if (grant === value) { grant = null; clearTimeout(idleTimer); backoff(); }
    // A discarded claim never entered a slice. Exact-lease release cannot affect a replacement.
    safe(authority.release, value.lease);
  }
  function claim(value) {
    value.claimTimer = setTimeout(() => { if (grant === value) discard(value); }, timeoutMs);
    value.claimTimer.unref?.();
    Promise.resolve().then(() => authority.begin(value.lease)).then((accepted) => {
      clearTimeout(value.claimTimer);
      if (closed || grant !== value || accepted !== true || now() >= value.expiresAt) { discard(value); return; }
      value.ready = true;
    }).catch(() => discard(value));
  }
  function ask() {
    const request = ++seq;
    waiting = request;
    waitTimer = setTimeout(() => cancel(request), timeoutMs);
    waitTimer.unref?.();
    Promise.resolve().then(() => authority.acquire(request)).then((lease) => {
      if (closed || waiting !== request) { if (lease != null) safe(authority.release, lease); return; }
      waiting = null; clearTimeout(waitTimer);
      if (!Number.isSafeInteger(lease) || lease < 1) { backoff(); return; }
      const value = { lease, ready: false, claimTimer: null, expiresAt: now() + idleMs };
      grant = value;
      idleTimer = setTimeout(() => {
        if (grant === value) discard(value);
      }, idleMs);
      idleTimer.unref?.();
      claim(value);
    }).catch(() => cancel(request));
  }
  return {
    enter() {
      if (closed) return null;
      if (grant && now() >= grant.expiresAt) discard(grant);
      if (grant?.ready) {
        const { lease } = grant; grant = null; clearTimeout(idleTimer);
        retryAt = 0; retryMs = retryMinMs;
        let released = false;
        return () => { if (!released) { released = true; safe(authority.release, lease); } };
      }
      if (grant == null && waiting == null && now() >= retryAt) ask();
      return null;
    },
    close() {
      closed = true;
      if (waiting != null) cancel(waiting);
      if (grant != null) discard(grant);
    },
    stats() { return { waiting: waiting != null, granted: grant?.ready === true, claiming: grant != null && !grant.ready, closed }; },
  };
}

/** A room and its content hosts share their supervisor's broker over the existing room channel. */
export function remoteSimulationAuthority(peer, retire) {
  const notify = (method, value) => peer.notify(method, value).catch(retire);
  return {
    acquire: (executor, pid, request) => peer.request('simAcquire', { executor, pid, request }, 1000),
    cancel: (executor, request) => notify('simCancel', { executor, request }),
    begin: (executor, lease) => peer.request('simBegin', { executor, lease }, 1000),
    release: (executor, lease) => notify('simRelease', { executor, lease }),
    exited: (executor) => notify('simExited', { executor }),
  };
}

/** The Worker message-port adapter has the same interface as a connected child-process IPC channel. */
export function workerPeerChannel(port) {
  return {
    connected: true,
    on: (event, fn) => port.on(event, fn),
    send(value, done) { try { port.postMessage(value); done(); } catch (error) { done(error); } },
  };
}
