// server/sim/content/kits/ops/op-aglna2.js — 予愿安洁莉娜 (char_1015_aglna2) 自选 operator kit: 6★ 巡空者 (特种), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots (no module); every skill, both talents, the trait at every form, and
// the kit of her S3 marker “一会儿见！” (token_10071_aglna2_agairp). Kit contract and the 自选 rules: ../README.md ("How
// to add an operator (自选)").
//
// Forms (data/backups.json units.char_1015_aglna2): normal = E2 Lv1, skills at rank 4; elite = E2 Lv60, rank 7 — the
// owner's decision of 2026-10-05; she has no module. Full potential (the owner's decision of 2026-10-07). Sources: character_table /
// skill_table / token_table (zh_CN, as built into backups.json), PRTS 予愿安洁莉娜 / “一会儿见！” (备注), 分支特性信息 §巡空者,
// gamedata_const (ba.liftoff / ba.levitate / ba.groundbind / ba.airprotect / ba.weightless), and the client's battle data
// (charpack char_1015_aglna2: modes, MassLossAura, the trait / talent buffs; skills skchr_aglna2_1–3; projectiles
// projectile_chr_aglna2_s2_fly / _s3_fly; buff templates aglna2_tr, aglna2_t_1[self], aglna2_t_1[enemy], aglna2_t_2,
// aglna2_s_2[*], aglna2_s_3[*]).
// - Trait (巡空者) "起飞后能够阻挡2个飞行敌人" (aglna2_tr: block mode WALK in her default mode, FLY in every skill mode):
//   melee physical, hits air units (分支特性信息 "攻击可对空"), blocks 2. On the ground she blocks ground enemies only (the
//   profession's permanent blockFly is removed, as 蒂比's kit does); airborne (起飞, flags `liftoff` + `blockFly`: every
//   skill below while it runs) she blocks flyers only and no ground enemy selects her (对地规避: aglna2_t_1[motion_target]
//   MOTION_TARGET_FREE). Taking off releases the ground enemies she blocked, landing the flyers.
// - T1 飘浮大地之上 "攻击额外造成相当于攻击力25%的法术伤害，攻击重量较轻（小于等于3）的敌人时则额外造成相当于攻击力35%的法术伤害；
//   处于起飞状态时使攻击范围内的敌人失重" (full potential: 30% / 45%; bb atk_scale_lo / atk_scale_hi / mass_level): every damage
//   instance she outputs that is no additional (ADDITION) or continuous damage (备注 "可于任何来源于予愿安洁莉娜的、附加伤害以外的伤害的输出伤害时触发";
//   aglna2_t_1[self] ON_OUTPUT_MODIFIER) adds ATK × atk_scale_hi arts on a target whose current weight (失重 included) is at
//   most mass_level, else × atk_scale_lo — also when that hit is dodged or absorbed (an output, [ASSUMED]: the hooks
//   `damaged` and `dodge`), never on a target with no HP left. While she is airborne every selectable enemy of her attack
//   range (ground and air: MassLossAura targetMotion 3) is 失重 (weight −1 level; 同名效果不可叠加: none of hers while
//   another 失重 holds it), gone when it leaves the range or she lands (备注 "此天赋的失重效果仅判断自身是否能够阻挡飞行敌人").
// - T2 天穹间的舞步 "在场时，所有处于起飞状态的友方干员攻击力+13%且阻挡时每秒回复8%的最大生命值" (full potential: +18% / 10%;
//   bb atk, hp_recovery_per_sec_by_max_hp_ratio): every 0.2 s (the client ability `_interval`) each allied operator in the air
//   block mode (起飞: flag `liftoff`, her included) gets ATK +atk and, while it blocks, 生命回复速度 +ratio × max HP
//   (hpRegenRatio — 备注 "生命回复的效果为增加“生命回复速度（百分比）”属性，不受治疗加成和禁疗影响": no heal, 禁疗 does not stop it).
// - S1 极速送达 (被动 ON_DEPLOY, 56 s): a timed deployment skill (activateOnDeploy, trigger NEVER): she takes off at each
//   deployment for its duration — range 3-6, ATK +atk, attacks 2 targets (attack@max_target) — and lands when it ends
//   (aglna2_s_1[switch_mode] → S1_Landing; the landing clip's length is not modelled).
// - S2 重力自定义 (MANUAL, 22 s, data ACTIVE_RANGE on its 3-10): she takes off at once; for chant_duration (2.5) s she glides
//   (吟唱: no attack, 无敌, the control statuses refused — 备注 "持有无敌、不可阻挡、晕眩/冻结/小睡/沉睡免疫，一减状态抵抗率×0")
//   while a sweep released from her tile along her direction (备注 "宽3.0×厚1.3、飞行速度6.0的弹道…终点位于前方至多4.0格"; it
//   goes through walls) hits each selectable enemy once: an air unit 缚地 buff_duration_ground_bound s, any other 浮空
//   buff_duration_levitate s (aglna2_s_2[enemy]: CheckMotionMode FLY; halved on weight > 3 by both terms). The 22 s,
//   ATK +atk and the attack interval change (a flat base_attack_time s) run from the cast (the client's
//   `_buffsWhenStartChant` carries them); range 3-10, attacks turn arts and hit attack@max_target targets. `mass_level`
//   (10) has no text and no node uses it here [unused — open question].
// - S3 酸橙的心事 (MANUAL, 30 / 31 bullets, data ACTIVE_RANGE on its 3-9): she takes off; ATK +atk; 对空庇护
//   (damage_resistance: physical / arts damage whose source is an air unit ×(1 − ratio) — aglna2_s_3[damage_reduce]);
//   range 3-9 and the 8 tiles around her (attack@attack_range_id x-4); each attack hits at most attack@max_walk_target
//   ground enemies and fills up to attack@max_target with flyers (her two selectors: ground ≤ 3, air) for attack@atk_scale
//   × ATK physical; every flyer of her range moves ×(1 − move_speed) (备注 "对飞行单位的减速效果无视其可选性"). The move (备注;
//   aglna2_s_3[mode], every 0.1 s): blocking nothing, with an unblocked flyer she can block inside the ORIGINAL 3-9 — of
//   her deployment tile and direction —, she flies to its tile (not a start / end tile, any deploy type but not
//   impassable, empty or holding her marker) at 2 tiles/s ([ASSUMED]: the client's movement `_finalSpeed`), meanwhile
//   无敌, 禁疗, disarmed, blocking nothing and refusing control statuses (aglna2_s_3[fly_passive]), and lands there by a
//   【移动】 (Battle.moveRedeploy: a new deployment, the skill and its bullets kept), re-picking the best target on arrival
//   [ASSUMED: the client re-selects every 0.1 s in flight]; her attack range stays the original 3-9 — anchored on her
//   deployment tile (extra range keys) — plus the 8 tiles around her (备注 "不影响攻击范围"; the client's located-range
//   abilities). Off her deployment tile, “一会儿见！” marks it (备注 "每次移动后若不位于初始位置且初始位置不存在标志物…部署一个").
//   When the skill ends she goes back there by a 【移动】 (the marker leaves) unless she is knocked out.
// - “一会儿见！” (its kit below): 无敌, 孤立, 不可选中 by enemies, blocks nothing, no attack (PRTS 备注; token_aglna2_passive).
//   It is the skill's placeholder (skchr_aglna2_3 `_placeholderTokenKey`), not a player's summon: no owner shows it, so the
//   data does not mark it placeable (tools/build-data.mjs summonRecord, 0.2.0 WE2 — until then the prep handed a piece out
//   with S3 and this kit used it as the marker) and the skill summons it each time.

