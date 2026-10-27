// §37.26 [ASSUMED] Compact presentation of human wire views and the public knowledge catalogue only.
const clean = s => String(s ?? '').replace(/<@[^>]*>|<\/>/g, '').replace(/\s+/g, ' ').trim();
const short = (s, n = 110) => { const t = clean(s); return t.length > n ? `${t.slice(0, n)}…` : t; };
const json = x => JSON.stringify(x);
const progress = p => p ? `${p.current}/${p.total}` : '';
export const actionList = o => o.digest.actions.map(a => `${a.id}: ${a.text} ${json(a.intent)}`).join('\n') + '\n';
const num = n => n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
const RAW = 'Raw intents (zero-based): buy {"t":"g.buy","slot":S}; bench/withdraw {"t":"g.move","uid":U,"to":{"area":"hand","idx":I}} '
  + '(I = the Hand slot number; an occupied slot swaps); place/move {"t":"g.move","uid":U,"to":{"area":"board","row":R,"col":C},"dir":"UP"} '
  + '(UP = +row; an occupied tile swaps); equip {"t":"g.equip","itemUid":I,"targetUid":U} (items destroyed on equip have no '
  + 'equip shortcut: use this); sell {"t":"g.sell","uid":U}.';

// §37.29 [ASSUMED] The own field with the highest row on top (UP = +row): ground routes as arrows toward the objective,
// flyer lines as ~, deploy tiles . (ground) / H (high ground), own board pieces 1-9 then letters (no H).
const CODES = '123456789ABCDEFGIJKLMNOPQRSTUVWXYZ';
const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT']; // the digest's per-tile order (aiDigest.js)
const role = p => p.class ? ` [${[p.class, ...['air', 'block', 'sustain'].filter(k => p.caps?.[k])].join(' ')}]` : '';
function mapLines(d) {
  const g = d.geometry, key = (r, c) => `${r},${c}`, cells = new Map(), marks = new Map();
  if (!g) return [];
  for (const t of g.tiles || []) cells.set(key(...t.at), t.terrain === 'ranged' ? 'H' : '.');
  const arrow = ([r, c], [nr, nc]) => nr > r ? '^' : nr < r ? 'v' : nc > c ? '>' : '<';
  for (const rt of (g.routes || []).filter(rt => !rt.fly)) rt.tiles.forEach((t, i) => {
    const a = i + 1 < rt.tiles.length ? arrow(t, rt.tiles[i + 1]) : i > 0 ? arrow(rt.tiles[i - 1], t) : '*';
    const had = marks.get(key(...t));
    marks.set(key(...t), had && had !== a ? '+' : a);
  });
  for (const rt of (g.routes || []).filter(rt => rt.fly)) for (const t of rt.tiles) if (!marks.has(key(...t))) marks.set(key(...t), '~');
  const units = d.board.filter(p => p.row != null).map((p, i) => ({ p, code: CODES[i] || '?' }));
  const at = new Map(units.map(u => [key(u.p.row, u.p.col), u.code]));
  const used = [...cells.keys(), ...marks.keys(), ...at.keys()].map(k => Number(k.split(',')[1]));
  if (!used.length) return [];
  const cols = [];
  for (let c = Math.min(...used); c <= Math.max(g.cols[1], ...used); c++) cols.push(c);
  const lines = ['\n## Map (own field, top = highest row, UP = +row; arrows ground route, ~ flyers, . ground tile, H high ground)',
    `     ${cols.map(c => String(c).padStart(3)).join('')}`];
  for (let r = g.rows[1]; r >= g.rows[0]; r--) lines.push(`${String(r).padStart(4)} ${cols.map(c => (at.get(key(r, c)) || marks.get(key(r, c)) || cells.get(key(r, c)) || ' ').padStart(3)).join('')}`);
  if (units.length) lines.push(`Units: ${units.map(({ p, code }) => `${code}=${p.uid} ${p.name} ${p.dir}${/[<>^v+*]/.test(marks.get(key(p.row, p.col)) || '') ? ' on route' : ''}`).join('; ')}`);
  return lines;
}

