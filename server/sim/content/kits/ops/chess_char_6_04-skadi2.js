// server/sim/content/kits/ops/chess_char_6_04-skadi2.js — 浊心斯卡蒂 (char_1012_skadi2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { aggregateMods } from '../../../buffs.js';
import { COLS } from '../../../constants.js';
import { bardRegen } from '../../../professions.js';
import { startCountdown } from '../../tokens.js';
import {
  num, bv, tbb, tdesc, moduleBb, parseN, live, enemiesIn, isTok, onDefaultSkill, selectedSkill, aura,
} from '../shared/tier6.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 深海猎人 (character_table groupId "abyssal" — checked against the official table; data/chess.json has no group id). */
const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);

/**
 * 鼓舞 (ba.inspire "获得额外附加的基础属性加成（同类属性取最高）"): +`val` ATK after the target's own multipliers (flat
 * compensated), strongest source wins. Units flagged `mem.noInspire` (浊心斯卡蒂 "自身不受鼓舞影响") never receive it.
 */
function inspire(battle, target, val, src, stat = 'atk') {
  if (!(val > 0) || !live(target) || target.mem.noInspire) return;
  const key = stat === 'def' ? 'inspire:def' : 'inspire';
  const cur = target.findBuff(key);
  if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 0.1) return;
  const { add, mul } = aggregateMods(target.buffs.filter((b) => b.key !== key));
  const f = stat === 'def'
    ? Math.max(0, 1 + (add.defPct ?? 0)) * (mul.defMul ?? 1)
    : Math.max(0, 1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
  const flat = f > 1e-6 ? val / f : val;
  battle.addBuff(target, { key, mods: stat === 'def' ? { defFlat: flat } : { atkFlat: flat }, duration: 0.75, refresh: 'replace', source: src, visible: true, data: { src: src.id, val } });
}

// ------------------------------------------------------------------------------------------------------------------
// 浊心斯卡蒂 chess_char_6_04 (吟游者) — S3 "潮涌，潮枯"; 远古血亲 (海嗣); 捕食习性; module 蜕化的残迹

