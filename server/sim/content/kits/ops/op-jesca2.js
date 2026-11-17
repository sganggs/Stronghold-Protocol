// server/sim/content/kits/ops/op-jesca2.js — 涤火杰西卡 (char_1034_jesca2) 自选 operator kit: 6★ 哨戒铁卫 (重装), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (SPT-X “私家英雄”, SPT-Y
// 未曾风化) at every form, and the kit of her summon 机动盾牌 (token_10032_jesca2_jckshd). Kit contract and the 自选 rules:
// ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1034_jesca2): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json);
// PRTS 涤火杰西卡 (灵活应变 备注 "转向行为不受异常效果影响，仅在机动盾牌持续时间内生效；机动盾牌退场后，涤火杰西卡转回原方向",
// "本天赋的防御增加效果无视孤立"; 蓄能释放 备注 "受到任何伤害时均可触发（包括无法触发受击回复的伤害）"; S2 备注 "此技能的攻击范围
// 不受“攻击距离”属性影响"; S3 备注 "仅技能持续期间可触发发射炮弹的行为，技能期间多次部署机动盾牌可触发多次发射炮弹行为（同一时间内最多
// 生效1次）", "发射炮弹行为视为不消耗弹药的普通攻击，受缴械类效果影响时该行为延迟至此类效果消失后进行", "炮弹飞行终点为自身当前攻击
// 范围内正前方最远一格中点，碰撞半径0.5，爆炸半径1.7"; SPT-Y 修正 "攻击距离+1（部分技能不受此影响）"); PRTS 机动盾牌 (备注 "持有
// 禁疗", "无视野范围", "退场时返还1个可部署的机动盾牌"; 嘲讽等级 1, 阻挡数 2); the client's battle data (charpack char_1034_jesca2:
// Talents/1/DefAura range b-1 ignoring 孤立, Talents/2 x-5, die_to_kill_token, charge_token[born]; token prefab
// token_10032_jesca2_jckshd: jckshd_t = 禁疗 (abnormal flag 7) + taunt for `duration` s, HostMark b-1, charge_token[finish];
// skill prefabs skchr_jesca2_1 JckshdBuff / skchr_jesca2_3 JckshdBuffS3 (auras on her x-5); projectile
// projectile_chr_jesca2_s3_bomb (speed 5, first enemy it passes, ground and air) → _explosion (every enemy in range, air
// too); buff_template_data jesca2_jckshd_dir_set / dir_ctrl, jesca2_t_2[sp], jesca2_e_003[t_sp] / [extend], jesca2_s_3[bomb]).
// - Trait (哨戒铁卫) "能够阻挡三个敌人，可以进行远程攻击": the profession default — ranged physical, blocks 3, hits air units
//   (PRTS 分支特性信息 哨戒铁卫 "可对空"), ground enemies target her normally.
// - Module SPT-X “私家英雄”: trait addition "攻击范围内敌人的隐匿效果失效" (jesca2_e_002_t: 隐匿 immunity on the enemies of her
//   range): reveal (stages 1 and 3). Stage 3 changes T1: the shield lasts 60 s and is stronger (the token's module
//   attributes and talent — data byModule). Stats: the module attributes.
// - Module SPT-Y 未曾风化: "攻击距离+1（部分技能不受此影响）" — a permanent forward range extension (jesca2_e_003[extend]); S2's
//   2-5 ignores it (its 备注), S3 grows on it. Stage 3 changes T2 (below). Stats: the module attributes.
// - T1 灵活应变: her 机动盾牌 is a hand piece the player places next to her ("只能放置于涤火杰西卡四周" — the prep's placement
//   rule; a piece on any other tile gets no turn, mark or aura here) and deploys with the board. Each deployment: it lasts
//   the token talent's `duration` (50 s; SPT-X stage 3: 60 s), holds 禁疗 and taunt level `taunt_level` (its hidden talent:
//   "更容易受到攻击"), makes no attack and blocks 2 (its stats); she turns to face it (her range turns with her) and turns
//   back to the direction she had when it came, once it leaves — whatever the reason, stunned or not (PRTS 备注; the
//   client's dir_set / dir_ctrl[reset]); while it stands next to her, she and the unit on the tile behind her (range b-1,
//   any ally unit, 孤立 ones too) DEF +def. It leaves when she leaves (die_to_kill_token: killed), and comes back on its tile
//   its respawnTime (30 s) after it left, paying its cost (5 DP), only while she stands — her (re)deployment makes a waiting
//   one ready at once (charge_token[born]) [ASSUMED: the 卫戍 auto redeploy of a placed summon, as 鸿雪's 打字机 / 谬因's 中继器].
// - T2 蓄能释放: every damage instance the shield takes — any damage, 无来源 / DoT included, not a 流失 or an element 损伤 —
//   while it stands on her x-5: `prob` to give her `sp` SP (none while a skill of hers runs: AK). SPT-Y stage 3: prob 0.65 and
//   each success also cuts the shield's own next redeploy time by respawn_time (1 s), at most respawn_time_max (14 s) per
//   shield deployment (jesca2_e_003[t_sp]: the card buff lasts until the next spawn; AlwaysNext — the cut comes with the
//   roll even when no SP can be gained).
// - S1 坚守阵线 (AUTO, 持续时间无限 — `toggle`): ATK +atk, DEF +def; every shield on her x-5 DEF +def while it runs (JckshdBuff
//   aura) and +duration s of life once per shield deployment (jckshd_t, the overriding lifetime buff of the aura). An AUTO
//   skill acting on herself and her shield fires at full SP (`trigger: 'SP_FULL'`, the owner's AUTO rule, kits/README.md
//   checklist 5; skchr_jesca2_1 `_allowNoTarget`).
// - S2 掩蔽护卫 (MANUAL, 15 s, data ACTIVE_RANGE on its 2-5 — the 重装 exception of 742f478): range 2-5 (not grown by
//   攻击距离), ATK +atk, attack interval base_attack_time s (−0.9 on 1.2 s), 75 % physical and arts dodge (the `evade`
//   template, prob).
// - S3 饱和迸射 (MANUAL, 20 发弹药, data ACTIVE_RANGE on its 2-2 + 1): 攻击距离 +ability_range_forward_extend, attack interval
//   +base_attack_time (0.6 s), ATK +atk, DEF +jesca2_s_3[def].def; her shields on x-5 DEF +jesca2_s_3_token[def].def. While
//   a shield stands next to her (the mark: at the cast, or a shield deployed during the skill — at most one pending), she
//   fires a shell as soon as she is not stunned / frozen / asleep / disarmed: an attack that spends no bullet and restarts
//   her attack timer [ASSUMED: the template clears and restarts the attack cooldown]; it flies at BOMB_SPEED from her
//   position to the centre of the farthest tile straight ahead of her current range, hits the first enemy it touches
//   (BOMB_HIT_RADIUS, ground or air) or the end point, and explodes: every selectable enemy within
//   attack@extrabomb.projectile_range takes attack@extrabomb.atk_scale × her ATK at the launch, physical (普通伤害, dodgeable),
//   and is stunned attack@extrabomb.stun s (not when it dodged the hit [ASSUMED]). The skill's end drops a pending shell.

