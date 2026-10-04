// render/fx.js — battle visual effects with pooling and hard caps (DESIGN §9).
//
//   projectiles  b.ev 'atk' by projKind (render/style.js PROJ): sniper tracers with a muzzle flash; arts / heal / enemy
//                orbs with a particle trail; bombs and lobs as shells on an arc with a ground shadow, a smoke trail and
//                an explosion; drone darts; 回环射手 boomerangs that spin out to the target and back to the thrower's
//                current position, gone when caught. Flight times from the sim's projectile speeds (/sim/constants.js
//                PROJECTILE_SPEEDS — the visual lands with the sim's hit), homing on the interpolated target; a burst
//                per kind on arrival; chain lightning (chain / chainHeal) and beams as short-lived jagged lines
//   hits         glow + sparks by damage type; a melee blow adds a slash crescent swept along the blow (attacker →
//                victim) in the hit colour; AoE ground rings for splash attackers
//   numbers      damage numbers (phys orange-white, arts purple, true white, heal green, elements orange) as
//                pooled BitmapText (per font); rapid same-style hits on a target merge into a running total; big hits
//                (≥ 18 % max HP) pop larger; ≤ 4 per target; laid out in screen space against every live number (lanes
//                beside the head, stacked upwards) so numbers of neighbouring units never cover or touch each other;
//                crowded spots get shorter lives (see number())
//   skill        activation burst: flash, a light pillar with a white-hot core, a shockwave + hex ring on the ground,
//                rising motes; while active a slowly turning hex with a soft glow under the unit (+ a few motes)
//   blasts       explosions (fireball, flash, shockwave + coloured ground ring, sparks, smoke; heavy ones add debris
//                and a scorch mark) for blast fx kinds and shell impacts
//   bombard      蕾缪安 S3: fx 'lock' keeps a reticle on the locked enemy until the 'bombard' of the shell fired at it
//                (or LOCK_T game s after the shooter's last lock / shell; the S2 aim lock until the snipe's 'crit'); 'bombardShell' = a shell fired now that
//                lands on the spot after `t` game s — a launch streak leaves the shooter upwards and the shell drops out
//                of the sky onto the spot (a long flight climbs out of her first), a closing warning ring marks the spot
//                meanwhile; 'bombard' is the big explosion at the impact
//   deploy       drop-in ring + pillar; death dissolve embers; crate splinters; element bursts; leak vignette;
//                bond-layer glyph pops and bounty coins (screen space, near the top of the field)
// Sizes are in tiles × the camera's px per tile at the spot, so effects read alike at every resolution and zoom (3D
// board or 2D fallback: both project through the same camera). An fx anchored on a unit (extra.id) follows that
// unit's rendered position when the event happens on it, else it happens at the event's (x, y) (_where).
// Particles live in two ParticleContainers (additive / normal) sharing the FX atlas base texture, so the whole
// particle system costs two draw calls. Every pool has a cap; when full, the oldest entry is recycled. Particle,
// projectile and lock records are pooled (the per-frame emitters allocate nothing). Cosmetic extras — trails, muzzle
// flashes, afterimages, debris, scorch marks, aura motes — are skipped at quality 'low' and under heavy load
// (adaptive load level ≥ 2), and trails yield to bursts near the particle cap (SOFT_CAP).

import { fxAtlas } from './textures.js';
import { DMG_STYLE, dmgStyleKey, HIT_TINT, PROJ, COLORS } from './style.js';

/**
 * The sim's projectile speeds (server/sim/constants.js PROJECTILE_SPEEDS — pure data, served read-only at
 * /sim/constants.js with the rest of the client-side sim, DESIGN §14): a shot's visual flight ends when the sim lands it,
 * i.e. with its damage number. Loaded once in a browser (the game already has the module from its battle runner);
 * until it arrives — and in Node, where '/sim/' is no module path — style.js PROJ speeds (a copy the unit tests keep
 * equal to the sim's) stand in.
 */
let simSpeeds = null;
/**
 * Use the sim's speeds (tiles per game second): `table` = PROJECTILE_SPEEDS by kind, `boomerangReturn` =
 * BOOMERANG_RETURN_SPEED (the sim's visual kind of a boomerang flying back); null = style.js PROJ only.
 */
export function setSimProjectileSpeeds(table, boomerangReturn = null) {
  if (!table || typeof table !== 'object') { simSpeeds = null; return; }
  simSpeeds = Object.assign({}, table);
  if (Number(boomerangReturn) > 0) simSpeeds.boomerangReturn = Number(boomerangReturn);
}
if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
  import('/sim/constants.js').then((m) => { if (m?.PROJECTILE_SPEEDS) setSimProjectileSpeeds(m.PROJECTILE_SPEEDS, m.BOOMERANG_RETURN_SPEED); }, () => {});
}
/**
 * Tiles per game second of a projectile kind ('boomerangReturn': a boomerang's way back): the sim's value, else
 * style.js PROJ (`speed`; the boomerang's `back`), else 15 for a boomerang (the sim's outbound speed) / 12.
 */
export function projSpeed(kind) {
  const v = simSpeeds ? Number(simSpeeds[kind]) : NaN;
  if (v > 0) return v;
  if (kind === 'boomerangReturn') return PROJ.boomerang?.back > 0 ? PROJ.boomerang.back : projSpeed('boomerang');
  const f = PROJ[kind]?.speed;
  return f > 0 ? f : kind === 'boomerang' ? 15 : 12;
}

const MAX_PARTICLES = { high: 1400, medium: 800, low: 360 };
const MAX_NUMBERS = 90;
/** Particle cap multiplier per adaptive load level (render/app.js loadLevel). */
const LOAD_PARTICLES = Object.freeze([1, 0.75, 0.55, 0.4]);
const NUM_RISE = 0.45;        // tiles a damage number rises over NUM_RISE_T (easeOut), then it stays
const NUM_RISE_T = 0.9;       // seconds of the rise
const NUM_LIFE = 0.9;         // seconds a number lives (a merged running total lives longer, ≤ NUM_MAX_LIFE)
const NUM_MAX_LIFE = 1.8;
const NUM_FADE_T = 0.27;      // fade-out at the end of its life
const NUM_LINE_EM = 0.95;     // vertical room of one line of digits, in em of the 24 px bitmap font
const NUM_MAX_LINES = 5;      // a number starts at most this many lines above the head
const NUM_DIGIT_EM = 0.66;    // advance of one digit of the damage font, in em (Bender 700: 0.56–0.66, the widest kept)
const NUM_POP = 1.35;         // birth / merge pop scale (the layout reserves the popped size)
const NUM_GAP_PX = 7;         // horizontal gap between two numbers side by side (never read as one number)
const NUM_MERGE_GAP = 0.3;    // s: same-style hits on one unit closer than this join its running total
const NUM_PER_TARGET = 4;     // live numbers per unit (then hits join / the oldest fades)
const NUM_CROWD = 6;          // more live numbers than this around a spot → shorter lives there
const NUM_LANES = Object.freeze([0, -1, 1, -2, 2]);   // lane order (lane widths from the unit's head)
/** Screen scale of a number's text (24 px font) at `s` px per tile. */
const numScale = (s, big, style) => clamp(s / 115, 0.42, 1.05) * (big ? 1.35 : 1) * (style === 'heal' ? 0.9 : 1);
const MAX_PROJ = 260;
/** Trail particles (and boomerang afterimages) per real second of one flying projectile (cosmetic). */
const TRAIL_HZ = 36;
/** Cosmetic particles stop at this share of the particle cap: the headroom stays for hits and bursts. */
const SOFT_CAP = 0.75;
/** Real seconds a shot lingers after arriving: the tracer shrinks into the target, the head fades (short shots read). */
const SHOT_FADE = 0.08;
/** Boomerang: spin (rad per real s), sideways bow of each leg (tiles, at ≥ 2 tiles range), safety lifetime (real s). */
const BOOM_SPIN = 22, BOOM_BOW = 0.35, BOOM_MAX_T = 6;
/**
 * Lock reticle: how long (game s) a lock outlives the last sign of its shooter's S3 going on — its latest lock, shell or
 * bombard (a lock whose shell / shot never comes) — its fade-out (real s), and the most reticles kept at once (a long
 * S3: ammo grants / reloads lock far more than the 5 base shots, ≤ 33 shells).
 */
const LOCK_T = 5, LOCK_FADE = 0.2, MAX_LOCKS = 48;
// 炎佑 fire jet: real s a jet burns past its tick's `dur` (the next 1 game s tick re-aims and extends it before it fades:
// one continuous stream), its fade-out, the most jets at once, the fire colours
const FLAME_TAIL = 0.2, FLAME_FADE = 0.15, MAX_FLAMES = 8;
const FLAME_TINTS = Object.freeze([0xffd27a, 0xffa94d, 0xff8a3d, 0xff5a2a]);
/** Bombard shell: share of its flight spent rising from the shooter, and the height it climbs / falls from (tiles). */
const SHELL_RISE = 0.34, SHELL_UP = 5.5;
/** 蕾缪安 S3 shell (fx 'bombardShell'); `look` 'mortar' is its own flight (_stepMortar). */
const BOMBARD_SHELL = Object.freeze({ look: 'mortar', tint: 0xfff2d8, glow: 0xff9c33, trail: 0xffb35c, smoke: 0x3a3430, len: 1.3, width: 0.3, head: 0.56 });
/**
 * An fx anchored on a unit (extra.id) is drawn at that unit's rendered position while the event's own (x, y) is within
 * this many tiles of it (it happens on the unit); farther away the fx happens at (x, y) — the sim puts the caster in
 * `id` of many area / target effects (an 'aoe' ahead of the caster, a 'crit' on the victim, 蕾缪安's 'bombard').
 */
const ANCHOR_SNAP = 0.75;
const SKILL_GOLD = 0xffd45a;
const NO_OPTS = Object.freeze({});
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/**
 * Shot heights (GitHub #61): where a shot or beam leaves a unit (`launch`, ≈ its hands) and where shots, beams and lock
 * marks meet a unit (`aim`, ≈ its chest), as shares of the drawn model's height above the feet (`_headTiles`). The
 * models are upright screen billboards, so these are heights on screen, solved into world heights through the camera
 * (projection.js liftFor, `bodyZ`): 0.45 × the head height taken as a WORLD height drew at ≈ 18 % of the model under the
 * 30° pitch — shots left the hips and aimed at the targets' hips. [ASSUMED] the shares (a battle chibi's hands / chest;
 * the data has no official muzzle points).
 */
export const SHOT_HEIGHT = Object.freeze({ launch: 0.45, aim: 0.5 });
/** World height of the point `frac` of a unit's drawn model height above its feet (SHOT_HEIGHT), seen through `cam`. */
export function bodyZ(cam, v, frac) {
  const z0 = (v.z || 0) + (v.hover || 0);
  const h = (v._headTiles || 1.2) * frac;
  if (!cam || typeof cam.liftFor !== 'function') return z0 + h;
  const dz = cam.liftFor(v.x, v.y, z0, h * cam.scaleAt(v.x, v.y, z0));
  return Number.isFinite(dz) ? z0 + dz : z0 + h;
}
/** World height just above a unit's feet (where shells land). */
const feetZ = (v) => (v.z || 0) + (v.hover || 0) + 0.2;
/** Cheap fingerprint of a camera's framing (the damage-number layout cache is reused only while it is unchanged). */
const camKey = (c) => (c ? c.tx + c.ty * 1e3 + c.tz * 1e6 + c.tilt * 7.13 + c.dist * 1e4 + c.scale * 3.7e-2 + c.cx * 1.1e-5 + c.cy * 1.3e-8 : 0);
/** Characters of a damage number as drawn (heals get a '+'). */
const numChars = (v, style) => String(Math.round(v)).length + (style === 'heal' ? 1 : 0);

/** Sub-professions whose attacks splash around the struck target (the 阵法术师 / 轰击术师 strike every enemy in range). */
const SPLASH_SUBS = new Set(['aoesniper', 'splashcaster', 'bombarder', 'fortress', 'hammer']);

let fontsReady = false;
/** Generate the damage-number bitmap fonts (after web fonts loaded, if possible). */
export function ensureDamageFonts() {
  if (fontsReady) return;
  const P = globalThis.PIXI;
  for (const st of Object.values(DMG_STYLE)) {
    try {
      P.BitmapFont.from(st.font, {
        fontFamily: ['Bender', 'Oxanium', 'Rajdhani', 'Arial Black', 'sans-serif'], fontSize: 44, fontWeight: '700',
        fill: st.fill, fillGradientStops: [0.25, 1], stroke: st.stroke, strokeThickness: 7,
        dropShadow: true, dropShadowColor: '#000000', dropShadowAlpha: 0.45, dropShadowDistance: 2, dropShadowBlur: 2,
      }, { chars: [['0', '9'], '+-×!'], resolution: 2, padding: 6 });
    } catch (err) { console.warn('[fx] bitmap font', st.font, err?.message || err); }
  }
  fontsReady = true;
}

const num = (v, d) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? n : d; };

/**
 * Sim fx kind → visual archetype (`a`), colour (`c`) and defaults (`r` radius, `dur` game s, `tex`, `smoke`).
 * Covers every kind emitted by server/sim (Battle, kits, tokens, enemies, bosses, devices, bonds, items); unknown
 * kinds fall back to a keyword guess, then to a generic sparkle (fxSpec).
 */