function skadi2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess), tb = def?.traitBb || {};
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const tokId = def?.talents?.[0]?.tokenKey || (chess?.tokens || [])[0] || 'token_10017_skadi2_dedant';
  const auraRatio = num(tb['attack@atk_to_hp_recovery_ratio'], 0.1);
  // S1 / S2 raise the trait ("特性效果提高至N%") while they run; S3 (default) turns it into the tide. The trait is a
  // 生命回复速度 buff on the allies, not a heal (PRTS 分支特性信息 吟游者; professions.js bardRegen)
  const skillRatio = num(bb['attack@atk_to_hp_recovery_ratio'], auraRatio);
  const seaborns = (battle, unit) => battle.allyUnits.filter((t) => isTok(t, tokId, unit) && live(t));
  const covered = (battle, unit, toks) => { // allies inside her range ∪ the seaborns' ranges
    const set = new Set(battle.alliesInGrid(unit));
    for (const t of toks) for (const a of battle.alliesInGrid(t)) set.add(a);
    for (const t of toks) set.delete(t);
    return [...set];
  };
  const inCover = (battle, unit, a) => {
    const k = a.tileR * COLS + a.tileC;
    if (unit.rangeKeySet?.has(k)) return true;
    return seaborns(battle, unit).some((t) => t.rangeKeySet?.has(k));
  };
  const skills = {
    // S1 同归殊途之吟 (SP_FULL): full self heal, max HP +max_hp, trait attack@atk_to_hp_recovery_ratio, and
    // damage_resistance of the damage taken by every ally of her (+ 海嗣) range is transferred to her (install)
    skchr_skadi2_1: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp) },
      onStart({ battle, unit }) { unit.hp = unit.s.maxHp; battle.fx('heal', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    // S2 同葬无光之愿 (toggle): 鼓舞 ATK / DEF = atk / def × her ATK / DEF on every other ally of her (+ 海嗣) range,
    // trait attack@atk_to_hp_recovery_ratio (trait pulse). 自动触发 with effects on her allies only (nothing to target):
    // on as soon as it is ready (SP_FULL, like 魔王 S1 往昔萦绕身旁); until 0.2.0 the data's DEFAULT left it off until an
    // enemy came into her (or a 海嗣's) range.
    skchr_skadi2_2: { kind: 'toggle', trigger: 'SP_FULL' },
  };
  return {
    skills,
    skill: {
      kind: 'duration', // effects run in the trait pulse below ("特性变为…")
      onStart({ battle, unit }) { battle.fx('tide', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    trait: {
      install(battle, unit) { // replaces the bard aura: 生命回复速度 normally, tide (true damage + 鼓舞 + self drain) during S3
        unit.mem.noInspire = true; // 自身不受鼓舞影响
        const isInspire = (b) => b.key === 'inspire' || b.status === 'inspire' || b.key.startsWith('inspire:') || b.key.endsWith(':inspire');
        // "海嗣的攻击范围视为自身攻击范围的延伸": an enemy in a 海嗣's range also satisfies her DEFAULT trigger
        if (unit.skill) unit.skill.addTriggerRange(() => seaborns(battle, unit));
        let n = 0;
        battle.every(0.5, () => {
          if (!live(unit)) return; // the continuous trait (including its skill conversion) survives stun
          for (let i = unit.buffs.length - 1; i >= 0; i--) if (isInspire(unit.buffs[i])) battle.removeBuff(unit, unit.buffs[i]);
          n++;
          const toks = seaborns(battle, unit);
          const allies = covered(battle, unit, toks);
          const sk = unit.skill;
          const on = !!(sk && sk.active);
          if (on && isDef) {
            const val = unit.s.atk * num(bb.atk);
            for (const a of allies) if (a !== unit) inspire(battle, a, val, unit);
            if (n % 2 === 0) {
              const dmg = unit.s.atk * num(bb.atk_scale);
              if (dmg > 0) for (const src of [unit, ...toks]) for (const e of enemiesIn(battle, src)) {
                battle.dealDamage(unit, e, { amount: dmg, type: 'true', isSkill: true, tags: ['skill', 'tide'] });
              }
              const loss = unit.s.maxHp * num(bb.hp_ratio);
              if (loss > 0) { if (unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit, silent: true }); else unit.hp = Math.min(unit.hp, 1); }
            }
            return;
          }
          if (on && sid === 'skchr_skadi2_2') {
            const va = unit.s.atk * num(bb.atk), vd = unit.s.def * num(bb.def);
            for (const a of allies) if (a !== unit) { inspire(battle, a, va, unit); inspire(battle, a, vd, unit, 'def'); }
          }
          // the trait over her range ∪ the 海嗣' ranges, refreshed every pulse (it lapses 0.75 s after the last one)
          const v = unit.s.atk * (on ? skillRatio : num(unit.profile?.auraRatio, auraRatio));
          for (const a of allies) bardRegen(battle, unit, a, v, 0.75);
        }, { owner: unit });
      },
    },
    install(battle, unit) {
      // S1: "攻击范围内我方所有单位受到伤害的50%直接转移给浊心斯卡蒂承担（同类效果取最高）" — the ally takes (1 − share),
      // she takes the transferred part as true damage from the same attacker
      if (sid === 'skchr_skadi2_1') {
        const share = clamp(num(bb.damage_resistance), 0, 1);
        const TAG = `skadi2:transfer:${unit.id}`;
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (!(share > 0) || !t || t === unit || t.side !== 'ally' || t.kind === 'device' || !live(unit) || !unit.skill?.active) return;
          if (d.type === 'element' || d.type === 'elemental' || d.skadiShare || d.tags?.includes('transfer') || !inCover(battle, unit, t)) return;
          d.skadiShare = { share, tag: TAG }; // 同类效果取最高: one transfer per damage instance
          d.mul *= 1 - share;
        }, { owner: unit, priority: -20 });
        battle.on('damaged', (ctx) => {
          const x = ctx.dmg?.skadiShare;
          if (!x || x.tag !== TAG || !(ctx.amount > 0) || !live(unit)) return;
          battle.dealDamage(ctx.source, unit, { amount: ctx.amount * x.share / Math.max(1e-6, 1 - x.share), type: 'true', canDodge: false, tags: ['transfer'] });
        }, { owner: unit });
      }
      // module 新生代: "自身技能期间，攻击范围内的友军获得30点物理与法术伤害减免" (flat reduction per hit)
      const flat = -num(mod.damage_resistance);
      if (flat > 0) {
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (!t || t.side !== 'ally' || t.kind === 'device' || !live(unit) || !unit.skill?.active || !inCover(battle, unit, t)) return;
          if (d.type === 'phys') d.defIgnoreFlat -= flat; // +flat effective DEF ⇒ −flat damage (above the 5 % floor)
          else if (d.type === 'arts') d.amount = Math.max(0, d.amount - flat / Math.max(0.05, 1 - (t.s.res ?? 0) / 100));
        }, { owner: unit, priority: -10 });
      }
    },
    talents: [
      { install(battle, unit) { // 远古血亲: the seaborn is an inert range extension with a limited life
        battle.on('deploy', ({ unit: t }) => {
          if (!isTok(t, tokId, unit)) return;
          if (t.profile) t.profile.noAttack = true;
          const dur = num(t.def?.talents?.[0]?.bb?.duration, parseN(tdesc(def, 0), /持续(\d+(?:\.\d+)?)秒/, 25));
          const seq = t.deploySeq, r = t.tileR, c = t.tileC;
          startCountdown(battle, t, dur); // a countdown summon: 无敌, 禁疗, its bar = the life left (content/tokens.js)
          battle.after(dur, () => {
            if (!t.alive || t.deploySeq !== seq) return;
            battle.retreat(t, { reason: 'expired', permanent: true });
            const wait = num(t.base.respawnTime, 30), cost = num(t.base.cost, 0);
            let tries = 0;
            const again = () => {
              if (battle.finished || tries++ > 300) return;
              const ps = battle.getPlayer(unit.ownerId);
              if (!live(unit) || !ps || ps.dp + 1e-9 < cost || battle.unitAt(r, c)) { battle.after(1, again, { owner: unit }); return; }
              battle.addDp(unit.ownerId, -cost);
              if (!battle.spawnToken(unit, tokId, r, c)) { battle.addDp(unit.ownerId, cost); battle.after(1, again, { owner: unit }); }
            };
            battle.after(wait, again, { owner: unit });
          }, { owner: t });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 捕食习性 (module 新生代: ATK 9 / 20 %, DEF +8 %, +3 SP per op deployed in range) + module (≥2 other ops in range: ATK +8 %)
        const a1 = num(t1['skadi2_e_003_t_2[atk][1].atk'], bv(t1, 'skadi2_t_2[atk][1].atk', 0));
        const a2 = num(t1['skadi2_e_003_t_2[atk][2].atk'], bv(t1, 'skadi2_t_2[atk][2].atk', a1));
        const d1 = num(t1['skadi2_e_003_t_2[def].def']), sp = num(t1.sp);
        const mCnt = num(mod.cnt, Infinity), mAtk = num(mod.atk);
        aura(battle, unit, 0.5, () => {
          const toks = seaborns(battle, unit);
          const ops = covered(battle, unit, toks).filter((a) => a !== unit && a.kind === 'op');
          const val = ops.some((a) => ABYSSAL.has(a.def?.charId)) ? a2 : ops.length ? a1 : 0;
          const own = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op').length;
          const total = val + (own >= mCnt ? mAtk : 0);
          const dPct = ops.length ? d1 : 0;
          if (total > 0 || dPct > 0) battle.addBuff(unit, { key: 'skadi2:predator', mods: { atkPct: total, defPct: dPct }, duration: 0.75, refresh: 'replace' });
        });
        // "我方干员部署于自身或海嗣范围内后，自身立刻获得3点技力"
        if (sp > 0) battle.on('deploy', ({ unit: u }) => {
          if (!u || u === unit || u.kind !== 'op' || u.side !== 'ally' || !live(unit) || !unit.skill) return;
          if (inCover(battle, unit, u)) unit.skill.gainSp(sp, 'talent');
        }, { owner: unit });
      } },
    ],
  };
}

export default {
  chess_char_6_04_a: skadi2,
};
