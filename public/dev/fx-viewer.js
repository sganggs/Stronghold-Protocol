// public/dev/fx-viewer.js — dev viewer of the official battle effects (render/vfx, DESIGN §33): plays any extracted
// prefab key on the board camera (the official battle camera of render/projection.js) with play / pause / step, 1× / 2×
// (the battle clock), the 完整 / 精简 tiers, a left / right facing and an optional unit whose skin's mount points place
// the effect (its `_spawnLocation`) — markers show the points. A 2D canvas under the transparent Pixi canvas stands in
// for the 3D board, so the effects composite onto it as they do in the game.
//
// Query: ?key=<prefab> &unit=<unit id> &speed=1|2 &tier=full|lite &face=L|R &panel=0 &seed=<n> &bg=<css colour>
//        &grid=0 (a flat background without the tiles: the browser test measures the blending on it)
//        &stress=<loops>,<hits per s> (a crowd: that many status loops on a 11 × 5 tile area and hits every second —
//        the particle budget's perf check; window.__fx.sample(ms) → { fps, p95, cpuMs, particles, effects, draws })
//        &attack=<unit id> (the wiring demo: that unit attacks a dummy 3 tiles away every second — its casts,
//        projectile and hits from index.json through render/vfx/wiring.js, as in a battle) &kind=<projKind> &skill=1
//        &dist=<tiles> (to the dummy; with &face=L it stands on the left and the attacker faces it)
//        &skilldemo=<unit id> (the skill demo, render/vfx/skillfx.js: that unit's official skill — &s=<skill slot, 0-based>
//        or &sid=<skill id> — turns on, attacks the dummy every second and turns off, every 6 s; &instant=1 one attack
//        between on and off in one frame, &passive=1 deployed instead, &charge=<n> stores n energies a cycle and releases
//        them with an attack (深靛), &ready=1 a full SP bar between casts, &hits=<n> damage events per blow, &kind=;
//        an enemy (index v2: its skills by prefabKey, slot &s in the index's order) opens its skill window with the
//        snapshot's SKILL anim and the 'cast' slot, attacks in the same frame and every second after (&block=1: blocked,
//        its combat; &form=<form> a form naming its mode); skillDemo(unit, { manual: true }) runs no cycle: skillCmd
//        drives it, every frame still syncs the wiring)
// Puppeteer hook: window.__fx = { ready, error, lib, ofx, play(key, o), step(frames, dt), render(), clear(), stats(),
//   setTier(t), keys(), skillDemo(unit, o), skillCmd(cmd, a, b), skillUnits() } — the tests drive frames by hand
//   (ticker stopped) for deterministic pictures. The kit fx a 驭械术士's floating units stand for (render/vfx/funnelfx.js) go
//   through skillCmd('fx', kind, extra): 'drone' / 'drones' { n } / 'droneLock' { id: 2, src: 1 } / 'overload'.

import { OfficialFx } from '../js/render/vfx/system.js';
import { FxWiring } from '../js/render/vfx/wiring.js';
import { projSpeed } from '../js/render/fx.js';
import { spawnPoint, unitPoint, spawnRotation, graphicRotation, mountRotation } from '../js/render/vfx/mounts.js';
import { fallbackLog } from '../js/render/vfx/materials.js';
import { presetCamera } from '../js/render/projection.js';
import { assets } from '../js/assets.js';
import { ensurePixi } from '../js/render/app/pixi.js';
import { UF, ANIM } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const api = { ready: false, error: null };
window.__fx = api;

const UNIT_TILE = { row: 10, col: 5 };
const state = { key: q.get('key') || 'common_hit_01', speed: Number(q.get('speed')) === 1 ? 1 : 2, paused: false, loop: true, left: q.get('face') === 'L', unit: q.get('unit') || '', handle: null };

function drawBoard(cam, w, h) {
  const c = $('board');
  const dpr = devicePixelRatio || 1;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = q.get('bg') || '#1b2422';
  g.fillRect(0, 0, w, h);
  if (q.get('grid') === '0') return;
  for (let r = 6; r <= 13; r++) for (let col = -1; col <= 11; col++) {
    const pts = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([dx, dy]) => cam.project(col + dx, r + dy, 0));
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = (r + col) % 2 ? '#2b3633' : '#323f3b';
    g.fill();
    g.strokeStyle = '#46554f';
    g.lineWidth = 1;
    g.stroke();
  }
}