import { num, talentBb, skillRec, batMod, up, installAura, toggleBuff } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { hasHp } from '../../../attack.js';
import { RESIST_STATUSES } from '../../../buffs.js';
import { TICK } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_aglna2_1';
const S2 = 'skchr_aglna2_2';
const S3 = 'skchr_aglna2_3';
/** “一会儿见！”, the marker of her deployment tile while S3 has moved her off it. */
export const MARKER = 'token_10071_aglna2_agairp';
/** 起飞 (ba.liftoff): air block mode + 对地规避 (as 蒂比's kit). */
const LIFTOFF = Object.freeze({ liftoff: true, blockFly: true });
/** range x-4: her tile and the eight around it (S3 attack@attack_range_id). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
const ANY = Object.freeze({ canHitFly: true });
/** S2's sweep (PRTS 备注; projectile_chr_aglna2_s2_fly `_speed` 6, `_distanceMax` 4). */
const GLIDE_SPEED = 6, GLIDE_DIST = 4, GLIDE_HALF_WIDTH = 1.5, GLIDE_HALF_THICK = 0.65;
/** S3's flight speed (projectile_chr_aglna2_s3_fly `_finalSpeed` 2) [ASSUMED constant]. */
const MOVE_SPEED = 2;
/** S3's move check (aglna2_s_3[mode] / the flight's `_selectorRefreshInterval`). */
const MOVE_CHECK = 0.1;
/** T2's refresh (the client ability `_interval` 0.2). */
const DANCE_IV = 0.2;
const CHANT_KEY = 'aglna2:chant';
const MOVE_KEY = 'aglna2:move';
const TAG_EXTRA = 'aglna2:extra';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
const keyOf = (r, c) => `${r},${c}`;