import { num, talentBb, traitBb, moduleOn, skillRec, batMod, up, giveSp, installReveal } from '../shared/tier1.js';
import { offsetTile, dirFromDelta, dirVec } from '../../../dir.js';
import { isHpLoss } from '../../../attack.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_jesca2_1';
const S2 = 'skchr_jesca2_2';
const S3 = 'skchr_jesca2_3';
/** Her summon 机动盾牌 (talent 灵活应变). */
export const SHIELD = 'token_10032_jesca2_jckshd';
/** S3 shell (PRTS 备注 / projectile_chr_jesca2_s3_bomb): flight speed (tiles / s) and collision radius. */
const BOMB_SPEED = 5;
const BOMB_HIT_RADIUS = 0.5;
/** The shell's explosion radius when the blackboard lacks it (PRTS "爆炸半径1.7"). */
const BOMB_BLAST_FALLBACK = 1.7;
/** Aura refresh period and buff life (s): the kits' aura convention (a unit leaving the tile loses it within one refresh). */
const AURA = 0.2;
const AURA_DUR = 0.25;
/** How often a waiting shield tries to come back once ready (her on the field, its tile free, DP paid). */
const RETRY = 0.1;
const DEF_KEY = 'talent:jesca2:def';
const SHIELD_SKILL_KEY = 'skill:jesca2:shield';
const SHIELD_ABNORMAL_KEY = 'jesca2:shield:abnormal';
const TAG_BOMB = 'jesca2:bomb';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 机动盾牌 of `unit`. */
const isShieldOf = (t, unit) => !!t && t.kind === 'token' && t.defId === SHIELD && t.ownerUnit === unit;
const shieldsOf = (battle, unit) => battle.allyUnits.filter((t) => isShieldOf(t, unit));
/** `t` stands on one of the four tiles next to `unit` (the placement rule "四周"; her x-5 auras reach it there). */
const besideOf = (unit, t) => Math.abs(t.tileR - unit.tileR) + Math.abs(t.tileC - unit.tileC) === 1;
/** The shield of hers standing next to her (the mark jesca2_jckshd_s_3[mark]: its HostMark b-1 holds her), or null. */
const markOf = (battle, unit) => shieldsOf(battle, unit).find((t) => up(t) && besideOf(unit, t)) ?? null;
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);

