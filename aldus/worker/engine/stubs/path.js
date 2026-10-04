// node:path for the engine bundle: POSIX paths only, the few functions server/data.js and server/sim/nodeData.js use.
const norm = (p) => {
  const abs = p.startsWith('/');
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
};
export const sep = '/';
export const join = (...parts) => norm(parts.filter(Boolean).join('/'));
export const resolve = (...parts) => {
  let p = '';
  for (const part of parts) p = String(part).startsWith('/') ? String(part) : `${p}/${part}`;
  return norm(p.startsWith('/') ? p : `/${p}`);
};
export const dirname = (p) => { const n = norm(String(p)); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); };
export const basename = (p) => norm(String(p)).split('/').pop();
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
export default { sep, join, resolve, dirname, basename, extname };
