// node:net for the engine bundle: server/net.js imports isIP for its per-network limits, which the Worker does not use.
export const isIP = () => 0;
export default { isIP };
