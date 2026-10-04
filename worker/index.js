// One Worker: static site (env.ASSETS) plus the WebRTC handshake at /signal.
// The match itself stays in the browser. Hub is the Durable Object from signaling/.

export { Hub } from '../signaling/src/index.js';

export default {
  /**
   * @param {Request} request
   * @param {{ HUB: DurableObjectNamespace, ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/signal') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('stronghold signaling', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      const id = env.HUB.idFromName('hub');
      return env.HUB.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
