// node:fs for the engine bundle: the game data is in the bundle, not on a disk. server/data.js reads the folder
// `data` and each `*.json` file in it; every other path does not exist (server/sim/nodeData.js then has no fallback).
import { DATA_TEXT } from '../data-text.generated.js';

const noent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' });
const base = (p) => String(p).split('/').pop();
const isDataDir = (p) => /(^|\/)data\/?$/.test(String(p));
const isDataFile = (p) => /(^|\/)data\/[^/]+\.json$/.test(String(p)) && Object.hasOwn(DATA_TEXT, base(p));

export function readdirSync(dir, opts) {
  if (!isDataDir(dir)) throw noent(dir);
  const names = Object.keys(DATA_TEXT).sort();
  return opts && opts.withFileTypes ? names.map((name) => ({ name, isFile: () => true, isDirectory: () => false })) : names;
}
export function readFileSync(file) {
  if (!isDataFile(file)) throw noent(file);
  return DATA_TEXT[base(file)];
}
export const existsSync = (p) => isDataDir(p) || isDataFile(p);
export function statSync(p) { if (!existsSync(p)) throw noent(p); return { isFile: () => isDataFile(p), isDirectory: () => isDataDir(p), size: 0, mtimeMs: 0 }; }
export default { readdirSync, readFileSync, existsSync, statSync };
