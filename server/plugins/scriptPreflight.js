// Synchronous C1 registration preflight (DESIGN §32.10); no author imports in the lobby.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { nodeSha256 } from './identity.js';
import { sandboxProcessOptions } from '../match/host/childHost.js';

// [ASSUMED] C1 stays synchronous: one uncached probe — the child's start (the engine, and SES for a sandboxed script) and
// the plugin's setup — may take SCRIPT_PROBE_TIMEOUT_MS before SIGKILL; results (failures too) are kept, 256 per registry,
// so the lobby pauses once per plugin version and settings. 1 s killed honest sandboxed plugins under load (the child
// alone needed more), so the default is 5 s; SP_SCRIPT_PROBE_MS (500–60000) sets it for a slow or a busy server.
const probeEnv = Number.parseInt(process.env.SP_SCRIPT_PROBE_MS ?? '', 10);
export const SCRIPT_PROBE_TIMEOUT_MS = Number.isInteger(probeEnv) && probeEnv >= 500 && probeEnv <= 60000 ? probeEnv : 5000;
const caches = new WeakMap();
const failure = message => ({code:'PLUGIN_SCRIPT_CHECK',message});

export function preflightScripts(registry, scripts, hashInput) {
  const cache = caches.get(registry) ?? new Map();
  caches.set(registry,cache);
  const owners = new Map();
  for (const script of scripts) {
    const part = hashInput.plugins.find(p => p.id === script.id);
    const settings = hashInput.settings[script.id];
    // Lock identity plus the actual descriptor protects CLI tests with an absent/stale lock too.
    // Settings can change computed registration ids, so they must never share a probe result.
    const key = canonicalJson([script.id,script.hash,part.files['@script'],nodeSha256(canonicalJson(settings))]);
    let report = cache.get(key);
    if (!report) {
      const { execArgv = [], ...processOptions } = script.execution === 'sandbox' ? sandboxProcessOptions(128) : {};
      const probe = spawnSync(process.execPath,[...execArgv,fileURLToPath(new URL('./scriptProbe.js',import.meta.url))],{
        ...processOptions,
        input:JSON.stringify({scripts:[script],hashInput:{plugins:[part],settings:{[script.id]:settings}}}),
        encoding:'utf8',timeout:SCRIPT_PROBE_TIMEOUT_MS,killSignal:'SIGKILL',
        maxBuffer:8*1024*1024,stdio:['pipe','ignore','pipe','pipe'],
      });
      // spawnSync waits/reaps the child before returning, including after timeout's SIGKILL.
      // A report written before a later hang is not success: status/error/signal must agree.
      try { report = JSON.parse(probe.output?.[3]); } catch { report = failure('script setup failed'); }
      if (probe.error || probe.signal) report = failure(probe.error?.code === 'ETIMEDOUT'
        ? `script setup exceeded ${SCRIPT_PROBE_TIMEOUT_MS} ms; child terminated (${probe.signal}); a slow or busy server can raise SP_SCRIPT_PROBE_MS`
        : 'script setup process failed: '+(probe.error?.message || probe.signal));
      else if (probe.status !== 0 && !report?.code) report = failure('script setup failed');
      if (!report?.code && (!Array.isArray(report?.registrations) || report.registrations.some(r =>
        typeof r?.key !== 'string' || r.pluginId !== script.id))) report = failure('invalid script registration report');
      cache.set(key,report);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
    }
    if (report.code) return report;
    for (const {key,pluginId} of report.registrations) {
      if (owners.has(key)) return {code:'PLUGIN_SCRIPT_CONFLICT',message:`${key}: ${owners.get(key)} and ${pluginId} both register this id`};
      owners.set(key,pluginId);
    }
  }
  return null;
}
