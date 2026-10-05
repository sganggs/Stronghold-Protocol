// server/sim/content/kits/custom-oblvns.js — 丰川祥子 (char_4182_oblvns, WARRIOR/lord 领主), a DIY catalog kit.
//
// Official kit (E2 / skill Lv7; runtime def = the golden 6_b record with its LOR-Y module merged into talent 1):
//   Trait 领主: ranged attacks at 80 % ATK — professions.js `lord` applies it through `profile.rangedScale`
//     (`trait.bb.atk_scale`), so the kit only restores it after the module's in-skill override.
//   T1 颂乐音符: every attack plays a note; notes linger after leaving range. Per note, Ave Mujica members ignore
//     `def_penetrate_ratio` DEF and `magic_resist_penetrate_ratio` RES (cap `max_cnt`). LOR-Y (elite): cap 12 and
//     "技能期间远程攻击不再降低攻击力" — while any skill runs the ranged 80 % scale is dropped.
//   T2 毋畏遗忘: damage dealt to an enemy → Fever +`cnt`; operators inside her range get ASPD +`attack_speed`.
//   S1 新月的苏醒: 8 arts notes, `atk_scale`…`atk_scale_8` decaying; 2 charges, auto-released once at full charges.
//   S2 满月的舞会: 钢琴 (initial) / 风琴 timbre — piano ATK +`attack@atk` and a piercing physical note, organ ASPD
//     +`attack@attack_speed` and an arts note; during Fever the current timbre hits twice.
//   S3 残月的余响: 25 s expanded range; every attack plays 2 physical notes at `attack@atk_scale` tracking the
//     highest-RES enemy and 2 arts notes tracking the highest-DEF enemy; during Fever Ave Mujica members do not
//     retreat on a lethal hit and 退场 when Fever ends.
//
// Every number comes from a blackboard. Constants that exist nowhere in data are marked [ASSUMED] below.

import { COLS, ROWS } from '../../constants.js';
import { sortEnemyTargets } from '../../targeting.js';
import { num, talentBb, onHitBy } from './tier1.js';

// ---- constants absent from the official tables ------------------------------------------------------------------
const FEVER_MAX = 100;   // [ASSUMED] Fever is a collab meter; the client publishes no threshold — every 100 points
const FEVER_TIME = 10;   // [ASSUMED] Fever duration (s)
const NOTE_IDLE = 1;     // [ASSUMED] notes decay one per second without an attack (talent bb `delay` = 1 s)
const PIERCE_TILES = 3;  // [ASSUMED] how many tiles past its target a piano note pierces (talent text: 穿过敌人)

const op = (u) => !!u && u.kind === 'op' && u.alive && u.deployed;
const foe = (u) => !!u && u.side === 'enemy' && u.alive && !u.hidden;
const foeAlive = (u) => !!u && u.side === 'enemy' && u.alive;
const feverOf = (battle, u) => !!u && battle.time < (u.mem.oblvnsFeverUntil ?? 0);
// data/custom-operators.json: 丰川祥子 is the only catalog member with `teamId: 'mujica'` (checked charId here).
const mujica = (u) => !!u && (u.def?.charId === 'char_4182_oblvns' || u.def?.raw?.teamId === 'mujica');

