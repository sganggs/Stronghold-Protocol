// tools/i18n/apply-spa.mjs — overwrite entries of public/i18n/en.json with the SPA Database (season 2.1) wording.
// Source: tools/i18n/spa-db.json (spa-extract.mjs) and tools/i18n/spa-enemies.json (enemy key → DB name). Maps by id:
//   alliances  bondId (case-insensitive)   → bond name, desc/descRaw
//   strategies iconLink = band iconId      → band name, effectName, desc/descRaw
//   items      iconLink = item trapId      → item name, desc/descRaw (both tiers)
//   attributes name = operator EN name     → operator's garrison (Attribute) desc/descRaw
//   tactical decisions  TACTICS (effectId) → card name, desc/descRaw
//   enemies    spa-enemies.json            → enemy name; bounty cards (name + text rebuilt in the DB's wording)
//   tactical training types                → 特训敌人·… names
// Then every other string that still carries a renamed name (old base wording) gets the new one.
// Works from the agents' base dictionary (base.mjs), so it can be re-run; writes tools/i18n/spa-overrides.json
// (build.mjs re-applies it) and public/i18n/en.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, buildBase } from './base.mjs';
import { richTextPlain } from '../../public/js/ui/richText.js';
import { bountyText } from '../../server/match/choices.js';

const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const db = J('tools/i18n/spa-db.json');
const base = buildBase().dict;
const CJK = /[㐀-鿿]/;

/** Typos of the site, fixed on the way in. */
const FIX = [
  [/Alliiance/g, 'Alliance'], [/Kazmierz/g, 'Kazimierz'], [/Mylnar/g, 'Mlynar'], [/&ltFvery/g, '&ltFor every'],
  [/ fron /g, ' from '], [/Speedfor/g, 'Speed for'], [/Allstair, Final Flame if/g, 'Alistair, Final Flame of'],
  [/Assist_Operator/g, 'Assist Operator'], [/ATKSPD/g, 'ASPD'], [/Audio Technician your/g, 'Audio Technician to your'],
];
const fix = (s) => FIX.reduce((t, [a, b]) => t.replace(a, b), String(s));

