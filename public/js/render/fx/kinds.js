// public/js/render/fx/kinds.js — sim fx kind table and the tile queries the effects use.

/**
 * Sim fx kind → visual archetype (`a`), colour (`c`) and defaults (`r` radius, `dur` game s, `tex`, `smoke`).
 * Covers every kind emitted by server/sim (Battle, kits, tokens, enemies, bosses, devices, bonds, items); unknown
 * kinds fall back to a keyword guess, then to a generic sparkle (fxSpec).
 */
export const FX_KINDS = Object.freeze({
  // blasts
  // [ASSUMED] Clementia's S3 uses the shared blast placeholder until her official effect is ported.
  blast: { a: 'blast', c: 0xffb35c },
  aoe: { a: 'blast', c: 0xffb35c }, explode: { a: 'blast', c: 0xff7a33 }, explosion: { a: 'blast', c: 0xff7a33 },
  // `pt`: always at the event's (x, y) (its `id` is the shooter); `heavy`: debris + scorch
  bombard: { a: 'blast', c: 0xffa04a, r: 1.5, pt: true, heavy: true }, bombardShell: { a: 'shell', c: 0xff5a3a, r: 1.5, pt: true },
  airstrike: { a: 'blast', c: 0xff8a3d, r: 1.5, heavy: true }, splash: { a: 'blast', c: 0xffc27a },
  scorchBurst: { a: 'blast', c: 0xff6a2a }, champagneBomb: { a: 'blast', c: 0xffd27a }, shockBlast: { a: 'blast', c: 0x9fd4ff, smoke: 0x1c2630 },
  frostNova: { a: 'blast', c: 0x9fe6ff, smoke: 0x1c2630 }, sunBurst: { a: 'blast', c: 0xffe28a }, meltdown: { a: 'blast', c: 0xff5a2a, r: 1.5, heavy: true },
  iceSpike: { a: 'blast', c: 0xbfeeff, smoke: 0x1c2630 }, rockfall: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 }, rockslide: { a: 'blast', c: 0xc8a878, smoke: 0x4a3f33 },
  finale: { a: 'blast', c: 0xffd45a, r: 1.5 }, swordStorm: { a: 'blast', c: 0xdfe8ff }, swordRain: { a: 'blast', c: 0xdfe8ff }, liberate: { a: 'blast', c: 0xffffff },
  // 赤刃明霄陈 S3 赤霄·天喟 的龙剑气: a travelling blade, drawn from the sim's per-interval `chen3Wave` events (its own
  // position + the previous point + direction); `pt` because it is not at the caster (it roams and passes by her tile)
  chen3Wave: { a: 'qi', c: 0xdfe8ff, pt: true },
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
  // 自选 operator kits (0.2.0): 逻各斯, 真言, 维伊 (O3); 早露, 提丰, 娜仁图亚 (O7); 嵯峨's 重伤 (O8)
  bulletClear: { a: 'wave', c: 0xd8b0ff }, logosLexicon: { a: 'mark', c: 0xc9a2ff }, logosExecute: { a: 'strike', c: 0xb07dff },
  mantraArc: { a: 'bolt', c: 0xc77dff }, mantraGrant: { a: 'mark', c: 0xc77dff }, mantraGate: { a: 'reticle', c: 0xc77dff },
  veenBounce: { a: 'counter', c: 0xffd27a }, veenVolley: { a: 'volley', c: 0xffd27a },
  harpoon: { a: 'beam', c: 0xd0c0a0 }, arrowRain: { a: 'volley', c: 0xfff2d0 }, mark: { a: 'reticle', c: 0xff7b8a },
  bounce: { a: 'counter', c: 0xffd9a0 }, dying: { a: 'mark', c: 0xff5a4a },
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
 * the 'droneBomb' projectile of the same moment, a puff on the drone would read as something else (feedback D4); a
 * prisoner's 'warning' — its collar light starts blinking orange (the official mode R shows nothing else).
 */
const SILENT_PHASES = new Set(['bombed', 'warning']);

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
 * fire wall: perpendicular to his facing, sim/content/kits/ops/chess_char_6_03-yu.js). Clipped to the field `rect` (inclusive
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
