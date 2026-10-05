// Network-address validation shared by the client and local remote-probe endpoint.
export function isLoopbackHost(host = globalThis.location?.hostname) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h.includes(':')) {
    try { h = new URL(`http://[${h}]/`).hostname.slice(1, -1); } catch { return false; }
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '::' || h === '0.0.0.0') return true;
  if (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(h) && h.split('.').every(part => Number(part) <= 255)) return true;
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  return !!mapped && (parseInt(mapped[1], 16) >>> 8) === 0x7f;
}

export function normalizeRemoteUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value || /[\s\u0000-\u001f\u007f\\<>"'`]/u.test(value)) return null;
  const explicit = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  let url;
  try { url = new URL(explicit ? value : `http://${value}`); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isLoopbackHost(url.hostname)) return null;
  if (url.port === '0') return null;
  const host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[')) return url.toString(); // URL already validates the IPv6 literal.
  if (/^[\d.]+$/.test(host)) {
    // Reject shorthand, hexadecimal and octal IPv4 forms that URL silently rewrites.
    const authority = value.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    if (authority.split(':')[0] !== host) return null;
    return url.toString();
  }
  const labels = host.split('.');
  if (labels.length < 2 || host.length > 253 || !labels.every(part => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part))) return null;
  if (!/^(?:[a-z]{2,63}|xn--[a-z\d-]+)$/i.test(labels.at(-1))) return null;
  return url.toString();
}