export const FX_KINDS = Object.freeze({
  // blasts
  aoe: { a: 'blast', c: 0xffb35c }, explode: { a: 'blast', c: 0xff7a33 }, explosion: { a: 'blast', c: 0xff7a33 },
  // `pt`: always at the event's (x, y) (its `id` is the shooter); `heavy`: debris + scorch
  bombard: { a: 'blast', c: 0xffa04a, r: 1.5, pt: true, heavy: true }, bombardShell: { a: 'shell', c: 0xff5a3a, r: 1.5, pt: true },
  airstrike: { a: 'blast', c: 0xff8a3d, r: 1.5, heavy: true }, splash: { a: 'blast', c: 0xffc27a },
  scorchBurst: { a: 'blast', c: 0xff6a2a }, champagneBomb: { a: 'blast', c: 0xffd27a }, shockBlast: { a: 'blast', c: 0x9fd4ff, smoke: 0x1c2630 },
  frostNova: { a: 'blast', c: 0x9fe6ff, smoke: 0x1c2630 }, sunBurst: { a: 'blast', c: 0xffe28a }, meltdown: { a: 'blast', c: 0xff5a2a, r: 1.5, heavy: true },
  iceSpike: { a: 'blast', c: 0xbfeeff, smoke: 0x1c2630 }, rockfall: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 }, rockslide: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 },
  finale: { a: 'blast', c: 0xffd45a, r: 1.5 }, swordStorm: { a: 'blast', c: 0xdfe8ff }, swordRain: { a: 'blast', c: 0xdfe8ff }, liberate: { a: 'blast', c: 0xffffff },
  quadShot: { a: 'volley', c: 0xfff2d0 }, featherArrow: { a: 'counter', c: 0xfff2d0 },
  burst: { a: 'element', c: 0xd0a0ff },
  // areas
  zone: { a: 'zone', c: 0xffb35c, dur: 3 }, healField: { a: 'zone', c: 0x62f08a, dur: 4 }, firewall: { a: 'wall', c: 0xff6a2a, dur: 4 },
  firewallBlock: { a: 'counter', c: 0xff6a2a }, tide: { a: 'zone', c: 0x5fe0ff, dur: 3, r: 2 }, storm: { a: 'zone', c: 0xd8c8a0, dur: 3 },
  tornado: { a: 'zone', c: 0xd8e8ff, dur: 3 }, snow: { a: 'zone', c: 0xe8f6ff, dur: 3 }, telegraph: { a: 'telegraph', c: 0xff3b30, dur: 1.2 },
  coldWind: { a: 'chill', c: 0x9fd4ff },
  // support
  heal: { a: 'heal', c: 0x62f08a }, healAoe: { a: 'healAoe', c: 0x62f08a, r: 1.5 }, bandage: { a: 'heal', c: 0x62f08a }, blessing: { a: 'healAoe', c: 0xfff0a8 },
  cleanse: { a: 'healAoe', c: 0xdfffff, r: 0.9 }, revive: { a: 'summon', c: 0xfff0a8 }, reborn: { a: 'summon', c: 0xffd45a }, hpShare: { a: 'heal', c: 0xff9aa6 },
  spGift: { a: 'sp', c: 0x6fd3ff }, spGain: { a: 'sp', c: 0x6fd3ff }, reload: { a: 'sp', c: 0xffe066 },
  shield: { a: 'shield', c: 0xdfe8ff }, catShield: { a: 'shield', c: 0xffe0a8 }, saltWard: { a: 'shield', c: 0xbfeeff }, shell: { a: 'shield', c: 0xc8b890 },
  vest: { a: 'shield', c: 0xdfe8ff }, sleepGuard: { a: 'shield', c: 0xa8b6ff }, truesilver: { a: 'shield', c: 0xfff3b8 }, shieldBreak: { a: 'shatter', c: 0xdfe8ff },
  // arrivals / departures
  summon: { a: 'summon', c: 0x9ff0dc }, drones: { a: 'summon', c: 0x8fe6ff }, drone: { a: 'summon', c: 0x8fe6ff }, sentry: { a: 'summon', c: 0x9ff0dc },
  turretOnline: { a: 'summon', c: 0xff8a6a }, yanyouSummon: { a: 'summon', c: 0xffb347 }, device: { a: 'summon', c: 0xc0c8cc },
  appear: { a: 'summon', c: 0xb36bff }, copy: { a: 'summon', c: 0xd8b0ff }, manifoldCopy: { a: 'summon', c: 0xd8b0ff }, split: { a: 'summon', c: 0xff9a6a },
  disappear: { a: 'vanish', c: 0xb36bff }, stealth: { a: 'vanish', c: 0x8fa0b0 }, camouflage: { a: 'vanish', c: 0x8fb08f }, phase: { a: 'vanish', c: 0xb36bff },
  substitute: { a: 'vanish', c: 0xd8b0ff }, swap: { a: 'blink', c: 0xd8b0ff }, blink: { a: 'blink', c: 0xb36bff }, teleport: { a: 'blink', c: 0xb36bff },
  // a dollkeeper knocked out as its <替身> (sim professions.js): only its model form goes back to the 本体 for the
  // redeploy — the 替身's death clip already shows the knock-out, nothing is drawn
  dollEnd: { a: 'none', c: 0xd8b0ff },
  ulpiaReturn: { a: 'blink', c: 0x9ff0dc }, manifoldSplit: { a: 'blink', c: 0xd8b0ff },
  // displacement
  pull: { a: 'move', c: 0x9fd4ff }, push: { a: 'move', c: 0xffd9a0 }, displace: { a: 'move', c: 0xd0c0a0 }, lure: { a: 'move', c: 0xffb3ec },
  charge: { a: 'move', c: 0xff9c33 }, dash: { a: 'move', c: 0xffd9a0 }, slippery: { a: 'move', c: 0x9fe6ff },
  // pulses
  sonic: { a: 'wave', c: 0xc9a2ff, r: 1.5 }, pulse: { a: 'wave', c: 0x9ff0dc }, sermon: { a: 'wave', c: 0xffe28a, r: 1.5 }, ripple: { a: 'wave', c: 0x5fe0ff },
  tornadoPulse: { a: 'wave', c: 0xd8e8ff }, wake: { a: 'wave', c: 0x5fe0ff }, wolfShadow: { a: 'wave', c: 0x8fa0b0 }, wolfShadowLost: { a: 'vanish', c: 0x8fa0b0 },
  redistribute: { a: 'wave', c: 0x62f08a }, dilemma: { a: 'wave', c: 0xc9a2ff },
  // marks
  taunt: { a: 'mark', c: 0xff9c33 }, palsy: { a: 'mark', c: 0xc77dff }, emergency: { a: 'mark', c: 0xff5a4a },
  lock: { a: 'reticle', c: 0xff5a4a }, droneLock: { a: 'reticle', c: 0x8fe6ff }, wanted: { a: 'reticle', c: 0xffc600 }, expose: { a: 'reticle', c: 0xff7b8a },
  reveal: { a: 'reticle', c: 0x9fd4ff }, anchor: { a: 'reticle', c: 0x9fd4ff },
  // buffs
  buff: { a: 'buff', c: 0xffd45a }, overload: { a: 'buff', c: 0xff7a33 }, overclock: { a: 'buff', c: 0xff9c33 }, talent: { a: 'buff', c: 0xffd45a },
  knack: { a: 'buff', c: 0xffd45a }, bloodBattle: { a: 'buff', c: 0xff4b3e }, sword: { a: 'buff', c: 0xdfe8ff }, equip: { a: 'buff', c: 0x4ed8af },
  garrisonGrant: { a: 'buff', c: 0x4ed8af }, extraAttack: { a: 'buff', c: 0xffe066 }, soul: { a: 'buff', c: 0xb36bff }, jungleSoul: { a: 'buff', c: 0x7fd37a },
  candle: { a: 'buff', c: 0xffb347 }, mote: { a: 'buff', c: 0xfff0a8 }, ember: { a: 'buff', c: 0xff7a33 }, ignite: { a: 'buff', c: 0xff6a2a },
  flame: { a: 'buff', c: 0xff6a2a }, grow: { a: 'buff', c: 0x7fd37a }, weightlessBuff: { a: 'buff', c: 0xcfe0ff },
  // 炎佑 祛恶之焰: a continuous jet from the dragon (`id`) onto its locked target (`target`) + a burning disc (_flame)
  yanyouFlame: { a: 'flame', c: 0xff8a3d, r: 1 },
  // states
  takeoff: { a: 'lift', c: 0xcfe0ff }, levitate: { a: 'lift', c: 0xcfe0ff }, weightless: { a: 'lift', c: 0xcfe0ff },
  sleep: { a: 'sleep', c: 0xa8b6ff }, crit: { a: 'crit', c: 0xffe066 },
  dodge: { a: 'dodge', c: 0xffffff }, riposte: { a: 'counter', c: 0xffd9a0 }, counter: { a: 'counter', c: 0xffd9a0 }, block: { a: 'counter', c: 0xdfe8ff },
  thorns: { a: 'counter', c: 0xff9aa6 }, downed: { a: 'down', c: 0xbfeee2 }, stone: { a: 'down', c: 0xc0b8a8, smoke: 0x5a5448 },
  dp: { a: 'dp', c: 0x9fd4ff }, coin: { a: 'coin', c: 0xffc600 }, steal: { a: 'coin', c: 0xffc600 }, crateBreak: { a: 'crate', c: 0xc89a5a },
  lpLoss: { a: 'lp', c: 0xff3b30 },
  // 限伤 (sim/damage.js leaderHitCancelled): a leader's hit of ≥ 300000 dealt nothing — the official shows no number and
  // no effect [ASSUMED], so nothing is drawn (`a: 'none'`)
  hitCap: { a: 'none', c: 0xffffff },
  // beams
  beam: { a: 'beam', c: 0xff7a5a }, link: { a: 'beam', c: 0x9ff0dc }, lightning: { a: 'bolt', c: 0xc9a2ff }, tentacle: { a: 'beam', c: 0x5fe0ff },
  sandChains: { a: 'beam', c: 0xd8c8a0 }, sandChainsCharged: { a: 'beam', c: 0xffd45a },
  strike: { a: 'strike', c: 0xffe6a8 }, volley: { a: 'volley', c: 0xfff2d0 }, column: { a: 'pillar', c: 0x9ff0dc }, obelisk: { a: 'pillar', c: 0xc9a2ff },
  duskDragon: { a: 'blast', c: 0x9dff6a, r: 1.5 }, shadowWeave: { a: 'vanish', c: 0x8f7bff }, reweave: { a: 'summon', c: 0x8f7bff },
  slash: { a: 'counter', c: 0xfff0d0 }, devour: { a: 'vanish', c: 0xff4b3e }, undying: { a: 'shield', c: 0xffd45a },
  // summon arrival bursts (content/tokens.js burst(): 沙之碑 default, 迷迭香 gear stun, 耀阳 sword, 纸偶)
  summonBurst: { a: 'blast', c: 0xe8c878, smoke: 0x4a3f33 }, summonStun: { a: 'blast', c: 0xcfe0ff, smoke: 0x2a2e36 },
  radiantSword: { a: 'pillar', c: 0xffe8a0 }, paperDoll: { a: 'blast', c: 0xc9a2ff, smoke: 0x2c2436 },
  // bonds / garrisons (support/index.js fxOn)
  bondMilestone: { a: 'buff', c: 0xffc600 }, bondProc: { a: 'buff', c: 0x4ed8af }, bondShare: { a: 'wave', c: 0x4ed8af },
  garrison: { a: 'buff', c: 0x4ed8af }, layer: { a: 'buff', c: 0xffe066 }, sp: { a: 'sp', c: 0x6fd3ff },
});

/** Keyword guesses for kinds added later (checked in order), before the generic sparkle. */
const FX_GUESS = [
  [/heal|cure|mend|regen/i, 'heal'], [/shield|ward|barrier|guard/i, 'shield'], [/summon|spawn|call|deploy/i, 'summon'],
  [/blast|bomb|explo|burst|boom|nova|strike/i, 'blast'], [/zone|field|area|wall|mist|fog|pool/i, 'zone'],
  [/buff|boost|power|rage|charge|up$/i, 'buff'], [/mark|lock|target|wanted|expose/i, 'reticle'], [/teleport|blink|warp|swap/i, 'blink'],
  [/stealth|hide|vanish|cloak/i, 'vanish'], [/pull|push|knock|dash|leap/i, 'move'], [/pulse|wave|ring|sonic/i, 'wave'],
];

/**
 * 'phase' (an enemy's mode change, render/units.js FORMS) kinds the model shows on its own: 暴鸰 'bombed' — its bomb is
 * the 'droneBomb' projectile of the same moment, a puff on the drone would read as something else (feedback D4).
 */
const SILENT_PHASES = new Set(['bombed']);

/** Visual spec of an fx kind (see FX_KINDS); `extra.kind` / `extra.element` may pick a better colour. */
export function fxSpec(kind, extra = {}) {
  const k = typeof kind === 'string' ? kind : '';
  if (k === 'phase' && SILENT_PHASES.has(extra && extra.kind)) return { a: 'none', c: 0xffffff };
  let spec = FX_KINDS[k];
  if (!spec) {
    const g = FX_GUESS.find(([re]) => re.test(k));
    spec = g ? { ...FX_KINDS[{ heal: 'heal', shield: 'shield', summon: 'summon', blast: 'aoe', zone: 'zone', buff: 'buff', reticle: 'lock', blink: 'blink', vanish: 'disappear', move: 'displace', wave: 'pulse' }[g[1]]] } : { a: 'generic', c: 0xfff2d0 };
  }
  const el = extra && extra.element;
  if (el && (spec.a === 'blast' || spec.a === 'zone' || spec.a === 'element')) {
    const c = el === 'burn' ? 0xff7a33 : el === 'neural' ? 0xff5ad0 : el === 'necrosis' || el === 'apoptosis' ? 0x9dff6a : el === 'erosion' ? 0x6fe0ff : null;
    if (c) spec = { ...spec, c };
  }
  if (extra && (extra.dmgType === 'arts' || /arts|magic/i.test(String(extra.kind || ''))) && spec.a === 'blast') spec = { ...spec, c: 0xc77dff };
  return spec;
}

/** Tiles covered by a blast / telegraph: `tiles` = [[r,c]…] or 'box' (Chebyshev ⌊r⌋ around the centre) or 'disc'. */
export function tilesAround(x, y, r, tiles) {
  if (Array.isArray(tiles)) return tiles.filter((t) => Array.isArray(t) && Number.isInteger(t[0]) && Number.isInteger(t[1])).slice(0, 80);
  const cr = Math.round(y), cc = Math.round(x), R = Math.max(0, Math.min(6, Math.floor(r)));
  const out = [];
  for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
    if (tiles === 'box' || dr * dr + dc * dc <= r * r + 0.25) out.push([cr + dr, cc + dc]);
  }
  return out;
}

/**
 * Tiles of a straight wall through tile (round(y), round(x)): `axis` 'col' = that column, 'row' = that row (余 S3
 * fire wall: perpendicular to his facing, sim/content/kits/tier6.js). Clipped to the field `rect` (inclusive
 * { r0, r1, c0, c1 }); without one ±4 tiles.
 */
export function wallTiles(x, y, axis, rect) {
  const R = Math.round(Number(y)), C = Math.round(Number(x));
  if (!Number.isFinite(R) || !Number.isFinite(C)) return [];
  const ok = rect && [rect.r0, rect.r1, rect.c0, rect.c1].every(Number.isFinite);
  const out = [];
  if (axis === 'row') {
    const [a, b] = ok ? [rect.c0, rect.c1] : [C - 4, C + 4];
    for (let c = a; c <= b; c++) out.push([R, c]);
  } else {
    const [a, b] = ok ? [rect.r0, rect.r1] : [R - 4, R + 4];
    for (let r = a; r <= b; r++) out.push([r, C]);
  }
  return out.filter(([r, c]) => r >= 0 && r <= 18 && c >= 0 && c <= 20);
}

export class FxSystem {
  /**
   * @param {{ P, layers: { groundFx, fxAdd, fxNormal, text, screen }, cam: () => any, view: (id) => any,
   *           heightAt: (r,c)=>number, settings: object, assets: any, timeScale: () => number,
   *           subProfOf: (defId) => string|null, screenSize: () => {width,height}, fieldTop: () => number }} ctx
   */
  constructor(ctx) {
    const P = ctx.P;
    this.ctx = ctx;
    this.P = P;
    this.atlas = fxAtlas();
    this.tex = this.atlas.tex;
    ensureDamageFonts();
    const props = { vertices: true, position: true, rotation: true, uvs: true, tint: true };
    this.addPc = new P.ParticleContainer(MAX_PARTICLES.high, props, 512, true);
    this.addPc.blendMode = P.BLEND_MODES.ADD;
    this.normPc = new P.ParticleContainer(MAX_PARTICLES.high, props, 512, true);
    // ground shadows of flying shells / boomerangs: normal blend, under the units and the smoke
    this.shadowLayer = new P.Container();
    ctx.layers.fxNormal.addChild(this.shadowLayer, this.normPc);
    ctx.layers.fxAdd.addChild(this.addPc);
    this.parts = [];          // active particle records { sp, add, x, y, vx, … }
    this.freeAdd = []; this.freeNorm = [];   // pooled particle records (their sprites stay in the containers)
    this.projs = [];
    this.projFree = [];
    this.projLayer = new P.Container();
    ctx.layers.fxAdd.addChild(this.projLayer);
    this.locks = [];          // lock-on reticles { view, id, src, x, y, z, t, idle, max, out, ring, core, shell }
    this.lockFree = [];
    this._po = {};            // options of the per-frame emitters (see _o)
    this.beams = new P.Graphics();
    this.beams.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.fxAdd.addChild(this.beams);
    this.beamList = [];
    this.flames = [];         // fire jets (炎佑 祛恶之焰) { src, tgt, x, y, z, r, col, t, end, disc, edge, … }
    this.nums = [];
    this._numPools = new Map();   // bitmap font → free number records
    this.auras = new Map();   // unit id → { sprite, ring, t }
    this.rings = [];          // ground rings { sprite, x, y, z, t, dur, r0, r1, tint }
    this.ringFree = [];
    this.pops = [];           // screen-space pops (bond glyphs, coins)
    this.zones = [];          // persistent ground areas (zone / telegraph fx)
    this.labels = [];         // floating '!' / '+n' labels
    this.tileFlashes = [];    // flashing tile sets (telegraphed boxes)
    this.tileGfx = new P.Graphics();
    this.tileGfx.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.groundFx.addChild(this.tileGfx);
    this.tintSprite = new P.Sprite(P.Texture.WHITE);
    this.tintSprite.alpha = 0;
    this.tintSprite.blendMode = P.BLEND_MODES.ADD;
    ctx.layers.screen.addChild(this.tintSprite);
    this.tintT = 0; this.tintDur = 1; this.tintA = 0;
    this.vignette = new P.Sprite(ctx.redVignette || P.Texture.EMPTY);
    this.vignette.alpha = 0;
    ctx.layers.screen.addChild(this.vignette);
    this.vigT = 0;
    this.time = 0;
    this._p = { x: 0, y: 0, s: 0, depth: 0 };
    this._q = { x: 0, y: 0, s: 0, depth: 0 };
    this._g = { x: 0, y: 0, s: 0, depth: 0 };
  }

  get quality() { return this.ctx.settings?.quality || 'high'; }
  /** The view's adaptive load level (0–3, render/app.js): a struggling device gets fewer particles / numbers. */
  get load() { return this.ctx.loadLevel ? this.ctx.loadLevel() | 0 : 0; }
  get maxParticles() { return Math.round((MAX_PARTICLES[this.quality] || MAX_PARTICLES.high) * LOAD_PARTICLES[Math.min(3, this.load)]); }
  /** Cosmetic extras on (trails, muzzle flashes, afterimages, debris, scorch, motes): not at 'low', not under heavy load. */
  get rich() { return this.quality !== 'low' && this.load < 2; }
  /** Room for one more cosmetic particle (SOFT_CAP keeps the rest of the cap for hits and bursts). */
  _room() { return this.parts.length < this.maxParticles * SOFT_CAP; }
  /** Battle clock rate (game s per real s, ≈ 2 in combat). */
  _ts() { const r = this.ctx.timeScale ? Number(this.ctx.timeScale()) : 2; return r > 0.25 ? r : 0.25; }
  /** Ground height of the tile under (x, y). */
  _groundZ(x, y) { return this.ctx.heightAt ? (this.ctx.heightAt(Math.round(y), Math.round(x)) || 0) : 0; }

  // ---- particles ------------------------------------------------------------------------------------------

  /**
   * Spawn a screen-space particle; returns its record (set `sx` on it to mirror). `o` is only read (the per-frame
   * emitters pass the shared _o() object). Records are pooled with their sprite; at the cap the oldest is recycled.
   */
  particle(tex, x, y, o = NO_OPTS) {
    if (this.parts.length >= this.maxParticles) this._freeParticle(this.parts.shift());
    const add = o.add !== false;
    const t = this.tex[tex] || this.tex.dot;
    let p = (add ? this.freeAdd : this.freeNorm).pop();
    if (!p) {
      const sp = new this.P.Sprite(t);
      (add ? this.addPc : this.normPc).addChild(sp);
      p = { sp, add };
    }
    const sp = p.sp;
    sp.texture = t;
    sp.anchor.set(o.anchorX ?? 0.5, o.ay ?? 0.5);
    sp.visible = true;
    sp.position.set(x, y);
    sp.tint = o.tint ?? 0xffffff;
    sp.rotation = o.rot ?? 0;
    p.x = x; p.y = y; p.vx = o.vx || 0; p.vy = o.vy || 0; p.g = o.g || 0; p.drag = o.drag ?? 0; p.life = 0; p.max = o.life || 0.5;
    p.s0 = o.s0 ?? 1; p.s1 = o.s1 ?? o.s0 ?? 1; p.sx = o.sx ?? 1; p.a0 = o.a0 ?? 1; p.a1 = o.a1 ?? 0; p.spin = o.spin || 0; p.fadeIn = o.fadeIn || 0;
    sp.scale.set(p.s0 * p.sx, p.s0);
    sp.alpha = p.fadeIn > 0 ? 0 : p.a0;
    this.parts.push(p);
    return p;
  }

