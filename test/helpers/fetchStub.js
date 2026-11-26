// test/helpers/fetchStub.js — a shared globalThis.fetch stub for the data/theme tests.
//
//   const stub = stubFetch(read);   // read(url) -> body | response-like | null
//   ... await something that fetches ...
//   stub.restore();
//
// `read` returns a plain JSON body (served as 200 with `json()`), a response-like object (`ok` or `json` or
// `text`), or null/undefined (404). This is the one shape the shop-docs, shop-marks and theme-revalidate stubs
// used to implement three times.
export function stubFetch(read) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    const result = await read(value);
    if (result == null) return { ok: false, status: 404, json: async () => null, text: async () => '' };
    if (typeof result === 'object' && ('ok' in result || 'json' in result || 'text' in result)) return result;
    return { ok: true, status: 200, json: async () => result };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