export default function oblvns(bb, chess, def) {
  const sid = def?.skill?.id ?? chess?.skill?.skillId ?? null;
  const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const notesMax = Math.max(1, num(t0.max_cnt, 10));
  const defPen = num(t0.def_penetrate_ratio, 0.03);
  const resPen = num(t0.magic_resist_penetrate_ratio, 0.02);
  const feverCnt = num(t1.cnt, 3);
  const auraAspd = num(t1.attack_speed, 12);
  const auraOn = num(t1.enable, 1) > 0;
  const modOn = !!(chess?.module && chess.module.active);   // LOR-Y: the in-skill ranged-scale override
  const baseScale = num(def?.traitBb?.atk_scale, 0.8);
  const grid = def?.skill?.rangeGrid ?? null;

  // Targets the notes may pick: the enemies in her range plus the ones she blocks (they are always selectable).
  const targets = (battle, unit) => {
    const list = battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true });
    for (const b of battle.blockedTargets(unit, unit.profile)) if (!list.includes(b)) list.push(b);
    return sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
  };

  // A piano note pierces its target: the enemies further along the flight line take the same physical damage.
  const pierce = (battle, unit, target, amount) => {
    if (!(amount > 0)) return;
    const [dr, dc] = unit.fwd || [0, 1];
    const tr = Math.round(target.y), tc = Math.round(target.x);
    for (let k = 1; k <= PIERCE_TILES; k++) {
      const r = tr + dr * k, c = tc + dc * k;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      for (const e of battle.enemiesInKeys([r * COLS + c], unit, { canHitFly: true })) {
        if (e !== target) battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill', 'note'] });
      }
    }
  };

  const skills = {
    // 新月的苏醒: one cast = 8 decaying arts notes. Charges (2) come from the def; the official "充能至最大层数时
    // 自动释放一次" is driven below (a cast as soon as both charges are held).
    skchr_oblvns_1: {
      kind: 'instant', charges: Math.max(1, def?.skill?.maxCharges ?? 2), trigger: 'NEVER',
      onStart({ battle, unit }) {
        const scales = [];
        for (let i = 1; i <= 8; i++) scales.push(num(bb[i === 1 ? 'atk_scale' : `atk_scale_${i}`], 0));
        const list = targets(battle, unit);
        if (!list.length) return;
        const atk = unit.s.atk;
        for (let i = 0; i < scales.length; i++) {
          const alive = list.filter(foe);
          if (!alive.length) break;
          // "每个音符追踪敌人": each note homes the next target of the standard order (cycling when there are fewer)
          const target = alive[i % alive.length];
          battle.dealDamage(unit, target, { amount: atk * scales[i], type: 'arts', isSkill: true, tags: ['skill', 'note'] });
        }
      },
    },
    // 满月的舞会: no mid-battle UI, so the timbre alternates per cast [ASSUMED]. Each cast replaces a persistent
    // buff (piano ATK / organ ASPD); the note's damage type and the pierce are applied by the hit hook below.
    skchr_oblvns_2: {
      kind: 'instant',
      onStart({ battle, unit }) {
        unit.mem.oblvnsS2 = true;
        const next = (unit.mem.oblvnsMode ?? 'piano') === 'piano' ? 'organ' : 'piano';  // 钢琴 is the initial timbre
        unit.mem.oblvnsMode = next;
        battle.addBuff(unit, { key: 'oblvns:mode', refresh: 'replace', source: unit, visible: true,
          mods: next === 'piano' ? { atkPct: num(bb['attack@atk'], 0.75) } : { aspd: num(bb['attack@attack_speed'], 110) } });
        battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: next });
      },
    },
    // 残月的余响: expanded range; every attack adds 2 physical notes (highest RES) + 2 arts notes (highest DEF).
    skchr_oblvns_3: {
      kind: 'duration',
      targeting: grid ? { rangeGrid: grid } : undefined,
      onAttack({ battle, unit }) {
        const list = targets(battle, unit);
        if (!list.length) return;
        const amount = unit.s.atk * num(bb['attack@atk_scale'], 1.8);
        const byRes = list.filter(foe).slice().sort((a, b) => (b.s.res || 0) - (a.s.res || 0))[0];  // 法术抗性最高
        const byDef = list.filter(foe).slice().sort((a, b) => (b.s.def || 0) - (a.s.def || 0))[0];  // 防御力最高
        for (let i = 0; i < 2; i++) if (byRes && byRes.alive) battle.dealDamage(unit, byRes, { amount, type: 'phys', isSkill: true, tags: ['skill', 'note'] });
        for (let i = 0; i < 2; i++) if (byDef && byDef.alive) battle.dealDamage(unit, byDef, { amount, type: 'arts', isSkill: true, tags: ['skill', 'note'] });
      },
      // "Fever期间Ave Mujica成员受到致命伤害时不撤退": prevent the lethal while Fever runs; the Fever watcher (T2)
      // retires whoever was saved once Fever ends (battle.retreat — the engine's 退场, down + redeploy).
      onStart({ battle, unit }) {
        unit.mem.oblvnsFatal = battle.on('fatal', (c) => {
          if (!c.unit || c.unit.kind !== 'op' || !mujica(c.unit) || !feverOf(battle, unit)) return;
          if (unit.skill?.id !== 'skchr_oblvns_3' || !unit.skill.active) return;
          c.prevented = true;
          c.unit.mem.oblvnsSaved = true;
        }, { owner: unit });
      },
      onEnd({ battle, unit }) {
        if (unit.mem.oblvnsFatal) { battle.off(unit.mem.oblvnsFatal); unit.mem.oblvnsFatal = null; }
      },
    },
  };

  return {
    skills, skill: skills[sid],

    talents: [
      { install(battle, unit) { // 颂乐音符 — notes played by her attacks, decaying while she idles
        const m = unit.mem;
        m.oblvnsNotes = 0;
        onHitBy(battle, unit, ({ dmg }) => {
          if (!dmg.isAttack) return;
          m.oblvnsNotes = Math.min(notesMax, (m.oblvnsNotes ?? 0) + 1);
          m.oblvnsNoteAt = battle.time;
        });
        battle.every(NOTE_IDLE, () => {
          if (!op(unit)) return;
          if (battle.time - (m.oblvnsNoteAt ?? -Infinity) >= NOTE_IDLE) m.oblvnsNotes = Math.max(0, (m.oblvnsNotes ?? 0) - 1);
        }, { owner: unit });
        battle.every(0.25, () => {
          const n = Math.min(notesMax, m.oblvnsNotes ?? 0);
          if (!op(unit) || n <= 0) return;
          for (const a of battle.allies(unit.ownerId)) {
            if (!op(a) || !mujica(a)) continue;
            battle.addBuff(a, { key: 'oblvns:notes', duration: 0.5, refresh: 'replace', source: unit, visible: true,
              mods: { defIgnorePct: defPen * n, resIgnorePct: resPen * n } });
          }
        }, { owner: unit, immediate: true });
      } },
      { install(battle, unit) { // 毋畏遗忘 — Fever meter + the in-range ASPD aura
        const m = unit.mem;
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!foeAlive(target) || !(dmg.amount > 0) || feverOf(battle, unit)) return;
          m.oblvnsFever = (m.oblvnsFever ?? 0) + feverCnt;
        });
        // Fever state machine: enters at FEVER_MAX, runs FEVER_TIME, drains to 0 and retires the S3-saved members.
        battle.every(0.25, () => {
          const now = battle.time;
          const active = now < (m.oblvnsFeverUntil ?? 0);
          if (!active && (m.oblvnsFever ?? 0) >= FEVER_MAX) {
            m.oblvnsFever = 0;
            m.oblvnsFeverUntil = now + FEVER_TIME;
            m.oblvnsFeverOn = true;
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'fever' });
            return;
          }
          if (m.oblvnsFeverOn && !active) {
            m.oblvnsFeverOn = false;
            for (const a of battle.allies(unit.ownerId)) {
              if (!op(a) || !a.mem.oblvnsSaved) continue;
              a.mem.oblvnsSaved = false;
              battle.retreat(a, { reason: 'retreat' });  // [ASSUMED] the official 退场 once Fever is over
            }
          } else m.oblvnsFeverOn = active;
        }, { owner: unit, immediate: true });
        if (!auraOn || !auraAspd) return;
        battle.every(0.25, () => { // "攻击范围内干员攻击速度+12" (her own tile is part of the range grid)
          if (!op(unit)) return;
          const keys = unit.rangeKeySet;
          if (!keys) return;
          for (const a of battle.allies(unit.ownerId)) {
            if (!op(a) || !keys.has(a.tileR * COLS + a.tileC)) continue;
            battle.addBuff(a, { key: 'oblvns:aura', duration: 0.5, refresh: 'replace', source: unit, visible: true, mods: { aspd: auraAspd } });
          }
        }, { owner: unit, immediate: true });
      } },
    ],

    install(battle, unit) {
      // LOR-Y: while a skill runs, ranged attacks keep the full ATK (the lord profile scales them by 0.8 otherwise).
      if (modOn) {
        battle.every(0.2, () => {
          if (!op(unit)) return;
          unit.profile.rangedScale = unit.skill && unit.skill.active ? 1 : baseScale;
        }, { owner: unit, immediate: true });
      }
      // LOR-Y trait module "攻击范围内存在2名及以上敌人时攻击速度+12" (trait.bb.attack_speed; 0 without the module).
      const modAspd = num(def?.traitBb?.attack_speed, 0);
      if (modOn && modAspd > 0) {
        battle.every(0.25, () => {
          if (!op(unit)) return;
          if (battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true }).length < 2) return;
          battle.addBuff(unit, { key: 'oblvns:module', duration: 0.5, refresh: 'replace', source: unit, visible: true, mods: { aspd: modAspd } });
        }, { owner: unit, immediate: true });
      }
      // S2 timbre: the note's damage type follows the mode (piano phys / organ arts) and a piano note pierces.
      battle.on('beforeAttack', (c) => { if (c.attacker === unit) unit.mem.oblvnsPierceDone = false; }, { owner: unit });
      onHitBy(battle, unit, ({ target, dmg }) => {
        if (!dmg.isAttack || !unit.mem.oblvnsS2) return;
        const mode = unit.mem.oblvnsMode;
        if (mode === 'organ') dmg.type = 'arts';
        else if (mode === 'piano') {
          dmg.type = 'phys';
          if (!unit.mem.oblvnsPierceDone) { unit.mem.oblvnsPierceDone = true; pierce(battle, unit, target, dmg.amount); }
        }
      });
      // Fever: during it the S2 timbre becomes a二连击 (one extra attack per attack, no ammo cost).
      battle.on('attack', (c) => {
        if (c.attacker !== unit || unit.mem.oblvnsExtra || !unit.mem.oblvnsS2 || !feverOf(battle, unit)) return;
        const dep = unit.deploySeq;
        battle.after(0, () => {
          if (!op(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm || !feverOf(battle, unit)) return;
          unit.mem.oblvnsExtra = true;
          try { battle.forceAttack(unit, null, { noAmmo: true }); } finally { unit.mem.oblvnsExtra = false; }
        }, { owner: unit });
      }, { owner: unit });
      // S1 "可充能2次，充能至最大层数时自动释放一次": cast as soon as both charges are held (no attack needed).
      battle.every(0.25, () => {
        const sk = unit.skill;
        if (!sk || sk.id !== 'skchr_oblvns_1' || sid !== 'skchr_oblvns_1') return;
        if (!op(unit) || !unit.canAct || unit.s.flags.silence) return;
        if (sk.charges < sk.maxCharges || sk.active || sk.opCooling) return;
        sk.activate('charged');
      }, { owner: unit });
    },
  };
}