async function main() {
  if (q.get('panel') === '0') $('panel').classList.add('is-hidden');
  const P = await ensurePixi(); // the page's CSP has no unsafe-eval: the no-eval shader path
  const host = $('field');
  const W = () => Math.max(1, host.clientWidth), H = () => Math.max(1, host.clientHeight);
  const app = new P.Application({ width: W(), height: H(), backgroundAlpha: 0, antialias: false, resolution: devicePixelRatio || 1, autoDensity: true, preserveDrawingBuffer: true });
  host.appendChild(app.view);
  app.view.style.width = '100%'; app.view.style.height = '100%';
  let cam = presetCamera('normal', { width: W(), height: H() }, { side: 'L' });
  drawBoard(cam, W(), H());
  addEventListener('resize', () => { app.renderer.resize(W(), H()); cam = presetCamera('normal', { width: W(), height: H() }, { side: 'L' }); drawBoard(cam, W(), H()); });

  await assets.ready?.();
  const ofx = new OfficialFx({ P, renderer: app.renderer, assets, cam: () => cam, heightAt: () => 0, tier: q.get('tier') === 'lite' ? 'lite' : 'full' });
  ofx.setGround(() => 0, 'flat');
  const markers = new P.Graphics();
  app.stage.addChild(ofx.ground, markers, ofx.over);
  api.ofx = ofx; api.lib = ofx.lib; api.app = app;
  const ok = await ofx.init();
  if (!ok) { $('stats').textContent = 'no extracted effects (data/local-fx.json)'; api.error = 'no effects'; api.ready = true; return; }
  const index = await ofx.lib.index();
  const keys = Object.keys(ofx.lib.groups['fx/prefabs']).sort();
  const dl = $('keys');
  for (const k of keys) dl.append(new Option(k));
  const units = index ? Object.keys(index.units || {}).sort() : [];
  for (const u of units) $('unit').append(new Option(u, u));
  $('key').value = state.key;
  $('unit').value = state.unit;

  let demo = { on: false, t: 0, src: null, tgt: null, kind: q.get('kind') || 'arrow' };
  let demoStep = () => {};
  const unitAt = () => ({ x: UNIT_TILE.col, y: UNIT_TILE.row, z: 0, left: state.left, back: false });
  const skinOf = () => {
    const u = index?.units?.[state.unit];
    return u && u.skin ? index.skins?.[u.skin] : null;
  };

  function drawMarkers() {
    markers.clear();
    const skin = skinOf();
    const u = unitAt();
    if (q.get('grid') === '0') return;
    const foot = cam.project(u.x, u.y, 0);
    markers.lineStyle(1, 0xffffff, 0.5).drawCircle(foot.x, foot.y, 4);
    if (!skin) return;
    for (const [kind, col] of [['hit', 0xff5050], ['muzzle', 0x50ff50], ['head', 0x5090ff], ['s0', 0xffff50]]) {
      const p = unitPoint(skin, kind, u);
      const s = cam.project(p[0] + 10, p[1] + 9, -p[2]);
      markers.lineStyle(2, col, 0.9).moveTo(s.x - 5, s.y).lineTo(s.x + 5, s.y).moveTo(s.x, s.y - 5).lineTo(s.x, s.y + 5);
    }
  }

  async function play(key, o = {}) {
    state.key = String(key || state.key).toLowerCase();
    if (state.handle) state.handle.kill();
    const def = await ofx.lib.load(state.key);
    if (!def) { $('stats').textContent = `no prefab ${state.key}`; return null; }
    await ofx.lib.preload([state.key], { half: ofx.lite });
    const u = unitAt();
    const pos = spawnPoint(skinOf(), def.spawn, u);
    // the rotation its spawn location gives it on a unit (render/vfx/wiring.js _rotate): FOOT / HIT / HEAD the Graphic
    // tilt, MUZZLE / a Special point the point's (it faces with the unit: no FLIP_TWO_SIDE of its own), else the identity
    const rk = def.proj ? null : spawnRotation(def.spawn);
    const mountRot = rk && rk !== 'graphic' ? mountRotation(skinOf(), rk, u) : null;
    const rootRot = rk === 'graphic' ? graphicRotation(skinOf()) : mountRot || def.proj ? null : [0, 0, 0, 1];
    const flip = (def.rotateType === 1 && !mountRot && (u.left !== def.leftIsDefault)) || (!!def.proj && u.left);
    const mirror = flip && !(def.rotateType === 1 && def.rotY >= 0), flipY = flip && def.rotateType === 1 && def.rotY >= 0;
    const yaw = def.rotateType === 2 || def.rotateType === 4 ? (u.left ? Math.PI : 0) : 0;
    // a projectile's flying part flies 3 tiles to the right (or left) and back, like a shot across the board
    let track = null;
    if (def.proj) {
      const from = pos.slice(), dir = u.left ? -1 : 1, dur = 0.5;
      track = (fx) => {
        const k = (fx.time % (dur * 2)) / dur;
        const f = k <= 1 ? k : 2 - k;
        fx.anchor[0] = from[0] + dir * 3 * f;
        fx.anchor[1] = from[1];
        fx.anchor[2] = from[2];
        fx.yaw = (k <= 1) === (dir > 0) ? 0 : Math.PI;
        fx.mirror = false;
      };
    }
    state.handle = ofx.spawn(state.key, { pos, yaw, mirror: def.proj ? false : mirror, flipY, groundZ: 0, mountRot, rootRot }, { loop: true, track, seed: o.seed ?? (Number(q.get('seed')) || 1) });
    drawMarkers();
    return state.handle;
  }

  function step(frames = 1, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) {
      ofx.update(dt * state.speed);
      demoStep(dt * state.speed);
      if (state.loop && state.handle && !state.handle.alive && !demo.on) play(state.key);
    }
  }

  // ---- stress: a crowd of loops and hits (the particle budget) --------------------------------------------------------
  const stress = { on: false, loops: 0, hits: 0, acc: 0, handles: [] };
  const LOOPS = ['buff_burn', 'buff_autochess_frozen', 'buff_poison', 'buff_cold', 'buff_stun', 'common_shield_01', 'buff_slowdown', 'common_invincible_01'];
  const HITS = ['common_hit_01', 'common_magic_hit_01', 'common_firemagic_hit_01', 'common_enemy_hit_01', 'common_heal_hit_01', 'common_ranger_hit_01'];
  const at = (i) => { const col = (i * 7) % 11, row = 8 + ((i * 3) % 5); return [col - 10, row - 9 + 0.2, -0.25]; };
  async function startStress(loops, hits) {
    ofx.clear(); state.loop = false; state.handle = null;
    await ofx.lib.preload([...LOOPS, ...HITS], { half: ofx.lite });
    stress.on = true; stress.loops = loops; stress.hits = hits; stress.acc = 0; stress.n = 0;
    stress.handles = Array.from({ length: loops }, (_, i) => ofx.spawn(LOOPS[i % LOOPS.length], { pos: at(i), groundZ: 0 }, { loop: true, important: true }));
  }
  const stressStep = (dt) => {
    if (!stress.on) return;
    stress.acc += dt * stress.hits;
    while (stress.acc >= 1) { stress.acc -= 1; const i = stress.n++; ofx.spawn(HITS[i % HITS.length], { pos: at(i * 5 + 1), groundZ: 0 }, {}); }
  };
  let cpuMs = 0, renderMs = 0, r0 = 0;
  // the render's cost (Pixi renders at UPDATE_PRIORITY.LOW = −25)
  app.ticker.add(() => { r0 = performance.now(); }, null, -24);
  app.ticker.add(() => { if (r0) renderMs = renderMs * 0.9 + (performance.now() - r0) * 0.1; }, null, -26);
  app.ticker.add(() => {
    const t0 = performance.now();
    if (!state.paused) { step(1, app.ticker.deltaMS / 1000); stressStep(app.ticker.deltaMS / 1000 * state.speed); }
    cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    const s = ofx.stats();
    $('stats').textContent = `${state.key}  ${state.handle?.effect ? state.handle.effect.state : '—'}  t=${state.handle?.effect ? state.handle.effect.time.toFixed(2) : '—'}\n` +
      `effects ${s.effects}  particles ${s.particles}  draws ${s.draws}  programs ${s.programs}  textures ${s.textures} (${s.texMB} MB)\n` +
      `fallback shaders: ${fallbackLog().map(([n, f]) => `${n} → ${f}`).join(', ') || 'none'}`;
    ofx.frameStats();
  });

  const toggle = (on, off) => { $(on).classList.add('is-on'); $(off).classList.remove('is-on'); };
  $('play').onclick = () => play($('key').value);
  $('key').onchange = () => play($('key').value);
  $('pause').onclick = () => { state.paused = !state.paused; $('pause').classList.toggle('is-on', state.paused); };
  $('step').onclick = () => { state.paused = true; $('pause').classList.add('is-on'); step(1, 1 / 60); };
  $('speed1').onclick = () => { state.speed = 1; toggle('speed1', 'speed2'); };
  $('speed2').onclick = () => { state.speed = 2; toggle('speed2', 'speed1'); };
  $('loop').onclick = () => { state.loop = !state.loop; $('loop').classList.toggle('is-on', state.loop); };
  $('stop').onclick = () => { state.loop = false; $('loop').classList.remove('is-on'); state.handle?.stop(); };
  $('clear').onclick = () => { ofx.clear(); state.handle = null; };
  $('full').onclick = () => { ofx.setTier('full'); toggle('full', 'lite'); play(state.key); };
  $('lite').onclick = () => { ofx.setTier('lite'); toggle('lite', 'full'); play(state.key); };
  $('faceL').onclick = () => { state.left = true; toggle('faceL', 'faceR'); play(state.key); };
  $('faceR').onclick = () => { state.left = false; toggle('faceR', 'faceL'); play(state.key); };
  $('unit').onchange = () => { state.unit = $('unit').value; play(state.key); };
  if (q.get('speed')) toggle(state.speed === 1 ? 'speed1' : 'speed2', state.speed === 1 ? 'speed2' : 'speed1');

  // ---- the wiring demo: a unit attacking a dummy (render/vfx/wiring.js) ----------------------------------------------
  const wiring = new FxWiring(ofx, { speed: projSpeed });
  await wiring.ready();
  const fake = (id, unitKey, col, row, enemy) => ({ id, x: col, y: row, z: 0, hover: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0,
    info: { id, spine: unitKey, defId: unitKey, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: 0 } });
  function startAttackDemo(unitKey, o = {}) {
    ofx.clear(); wiring.clear();
    demo.on = true; demo.t = 0; demo.kind = o.kind || demo.kind;
    // facing left (&face=L): the dummy stands on the left and the attacker faces it (an operator's deploy direction LEFT)
    const left = o.left ?? state.left, dist = o.dist ?? 3;
    demo.src = fake(1, unitKey, UNIT_TILE.col, UNIT_TILE.row, /^enemy_/.test(unitKey));
    demo.tgt = fake(2, o.target || 'enemy_1007_slime', UNIT_TILE.col + (left ? -dist : dist), UNIT_TILE.row, !/^enemy_/.test(unitKey));
    demo.src.visFacing = left ? -1 : 1;
    demo.tgt.visFacing = left ? 1 : -1;
    if (!demo.src.isEnemy) demo.src.dir = left ? 'LEFT' : 'RIGHT';
    if (o.skill) demo.src.flags |= UF.SKILL;
    wiring.begin([demo.src, demo.tgt]);
  }
  // the wind-up, as render/app.js starts it with the attacker's clip: the casts that start with the cast (ON_CAST_START)
  // play WIND_UP s before each attack after the first, the rest at the strike
  const WIND_UP = 0.3;
  demoStep = (dt) => {
    if (!demo.on) return;
    const before = demo.t;
    demo.t += dt;
    wiring.tick();
    if (before > 0 && Math.floor(before + WIND_UP) !== Math.floor(demo.t + WIND_UP)) wiring.castStart(demo.src, demo.tgt, demo.kind, { skip: 0, left: WIND_UP + 0.5 });
    if (Math.floor(before) !== Math.floor(demo.t) || before === 0) {
      const melee = demo.kind === 'none';
      wiring.attack(demo.src, demo.tgt, demo.kind, ofx.time, before > 0);
      // the damage lands when the sim's projectile would (melee: at once)
      const dur = melee ? 0 : Math.hypot(demo.tgt.x - demo.src.x, demo.tgt.y - demo.src.y) / projSpeed(demo.kind);
      (ofx.timers || (ofx.timers = [])).push({ at: ofx.time + dur, fn: () => wiring.damage(demo.tgt, 'phys', demo.src, ofx.time) });
    }
  };
  // ---- the skill demo: a unit's official skill through the wiring (render/vfx/skillfx.js) --------------------------------
  // A cycle of SKILL_CYCLE s: the skill turns on at 0.3 s, the unit attacks the dummy every second (wound up WIND_UP s
  // ahead; the damage lands after the sim's flight time, `hits` damage events per blow), the skill turns off at 4.3 s (an
  // instant skill: in the frame it turned on, after its one attack); a passive is deployed instead; `charge` stores that
  // many energies (one a second) before each attack releases them; `ready` fills the SP bar between casts. An enemy: its
  // skill window opens at 0.3 s (the snapshot's SKILL anim for 0.5 s, as the sim's skill `fire` holds it, and the 'cast'
  // slot) with an attack, then it attacks every second.
  const SKILL_CYCLE = 6;
  const sk = { on: false, t: 0, src: null, tgt: null, o: {}, last: -1, store: 0 };
  function startSkillDemo(unitKey, o = {}) {
    ofx.clear(); wiring.clear(); demo.on = false;
    const u = index?.units?.[unitKey];
    const enemy = /^enemy_/.test(unitKey);
    const ids = u ? Object.keys(u.skills || {}) : [];
    const sid = o.sid || ids[Math.max(0, Math.min(ids.length - 1, o.s | 0))] || null;
    const left = o.left ?? state.left, dist = o.dist ?? 3;
    sk.o = { kind: o.kind || 'none', hits: Math.max(1, o.hits | 0 || 1), instant: !!o.instant, passive: !!o.passive, charge: o.charge | 0, ready: !!o.ready, manual: !!o.manual, s: o.s | 0 };
    // a synthetic data record (the viewer has no data store): the skill's id, type and a lasting duration unless instant;
    // an enemy's names its skills by prefabKey in the index's order (its slots)
    // (its talents: every base talent index of the unit's talentKeys — index v3, render/vfx/talents.js; an enemy's are all on)
    const talents = Object.keys(u?.talentKeys?.base || {}).map((i) => ({ index: Number(i) }));
    // (an enemy's skills in its data record's order when given — `o.skills`, data/enemies.json prefabKeys: the slots the
    // sim's 'cast' names — else the index's)
    const rec = enemy ? { skills: (Array.isArray(o.skills) ? o.skills : ids).map((k) => ({ prefabKey: k })), talents: { bb: o.talentBb || {} } }
      : { charId: unitKey, talents, ...(sid ? { skill: { skillId: sid, index: o.s | 0, skillType: sk.o.passive ? 'PASSIVE' : 'MANUAL', durationType: 'NONE', duration: sk.o.instant || sk.o.passive ? 0 : 4, bb: o.bb || { duration: 3, projectile_life_time: 4 } } } : {}) };
    wiring.opts.record = (info) => (info?.id === 1 ? rec : null);
    wiring.opts.view = (id) => (id === 1 ? sk.src : id === 2 ? sk.tgt : null);
    sk.src = fake(1, unitKey, UNIT_TILE.col, UNIT_TILE.row, enemy);
    sk.tgt = fake(2, o.target || (enemy ? 'char_010_chen' : 'enemy_1007_slime'), UNIT_TILE.col + (left ? -dist : dist), UNIT_TILE.row, !enemy);
    sk.src.visFacing = left ? -1 : 1; sk.tgt.visFacing = left ? 1 : -1;
    if (!sk.src.isEnemy) sk.src.dir = left ? 'LEFT' : 'RIGHT';
    sk.src.info.skillIndex = o.s | 0;
    Object.assign(sk.src, { sp: 0, spMax: 10, energy: sk.o.charge ? [0, sk.o.charge] : null, anim: 0, form: o.form || null, hp: 100, maxHp: 100 });
    if (o.block) sk.src.flags |= UF.BLOCKED;
    sk.on = true; sk.t = 0; sk.last = -1; sk.store = 0;
    wiring.begin([sk.src, sk.tgt]);
    if (sk.o.passive) { wiring.skill(sk.src, true); wiring.deploy(sk.src); }
    const U = wiring.skills.of(sk.src);
    return { sid, plan: (enemy ? U?.enemy?.find((x) => x.slot === sk.o.s)?.plan : U?.plan) || null };
  }
  /**
   * One command of the skill demo (the tests drive it by hand): on, off, attack, energy n, deploy, die, fx kind [extra];
   * an enemy's: cast slot [dur] (b.ev 'cast'), anim n (the snapshot's: ANIM.SKILL opens a single-skill enemy's window,
   * leaving it closes the window), block on|off (UF.BLOCKED: its combat), form name [fx extra] (a sim form fx: a 重生's
   * 'reborn' / 'form2', a 替身's 'doll'); talents (index v3): spawn (an enemy's or a summon's deploy talents), hp n [max]
   * (an HP-ratio toggle), flags n (the snapshot flags: blocked, 隐匿 …), kitfx kind [extra] (a kit fx naming the unit:
   * 'substitute', 'extraAttack' …).
   */
  function skillCmd(cmd, a, b) {
    const s = sk.src, t = sk.tgt;
    if (!s) return false;
    switch (cmd) {
      case 'on': s.flags |= UF.SKILL; return wiring.skill(s, true);
      case 'off': s.flags &= ~UF.SKILL; return wiring.skill(s, false);
      case 'attack': {
        const kind = a || sk.o.kind;
        wiring.castStart(s, t, kind, { skip: 0, left: 0.6, skillOn: !!(s.flags & UF.SKILL) });
        wiring.attack(s, t, kind, ofx.time, true);
        const dur = kind === 'none' ? 0 : Math.hypot(t.x - s.x, t.y - s.y) / projSpeed(kind);
        (ofx.timers || (ofx.timers = [])).push({ at: ofx.time + dur, fn: () => { const now = ofx.time; for (let i = 0; i < sk.o.hits; i++) wiring.damage(t, 'phys', s, now); } });
        return true;
      }
      case 'energy': s.energy = [Math.max(0, a | 0), Math.max(1, sk.o.charge || 3)]; return true;
      case 'deploy': return wiring.deploy(s);
      case 'die': return wiring.death(s);
      case 'sp': s.sp = Number(a) || 0; return true;
      case 'fx': return wiring.simFx(a, b?.x ?? t.x, b?.y ?? t.y, { id: 1, ...(b || {}) });
      case 'cast': return wiring.enemyCast(s, a | 0, Number(b) || 0);
      case 'spawn': return wiring.spawned(s);
      case 'hp': s.hp = Number(a); s.maxHp = Number(b) || s.maxHp || 100; return true;
      case 'flags': s.flags = a | 0; return true;
      case 'anim': s.anim = a | 0; return true;
      case 'block': if (a === false || a === 'off') s.flags &= ~UF.BLOCKED; else s.flags |= UF.BLOCKED; return true;
      case 'form': s.form = a || null; return wiring.form(s, a || null, b || {});
      case 'kitfx': return wiring.simFx(a, s.x, s.y, { id: 1, ...(b || {}) });
      default: return false;
    }
  }
  const skillStep = (dt) => {
    if (!sk.on) return;
    const before = sk.t;
    sk.t += dt;
    const c0 = before % SKILL_CYCLE, c1 = sk.t % SKILL_CYCLE;
    const crossed = (at) => (c0 < at && c1 >= at) || (c1 < c0 && at <= c1);
    if (sk.o.manual) {
      // driven by skillCmd (the tests): only the frame's sync and timers
    } else if (sk.o.charge) {
      // store one energy a second, release with the attack at the end of the cycle
      if (Math.floor(before) !== Math.floor(sk.t) && c1 < SKILL_CYCLE - 1) sk.store = Math.min(sk.o.charge, sk.store + 1);
      sk.src.energy = [sk.store, sk.o.charge];
      if (crossed(SKILL_CYCLE - 0.5)) { skillCmd('attack', sk.o.kind === 'none' ? 'bolt' : sk.o.kind); sk.store = 0; }
    } else if (sk.src.isEnemy) {
      if (crossed(0.3)) { skillCmd('anim', ANIM.SKILL); skillCmd('cast', sk.o.s); skillCmd('attack'); }
      if (crossed(0.8)) skillCmd('anim', 0);
      for (const at of [1.3, 2.3, 3.3]) if (crossed(at)) skillCmd('attack');
    } else if (!sk.o.passive) {
      if (sk.o.ready) sk.src.sp = c1 < 0.3 || c1 > 4.3 ? 10 : 0;
      if (crossed(0.3)) {
        skillCmd('on');
        if (sk.o.instant) { skillCmd('attack'); skillCmd('off'); }
      }
      for (const at of [1.3, 2.3, 3.3]) if (!sk.o.instant && crossed(at)) skillCmd('attack');
      if (!sk.o.instant && crossed(4.3)) skillCmd('off');
    }
    wiring.sync([sk.src, sk.tgt]);
    wiring.tick();
  };
  const demoStep0 = demoStep;
  demoStep = (dt) => { demoStep0(dt); skillStep(dt); };

  if (q.get('attack')) startAttackDemo(q.get('attack'), { kind: q.get('kind') || undefined, skill: q.get('skill') === '1', dist: Number(q.get('dist')) || undefined });
  if (q.get('skilldemo')) {
    startSkillDemo(q.get('skilldemo'), { s: Number(q.get('s')) || 0, sid: q.get('sid') || undefined, kind: q.get('kind') || undefined, hits: Number(q.get('hits')) || 1,
      instant: q.get('instant') === '1', passive: q.get('passive') === '1', charge: Number(q.get('charge')) || 0, ready: q.get('ready') === '1', dist: Number(q.get('dist')) || undefined,
      block: q.get('block') === '1', form: q.get('form') || undefined });
  }
  if (q.get('stress')) { const [l, h] = q.get('stress').split(',').map(Number); await startStress(l || 0, h || 0); }

  Object.assign(api, {
    play, step,
    attackDemo: startAttackDemo,
    skillDemo: startSkillDemo,
    skillCmd,
    skillUnits: () => ({ src: sk.src, tgt: sk.tgt }),
    /** The prefab keys of the live effects (the tests check what plays); `playing`: not those fading out after a stop. */
    liveKeys: (playing = false) => ofx.effects.filter((e) => !playing || e.state === 'play' || e.state === 'linger').map((e) => e.def?.key).filter(Boolean),
    stress: startStress,
    /** Frame figures over `ms` of animation frames (the stress check). */
    sample: (ms = 4000) => new Promise((resolve) => {
      const d = [];
      let last = performance.now();
      const t0 = last;
      let draws = 0, frames = 0;
      const tick = (t) => {
        d.push(t - last); last = t;
        draws += ofx.stats().draws; frames++;
        if (t - t0 < ms) { requestAnimationFrame(tick); return; }
        d.shift();
        const sorted = [...d].sort((a, b) => a - b);
        const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
        const st = ofx.stats();
        resolve({ fps: Math.round(1000 / avg * 10) / 10, p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, cpuMs: Math.round(cpuMs * 100) / 100, renderMs: Math.round(renderMs * 100) / 100,
          particles: st.particles, effects: st.effects, draws: Math.round(draws / Math.max(1, frames)), texMB: st.texMB });
      };
      requestAnimationFrame(tick);
    }),
    stopDemo: () => { demo.on = false; sk.on = false; },
    wiring,
    render: () => app.renderer.render(app.stage),
    clear: () => { ofx.clear(); state.handle = null; },
    stats: () => ofx.stats(),
    setTier: (t) => ofx.setTier(t),
    keys: () => keys,
    /** Screen px of a board point (col, row, height): where the tests look. */
    project: (x, y, z = 0) => { const p = cam.project(x, y, z); return { x: p.x, y: p.y, s: p.s }; },
    /** The Unity battle-frame point of a skin point kind ('hit', 's0', …) of a unit pose (render/vfx/mounts.js unitPoint). */
    unitPointOf: (skin, kind, pose) => unitPoint(skin, kind, pose),
    unitTile: () => ({ ...UNIT_TILE }),
    stopTicker: () => app.ticker.stop(),
    setLoop: (v) => { state.loop = !!v; },
    setFace: (left) => { state.left = !!left; },
    setUnit: (u) => { state.unit = u || ''; },
    fallbacks: () => fallbackLog(),
  });
  if (!q.get('attack') && !q.get('skilldemo')) await play(state.key);
  api.ready = true;
}

main().catch((err) => { api.error = String(err?.stack || err); api.ready = true; console.error(err); });