export function observationMarkdown(o, pack, n) {
  const d = o.digest, c = o.context, own = o.private;
  const catalogue = new Map(['operators', 'items', 'bonds', 'bands'].flatMap(k => pack?.[k] || []).map(r => [r.id, r]));
  const name = id => catalogue.get(id)?.name || id || '—';
  const bonds = ids => (ids || []).map(name).join('/');
  const held = [...d.bench, ...d.overflow, ...d.board];
  const lines = [`# Observation ${n} · seat ${own.seat} · R${c.round} ${c.kind} / ${c.phase}`,
    `LP ${d.lp}; funds ${d.economy.gold}; 调度中心 ${d.economy.level}/${own.shop.maxLevel}, upgrade ${d.economy.upgradePrice}; refresh ${d.economy.refreshPrice} (free ${own.shop.freeRefreshes}); deploy ${own.deployCount}/${d.deployCap}.`,
    `Budget: ${c.deadline === 0 ? 'untimed solo' : `${Math.max(0, c.deadline - o.public.serverNow)} ms at receipt`}; ${c.remaining} intents left across this decision.`,
    `Funds ${d.economy.interest.carries ? `carry; interest ${d.economy.interest.now}, next at ${d.economy.interest.nextGold ?? '—'}` : 'expire at prep end'}; frozen slots ${d.economy.frozenSlots.join(',') || 'none'}.`,
    `Band: ${d.band.name || '—'} (${d.band.id || 'none'}). ${short(catalogue.get(d.band.id)?.effect, 180)}`];
  for (const e of own.effects || []) lines.push(`Effect ${e.name}: ${short(e.desc)} ${e.counter != null ? `counter=${e.counter}` : ''} ${e.counterText || ''} ${progress(e.progress)} ${e.roundProgress ? `round ${progress(e.roundProgress)}` : ''}`.trim());
  lines.push(`Counters: spent ${own.stats.gold}, refreshes ${own.stats.refreshes}, merges ${own.stats.merges}.`);
  lines.push('\n## Last response / host feedback');
  lines.push(...(o.results?.length ? o.results.map(r => `${r.ok ? 'ACCEPTED' : 'REJECTED'} ${json(r.intent)}: ${r.error || 'ok'}${r.detail ? ` (${clean(r.detail)})` : ''}${r.fallback ? ' — FALLBACK' : ''}`) : ['None.']));
  const b = d.lastBattle;
  if (b) {
    lines.push(`\n## Last battle R${b.round}${b.boss ? ' (boss field)' : ''}: killed ${b.killed}/${b.total}, LP −${b.lpLoss} → ${b.lp}`);
    lines.push(`Leaks: ${b.leaks.map(l => `${l.name} ×${l.count}${l.counted !== l.count ? ` (${l.counted} counted)` : ''}${l.gates.length ? ` ${l.gates.join('/')} gate` : ''}`).join('; ') || 'none'}.`);
    lines.push(`Units dmg/kills/taken/heal: ${b.units.slice(0, 12).map(u => `${u.uid ?? '-'} ${u.name} ${num(u.dmg)}/${u.kills}/${num(u.taken)}/${num(u.heal)}`).join('; ') || 'none'}.`);
  }
  lines.push('\n## Shop');
  for (const s of d.shop.filter(Boolean)) {
    const inventory = [...held, ...held.flatMap(p => (p.items || []).map(i => ({ ...i, kind: 'item' })))];
    const copies = inventory.filter(p => p.kind === s.kind && (p.baseId || p.id) === (s.baseId || s.id));
    lines.push(`${s.slot}: ${s.name}${role(s)} T${s.tier} $${s.price} ${s.sold ? 'SOLD' : ''}${s.frozen ? ' FROZEN' : ''}; ${bonds(s.bonds)}; owned ${copies.filter(p => !p.golden).length} normal + ${copies.filter(p => p.golden).length} elite${s.kind === 'item' ? `; ${short(catalogue.get(s.id)?.effect)}` : ''}`);
  }
  // §37.29: buy shortcuts need a free hand slot; say so instead of silently listing none
  const handFull = own.hand.length > 0 && own.hand.every(Boolean);
  for (const [label, pieces] of [['Hand', d.bench], ['Temp', d.overflow], ['Board', d.board]]) {
    lines.push(`\n## ${label}${label === 'Hand' && handFull ? ' (FULL: no buy or reward shortcuts until you sell or place a piece)' : ''}`);
    lines.push(...(pieces.length ? pieces.map(p => `uid=${p.uid} ${p.name}${role(p)}${p.golden ? ' ELITE' : ''} ${p.row != null ? `@${p.row},${p.col} ${p.dir}` : p.slot != null ? `slot=${p.slot}` : ''}; ${bonds(p.bonds)}${p.items?.length ? `; items ${p.items.map(i => `${i.uid}:${i.name}${i.progress ? ` ${progress(i.progress)}` : ''}`).join(', ')}` : ''}${p.kind === 'item' ? `; ${short(catalogue.get(p.id)?.effect)} ${progress(p.progress)}` : ''}`) : ['Empty.']));
  }
  lines.push(...mapLines(d));
  lines.push('\n## Bonds (banked layers; counts are current, hand is potential unless countsHand)');
  const entries = new Map(d.bonds.map(b => [b.bondId, b]));
  for (const p of held) for (const id of p.bonds || []) if (!entries.has(id)) entries.set(id, { bondId: id, count: 0, layers: 0, thresholds: catalogue.get(id)?.thresholds });
  for (const b of entries.values()) {
    const rec = catalogue.get(b.bondId), thresholds = b.thresholds || [], next = thresholds.find(t => t > b.count);
    const effectLines = (rec?.effect || '').split('\n');
    const effect = next ? effectLines.find(l => new RegExp(`<[^>]*?${next}(?:名|个|[^0-9])`).test(l)) || effectLines[0] : effectLines[0];
    lines.push(`${name(b.bondId)}: ${b.count} / [${thresholds.join(',')}] L=${b.layers}; ${b.off ? 'DISABLED' : b.active ? 'active' : 'inactive'}${b.countsHand ? ' (counts hand)' : ''}; next ${next ?? 'max'}: ${short(effect, 100)}`);
  }
  lines.push('\n## Next wave (public gate/route preview)');
  const waves = new Map();
  for (const e of d.upcoming) {
    const key = `${e.name} | ${e.gate} | ${e.fly ? 'FLY' : 'ground'}${e.boss ? ' BOSS' : ''}${e.source === 'bounty' ? ' bounty' : ''}`;
    waves.set(key, (waves.get(key) || 0) + e.count);
  }
  lines.push(...(waves.size ? [...waves].map(([k, count]) => `${k}: ×${count}`) : ['None.']));
  const briefs = new Map(d.upcoming.filter(e => e.enemy).map(e => [e.enemyKey, e]));
  for (const e of briefs.values()) lines.push(`${e.boss ? 'BOSS' : 'Elite'} ${e.name}: HP ${e.enemy.hp} DEF ${e.enemy.def} RES ${e.enemy.res} ${e.enemy.fly ? 'FLY' : e.enemy.motion}${e.enemy.effect ? ` — ${short(e.enemy.effect, 160)}` : ''}`);
  if (o.public.bossHp) lines.push(`Leader pool ${o.public.bossHp.hp}/${o.public.bossHp.max}`);
  lines.push('\n## Pending choices');
  for (const a of d.actions.filter(a => a.intent.t === 'g.band')) lines.push(`${a.id} band ${a.intent.bandId}: ${name(a.intent.bandId)} — ${short(catalogue.get(a.intent.bandId)?.effect)}`);
  for (const a of d.actions.filter(a => a.intent.t === 'g.choice')) {
    const card = a.intent.choiceId ? d.personalChoice?.cards[a.intent.idx] : d.choices.cards?.find(x => x.idx === a.intent.idx);
    lines.push(`${a.id} card ${a.intent.choiceId || 'common'} idx=${a.intent.idx} ${card?.id || card?.effectId || ''}: ${card?.name || ''} — ${short(card?.desc)}`);
  }
  for (const w of d.choices.offers || []) for (const s of w.seats.filter(s => s.playerId === d.playerId && !s.picked)) for (const card of s.slots.filter(c => c.available)) {
    lines.push(`offer ${w.id} seq=${w.seq} idx=${card.idx} id=${card.id}: ${card.name} $${card.price ?? 0} — ${short(card.desc)}`);
  }
  for (const r of d.rewards.filter(r => r && !r.sold)) lines.push(`reward idx=${r.slot} id=${r.id}: ${r.name} $${r.price ?? 0} — ${short(catalogue.get(r.id)?.effect || catalogue.get(r.id)?.traits?.join('; '))}`);
  if (d.opponents.length) {
    lines.push('\n## Teammates (public)');
    for (const p of d.opponents) lines.push(`${p.playerId} LP=${p.lp}, band=${name(p.bandId)}; ${p.bonds.filter(b => b.active).map(b => `${name(b.bondId)} ${b.count} L${b.layers}`).join('; ')}; board ${p.board.map(u => `${u.name}@${u.row},${u.col}`).join(', ')}`);
  }
  lines.push('\n## Actions (IDs expire at the next observation)');
  // Placement is often thousands of actions and equipment one per target: group them without losing the mapping.
  // §37.29: shop, economy and picks first, then equipment, sells, benching, placements (the page cut drops the tail).
  const who = new Map([...held, ...held.flatMap(p => p.items || [])].map(p => [p.uid, p.name]));
  const singles = [], equips = new Map(), grouped = { sell: [], bench: [], destroy: [], unequip: [] }, moves = new Map();
  let ready = null, benchIdx = null;
  for (const a of d.actions) {
    const i = a.intent;
    if (i.t === 'g.move' && i.to.area === 'board') {
      if (!moves.has(i.uid)) moves.set(i.uid, new Map());
      const tile = `${i.to.row},${i.to.col}`, tiles = moves.get(i.uid);
      if (!tiles.has(tile)) tiles.set(tile, []);
      tiles.get(tile).push({ n: Number(a.id.slice(1)), dir: i.dir });
    } else if (i.t === 'g.move') { benchIdx = i.to.idx; grouped.bench.push(`${a.id}=${i.uid} ${who.get(i.uid) || ''}`.trim()); }
    else if (i.t === 'g.equip') {
      if (!equips.has(i.itemUid)) equips.set(i.itemUid, []);
      equips.get(i.itemUid).push(`${a.id}=${i.targetUid} ${who.get(i.targetUid) || ''}`.trim());
    } else if (i.t === 'g.sell' || i.t === 'g.destroy') grouped[i.t.slice(2)].push(`${a.id}=${i.uid} ${who.get(i.uid) || ''}`.trim());
    else if (i.t === 'g.unequip') grouped.unequip.push(`${a.id}=${i.itemUid} ${who.get(i.itemUid) || ''}`.trim());
    else if (i.t === 'g.ready') ready = `${a.id}: ${a.text}`;
    else singles.push(`${a.id}: ${a.text}`);
  }
  lines.push(...singles);
  for (const [item, ids] of equips) lines.push(`equip ${item} ${who.get(item) || ''} on: ${ids.join(', ')}`);
  if (grouped.sell.length) lines.push(`sell: ${grouped.sell.join(', ')}`);
  if (grouped.bench.length) lines.push(`bench to hand idx ${benchIdx}: ${grouped.bench.join(', ')}`);
  if (grouped.destroy.length) lines.push(`destroy: ${grouped.destroy.join(', ')}`);
  if (grouped.unequip.length) lines.push(`unequip: ${grouped.unequip.join(', ')}`);
  if (ready) lines.push(ready);
  // §37.31 (co-op agents: 400–800 IDs cut the page): one line per piece, a tile's RIGHT id with UP/DOWN/LEFT the next three
  if (moves.size) lines.push('place: tile=aN means aN RIGHT, aN+1 UP, aN+2 DOWN, aN+3 LEFT; a tile with letters lists only those');
  for (const [uid, tiles] of moves) {
    const cells = [...tiles].map(([tile, ids]) => ids.length === 4 && ids.every((x, k) => x.dir === DIRS[k] && x.n === ids[0].n + k)
      ? `${tile}=a${ids[0].n}` : `${tile}=${ids.map(x => `a${x.n}${x.dir[0]}`).join('/')}`);
    lines.push(`place ${uid} ${who.get(uid) || ''}: ${cells.join(' ')}`);
  }
  // [ASSUMED] ~3–4k-token target: 9000 characters, with full lossless actions/request beside the compact page.
  // Keep header, feedback and all state ahead of the potentially huge placement list.
  const footer = `\nAnswer act-${n}.json: ["a1"] or [{"t":"g.buy","slot":0}]. Prep {"done":true} (alone, or last in a list) submits Ready through the validator.\n${RAW}\n`
    + `Full actions: obs-${n}.actions.md; raw digest: obs-${n}.json; full request: obs-${n}.request.json.\n`;
  let out = '';
  for (const line of lines) {
    if (out.length + line.length > 8800) { out += '\n[More detail in the raw digest and full action list.]\n'; break; }
    out += `${line}\n`;
  }
  return out + footer;
}

