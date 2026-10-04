// node:url for the engine bundle. The modules that ask for their own path (server/data.js, server/sim/nodeData.js) only
// use it to find the folder `data`; in the bundle every module is "at" /app/server/x/x.js, so that folder is /app/data
// for server/data.js. The fs stub looks at the last two path segments only.
export const fileURLToPath = () => '/app/server/module.js';
export const pathToFileURL = (p) => new URL(`file://${p}`);
export default { fileURLToPath, pathToFileURL };
