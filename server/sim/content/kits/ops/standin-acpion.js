// server/sim/content/kits/ops/standin-acpion.js — 郁金香 (char_608_acpion) 补位 stand-in kit: 3 瑕光 (S3), 4 焰尾 (S2),
// 5 凛御银灰 / 6 圣聆初雪 / 缪尔赛思 / 耀骑士临光 (S3 + module SOL-X on the elite). Stand-in contract: ../README.md.

import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, up } from '../shared/tier1.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';

const S1 = 'skchr_acpion_1', S2 = 'skchr_acpion_2', S3 = 'skchr_acpion_3';
/**
 * S3 只余芬芳's slashes: her Spine `Skill` clip (char_608_acpion.skel, 1.567 s) carries 8 OnAttack events — one per
 * slash, `times` 8 — at 0.400 s and then every 1/6 s (0.567 … 1.567 s); the `Skill_End` clip adds 0.233 s. The skill
 * holds its effects (below) from the cast to the end of `Skill_End` [ASSUMED: the clips play at 1×, the effects last the
 * two clips].
 */
const SLASH_FIRST = 0.4;
const SLASH_GAP = 1 / 6;
const SLASH_END_CLIP = 0.233;
/** S3's buff while it plays: 无敌, 无法阻挡, no normal attack (the skill clip plays) — stun / freeze refused by a hook. */
const FRAGRANCE_KEY = 'acpion:fragrance';

/** Enemies S3 slashes: every selectable enemy on the x-1 skill range, air units included (PRTS 备注 "※可对空"). */
const SLASH_PROFILE = Object.freeze({ canHitFly: true });