export function resultMarkdown(record, seat, names = {}) {
  const p = record.summary.players.find(p => p.seat === seat), trace = record.layerTrace;
  const spent = {};
  for (const s of trace.spending.filter(s => s.pid === p.playerId)) {
    const kind = s.name === 'buy' ? `buy:${s.kind}` : s.name;
    spent[kind] = (spent[kind] || 0) + s.spent;
  }
  const rounds = new Map();
  for (const s of trace.snapshots.filter(s => s.pid === p.playerId && ['SETTLE', 'RESULT', 'FINAL_ASSAULT', 'HIDDEN_CORE'].includes(s.phase))) rounds.set(s.round, s);
  return [`# ${p.victory ? 'WIN' : 'LOSS'} · seat ${seat}`, `Version ${record.version}; seed ${record.seed}; ${record.mode} ${record.difficulty}.`,
    `Reached round ${record.round}; passed ${p.roundsPassed}; LP ${p.lp}; team LP ${record.summary.teamLp ?? '—'}.`,
    `FA damage ${record.fa?.damageBySeat[seat] ?? 0} / pool ${record.fa?.pool ?? 'not reached'}; remaining ${record.fa?.remaining ?? '—'}.`,
    `External fallbacks: ${record.external?.bySeat[seat]?.fallbacks || 0}.`,
    '\n## Banked layers per round (settlement / result)',
    ...[...rounds].map(([r, s]) => `R${r} LP=${s.lp}: ${Object.entries(s.layers).map(([b, l]) => `${names[b] || b}(${b})=${l}`).join('; ') || 'none'}`),
    '\n## Gold spent by kind', ...Object.entries(spent).map(([k, v]) => `${k}: ${v}`), `Total: ${p.stats.gold}`,
    '\n## Final host feedback', ...(record.finalFeedback?.[seat] || []).map(r => `${r.ok ? 'ACCEPTED' : 'REJECTED'} ${json(r.intent)}: ${r.error || 'ok'} ${r.detail || ''}`),
    '\nFull match summary, layer provenance and spending: result.json.'].join('\n') + '\n';
}