/** Face `dir` (the range turns with her: Battle.refreshRange; a SkillRuntime trigger grid follows `unit.dir`). */
function turnTo(battle, unit, dir) {
  if (unit.dir === dir) return;
  unit.dir = dir;
  if (unit.alive && unit.deployed) battle.refreshRange(unit);
}

/** The farthest local column straight ahead (local row 0) of a relative grid (her current range). */
function farthestAhead(grid) {
  let n = 0;
  for (const p of grid ?? []) if (Array.isArray(p) && p[0] === 0 && p[1] > n) n = p[1];
  return n;
}

/**
 * 灵活应变's piece: the shield's kit (lifetime = its talent's `duration`, 禁疗 + taunt, her turn, its redeploy). `owner` =
 * 涤火杰西卡, `s1Ext` = the life her S1 adds (bb.duration).
 */
function shieldKit(owner, { s1Ext }) {
  return {
    skill: null,
    trait: { noAttack: true },   // "无视野范围" (and ATK 0)
    talents: [],
    install(battle, t) {
      const tal = (t.def?.talents ?? []).find((x) => x && x.bb && x.bb.duration != null)?.bb ?? {};
      const life = num(tal.duration, 50);
      const taunt = num(tal.taunt_level, 1);
      // 持有禁疗 (PRTS; jckshd_t abnormal flag 7 — the data's `abnormal` lacks it [ASSUMED: given here]) and "更容易受到攻击"
      battle.addBuff(t, { key: SHIELD_ABNORMAL_KEY, flags: { noHeal: true }, mods: { taunt }, persist: true, allowDead: true });
      battle.on('deploy', (c) => {
        if (c.unit !== t) return;
        t.mem.lifeEnd = battle.time + life;
        t.mem.s1Done = false;
        t.mem.respawnCut = 0;
        // she turns to face it; it faces away from her (dir_set: AssignRelativeDirectionToBB, SetBodyDirection)
        if (up(owner) && besideOf(owner, t)) {
          const dir = dirFromDelta(t.tileR - owner.tileR, t.tileC - owner.tileC, owner.dir);
          if (owner.mem.jescaOldDir == null) owner.mem.jescaOldDir = owner.dir;
          t.dir = dir;
          turnTo(battle, owner, dir);
          battle.fx('buff', { x: owner.x, y: owner.y, id: owner.id, kind: 'turn' });
          // S3: a shield taking the field during the skill fires a shell (at most one pending)
          if (skillOn(owner, S3)) owner.mem.jescaBomb = true;
        }
      }, { owner: t });
      battle.on('tick', () => {
        if (!up(t)) return;
        // S1's aura gives a shield on her x-5 +s1Ext s of life, once per deployment
        if (!t.mem.s1Done && s1Ext > 0 && skillOn(owner, S1) && up(owner) && besideOf(owner, t)) {
          t.mem.s1Done = true;
          t.mem.lifeEnd += s1Ext;
        }
        if (battle.time + 1e-9 >= t.mem.lifeEnd) battle.retreat(t, { reason: 'expired', permanent: true });
      }, { owner: t });
      battle.on('death', (c) => {
        if (c.unit !== t || battle.finished) return;
        // dir_ctrl[reset]: she turns back to the direction she had when it came — stunned or not, on the field or not
        if (owner.mem.jescaOldDir != null) {
          turnTo(battle, owner, owner.mem.jescaOldDir);
          owner.mem.jescaOldDir = null;
        }
        // the piece stays (退场时返还1个可部署的机动盾牌): back on its tile once ready, while she stands
        t.removed = false;
        t.mem.readyAt = battle.time + Math.max(0, num(t.base.respawnTime) - num(t.mem.respawnCut));
        t.mem.respawnCut = 0;
        if (t.mem.retry) return;
        t.mem.retry = battle.every(RETRY, (b, sched) => {
          const stop = () => { sched.cancel(); t.mem.retry = null; };
          if (t.alive || t.removed || b.finished) { stop(); return; }
          if (!up(owner) || b.time + 1e-9 < t.mem.readyAt) return;
          if (b.redeploy(t, { free: false })) stop();
        }, { owner: t });
      }, { owner: t, priority: -10 });
    },
  };
}

/**
 * S3's shell: from her tile straight ahead to the centre of the farthest tile of her current range, at BOMB_SPEED; the
 * first selectable enemy within BOMB_HIT_RADIUS (ground or air) or the end point sets it off.
 */
