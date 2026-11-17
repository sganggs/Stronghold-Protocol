// server/sim/content/kits/ops/op-oxi.js — 塔露拉 (char_4247_oxi) 自选 operator kit: 6★ 本源近卫 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill and both talents at every form (she has no module and no summons).
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4247_oxi, the DIY slot statuses): normal = E2 Lv1, skills at rank 4; elite = E2
// Lv60, rank 7 — tier 5 and tier 6 alike (no module). The record's potential (default 6, the owner's decision of
// 2026-10-08); both talents carry their lower-potential numbers.
// Sources: character_table / skill_table (zh_CN, CN 2.7.91, as built into backups.json); PRTS 塔露拉
// (https://prts.wiki/w/塔露拉, oldid 447323: the 备注 of 绝不妥协, S2 and S3); gamedata_const ba.overdrive 过载, ba.protect
// 庇护, ba.fear 恐惧; the client's battle data of the local CN 2.7.91 install — charpack char_4247_oxi (the attack switcher
// Attack / BuffedAttack, the talent abilities oxi_arcane and oxi_fire_break_aura, the common ability oxi_fire_field_lease
// and its tile listeners), the skill prefabs skchr_oxi_1 / 2 / 3 (battle/prefabs/[uc]skills), projectile_chr_oxi_s_3_heatwave
// ([uc]projectiles) and the buff templates oxi_t_1_arcane_manager / _arcane_stack / _attack_completed / _burning_damage,
// oxi_t_2_fire_break_detector / _trail, oxi_shared_fire_field_damage, oxi_s_2_guard_manager, oxi_s_3_wave
// (config/buff_template_holder; the event names: tools/local-extract/fx.py BUFF_EVENTS / ABILITY_EVENTS).
// - Trait (本源近卫) "能够阻挡两个敌人，可以造成元素伤害": block 2 (the form's stats), melee, ground only.
// - T1 绝不妥协 "攻击造成法术伤害；造成法术伤害时附带13%（+2%）的灼燃损伤；停止攻击3秒后法术和元素伤害逐渐提升（最高提升18%（+3%），
//   每次攻击时衰减）": her attacks deal arts damage (the kit trait); every arts damage instance of hers that lands (PRTS "于每次
//   成功造成伤害时产生灼燃损伤"; oxi_t_1_burning_damage: ON_AFTER_OUTPUT_DAMAGE, MAGICAL, not cancelled — her skills and 足迹
//   too) carries ep_damage_ratio × that damage as 灼燃损伤. 【怒火】 (PRTS 备注; oxi_t_1_arcane_manager / _arcane_stack /
//   _attack_completed): 0 at deployment, +1 every arcane_step_interval s up to round(arcane_max / arcane_step) (6), but not
//   while the arcane_idle_delay s marker of her deployment or of her last normal attack runs (the manager creates it at its
//   start, so the first layer comes 3 s after deployment); each normal attack (Attack / BuffedAttack, at its ON_SPELL_END —
//   never a skill's attack) takes one layer and restarts the marker. At the output of each arts or 元素伤害 instance of hers
//   (ON_OUTPUT_DAMAGE, DamageScale arcane_step per layer): ×(1 + arcane_step × layers) — PRTS "(100%+文本所述数值×【怒火层数】÷6)".
//   An element fill (元素损伤) is no HP damage and is not raised.
// - T2 我即火焰 "在场时，全场敌人灼燃损伤爆发后5秒内，于可通行地面留下持续4（+1）秒的“足迹”（最多25格），每0.3秒造成塔露拉攻击力15%
//   （+3%）的法术伤害" (no PRTS 备注): while she is on the field every enemy carries her detector (oxi_fire_break_aura, air units
//   too); at its 灼燃 burst (ON_BEFORE_EP_BREAK_START, FIRE — whoever filled the gauge) it gets her trail for TRAIL_DURATION s,
//   which leases the tile it stands on at once, at each change of its tile (ON_OWNER_ROOT_TILE_CHANGED) and every
//   field_interval s (the trail's ticks): the tiles it walks over (oxi_t_2_trail → RefreshTimedTileLease). A lease (the
//   footprint) lasts field_duration s from its latest refresh, on passable low ground only (the lease selector's passable /
//   height masks); with max_count tiles held a new tile is refused (_rejectNewWhenFull). A ground enemy standing on one of her
//   footprints gets her oxi_shared_fire_field_damage (one per 塔露拉 whatever the number of tiles): every field_interval s,
//   the first one interval after it came, while it still stands on one of them (oxi_fire_field_presence) it takes
//   field_atk_scale × her current ATK arts damage (持续伤害: attackType BUFF; precomputed — AdvancedApplyDamage
//   `_emitSourceOnCalculateDamage` false; none while it is 隐匿, 无法选中 or 无敌), and the buff lives FIELD_LIFETIME_RATIO
//   intervals past the last such tick. Her footprints, trails and those buffs end when she leaves the field.
// - S1 照霎白夜 (AUTO, data DEFAULT): her next attack hits every ground enemy on its target's tile (the skill's MeleeAttack
//   selector: grid (0, 0) around the target, ground, no target cap) for atk_scale × ATK arts and `fear` s 恐惧 each.
// - S2 阂断骤雪 (AUTO, maxChargeTime charges): never cast by the strategy (the prefab's NeverTrigger: kit trigger NEVER) —
//   her oxi_s_2_guard_manager (ON_TAKE_DAMAGE, priority GUARD_PRIORITY: an injury effect ahead of every other) casts it at
//   the first damage instance she takes while it is ready and its guard window (oxi_s_2_guard_window, skill_duration s) is
//   not running, when that instance is physical / arts / true (ANY_ATTACK; 元素伤害 left out [ASSUMED]), not 持续伤害
//   (attackType BUFF), not 环境伤害 (the engine's 'terrain' tag) and comes from a unit of the other side (PRTS 备注: 有来源,
//   not 无来源, not her side; the engine has no projectile source apart from the source), and not dodged (PRTS "且未被成功
//   闪避、且未被判定为未命中": a miss is cancelled before the injury pass; her 闪避 — dodgePhys / dodgeArts of her buffs that come
//   later in the pass — is rolled for that instance at the guard, with the pass's own roll and in its order, and not again
//   where those buffs come). If it is physical or arts that
//   very instance falls to damage_remaining_scale (a damage scale, not 庇护). The cast: the guard window; 庇护
//   damage_resistance held shelter_hold_duration s, then down to 0 at skill_duration s (PRTS; LinearDecayBuffToOwnerDuringAbility)
//   — the shared 庇护 (holdProtect, 同名效果取最高), one application per tick of the decay queued at once, so each takes over
//   as the stronger one before it ends; the instance that cast it is already past it and past every weaker 庇护 (PRTS:
//   "此时施加的庇护还不能参与本次伤害的处理…后续处理的其他庇护会因为存在减伤倍率更高的庇护而失效" — the replaced shared buff is no
//   longer on her when the injury pass reaches it); one layer of oxi_s_2_stack (ATK +atk, DEF +def per layer, max_stack_cnt
//   layers, stack_duration s, every gain refreshing it; at its end one layer goes and the time starts again — PRTS); while
//   she holds a layer her normal attacks hit up to her block count, the blocked first (BuffedAttack: the 强攻手 selector,
//   attack@buffed_attack_atk_scale). Then (deferred to the end of that damage instance) retaliate_atk_scale × ATK arts to
//   every enemy within RETALIATE_RADIUS of its centre — the damage source, else an enemy she blocks, else a ground enemy of
//   her 1-1 (PRTS: 隐匿 ignored throughout, the source and the area may be airborne) — none without a centre; each instance
//   heals her heal_ratio × the HP it removed (ON_AFTER_OUTPUT_DAMAGE, AssignDamageValueToBlackboard real delta).
// - S3 日冕重烈 (MANUAL, data DEFAULT, 36 s): ATK +atk; she stops attacking (the S3NoAttack mode) and channels: a volley of
//   簇火 at the start (ON_SPELL_ON), then every normal_interval (80 frames — PRTS "发射间隔固定为80帧", the prefab's 2.6667);
//   过载 (ba.overdrive "技能进行到一半时触发额外效果"): from half its duration a volley at once, then every overload_interval
//   (60 frames), overload_half_width instead of normal_half_width. A volley: one 簇火 per lane — the rows across her facing
//   (columns when she faces up / down) within the half width of her own, the window shifted inside the field at its edge
//   (_shiftLaneWindowAtMapEdge) — from the tile centre up to WAVE_MAX_BACK tiles behind her (the farthest inside the field,
//   PRTS "最远只会尝试在自身身后11格") in her facing at wave_speed, to wave_exit_distance tiles past the far edge (PRTS); the
//   field is the battle's `rect` [ASSUMED, as 赤刃明霄陈's wave]. The first enemy its collider (projectile_range, PRTS "碰撞半径
//   0.5": a collision test, foesInColliderRadius) touches (selectable, air too) makes it explode — heatwave_atk_scale × the
//   ATK cached at the volley (PRTS "始终采用缓存攻击力"), within range_radius of that enemy, air too: 元素伤害 to an enemy in its
//   灼燃 爆发冷却, else arts (普通伤害, applyWay RANGED, precomputed); an enemy the volley already damaged takes
//   ×same_wave_repeat_damage_scale (PRTS: the attack scale × 15 %). Only one 塔露拉 channels at a time (PRTS;
//   CheckOxiFireRainSlot): another's volleys fail. No volley while she cannot act (CheckCanUseAbility). The 簇火 in flight
//   outlive the skill and her (`_useProjectileContextWhenSourceInvalid`). "该技能可随时主动关闭": the mode closes no skill by
//   hand (PRTS 卫戍协议/帮助 技能操作; as 琳琅诗怀雅 S3 and 维什戴尔 S2) — it runs its full duration.
// [ASSUMED] where no source settles it:
// - S2's area radius: PRTS's 0.9, though the blackboard's ability_range_radius is 1 (the radius key of the client's
//   CircleRange selectors — the area's and the input-target validator's); the damage source needs no distance (PRTS names
//   none). A dodge that content holds as its own injury callback (not a 闪避 attribute) is not rolled ahead at the guard —
//   none reaches her in this mode. A sourced 元素伤害 does not cast it.
// - S3's explosion radius is the blackboard's range_radius (1.5; the projectile's ForEachTargetInRange holds a 0.5 default,
//   the collider's projectile_range); the 14号异常 units PRTS names (结晶, 废热喷口 …) are not in this mode; no volley on the
//   frame the skill ends; while she is stunned the duration runs on (CastSkillWithSuspendable's suspension is not modelled).
// - 我即火焰: every enemy carries the detector at once (the aura's 0.2 s refresh is not modelled); the damage buff that runs
//   out on the frame of a tick ends first; an enemy that comes back before then keeps its tick phase.
// - The skills' clips are not modelled: S2's area lands as its cast settles, S3's first volley comes at the cast.

