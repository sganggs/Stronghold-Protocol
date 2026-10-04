// render/style.js — palette and visual tunables of the battlefield renderer (pure data).
// Colours follow research 07 §7 (tile palette, tuned by eye) and the UI design system (theme.css).

export const TILE_H = Object.freeze({
  wall: 0.42,      // 'h' high ground
  forbid: 0.3,     // '#' forbidden block (data: HIGH)
  sep: 0.55,       // 'X' hard separator wall (rows 6 / 13)
  bench: 0.16,     // 'a' / 'A' hand & temp slots (data: HIGH)
  platform: 0.26,  // active 射击台 / mound devices
});

/** Stage glyph → material + height class (data/stages.json legend, DATA.md §12). */
export const GLYPH = Object.freeze({
  '#': { mat: 'forbid', h: 'forbid' },
  X: { mat: 'sep', h: 'sep' },
  r: { mat: 'road', h: null },
  R: { mat: 'roadN', h: null },
  f: { mat: 'floor', h: null },
  p: { mat: 'preview', h: null },
  h: { mat: 'wall', h: 'wall' },
  b: { mat: 'fence', h: null },
  a: { mat: 'hand', h: 'bench' },
  A: { mat: 'temp', h: 'bench' },
  S: { mat: 'start', h: null },
  E: { mat: 'end', h: null },
  I: { mat: 'telin', h: null },
  O: { mat: 'telout', h: null },
  m: { mat: 'mire', h: null },
  g: { mat: 'smog', h: null },
  d: { mat: 'deepsea', h: null },
  i: { mat: 'infection', h: null },
});

/** tileKey (when a stage uses glyphs outside the legend) → glyph. */
export const TILEKEY_GLYPH = Object.freeze({
  tile_forbidden: '#', tile_road: 'r', tile_floor: 'f', tile_wall: 'h', tile_fence_bound: 'b', tile_fence: 'b',
  tile_achand: 'a', tile_start: 'S', tile_end: 'E', tile_telin: 'I', tile_telout: 'O', tile_mire: 'm',
  tile_smog: 'g', tile_deepsea: 'd', tile_infection: 'i', tile_grass: 'r', tile_hole: '#',
});

export const COLORS = Object.freeze({
  bgTop: '#0b0f0e',
  bgMid: '#131a18',
  bgBottom: '#07090a',
  fog: [0.62, 0.68, 0.72],
  mint: 0x4ed8af,
  mintHi: 0x59f4ca,
  gold: 0xffc600,
  gateRed: 0xff3b30,
  gateRedDeep: 0xd0453b,
  objBlue: 0x39a7ff,
  objBlueDeep: 0x2d7fd6,
  legal: 0x3ce08c,
  illegal: 0xff4040,
  range: 0xff9c33,
  rangeStand: 0x4ed8af,
  hpAlly: 0x5fe07a,
  hpAllyLow: 0xe8c547,
  hpEnemy: 0xff4b3e,
  hpBoss: 0xff2d55,
  hpGhost: 0xfff0c8,
  hpBack: 0x0c0f0e,
  sp: 0x6fd3ff,
  spReady: 0xffe066,
  spActive: 0xffb347,
  shield: 0xdfe8ff,
});

/** Chess tier accents (theme.css --tier-1…6) and rarity-ish frames for enemies. */
export const TIER_COLORS = Object.freeze([0x9aa5a0, 0x9aa5a0, 0x7fd37a, 0x52b6ff, 0xb98cff, 0xffc600, 0xff6b3d]);
export const ENEMY_FRAME = Object.freeze({ normal: 0xc84a3c, elite: 0xff7a33, boss: 0xff2d55 });

export const DMG_STYLE = Object.freeze({
  phys: { font: 'sp-dmg-phys', fill: ['#fffbe8', '#ffb35c'], stroke: '#3b1400' },
  arts: { font: 'sp-dmg-arts', fill: ['#fbe8ff', '#c77dff'], stroke: '#2a0b45' },
  true: { font: 'sp-dmg-true', fill: ['#ffffff', '#e8e8e8'], stroke: '#2a2a2a' },
  heal: { font: 'sp-dmg-heal', fill: ['#eafff0', '#62f08a'], stroke: '#07361a' },
  elem: { font: 'sp-dmg-elem', fill: ['#fff4e0', '#ff7b3a'], stroke: '#3a1000' },
});

