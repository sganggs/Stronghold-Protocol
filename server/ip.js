// isIP for both Node and the browser P2P host. The browser path never imports `node:`.

const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;

/** @type {(input: unknown) => 0 | 4 | 6} */
export let isIP;

if (IS_NODE) {
  ({ isIP } = await import('node:net'));
} else {
  isIP = (input) => {
    if (typeof input !== 'string') return 0;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input)) {
      return input.split('.').every((p) => p === String(Number(p)) && Number(p) <= 255) ? 4 : 0;
    }
    if (input.includes(':') && /^[0-9a-fA-F:.]+$/.test(input)) return 6;
    return 0;
  };
}
