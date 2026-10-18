// [ASSUMED] Checks share the trial bench's 20 s / 512 MiB child budget; at most two run concurrently.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StudioError } from './files.js';
let active = 0;
export function checkCandidate(request, { spawn = fork, timeoutMs = 20000 } = {}) {
  if (active >= 2) return Promise.reject(new StudioError('PLUGIN_STUDIO_TRIAL_BUSY', 429));
  active++;
  return new Promise((resolve, reject) => {
    let child, result, error, timer, done = false;
    const finish = () => {
      if (done) return; done = true; active--; clearTimeout(timer);
      if (result?.error) error = new StudioError(result.error.code, result.error.status, result.error.params);
      if (error || !result?.checked) reject(error || new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500));
      else resolve(result.checked);
    };
    const fail = e => { error ||= e; if (child?.pid) child.kill('SIGKILL'); else finish(); };
    try {
      child = spawn(fileURLToPath(new URL('./checkChild.js', import.meta.url)), [], {
        execArgv: ['--max-old-space-size=512'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
      });
      timer = setTimeout(() => fail(new StudioError('PLUGIN_STUDIO_TRIAL_TIMEOUT', 504)), timeoutMs);
      child.once('error', () => fail(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500)));
      child.once('message', value => { result = value; child.kill('SIGKILL'); });
      // Reap the child before the caller removes its candidate, including timeout/crash/spawn errors.
      child.once('close', finish);
      child.send(request);
    } catch (e) { fail(e); }
  });
}
