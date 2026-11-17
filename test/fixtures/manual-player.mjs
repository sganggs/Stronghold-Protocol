// Scripted filesystem player: runs outside the launcher/stdio agent, just like a human CLI caller.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
const [dir] = process.argv.slice(2);
let last = 0, rejected = false, bought = false;
for (let i = 0; i < 3000; i++) {
  const file = path.join(dir, 'status.json');
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.state === 'finished') process.exit(0);
    if (s.state === 'stopped') throw new Error(s.error);
    if (s.state === 'waiting' && s.n !== last) {
      const d = JSON.parse(readFileSync(path.join(dir, `obs-${s.n}.json`), 'utf8'));
      let action;
      if (s.kind === 'band') action = [{ t: 'g.band', bandId: 'band_bldsk' }];
      else if (!rejected && s.kind === 'prep') { action = [{ t: 'g.buy', slot: 15 }]; rejected = true; }
      else if (!bought && s.kind === 'prep') {
        action = [d.actions.find(a => a.intent.t === 'g.buy').id]; bought = true;
      } else if (d.personalChoice) action = [d.actions.find(a => a.intent.t === 'g.choice').id];
      else if (s.kind === 'prep') action = { done: true };
      else action = [d.actions.find(a => ['g.choice', 'g.offer'].includes(a.intent.t)).id];
      const child = spawnSync(process.execPath, ['tools/ai/manual-act.mjs', dir, JSON.stringify(action)], { encoding: 'utf8' });
      if (child.status !== 0) throw new Error(child.stderr);
      last = s.n;
    }
  }
  await delay(20);
}
throw new Error('Scripted player did not finish');
