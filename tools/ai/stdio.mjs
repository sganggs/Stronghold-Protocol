// Run: node tools/ai/stdio.mjs. Stdout is exclusively NDJSON; diagnostics belong on stderr.
import { decide } from './policy.mjs';
let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  let end;
  while ((end = buffer.indexOf(10)) !== -1) { // loop-cap: received bytes, 1 MiB per observation
    if (end > 1048576) process.exit(1); // [ASSUMED] Same example observation cap as HTTP.
    try {
      const observation = JSON.parse(buffer.subarray(0, end).toString('utf8'));
      process.stdout.write(`${JSON.stringify(decide(observation))}\n`);
    } catch { process.exit(1); }
    buffer = buffer.subarray(end + 1);
  }
  if (buffer.length > 1048576) process.exit(1);
});