function fireBomb(battle, unit, b3) {
  const [fr, fc] = dirVec(unit.dir);
  const k = farthestAhead(unit.liveRangeGrid);
  const bomb = {
    x: unit.x, y: unit.y, tx: unit.tileC + fc * k, ty: unit.tileR + fr * k,
    atk: unit.s.atk,   // the launch's ATK (_cachedAtkKey)
    scale: num(b3['attack@extrabomb.atk_scale'], 2.5),
    radius: num(b3['attack@extrabomb.projectile_range'], BOMB_BLAST_FALLBACK),
    stun: num(b3['attack@extrabomb.stun'], 5),
  };
  (unit.mem.jescaShells ??= []).push(bomb);
  unit.atkCd = unit.s.interval;   // the shell is her attack: the timer restarts [ASSUMED]
  battle.fx('bombardShell', { x: bomb.tx, y: bomb.ty, id: unit.id, r: bomb.radius, t: hypot(bomb.tx - bomb.x, bomb.ty - bomb.y) / BOMB_SPEED });
}

/** Move the shells one tick; a shell touching an enemy or reaching its end point explodes. */
function flyShells(battle, unit, dt) {
  const list = unit.mem.jescaShells;
  if (!list || !list.length) return;
  const keep = [];
  for (const s of list) {
    const dx = s.tx - s.x, dy = s.ty - s.y;
    const d = hypot(dx, dy);
    const step = BOMB_SPEED * dt;
    let hit = battle.foesInRadius(s.x, s.y, BOMB_HIT_RADIUS).length > 0;
    if (!hit) {
      if (d <= step) { s.x = s.tx; s.y = s.ty; hit = true; } else { s.x += (dx / d) * step; s.y += (dy / d) * step; }
      if (!hit && battle.foesInRadius(s.x, s.y, BOMB_HIT_RADIUS).length > 0) hit = true;
    }
    if (hit) explode(battle, unit, s); else keep.push(s);
  }
  unit.mem.jescaShells = keep;
}

function explode(battle, unit, s) {
  battle.fx('bombard', { x: s.x, y: s.y, id: unit.id, r: s.radius });
  const dodged = (unit.mem.jescaDodged = new Set());
  for (const e of battle.foesInRadius(s.x, s.y, s.radius)) {
    if (!e.alive) continue;
    battle.dealDamage(unit, e, { amount: s.atk * s.scale, type: 'phys', isSkill: true, tags: ['skill', TAG_BOMB] });
    if (e.alive && !dodged.has(e)) battle.applyStatus(e, 'stun', { duration: s.stun, source: unit });
  }
  unit.mem.jescaDodged = null;
}

