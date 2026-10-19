// Build the client-side face-mode table from the owner's 10-face-modes.json.
//
//   node tools/build-face-modes.mjs "path/to/10-face-modes.json"
//
// Writes public/js/render/faceModes.js — a plain ES module (no fetch at runtime), ONE OPERATOR PER LINE so the file stays
// reviewable and a change to one operator touches exactly one line:
//
//   "char_496_wildmn": [["Attack","Target","","Attack_Down",0],["Skill_2","Default","","Skill_2_Down",0]],
//
// Row = [animKey, mode, up, down, escapeTime]:
//   animKey     the animation the mode drives ('' = the ability's default, used when no clip matches)
//   mode        Target | none | Default | Front | …+ForceToDirection | FirstCastTarget | …+CheckDownAttack | … (a '+'
//               separates flags)
//   up / down   the direction-specific clip variants the skeleton may have (Attack_Down, Skill_1_Loop_Down, …), '' if none
//   escapeTime  seconds the facing is kept after the clip ends
//   kind        the ability kind of the row: attack | skill | other | unspecified (two abilities may name the same animation
//               with different modes 鈥?the renderer picks the one matching what is running, never "first row wins") before the model goes back to its deployed direction
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [, , input] = process.argv;
if (!input) {
  console.error('usage: node tools/build-face-modes.mjs <10-face-modes.json>');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
const ops = raw.operators || {};
const lines = [];
let rowCount = 0;
for (const id of Object.keys(ops).sort()) {
  const list = ops[id];
  if (!Array.isArray(list) || !list.length) continue;
  const rows = [];
  for (const e of list) {
    const animKey = typeof e.animKey === 'string' ? e.animKey : '';
    const mode = typeof e.mode === 'string' && e.mode ? e.mode : 'Target';
    const up = typeof e.up === 'string' ? e.up : '';
    const down = typeof e.down === 'string' ? e.down : '';
    const escape = Number(e.escapeTime) > 0 ? Math.round(Number(e.escapeTime) * 1000) / 1000 : 0;
    const kind = typeof e.kind === 'string' && e.kind ? e.kind : '';
    rows.push(`[${JSON.stringify(animKey)},${JSON.stringify(mode)},${JSON.stringify(up)},${JSON.stringify(down)},${escape},${JSON.stringify(kind)}]`);
    rowCount++;
  }
  lines.push(`  ${JSON.stringify(id)}: [${rows.join(',')}],`);
}

const header = `// Operator face modes — GENERATED, do not edit. Source: the owner's 10-face-modes.json (one row per ability animation
// of every operator). Rebuild with:
//   node tools/build-face-modes.mjs <path/to/10-face-modes.json>
//
// One operator per line: "charId": [[animKey, mode, up, down, escapeTime, kind], ...]
//   animKey     the animation the mode drives ('' = the ability's default, used when no clip matches)
//   mode        Target (turn toward the target) | none (never turn) | Default (keep the deployed direction) |
//               Front (never the Back model) | ...+ForceToDirection / ...+CheckDownAttack (play the up/down clip instead) |
//               FirstCastTarget (keep the first cast's target) -- a '+' separates flags
//   up / down   the direction-specific clip variants the skeleton has, '' if none
//   escapeTime  seconds the facing is kept after the clip ends
//   kind        the ability kind of the row: attack | skill | other | unspecified (two abilities may name the same animation
//               with different modes 鈥?the renderer picks the one matching what is running, never "first row wins")
export const FACE_MODES = {
`;

const text = `${header}${lines.join('\n')}\n};\n\nexport default FACE_MODES;\n`;
const outDir = path.resolve('public/js/render');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'faceModes.js');
writeFileSync(outFile, text, 'utf8');
// report animations two abilities drive with different modes (resolved at runtime by kind + first-cast, but worth knowing)
const shared = [];
for (const id of Object.keys(ops).sort()) {
  const seen = new Map();
  for (const e of ops[id] || []) {
    const key = e.animKey;
    if (!key) continue;
    const mode = e.mode || 'Target';
    if (seen.has(key) && seen.get(key) !== mode) shared.push(`${id} ${key}: ${seen.get(key)} vs ${mode}`);
    else if (!seen.has(key)) seen.set(key, mode);
  }
}
console.log(`OK ${lines.length} operators, ${rowCount} rows -> ${outFile} (${Math.round(text.length / 1024)} KB, ${lines.length + 13} lines)`);
if (shared.length) {
  console.log(`note: ${shared.length} animKey(s) shared by abilities with different modes (picked at runtime by kind + first cast):`);
  for (const s of shared) console.log('  ' + s);
}
