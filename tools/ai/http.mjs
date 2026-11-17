// Run: node tools/ai/http.mjs 8765 (port 0 selects an ephemeral port, printed on stdout).
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { decide } from './policy.mjs';

export function exampleServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1048576) req.destroy(); // [ASSUMED] Example observation cap: 1 MiB.
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const reply = decide(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
      } catch { res.writeHead(400).end(); }
    });
    req.on('error', () => {});
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = exampleServer();
  server.listen(Number(process.argv[2] ?? 8765), '127.0.0.1', () => console.log(server.address().port));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
