// test/fixtures/slow-plan-agent.mjs — a stdio external AI for the §37.72 plan-timing tests (test/match/external-timing.test.js).
// Every plan-mode observation is answered after a delay of its own (one timer per request, so requests overlap as four
// seats' do): --sleep-ms N, or --sleep-frac f × the host's budget (context.deadline − public.serverNow, both on the host's
// clock). --kinds and --players (comma lists) limit the delay to those decision kinds / player IDs; everything else is
// answered at once. A prep gets the marker plan { economy: { reserve: <the observation's round> } } (reserve is part of
// the funds direction a carried plan keeps), so a test can tell which observation steered a prep; a band / 机变 / offer
// turn gets its first choice. Stdout is exclusively NDJSON.
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const sleepMs = Number(arg('sleep-ms') ?? 0), sleepFrac = Number(arg('sleep-frac') ?? 0);
const kinds = arg('kinds')?.split(','), players = arg('players')?.split(',');

function reply(o) {
  if (o.type === 'hello') return { v: o.v, id: o.id, type: 'hello', knowledgeVersion: o.knowledge.version };
  if (o.context.kind === 'prep') return { v: o.v, id: o.id, plan: { economy: { reserve: o.context.round } } };
  const choice = o.digest.actions.find(a => ['g.band', 'g.choice', 'g.offer'].includes(a.intent.t))?.id;
  return { v: o.v, id: o.id, plan: choice ? { choice } : {} };
}

function delayOf(o) {
  if (o.type === 'hello' || (kinds && !kinds.includes(o.context.kind)) || (players && !players.includes(o.private.playerId))) return 0;
  return sleepFrac > 0 ? sleepFrac * Math.max(0, o.context.deadline - o.public.serverNow) : sleepMs;
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(10)) !== -1) { // loop-cap: received bytes, one observation per line
    const o = JSON.parse(buffer.subarray(0, end).toString('utf8'));
    buffer = buffer.subarray(end + 1);
    setTimeout(() => process.stdout.write(`${JSON.stringify(reply(o))}\n`), delayOf(o));
  }
});