function takeOff(battle, unit) {
  battle.releaseBlocked(unit);   // 起飞 "不阻挡地面敌人": the ground enemies she held walk on
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
}
function land(battle, unit) { battle.releaseBlocked(unit); }   // the flyers she held

/** “一会儿见！”'s kit: 无敌, 孤立, not selectable by enemies, blocks nothing, no attack, no skill. */
function markerKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, t) {
      battle.addBuff(t, { key: 'trait:aglna2:marker', flags: { invulnerable: true, untargetable: true, isolated: true, noBlock: true, noHeal: true }, persist: true, allowDead: true });
    },
  };
}

/** S2's sweep from (x0, y0) along `fwd`: each selectable enemy once — an air unit 缚地 `gb` s, any other 浮空 `lev` s. */
function glide(battle, unit, lev, gb) {
  const [fr, fc] = unit.fwd;
  const x0 = unit.x, y0 = unit.y, t0 = battle.time;
  const hit = new Set();
  const sweep = () => {
    const lead = Math.min(GLIDE_DIST, (battle.time - t0) * GLIDE_SPEED);
    for (const e of battle.enemies) {
      if (hit.has(e) || !canTargetEnemy(unit, e, ANY)) continue;
      const dx = e.x - x0, dy = e.y - y0;
      const along = dx * fc + dy * fr, side = Math.abs(dx * fr - dy * fc);
      if (side > GLIDE_HALF_WIDTH + 1e-9 || along < -GLIDE_HALF_THICK - 1e-9 || along > lead + GLIDE_HALF_THICK + 1e-9) continue;
      hit.add(e);
      if (e.isFlying) battle.applyStatus(e, 'groundbind', { duration: gb, source: unit });
      else battle.applyStatus(e, 'levitate', { duration: lev, source: unit });
    }
    return lead >= GLIDE_DIST;
  };
  battle.fx('dash', { x: x0, y: y0, id: unit.id, tx: x0 + fc * GLIDE_DIST, ty: y0 + fr * GLIDE_DIST, t: GLIDE_DIST / GLIDE_SPEED });
  if (sweep()) return;
  battle.every(TICK, (b, sched) => { if (sweep()) sched.cancel(); });
}