/** SPA html → game rich text (raw) / plain text. */
const PAIR = /<span class=["']blue["']>([\s\S]*?)<\/span>\s*\/\s*<span class=["']green["']>([\s\S]*?)<\/span>/g;
/** pick: 'base' keeps the blue (normal) value of a 'blue/green' pair, 'elite' the green one, null both. */
const raw = (s, pick = null) => fix(s)
  .replace(PAIR, (m, b, g) => (pick === 'base' ? "<span class='blue'>" + b + '</span>' : pick === 'elite' ? "<span class='green'>" + g + '</span>' : m))
  .replace(/<span class=["']font-bold["']>([\s\S]*?)<\/span>/g, '$1')
  .replace(/<span class=["'](blue|green)["']>([\s\S]*?)<\/span>/g, '<@ba.vup>$2</>')
  .replace(/<span[^>]*>([\s\S]*?)<\/span>/g, '$1')
  .replace(/<br\s*\/?>/g, '\n')
  .replace(/&lt;?/g, '<').replace(/&gt;?/g, '>').replace(/&amp;/g, '&')
  .replace(/[ \t]*\n[ \t]*/g, '\n').replace(/ {2,}/g, ' ').trim();
const plain = (s, pick = null) => raw(s, pick).replace(/<@[A-Za-z0-9_.\-]+>|<\/>/g, '');
/** A grey <span> is the site's own remark (not in the game text) when the text has more lines than the game's. */
const GREY = /\n?<span class=["']text-gray-500["']>[\s\S]*?(?:<\/span>|$)/g;
const lines = (s) => String(s).split('\n').length;
/** The site folds the game's second line into the first here: no lines to add back. */
const MERGED = new Set(['icon_malkie']);

const over = {};
/** A zh string without markup gets the markup-free English (a record whose descRaw equals its desc). */
const set = (zh, text) => {
  if (typeof zh !== 'string' || !CJK.test(zh) || !text) return;
  over[zh] = /<@[A-Za-z0-9_.\-]+>/.test(zh) ? text : text.replace(/<@[A-Za-z0-9_.\-]+>|<\/>/g, '');
};
const lineWarn = [];
/** Lines taken from the base: their `<item>` names get the final wording once every override is known. */
const tails = [];
/** The DB text, with the lines it leaves out (the game text has more) taken from the base translation. */
const withRest = (zh, text, what) => {
  const n = lines(text), want = lines(zh), b = base[zh];
  if (n >= want || MERGED.has(what)) return text;
  if (!b || lines(b) !== want) { lineWarn.push(what); return text; }
  tails.push({ zh, from: n });
  return [text, ...b.split('\n').slice(n)].join('\n');
};
const ANGLE = /<(?![@/$])([^<>]+)>/g;
function namesInBrackets(zhLine, enLine) {
  const zs = [...zhLine.matchAll(ANGLE)].map((m) => m[1]);
  const es = [...enLine.matchAll(ANGLE)];
  if (zs.length !== es.length) return enLine;
  let i = 0;
  return enLine.replace(ANGLE, (m) => { const z = zs[i++]; const t = over[z] ?? base[z]; return t && !CJK.test(t) ? `<${t}>` : m; });
}
const fixTails = () => {
  for (const { zh, from } of tails) {
    const zl = zh.split('\n');
    over[zh] = over[zh].split('\n').map((l, i) => (i >= from ? namesInBrackets(zl[i], l) : l)).join('\n');
  }
};
const setDesc = (rec, html, pick = null, what = '') => {
  let h = String(html);
  if (rec.desc && lines(plain(h, pick)) > lines(rec.desc)) h = h.replace(GREY, '');
  set(rec.desc, withRest(rec.desc, plain(h, pick), what));
  set(rec.descRaw, withRest(rec.descRaw, raw(h, pick), what));
};
const stats = {};
const hit = (k) => { stats[k] = (stats[k] || 0) + 1; };

// alliances
const bonds = J('data/bonds.json');
const bondById = new Map(Object.values(bonds).map((b) => [b.bondId.toLowerCase(), b]));
for (const a of db.alliances) {
  const b = bondById.get(String(a.bondId).toLowerCase());
  if (!b) { console.log('alliance not found', a.bondId); continue; }
  // one game line per threshold: the site sometimes runs "<With N …>" on after a full stop
  set(b.name, fix(a.name)); setDesc(b, String(a.desc).replace(/\.\s*(&lt;?With )/g, '.\n$1'), null, a.bondId); hit('alliances');
}

// strategies
const bands = J('data/bands.json');
const bandByIcon = new Map(Object.values(bands).map((b) => [b.iconId, b]));
for (const s of db.strategies) {
  const b = bandByIcon.get(s.iconLink);
  if (!b) { console.log('strategy not found', s.name, s.iconLink); continue; }
  set(b.name, s.name); set(b.effectName, fix(s.effectName)); setDesc(b, s.effectDesc, null, s.iconLink); hit('strategies');
}

// items (base + elite share the trap id)
const items = J('data/items.json');
for (const it of db.items) {
  const icon = it.iconLink.replace('acgarm', 'acarm'); // the site misspells one trap id
  const recs = Object.values(items).filter((r) => r.trapId === icon || r.iconId === icon);
  if (!recs.length) { console.log('item not found', it.itemName, it.iconLink); continue; }
  for (const r of recs) { set(r.name, fix(it.itemName)); setDesc(r, it.effectDesc, r.isGolden ? 'elite' : 'base', it.iconLink); }
  hit('items');
}

// operator attributes (garrisons) via the operator's English name
const chess = J('data/chess.json');
const garrisons = J('data/garrisons.json');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9α-ω]/g, '');
const byEnName = new Map();
for (const c of Object.values(chess)) {
  for (const n of [base[c.name], c.appellation]) if (n) (byEnName.get(norm(n)) || byEnName.set(norm(n), []).get(norm(n))).push(c);
}
// names the data only carries in Cyrillic
for (const [alias, appellation] of [['Gummy', 'Гум'], ['Vetochki', 'Веточки']]) {
  const cs = Object.values(chess).filter((c) => c.appellation === appellation);
  if (cs.length) byEnName.set(norm(alias), cs);
}
// An operator may list several garrisons, some shared with other operators (Tin Man's first one, garrison_25, is
// also Indigo's / Matterhorn's only one): the DB Attribute goes to the garrison whose numbers match it, and a
// garrison that is some operator's only one belongs to that operator.
const nums = (s) => String(s).match(/\d+(?:\.\d+)?/g) || [];
const score = (zh, text) => {
  const a = nums(zh), b = nums(text);
  if (!a.length && !b.length) return 1;
  const left = [...b];
  let hits = 0;
  for (const n of a) { const i = left.indexOf(n); if (i >= 0) { hits++; left.splice(i, 1); } }
  return hits / Math.max(a.length, b.length);
};
/** DB Attribute wording that contradicts the game text (data/garrisons.json zh), corrected. */
const ATTR_FIX = {
  Meteor: [['ATK and DEF', 'ATK and HP']], // 攻击力和生命值
  Hoshiguma: [['stacks to own active Alliance(s)', 'stacks to own Alliance(s) (Alliance does not need to be active)']], // 无需激活盟约
  Gnosis: [['stacks to own active Alliance(s) (Alliances', 'stacks to own Alliance(s) (Alliance']],
};
const missedOps = [];
const plans = []; // { op, gid, html, pick, single, s }
for (const a0 of db.attributes) {
  const a = { ...a0, attribute: (ATTR_FIX[a0.name] || []).reduce((t, [x, y]) => t.split(x).join(y), a0.attribute) };
  const cs = byEnName.get(norm(a.name));
  if (!cs) { missedOps.push(a.name); continue; }
  for (const c of cs) {
    set(c.name, a.name);
    const pick = c.isGolden ? 'elite' : 'base';
    const gids = (c.garrisonIds || []).filter((g) => garrisons[g]);
    const scored = gids.map((gid) => ({ gid, s: score(garrisons[gid].desc, plain(a.attribute, pick)) }));
    const top = Math.max(0, ...scored.map((x) => x.s));
    for (const { gid, s } of scored) {
      if (gids.length > 1 && (s < top || s < 0.5 || /^【\d+】/.test(garrisons[gid].desc))) continue;
      plans.push({ op: a.name, gid, html: a.attribute, pick, single: gids.length === 1, s });
    }
  }
  hit('attributes');
}
// sole owners first, then the best number match; a garrison text gets one operator's wording
plans.sort((x, y) => Number(y.single) - Number(x.single) || y.s - x.s);
const owner = new Map(); // garrison zh desc → { op, text }
const garrisonConflicts = [];
for (const p of plans) {
  const zh = garrisons[p.gid].desc;
  const text = plain(p.html, p.pick);
  const o = owner.get(zh);
  if (o) { if (o.text !== text) garrisonConflicts.push(`${o.op} vs ${p.op}: ${zh.slice(0, 40)}`); continue; }
  owner.set(zh, { op: p.op, text });
  setDesc(garrisons[p.gid], p.html, p.pick, p.op);
}

// tactical decisions: effectId → [DB name, substrings the game's rich text highlights (first match each)]
const T = ['Teammates'];
const TACTICS = {
  allybuff_select_1: ['Equip', T], allybuff_select_2_1: ["Skadi's Pledge", ['+8', ...T]],
  allybuff_select_2_2: ["Swire's Pledge", ['+10', ...T]], allybuff_select_2_3: ["Bagpipe's Pledge", ['+8', ...T]],
  allybuff_select_2_4: ["SilverAsh's Pledge", ['+8', ...T]], allybuff_select_2_5: ["Mostima's Pledge", ['+10', ...T]],
  allybuff_select_2_6: ["Titi's Pledge", ['+10', ...T]], allybuff_select_2_7: ["Mlynar's Pledge", ['+12', ...T]],
  allybuff_select_2_8: ["Texas's Pledge", ['+10', ...T]], allybuff_select_3: ['Wealth', ['1', ...T]],
  allybuff_select_4: ['Supply', ['2', ...T]], allybuff_select_5: ['Preparation', ['you']], allybuff_select_6: ['Promotion', ['you']],
  allybuff_select_7_1: ['Yanese Support', ['You']], allybuff_select_7_2: ['Kjeragi Support', ['You']],
  allybuff_select_7_3: ['Sargonian Support', ['You']], allybuff_select_7_4: ['Siracusan Support', ['You']],
  allybuff_select_7_5: ['Kazimierzian Support', ['You']], allybuff_select_7_6: ['Lateran Support', ['You']],
  allybuff_select_7_7: ['Victorian Support', ['You']], allybuff_select_7_8: ['Ægirian Support', ['You']],
  allybuff_select_11: ['Recovery', T], allybuff_select_13: ['Firepower', T], allybuff_select_14: ['Draft', T],
  allybuff_select_18: ['Flawless', T], allybuff_select_19: ['Acute', T],
  enemydebuff_select_1: ['Rejection: Weakness', []], enemydebuff_select_2: ['Rejection: Fragility', []],
  enemydebuff_select_3: ['Rejection: Hallucination', []], enemydebuff_select_4: ['Punishment: Weakness', []],
  enemydebuff_select_5: ['Punishment: Fragility', []], enemydebuff_select_6: ['Punishment: Hallucination', []],
  enemydebuff_select_7: ['Verdict: Weakness', []], enemydebuff_select_8: ['Verdict: Fragility', []],
  enemydebuff_select_9: ['Verdict: Hallucination', []],
};
const effects = J('data/effects.json');
const choices = J('data/choices.json');
const tacticByName = new Map(db.tacticalDecisions.map((t) => [fix(t.name), t]));
const TAG = /<@[A-Za-z0-9_.\-]+>/g;
const tagWarn = [];
for (const [id, [name, marks]] of Object.entries(TACTICS)) {
  const t = tacticByName.get(name);
  const recs = [effects[id], ...Object.values(choices.cards.tactic).filter((c) => c.effectId === id)].filter(Boolean);
  if (!t || !recs.length) { console.log('tactic not found', id, name); continue; }
  const desc = fix(t.description);
  let rich = desc;
  for (const m of marks) rich = rich.replace(m, `<@ba.vup>${m}</>`);
  for (const r of recs) {
    set(r.name, name); set(r.desc, desc);
    if (r.descRaw && r.descRaw !== r.desc) {
      if ((r.descRaw.match(TAG) || []).length !== (rich.match(TAG) || []).length) tagWarn.push(id);
      set(r.descRaw, rich);
    }
  }
  hit('tactics');
}

// enemies (spa-enemies.json); a name the DB never spells is reported
const enemies = J('data/enemies.json');
const enemyMap = Object.fromEntries(Object.entries(J('tools/i18n/spa-enemies.json')).filter(([k]) => !k.startsWith('_')));
const dbText = norm(fix(JSON.stringify([db.bountyDecisions, db.tacticalTraining, db.leaders, db.alliances])));
const enemyWarn = [];
for (const [key, name] of Object.entries(enemyMap)) {
  if (!enemies[key]) { enemyWarn.push(`${key} (no such enemy)`); continue; }
  if (!dbText.includes(norm(name))) enemyWarn.push(`${key} "${name}" (not in the DB)`);
  set(enemies[key].name, name); hit('enemies');
}
/** English name of an enemy: the DB's, else the base translation. */
const enemyEn = (key) => enemyMap[key] ?? base[enemies[key]?.name] ?? key;

// tactical training types (特训敌人·…): the DB's group names
const factions = J('data/factions.json');
const CAT = { 特异: 'Special', 飞行: 'Flying', 频次: 'Frequency', 元素: 'Elements', 持续: 'Continuous', 隐匿: 'Invisible', 折射: 'Refraction', 损伤: 'Injury' };
for (const t of Object.values(factions.types)) {
  const m = /^特训敌人·(.+)$/.exec(t.name);
  if (m && CAT[m[1]]) { set(t.name, `${base['特训敌人'] || 'Tactical Training Enemy'}/${CAT[m[1]]}`); hit('trainingTypes'); }
}

// bounty cards: name and text rebuilt in the DB's wording ("Bounty/Flying II", "Adds 1 X to your next 2 battles; …")
/** @param {string} zh @param {string} enemy */
function bountyName(zh, enemy) {
  let m;
  if ((m = /^(悬赏|战术特训)·(..)([IV]+)$/.exec(zh)) && CAT[m[2]]) return `${m[1] === '悬赏' ? 'Bounty' : 'Tactical Training'}/${CAT[m[2]]} ${m[3]}`;
  if (/^多轮悬赏\s*·\s*假想敌：/.test(zh)) return `Multi-Round Bounties/${enemy}`;
  if (/·多轮悬赏$/.test(zh)) return `${enemy}/Multi-Round Bounties`;
  if (/·多轮战术特训$/.test(zh)) return `${enemy}/Multi-Round Tactical Training`;
  if (/·战术特训$/.test(zh)) return `${enemy}/Tactical Training`;
  if (/·特训$/.test(zh)) return `${enemy}/Training`;
  if (/·\s*悬赏$/.test(zh)) return `${enemy}/Bounty`;
  return null;
}
const TRAIT = {
  被击倒时造成持续伤害: 'Deals continuous damage when defeated', 可造成元素损伤: 'Deals Elemental Injury', 拥有隐匿: 'Has Invisibility',
  空中敌人: 'Aerial enemy', 需要一定攻击次数击破: 'Needs multiple hits to be defeated', 拥有折射: 'Has Refraction',
};
const N_EN = { 两: 2, 三: 3, 四: 4, 五: 5 };
const BOUNTY = /^(为自身|之后的|后续的?|接下来)(.*?)(?:添加)(\d+)[只个](.+?)(?:（(.+?)）)?[，,](将其击倒者获得|击倒它的你或队友获得|若各自行动阶段就达成完美作战，获得|但)(.*?)资金$/;
/** A zh bounty text (rich or plain) → English, or null when it does not fit. */
function bountyDesc(zh, enemy) {
  const m = BOUNTY.exec(zh);
  if (!m) return null;
  const [, pre, mid, n, , trait, kind, amount] = m;
  const lead = pre + mid;
  const tag = (/<(@[A-Za-z0-9_.\-]+)>/.exec(mid) || [])[1];
  const hl = (s) => (tag ? `<${tag}>${s}</>` : s);
  let to;
  if (/(两|三|四|五)场/.test(lead)) to = `to your next ${hl(`${N_EN[/(两|三|四|五)场/.exec(lead)[1]]} battles`)}`;
  else if (/每场/.test(lead)) to = `to ${hl('every')} subsequent battle`;
  else if (/下场(作战|战斗)/.test(lead)) to = `to your ${hl('next battle')}`;
  else return null;
  if (trait && !TRAIT[trait]) return null;
  const who = `Adds ${n} ${enemy}${trait ? ` (${TRAIT[trait]})` : ''} ${to}`;
  if (kind === '但') {
    const t = (/<(@[A-Za-z0-9_.\-]+)>/.exec(amount) || [])[1];
    return `${who}, but ${t ? `<${t}>will not obtain</>` : 'will not obtain'} extra Funds`;
  }
  if (kind.startsWith('若')) return `${who}; achieve a Perfect Battle during your own action phase to obtain ${amount} Funds`;
  return `${who}; ${kind === '将其击倒者获得' ? 'defeat to obtain' : 'grants'} ${amount} Funds${kind === '将其击倒者获得' ? '' : ' to whoever defeats it'}`;
}
const bountyRecs = [...Object.values(choices.cards.bounty), ...Object.values(effects).filter((e) => e.effectType === 'ENEMY_GAIN')];
const bountyWarn = new Set();
const done = new Set();
for (const r of bountyRecs) {
  const key = r.enemyKey ?? r.params?.enemy_id;
  if (!key || !enemies[key]) continue;
  const enemy = enemyEn(key);
  const nm = bountyName(r.name, enemy);
  if (nm) { set(r.name, nm); set(richTextPlain(r.name), nm); done.add(r.name); } else bountyWarn.add(`name: ${r.name}`);
  for (const f of [r.desc, r.descRaw]) {
    if (typeof f !== 'string') continue;
    for (const zh of new Set([f, bountyText(f, { multiRound: true })])) {
      const t = bountyDesc(zh, enemy);
      if (t) { set(zh, t); set(richTextPlain(zh), richTextPlain(t)); done.add(zh); done.add(richTextPlain(zh)); } else bountyWarn.add(zh);
    }
  }
  hit('bounties');
}
// every bounty text of the dictionary should have been rebuilt
for (const zh of Object.keys(base)) if (/添加.*资金$/.test(zh) && BOUNTY.test(zh) && !done.has(zh)) bountyWarn.add(`not rebuilt: ${zh}`);

fixTails();

// renamed names inside the other strings: a string whose zh contains the renamed thing's zh and whose English
// still has the old base name gets the new one (whole words, longest name first, one pass)
const unq = (s) => String(s).trim().replace(/^['"“‘]+|['"”’]+$/g, '').trim();
const renames = []; // { zh, from, to }
const addRename = (zh) => {
  if (typeof zh !== 'string' || !(zh in over) || !base[zh] || done.has(zh)) return;
  const from = unq(base[zh]), to = unq(over[zh]);
  if (from.length < 3 || from === to || to.includes(from)) return;
  renames.push({ zh: unq(zh), from, to });
};
for (const b of Object.values(bonds)) addRename(b.name);
for (const b of Object.values(bands)) { addRename(b.name); addRename(b.effectName); }
for (const r of Object.values(items)) addRename(r.name);
for (const c of Object.values(chess)) addRename(c.name);
for (const e of Object.values(enemies)) addRename(e.name);
for (const r of Object.values(effects)) addRename(r.name);
const uniqRenames = [...new Map(renames.map((r) => [`${r.zh}\u0000${r.from}`, r])).values()];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const propagated = {};
for (const [zh, en] of Object.entries(base)) {
  if (zh in over) continue;
  const rs = uniqRenames.filter((r) => zh.includes(r.zh) && en.includes(r.from)).sort((a, b) => b.from.length - a.from.length);
  if (!rs.length) continue;
  const to = new Map(rs.map((r) => [r.from, r.to]));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...to.keys()].map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const t = en.replace(re, (m) => to.get(m));
  if (t !== en) propagated[zh] = t;
}
Object.assign(over, propagated);

const en = { ...base, ...over };
fs.writeFileSync(path.join(ROOT, 'public/i18n/en.json'), JSON.stringify(en));
fs.writeFileSync(path.join(ROOT, 'tools/i18n/spa-overrides.json'), JSON.stringify(over, null, 1));
console.log('applied', Object.keys(over).length, 'strings', stats, `renames ${uniqRenames.length}, propagated into ${Object.keys(propagated).length}`);
if (missedOps.length) console.log('operators not matched:', missedOps.join(', '));
if (garrisonConflicts.length) console.log('shared garrison text, first wording kept:\n  ' + [...new Set(garrisonConflicts)].join('\n  '));
if (lineWarn.length) console.log('line count differs from the game text:', [...new Set(lineWarn)].join(', '));
if (tagWarn.length) console.log('tactic highlight count differs:', tagWarn.join(', '));
if (enemyWarn.length) console.log('enemy map:', enemyWarn.join('; '));
if (bountyWarn.size) console.log('bounty texts not rebuilt:\n  ' + [...bountyWarn].join('\n  '));
