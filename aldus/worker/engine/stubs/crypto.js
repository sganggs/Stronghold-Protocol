// node:crypto for the engine bundle: server/net.js imports it, and the bundle takes only sanitizeName from that file.
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  bytes.toString = (enc) => (enc === 'hex' ? hex(bytes) : String.fromCharCode(...bytes));
  return bytes;
}
export function randomInt(a, b) {
  const [lo, hi] = b === undefined ? [0, a] : [a, b];
  return lo + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (hi - lo));
}
export default { randomBytes, randomInt };
