// Page side of the asset cache. The service worker asks this tab; this tab asks
// room peers on the asset data channel, or reads bytes it already stored.

import { createAssetSession } from './assetWire.js';

/**
 * @param {import('./sync.js').SimpleP2PSync} sync
 */
export function installAssetBus(sync) {
  const session = createAssetSession({
    async sendTo(peerId, data) {
      const ch = sync.assetChannels.get(peerId);
      if (!ch || ch.readyState !== 'open') return false;
      try {
        if (ch.bufferedAmount > 256 * 1024) {
          ch.bufferedAmountLowThreshold = 64 * 1024;
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 2000);
            ch.addEventListener('bufferedamountlow', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          if (ch.readyState !== 'open') return false;
        }
        ch.send(data);
        return true;
      } catch {
        return false;
      }
    },
    async loadLocal(filePath) {
      const cachesApi = globalThis.caches;
      if (!cachesApi) return null;
      const hit = await cachesApi.match(filePath);
      if (!hit) return null;
      return new Uint8Array(await hit.arrayBuffer());
    },
  });
  sync.onAsset = (peerId, data) => session.onData(peerId, data);

  const sw = globalThis.navigator?.serviceWorker;
  if (sw) {
    sw.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'sp-asset-ask' || !ev.source) return;
      const peers = [];
      for (const [id, ch] of sync.assetChannels) {
        if (ch && ch.readyState === 'open') peers.push(id);
      }
      session.request(msg.path, peers, 10000).then((bytes) => {
        if (bytes) {
          const copy = bytes.slice();
          ev.source.postMessage({ type: 'sp-asset-ans', id: msg.id, buf: copy.buffer }, [copy.buffer]);
        } else {
          ev.source.postMessage({ type: 'sp-asset-miss', id: msg.id });
        }
      }).catch(() => {
        try { ev.source.postMessage({ type: 'sp-asset-miss', id: msg.id }); } catch { /* closing */ }
      });
    });
  }
  return session;
}