import { num, talentBb, skillRec, up, holdProtect } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, enemyStealthed, sortEnemyTargets, tileKeyOf } from '../../../targeting.js';
import { bodyDist, bodyInKeys, bodyInRange } from '../../../body.js';
import { dirVec } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { hasHp, isHpLoss, damageAttackType, damageDodgeMode } from '../../../attack.js';
import { acquireTargets } from '../../../ai.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';

const S1 = 'skchr_oxi_1';
const S2 = 'skchr_oxi_2';
const S3 = 'skchr_oxi_3';
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
const AIR = Object.freeze({ canHitFly: true });
/** S2 备注 "范围法术伤害半径0.9" (PRTS). The blackboard's ability_range_radius (1) is the radius key of the skill's CircleRange selectors. */
const RETALIATE_RADIUS = 0.9;
/** oxi_s_2_guard_manager: ON_TAKE_DAMAGE at onEventPriority 1000 (PRTS "优先级+1000"). */
const GUARD_PRIORITY = 1000;
/** oxi_t_2_fire_break_detector → oxi_t_2_trail: its own blackboard `duration` 5 (the talent text "爆发后5秒内"; no talent key). */
const TRAIL_DURATION = 5;
/** oxi_fire_field_lease: fire_field_damage_lifetime = interval × fire_field_damage_lifetime_ratio (the charpack's default 2). */
const FIELD_LIFETIME_RATIO = 2;
/** oxi_s_3_wave: _maxBackDistance 11 (the skill blackboard has no wave_max_back_distance); PRTS "最远只会尝试在自身身后11格". */
const WAVE_MAX_BACK = 11;
/** projectile_chr_oxi_s_3_heatwave: _lifeTime 25 (`_forceReachedWhenTimeup`). */
const SHOT_LIFETIME = 25;
const GUARD_KEY = 'skill:oxi:guard';
const WINDOW_KEY = 'skill:oxi:guardWindow';
const STACK_KEY = 'skill:oxi:stack';
/** battle → the 塔露拉 channelling S3 (CheckOxiFireRainSlot: one at a time). */
const RAIN_SLOT = new WeakMap();

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileOf = (key) => [Math.floor(key / COLS), key % COLS];
/** S2 selects with 隐匿 ignored (PRTS; `_onlyIgnoreSomeOfTargetFreeCase`): a living enemy no 无法选中 or 沉睡 keeps out. */
const retaliable = (e) => !!e && e.alive && e.deployed && !e.hidden && e.side === 'enemy' && !e.s.flags.untargetable && !e.s.flags.sleep;
/** S3 is channelling on `u`. */
const raining = (u) => !!u && u.alive && !!u.skill && u.skill.active && u.skill.id === S3 && !!u.mem.oxiRain;

