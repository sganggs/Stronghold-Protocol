import { getData } from '../../server/data.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { browserScriptSources } from '../../shared/plugins/scriptLoad.js';
import { sha256Hex } from '../../shared/sha256.js';
export const scriptPlugin = (source, execution = 'sandbox') => {
  const manifest = {manifest:2,id:'sandbox-probe',version:'1.0.0',class:'script',permissions:['sim.code','meta.code'],
    entry:{sim:'main.js'},overrides:['chess_char_1_01_a']};
  const p = { id:manifest.id, class:'script', version:manifest.version, execution,
    manifestSource:JSON.stringify(manifest), sources:{'main.js':source} };
  if (execution === 'trusted') p.browserSources = browserScriptSources(p);
  return p;
};
export function scriptSet(source, execution = 'sandbox', data = getData()) {
  const p = scriptPlugin(source, execution);
  const hashInput = {app:'0.3.0-dev',sim:'a'.repeat(64),data:Object.fromEntries(Object.entries(data).map(([k,v]) => [k,sha256Hex(JSON.stringify(v))])),
    plugins:[{id:p.id,version:p.version,files:{'@script':sha256Hex(JSON.stringify(p)), 'plugin.json':sha256Hex(p.manifestSource),'main.js':sha256Hex(source)}}],settings:{}};
  return {...fixtureSet(),data,hashInput,scripts:[p],cs:contentHashOf(hashInput)};
}
/** Load timeout of the tests' node Worker / child hosts. WORKER_LOAD_TIMEOUT_MS (15 s) is the browser's [ASSUMED] cold load; a
 * stalled Windows CI runner once took longer (11-02, where the two bond-timers Worker tests take 1.4-2.9 s in all; history
 * §37.98). The tests check what the host computes, not how fast it loads. */
export const WORKER_LOAD_MS = 60_000;
export const fixtureSet = () => ({ cs: 'a'.repeat(64), data: getData(), bounds: { v: 1, bb: { times: 12 }, fields: {}, bbMin: {}, fieldMin: {}, text: {} } });
export const fixtureSpec = () => ({ v: 1, kind: 'normal', fieldId: 'n:p1', battleId: 'probe', seed: 73,
  stageId: 'act1autochess_m01', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 8,
  players: [{ playerId: 'p1', units: [{ uid: 1, chessId: 'chess_char_1_01_a', row: 10, col: 4 }], bonds: {} }],
  routes: [{ start: [10, 6], end: [10, 0], motion: 'WALK' }], spawns: [{ time: 0, enemyKey: 'enemy_1001_bigbo', count: 3, routeIndex: 0 }] });
export const operatorScript = "import {math,kit} from 'sp:sdk@1'; export default function setup(sp) { sp.kits.register('chess_char_1_01_a', () => ({ skill: { kind: 'passive', mods: { atkPct: math.sin(kit.num(0.7)) } } })); }";