/** Map b.ev dmg types to a style key. */
export function dmgStyleKey(type) {
  if (type === 'phys' || type === 'arts' || type === 'true' || type === 'heal') return type;
  if (type === 'burn' || type === 'neural' || type === 'necrosis' || type === 'apoptosis' || type === 'erosion' || type === 'element') return 'elem';
  return 'phys';
}

/** Hit spark colour per damage type. */
export const HIT_TINT = Object.freeze({ phys: 0xffd9a0, arts: 0xc77dff, true: 0xffffff, heal: 0x62f08a, elem: 0xff7b3a });

/**
 * Projectile visuals per b.ev 'atk' projKind (sim: none | arrow | bolt | bomb | lob | orb | drone | enemy | boomerang | droneBomb;
 * chain / chainHeal / beam are beams). Drawn by render/fx.js:
 *   look   tracer (bullet streak + muzzle flash) | orb (glowing ball, particle trail) | shell (lobbed on an arc with a
 *          ground shadow, smoke trail) | dart (small fast bolt) | boomerang (spins to the target and back to the thrower)
 *   speed  tiles per game second — a copy of the sim's PROJECTILE_SPEEDS (server/sim/constants.js; `back` of the
 *          boomerang = BOOMERANG_RETURN_SPEED, PRTS 跃跃: out 15, back 3.75). fx.js prefers the sim's own values, loaded
 *          from /sim/constants.js, so the visual flight ends with the sim's hit; this copy stands in until then (and in
 *          Node). test/render/fxproj.test.js keeps the two equal.
 *   sizes  in tiles (× the camera's px per tile at the shot): `len` trail length, `width` trail thickness, `head` glow
 *          diameter; `arc` peak height of a lob over a 3-tile throw (scales with the range)
 *   colours `tint` hot core, `glow` halo, `trail` trail particles, `muzzle` flash at the shooter
 *   hit    arrival burst (fx.js _impact): spark | arts | heal | boom | splash | zap | enemy
 *   once   a one-off cast, not an attack rhythm: the shooter's attack clip plays once at its own speed (render/spine.js
 *          SpineActor.attack / windUp) — 暴鸰's bomb drop
 */
export const PROJ = Object.freeze({
  arrow: { look: 'tracer', speed: 14, tint: 0xfff6dc, glow: 0xffc45a, len: 1.05, width: 0.2, head: 0.36, muzzle: 0xffd27a, hit: 'spark' },
  bolt: { look: 'orb', speed: 11, tint: 0xf4e2ff, glow: 0xb36bff, len: 0.6, width: 0.34, head: 0.52, trail: 0xa35cff, muzzle: 0xc77dff, hit: 'arts' },
  orb: { look: 'orb', speed: 10, tint: 0xeafff0, glow: 0x3fe07a, len: 0.55, width: 0.3, head: 0.48, trail: 0x62f08a, muzzle: 0x62f08a, hit: 'heal' },
  bomb: { look: 'shell', speed: 8, tint: 0xffeed0, glow: 0xff8a3d, len: 0.85, width: 0.3, head: 0.56, trail: 0xff9c4a, arc: 1.1, smoke: 0x2e2824, muzzle: 0xffb35c, hit: 'boom' },
  lob: { look: 'shell', speed: 8, tint: 0xfff4dc, glow: 0xffb04a, len: 0.7, width: 0.26, head: 0.5, trail: 0xffc27a, arc: 1.4, smoke: 0x3a322c, muzzle: 0xffc27a, hit: 'splash' },
  drone: { look: 'dart', speed: 16, tint: 0xe4fbff, glow: 0x57c9ff, len: 0.7, width: 0.16, head: 0.3, trail: 0x57c9ff, hit: 'zap' },
  enemy: { look: 'orb', speed: 10, tint: 0xffe2da, glow: 0xff3b30, len: 0.55, width: 0.28, head: 0.44, trail: 0xff4a3a, muzzle: 0xff6a5a, hit: 'enemy' },
  boomerang: { look: 'boomerang', speed: 15, back: 3.75, tint: 0xfff4d6, glow: 0x9ff0dc, len: 0.4, width: 0.3, head: 0.5, trail: 0x9ff0dc, hit: 'spark' },
  // 暴鸰's bomb (sim content/enemies.js kitBombd; official projectile_bombd, speed 5): dropped from the drone, it falls
  // onto its target with a low arc and bursts where the sim's 'explode' blast goes off
  droneBomb: { look: 'shell', speed: 5, once: true, tint: 0xffe2c8, glow: 0xff5a3a, len: 0.6, width: 0.3, head: 0.5, trail: 0xff7a4a, arc: 0.35, smoke: 0x2e2824, hit: 'boom' },
});

