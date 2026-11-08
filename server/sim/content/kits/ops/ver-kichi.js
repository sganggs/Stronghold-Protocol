// server/sim/content/kits/ops/ver-kichi.js — 吉星 (char_4203_kichi), 规程·序列Ⅰ.
// The reaperrange front-line scale stays the profession and still multiplies her attacks.

import { batMod, num, talentBb } from '../shared/tier1.js';
import { descOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_kichi_1';
const S2 = 'skchr_kichi_2';

function kichi(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
      onStart({ battle, unit }) {
        unit.mem.kichiS1 = 0;
        battle.removeBuff(unit, 'kichi:s1atk');
      },
      // 「每次攻击后」: one stack per attack, not per enemy. The attack that just fired does not carry it yet when the
      // hit is resolved in that same call; a projectile still in the air is calculated when it lands.
      onAttack({ battle, unit }) {
        const cap = Math.max(1, Math.floor(num(sbb.max_stack_cnt, 1)));
        const n = Math.min(cap, (unit.mem.kichiS1 || 0) + 1);
        unit.mem.kichiS1 = n;
        battle.addBuff(unit, { key: 'kichi:s1atk', mods: { atkPct: num(sbb.atk) * n }, refresh: 'replace', tags: ['skill'] });
      },
      onEnd({ battle, unit }) {
        unit.mem.kichiS1 = 0;
        battle.removeBuff(unit, 'kichi:s1atk');
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
      // [ASSUMED] one effect per attack, the text order 停顿 → 束缚 → 晕眩, on every enemy that attack hit, then advance.
      onStart({ unit }) { unit.mem.kichiCycle = 0; },
      onAttack({ battle, unit, targets }) {
        const order = [
          ['sluggish', num(sbb['attack@sluggish'])],
          ['bind', num(sbb['attack@unmoveable'])],
          ['stun', num(sbb['attack@stun'])],
        ];
        const i = unit.mem.kichiCycle || 0;
        unit.mem.kichiCycle = i + 1;
        const [key, dur] = order[i % order.length];
        if (!(dur > 0)) return;
        for (const t of targets || []) {
          if (t?.alive && t.side === 'enemy') battle.applyStatus(t, key, { duration: dur, source: unit });
        }
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      // [ASSUMED] 「一种敌人」 is the enemy def id, for the whole battle (it survives redeploy). She has to be the killer.
      // The bonus is 1 + scale × stacks on every damage type, replaced as a whole so the mul does not compound on itself.
      const scale = num(t0.damage_scale);
      const max = Math.max(0, Math.floor(num(t0.max_stack_cnt)));
      if (!(scale > 0) || !(max > 0)) return;
      const apply = () => {
        const n = unit.mem.kichiSeen?.size ?? 0;
        if (!(n > 0)) return;
        battle.addBuff(unit, {
          key: 'kichi:luck', mods: { dmgDealtMul: 1 + scale * n },
          persist: true, allowDead: true, refresh: 'replace', tags: ['talent'],
        });
      };
      battle.on('deploy', (c) => { if (c.unit === unit) apply(); }, { owner: unit });
      battle.on('kill', (c) => {
        if (c.killer !== unit || !c.victim || c.victim.side !== 'enemy') return;
        const id = c.victim.defId;
        if (!id) return;
        const seen = unit.mem.kichiSeen ?? (unit.mem.kichiSeen = new Set());
        if (seen.has(id) || seen.size >= max) return;
        seen.add(id);
        apply();
      }, { owner: unit });
    },
  };
}

export default { char_4203_kichi: kichi };
