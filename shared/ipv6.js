// shared/ipv6.js — the ONE rule for "which IPv6 address is worth handing to a friend".
//
// It is shared on purpose: the server prints the URLs to share on boot (server/index.js `lanUrls`) and the tools
// list the same addresses (tools/doctor.mjs `classifyAddresses`, used by `npm run doctor` and scripts/launch.mjs).
// Two copies of this rule drift apart, and a wrong entry in that list is exactly what the review caught: a Teredo
// address looks like a public one but is a tunnel nobody can reach.
//
// The kinds follow from the bits of the address alone; an interface NAME (Tailscale, vEthernet, …) is a separate,
// caller-side concern:
//   'linklocal' fe80::/10      needs a zone id (%12 / %eth0) that a URL cannot carry
//   'ula'       fc00::/7       the IPv6 RFC 1918 — fine to hand out on the LAN
//   'teredo'    2001:0::/32    a Teredo tunnel
//   'doc'       2001:db8::/32  the documentation range
//   '6to4'      2002::/16      a deprecated 6to4 tunnel
//   'global'    2000::/3       global unicast — the usual way in from the internet
//   'other'     anything else (multicast, ::, IPv4-mapped, junk)
//
// Whether those addresses can be handed out at all also depends on the BIND — `bindsIpv6` at the bottom: with the
// default `0.0.0.0` nothing listens on IPv6, so the share lists (boot banner, doctor, launcher) leave them out.

/**
 * The first two hextets of an IPv6 literal (a zone id is dropped); null when it is not one.
 * A compressed form is fine: `2001:db8::1` → [0x2001, 0x0db8], `2001::1` → [0x2001, 0].
 * @param {unknown} ip
 * @returns {[number, number] | null}
 */
export function ipv6Head(ip) {
  const raw = typeof ip === 'string' ? ip.split('%')[0] : '';
  if (!raw.includes(':')) return null;
  const [a = '', b = ''] = raw.split(':');
  const h1 = parseInt(a, 16);
  if (!Number.isInteger(h1) || h1 > 0xffff) return null;
  const h2 = parseInt(b, 16);
  return [h1, Number.isInteger(h2) && h2 <= 0xffff ? h2 : 0];
}

/**
 * @param {unknown} ip
 * @returns {'linklocal' | 'ula' | 'teredo' | 'doc' | '6to4' | 'global' | 'other'}
 */
export function ipv6Kind(ip) {
  const head = ipv6Head(ip);
  if (!head) return 'other';
  const [h1, h2] = head;
  if ((h1 & 0xffc0) === 0xfe80) return 'linklocal';
  if ((h1 & 0xfe00) === 0xfc00) return 'ula';
  if (h1 !== 0x2001 && h1 !== 0x2002) return (h1 & 0xe000) === 0x2000 ? 'global' : 'other';
  if (h1 === 0x2002) return '6to4';
  if (h2 === 0x0db8) return 'doc';
  if (h2 === 0) return 'teredo';
  return 'global';
}

/**
 * Is this an address to hand to a friend — a ULA on the LAN, or a global unicast one? Everything else (link-local,
 * Teredo, 6to4, the documentation range, junk) is left out of the share list.
 * @param {unknown} ip
 */
export function isShareableIpv6(ip) {
  const kind = ipv6Kind(ip);
  return kind === 'ula' || kind === 'global';
}

/**
 * Whether a bind host makes this machine reachable over IPv6 at all — only `::` does (the dual-stack bind,
 * server/index.js `DUAL_STACK_HOST`); the default `0.0.0.0` is IPv4-only. A share list built under a V4-only bind must
 * therefore leave every IPv6 address out: the address is real, but nothing is listening on it, so a friend who opens
 * that URL just waits for a timeout — the review of #188 caught the boot banner, doctor and the launcher all offering
 * those URLs anyway.
 * @param {unknown} host a resolved bind host
 */
export const bindsIpv6 = (host) => host === '::';