export default {
  // 郁金香 (尖兵, blocks 2) — numbers from data/backups.json (normal E2 Lv1 rank 4, elite E2 Lv60 rank 7; skill_table and
  // PRTS 郁金香(卫戍协议) agree). DP (部署费用) is the player's redeploy currency here (DESIGN §5.5 "DP").
  //   无垠之心: from each deployment until her 2nd skill activation of it, SP recovery +sp_recovery_per_sec (module SOL-X Lv3:
  //      +1/s) — `cnt` 2.
  //   浪潮之心: ATK +atk; each enemy she kills +cost DP.
  //   S1 钻心 (instant): +cost DP, then ATK × atk_scale physical damage to up to max_target enemies of her attack range
  //      (the enemies she blocks included, ground only like her attack) [ASSUMED: at the cast — her S1 clip `Skill_2`
  //      carries no hit event].
  //   S2 迅瞬 (10 s): ASPD +attack_speed, ignores def_penetrate of the target's DEF, and "逐渐获得" trig_cnt × cost DP: one
  //      every `interval` s from the cast (6 × 1.6 s / 7 × 1.4 s, all inside the 10 s) [ASSUMED: none at the cast, and the
  //      DP not yet given is lost if the skill ends early].
  //   S3 只余芬芳 (instant): +cost DP, then `times` slashes on the enemies around her (the x-1 skill range), each ATK ×
  //      atk_scale physical ignoring def_penetrate (50 %) of DEF, timed by her Spine clip (SLASH_*). PRTS 郁金香 (the 集成战略
  //      character char_513_apionr, whose S1 只余芬芳 has the same text, blackboard and x-1 range) 备注: "※可对空" and
  //      "※技能生效期间，持有效果：无敌，无法阻挡，眩晕免疫，冻结免疫" [ASSUMED: the 卫戍 copy skchr_acpion_3 behaves the same].
  //   Module SOL-X (elite, trait override): "阻挡敌人时攻击力和防御力各+8％" — while she blocks (none during S3: 无法阻挡).
  //   Triggers (data, nothing set here): S1 / S2 DEFAULT; S3 SKILL_RANGE on its x-1 (any enemy in it, air units too).
  char_608_acpion: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = traitBb(chess);
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const dp = (battle, unit, n) => {
      if (!(n > 0)) return;
      battle.addDp(unit.ownerId, n, unit);
      battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n });
    };
    const skills = {};
    if (r1) {
      const b1 = r1.bb ?? {};
      skills[S1] = {
        kind: 'instant',
        onStart({ battle, unit }) {
          dp(battle, unit, num(b1.cost));
          const prof = unit.profile;
          const foes = battle.enemiesInKeys(unit.rangeKeys || [], unit, prof);
          for (const e of battle.blockedTargets(unit, prof)) if (!foes.includes(e)) foes.push(e);
          sortEnemyTargets(battle, unit, foes, prof?.priority ?? null);
          const v = foes.slice(0, Math.max(1, Math.floor(num(b1.max_target, 2))));
          if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
          for (const e of v) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b1.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
        },
      };
    }
    if (r2) {
      const b2 = r2.bb ?? {};
      const total = Math.max(0, Math.floor(num(b2.trig_cnt, 0))), iv = Math.max(0.1, num(b2.interval, 1)), per = num(b2.cost, 1);
      skills[S2] = {
        kind: 'duration',
        mods: { aspd: num(b2.attack_speed), defIgnorePct: num(b2.def_penetrate) },
        onStart({ unit }) { unit.mem.acpionDp = { acc: 0, n: 0 }; },
        onTick({ battle, unit, dt }) {
          const m = unit.mem.acpionDp;
          if (!m) return;
          m.acc += dt;
          while (m.acc + 1e-9 >= iv && m.n < total) { m.acc -= iv; m.n++; dp(battle, unit, per); } // loop-cap: interval floored at 0.1 and trig_cnt
        },
        onEnd({ unit }) { unit.mem.acpionDp = null; },
      };
    }
    if (r3) {
      const b3 = r3.bb ?? {};
      // [ASSUMED] DESIGN §32.5: cap before the timer loop and lastAt, so 1e9 does not schedule 1e9 slashes. Official is 8.
      const times = Math.min(bbCap('times'), Math.max(1, Math.floor(num(b3.times, 8)))), scale = num(b3.atk_scale, 1), pen = num(b3.def_penetrate, 0);
      const grid = r3.rangeGrid?.length ? r3.rangeGrid : null;
      const lastAt = SLASH_FIRST + (times - 1) * SLASH_GAP;
      const slash = (battle, unit) => {
        const keys = grid ? absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0) : unit.rangeKeys || [];
        const v = battle.enemiesInKeys(keys, unit, SLASH_PROFILE);
        if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
        for (const e of v) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', defIgnorePct: pen, isSkill: true, tags: ['skill', 'slash'] });
      };
      skills[S3] = {
        kind: 'instant',
        onStart({ battle, unit }) {
          dp(battle, unit, num(b3.cost));
          const seq = unit.deploySeq;
          battle.addBuff(unit, {
            key: FRAGRANCE_KEY, duration: lastAt + SLASH_END_CLIP,
            flags: { invulnerable: true, noBlock: true, disarm: true }, visible: true, source: unit, tags: ['skill'],
          });
          battle.releaseBlocked(unit);
          for (let i = 0; i < times; i++) {
            battle.after(SLASH_FIRST + i * SLASH_GAP, () => {
              if (up(unit) && unit.deploySeq === seq) slash(battle, unit);
            }, { owner: unit });
          }
        },
      };
    }
    return {
      skills,
      talents: [
        { install(battle, unit) { // 无垠之心
          const per = num(t0.sp_recovery_per_sec), cnt = Math.max(1, Math.floor(num(t0.cnt, 2)));
          if (!(per > 0)) return;
          battle.on('deploy', ({ unit: u }) => {
            if (u !== unit) return;
            unit.mem.acpionCasts = 0;
            battle.addBuff(unit, { key: 'acpion:boundless', mods: { spRecoveryFlat: per }, tags: ['talent'] });
          }, { owner: unit });
          battle.on('skillStart', ({ unit: u }) => {
            if (u !== unit) return;
            unit.mem.acpionCasts = (unit.mem.acpionCasts ?? 0) + 1;
            if (unit.mem.acpionCasts >= cnt) battle.removeBuff(unit, 'acpion:boundless');
          }, { owner: unit });
        } },
        { install(battle, unit) { // 浪潮之心
          statBuff(battle, unit, 'acpion:tide', { atkPct: num(t1.atk) });
          const n = num(t1.cost);
          if (n > 0) battle.on('kill', ({ killer, victim }) => { if (killer === unit && victim?.side === 'enemy') dp(battle, unit, n); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const ma = num(tb.atk, 0), md = num(tb.def, 0); // module SOL-X: 阻挡敌人时攻击力和防御力各+8％
        if (ma || md) toggleBuff(battle, unit, 'acpion:sol', () => unit.blocking.length > 0, { atkPct: ma, defPct: md });
        // S3: 眩晕免疫, 冻结免疫 while its effects last
        if (r3) battle.on('beforeStatus', (c) => {
          if (c.target === unit && (c.status === 'stun' || c.status === 'freeze') && unit.findBuff(FRAGRANCE_KEY)) c.cancel = true;
        }, { owner: unit });
      },
    };
  },
};