  /** The shared options object of the per-frame emitters, reset to the defaults (particle() never keeps it). */
  _o() {
    const o = this._po;
    o.add = true; o.tint = 0xffffff; o.vx = 0; o.vy = 0; o.g = 0; o.drag = 0; o.life = 0.5; o.s0 = 1; o.s1 = 1; o.sx = 1;
    o.a0 = 1; o.a1 = 0; o.spin = 0; o.fadeIn = 0; o.rot = 0; o.anchorX = 0.5; o.ay = 0.5;
    return o;
  }

  _freeParticle(p) {
    // Pixi's ParticleRenderer draws every child of the container (it never reads `visible`): a freed sprite becomes a
    // zero-size, fully transparent quad — no pixels, no fill cost — until the record is reused
    const sp = p.sp;
    sp.visible = false;
    sp.alpha = 0;
    sp.scale.set(0, 0);
    (p.add ? this.freeAdd : this.freeNorm).push(p);
  }

  _updateParticles(dt) {
    const list = this.parts;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) { this._freeParticle(p); continue; }
      const k = p.life / p.max;
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const sp = p.sp;
      sp.position.set(p.x, p.y);
      const s = p.s0 + (p.s1 - p.s0) * k;
      sp.scale.set(s * p.sx, s);
      if (p.spin) sp.rotation += p.spin * dt;
      let a = p.a0 + (p.a1 - p.a0) * k;
      if (p.fadeIn > 0 && p.life < p.fadeIn) a *= p.life / p.fadeIn;
      sp.alpha = clamp(a, 0, 1);
      list[w++] = p;
    }
    list.length = w;
  }

  // ---- helpers ------------------------------------------------------------------------------------------

  _proj(x, y, z, out = this._p) { return this.ctx.cam().project(x, y, z, out); }

  /** Ground decals: on a raised top they are drawn with that block row (tiles.surfaceLayer), else in groundFx. */
  _onGround(sp, y, z) {
    let layer = this.ctx.layers.groundFx;
    if (z > 0.12 && this.ctx.surfaceLayer) layer = this.ctx.surfaceLayer(Math.round(y)) || layer;
    if (sp.parent !== layer) layer.addChild(sp);
  }

  _chest(view, out = this._p) {
    const z = (view.z || 0) + (view.hover || 0) + (view._headTiles ? view._headTiles * 0.45 : 0.5);
    return this._proj(view.x, view.y, z, out);
  }

  /** Screen point `frac` of a unit's drawn model height above its feet (SHOT_HEIGHT: beams, a mortar's muzzle). */
  _bodyPt(view, frac, out = this._p) {
    const p = this._proj(view.x, view.y, (view.z || 0) + (view.hover || 0), out);
    p.y -= (view._headTiles || 1.2) * frac * p.s;
    return p;
  }

  /** `n` sparks flying out of a screen point (halved at quality 'low'); o: speed, up, g, life, size, tex. */
  burst(x, y, s, n, tint, o = NO_OPTS) {
    const q = this.quality === 'low' ? Math.ceil(n / 2) : n;
    const speed = o.speed ?? 2.2, up = o.up ?? 0, g = (o.g ?? 0) * s, life = o.life ?? 0.35, size = (s / 64) * (o.size ?? 0.45), tex = o.tex || 'spark';
    for (let i = 0; i < q; i++) {
      const a = Math.random() * Math.PI * 2, v = s * speed * (0.4 + Math.random() * 0.8);
      const po = this._o();
      po.tint = tint; po.vx = Math.cos(a) * v; po.vy = Math.sin(a) * v * 0.7 - up * s; po.drag = 3; po.g = g;
      po.life = life * (0.7 + Math.random() * 0.6); po.s0 = size; po.s1 = (s / 64) * 0.05; po.spin = (Math.random() - 0.5) * 8;
      this.particle(tex, x, y, po);
    }
  }

  // ---- projectiles -----------------------------------------------------------------------------------------

  /** b.ev 'atk' visual. src/tgt are views (tgt may be null). */
  attack(src, tgt, kind) {
    if (!src) return;
    // chain: the source is the previous target of the bounce (sim ai.js), so the arc hops unit to unit
    if (kind === 'chain' || kind === 'chainHeal') { if (tgt && tgt !== src) this._beam(src, tgt, kind === 'chainHeal' ? 0x7dffa8 : 0xc9a2ff, 0.22, 1, true); return; }
    if (kind === 'beam') { if (tgt && tgt !== src) this._beam(src, tgt, src.isEnemy ? 0xff7a5a : 0xffe6a8, 0.18, 0.15); return; }
    const spec = PROJ[kind];
    if (!spec || !tgt) {
      if (kind === 'none' || !kind) this._slashAt = src.id;
      return;
    }
    const pr = this._takeProj();
    const cam = this.ctx.cam();
    const dx = tgt.x - src.x, dy = tgt.y - src.y;
    const dist = Math.hypot(dx, dy);
    const ux = dist > 1e-6 ? dx / dist : (src.facing || 1) >= 0 ? 1 : -1, uy = dist > 1e-6 ? dy / dist : 0;
    const hand = Math.min(0.28, dist * 0.3);   // the weapon is in front of the body
    const look = spec.look;
    pr.kind = kind; pr.spec = spec; pr.src = src; pr.tgt = tgt; pr.rise = 0;
    pr.x0 = src.x + ux * hand; pr.y0 = src.y + uy * hand; pr.z0 = bodyZ(cam, src, SHOT_HEIGHT.launch);
    pr.tx = tgt.x; pr.ty = tgt.y; pr.tz = look === 'shell' ? feetZ(tgt) : bodyZ(cam, tgt, SHOT_HEIGHT.aim);
    pr.t = 0; pr.fade = 0; pr.hit = false; pr.emit = Math.random(); pr.ang = Math.atan2(-uy, ux);   // ≈ on screen (rows run up)
    pr.dur = clamp(dist / projSpeed(kind) / this._ts(), 0.04, 1.5);
    pr.arc = spec.arc ? spec.arc * clamp(0.45 + dist * 0.18, 0.6, 1.8) : 0;
    pr.glow = spec.glow;
    pr.trailTint = spec.trail ?? spec.glow;
    // boomerang legs: kinematic, from (bx, by, bz) at constant speed towards the target, then back to the thrower
    pr.phase = 0; pr.bx = pr.x0; pr.by = pr.y0; pr.bz = pr.z0; pr.trav = 0; pr.d0 = Math.max(0.1, dist); pr.ux = ux; pr.uy = uy;
    pr.spin = Math.random() * 6;
    this._dressProj(pr);
    this.projs.push(pr);
    if (this.rich) this._muzzle(pr);
  }

  /** A pooled projectile record: trail + halo + core sprites (additive, above units) and a ground shadow. */
  _takeProj() {
    if (this.projs.length >= MAX_PROJ) this._releaseProj(this.projs.shift());
    let pr = this.projFree.pop();
    if (!pr) {
      const P = this.P;
      const add = (tex, ax) => {
        const sp = new P.Sprite(this.tex[tex]);
        sp.anchor.set(ax, 0.5);
        sp.blendMode = P.BLEND_MODES.ADD;
        sp.visible = false;
        return sp;
      };
      const trail = add('tracer', 1), halo = add('glow', 0.5), core = add('orb', 0.5);
      this.projLayer.addChild(trail, halo, core);
      const shadow = new P.Sprite(this.tex.soft);
      shadow.anchor.set(0.5);
      shadow.tint = 0x000000;
      shadow.visible = false;
      this.shadowLayer.addChild(shadow);
      pr = { trail, halo, core, shadow };
    }
    return pr;
  }

  /** Textures / tints of a projectile's sprites for its look (shown from its first update). */
  _dressProj(pr) {
    const spec = pr.spec, look = spec.look;
    const thin = look === 'tracer' || look === 'dart';
    const { trail, halo, core, shadow } = pr;
    trail.texture = this.tex[thin ? 'tracer' : 'streak'];
    trail.tint = thin ? spec.tint : pr.trailTint;
    trail.visible = look !== 'boomerang';
    halo.texture = this.tex.glow;
    halo.tint = pr.glow;
    halo.visible = true;
    core.texture = this.tex[look === 'boomerang' ? 'boomerang' : thin ? 'dot' : 'orb'];
    core.tint = spec.tint;
    core.rotation = 0;
    core.visible = true;
    shadow.visible = look === 'shell' || look === 'boomerang';
    trail.alpha = halo.alpha = core.alpha = shadow.alpha = 0;
  }

  _releaseProj(pr) {
    pr.trail.visible = pr.halo.visible = pr.core.visible = pr.shadow.visible = false;
    pr.src = pr.tgt = null;
    this.projFree.push(pr);
  }

  _updateProjs(dt) {
    if (!this.projs.length) return;
    const cam = this.ctx.cam();
    const rich = this.rich;
    let w = 0;
    for (let i = 0; i < this.projs.length; i++) {
      const pr = this.projs[i];
      const look = pr.spec.look;
      const live = look === 'boomerang' ? this._stepBoomerang(pr, dt, cam, rich)
        : look === 'mortar' ? this._stepMortar(pr, dt, cam, rich) : this._stepShot(pr, dt, cam, rich);
      if (!live) { this._releaseProj(pr); continue; }
      this.projs[w++] = pr;
    }
    this.projs.length = w;
  }

  /** Screen point of a straight / lobbed shot at flight fraction k (a parabola of height `arc` over the line). */
  _shotPoint(pr, k, cam, out) {
    const x = pr.x0 + (pr.tx - pr.x0) * k, y = pr.y0 + (pr.ty - pr.y0) * k;
    const z = pr.z0 + (pr.tz - pr.z0) * k + (pr.arc ? pr.arc * 4 * k * (1 - k) : 0);
    return cam.project(x, y, z, out);
  }

  /**
   * One frame of a tracer / orb / shell / dart: placed by flight time (homing on the target), trail behind the head
   * along the path (never longer than the part flown), an arrival burst, then a SHOT_FADE linger in the target.
   */
  _stepShot(pr, dt, cam, rich) {
    const spec = pr.spec, look = spec.look;
    pr.t += dt;
    const tg = pr.tgt;
    if (tg && !tg.destroyed && tg.alive !== false) { pr.tx = tg.x; pr.ty = tg.y; pr.tz = look === 'shell' ? feetZ(tg) : bodyZ(cam, tg, SHOT_HEIGHT.aim); }
    const k = Math.min(1, pr.t / pr.dur);
    if (k >= 1 && !pr.hit) { pr.hit = true; pr.fade = 0; this._impact(pr, cam); }
    let fk = 0;
    if (pr.hit) { pr.fade += dt; fk = pr.fade / SHOT_FADE; if (fk >= 1) return false; }
    const p = this._shotPoint(pr, k, cam, this._p);
    const kb = Math.max(0, k - (pr.arc ? 0.12 : 0.25));
    const q = this._shotPoint(pr, kb, cam, this._q);
    const s = p.s, px = p.x, py = p.y;
    const seg = Math.hypot(px - q.x, py - q.y);
    if (seg > 0.5) pr.ang = Math.atan2(py - q.y, px - q.x);
    const thin = look === 'tracer' || look === 'dart';
    const flown = k > kb ? seg * (k / (k - kb)) : 0;
    const L = Math.min(spec.len * s, flown) * (1 - fk);
    const tr = pr.trail;
    tr.position.set(px, py);
    tr.rotation = pr.ang;
    tr.scale.set(Math.max(0.001, L / 128), (spec.width * s) / (thin ? 16 : 20));
    tr.alpha = (thin ? 1 : 0.85) * (1 - fk);
    const hs = spec.head * s;
    const halo = pr.halo;
    halo.position.set(px, py);
    halo.scale.set((hs / 128) * (1 + 0.12 * Math.sin(pr.t * 40)));
    halo.alpha = 0.85 * (1 - fk);
    const core = pr.core;
    core.position.set(px, py);
    if (thin) core.scale.set((hs * 0.5) / 32);
    else if (look === 'shell') { core.rotation = pr.ang; core.scale.set((hs * 0.85) / 64, (hs * 0.55) / 64); }   // a shell along its flight
    else core.scale.set((hs * 0.62) / 64);
    core.alpha = 1 - fk;
    if (look === 'shell') {
      // its shadow on the ground under it: bigger and darker the lower it flies
      const gx = pr.x0 + (pr.tx - pr.x0) * k, gy = pr.y0 + (pr.ty - pr.y0) * k;
      const g = cam.project(gx, gy, this._groundZ(gx, gy) + 0.01, this._g);
      const near = 1 - clamp((pr.arc * 4 * k * (1 - k)) / Math.max(0.3, pr.arc), 0, 1);
      const r = g.s * (0.17 + 0.13 * near);
      const sh = pr.shadow;
      sh.position.set(g.x, g.y);
      sh.scale.set((r * 2) / 128, (r * 0.9) / 128);
      sh.alpha = (0.32 + 0.3 * near) * (1 - fk);
    }
    if (rich && !pr.hit && !thin) {
      pr.emit += dt * TRAIL_HZ;
      for (let n = 0; pr.emit >= 1 && n < 2; n++) {
        pr.emit -= 1;
        if (!this._room()) { pr.emit = 0; break; }
        if (look === 'shell') this._puff(px, py, s, pr.trailTint, spec.smoke, n);
        else this._mote(px, py, s, pr.trailTint, spec.width);
      }
    }
    return true;
  }

  /**
   * 回环射手 (sim ai.js throwBoomerang): out to the (moving) target at the boomerang speed, a hit flash, then back to the
   * thrower's current position at the return speed (PRTS 跃跃: 15 out, 3.75 back); gone when caught — or at once when
   * the thrower's view is gone (the sim drops a boomerang whose thrower left). Each leg bows sideways (left of its own
   * direction, so out and back form a loop); it spins, leaves afterimages and a shadow.
   */
  _stepBoomerang(pr, dt, cam, rich) {
    const spec = pr.spec;
    pr.t += dt;
    if (pr.t > BOOM_MAX_T) return false;
    const step = projSpeed(pr.phase ? 'boomerangReturn' : pr.kind) * this._ts() * dt;
    let gx, gy, gz;
    if (pr.phase === 0) {
      const tg = pr.tgt;
      if (tg && !tg.destroyed && tg.alive !== false) { pr.tx = tg.x; pr.ty = tg.y; pr.tz = bodyZ(cam, tg, SHOT_HEIGHT.aim); }
      gx = pr.tx; gy = pr.ty; gz = pr.tz;
    } else {
      const sv = pr.src;
      if (!sv || sv.destroyed || sv.alive === false) return false;
      gx = sv.x; gy = sv.y; gz = bodyZ(cam, sv, SHOT_HEIGHT.launch);
    }
    const dx = gx - pr.bx, dy = gy - pr.by, dz = gz - pr.bz;
    const d = Math.hypot(dx, dy, dz);
    if (d <= step) {
      pr.bx = gx; pr.by = gy; pr.bz = gz;
      if (pr.phase === 1) { this._catch(pr, cam); return false; }
      this._impact(pr, cam);
      // turn back: the next leg runs from here to the thrower (a thrower already gone gets nothing back)
      const sv = pr.src;
      if (!sv || sv.destroyed || sv.alive === false) return false;
      const bx = sv.x - gx, by = sv.y - gy;
      const bd = Math.hypot(bx, by);
      pr.phase = 1; pr.trav = 0; pr.d0 = Math.max(0.1, bd);
      if (bd > 1e-6) { pr.ux = bx / bd; pr.uy = by / bd; } else { pr.ux = -pr.ux; pr.uy = -pr.uy; }
    } else {
      pr.bx += (dx / d) * step; pr.by += (dy / d) * step; pr.bz += (dz / d) * step;
      pr.trav += step;
    }
    const arcK = Math.sin(clamp(pr.trav / pr.d0, 0, 1) * Math.PI);
    const bow = arcK * BOOM_BOW * Math.min(1, pr.d0 / 2);
    const x = pr.bx - pr.uy * bow, y = pr.by + pr.ux * bow, z = pr.bz + arcK * 0.12;
    const p = cam.project(x, y, z, this._p);
    const px = p.x, py = p.y, hs = spec.head * p.s;
    pr.spin += BOOM_SPIN * dt;
    const core = pr.core;
    core.position.set(px, py);
    core.rotation = pr.spin;
    core.scale.set(hs / 64);
    core.alpha = 1;
    const halo = pr.halo;
    halo.position.set(px, py);
    halo.scale.set((hs * 1.5) / 128);
    halo.alpha = 0.4;
    const g = cam.project(x, y, this._groundZ(x, y) + 0.01, this._g);
    const sh = pr.shadow;
    sh.position.set(g.x, g.y);
    sh.scale.set((g.s * 0.4) / 128, (g.s * 0.18) / 128);
    sh.alpha = 0.22;
    if (rich) {
      pr.emit += dt * TRAIL_HZ;
      if (pr.emit >= 1) {
        pr.emit = Math.min(1, pr.emit - 1);
        if (this._room()) {
          const o = this._o();
          o.tint = spec.glow; o.life = 0.14; o.s0 = hs / 64; o.s1 = (hs / 64) * 0.9; o.a0 = 0.4; o.rot = pr.spin;
          this.particle('boomerang', px, py, o);
        }
      }
    }
    return true;
  }

  /**
   * One frame of a 蕾缪安 bombard shell: a long flight first streaks up out of the shooter (`rise` of it, following
   * her); then it falls onto its spot, faster and faster, its shadow growing there. It ends at the impact — the
   * explosion (and the end of its lock) is the sim's own 'bombard' fx.
   */
  _stepMortar(pr, dt, cam, rich) {
    const spec = pr.spec;
    pr.t += dt;
    const k = pr.t / pr.dur;
    if (k >= 1) return false;
    let x, y, z, zq;
    if (k < pr.rise) {
      const u = k / pr.rise, ub = Math.max(0, u - 0.25);
      const sv = pr.src;
      if (sv && !sv.destroyed) { pr.x0 = sv.x; pr.y0 = sv.y; }
      x = pr.x0; y = pr.y0;
      z = pr.z0 + SHELL_UP * (1 - (1 - u) * (1 - u));          // out of the barrel fast, slowing as it climbs
      zq = pr.z0 + SHELL_UP * (1 - (1 - ub) * (1 - ub));
    } else {
      const u = (k - pr.rise) / (1 - pr.rise), ub = Math.max(0, u - 0.25);
      x = pr.tx; y = pr.ty;
      z = pr.tz + SHELL_UP * (1 - u * u);                       // falling faster and faster
      zq = pr.tz + SHELL_UP * (1 - ub * ub) + 0.3;
      const g = cam.project(x, y, pr.tz + 0.01, this._g);
      const r = g.s * (0.12 + 0.3 * u);
      const sh = pr.shadow;
      sh.visible = true;
      sh.position.set(g.x, g.y);
      sh.scale.set((r * 2) / 128, (r * 0.9) / 128);
      sh.alpha = 0.12 + 0.36 * u;
    }
    const p = cam.project(x, y, z, this._p);
    const q = cam.project(x, y, zq, this._q);
    const s = p.s, px = p.x, py = p.y;
    const seg = Math.hypot(px - q.x, py - q.y);
    if (seg > 0.5) pr.ang = Math.atan2(py - q.y, px - q.x);
    const tr = pr.trail;
    tr.position.set(px, py);
    tr.rotation = pr.ang;
    tr.scale.set(Math.max(0.001, Math.min(spec.len * s, seg * 1.6) / 128), (spec.width * s) / 20);
    tr.alpha = 0.95;
    const hs = spec.head * s;
    pr.halo.position.set(px, py);
    pr.halo.scale.set((hs / 128) * (1 + 0.15 * Math.sin(pr.t * 50)));
    pr.halo.alpha = 0.95;
    pr.core.position.set(px, py);
    pr.core.rotation = pr.ang;
    pr.core.scale.set((hs * 0.85) / 64, (hs * 0.5) / 64);
    pr.core.alpha = 1;
    if (rich) {
      pr.emit += dt * TRAIL_HZ;
      for (let n = 0; pr.emit >= 1 && n < 2; n++) {
        pr.emit -= 1;
        if (!this._room()) { pr.emit = 0; break; }
        this._puff(px, py, s, spec.trail, spec.smoke, n);
      }
    }
    return true;
  }

  /** Trail mote behind an orb (additive dot, drifting a little). */
  _mote(x, y, s, tint, width) {
    const o = this._o();
    const j = s * width * 0.25;
    o.tint = tint; o.life = 0.28; o.s0 = (s * width * 0.75) / 32; o.s1 = 0; o.a0 = 0.8;
    o.vx = (Math.random() - 0.5) * s * 0.25; o.vy = (Math.random() - 0.5) * s * 0.25;
    this.particle('dot', x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, o);
  }

  /** Trail of a shell: alternately a hot ember (additive) and a grey smoke puff (normal blend). */
  _puff(x, y, s, tint, smoke, n) {
    const o = this._o();
    if ((n + (this.parts.length & 1)) & 1) {
      o.tint = tint; o.life = 0.24; o.s0 = (s * 0.16) / 32; o.s1 = 0; o.a0 = 0.9;
      this.particle('dot', x, y, o);
    } else {
      o.add = false; o.tint = smoke ?? 0x3a3430; o.life = 0.55; o.s0 = (s * 0.22) / 128; o.s1 = (s * 0.55) / 128; o.a0 = 0.45;
      o.vy = -s * 0.25; o.spin = (Math.random() - 0.5) * 2; o.rot = Math.random() * 6;
      this.particle('smoke', x, y, o);
    }
  }

  /** Flash at the shooter as a shot leaves (tracers: an oriented muzzle cone). Cosmetic. */
  _muzzle(pr) {
    const spec = pr.spec, look = spec.look;
    if (!spec.muzzle) return;
    const cam = this.ctx.cam();
    const p = cam.project(pr.x0, pr.y0, pr.z0, this._g);
    const px = p.x, py = p.y, s = p.s;
    if (look === 'tracer') {
      const q = cam.project(pr.tx, pr.ty, pr.tz, this._q);
      this.particle('muzzle', px, py, { tint: spec.muzzle, life: 0.09, s0: (s / 64) * 0.55, s1: (s / 64) * 0.72, a0: 1, a1: 0, rot: Math.atan2(q.y - py, q.x - px), anchorX: 0.19 });
      this.particle('glow', px, py, { tint: spec.muzzle, life: 0.1, s0: (s / 128) * 0.45, s1: (s / 128) * 0.7, a0: 0.9, a1: 0 });
    } else {
      this.particle('glow', px, py, { tint: pr.glow === spec.glow ? spec.muzzle : pr.glow, life: 0.16, s0: (s / 128) * 0.45, s1: (s / 128) * 0.8, a0: 0.9, a1: 0 });
      if (look === 'shell') this.smoke(px, py, s * 0.28, spec.smoke ?? 0x2a2522, 0.3);
    }
  }

  /** Arrival burst of a shot (PROJ `hit`): at the target, or the ground under it for shells. */
  _impact(pr, cam) {
    const spec = pr.spec;
    const p = cam.project(pr.tx, pr.ty, pr.tz, this._g);
    const x = p.x, y = p.y, s = p.s;
    const rich = this.rich;
    switch (spec.hit) {
      case 'arts':
        this.particle('glow', x, y, { tint: pr.glow, life: 0.24, s0: (s / 128) * 0.7, s1: (s / 128) * 1.2, a0: 0.95, a1: 0 });
        this.particle('shock', x, y, { tint: pr.glow, life: 0.26, s0: (s / 128) * 0.25, s1: (s / 128) * 1.05, a0: 0.9, a1: 0 });
        if (rich) this.burst(x, y, s, 4, pr.trailTint, { speed: 2.2, life: 0.3, tex: 'dot', size: 0.35 });
        break;
      case 'heal': {
        this.particle('glow', x, y, { tint: spec.glow, life: 0.3, s0: (s / 128) * 0.6, s1: (s / 128) * 1.1, a0: 0.9, a1: 0 });
        this.particle('flare', x, y, { tint: 0xc8ffd8, life: 0.22, s0: (s / 128) * 0.9, s1: (s / 128) * 0.3, a0: 1, a1: 0, rot: Math.random() });
        const n = rich ? 3 : 1;
        for (let i = 0; i < n; i++) {
          this.particle('plus', x + (Math.random() - 0.5) * s * 0.45, y - Math.random() * s * 0.2, { tint: 0x7dffa8, vy: -s * 0.8, life: 0.6, s0: (s / 64) * 0.26, s1: (s / 64) * 0.14, a0: 0.95, a1: 0, fadeIn: 0.05 });
        }
        break;
      }
      case 'boom': this.explosion(pr.tx, pr.ty, this._groundZ(pr.tx, pr.ty), 1, pr.glow, { smoke: spec.smoke, small: true }); break;
      case 'splash': this.explosion(pr.tx, pr.ty, this._groundZ(pr.tx, pr.ty), 0.7, pr.glow, { smoke: spec.smoke, small: true }); break;
      case 'zap':
        this.particle('flare', x, y, { tint: spec.glow, life: 0.16, s0: (s / 128) * 0.7, s1: (s / 128) * 0.25, a0: 1, a1: 0, rot: Math.random() });
        if (rich) this.burst(x, y, s, 3, spec.glow, { speed: 2.4, life: 0.22, size: 0.35 });
        break;
      case 'enemy':
        this.particle('glow', x, y, { tint: spec.glow, life: 0.2, s0: (s / 128) * 0.6, s1: (s / 128) * 1.0, a0: 0.9, a1: 0 });
        this.particle('flare', x, y, { tint: 0xffb0a0, life: 0.16, s0: (s / 128) * 0.8, s1: (s / 128) * 0.3, a0: 1, a1: 0, rot: Math.random() });
        break;
      default:   // 'spark': bullets, boomerang hits (the hit's own sparks come with its damage number)
        this.particle('flare', x, y, { tint: spec.glow, life: 0.11, s0: (s / 128) * 0.55, s1: (s / 128) * 0.2, a0: 1, a1: 0, rot: Math.random() });
    }
  }

  /** The thrower caught its boomerang: a small flash in its hands. */
  _catch(pr, cam) {
    const p = cam.project(pr.bx, pr.by, pr.bz, this._g);
    this.particle('flare', p.x, p.y, { tint: pr.spec.glow, life: 0.12, s0: (p.s / 128) * 0.6, s1: (p.s / 128) * 0.2, a0: 0.9, a1: 0, rot: Math.random() });
  }

  /**
   * 蕾缪安 S3 shell (fx 'bombardShell'): fired now by `src` (its view, or null) at the spot (x, y), where it lands after
   * `flight` real seconds (_stepMortar; the sim's shells fly 0.3 game s — they drop out of the sky, a launch streak
   * leaving the shooter; a flight ≥ 0.45 real s climbs out of her first). The spot gets a thin ring closing in and
   * brightening plus the blast radius throbbing until the impact. The shell takes the shooter's lock on that spot: the
   * lock ends with this shell's 'bombard' (_landed).
   */
  mortar(src, x, y, r, flight) {
    const pr = this._takeProj();
    const gz = this._groundZ(x, y);
    pr.kind = 'bombardShell'; pr.spec = BOMBARD_SHELL; pr.src = src; pr.tgt = null;
    pr.x0 = src ? src.x : x; pr.y0 = src ? src.y : y; pr.z0 = src ? bodyZ(this.ctx.cam(), src, SHOT_HEIGHT.launch) : gz + 0.5;
    pr.tx = x; pr.ty = y; pr.tz = gz;
    pr.t = 0; pr.dur = clamp(flight, 0.1, 4); pr.fade = 0; pr.hit = false; pr.emit = 0; pr.arc = 0; pr.ang = Math.PI / 2;
    pr.rise = pr.dur >= 0.45 ? SHELL_RISE : 0;
    pr.glow = BOMBARD_SHELL.glow; pr.trailTint = BOMBARD_SHELL.trail;
    const L = this._nearestLock(src ? src.id : null, x, y, 3, true);
    if (L) { L.shell = true; L.sx = x; L.sy = y; }
    this._dressProj(pr);
    pr.shadow.visible = false;
    this.projs.push(pr);
    const rr = Math.max(0.5, r);
    this.ring(x, y, gz, rr, rr * 0.22, 0xff5a3a, pr.dur, 'shock', 'in');
    this.ring(x, y, gz, rr * 0.96, rr, 0xff7a4a, pr.dur, 'ring', 'pulse');
    if (src && this.rich) {
      // the shot leaves her upwards: a muzzle flash and a streak climbing out of sight
      const p = this._bodyPt(src, SHOT_HEIGHT.launch, this._g);
      const s = p.s;
      this.particle('muzzle', p.x, p.y, { tint: 0xffc27a, life: 0.1, s0: (s / 64) * 0.6, s1: (s / 64) * 0.8, a0: 1, a1: 0, rot: -Math.PI / 2, anchorX: 0.19 });
      this.particle('glow', p.x, p.y, { tint: 0xffb35c, life: 0.14, s0: (s / 128) * 0.5, s1: (s / 128) * 0.9, a0: 0.9, a1: 0 });
      this.particle('tracer', p.x, p.y, { tint: 0xffe0b0, life: 0.16, vy: -s * 16, s0: (s * 0.3) / 16, s1: (s * 0.24) / 16, sx: (1.3 * 16) / (0.3 * 128), a0: 1, a1: 0.2, rot: -Math.PI / 2, anchorX: 1 });
    }
    return pr;
  }

  /**
   * fx 'bombard' (the impact) at (x, y) by shooter `src`: the shell falling there has landed (ended now if still in
   * the air) and its lock goes — the lock that shell took, found by the landing point (the sim uses the same spot for
   * both events); a sim without 'bombardShell' releases the shooter's lock nearest to the spot.
   */
  _landed(src, x, y, r) {
    for (const pr of this.projs) {
      if (pr.spec !== BOMBARD_SHELL || (src != null && pr.src && pr.src.id !== src)) continue;
      if (Math.hypot(pr.tx - x, pr.ty - y) < 0.05) pr.t = Math.max(pr.t, pr.dur);
    }
    let best = null, bd = Infinity;
    for (const L of this.locks) {
      if (L.out >= 0 || (src != null && L.src != null && L.src !== src)) continue;
      const d = L.shell ? Math.hypot(L.sx - x, L.sy - y) : Math.hypot(L.x - x, L.y - y) + 0.5;
      if (d < bd) { bd = d; best = L; }
    }
    if (best && bd <= r + 1.5) this._releaseLock(best);
  }

  /** A beam from view `a` to view `b`; `chain`: a bounce, `a` is the previous target (it leaves from its chest). */
  _beam(a, b, color, dur = 0.22, jitter = 1, chain = false) {
    this.beamList.push({ a, b, color, t: 0, dur, jitter, chain, seed: Math.random() * 1000 });
    if (this.beamList.length > 40) this.beamList.shift();
    const q = this._bodyPt(b, SHOT_HEIGHT.aim, this._g);
    this.particle('flare', q.x, q.y, { tint: color, life: 0.16, s0: (q.s / 128) * 0.7, s1: (q.s / 128) * 0.25, a0: 1, a1: 0, rot: Math.random() });
  }

  _updateBeams(dt) {
    const g = this.beams;
    g.clear();
    let w = 0;
    const p = this._p, q = this._q;
    for (const bm of this.beamList) {
      bm.t += dt;
      if (bm.t >= bm.dur || !bm.a || !bm.b) continue;
      // a chain bounce leaves the previous target where the shot met it (its chest), a beam leaves the shooter's hands
      this._bodyPt(bm.a, bm.chain ? SHOT_HEIGHT.aim : SHOT_HEIGHT.launch, p); const px = p.x, py = p.y, s = p.s;
      this._bodyPt(bm.b, SHOT_HEIGHT.aim, q);
      const k = 1 - bm.t / bm.dur;
      const segs = 7;
      // soft glow, coloured body, white-hot core
      for (let pass = 0; pass < 3; pass++) {
        const wd = pass === 0 ? s * 0.16 : pass === 1 ? s * 0.065 : s * 0.026;
        g.lineStyle(Math.max(1, wd), pass === 2 ? 0xffffff : bm.color, (pass === 0 ? 0.22 : pass === 1 ? 0.6 : 0.95) * k);
        g.moveTo(px, py);
        for (let i = 1; i < segs; i++) {
          const f = i / segs;
          const j = Math.sin(bm.seed + i * 12.9 + bm.t * 40) * s * 0.12 * (bm.jitter ?? 1);
          g.lineTo(px + (q.x - px) * f + j, py + (q.y - py) * f - j * 0.5);
        }
        g.lineTo(q.x, q.y);
      }
      this.beamList[w++] = bm;
    }
    this.beamList.length = w;
  }

  // ---- fire jets (炎佑 祛恶之焰) ---------------------------------------------------------------------------------

  /**
   * fx 'yanyouFlame' (sim/content/tokens.js yanyouKit; user playtest #4 item 12 "一段持续时间的喷火"): the sim emits one
   * event per game second of the channel; each keeps the jet of dragon `srcId` burning for `dur` real s + FLAME_TAIL
   * onto its locked target `tgtId` (else the spot (x, y)), so the 1 s ticks join into ONE continuous stream, with a
   * burning disc of radius `r` tiles following the target. One jet per dragon (a new tick re-aims and extends it).
   */
  _flame(srcId, tgtId, x, y, r, col, dur) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let F = srcId != null ? this.flames.find((f) => f.src === srcId) : null;
    if (!F) {
      const P = this.P;
      const disc = new P.Sprite(this.tex.soft);
      disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.alpha = 0;
      const edge = new P.Sprite(this.tex.ring);
      edge.anchor.set(0.5); edge.blendMode = P.BLEND_MODES.ADD; edge.alpha = 0;
      F = { src: srcId, disc, edge, t: 0, end: 0, jet: 0, fire: 0, smoke: 0, seed: Math.random() * 100 };
      this.flames.push(F);
      if (this.flames.length > MAX_FLAMES) this._freeFlame(this.flames.shift());
    }
    F.tgt = tgtId; F.x = x; F.y = y; F.z = this._groundZ(x, y); F.r = r; F.col = col;
    F.end = Math.max(F.end, F.t + dur + FLAME_TAIL);
    F.disc.tint = F.edge.tint = col;
  }

  _freeFlame(F) { F.disc.destroy(); F.edge.destroy(); }

  _updateFlames(dt) {
    if (!this.flames.length) return;
    const cam = this.ctx.cam();
    const g = this.beams;          // drawn after _updateBeams cleared it
    const p = this._p, q = this._q, m = this._g;
    const low = this.quality === 'low';
    let w = 0;
    for (const F of this.flames) {
      F.t += dt;
      const sv = this._viewOf(F.src);
      // the channel is over (no tick kept it going) or the dragon is gone
      if (F.t >= F.end || (F.src != null && this.ctx.view && (!sv || sv.alive === false))) { this._freeFlame(F); continue; }
      const tv = this._viewOf(F.tgt);
      if (tv && tv.alive !== false && Number.isFinite(tv.x) && Number.isFinite(tv.y)) { F.x = tv.x; F.y = tv.y; F.z = tv.z || 0; }
      const fade = Math.min(1, F.t / 0.12, (F.end - F.t) / FLAME_FADE);
      const flick = 0.82 + 0.18 * Math.sin(F.t * 23 + F.seed) * Math.sin(F.t * 7.3);
      // burning disc on the ground around the target
      this._onGround(F.disc, F.y, F.z); this._onGround(F.edge, F.y, F.z);
      cam.project(F.x, F.y, F.z + 0.02, p);
      cam.project(F.x, F.y + F.r, F.z + 0.02, q);
      const cx = p.x, cy = p.y, s = p.s;
      const rx = s * F.r, ry = Math.max(1, cy - q.y);
      F.disc.position.set(cx, cy); F.disc.scale.set((rx * 2) / 128, (ry * 2) / 128); F.disc.alpha = 0.5 * fade * flick;
      F.edge.position.set(cx, cy); F.edge.scale.set((rx * 2.05) / 128, (ry * 2.05) / 128); F.edge.alpha = 0.7 * fade * flick;
      // flame tongues and embers rising from the disc
      F.fire += dt * (low ? 14 : 34) * fade;
      while (F.fire >= 1) {
        F.fire -= 1;
        if (!this._room()) { F.fire = 0; break; }
        const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.9;
        const px = cx + Math.cos(a) * rx * d, py = cy + Math.sin(a) * ry * d;
        const ember = Math.random() < 0.3;
        const po = this._o();
        po.tint = ember ? 0xffd27a : FLAME_TINTS[(Math.random() * FLAME_TINTS.length) | 0];
        po.vx = (Math.random() - 0.5) * s * 0.3; po.vy = -s * (ember ? 1.6 : 0.9 + Math.random() * 0.6); po.drag = ember ? 0.5 : 1.5;
        po.life = ember ? 0.7 : 0.35 + Math.random() * 0.25;
        po.s0 = (s / 128) * (ember ? 0.06 : 0.28 + Math.random() * 0.12); po.s1 = (s / 128) * (ember ? 0.02 : 0.08);
        po.a0 = 0.9; po.a1 = 0; po.fadeIn = 0.05;
        this.particle(ember ? 'dot' : 'soft', px, py, po);
      }
      if (this.rich) {
        F.smoke += dt * 5 * fade;
        while (F.smoke >= 1) {
          F.smoke -= 1;
          if (!this._room()) { F.smoke = 0; break; }
          const po = this._o();
          po.add = false; po.tint = 0x3a3430; po.vx = (Math.random() - 0.5) * s * 0.2; po.vy = -s * 0.5; po.drag = 1;
          po.life = 0.9; po.s0 = (s / 128) * 0.35; po.s1 = (s / 128) * 0.8; po.a0 = 0.32; po.a1 = 0; po.fadeIn = 0.15;
          this.particle('smoke', cx + (Math.random() - 0.5) * rx, cy - s * 0.2, po);
        }
      }
      // the jet: from the dragon's chest onto the target (its chest; the disc centre without a target view)
      if (sv) {
        this._chest(sv, m);
        const mx = m.x, my = m.y;
        if (tv && tv.alive !== false) this._chest(tv, q); else { q.x = cx; q.y = cy - s * 0.15; }
        const tx = q.x, ty = q.y;
        const segs = 6;
        for (let pass = 0; pass < 3; pass++) {
          const col = pass === 2 ? 0xfff2c0 : pass === 1 ? 0xffb347 : F.col;
          const alpha = (pass === 0 ? 0.3 : pass === 1 ? 0.55 : 0.8) * fade * flick;
          let x0 = mx, y0 = my;
          for (let i = 1; i <= segs; i++) {
            const f = i / segs;
            // widens towards the target (a cone of fire), wobbling
            const wd = s * (pass === 0 ? 0.1 + 0.22 * f : pass === 1 ? 0.05 + 0.1 * f : 0.02 + 0.03 * f);
            const j = i < segs ? Math.sin(F.seed + i * 3.1 + F.t * 30) * s * 0.05 * f : 0;
            const x1 = mx + (tx - mx) * f + j, y1 = my + (ty - my) * f - j * 0.5;
            g.lineStyle(Math.max(1, wd), col, alpha);
            g.moveTo(x0, y0); g.lineTo(x1, y1);
            x0 = x1; y0 = y1;
          }
        }
        // fire puffs streaming along it
        F.jet += dt * (low ? 18 : 42) * fade;
        const T = 0.2;
        while (F.jet >= 1) {
          F.jet -= 1;
          if (!this._room()) { F.jet = 0; break; }
          const a = Math.random() * Math.PI * 2, d = Math.random() * 0.5;
          const gx = tx + Math.cos(a) * rx * d, gy = ty + Math.sin(a) * ry * d;
          const po = this._o();
          po.tint = FLAME_TINTS[(Math.random() * FLAME_TINTS.length) | 0];
          po.vx = (gx - mx) / T; po.vy = (gy - my) / T;
          po.life = T * (0.9 + Math.random() * 0.3);
          po.s0 = (s / 128) * 0.1; po.s1 = (s / 128) * (0.38 + Math.random() * 0.2); po.a0 = 0.85; po.a1 = 0.15;
          this.particle('soft', mx, my, po);
        }
      }
      this.flames[w++] = F;
    }
    this.flames.length = w;
  }

  // ---- lock-on reticles (蕾缪安) -------------------------------------------------------------------------------

  /**
   * fx 'lock': a reticle on the locked enemy (following its view; at the last spot once it is gone) until its shell
   * lands (mortar / _landed) or the aimed shot fires ('crit' from the same shooter); at most LOCK_T game seconds after
   * the shooter's last lock / shell / bombard (_touchLocks).
   */
  _lock(view, src, x, y, z) {
    let L = this.lockFree.pop();
    if (!L) {
      const P = this.P;
      const ring = new P.Sprite(this.tex.reticle);
      ring.anchor.set(0.5);
      ring.blendMode = P.BLEND_MODES.ADD;
      const core = new P.Sprite(this.tex.glow);
      core.anchor.set(0.5);
      core.blendMode = P.BLEND_MODES.ADD;
      this.projLayer.addChild(ring, core);
      L = { ring, core };
    }
    L.view = view; L.id = view ? view.id : null; L.src = src ?? null; L.x = x; L.y = y; L.z = z;
    L.t = 0; L.idle = 0; L.max = LOCK_T / this._ts(); L.out = -1; L.shell = false; L.sx = x; L.sy = y;
    L.ring.tint = L.core.tint = FX_KINDS.lock.c;
    L.ring.alpha = L.core.alpha = 0;
    L.ring.visible = L.core.visible = true;
    this.locks.push(L);
    if (this.locks.length > MAX_LOCKS) this._freeLock(this.locks.shift());
    return L;
  }

  /** Shooter `src` is still at it (a new lock, a shell, a bombard): its live locks restart their LOCK_T wait. */
  _touchLocks(src) {
    if (src == null) return;
    for (const L of this.locks) if (L.src === src) L.idle = 0;
  }

  /** The live lock of shooter `src` nearest to (x, y) within `within` tiles (`free`: only one no shell took yet). */
  _nearestLock(src, x, y, within, free) {
    let best = null, bd = Infinity;
    for (const L of this.locks) {
      if (L.out >= 0 || (free && L.shell) || (src != null && L.src != null && L.src !== src)) continue;
      const d = Math.hypot(L.x - x, L.y - y);
      if (d < bd - 1e-9) { bd = d; best = L; }
    }
    return best && bd <= within ? best : null;
  }

  /** Fade a lock out (it pops outwards as it goes). */
  _releaseLock(L) { if (L && L.out < 0) L.out = 0; }

  _freeLock(L) {
    L.ring.visible = L.core.visible = false;
    L.view = null;
    this.lockFree.push(L);
  }

  _updateLocks(dt) {
    if (!this.locks.length) return;
    const cam = this.ctx.cam();
    let w = 0;
    for (const L of this.locks) {
      L.t += dt;
      L.idle += dt;
      if (L.out < 0 && L.idle >= L.max) L.out = 0;
      // the shooter knocked out / withdrawn: the sim fires no more shells — only a shell already in the air still lands
      if (L.out < 0 && !L.shell && L.src != null && this.ctx.view) {
        const sv = this._viewOf(L.src);
        if (!sv || sv.alive === false) L.out = 0;
      }
      if (L.out >= 0) { L.out += dt; if (L.out >= LOCK_FADE) { this._freeLock(L); continue; } }
      const v = L.view;
      if (v && !v.destroyed && v.alive !== false) { L.x = v.x; L.y = v.y; L.z = bodyZ(cam, v, SHOT_HEIGHT.aim); }
      const p = cam.project(L.x, L.y, L.z, this._p);
      const s = p.s;
      const out = L.out >= 0 ? L.out / LOCK_FADE : 0;
      const pop = L.t < 0.16 ? 1.7 - 0.7 * easeOut(L.t / 0.16) : 1 + 0.05 * Math.sin(L.t * 9);
      const a = (L.out >= 0 ? 1 - out : Math.min(1, L.t / 0.06));
      L.ring.position.set(p.x, p.y);
      L.ring.rotation = L.t * 1.8;
      L.ring.scale.set((s * 0.95 * pop * (1 + out * 0.6)) / 128);
      L.ring.alpha = 0.95 * a;
      L.core.position.set(p.x, p.y);
      L.core.scale.set(((s * 0.4) / 128) * (1 + 0.25 * Math.sin(L.t * 14)));
      L.core.alpha = 0.7 * a;
      this.locks[w++] = L;
    }
    this.locks.length = w;
  }

  // ---- hits / numbers -----------------------------------------------------------------------------------------

  /** b.ev 'dmg' visual: glow + sparks in the hit colour; a melee blow (atk 'none' just before) adds its slash. */
  damage(view, amount, type, srcView) {
    if (!view) return;
    const style = dmgStyleKey(type);
    const p = this._chest(view);
    const px = p.x, py = p.y, s = p.s;
    const tint = HIT_TINT[style] || 0xffffff;
    const big = view.maxHp > 0 && amount >= view.maxHp * 0.18;
    const melee = !!srcView && this._slashAt === srcView.id;
    this.particle('glow', px, py, { tint, life: 0.18, s0: (s / 128) * (big ? 1.0 : 0.6), s1: (s / 128) * (big ? 1.5 : 0.9), a0: 0.9, a1: 0 });
    if (melee) { this._slashAt = null; this._slash(view, srcView, px, py, s, style, big); }
    this.burst(px, py, s, big ? 8 : melee ? 6 : 4, tint, { speed: melee ? 2.8 : 2.4, size: big ? 0.6 : 0.46 });
    if (srcView && this.ctx.subProfOf && SPLASH_SUBS.has(this.ctx.subProfOf(srcView.info?.defId))) {
      if (!this._lastRing || this.time - this._lastRing > 0.08) {
        this._lastRing = this.time;
        this.ring(view.x, view.y, view.z || 0, 0.1, 1.1, tint, 0.3);
      }
    }
    view.onHit?.();
    if (this.ctx.settings?.damageNumbers !== false) this.number(view, amount, style, big);
  }

  /**
   * Melee blow on `view` by `src`: a crescent swept across the victim, bulging along the blow (attacker → victim on
   * screen, a little random tilt / mirroring), in the hit colour with a white-hot inner stroke.
   */
  _slash(view, src, px, py, s, style, big) {
    const q = this._chest(src, this._q);
    const dx = px - q.x, dy = py - q.y;
    const ang = Math.abs(dx) + Math.abs(dy) > 1 ? Math.atan2(dy, dx) : (src.x > view.x ? Math.PI : 0);
    const rot = ang + Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    const flip = Math.random() < 0.5 ? -1 : 1;
    const k = big ? 1.25 : 1;
    const a = this.particle('slash', px, py, { tint: style === 'phys' ? 0xffe2b0 : HIT_TINT[style] || 0xffffff, life: 0.2, s0: (s / 128) * 1.05 * k, s1: (s / 128) * 1.3 * k, a0: 1, a1: 0, rot });
    a.sx = flip;
    const b = this.particle('slash', px, py, { tint: 0xffffff, life: 0.12, s0: (s / 128) * 0.8 * k, s1: (s / 128) * 1.0 * k, a0: 0.85, a1: 0, rot });
    b.sx = flip;
  }

  heal(view, amount) {
    if (!view) return;
    const p = this._chest(view);
    const s = p.s;
    this.particle('glow', p.x, p.y, { tint: 0x62f08a, life: 0.3, s0: (s / 128) * 0.5, s1: (s / 128) * 0.9, a0: 0.55, a1: 0 });
    for (let i = 0; i < (this.quality === 'low' ? 1 : 3); i++) {
      this.particle('plus', p.x + (Math.random() - 0.5) * s * 0.5, p.y + (Math.random() - 0.2) * s * 0.3, {
        tint: 0x7dffa8, vy: -s * 0.9, life: 0.7, s0: s / 64 * 0.32, s1: s / 64 * 0.2, a0: 0.95, a1: 0, fadeIn: 0.08,
      });
    }
    if (this.ctx.settings?.damageNumbers !== false) this.number(view, amount, 'heal', false);
  }

  /**
   * A damage / heal number over `view` (see the header). Layout in screen space, against EVERY live number (the
   * '41509' / '201625' overlaps were numbers of neighbouring units standing side by side):
   *   * merge: a same-style hit on the same unit within NUM_MERGE_GAP of that number's last hit (and while it is still
   *     young) adds to it — a running total that re-pops and lives a little longer;
   *   * cap: a unit shows at most NUM_PER_TARGET numbers; past it the hit joins the unit's youngest same-style number,
   *     else the unit's oldest number fades out at once;
   *   * lanes: the new number takes the lowest free slot of its unit's lanes (centre, then beside the head, 0 / ±1 / ±2
   *     lane widths), stacking upwards at most NUM_MAX_LINES lines; a slot is free when no live number of any unit
   *     overlaps it now or later (a younger number rises faster: below an older one it must keep that one's rise so
   *     far as a margin) with a gap wide enough that two numbers never read as one;
   *   * crowded (> NUM_CROWD numbers near it): it lives shorter; a pair that still ends up overlapping (units walking
   *     into each other) resolves by fading the older one quickly (_updateNums).
   */
  number(view, amount, style, big) {
    const n = Math.round(amount);
    if (!(n > 0) || !view) return;
    const now = this.time;
    const cam = this.ctx.cam();
    const base = (view.z || 0) + (view.hover || 0) + (view._headTiles || 1.2) * 0.8;
    const a = cam.project(view.x, view.y, base, this._p);
    const ax = a.x, ay = a.y, s = a.s > 0 ? a.s : 100;
    const pxPerZ = ay - cam.project(view.x, view.y, base + 1, this._q).y;
    const risePx = NUM_RISE * (pxPerZ > 1e-3 ? pxPerZ : s * 0.5);
    // the live boxes only change between frames: laid out once per frame / camera, not once per hit (a heavy AoE
    // lands dozens of hits in one frame — re-projecting every live number for each was O(hits × numbers))
    this._layoutNumsOnce(cam);
    // 1. merge into this unit's running total of the same style
    let mine = 0, youngest = null, oldest = null;
    for (const t of this.nums) {
      if (t.unit !== view || t.fading) continue;
      mine++;
      if (!oldest || t.born < oldest.born) oldest = t;
      if (t.style === style && (!youngest || t.born > youngest.born)) youngest = t;
    }
    const merge = youngest && now - youngest.lastHit < NUM_MERGE_GAP && youngest.life < NUM_RISE_T * 0.55 ? youngest
      : (mine >= NUM_PER_TARGET && youngest ? youngest : null);
    if (merge && this._growFits(merge, n, big)) {
      merge.value += n;
      merge.text.text = (style === 'heal' ? '+' : '') + merge.value;
      merge.pop = 1;
      merge.big = merge.big || big;
      merge.lastHit = now;
      merge.end = Math.min(merge.life + NUM_LIFE * 0.75, Math.max(merge.end, merge.life + NUM_LIFE * 0.6), NUM_MAX_LIFE);
      this._sizeNum(merge);
      return;
    }
    if (mine >= NUM_PER_TARGET && oldest) this._fadeNum(oldest, 0.1);
    // 2. a free slot among the unit's lanes
    const sc = numScale(s, big, style);
    const w = numChars(n, style) * NUM_DIGIT_EM * 24 * sc * NUM_POP + NUM_GAP_PX;
    const h = 24 * NUM_LINE_EM * sc * NUM_POP;
    const lane = Math.max(w, 24 * NUM_DIGIT_EM * sc * 3.2) * 0.62;
    let best = null;
    for (const k of NUM_LANES) {
      const cx = ax + k * lane;
      const cy = this._numSlotPx(cx, ay, w, h, risePx);
      const lift = ay - cy;
      if (!best || lift < best.lift - 0.5) best = { cx, cy, lift, k };
      if (lift <= h * 1.2) break;              // low enough: keep the nearest lane
    }
    const cap = h * NUM_MAX_LINES;
    let { cx, cy } = best;
    if (ay - cy > cap) {
      // over capacity (a knot of units under fire): join this unit's latest same-style total when it fits, else take
      // the capped spot and drop whatever is there (crowded numbers give way at once)
      let same = null;
      for (const t of this.nums) if (t.unit === view && t.style === style && !t.fading && (!same || t.born > same.born)) same = t;
      if (same && this._growFits(same, n, big)) {
        same.value += n;
        same.text.text = (style === 'heal' ? '+' : '') + same.value;
        same.pop = 1;
        same.big = same.big || big;
        same.lastHit = now;
        this._sizeNum(same);
        return;
      }
      // (released at once, not merely ended: they would vanish before the next render anyway, and as obstacles they
      // made every further hit of the same frame search a crowd that is no longer there — a knot under AoE)
      cx = ax; cy = ay - cap;
      let keep = 0;
      for (const t of this.nums) {
        if (Math.abs(t._x - cx) < (t._w + w) / 2 && t._y > cy - h && t._y - t._h < cy) { this._releaseNum(t); continue; }
        this.nums[keep++] = t;
      }
      this.nums.length = keep;
    }
    // 3. crowding: numbers around this spot → a shorter life for everyone new here
    let near = 0;
    for (const t of this.nums) if (!t.fading && Math.abs(t._x - cx) < 150 && Math.abs(t._y - cy) < 110) near++;
    const life = near >= NUM_CROWD ? NUM_LIFE * 0.62 : NUM_LIFE;
    const maxNums = this.load >= 2 ? MAX_NUMBERS >> 1 : MAX_NUMBERS;
    while (this.nums.length >= maxNums) this._releaseNum(this.nums.shift());
    const t = this._takeNum(style);
    t.text.visible = true;
    t.text.alpha = 1;
    t.text.text = (style === 'heal' ? '+' : '') + n;
    Object.assign(t, {
      unit: view, style, value: n, life: 0, end: life, born: now, lastHit: now, pop: 1, big: !!big, fading: false,
      ox: cx - ax, oy: cy - ay, x0: view.x, y0: view.y, z0: base, risePx, _x: cx, _y: cy, _w: w, _h: h,
    });
    this.nums.push(t);
  }

  /** Whether a merged number's grown text still fits among its neighbours (else a new number is made). */
  _growFits(t, add, big) {
    const sc = numScale(t._s || 100, t.big || big, t.style);
    const w = numChars(t.value + add, t.style) * NUM_DIGIT_EM * 24 * sc * NUM_POP + NUM_GAP_PX;
    for (const o of this.nums) {
      if (o === t || o.fading) continue;
      if (Math.abs(o._x - t._x) < (o._w + w) / 2 && Math.abs(o._y - t._y) < (o._h + t._h) / 2) return false;
    }
    return true;
  }

  /**
   * Lowest (largest screen y) bottom for a number of size w×h centred at x, starting at y0, clear of every live number
   * now and later: above one it must sit on its top; below one it must leave that one's rise so far as a margin
   * (the new number rises faster and would catch up).
   */
  _numSlotPx(x, y0, w, h, risePx) {
    let y = y0;
    for (let pass = 0; pass <= this.nums.length; pass++) {
      let moved = false;
      for (const t of this.nums) {
        if (t.fading && t.text.alpha < 0.3) continue;   // almost gone
        if (Math.abs(t._x - x) >= (t._w + w) / 2) continue;
        const top = t._y - t._h, bottom = t._y;
        const risen = t.risePx * easeOut(Math.min(1, t.life / NUM_RISE_T));
        if (y <= top) continue;                                   // entirely above it (bottom at or over its top)
        if (y - h >= bottom + risen) continue;                    // below it, for good
        y = top;
        moved = true;
      }
      if (!moved) break;
    }
    return y;
  }

  /** Screen boxes of the live numbers (their current anchor, rise and size) → t._x, t._y (bottom), t._w, t._h. */
  _layoutNums(cam) {
    const p = this._p;
    for (const t of this.nums) {
      const u = t.unit;
      if (u && !u.destroyed) { t.x0 = u.x; t.y0 = u.y; }
      cam.project(t.x0, t.y0, t.z0, p);
      t._s = p.s;
      const k = Math.min(1, t.life / NUM_RISE_T);
      t._x = p.x + t.ox;
      t._y = p.y + t.oy - t.risePx * easeOut(k);
      this._sizeNum(t);
    }
    this._laidAt = this.time;
    this._laidCam = cam;
    this._laidKey = camKey(cam);
  }

  /** `_layoutNums` unless the boxes are already current: same frame (fx time) and the same camera framing. */
  _layoutNumsOnce(cam) {
    if (this._laidAt === this.time && this._laidCam === cam && this._laidKey === camKey(cam)) return;
    this._layoutNums(cam);
  }

  /** A number's box size from its value, style, pop and the scale of its last layout (t._s px per tile). */
  _sizeNum(t) {
    const sc = numScale(t._s || 100, t.big, t.style);
    const pop = 1 + t.pop * (NUM_POP - 1);
    t._w = numChars(t.value, t.style) * NUM_DIGIT_EM * 24 * sc * pop + NUM_GAP_PX;
    t._h = 24 * NUM_LINE_EM * sc * pop;
    t._sc = sc;
  }

  _fadeNum(t, within) {
    if (t.fading) return;
    t.fading = true;
    t.fadeFrom = t.text.alpha;
    t.end = Math.min(t.end, t.life + within);
    t.fadeT0 = t.life;
  }

  _takeNum(style) {
    const P = this.P;
    const font = DMG_STYLE[style]?.font || DMG_STYLE.phys.font;
    const pool = this._numPools || (this._numPools = new Map());
    const list = pool.get(font);
    let t = list && list.length ? list.pop() : null;
    if (!t) {
      const text = new P.BitmapText('0', { fontName: font, fontSize: 24, align: 'center' });
      text.anchor.set(0.5, 1);
      this.ctx.layers.text.addChild(text);
      t = { text, font };
    }
    return t;
  }

  _releaseNum(t) {
    t.text.visible = false;
    t.unit = null;
    const pool = this._numPools || (this._numPools = new Map());
    let list = pool.get(t.font);
    if (!list) pool.set(t.font, list = []);
    if (list.length < 30) list.push(t); else t.text.destroy();
  }

  _updateNums(dt) {
    const cam = this.ctx.cam();
    let w = 0;
    for (const t of this.nums) {
      t.life += dt;
      if (t.life >= t.end) { this._releaseNum(t); continue; }
      t.pop = Math.max(0, t.pop - dt * 6);
      this.nums[w++] = t;
    }
    this.nums.length = w;
    this._layoutNums(cam);
    // a pair still overlapping (their units walked into each other): the older one gives way
    const L = this.nums;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.fading) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.fading) continue;
        if (Math.abs(a._x - b._x) < (a._w + b._w) / 2 - NUM_GAP_PX * 0.5 && Math.abs((a._y - a._h / 2) - (b._y - b._h / 2)) < (a._h + b._h) / 2 * 0.9) {
          this._fadeNum(a.born <= b.born ? a : b, 0.06);
          if (a.fading) break;
        }
      }
    }
    for (const t of L) {
      const tx = t.text;
      tx.scale.set(t._sc * (1 + t.pop * (NUM_POP - 1)));
      tx.position.set(t._x, t._y);
      let alpha = 1;
      const left = t.end - t.life;
      if (t.fading) alpha = (t.fadeFrom ?? 1) * clamp(left / Math.max(0.01, t.end - t.fadeT0), 0, 1);
      else if (left < NUM_FADE_T) alpha = left / NUM_FADE_T;
      tx.alpha = alpha;
    }
  }

  // ---- rings / auras -----------------------------------------------------------------------------------------

  /**
   * Ground ring going from r0 to r1 tiles over `dur` real seconds (easing out, fading). `mode` 'in': a warning closing
   * in — linear, brightening towards its end; 'pulse': throbbing at full size until its end.
   */
  ring(x, y, z, r0, r1, tint, dur = 0.4, tex = 'ring', mode = null) {
    const P = this.P;
    let r = this.ringFree.pop();
    if (!r) {
      const sp = new P.Sprite(this.tex[tex]);
      sp.anchor.set(0.5);
      sp.blendMode = P.BLEND_MODES.ADD;
      this.ctx.layers.groundFx.addChild(sp);
      r = { sp };
    }
    r.sp.texture = this.tex[tex] || this.tex.ring;
    r.sp.visible = true;
    r.sp.tint = tint;
    r.sp.alpha = 0;
    this._onGround(r.sp, y, z);
    r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = r1; r.t = 0; r.dur = Math.max(0.01, dur); r.mode = mode;
    this.rings.push(r);
    if (this.rings.length > 80) { const o = this.rings.shift(); o.sp.visible = false; this.ringFree.push(o); }
  }

  _updateRings(dt) {
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    let w = 0;
    for (const r of this.rings) {
      r.t += dt;
      if (r.t >= r.dur) { r.sp.visible = false; this.ringFree.push(r); continue; }
      const u = r.t / r.dur;
      const k = r.mode === 'in' ? u : easeOut(u);
      const rad = r.r0 + (r.r1 - r.r0) * k;
      cam.project(r.x, r.y, r.z + 0.01, p);
      cam.project(r.x, r.y + rad, r.z + 0.01, q);
      const rx = p.s * rad, ry = Math.max(1, p.y - q.y);
      r.sp.position.set(p.x, p.y);
      r.sp.scale.set((rx * 2) / 128, (ry * 2) / 128);
      r.sp.alpha = r.mode === 'in' ? 0.35 + 0.65 * u
        : r.mode === 'pulse' ? (0.35 + 0.35 * Math.abs(Math.sin(r.t * 9))) * Math.min(1, (r.dur - r.t) / 0.06, r.t / 0.06)
          : 1 - u;
      this.rings[w++] = r;
    }
    this.rings.length = w;
  }

  /**
   * Skill activation (on) / end (off). On: a flash at the body, a gold light pillar with a white-hot core from the
   * feet, a shockwave and a hex ring on the ground, rising motes — then the active aura (_aura) until it ends.
   */
  skill(view, on) {
    if (!view) return;
    if (!on) { this._aura(view, false); return; }
    const z = (view.z || 0) + (view.hover || 0);
    const g = this._proj(view.x, view.y, z, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    const c = this._chest(view, this._q);
    this.particle('pillar', gx, gy, { tint: SKILL_GOLD, life: 0.7, s0: (s / 64) * 1.05, s1: (s / 64) * 1.3, a0: 0.95, a1: 0, sx: 0.8, ay: 1 });
    this.particle('pillar', gx, gy, { tint: 0xffffff, life: 0.38, s0: (s / 64) * 0.9, s1: (s / 64) * 1.15, a0: 0.9, a1: 0, sx: 0.28, ay: 1 });
    this.particle('flare', c.x, c.y, { tint: 0xfff0b0, life: 0.3, s0: (s / 128) * 1.9, s1: (s / 128) * 0.6, a0: 1, a1: 0, rot: Math.random() });
    this.particle('glow', c.x, c.y, { tint: SKILL_GOLD, life: 0.36, s0: (s / 128) * 1.2, s1: (s / 128) * 2.4, a0: 0.9, a1: 0 });
    this.ring(view.x, view.y, z, 0.15, 1.7, 0xffe7a0, 0.45, 'shock');
    this.ring(view.x, view.y, z, 0.3, 1.25, SKILL_GOLD, 0.6, 'hex');
    this.burst(c.x, c.y, s, this.rich ? 10 : 4, 0xffe28a, { speed: 1.4, up: 1.6, life: 0.7, tex: 'dot', size: 0.34 });
    this._aura(view, true);
  }

  /** Active-skill aura: a soft gold glow and a slowly turning hex on the ground under the unit (fading in / out). */
  _aura(view, on) {
    const P = this.P;
    let a = this.auras.get(view.id);
    if (on) {
      if (!a) {
        // the root is squashed onto the ground; the hex turns inside it (so it turns in the ground plane)
        const root = new P.Container();
        const disc = new P.Sprite(this.tex.soft);
        disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.tint = SKILL_GOLD;
        const hex = new P.Sprite(this.tex.hex);
        hex.anchor.set(0.5); hex.blendMode = P.BLEND_MODES.ADD; hex.tint = 0xffc94a;
        root.addChild(disc, hex);
        root.alpha = 0;
        this.ctx.layers.groundFx.addChild(root);
        a = { sp: root, disc, hex, view, t: 0, mote: 0 };
        this.auras.set(view.id, a);
      }
      a.view = view;
      a.off = false;
    } else if (a) a.off = true;
  }

  _updateAuras(dt) {
    if (!this.auras.size) return;
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    const rich = this.rich;
    for (const [id, a] of this.auras) {
      a.t += dt;
      const v = a.view;
      const ending = a.off || !v || v.destroyed || v.alive === false;
      if (ending) {
        a.sp.alpha -= dt * 3;
        if (a.sp.alpha <= 0) { a.sp.destroy({ children: true }); this.auras.delete(id); continue; }
      } else a.sp.alpha = Math.min(1, a.sp.alpha + dt * 5);
      if (!v || v.destroyed) continue;
      const z = (v.z || 0) + 0.01;
      this._onGround(a.sp, v.y, v.z || 0);
      cam.project(v.x, v.y, z, p);
      cam.project(v.x, v.y + 0.55, z, q);
      a.sp.position.set(p.x, p.y);
      a.sp.scale.set((p.s * 0.95) / 128, (Math.max(1, p.y - q.y) * 1.72) / 128);
      a.hex.rotation = a.t * 0.9;
      a.hex.alpha = 0.8 + 0.2 * Math.sin(a.t * 4);
      a.disc.alpha = 0.42 + 0.1 * Math.sin(a.t * 4);
      // now and then a mote rises from the ring
      if (rich && !ending && (a.mote += dt) >= 0.3) {
        a.mote = 0;
        if (this._room()) {
          const ang = Math.random() * Math.PI * 2;
          const m = cam.project(v.x + Math.cos(ang) * 0.38, v.y + Math.sin(ang) * 0.3, z, this._g);
          const o = this._o();
          o.tint = 0xffe28a; o.vy = -m.s * 0.9; o.life = 0.75; o.s0 = (m.s / 32) * 0.14; o.s1 = 0; o.a0 = 0.9; o.fadeIn = 0.1;
          this.particle('dot', m.x, m.y, o);
        }
      }
    }
  }

  deploy(view) {
    if (!view) return;
    const p = this._proj(view.x, view.y, view.z || 0);
    const s = p.s;
    const col = view.isEnemy ? 0xff6a5a : 0x9ff0dc;
    this.particle('pillar', p.x, p.y, { tint: col, life: 0.45, s0: s / 64 * 0.7, s1: s / 64 * 0.2, a0: 0.9, a1: 0, sx: 1, ay: 1 });
    this.ring(view.x, view.y, view.z || 0, 0.1, 0.8, col, 0.45);
    this.burst(p.x, p.y, s, 6, col, { speed: 1.6, up: 0.4, life: 0.4, tex: 'dot' });
  }

  /**
   * Promotion (精锐晋升, a merge) at the elite's spot — the board tile of the consumed copy it replaced (PRTS 卫戍协议/
   * 帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置") or its bench slot: a gold pillar with a white core, a shockwave
   * and a hex ring on the ground, rising motes; `from` = world points of the other consumed copies (gold streaks from
   * them to the elite). Counted in `promotions` (render/app.js setPrep; tests).
   * @param {any} view
   * @param {Array<{ x: number, y: number, z?: number }>} [from]
   */
  promote(view, from = []) {
    if (!view) return;
    this.promotions = (this.promotions || 0) + 1;
    const z = view.z || 0;
    const g = this._proj(view.x, view.y, z, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    for (const f of from) if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) this.streak(f.x, f.y, view.x, view.y, Math.max(z, f.z || 0) + 0.3, SKILL_GOLD, 0.45);
    this.particle('pillar', gx, gy, { tint: SKILL_GOLD, life: 0.8, s0: (s / 64) * 1.1, s1: (s / 64) * 1.4, a0: 0.95, a1: 0, sx: 0.85, ay: 1 });
    this.particle('pillar', gx, gy, { tint: 0xffffff, life: 0.42, s0: (s / 64) * 0.9, s1: (s / 64) * 1.2, a0: 0.9, a1: 0, sx: 0.3, ay: 1 });
    this.ring(view.x, view.y, z, 0.15, 1.6, 0xffe7a0, 0.5, 'shock');
    this.ring(view.x, view.y, z, 0.3, 1.2, SKILL_GOLD, 0.7, 'hex');
    const c = this._chest(view, this._q);
    this.burst(c.x, c.y, s, this.rich ? 12 : 5, 0xffe28a, { speed: 1.5, up: 1.8, life: 0.8, tex: 'dot', size: 0.36 });
  }

  death(view) {
    if (!view) return;
    const p = this._chest(view);
    const s = p.s;
    const col = view.isEnemy ? 0xff7a52 : 0xbfeee2;
    const n = this.quality === 'low' ? 5 : 12;
    for (let i = 0; i < n; i++) {
      this.particle(i % 3 ? 'dot' : 'shard', p.x + (Math.random() - 0.5) * s * 0.5, p.y + (Math.random() - 0.3) * s * 0.6, {
        tint: col, vx: (Math.random() - 0.5) * s * 0.6, vy: -s * (0.4 + Math.random() * 0.8), drag: 1.5,
        life: 0.7 + Math.random() * 0.5, s0: s / 32 * 0.12, s1: 0, a0: 0.9, a1: 0, spin: (Math.random() - 0.5) * 6,
      });
    }
    this.particle('smoke', p.x, p.y, { add: false, tint: 0x1a1a1a, life: 0.8, s0: s / 128 * 0.6, s1: s / 128 * 1.4, a0: 0.5, a1: 0 });
  }

  crateBreak(x, y, z, tint = null) {
    const p = this._proj(x, y, (z || 0) + 0.35);
    const s = p.s;
    for (let i = 0; i < (this.quality === 'low' ? 4 : 10); i++) {
      this.particle('shard', p.x, p.y, {
        add: false, tint: tint ?? (i % 2 ? 0xc89a5a : 0x9a6d38), vx: (Math.random() - 0.5) * s * 2.2, vy: -s * (0.6 + Math.random()), g: s * 4,
        life: 0.6, s0: s / 32 * 0.25, s1: s / 32 * 0.15, a0: 1, a1: 0.2, spin: (Math.random() - 0.5) * 14,
      });
    }
    this.particle('smoke', p.x, p.y, { add: false, tint: 0x8a7a60, life: 0.7, s0: s / 128 * 0.6, s1: s / 128 * 1.5, a0: 0.45, a1: 0 });
  }

  // ---- sim fx (b.ev ['fx', kind, x, y, extra]) -------------------------------------------------------------

  /** Unit view of an fx's `id` / `src` / … (null when unknown or gone). */
  _viewOf(id) {
    if (id == null || !this.ctx.view) return null;
    const v = this.ctx.view(id);
    return v && !v.destroyed ? v : null;
  }

  /**
   * Where an fx happens: on its anchor unit `ex.id` (at the unit's rendered position, so it sticks to a moving unit)
   * when the event's (x, y) is that unit's spot (within ANCHOR_SNAP tiles) or has none; otherwise at (x, y) on the ground
   * — the sim often names the caster in `id` of an effect elsewhere ('aoe' at a target or ahead of the caster, 'crit'
   * on the victim, 'zone' where a skill lands), which used to be drawn on the caster.
   */
  _where(x, y, ex) {
    const v = this._viewOf(ex.id);
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
      const here = !Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(v.x - x, v.y - y) <= ANCHOR_SNAP;
      if (here) return { x: v.x, y: v.y, z: (v.z || 0) + (v.hover || 0), v };
    }
    return this._point(x, y);
  }

  /** An fx at the sim position (x, y), on the ground there. */
  _point(x, y) {
    return { x, y, z: Number.isFinite(x) && Number.isFinite(y) ? this._groundZ(x, y) : 0, v: null };
  }

  /**
   * b.ev 'fx': every kind the sim / content emits has a visual (FX_KINDS archetypes: blast, shell, zone, telegraph,
   * heal, sp, shield, shatter, summon, vanish, blink, move, wave, mark, reticle, buff, lift, sleep, crit, dodge,
   * counter, dp, coin, crate, down, beam, bolt, strike, volley, pillar, lp, chill, element, flame), except kinds whose
   * archetype is 'none' (hitCap: a leader hit cancelled by 限伤 draws nothing); unknown kinds get a generic sparkle. `extra` keys used: id (anchor unit — or the shooter of a `pt` kind), r | radius, dur | duration,
   * t (shell flight, game s), src / from / to / target / targets (unit ids), fx, fy / fromX, fromY / tx, ty (positions),
   * element, n, scale, kind, tiles.
   */
  simFx(kind, x, y, extra) {
    const ex = extra && typeof extra === 'object' ? extra : {};
    const spec = fxSpec(kind, ex);
    if (spec.a === 'none') return; // an event the screen does not show (hitCap)
    const at = spec.pt ? this._point(Number(x), Number(y)) : this._where(Number(x), Number(y), ex);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    // 蕾缪安 S2: the aimed snipe ('crit' on the locked enemy, from her) ends that aim lock
    if (kind === 'crit' && ex.src != null && ex.id != null) {
      for (const L of this.locks) if (L.src === ex.src && L.id === ex.id) this._releaseLock(L);
    }
    const col = spec.c;
    const r = clamp(num(ex.r ?? ex.radius, spec.r ?? 1), 0.3, 30);
    const ts = this.ctx.timeScale ? Math.max(0.25, this.ctx.timeScale()) : 2;
    const dur = num(ex.dur ?? ex.duration, spec.dur ?? 0) / ts;
    const cam = this.ctx.cam();
    const chest = (v, out = this._p) => (v ? this._chest(v, out) : cam.project(at.x, at.y, at.z + 0.5, out));
    const p = chest(at.v);
    const s = p.s;
    switch (spec.a) {
      case 'blast': {
        if (r >= 12) { this.flashScreen(col, 0.5); break; }
        if (kind === 'bombard') { this._touchLocks(ex.id ?? ex.src ?? null); this._landed(ex.id ?? ex.src ?? null, at.x, at.y, r); }
        this.explosion(at.x, at.y, at.z, r, col, { smoke: spec.smoke, heavy: !!spec.heavy, tiles: ex.tiles ? tilesAround(at.x, at.y, r, ex.tiles) : null });
        break;
      }
      case 'shell': {
        // 蕾缪安 S3: a shell fired now by `id` that lands at (x, y) after `t` game seconds (its 'bombard' explodes there)
        const flight = num(ex.t ?? ex.flight ?? ex.dur ?? ex.duration, 1) / ts;
        this._touchLocks(ex.id ?? ex.src ?? null);
        this.mortar(this._viewOf(ex.id ?? ex.src), at.x, at.y, r, flight);
        break;
      }
      case 'zone': this.zone(at.x, at.y, at.z, r, col, Math.max(0.6, dur || 1.5), spec.tex); break;
      case 'wall': {
        // a line of burning tiles through the anchor tile along `axis` ('col' | 'row', from the sim event)
        const rect = this.ctx.fieldRect ? this.ctx.fieldRect() : null;
        this.tileFlash(wallTiles(Number(x), Number(y), ex.axis === 'row' ? 'row' : 'col', rect), col, Math.max(0.6, dur || 1.5));
        this.zone(at.x, at.y, at.z, 0.6, col, Math.max(0.6, dur || 1.5), spec.tex);
        break;
      }
      case 'telegraph': {
        const d = Math.max(0.4, dur || 1);
        if (r >= 12) { this.flashScreen(col, 0.45, d); break; }
        if (ex.tiles) this.tileFlash(tilesAround(at.x, at.y, r, ex.tiles), col, d, true);
        else this.zone(at.x, at.y, at.z, r, col, d, 'ring', true);
        break;
      }
      case 'chill': this.flashScreen(col, 0.35, 0.8); this.snowfall(col); break;
      case 'heal': this.heal(at.v || { x: at.x, y: at.y, z: at.z }, 0); break;
      case 'healAoe': {
        this.ring(at.x, at.y, at.z, 0.2, r, col, 0.6);
        const n = this.quality === 'low' ? 4 : 9;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.85;
          const q = cam.project(at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, at.z + 0.2);
          this.particle('plus', q.x, q.y, { tint: col, vy: -q.s * 0.9, life: 0.8, s0: q.s / 64 * 0.3, s1: q.s / 64 * 0.18, a0: 0.9, a1: 0, fadeIn: 0.1 });
        }
        break;
      }
      case 'sp': {
        for (let i = 0; i < (this.quality === 'low' ? 3 : 7); i++) {
          this.particle('dot', p.x + (Math.random() - 0.5) * s * 0.6, p.y + (Math.random() - 0.2) * s * 0.4, { tint: col, vy: -s * (0.6 + Math.random() * 0.6), life: 0.7, s0: s / 32 * 0.2, s1: 0, a0: 1, a1: 0, fadeIn: 0.05 });
        }
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.7, a1: 0 });
        break;
      }
      case 'shield': {
        this.particle('hex', p.x, p.y, { tint: col, life: 0.55, s0: s / 128 * 0.9, s1: s / 128 * 1.25, a0: 0.85, a1: 0, sx: 0.85 });
        this.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.9, s1: s / 128 * 1.3, a0: 0.5, a1: 0 });
        break;
      }
      case 'shatter': {
        this.particle('hex', p.x, p.y, { tint: col, life: 0.25, s0: s / 128 * 1.1, s1: s / 128 * 1.5, a0: 0.9, a1: 0 });
        for (let i = 0; i < (this.quality === 'low' ? 5 : 12); i++) {
          const a = Math.random() * Math.PI * 2;
          this.particle('shard', p.x + Math.cos(a) * s * 0.3, p.y + Math.sin(a) * s * 0.3, { tint: col, vx: Math.cos(a) * s * 1.6, vy: Math.sin(a) * s * 1.2 - s * 0.3, g: s * 3, life: 0.55, s0: s / 32 * 0.16, s1: s / 32 * 0.05, a0: 1, a1: 0, spin: (Math.random() - 0.5) * 12 });
        }
        break;
      }
      case 'summon': {
        const g = cam.project(at.x, at.y, at.z);
        this.particle('pillar', g.x, g.y, { tint: col, life: 0.55, s0: g.s / 64 * 0.8, s1: g.s / 64 * 0.3, a0: 0.9, a1: 0, sx: 1, ay: 1 });
        this.ring(at.x, at.y, at.z, 0.1, 0.9, col, 0.5, 'hex');
        this.burst(g.x, g.y - g.s * 0.3, g.s, 8, col, { speed: 1.4, up: 0.8, life: 0.5, tex: 'dot' });
        break;
      }
      case 'vanish': {
        this.particle('glow', p.x, p.y, { tint: col, life: 0.4, s0: s / 128 * 0.7, s1: s / 128 * 1.5, a0: 0.8, a1: 0 });
        this.smoke(p.x, p.y, s * 0.7, 0x2c2436, 0.5);
        this.burst(p.x, p.y, s, 7, col, { speed: 1.5, tex: 'dot', life: 0.45 });
        break;
      }
      case 'blink': {
        const fx0 = num(ex.fx ?? ex.fromX, NaN), fy0 = num(ex.fy ?? ex.fromY, NaN);
        if (Number.isFinite(fx0) && Number.isFinite(fy0)) {
          const q = cam.project(fx0, fy0, at.z + 0.5, this._q);
          this.smoke(q.x, q.y, q.s * 0.6, 0x2c2436, 0.45);
          this.particle('glow', q.x, q.y, { tint: col, life: 0.3, s0: q.s / 128 * 0.8, s1: q.s / 128 * 0.2, a0: 0.8, a1: 0 });
          this.streak(fx0, fy0, at.x, at.y, at.z + 0.5, col, 0.3);
        }
        this.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.3, s1: s / 128 * 1.2, a0: 0.9, a1: 0 });
        this.burst(p.x, p.y, s, 6, col, { speed: 1.4, tex: 'dot', life: 0.4 });
        break;
      }
      case 'move': {
        const fx0 = num(ex.fromX ?? ex.fx ?? ex.x0, NaN), fy0 = num(ex.fromY ?? ex.fy ?? ex.y0, NaN);
        const tx = num(ex.tx, NaN), ty = num(ex.ty, NaN);
        if (Number.isFinite(fx0) && Number.isFinite(fy0)) this.streak(fx0, fy0, at.x, at.y, at.z + 0.35, col, 0.35);
        else if (Number.isFinite(tx) && Number.isFinite(ty)) this.streak(at.x, at.y, tx, ty, at.z + 0.35, col, 0.35);
        const g = cam.project(at.x, at.y, at.z + 0.05);
        for (let i = 0; i < (this.quality === 'low' ? 2 : 5); i++) {
          this.particle('smoke', g.x + (Math.random() - 0.5) * g.s * 0.5, g.y, { add: false, tint: 0x6b6358, vx: (Math.random() - 0.5) * g.s * 0.6, vy: -g.s * 0.2, drag: 2, life: 0.5, s0: g.s / 128 * 0.25, s1: g.s / 128 * 0.55, a0: 0.45, a1: 0 });
        }
        break;
      }
      case 'wave': {
        const k = clamp(num(ex.scale, 1), 0.5, 4);
        const rr = Math.max(0.8, r * (ex.scale ? Math.min(2, k / 2) : 1));
        for (let i = 0; i < 3; i++) this.ring(at.x, at.y, at.z, 0.15 + i * 0.15, rr * (0.7 + i * 0.25), col, 0.45 + i * 0.12);
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 1.2, a0: 0.7, a1: 0 });
        break;
      }
      case 'mark': case 'reticle': {
        if (kind === 'lock') {
          // `id` is always the locked enemy: the reticle sticks to its view even a little off the event's spot
          const lv = at.v || this._viewOf(ex.id);
          this._touchLocks(ex.src ?? null);
          this._lock(lv, ex.src ?? null, lv ? lv.x : at.x, lv ? lv.y : at.y, lv ? bodyZ(cam, lv, SHOT_HEIGHT.aim) : at.z + 0.55);
          break;
        }
        const v = at.v;
        const hz = v ? (v.z || 0) + (v.hover || 0) + (v._headTiles || 1.2) + 0.25 : at.z + 1.4;
        const q = cam.project(at.x, at.y, hz, this._q);
        if (spec.a === 'mark') {
          this.particle('glow', q.x, q.y, { tint: col, life: 0.6, s0: q.s / 128 * 0.5, s1: q.s / 128 * 0.7, a0: 0.8, a1: 0 });
          this.numberAt(q.x, q.y, '!', col, 0.8);
        } else {
          this.particle('ring', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 1.3, s1: s / 128 * 0.7, a0: 0.95, a1: 0, spin: 3 });
          this.particle('hex', p.x, p.y, { tint: col, life: 0.6, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.8, a1: 0, spin: -2 });
        }
        break;
      }
      case 'buff': {
        const g = cam.project(at.x, at.y, at.z + 0.05);
        const n = this.quality === 'low' ? 3 : 6;
        for (let i = 0; i < n; i++) {
          const ox = (Math.random() - 0.5) * g.s * 0.7;
          this.particle('chevron', g.x + ox, g.y - g.s * (0.1 + Math.random() * 0.5), { tint: col, vy: -g.s * (1 + Math.random() * 0.5), life: 0.65, s0: g.s / 64 * 0.22, s1: g.s / 64 * 0.12, a0: 0.95, a1: 0, rot: -Math.PI / 2, fadeIn: 0.06 });
        }
        this.ring(at.x, at.y, at.z, 0.2, 0.75, col, 0.4);
        this.particle('glow', p.x, p.y, { tint: col, life: 0.35, s0: s / 128 * 0.6, s1: s / 128 * 1.1, a0: 0.6, a1: 0 });
        break;
      }
      case 'lift': {
        const g = cam.project(at.x, at.y, at.z);
        this.ring(at.x, at.y, at.z, 0.2, 0.8, col, 0.5);
        for (let i = 0; i < (this.quality === 'low' ? 3 : 7); i++) {
          this.particle('streak', g.x + (Math.random() - 0.5) * g.s * 0.6, g.y - g.s * Math.random() * 0.4, { tint: col, vy: -g.s * 1.8, life: 0.4, s0: g.s / 128 * 0.4, s1: g.s / 128 * 0.2, a0: 0.8, a1: 0, rot: -Math.PI / 2, sx: 1 });
        }
        break;
      }
      case 'sleep': {
        const v = at.v;
        const hz = v ? (v.z || 0) + (v._headTiles || 1.2) : at.z + 1.2;
        const q = cam.project(at.x + 0.2, at.y, hz, this._q);
        for (let i = 0; i < 3; i++) this.particle('st_sleep', q.x + i * q.s * 0.12, q.y - i * q.s * 0.12, { add: false, vy: -q.s * 0.5, vx: q.s * 0.15, life: 0.9 + i * 0.2, s0: q.s / 32 * 0.22, s1: q.s / 32 * 0.32, a0: 1, a1: 0, fadeIn: 0.1 * i });
        break;
      }
      case 'crit': {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.28, s0: s / 64 * 1.3, s1: s / 64 * 0.2, a0: 1, a1: 0, rot: Math.random() * Math.PI });
        this.particle('glow', p.x, p.y, { tint: 0xffffff, life: 0.18, s0: s / 128 * 0.9, s1: s / 128 * 1.4, a0: 0.9, a1: 0 });
        this.burst(p.x, p.y, s, 8, col, { speed: 3.2, life: 0.3, size: 0.5 });
        break;
      }
      case 'dodge': {
        this.particle('soft', p.x, p.y, { tint: 0xffffff, life: 0.3, s0: s / 128 * 0.5, s1: s / 128 * 0.9, a0: 0.5, a1: 0 });
        this.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.8, s1: s / 128 * 1.1, a0: 0.7, a1: 0, rot: -0.5 });
        break;
      }
      case 'counter': {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.22, s0: s / 64 * 0.9, s1: 0, a0: 1, a1: 0 });
        this.particle('slash', p.x, p.y, { tint: col, life: 0.22, s0: s / 128 * 0.9, s1: s / 128 * 1.2, a0: 0.9, a1: 0, rot: 0.6 });
        this.burst(p.x, p.y, s, 4, col, { speed: 2.4, life: 0.25 });
        break;
      }
      case 'dp': {
        const n = Math.round(num(ex.n, 0));
        this.particle('shard', p.x, p.y, { tint: col, vy: -s * 0.6, life: 0.9, s0: s / 32 * 0.28, s1: s / 32 * 0.22, a0: 1, a1: 0 });
        if (n > 0) this.numberAt(p.x + s * 0.2, p.y, `+${n}`, col, 0.7);
        break;
      }
      case 'coin': {
        for (let i = 0; i < 4; i++) this.particle('coin', p.x + (Math.random() - 0.5) * s * 0.4, p.y, { add: false, vx: (Math.random() - 0.5) * s, vy: -s * (1.2 + Math.random() * 0.6), g: s * 4, life: 0.7, s0: s / 48 * 0.2, s1: s / 48 * 0.16, a0: 1, a1: 0.2 });
        break;
      }
      case 'crate': this.crateBreak(at.x, at.y, at.z); break;
      case 'down': {
        this.smoke(p.x, p.y, s * 0.6, spec.smoke ?? 0x1a1a1a, 0.5);
        this.burst(p.x, p.y, s, 5, col, { speed: 1.2, tex: 'dot', life: 0.5, g: 2 });
        break;
      }
      case 'beam': case 'bolt': {
        const a = this._viewOf(ex.from ?? ex.src) || (spec.a === 'bolt' ? null : at.v);
        const b = this._viewOf(ex.to ?? ex.target) || (a === at.v ? null : at.v);
        if (a && b && a !== b) this._beam(a, b, col, spec.a === 'bolt' ? 0.28 : 0.4, spec.a === 'bolt' ? 1 : 0.4);
        else this.strike(at.x, at.y, at.z, col);
        break;
      }
      case 'flame': {
        // at the event's spot (the locked target), not snapped onto the dragon hovering 0.25 tile from it
        const fx0 = Number(x), fy0 = Number(y);
        this._flame(ex.id ?? ex.src ?? null, ex.target ?? ex.to ?? null, fx0, fy0, r, col, Math.max(0.2, dur || 0.5));
        break;
      }
      case 'strike': case 'pillar': this.strike(at.x, at.y, at.z, col, spec.a === 'pillar'); break;
      case 'volley': {
        const list = Array.isArray(ex.targets) ? ex.targets.slice(0, 12) : [];
        const src = this._viewOf(ex.src ?? ex.id);
        for (const id of list) {
          const t = this._viewOf(id);
          if (!t) continue;
          if (src && src !== t) this.attack(src, t, 'arrow');
          else { const q = this._chest(t, this._q); this.burst(q.x, q.y, q.s, 4, col, { speed: 2, life: 0.3 }); }
        }
        if (!list.length) this.burst(p.x, p.y, s, 6, col, { speed: 2.4, life: 0.35 });
        break;
      }
      case 'lp': this.leak(); break;
      case 'element': {
        const el = ex.element;
        const c2 = el === 'burn' ? 0xff7a33 : el === 'neural' ? 0xff5ad0 : el === 'necrosis' || el === 'apoptosis' ? 0x9dff6a : el === 'erosion' ? 0x6fe0ff : col;
        this.particle('glow', p.x, p.y, { tint: c2, life: 0.45, s0: s / 128 * 1.2, s1: s / 128 * 2.6, a0: 1, a1: 0 });
        this.ring(at.x, at.y, at.z, 0.2, 1.5, c2, 0.55);
        this.burst(p.x, p.y, s, 12, c2, { speed: 3, life: 0.5 });
        break;
      }
      default: {
        this.particle('spark', p.x, p.y, { tint: col, life: 0.35, s0: s / 64 * 0.6, s1: 0, a0: 0.9, a1: 0, rot: Math.random() });
        this.particle('glow', p.x, p.y, { tint: col, life: 0.3, s0: s / 128 * 0.4, s1: s / 128 * 0.9, a0: 0.6, a1: 0 });
        this.burst(p.x, p.y, s, 4, col, { speed: 1.6, tex: 'dot', life: 0.35 });
      }
    }
  }

  /**
   * An explosion on the ground at (x, y, z) of radius r tiles: fireball in `col`, a white flash, a shockwave and a
   * coloured ring on the ground, sparks and smoke. o.heavy (bombard, airstrike …): longer, more sparks, debris flying
   * and a scorch mark; o.small (shell impacts): no coloured ring, fewer sparks; o.tiles: flash those tiles too.
   */
  explosion(x, y, z, r, col, o = NO_OPTS) {
    const cam = this.ctx.cam();
    const g = cam.project(x, y, z + 0.3, this._g);
    const gx = g.x, gy = g.y, s = g.s;
    const R = Math.max(0.4, r), heavy = !!o.heavy, small = !!o.small, rich = this.rich;
    this.particle('glow', gx, gy, { tint: col, life: heavy ? 0.5 : small ? 0.3 : 0.4, s0: (s / 128) * (0.7 + R * 0.7), s1: (s / 128) * (1.2 + R * 1.2), a0: 1, a1: 0 });
    this.particle('flare', gx, gy, { tint: 0xfff4e0, life: heavy ? 0.28 : 0.18, s0: (s / 128) * (0.9 + R * 0.7), s1: (s / 128) * (0.3 + R * 0.2), a0: 1, a1: 0, rot: Math.random() * 3 });
    this.ring(x, y, z, 0.1, R * 1.1, 0xfff0d8, heavy ? 0.42 : 0.3, 'shock');
    if (!small) this.ring(x, y, z, 0.15, R, col, heavy ? 0.6 : 0.45);
    this.burst(gx, gy, s, Math.round((small ? 4 : 6) + R * (heavy ? 6 : 3)), col, { speed: 1.8 + R, life: heavy ? 0.6 : 0.45, up: 0.5 });
    this.smoke(gx, gy - s * 0.15, s * (0.35 + R * 0.35), o.smoke ?? 0x2a2522, heavy ? 0.5 : 0.35);
    if (rich && heavy) {
      // debris: dark chunks and hot embers thrown up, falling back
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI * (0.15 + Math.random() * 0.7), v = s * (1.6 + Math.random() * 1.8);
        const hot = i % 2 === 0;
        this.particle(hot ? 'dot' : 'shard', gx, gy, {
          add: hot, tint: hot ? col : 0x2e2620, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: s * 5, life: 0.55 + Math.random() * 0.25,
          s0: (s / 32) * (hot ? 0.16 : 0.2), s1: (s / 32) * (hot ? 0.04 : 0.14), a0: 1, a1: hot ? 0 : 0.4, spin: (Math.random() - 0.5) * 14,
        });
      }
      // a scorch mark fading on the ground (flattened like the ground under the camera)
      const c = cam.project(x, y, z + 0.01, this._p);
      const cx = c.x, cy = c.y;
      const flat = clamp((cy - cam.project(x, y + 1, z + 0.01, this._q).y) / Math.max(1, c.s), 0.25, 1);
      this.particle('soft', cx, cy, { add: false, tint: 0x000000, life: 1.6, s0: (c.s / 128) * R * 1.5 * flat, s1: (c.s / 128) * R * 1.6 * flat, sx: 1 / flat, a0: 0.4, a1: 0 });
    }
    if (o.tiles) this.tileFlash(o.tiles, col, 0.45);
  }

  /** Dark (normal-blend) smoke puff. */
  smoke(x, y, size, tint, alpha = 0.45) {
    this.particle('smoke', x, y, { add: false, tint, life: 0.8, s0: size / 128 * 0.9, s1: size / 128 * 2, a0: alpha, a1: 0 });
  }

  /** Motion streak between two world points at height z (dash / pull / blink trails). */
  streak(x0, y0, x1, y1, z, tint, life = 0.3) {
    const cam = this.ctx.cam();
    const a = cam.project(x0, y0, z, this._p), ax = a.x, ay = a.y;
    const b = cam.project(x1, y1, z, this._q);
    const len = Math.hypot(b.x - ax, b.y - ay);
    if (len < 2) return;
    const th = Math.max(0.05, (b.s * 0.3) / 32);
    this.particle('streak', b.x, b.y, { tint, life, s0: th, s1: th * 0.5, sx: len / 128 / th, a0: 0.8, a1: 0, rot: Math.atan2(b.y - ay, b.x - ax), anchorX: 1 });
  }

  /** Light strike from the sky onto a point (lightning / skill strikes / columns). */
  strike(x, y, z, tint, wide = false) {
    const cam = this.ctx.cam();
    const g = cam.project(x, y, z);
    this.particle('pillar', g.x, g.y, { tint, life: 0.4, s0: g.s / 64 * (wide ? 1.2 : 0.7), s1: g.s / 64 * (wide ? 0.9 : 0.2), a0: 1, a1: 0, sx: wide ? 1 : 0.5, ay: 1 });
    this.particle('glow', g.x, g.y - g.s * 0.2, { tint, life: 0.3, s0: g.s / 128 * 0.8, s1: g.s / 128 * 1.6, a0: 0.9, a1: 0 });
    this.ring(x, y, z, 0.1, wide ? 1.2 : 0.7, tint, 0.35);
    this.burst(g.x, g.y - g.s * 0.2, g.s, 6, tint, { speed: 2.4, life: 0.35 });
  }

  /** Floating label ('!', '+10') at a screen point, using the damage-number pool. */
  numberAt(x, y, label, tint, life = 0.8) {
    const P = this.P;
    if (this.labels.length >= 24) { const o = this.labels.shift(); o.t.destroy(); }
    const t = new P.BitmapText(String(label), { fontName: DMG_STYLE.true.font, fontSize: 26, align: 'center' });
    t.anchor.set(0.5, 1);
    t.tint = tint;
    t.position.set(x, y);
    this.ctx.layers.text.addChild(t);
    this.labels.push({ t, y0: y, life: 0, max: life });
  }

  _updateLabels(dt) {
    let w = 0;
    for (const l of this.labels) {
      l.life += dt;
      if (l.life >= l.max) { l.t.destroy(); continue; }
      const k = l.life / l.max;
      l.t.position.y = l.y0 - 22 * easeOut(k);
      l.t.alpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      l.t.scale.set(k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k - 0.12));
      this.labels[w++] = l;
    }
    this.labels.length = w;
  }

  /** Persistent ground area: soft disc + pulsing edge ring for `dur` real seconds (telegraphs pulse faster). */
  zone(x, y, z, r, tint, dur, tex = 'soft', warn = false) {
    const P = this.P;
    const disc = new P.Sprite(this.tex[tex === 'ring' ? 'soft' : tex] || this.tex.soft);
    disc.anchor.set(0.5); disc.blendMode = P.BLEND_MODES.ADD; disc.tint = tint;
    const edge = new P.Sprite(this.tex.ring);
    edge.anchor.set(0.5); edge.blendMode = P.BLEND_MODES.ADD; edge.tint = tint;
    this._onGround(disc, y, z); this._onGround(edge, y, z);
    this.zones.push({ disc, edge, x, y, z, r, t: 0, dur, warn });
    if (this.zones.length > 24) this._freeZone(this.zones.shift());
  }

  _freeZone(zn) { zn.disc.destroy(); zn.edge.destroy(); }

  _updateZones(dt) {
    const cam = this.ctx.cam();
    const p = this._p, q = this._q;
    let w = 0;
    for (const zn of this.zones) {
      zn.t += dt;
      if (zn.t >= zn.dur) { this._freeZone(zn); continue; }
      const k = zn.t / zn.dur;
      const grow = Math.min(1, zn.t / 0.25);
      const rad = zn.r * (0.35 + 0.65 * easeOut(grow));
      cam.project(zn.x, zn.y, zn.z + 0.02, p);
      cam.project(zn.x, zn.y + rad, zn.z + 0.02, q);
      const rx = p.s * rad, ry = Math.max(1, p.y - q.y);
      const fade = k > 0.8 ? (1 - k) / 0.2 : 1;
      const pulse = zn.warn ? 0.55 + 0.45 * Math.abs(Math.sin(zn.t * 7)) : 0.8 + 0.2 * Math.sin(zn.t * 3);
      zn.disc.position.set(p.x, p.y); zn.disc.scale.set((rx * 2) / 128, (ry * 2) / 128); zn.disc.alpha = (zn.warn ? 0.35 : 0.28) * fade * pulse;
      zn.edge.position.set(p.x, p.y); zn.edge.scale.set((rx * 2.1) / 128, (ry * 2.1) / 128); zn.edge.alpha = 0.75 * fade * pulse;
      this.zones[w++] = zn;
    }
    this.zones.length = w;
  }

  /** Flash a set of tiles ([[r,c]]) on the ground (telegraphed boxes, blast tiles). */
  tileFlash(tiles, tint, dur, warn = false) {
    if (!Array.isArray(tiles) || !tiles.length) return;
    this.tileFlashes.push({ tiles: tiles.slice(0, 60), tint, dur: Math.max(0.2, dur), t: 0, warn });
    if (this.tileFlashes.length > 12) this.tileFlashes.shift();
  }

  _updateTileFlashes(dt) {
    const g = this.tileGfx;
    g.clear();
    if (!this.tileFlashes.length) return;
    const cam = this.ctx.cam();
    const p = this._p;
    let w = 0;
    for (const f of this.tileFlashes) {
      f.t += dt;
      if (f.t >= f.dur) continue;
      const k = f.t / f.dur;
      const a = (f.warn ? 0.35 + 0.35 * Math.abs(Math.sin(f.t * 7)) : 0.55 * (1 - k)) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      for (const [r, c] of f.tiles) {
        const z = (this.ctx.heightAt ? this.ctx.heightAt(r, c) : 0) + 0.015;
        const pts = [];
        for (const [dx, dy] of [[-0.46, 0.46], [0.46, 0.46], [0.46, -0.46], [-0.46, -0.46]]) { cam.project(c + dx, r + dy, z, p); pts.push(p.x, p.y); }
        g.lineStyle(Math.max(1, p.s * 0.03), f.tint, Math.min(1, a * 1.6));
        g.beginFill(f.tint, a * 0.6);
        g.drawPolygon(pts);
        g.endFill();
      }
      this.tileFlashes[w++] = f;
    }
    this.tileFlashes.length = w;
  }

  /** Full-screen colour pulse (field-wide telegraphs, cold wind). */
  flashScreen(tint, alpha = 0.4, dur = 0.6) {
    this.tintT = dur; this.tintDur = dur; this.tintA = alpha;
    this.tintSprite.tint = tint;
  }

  /** A short flurry of snow over the field (cold wind). */
  snowfall(tint) {
    const size = this.ctx.screenSize();
    for (let i = 0; i < (this.quality === 'low' ? 10 : 26); i++) {
      this.particle('dot', Math.random() * size.width, Math.random() * size.height * 0.7, { tint, vx: 30 + Math.random() * 40, vy: 60 + Math.random() * 60, life: 1 + Math.random() * 0.6, s0: 0.25 + Math.random() * 0.3, s1: 0.1, a0: 0.8, a1: 0, fadeIn: 0.2 });
    }
  }

  /** Leak: objective flash + red screen vignette pulse. */
  leak() {
    this.vigT = 0.9;
  }

  /** Screen-space pop (bond layer gain / bounty coins). `icon` = texture or null. */
  pop(icon, label, tint, i = 0) {
    const P = this.P;
    const size = this.ctx.screenSize();
    const top = this.ctx.fieldTop ? this.ctx.fieldTop() : size.height * 0.2;
    const c = new P.Container();
    const x = size.width / 2 + (i % 5 - 2) * 70;
    c.position.set(x, top);
    if (icon) {
      const glow = new P.Sprite(this.tex.glow);
      glow.anchor.set(0.5); glow.tint = tint; glow.blendMode = P.BLEND_MODES.ADD; glow.scale.set(0.9);
      const sp = new P.Sprite(icon);
      sp.anchor.set(0.5);
      sp.tint = tint;
      // 46 px along its longer side. A bond icon (app.js 'layer': PIXI.Texture.from(url)) is a 1×1 placeholder until
      // its image has loaded: sized from that it was drawn 46× too big, ~5000 px over the whole screen for the pop's
      // 1.4 s (user playtest #4 item 13) — so it is sized once its texture is valid, and hidden until then.
      const fit = () => {
        if (sp.destroyed) return;
        sp.scale.set(46 / Math.max(1, icon.width, icon.height));
        sp.visible = true;
      };
      if (icon.valid) fit();
      else { sp.visible = false; icon.once('update', fit); }
      c.addChild(glow, sp);
    }
    if (label) {
      const t = new P.BitmapText(label, { fontName: DMG_STYLE.heal.font, fontSize: 26 });
      t.anchor.set(0, 0.5);
      t.position.set(26, 0);
      if (tint === COLORS.gold) t.tint = 0xffe066;
      c.addChild(t);
    }
    this.ctx.layers.screen.addChild(c);
    this.pops.push({ c, t: 0, dur: 1.4, y0: top });
    if (this.pops.length > 12) { const o = this.pops.shift(); o.c.destroy({ children: true }); }
  }

  _updatePops(dt) {
    let w = 0;
    for (const p of this.pops) {
      p.t += dt;
      if (p.t >= p.dur) { p.c.destroy({ children: true }); continue; }
      const k = p.t / p.dur;
      p.c.position.y = p.y0 - 40 * easeOut(k);
      p.c.alpha = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const s = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15));
      p.c.scale.set(s);
      this.pops[w++] = p;
    }
    this.pops.length = w;
  }

  /** Remove everything (battle reset). */
  clear() {
    for (const p of this.parts) this._freeParticle(p);
    this.parts.length = 0;
    for (const pr of this.projs) this._releaseProj(pr);
    this.projs.length = 0;
    for (const L of this.locks) this._freeLock(L);
    this.locks.length = 0;
    this._slashAt = null;
    for (const t of this.nums) this._releaseNum(t);
    this.nums.length = 0;
    for (const r of this.rings) { r.sp.visible = false; this.ringFree.push(r); }
    this.rings.length = 0;
    for (const a of this.auras.values()) a.sp.destroy({ children: true });
    this.auras.clear();
    for (const p of this.pops) p.c.destroy({ children: true });
    this.pops.length = 0;
    this.beamList.length = 0;
    this.beams.clear();
    for (const F of this.flames) this._freeFlame(F);
    this.flames.length = 0;
    this.vigT = 0;
    this.vignette.alpha = 0;
    for (const zn of this.zones) this._freeZone(zn);
    this.zones.length = 0;
    for (const l of this.labels) l.t.destroy();
    this.labels.length = 0;
    this.tileFlashes.length = 0;
    this.tileGfx.clear();
    this.tintT = 0; this.tintSprite.alpha = 0;
  }

  update(dt) {
    this.time += dt;
    this._updateParticles(dt);
    this._updateProjs(dt);
    this._updateLocks(dt);
    this._updateBeams(dt);
    this._updateFlames(dt);
    this._updateNums(dt);
    this._updateRings(dt);
    this._updateAuras(dt);
    this._updatePops(dt);
    this._updateZones(dt);
    this._updateLabels(dt);
    this._updateTileFlashes(dt);
    if (this.tintT > 0) {
      this.tintT = Math.max(0, this.tintT - dt);
      const size = this.ctx.screenSize();
      this.tintSprite.width = size.width; this.tintSprite.height = size.height;
      this.tintSprite.alpha = Math.sin((this.tintT / this.tintDur) * Math.PI) * this.tintA * 0.35;
    } else if (this.tintSprite.alpha) this.tintSprite.alpha = 0;
    if (this.vigT > 0) {
      this.vigT = Math.max(0, this.vigT - dt);
      const size = this.ctx.screenSize();
      this.vignette.width = size.width; this.vignette.height = size.height;
      this.vignette.alpha = Math.sin((this.vigT / 0.9) * Math.PI) * 0.55;
    } else if (this.vignette.alpha) this.vignette.alpha = 0;
  }

  get counts() {
    return { particles: this.parts.length, projectiles: this.projs.length, numbers: this.nums.length, rings: this.rings.length, auras: this.auras.size, locks: this.locks.length, flames: this.flames.length, promotions: this.promotions || 0 };
  }

  destroy() {
    this.clear();
    this.addPc.destroy({ children: true });
    this.normPc.destroy({ children: true });
    this.projLayer.destroy({ children: true });
    this.shadowLayer.destroy({ children: true });
    this.lockFree.length = 0;
    this.projFree.length = 0;
    this.freeAdd.length = 0; this.freeNorm.length = 0;
    this.beams.destroy();
    this.vignette.destroy();
    this.tileGfx.destroy();
    this.tintSprite.destroy();
    for (const list of this._numPools.values()) for (const t of list) t.text.destroy();
    this._numPools.clear();
  }
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);