export default {
  char_1015_aglna2: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // atk_scale_lo / atk_scale_hi / mass_level
    const t1 = talentBb(chess, 1);   // atk / hp_recovery_per_sec_by_max_hp_ratio
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const g39 = (r3?.rangeGrid ?? []).map((p) => [p[0], p[1]]);
    const seen = new Set(g39.map(([r, c]) => keyOf(r, c)));
    const g39x4 = [...g39, ...X4.filter(([r, c]) => !seen.has(keyOf(r, c))).map((p) => [p[0], p[1]])];
    const maxT3 = Math.max(1, Math.floor(num(b3['attack@max_target'], 4)));
    const maxWalk3 = Math.max(0, Math.floor(num(b3['attack@max_walk_target'], maxT3)));
    // S3's running range: the original 3-9 with the eight tiles around her; once she has moved, the eight around her and
    // the 3-9 of her deployment tile (extra range keys) — a per-unit object Battle._refreshRange reads
    const s3Targeting = { rangeGrid: g39x4, maxTargets: maxT3 };
    // S3's per-activation state: her deployment tile / direction, the flight under way, the marker
    let st = null;

    /** The original 3-9 of her deployment tile (S3 "原技能范围"), grown by her permanent rangeExtend. */
    const keys39 = (unit) => absoluteRangeKeys(g39, st.r0, st.c0, st.dir0, unit.s.baseRangeExtend || 0);
    const atHome = (unit) => !!st && unit.tileR === st.r0 && unit.tileC === st.c0;
    /** May she (blocking nothing) block flyer `e` once there: unblocked, no 无法被阻挡 state, room for its weight. */
    const blockable = (unit, e) => !e.blockedBy && !e.s.flags.unblockable && !e.s.flags.levitate && !e.s.flags.fear && !e.s.flags.attract
      && (e.blockWeight ?? 1) <= unit.s.blockCnt;
    /** A tile her S3 may take: on the field, not impassable, no start / end tile, not hers, empty or her marker's. */
    function tileOk(battle, unit, r, c) {
      if (!battle.grid.inRect(r, c) || (r === unit.tileR && c === unit.tileC)) return false;
      const tile = battle.grid.tile(r, c);
      if (tile.pass === 'NONE' || tile.special) return false;
      if (battle.downOn(r, c)) return false;
      const occ = battle.unitAt(r, c);
      return !occ || !occ.alive || (!!st && occ === st.marker);
    }
    /** The flyer (and its tile) her S3 should fly to now, or null. */
    function moveTarget(battle, unit) {
      const cands = battle.enemiesInKeys(keys39(unit), unit, ANY).filter((e) => e.isFlying && blockable(unit, e));
      sortEnemyTargets(battle, unit, cands, null);
      for (const e of cands) {
        const r = Math.round(e.y), c = Math.round(e.x);
        if (tileOk(battle, unit, r, c)) return { e, r, c };
      }
      return null;
    }
    function placeMarker(battle, unit) {
      if (!st || (st.marker && st.marker.alive)) return;
      st.marker = battle.spawnToken(unit, MARKER, st.r0, st.c0, { kit: markerKit() });
    }
    function dropMarker(battle) {
      const m = st && st.marker;
      if (m && m.alive) battle.retreat(m, { reason: 'expired', permanent: true });
      if (st) st.marker = null;
    }
    /** Her S3 range for where she stands: the 3-9 ∪ x-4 at home; away, the x-4 here + the anchored 3-9 (extra keys). */
    function anchorRange(battle, unit) {
      if (!st || atHome(unit)) {
        s3Targeting.rangeGrid = g39x4;
        battle.setExtraRange(unit, null);
      } else {
        s3Targeting.rangeGrid = X4;
        battle.setExtraRange(unit, keys39(unit));
      }
    }
    /** A 【移动】 of S3 onto (r, c); the marker follows the rules of the 备注. */
    function moveTo(battle, unit, r, c) {
      const home = r === st.r0 && c === st.c0;
      if (home) dropMarker(battle);
      const from = { x: unit.x, y: unit.y };
      if (!battle.moveRedeploy(unit, r, c)) return false;
      battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, fx: from.x, fy: from.y });
      if (!home) placeMarker(battle, unit);
      anchorRange(battle, unit);
      return true;
    }

    return {
      trait: { blockFly: false },   // the profession's permanent air block: only while airborne here
      skills: {
        [S1]: {
          kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER',
          mods: { atkPct: num(b1.atk) }, flags: LIFTOFF,
          targeting: { rangeGrid: r1?.rangeGrid ?? null, maxTargets: Math.max(1, Math.floor(num(b1['attack@max_target'], 1))) },
          onStart({ battle, unit }) { takeOff(battle, unit); },
          onEnd({ battle, unit }) { land(battle, unit); },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), batPct: batMod(b2.base_attack_time, chess) }, flags: LIFTOFF,
          targeting: { rangeGrid: r2?.rangeGrid ?? null, maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 1))) },
          attack: { dmgType: 'arts' },
          onStart({ battle, unit }) {
            takeOff(battle, unit);
            const chant = num(b2.chant_duration);
            if (chant > 0) battle.addBuff(unit, { key: CHANT_KEY, duration: chant, flags: { disarm: true, invulnerable: true }, tags: ['skill'] });
            glide(battle, unit, num(b2.buff_duration_levitate), num(b2.buff_duration_ground_bound));
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, CHANT_KEY); land(battle, unit); },
        },
        [S3]: {
          kind: 'ammo',
          // The skill's initial attack area includes the eight surrounding tiles as well as its 3-9 grid.
          trigger: { rule: 'ACTIVE_RANGE', grid: g39x4 },
          ammo: Math.max(1, Math.floor(num(b3['attack@trigger_time'], 1))),
          mods: { atkPct: num(b3.atk) }, flags: LIFTOFF,
          targeting: s3Targeting,
          attack: { atkScale: num(b3['attack@atk_scale'], 1) },
          onStart({ battle, unit, skill }) {
            takeOff(battle, unit);
            st = { r0: unit.tileR, c0: unit.tileC, dir0: unit.dir, act: skill.activations, flight: null, marker: null };
            s3Targeting.rangeGrid = g39x4;
          },
          onEnd({ battle, unit, reason }) {
            if (st) st.flight = null;
            battle.removeBuff(unit, MOVE_KEY);
            dropMarker(battle);
            // back to her deployment tile by a 【移动】 (备注 "技能结束时若位于初始位置则降落；否则执行一次以初始位置为目标的返回移动")
            if (reason !== 'death' && st && !atHome(unit) && unit.alive && unit.deployed) {
              const from = { x: unit.x, y: unit.y };
              if (battle.moveRedeploy(unit, st.r0, st.c0)) battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, fx: from.x, fy: from.y });
            }
            st = null;
            s3Targeting.rangeGrid = g39x4;
            battle.setExtraRange(unit, null);
            land(battle, unit);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 飘浮大地之上: the arts addition on every output of hers; 失重 in her range while airborne
          battle.removeBuff(unit, 'trait:skywalker');   // (the profession's permanent blockFly)
          const hi = num(t0.atk_scale_hi), lo = num(t0.atk_scale_lo), mass = num(t0.mass_level, 3);
          const extra = (target, dmg) => {
            if (!up(unit) || !target || target.side !== 'enemy' || !target.alive || !hasHp(target) || !dmg) return;
            if (dmg.type === 'element' || dmg.type === 'elemental' || (dmg.tags && (dmg.tags.includes(TAG_EXTRA) || dmg.tags.includes('dot')))) return;
            const s = target.weight <= mass ? hi : lo;
            if (s > 0) battle.dealDamage(unit, target, { amount: unit.s.atk * s, type: 'arts', tags: ['talent', TAG_EXTRA] });
          };
          battle.on('damaged', (ctx) => { if (ctx.source === unit && ctx.type !== 'element') extra(ctx.target, ctx.dmg); }, { owner: unit });
          battle.on('dodge', (ctx) => { if (ctx.source === unit) extra(ctx.target, ctx.dmg); }, { owner: unit });
          // 失重 (同名效果不可叠加) on every selectable enemy of her range while she is airborne
          const myKey = `aglna2:weightless:${unit.id}`;
          battle.on('tick', () => {
            const on = up(unit) && !!unit.s.flags.liftoff;
            const inRange = on ? new Set(battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) : null;
            for (const e of battle.enemies) {
              const mine = e.findBuff(myKey);
              const want = on && e.alive && inRange.has(e) && !e.buffs.some((b) => b.status === 'weightless' && b.key !== myKey);
              if (want && !mine) battle.addBuff(e, { key: myKey, status: 'weightless', visible: true, mods: { massFlat: -1 }, source: unit });
              else if (!want && mine) battle.removeBuff(e, mine);
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 天穹间的舞步: airborne allied operators ATK +atk, and 生命回复速度 while they block
          const atk = num(t1.atk), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio);
          if (!(atk > 0) && !(regen > 0)) return;
          installAura(battle, unit, {
            key: 'talent:aglna2:dance', value: atk, interval: DANCE_IV,
            select: (a) => a.kind === 'op' && !!a.s.flags.liftoff,
            mods: (a) => (regen > 0 && a.blocking.length > 0 ? { atkPct: atk, hpRegenRatio: regen } : { atkPct: atk }),
          });
        } },
      ],
      install(battle, unit) {
        const sid = unit.skill?.id;
        // the 吟唱 (S2) and the flight (S3) refuse every control status (一减状态抵抗率×0)
        battle.on('beforeStatus', (ctx) => {
          if (ctx.target !== unit || !RESIST_STATUSES.has(ctx.status) || (ctx.source && ctx.source.side === 'ally')) return;
          if (unit.findBuff(CHANT_KEY) || unit.findBuff(MOVE_KEY)) ctx.cancel = true;
        }, { owner: unit });
        if (sid !== S3) return;
        const dr = num(b3.damage_resistance), slow = -num(b3.move_speed);
        const aspdB = num(b3['aglna2_s_3[blocked].attack_speed']), aspdU = num(b3['aglna2_s_3[unblocked].attack_speed']);
        if (aspdB) toggleBuff(battle, unit, 'skill:aglna2:blocked', () => skillOn(unit, S3) && unit.blocking.length > 0, { aspd: aspdB });
        if (aspdU) toggleBuff(battle, unit, 'skill:aglna2:unblocked', () => skillOn(unit, S3) && unit.blocking.length === 0, { aspd: aspdU });
        // 对空庇护: physical / arts damage from an air unit ×(1 − damage_resistance)
        if (dr > 0) {
          battle.on('hit', (ctx) => {
            const s = ctx.source, d = ctx.dmg;
            if (ctx.target !== unit || !skillOn(unit, S3) || !s || !s.isFlying || !d || (d.type !== 'phys' && d.type !== 'arts')) return;
            if (d.tags && d.tags.includes('dot')) return;
            d.mul = (d.mul ?? 1) * (1 - dr);
          }, { owner: unit });
        }
        // at most attack@max_walk_target ground targets, flyers up to attack@max_target
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !skillOn(unit, S3)) return;
          const prof = ctx.profile || unit.profile;
          const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
          for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
          if (!cands.length) return;
          sortEnemyTargets(battle, unit, cands, prof.priority);
          let g = 0;
          const out = [];
          for (const e of cands) {
            if (out.length >= maxT3) break;
            if (!e.isFlying) { if (g >= maxWalk3) continue; g++; }
            out.push(e);
          }
          if (out.length) ctx.targets = out;
        }, { owner: unit });
        battle.on('tick', () => {
          if (!skillOn(unit, S3) || !up(unit)) return;
          // the flyers of her range move ×(1 − move_speed), selectable or not
          if (slow > 0) {
            const keys = unit.rangeKeySet;
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || !e.isFlying || !keys || !bodyInRange(e, keys)) continue;
              battle.applyStrongest(e, 'aglna2:airSlow', { duration: MOVE_CHECK * 2, value: slow, mods: (v) => ({ moveMul: 1 - v }), source: unit });
            }
          }
        }, { owner: unit });
        // the move (every MOVE_CHECK s): fly to a blockable flyer of the original 3-9 while she blocks nothing
        battle.every(MOVE_CHECK, () => {
          if (!st || !skillOn(unit, S3) || !up(unit) || st.flight || !unit.canAct || unit.blocking.length) return;
          const tgt = moveTarget(battle, unit);
          if (!tgt) return;
          const dur = hypot(tgt.r - unit.tileR, tgt.c - unit.tileC) / MOVE_SPEED;
          const act = unit.skill.activations;
          st.flight = tgt;
          battle.releaseBlocked(unit);
          battle.addBuff(unit, { key: MOVE_KEY, duration: dur + 1, flags: { disarm: true, invulnerable: true, noHeal: true, noBlock: true }, tags: ['skill'] });
          battle.fx('dash', { x: unit.x, y: unit.y, id: unit.id, tx: tgt.c, ty: tgt.r, t: dur });
          battle.after(dur, () => {
            battle.removeBuff(unit, MOVE_KEY);
            if (!st || !skillOn(unit, S3) || unit.skill.activations !== act || !up(unit)) return;
            st.flight = null;
            const now = moveTarget(battle, unit);
            if (now) moveTo(battle, unit, now.r, now.c);
          }, { owner: unit });
        }, { owner: unit });
        // knocked out / withdrawn: the marker leaves and the anchored range is dropped (S3's onEnd runs before the
        // removal finishes; this covers a removal with no skill end)
        battle.on('death', (ctx) => {
          if (ctx.unit !== unit) return;
          dropMarker(battle);
          battle.setExtraRange(unit, null);
        }, { owner: unit });
      },
    };
  },
};