/** Status keys (b.ev 'status' + UF flags) → icon atlas key (render/textures.js) and colour. */
export const STATUS_ICON = Object.freeze({
  stun: 'stun', freeze: 'freeze', cold: 'cold', stealth: 'stealth', shield: 'shield', fragile: 'fragile',
  artsFragile: 'fragile', physFragile: 'fragile', elemFragile: 'fragile', sleep: 'sleep', invulnerable: 'invuln',
  silence: 'silence', slow: 'slow', sluggish: 'slow', bind: 'bind', fear: 'fear', tremble: 'fear', weaken: 'weaken',
  levitate: 'levitate', taunt: 'taunt', defDown: 'weaken', resDown: 'weaken', aspdDown: 'slow', disarm: 'silence',
  burn: 'burn', burnBurst: 'burn', neural: 'neural', neuralBurst: 'neural', necrosis: 'necrosis', apoptosis: 'necrosis',
  // a 傀儡师 fighting as its <替身> (sim professions.js buff 'trait:substitute', the 20 s form)
  substitute: 'doll',
  // 禁疗 (sim status 'healFree': 史尔特尔's 余烬 — no heal reaches her until she leaves)
  healFree: 'healFree',
  // 折射 (sim buff 'ab:refraction', visible while the RES bonus is on). The tail of 'ab:refraction' hits this key.
  refraction: 'refraction',
});

/** Keyword fallbacks for namespaced / content status keys ('ab:frost', 'reed2:scorch', 'skill:shotst_shred' …). */
const STATUS_GUESS = [
  [/frost|chill|cold/i, 'cold'], [/freez/i, 'freeze'], [/scorch|burn|ignit|flame/i, 'burn'], [/stun|daze/i, 'stun'],
  [/sleep|slumber/i, 'sleep'], [/silenc/i, 'silence'], [/slow|slugg|bind|root|snare/i, 'slow'], [/fear|trembl/i, 'fear'],
  [/fragil|shred|expos|wanted|vulner|mark/i, 'fragile'], [/weak|down$/i, 'weaken'], [/shield|resist|guard|ward|barrier/i, 'shield'],
  [/invul|immun/i, 'invuln'], [/stealth|camou|invis/i, 'stealth'], [/levit|float/i, 'levitate'], [/taunt/i, 'taunt'],
  [/neural/i, 'neural'], [/necro|apopt|erosion/i, 'necrosis'],
];

/**
 * The 折射 icon is not drawn while the unit is silenced: the RES bonus is already off (enemies.js refraction)
 * and the status must not keep looking active. Other icons stay.
 * @param {string} key a b.ev status key
 * @param {Set<string>|string[]|null} statuses
 */
export function statusIconSuppressed(key, statuses) {
  if (key !== 'ab:refraction' && key !== 'refraction') return false;
  if (!statuses) return false;
  return typeof statuses.has === 'function' ? statuses.has('silence') : Array.isArray(statuses) && statuses.includes('silence');
}

/** Icon key (textures STATUS_KEYS) for a b.ev status key or flag name; null when it has no icon. */
export function statusIconKey(key) {
  if (typeof key !== 'string' || !key) return null;
  if (STATUS_ICON[key]) return STATUS_ICON[key];
  const tail = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  if (STATUS_ICON[tail]) return STATUS_ICON[tail];
  for (const [re, icon] of STATUS_GUESS) if (re.test(tail)) return icon;
  return null;
}

export const UNIT = Object.freeze({
  /** Spine skeleton units → world tiles (skeletons are ~360–450 units tall ⇒ ~1.2 tiles). */
  modelScale: 1 / 320,
  /** Fallback diamond size in tiles. */
  diamond: 0.78,
  headroom: 1.18, // tiles above the feet where bars sit (operators; enemies use their bounds)
  barWidth: 0.64,
  bossBarWidth: 2.2,
});
