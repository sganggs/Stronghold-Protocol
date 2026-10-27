// Maintainer decision 2026-10-17, requested 2026-10-19: external observation → human intents as a #673 strategy.
// [ASSUMED] Protocol/resource policy (not official gameplay): defaults and bounds documented in EXTERNAL_AI.md.
// §35.23: timeoutMs up to 300000 so a reasoning model can answer a long prep; the budget stays half the phase.
export const EXTERNAL_DEFAULTS = Object.freeze({ timeoutMs: 1000, maxIntents: 64, maxBytes: 65536, failureLimit: 3, backoffMs: 1000, mode: 'direct', language: 'zh-CN' });

export function externalConfig(input, env = process.env, replay = false) {
  const c = { ...EXTERNAL_DEFAULTS, ...(input ?? {}) };
  if (input == null && !replay) {
    c.mode = env.SP_EXTERNAL_AI_MODE || c.mode;
    c.language = env.SP_EXTERNAL_AI_LANGUAGE || c.language;
    if (env.SP_EXTERNAL_AI_KNOWLEDGE) c.knowledge = env.SP_EXTERNAL_AI_KNOWLEDGE === '1';
    if (env.SP_EXTERNAL_AI_MANUAL_WAIT) c.manualWait = env.SP_EXTERNAL_AI_MANUAL_WAIT === '1';
    c.transport = env.SP_EXTERNAL_AI_TRANSPORT;
    c.url = env.SP_EXTERNAL_AI_URL;
    if (env.SP_EXTERNAL_AI_COMMAND) {
      try { c.command = JSON.parse(env.SP_EXTERNAL_AI_COMMAND); }
      catch { throw new Error('SP_EXTERNAL_AI_COMMAND must be a JSON argv array'); }
    }
    if (env.SP_EXTERNAL_AI_SEATS) c.seats = env.SP_EXTERNAL_AI_SEATS.split(',').map(Number);
    for (const [key, variable] of Object.entries({ timeoutMs: 'TIMEOUT_MS', maxIntents: 'MAX_INTENTS', maxBytes: 'MAX_BYTES', failureLimit: 'FAILURES', backoffMs: 'BACKOFF_MS' })) {
      if (env[`SP_EXTERNAL_AI_${variable}`]) c[key] = Number(env[`SP_EXTERNAL_AI_${variable}`]);
    }
  }
  c.knowledge ??= c.mode === 'plan';
  c.manualWait ??= false;
  if (typeof c.manualWait !== 'boolean' || (c.manualWait && c.mode !== 'direct')) throw new Error('External AI: manualWait requires direct mode');
  if (!['direct', 'plan'].includes(c.mode)) throw new Error('External AI: invalid mode');
  if (!['zh-CN', 'en', 'ja', 'ko', 'zh-TW'].includes(c.language)) throw new Error('External AI: invalid language');
  if (typeof c.knowledge !== 'boolean') throw new Error('External AI: invalid knowledge flag');
  for (const [key, max] of Object.entries({ timeoutMs: 300000, maxIntents: 256, maxBytes: 1048576, failureLimit: 20, backoffMs: 60000 })) {
    if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > max) throw new Error(`External AI: invalid ${key} (1..${max})`);
  }
  if (c.seats !== undefined && (!Array.isArray(c.seats) || c.seats.length > 4 || c.seats.some(s => !Number.isInteger(s) || s < 0 || s > 3))) throw new Error('External AI: seats must be indices 0..3');
  if (!replay) {
    if (!['http', 'stdio'].includes(c.transport)) throw new Error('External AI: configure SP_EXTERNAL_AI_TRANSPORT=http or stdio');
    if (c.transport === 'http') {
      let u;
      try { u = new URL(c.url); } catch { throw new Error('External AI: invalid HTTP URL'); }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) throw new Error('External AI: HTTP(S) URL without credentials or fragment required');
      // Credentials come only from the environment; never copy them to journals or error messages.
      c.token = env.SP_EXTERNAL_AI_TOKEN || '';
      if (/[\r\n]/.test(c.token)) throw new Error('External AI: invalid bearer token');
    } else if (!Array.isArray(c.command) || !c.command.length || c.command.length > 64 || c.command.some(a => typeof a !== 'string' || !a.length || a.length > 4096 || a.includes('\0'))) {
      throw new Error('External AI: command must be a nonempty JSON argv array');
    }
  }
  return Object.freeze(c);
}
