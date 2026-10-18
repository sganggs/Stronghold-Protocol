// server/sim/content/kits/ops/op-poca.js — 早露 (char_197_poca) 自选 operator kit: 6★ 攻城手 (狙击), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_197_poca, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 早露 (备注 of
// 深入骨髓, 学生楷模 and 雪崩击); PRTS 分支特性信息 攻城手 ("可对空。攻击范围不包含自身所在地块").
// - Trait (攻城手) "优先攻击重量最重的敌人": target priority 'heaviest' (targeting.js: the highest current 重量等级 first, then
//   the usual order); ranged physical arrows that hit air units (data canHitFly, PRTS "可对空"), range 4-3.
// - Module SIE-X 攻城器械训练装置: trait "攻击重量较重（重量等级大于等于3）的敌人时，攻击力提升至115%" — the hidden module talent
//   (atk_scale / value, merged into 深入骨髓's blackboard): ×atk_scale on her attacks (normal attacks and the S3 strikes, the
//   profile dmgMul — the kits' "攻击…时攻击力提升至X%" convention, 斯卡蒂 DRE-X) on an enemy of 重量等级 ≥ value. Stage 2+ 深入骨髓
//   "…并额外造成60%攻击力的物理伤害" (extra_atk_scale): every attack hit that lands on such an enemy is followed by a physical hit
//   of extra_atk_scale × ATK (which 深入骨髓's 物理穿透 also gets).
// - Module SIE-Y “心”: trait "攻击越远的敌人造成的伤害越高（最高提升12%）" (trait bb min_dist / max_dist / damage_scale): her attack
//   damage × (1 + damage_scale × clamp((d − min_dist) / (max_dist − min_dist), 0, 1)), d = her distance to the target in tiles —
//   the kits' reading of these keys (远牙, 协律, 芳汀 modules) [ASSUMED linear: PRTS states no formula]. Stage 2+: 学生楷模 below.
// - T1 深入骨髓 "攻击重量较重（重量等级大于等于3）的敌人时，无视其防御力的60%": every damage she deals to an enemy of 重量等级 ≥ value
//   ignores def_penetrate of its DEF (DamageInfo defIgnorePct, added — PRTS 备注 "临时获取永久的物理穿透（百分比）Buff（不可叠加，
//   直接加算）").
// - T2 学生楷模 "编入队伍时，所有【乌萨斯学生自治团】干员攻击力+8%" (full potential: +10 %): every 【乌萨斯学生自治团】 operator of
//   her player's team ATK +atk for the whole battle, deployed or not (the kits' 编入队伍时 convention, 斯卡蒂 深海掠食者). SIE-Y
//   stage 3: +14 % and "每有一名【乌萨斯学生自治团】干员处于技能期间时，【乌萨斯学生自治团】干员的攻击力额外+15%（最多+45%）"
//   (hidden init_atk / max_atk): the number of those operators on the field whose skill runs, re-read every STUDENT_TICK s
//   and at every skill start (PRTS 备注 "每0.3秒及每次开启技能时更新一次自身的额外加成") [ASSUMED: her team's operators only,
//   as the base talent].
// - S1 攻击力强化·γ型 (30 s): ATK +atk. S2 分裂射击 (60 s): ATK +atk, attack@max_target targets.
// - S3 雪崩击 (6 / 7 s): ATK +atk; at the cast, harpoons link the max_target heaviest enemies of her range (her own target
//   order); each linked enemy is 束缚 (bind) while linked and takes one attack every hit_interval s, hit_duration /
//   hit_interval attacks in all, the first as the harpoons land (the tick after the cast) [ASSUMED] — her own attacks (Battle.forceAttack:
//   every attack rider of hers applies), instant along the links; she makes no other attack meanwhile [ASSUMED: the
//   strikes are what "每秒受到一次攻击" names]. PRTS 备注: a link breaks when its enemy is knocked out, 离地 (OUT_OF_GROUND —
//   no enemy of the mode holds it) or 消失 (hidden), every link at once when she is stunned / frozen / silenced, and the
//   skill ends as soon as no link is left. The binds end with their links.

import { num, talentBb, moduleBb, moduleOn, traitBb, skillRec, statBuff, onHitBy, enemiesInGrid, up } from '../shared/tier1.js';
import { hasHp } from '../../../attack.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skcom_atk_up[3]';
const S2 = 'skchr_poca_2';
const S3 = 'skchr_poca_3';
/** 【乌萨斯学生自治团】: character_table teamId `student` (古米, 凛冬, 烈夏, 苦艾, 真理, 早露, 怒潮凛冬); data/chess.json has no team id. */
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
/** PRTS 学生楷模 备注: the SIE-Y extra is re-read every 0.3 s (and at every skill start). */
const STUDENT_TICK = 0.3;
const STUDENT_KEY = 'talent:poca:students';
const DRIVE_KEY = 'talent:poca:studentSkills';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));
const isStudent = (a) => !!a && a.kind === 'op' && STUDENTS.has(a.def?.charId);
/** A running skill of `a` (a passive is no 技能期间). */
const inSkill = (a) => !!(a.skill && a.skill.active && a.skill.kind !== 'passive');