export default {
  char_4247_oxi: (bb, chess, def) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const ownGrid = def?.rangeGrid ?? chess?.rangeGrid ?? [[0, 0], [0, 1]];

    // ---- S2 阂断骤雪 -------------------------------------------------------------------------------------------------
    /** One oxi_s_2_stack layer count `n` for stack_duration s; at its end one layer goes and the time starts again. */
    const setStack = (battle, unit, n) => {
      const dur = num(b2.stack_duration);
      if (!(n > 0) || !(dur > 0)) { battle.removeBuff(unit, STACK_KEY); return; }
      battle.addBuff(unit, {
        key: STACK_KEY, duration: dur, stacks: n, maxStacks: n, mods: { atkPct: num(b2.atk), defPct: num(b2.def) }, tags: ['skill'],
        onExpire: ({ battle: b, unit: u, buff }) => { if (u.alive && buff.stacks > 1) setStack(b, u, buff.stacks - 1); },
      });
    };
    /** 庇护 damage_resistance for shelter_hold_duration s, then linearly to 0 at skill_duration s: one shared application per tick. */
    const shelter = (battle, unit) => {
      const v0 = num(b2.damage_resistance), dt = battle.dt;
      const total = Math.round(Math.min(num(b2.skill_duration), bbCap('skill_duration')) / dt);
      const hold = Math.min(total, Math.round(num(b2.shelter_hold_duration) / dt));
      if (!(v0 > 0) || !(total > 0)) return;
      // each application is in force through tick `m` after the cast and gone at the next one (its +0.5 tick)
      holdProtect(battle, unit, v0, (hold + 0.5) * dt, unit);
      for (let m = hold + 1; m < total; m++) holdProtect(battle, unit, (v0 * (total - m)) / (total - hold), (m + 0.5) * dt, unit);
    };
    /** S2's centre: the damage source, else an enemy she blocks, else a ground enemy of her 1-1 (隐匿 ignored). */
    const centreOf = (battle, unit, src) => {
      if (retaliable(src)) return src;
      const blocked = unit.blocking.filter((e) => retaliable(e) && !e.isFlying);
      if (blocked.length) return sortEnemyTargets(battle, unit, blocked, null)[0];
      const keys = new Set(absoluteRangeKeys(ownGrid, unit.tileR, unit.tileC, unit.dir, 0));
      const near = battle.enemies.filter((e) => retaliable(e) && !e.isFlying && bodyInRange(e, keys));
      return near.length ? sortEnemyTargets(battle, unit, near, null)[0] : null;
    };
    const retaliate = (battle, unit, src) => {
      if (!up(unit)) return;
      const centre = centreOf(battle, unit, src);
      if (!centre) return;
      const amount = unit.s.atk * num(b2.retaliate_atk_scale, 1), ratio = num(b2.heal_ratio);
      const foes = [centre, ...battle.enemiesInRadius(centre.x, centre.y, RETALIATE_RADIUS).filter((e) => e !== centre && retaliable(e))];
      battle.fx('blast', { x: centre.x, y: centre.y, r: RETALIATE_RADIUS, id: unit.id, element: 'burn', skill: 'oxi:retaliate' });
      for (const e of foes) {
        if (!e.alive) continue;
        const removed = battle.dealDamage({ source: unit, target: e, amount, type: 'arts', isSkill: true, applyWay: 'MELEE', tags: ['skill', 'oxi:retaliate'] });
        if (removed > 0 && ratio > 0 && up(unit)) battle.heal(unit, unit, removed * ratio, { self: true });
      }
    };

    // ---- S3 日冕重烈 -------------------------------------------------------------------------------------------------
    /** A volley of 簇火 (EmitDirectionalMapEdgeProjectileVolley); `half` = the lanes on each side of hers. */
    const volley = (battle, unit, half) => {
      const holder = RAIN_SLOT.get(battle);
      if (holder && holder !== unit && raining(holder)) return;
      RAIN_SLOT.set(battle, unit);
      if (!unit.canAct) return;
      const [fr, fc] = dirVec(unit.dir), R = battle.rect;
      const across = fr === 0;   // facing left / right: the lanes are rows
      const lo = across ? R.r0 : R.c0, hi = across ? R.r1 : R.c1, mine = across ? unit.tileR : unit.tileC;
      let a = mine - half, b = mine + half;
      if (hi - lo < b - a) { a = lo; b = hi; } else if (a < lo) { b += lo - a; a = lo; } else if (b > hi) { a -= b - hi; b = hi; }
      const sign = across ? fc : fr, at = across ? unit.tileC : unit.tileR;
      const back = sign > 0 ? (across ? R.c0 : R.r0) : (across ? R.c1 : R.r1), edge = sign > 0 ? (across ? R.c1 : R.r1) : (across ? R.c0 : R.r0);
      const from = sign > 0 ? Math.max(back, at - WAVE_MAX_BACK) : Math.min(back, at + WAVE_MAX_BACK);
      const to = edge + sign * num(b3.wave_exit_distance);
      const wave = { atk: unit.s.atk, hit: new Set() };
      const delay = num(b3.random_birth_delay);
      const shots = unit.mem.oxiShots ?? (unit.mem.oxiShots = []);
      for (let lane = a; lane <= b; lane++) {
        shots.push({ x: across ? from : lane, y: across ? lane : from, dx: across ? sign : 0, dy: across ? 0 : sign,
          left: Math.abs(to - from), age: 0, wait: delay > 0 ? battle.rng.range(0, delay) : 0, wave });
      }
      battle.fx('heatwave', { x: unit.x, y: unit.y, dir: unit.dir, n: b - a + 1, id: unit.id, skill: 'oxi:heatwave' });
    };
    /** A 簇火 meets `target`: the explosion around it (cached ATK; 元素伤害 in a 灼燃 爆发冷却; ×same_wave_repeat on a repeat). */
    const explode = (battle, unit, s, target) => {
      const r = num(b3.range_radius), base = num(b3.heatwave_atk_scale), again = num(b3.same_wave_repeat_damage_scale, 1);
      const foes = [target, ...battle.foesInRadius(target.x, target.y, r).filter((e) => e !== target && canTargetEnemy(unit, e, AIR))];
      battle.fx('blast', { x: target.x, y: target.y, r, id: unit.id, element: 'burn', skill: 'oxi:heatwave' });
      for (const e of foes) {
        if (!e.alive) continue;
        const burst = !!e.findBuff('burnBurst');
        battle.dealDamage({ source: unit, target: e, amount: s.wave.atk * base * (s.wave.hit.has(e) ? again : 1),
          type: burst ? 'elemental' : 'arts', ...(burst ? { element: 'burn' } : null), isSkill: true, applyWay: 'RANGED',
          calculation: 'precomputed', tags: ['skill', 'oxi:heatwave'] });
        s.wave.hit.add(e);
      }
    };
    const flyShots = (battle, unit, dt) => {
      const shots = unit.mem.oxiShots;
      if (!shots || !shots.length) return;
      const speed = num(b3.wave_speed), reach = num(b3.projectile_range);
      for (const s of shots) {
        if (s.done) continue;
        if (s.wait > 0) { s.wait -= dt; continue; }
        const step = Math.min(speed * dt, s.left);
        s.x += s.dx * step; s.y += s.dy * step; s.left -= step; s.age += dt;
        let hit = null, best = Infinity;
        for (const e of battle.foesInColliderRadius(s.x, s.y, reach)) {
          if (!canTargetEnemy(unit, e, AIR)) continue;
          const d = bodyDist(e, s.x, s.y);
          if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && e.spawnSeq < hit.spawnSeq)) { best = d; hit = e; }
        }
        if (hit) { s.done = true; explode(battle, unit, s, hit); } else if (s.left <= 1e-9 || s.age >= SHOT_LIFETIME - 1e-9) s.done = true;
      }
      unit.mem.oxiShots = unit.mem.oxiShots.filter((s) => !s.done);
    };

    return {
      trait: { dmgType: 'arts' },   // 绝不妥协 "攻击造成法术伤害"
      skills: {
        [S1]: {
          kind: 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1), dmgType: 'arts',
            onEachHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy') battle.applyStatus(target, 'fear', { duration: num(b1.fear), source: unit });
            },
          },
        },
        [S2]: {
          kind: 'charges', trigger: 'NEVER',   // NeverTrigger: the guard manager casts it (install)
          onStart({ battle, unit }) {
            const cast = unit.mem.oxiS2Cast;
            battle.addBuff(unit, { key: WINDOW_KEY, duration: num(b2.skill_duration), tags: ['skill'] });
            shelter(battle, unit);
            setStack(battle, unit, Math.min(Math.max(1, Math.floor(num(b2.max_stack_cnt, 1))), (unit.findBuff(STACK_KEY)?.stacks ?? 0) + 1));
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
            const src = cast ? cast.source : null;
            if (cast && cast.defer) cast.defer(() => retaliate(battle, unit, src));
            else retaliate(battle, unit, src);
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          attack: { noAttack: true },
          onStart({ battle, unit, skill }) {
            const dt = battle.dt;
            unit.mem.oxiRain = {
              n: 0, next: 0, over: false, total: Math.round(skill.duration / dt), half: Math.round(skill.duration / 2 / dt),
              normal: Math.max(1, Math.round(num(b3.normal_interval) / dt)), overload: Math.max(1, Math.round(num(b3.overload_interval) / dt)),
            };
            volley(battle, unit, Math.max(0, Math.floor(num(b3.normal_half_width))));
            unit.mem.oxiRain.next = unit.mem.oxiRain.normal;
          },
          onTick({ battle, unit }) {
            const r = unit.mem.oxiRain;
            if (!r) return;
            r.n++;
            if (!r.over && r.n >= r.half) {   // 过载: the overload volleys replace the normal ones at once
              r.over = true;
              r.next = r.n;
              battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
            }
            if (r.n < r.next || r.n >= r.total) return;
            volley(battle, unit, Math.max(0, Math.floor(num(r.over ? b3.overload_half_width : b3.normal_half_width))));
            r.next = r.n + (r.over ? r.overload : r.normal);
          },
          onEnd({ battle, unit }) {
            unit.mem.oxiRain = null;
            if (RAIN_SLOT.get(battle) === unit) RAIN_SLOT.delete(battle);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 绝不妥协: 灼燃损伤 on her arts damage; 【怒火】
          const ep = num(t0.ep_damage_ratio), step = num(t0.arcane_step);
          const max = step > 0 ? Math.round(Math.abs(num(t0.arcane_max) / step)) : 0;
          const every = num(t0.arcane_step_interval), idle = num(t0.arcane_idle_delay);
          const rage = () => unit.mem.oxiRage ?? (unit.mem.oxiRage = { n: 0, quietTo: 0, next: Infinity });
          const deployed = () => { const r = rage(); r.n = 0; r.quietTo = battle.time + idle; r.next = every > 0 ? battle.time + every : Infinity; };
          if (up(unit)) deployed();
          battle.on('deploy', (c) => { if (c.unit === unit) deployed(); }, { owner: unit });
          battle.on('tick', () => {
            if (!up(unit)) return;
            const r = rage();
            let guard = 0;
            while (battle.time >= r.next - 1e-9 && guard++ < 8) { // loop-cap: one step per arcane_step_interval, 8 per tick
              r.next += every;
              if (battle.time >= r.quietTo - 1e-9 && r.n < max) r.n++;
            }
          }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || c.isSkill) return;
            const r = rage();
            r.n = Math.max(0, r.n - 1);
            r.quietTo = battle.time + idle;
          }, { owner: unit });
          // (both on her buffs: none for a 簇火 still in flight once she left the field)
          battle.on('damageOutput', (c) => {
            if (c.source !== unit || !up(unit) || !c.dmg || (c.dmg.type !== 'arts' && c.dmg.type !== 'elemental')) return;
            const n = unit.mem.oxiRage?.n ?? 0;
            if (n > 0 && step > 0) c.amount *= 1 + step * n;
          }, { owner: unit });
          if (!(ep > 0)) return;
          battle.on('damaged', (c) => {
            const t = c.target;
            if (c.source !== unit || !up(unit) || c.type !== 'arts' || !(c.amount > 0) || isHpLoss(c.dmg) || !t || t.side !== 'enemy' || !hasHp(t)) return;
            battle.dealElementDamage({ source: unit, target: t, element: 'burn', amount: c.amount * ep, tags: ['talent', 'oxi:burn'] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 我即火焰: footprints after 灼燃 bursts
          const dur = num(t1.field_duration), every = num(t1.field_interval), scale = num(t1.field_atk_scale);
          const cap = Math.max(0, Math.floor(num(t1.max_count))), life = every * FIELD_LIFETIME_RATIO;
          if (!(dur > 0) || !(every > 0)) return;
          const field = () => unit.mem.oxiField ?? (unit.mem.oxiField = { tiles: new Map(), trails: new Map(), burning: new Map() });
          /** RefreshTimedTileLease: the tile `e` stands on, renewed for field_duration s; a new one only below max_count. */
          const lease = (f, e) => {
            const key = tileKeyOf(e);
            if (key < 0) return;
            const [r, c] = tileOf(key);
            if (!battle.grid.groundPassable(r, c, true) || !battle.grid.isLow(r, c)) return;
            const fresh = !f.tiles.has(key);
            if (fresh && f.tiles.size >= cap) return;
            f.tiles.set(key, battle.time + dur);
            if (fresh) battle.fx('zone', { x: c, y: r, radius: 0.5, dur, id: unit.id, skill: 'oxi:footprint' });
          };
          /** Her footprints, trails and their ticks end with the deployment that made them (the abilities detach). */
          const clear = () => { const f = unit.mem.oxiField; if (f) { f.tiles.clear(); f.trails.clear(); f.burning.clear(); } };
          // every deployment starts without them — a revive inside the knock-out's `death` hooks (命结之秘, M3茧甲)
          // comes back before her next tick
          battle.on('deploy', (c) => { if (c.unit === unit) clear(); }, { owner: unit });
          battle.on('elementBurst', (c) => {
            const e = c.target;
            if (c.element !== 'burn' || !e || e.side !== 'enemy' || !up(unit)) return;
            const f = field();
            f.trails.set(e, { until: battle.time + TRAIL_DURATION, tile: tileKeyOf(e), next: battle.time + every });
            lease(f, e);
          }, { owner: unit });
          battle.on('tick', () => {
            const f = unit.mem.oxiField;
            if (!f) return;
            if (!up(unit)) { clear(); return; }   // a knock-out or retreat with no revive
            const now = battle.time;
            for (const [key, until] of f.tiles) if (now >= until - 1e-9) f.tiles.delete(key);
            for (const [e, tr] of f.trails) {
              if (!e.alive || now >= tr.until - 1e-9) { f.trails.delete(e); continue; }
              if (e.hidden) continue;
              const key = tileKeyOf(e);
              if (key !== tr.tile) { tr.tile = key; lease(f, e); }
              let guard = 0;
              while (now >= tr.next - 1e-9 && guard++ < 8) { tr.next += every; lease(f, e); } // loop-cap: field_interval steps, 8 per tick
            }
            for (const [e, st] of f.burning) if (!e.alive || now >= st.until - 1e-9) f.burning.delete(e);
            if (!f.tiles.size && !f.burning.size) return;
            for (const e of battle.enemies) {
              if (!e.alive || !e.deployed || e.hidden || e.isFlying) continue;
              const on = f.tiles.size > 0 && bodyInKeys(e, f.tiles);
              const st = f.burning.get(e);
              if (!st) { if (on) f.burning.set(e, { next: now + every, until: now + life }); continue; }
              if (now < st.next - 1e-9) continue;
              st.next += every;
              if (!on) continue;
              st.until = now + life;
              const fl = e.s.flags;
              if (fl.untargetable || fl.invulnerable || (fl.stealth && enemyStealthed(e))) continue;
              battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'arts', attackType: 'BUFF', applyWay: 'NONE',
                calculation: 'precomputed', tags: ['talent', 'dot', 'oxi:footprint'] });
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const sid = unit.skill?.id;
        // S1: the next attack takes every ground enemy on its target's tile
        if (sid === S1) {
          battle.on('beforeAttack', (c) => {
            const sk = unit.skill;
            if (c.attacker !== unit || !c.isSkill || !sk || sk.id !== S1 || !sk.pending) return;
            const main = c.targets.find((t) => t && t.alive && t.side === 'enemy');
            const key = main ? tileKeyOf(main) : -1;
            if (key < 0) return;
            c.targets = [main, ...battle.enemiesOnTiles([key], unit, GROUND).filter((e) => e !== main)];
          }, { owner: unit });
        }
        if (sid === S2) {
          // oxi_s_2_guard_manager: held while S2 is her skill (an injury effect at priority 1000, ahead of every other)
          battle.addBuff(unit, {
            key: GUARD_KEY, persist: true, allowDead: true, injuryPriority: GUARD_PRIORITY, tags: ['skill'],
            injury(ev) {
              const sk = unit.skill, d = ev.dmg, src = ev.source, t = ev.type;
              if (!sk || sk.id !== S2 || !up(unit) || !d || !(t === 'phys' || t === 'arts' || t === 'true')) return;
              if (damageAttackType(d) === 'BUFF' || d.tags?.includes('terrain') || !src || d.sourceless || src.side === unit.side) return;
              if (unit.findBuff(WINDOW_KEY) || !sk.ready || !unit.canAct || unit.s.flags.silence) return;
              // PRTS "且未被成功闪避": her 闪避 (dodgePhys / dodgeArts of her buffs that come later in this pass) is rolled for
              // this hit now, with the pass's own roll (ev.dodge: battle.rng, the MISS, the dodge hook) in the pass's order —
              // a dodged hit casts nothing; one that is not dodged is not rolled again where those buffs come
              const key = t === 'phys' ? 'dodgePhys' : t === 'arts' ? 'dodgeArts' : null, own = ev.buff;
              const later = (b) => (b.injuryPriority ?? 0) < own.injuryPriority || ((b.injuryPriority ?? 0) === own.injuryPriority && b.seq > own.seq);
              const held = key ? unit.buffs.filter((b) => b !== own && b.mods && b.mods[key] > 0 && later(b))
                .sort((a, b) => (b.injuryPriority ?? 0) - (a.injuryPriority ?? 0) || a.seq - b.seq) : [];
              const cancels = damageDodgeMode(d) !== 'uncancellable';
              for (const b of held) {
                for (let i = 0; i < b.stacks; i++) {   // one roll per stack until one succeeds (attack/effects.js)
                  if (!ev.dodge(b.mods[key])) continue;
                  if (cancels) return;
                  break;
                }
              }
              for (const b of held) {
                const mods = b.mods, once = { ...mods, [key]: 0 };
                b.mods = once;
                ev.defer(() => { if (b.mods === once) b.mods = mods; unit.markDirty(); });
              }
              unit.mem.oxiS2Cast = { source: src, defer: ev.defer };   // read by the cast (onStart)
              const cast = sk.activate('TAKE_DAMAGE');
              unit.mem.oxiS2Cast = null;
              if (cast && (t === 'phys' || t === 'arts')) ev.amount *= num(b2.damage_remaining_scale, 1);
            },
          });
          // BuffedAttack: while she holds a layer, her normal attacks hit up to her block count, the blocked first
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || c.isSkill || !c.profile || !unit.findBuff(STACK_KEY)) return;
            const all = acquireTargets(battle, unit, { ...c.profile, hitAllBlocked: true });
            if (all.length) c.targets = all;
          }, { owner: unit });
          const buffed = num(b2['attack@buffed_attack_atk_scale'], 1);
          if (buffed !== 1) {
            battle.on('hit', (c) => {
              if (c.source === unit && c.dmg && c.dmg.isAttack && !c.dmg.isSkill && unit.findBuff(STACK_KEY)) c.dmg.amount *= buffed;
            }, { owner: unit });
          }
        }
        // S3: the 簇火 in flight (they outlive the skill and her)
        if (sid === S3) battle.on('tick', ({ dt }) => flyShots(battle, unit, dt), { owner: unit });
      },
    };
  },
};
