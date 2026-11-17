// Runnable stand-in for package inventory tests: the release CLI now boots the zip it writes.
export const PACKAGE_SERVER = `import http from 'node:http';
import fs from 'node:fs';
import './sim/rng.js';
const app = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
const srv = http.createServer((req, res) => {
  res.end(req.url === '/healthz' ? JSON.stringify({ ok: true, app })
    : req.url === '/' ? '<html><script src="/js/main.js"></script></html>' : '/* PIXI test runtime */');
});
srv.listen(Number(process.env.PORT), process.env.HOST, () => console.log('Local: http://127.0.0.1:' + srv.address().port));
`;