export default {
  char_197_poca: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const heavyAt = num(t0.value, 3);
    const heavy = (e) => !!e && e.side === 'enemy' && e.weight >= heavyAt;
    // SIE-X (hidden part on 深入骨髓's index: atk_scale / value; stage 2+ extra_atk_scale), SIE-Y (trait bb; hidden
    // init_atk / max_atk at stage 3) — chess is the loadout-resolved record, so no module ⇒ none of these keys
    const xScale = moduleOn(chess) ? num(t0.atk_scale, 1) : 1;
    const extra = num(t0.extra_atk_scale);
    const tb = traitBb(chess);
    const hidden = moduleBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);

    /** S3: the links of the running cast (unit.mem.pocaS3 = { links: Set, left, timer }). */
    const unbind = (battle, unit, e) => {
      const b = e.findBuff('bind');
      if (b && b.source === unit) battle.removeBuff(e, b);
    };
    const linkBroken = (e) => !e.alive || !e.deployed || e.hidden || !!e.s.flags.outOfGround;
    const strike = (battle, unit, st) => {
      const targets = [...st.links].filter((e) => !linkBroken(e));
      if (!targets.length || !unit.canAct || st.left <= 0) return;
      st.left--;
      battle.forceAttack(unit, targets);
    };

    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) } },
        [S2]: { kind: 'duration', mods: { atkPct: num(b2.atk) }, targeting: { maxTargets: count(b2['attack@max_target'], 2) } },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          // no attack of her own while the links hold; the strikes are instant along them ('beam')
          attack: { noAttack: true, projectile: 'beam' },
          onStart({ battle, unit, skill }) {
            const links = enemiesInGrid(battle, unit, null, { n: count(b3.max_target, 3), priority: 'heaviest', canHitFly: true });
            const st = { links: new Set(links), left: count(num(b3.hit_duration, skill.duration) / Math.max(0.1, num(b3.hit_interval, 1)), 6), timer: null };
            unit.mem.pocaS3 = st;
            for (const e of links) {
              battle.applyStatus(e, 'bind', { duration: skill.timeLeft, source: unit });
              battle.fx('harpoon', { x: e.x, y: e.y, id: unit.id, target: e.id });
            }
            // the harpoons land on the next tick (after the cast's skillStart handlers — 学生楷模's re-read), then every
            // hit_interval s
            st.timer = battle.after(0, () => {
              if (unit.mem.pocaS3 !== st) return;
              strike(battle, unit, st);
              st.timer = battle.every(Math.max(0.1, num(b3.hit_interval, 1)), (b, sc) => {
                if (unit.mem.pocaS3 !== st || st.left <= 0) { sc.cancel(); return; }
                strike(battle, unit, st);
              }, { owner: unit });
            }, { owner: unit });
          },
          onTick({ battle, unit, skill }) {
            const st = unit.mem.pocaS3;
            if (!st) return;
            const f = unit.s.flags;
            if (f.stun || f.freeze || f.silence) { skill.end('interrupted'); return; }
            for (const e of [...st.links]) if (linkBroken(e)) { st.links.delete(e); unbind(battle, unit, e); }
            if (!st.links.size) skill.end('unlinked');
          },
          onEnd({ battle, unit }) {
            const st = unit.mem.pocaS3;
            unit.mem.pocaS3 = null;
            if (!st) return;
            if (st.timer) st.timer.cancel();
            for (const e of st.links) unbind(battle, unit, e);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 深入骨髓: +def_penetrate 物理穿透 on heavy enemies; SIE-X stage 2+: the extra physical hit
          const pen = num(t0.def_penetrate);
          if (pen > 0) onHitBy(battle, unit, ({ target, dmg }) => { if (heavy(target)) dmg.defIgnorePct += pen; });
          if (extra > 0) {
            battle.on('damaged', (c) => {
              if (c.source !== unit || !c.dmg?.isAttack || !heavy(c.target) || !hasHp(c.target)) return;
              battle.dealDamage(unit, c.target, { amount: unit.s.atk * extra, type: 'phys', tags: ['talent', 'poca:extra'] });
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 学生楷模: every student of her team ATK +atk; SIE-Y stage 3: +init_atk per student in skill
          const team = battle.allyUnits.filter((a) => a.ownerId === unit.ownerId && isStudent(a));
          for (const a of team) statBuff(battle, a, STUDENT_KEY, { atkPct: num(t1.atk) });
          const per = num(hidden.init_atk), cap = num(hidden.max_atk, Infinity);
          if (!(per > 0)) return;
          const update = () => {
            const v = Math.min(cap, per * team.filter((a) => up(a) && inSkill(a)).length);
            for (const a of team) {
              const cur = a.findBuff(DRIVE_KEY);
              if (!(v > 0)) { if (cur) battle.removeBuff(a, cur); continue; }
              if (!cur || cur.mods?.atkPct !== v) battle.addBuff(a, { key: DRIVE_KEY, mods: { atkPct: v }, persist: true, allowDead: true, tags: ['talent'], source: unit });
            }
          };
          battle.every(STUDENT_TICK, update, { owner: unit, immediate: true });
          battle.on('skillStart', (c) => { if (team.includes(c.unit)) update(); }, { owner: unit });
        } },
      ],
      // 攻城手: heaviest first; SIE-X ×atk_scale on her attacks against heavy enemies
      trait: { priority: 'heaviest', ...(xScale !== 1 ? { dmgMul: (b, u, target) => (heavy(target) ? xScale : 1) } : null) },
      install(battle, unit) {
        // SIE-Y: the farther the target, the more damage (attacks only)
        const ds = num(tb.damage_scale), lo = num(tb.min_dist, 1), hi = num(tb.max_dist, 4.5);
        if (ds > 0) {
          onHitBy(battle, unit, ({ target, dmg }) => {
            if (!dmg.isAttack) return;
            const d = hypot(target.x - unit.x, target.y - unit.y);
            dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo)));
          });
        }
      },
    };
  },
};