export default {
  char_1034_jesca2: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 灵活应变: def (+18 %)
    const t1 = talentBb(chess, 1);   // 蓄能释放: sp, prob (SPT-Y stage 3: + respawn_time, respawn_time_max)
    const tb = traitBb(chess);       // SPT-Y: ability_range_forward_extend
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const mod = moduleOn(chess) ? chess.module.id : null;
    const shieldDef = (unit) => (skillOn(unit, S1) ? num(b1.def) : 0) + (skillOn(unit, S3) ? num(b3['jesca2_s_3_token[def].def']) : 0);
    return {
      skills: {
        [S1]: { kind: 'toggle', trigger: 'SP_FULL', mods: { atkPct: num(b1.atk), defPct: num(b1.def) } },
        [S2]: {
          kind: 'duration',
          // 2-5, never grown by 攻击距离 (PRTS 备注)
          targeting: { rangeGrid: s2?.rangeGrid ?? null, noRangeExtend: true },
          mods: { atkPct: num(b2.atk), batPct: batMod(b2.base_attack_time, chess), dodgePhys: num(b2.prob), dodgeArts: num(b2.prob) },
        },
        [S3]: {
          kind: 'ammo', ammo: num(b3['attack@trigger_time'], 20),
          targeting: { rangeExtend: num(b3.ability_range_forward_extend, 1) },
          mods: { atkPct: num(b3.atk), defPct: num(b3['jesca2_s_3[def].def']), batPct: batMod(b3.base_attack_time, chess) },
          onStart({ battle, unit }) { unit.mem.jescaBomb = !!markOf(battle, unit); },
          onEnd({ unit }) { unit.mem.jescaBomb = false; },
        },
      },
      talents: [
        { install(battle, unit) { // 灵活应变: her shield pieces run the shield's kit (set up before the battle starts)
          const kit = () => shieldKit(unit, { s1Ext: num(b1.duration) });
          for (const t of battle.allyUnits) {
            if (!isShieldOf(t, unit) || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t); // a piece set up before her: drop its generic kit's hooks
            battle._setupUnit(t, kit());
          }
          // die_to_kill_token: her shields fall when she leaves; charge_token[born]: her (re)deployment readies a waiting one
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            for (const t of shieldsOf(battle, unit)) if (t.alive) battle.kill(t, null);
          }, { owner: unit });
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            for (const t of shieldsOf(battle, unit)) if (!t.alive && !t.removed) t.mem.readyAt = battle.time;
          }, { owner: unit });
          // she and the unit on the tile behind her (b-1, 孤立 ones too: ignoreAllyTargetFree) DEF +def while her shield
          // stands next to her
          const d = num(t0.def);
          if (!(d > 0)) return;
          const aura = () => {
            if (!up(unit) || !markOf(battle, unit)) return;
            const [br, bc] = offsetTile(unit.tileR, unit.tileC, 0, -1, unit.dir);
            for (const a of [unit, battle.unitAt(br, bc)]) {
              if (!a || a.side !== 'ally' || a.kind === 'device' || !a.alive) continue;
              const cur = a.findBuff(DEF_KEY);
              if (cur && cur.source !== unit && (cur.data?.v ?? 0) > d && cur.timeLeft > 0.05) continue;
              battle.addBuff(a, { key: DEF_KEY, duration: AURA_DUR, mods: { defPct: d }, source: unit, data: { v: d }, tags: ['talent', 'aura'] });
            }
          };
          battle.every(AURA, aura, { owner: unit, immediate: true });
          battle.on('deploy', (c) => { if (isShieldOf(c.unit, unit)) aura(); }, { owner: unit });
        } },
        { install(battle, unit) { // 蓄能释放: the shield hurt ⇒ prob: +sp SP to her (SPT-Y stage 3: its next redeploy −1 s, ≤ 14 s)
          const prob = num(t1.prob), sp = num(t1.sp);
          const cut = num(t1.respawn_time), cutMax = num(t1.respawn_time_max);
          if (!(prob > 0)) return;
          battle.on('damaged', (c) => {
            const t = c.target;
            if (!isShieldOf(t, unit) || !up(unit) || !besideOf(unit, t)) return;
            if (!c.dmg || isHpLoss(c.dmg) || c.type === 'element') return;
            if (!battle.rng.chance(prob)) return;
            giveSp(unit, sp, 'talent');
            if (cut > 0 && cutMax > 0) t.mem.respawnCut = Math.min(cutMax, num(t.mem.respawnCut) + Math.abs(cut));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // SPT-X “私家英雄”: 攻击范围内敌人的隐匿效果失效
        if (mod === 'uniequip_002_jesca2') installReveal(battle, unit);
        // SPT-Y 未曾风化: 攻击距离+1 — a permanent extension (her initial range too); S2's 2-5 ignores it (noRangeExtend)
        const ext = num(tb.ability_range_forward_extend);
        if (ext > 0) battle.addBuff(unit, { key: 'module:jesca2:range', mods: { rangeExtend: ext }, persist: true, allowDead: true });
        // S1 / S3: her shields on x-5 DEF +def while the skill runs (JckshdBuff / JckshdBuffS3 auras)
        battle.on('tick', (c) => {
          for (const t of shieldsOf(battle, unit)) {
            if (!t.alive) continue;
            const want = up(unit) && besideOf(unit, t) ? shieldDef(unit) : 0;
            const has = t.findBuff(SHIELD_SKILL_KEY);
            if (want > 0 && (!has || has.mods?.defPct !== want)) {
              battle.addBuff(t, { key: SHIELD_SKILL_KEY, mods: { defPct: want }, source: unit, tags: ['skill'] });
            } else if (!(want > 0) && has) battle.removeBuff(t, SHIELD_SKILL_KEY);
          }
          // S3's shell: fired as soon as she can attack (not stunned / frozen / asleep, not disarmed), shells in flight move
          if (unit.mem.jescaBomb && skillOn(unit, S3) && unit.canAct && !unit.s.flags.disarm) {
            unit.mem.jescaBomb = false;
            fireBomb(battle, unit, b3);
          }
          flyShells(battle, unit, c.dt ?? battle.dt);
        }, { owner: unit });
        // a shell's explosion that is dodged carries no stun [ASSUMED]
        battle.on('dodge', (c) => {
          if (c.source === unit && unit.mem.jescaDodged && c.dmg?.tags?.includes(TAG_BOMB)) unit.mem.jescaDodged.add(c.target);
        }, { owner: unit });
      },
    };
  },
};
