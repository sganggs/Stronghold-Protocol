// Local/remote entry helpers shared by the title screen and tests.

import { normalizeRemoteUrl } from '../../shared/connect.js';
export { isLoopbackHost, normalizeRemoteUrl } from '../../shared/connect.js';

export async function probeRemoteGame(url, { fetchFn = globalThis.fetch, timeoutMs = 9000 } = {}) {
  url = normalizeRemoteUrl(url);
  if (!url) return { reachable: false, valid: false, blocked: false, reason: 'invalid-url' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(`/connect/probe?url=${encodeURIComponent(url)}`, {
      cache: 'no-store', signal: controller?.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { reachable: false, valid: false, blocked: false, reason: body.reason || `HTTP ${response.status}` };
    return body;
  } catch (error) {
    const timeout = error?.name === 'AbortError' || /aborted|timeout/i.test(String(error?.message || ''));
    return { reachable: false, valid: false, blocked: true, reason: timeout ? 'timeout' : String(error?.message || 'network error') };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function androidBridge() {
  return typeof window !== 'undefined' ? window.SP_BRIDGE || null : null;
}
