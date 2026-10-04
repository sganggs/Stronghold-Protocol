// aldus/worker/entry.mjs — the module wrangler uploads.
//
// The Worker is the Rust code (build/index.js and its .wasm, made by worker-build). The match engine of the original project
// is JavaScript (engine/engine.bundle.js, made by build-engine.mjs). The engine is 5 MB, so it is not evaluated while
// the Worker starts: the Rust code asks for it on the first request (src/engine.rs), and it then puts its functions on
// globalThis.SP_ENGINE.
globalThis.SP_ENGINE_LOAD = async () => {
  if (!globalThis.SP_ENGINE) await import('./engine/engine.bundle.js');
};

export * from './build/index.js';
export { default } from './build/index.js';
