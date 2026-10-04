// randomBytes / randomInt for both Node and the browser P2P host.
// Node keeps crypto.randomBytes. The browser uses Web Crypto, so this module never imports
// `node:` when it is evaluated in a page (a `node:` import is not a reliable browser specifier).

const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;

/** @type {(size: number) => { toString: (enc?: string) => string }} */
export let randomBytes;
/** @type {(min: number, max?: number) => number} */
export let randomInt;

if (IS_NODE) {
  const nodeCrypto = await import('node:crypto');
  randomBytes = nodeCrypto.randomBytes;
  randomInt = nodeCrypto.randomInt;
} else {
  const web = globalThis.crypto;
  randomBytes = (size) => {
    const u8 = new Uint8Array(Number(size) || 0);
    web.getRandomValues(u8);
    return {
      toString(enc) {
        if (enc === 'hex') {
          let s = '';
          for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
          return s;
        }
        return String(u8);
      },
    };
  };
  randomInt = (min, max) => {
    if (max === undefined) { max = min; min = 0; }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new RangeError('invalid randomInt range');
    const span = max - min;
    const buf = new Uint32Array(1);
    if (span <= 0x100000000) {
      const limit = Math.floor(0x100000000 / span) * span;
      let x;
      do { web.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return min + (x % span);
    }
    web.getRandomValues(buf);
    return min + (buf[0] % span);
  };
}
