// server/sim/content/kits/ops/op-hsgma2.js — 斩业星熊 (char_1044_hsgma2) 自选 operator kit: 6★ 驭法铁卫 (重装), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1044_hsgma2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, AST-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), gamedata_const
// ba.berserk 坚忍 ("根据已损失的生命值获得相应比例的属性加成，损失一定比例时达最大加成") and ba.sluggish 停顿, PRTS 斩业星熊 (业火 备注:
// 负生命值 — "期间持有禁疗，一切生命值变动将先计入负生命值来抵消/增加负生命值…只有负生命值达到上限时才会被正常击倒…负生命值与真实生命值
// 无关", "生命恢复的提供方式为增加自身的“生命回复速度（百分比）”属性，不受治疗加成和禁疗影响", "需成功受到伤害，生命恢复效果才会失效并
// 重新计时"; S1 备注 "反伤效果会直接选中伤害来源，但仅对阵营为敌方的来源造成伤害"; S2 备注 "治疗效果无视自身的禁疗，计算治疗量时以目标
// 受伤前后的生命值差的绝对值为准", "投出的盾牌以自身前方1.2格为起点，逆时针旋转365°，角速度90°/s，碰撞半径1.0，碰撞范围内存在可选目标时
// 速度-80%", "技能持续至盾牌旋转365°并收回时结束"; S3 备注 "技能期间攻击可对空", 临死模式 — 阻回 / 沉默 / 不死, allies' 不死 and the
// lethal excess as her 流失, the forced exit, "若携带X模组，则X模组的“造成额外伤害”效果依然生效"; AST-X 备注 — the extra damage's
// conditions "①此为普通攻击或普通攻击附带的伤害；②伤害来源于斩业星熊自身；③不为本模组特性的伤害…伤害为法术附加伤害", "仅对敌方
// 单位反弹伤害，伤害为法术普通伤害"), PRTS 卫戍协议/帮助 技能策略 (her S3 row "于技能持续时间过半后…关闭技能（进入其技能效果的
// 临死模式）" added in 上半, REMOVED with 下半; "通常不会自动关闭技能").
// - Trait (驭法铁卫) "技能开启时普通攻击会造成法术伤害": physical attacks while no skill runs (the kit's trait dmgType — the
//   data's 'phys' too since 0.2.0 WE2 — build-data classifyAttack) and arts while one runs (every skill's attack override); block 3, ground-only
//   melee on her 1-1. Module AST-X 无迹 adds "且攻击和受到攻击时对目标额外造成10％攻击力的法术伤害" (trait bb atk_scale): every
//   damage instance of her normal attacks (skill attacks included; not the shield, a counter or the module's own damage)
//   is followed by precomputed atk_scale × ATK arts ADDITION damage on that enemy (ordinary dodge), and every enemy damage instance she takes
//   returns atk_scale × ATK arts (普通伤害) to its source (tier1 byEnemyDamage). Both module branches require an active skill or 临死模式, as the native
//   hsgma2_e_003_tr_output/take templates explicitly check.
// - T1 业火 "生命降至0时进入“我执”…": a lethal damage instance leaves her on the field in 我执 instead (the damage past her
//   HP opens the negative pool — the engine keeps her at its 1-HP floor for the official 0); in 我执 every later damage
//   instance goes to the pool (no HP loss; it still counts as damage taken: 受击回复 SP, counters) until the pool would
//   reach max_minus_hp_ratio × max HP — that blow knocks her out as usual (unless a 不死 holds her); she holds 禁疗 (flags
//   noHeal + healFree, the status 'healFree'); after [heal].interval s without a damage instance landing she gets the
//   生命回复速度（百分比） attribute [heal].hp_recovery_per_sec_by_max_hp_ratio (an hpRegenRatio buff — not 治疗: 禁疗 does
//   not stop it, no 治疗加成 scales it); whatever raises her HP above the floor (that regeneration, S2's heal that ignores
//   禁疗) clears the pool first, and she leaves 我执 once it is empty. A 流失 that reaches 0 counts whole into the pool
//   [ASSUMED: the engine reports no HP before a loss].
// - T2 鬼之架势 "在场时，自身获得最高+50法术抗性和35%攻击力的坚忍（损失70%生命值时达到最大加成）": RES +min_magic_resistance and ATK
//   +min_atk scaled linearly by the HP lost from max_hp_ratio down to min_hp_ratio (坚忍), re-read every tick; in 我执 at
//   its maximum. AST-X stage 3: the maximum at 50 % lost (min_hp_ratio 0.5) and "达到最大加成时，攻击力额外+15％" (atk).
// - S1 恶业苦果 (AUTO, 受击回复 SP, 持续时间无限 — a toggle): ATK +atk, DEF +def, arts attacks; every enemy damage instance
//   she takes deals atk_scale × ATK arts to its source (a direct pick of the damage source, enemies only). A self buff: the owner's
//   AUTO rule fires it as soon as its SP is full (`trigger: 'SP_FULL'`, as 引星棘刺 S1 — kits/README.md checklist 5).
// - S2 无始无明 (AUTO, attack SP; data DEFAULT): the cast replaces the attack about to be made — the shield throw, three hits
//   of attack@atk_scale × ATK arts on every enemy she blocks (none blocked: her target [ASSUMED]); then the shield circles
//   her: from 1.2 tiles ahead, counter-clockwise 365° at 90°/s, ×0.2 while a targetable ground enemy [ASSUMED: no 对空
//   note, unlike S3] is within 1.0 of it; every `interval` s from the throw [ASSUMED] each such enemy takes 停顿 `sluggish`
//   s and shield_atk_scale × ATK arts, and she heals heal_ratio × the HP it lost (ignoring her 禁疗). The skill runs until
//   the turn is done (its return taken as instant [ASSUMED]): no SP meanwhile, and her normal attacks of the flight are arts.
// - S3 地狱变相 (MANUAL; data ACTIVE_RANGE on the running x-2 — the owner's rule over the 重装 exception, rawRule
//   TAKE_DAMAGE): `duration` s — range x-2, max HP +max_hp, ATK +atk, two hits on up to attack@max_target enemies, air units
//   too (PRTS 备注), arts. 主动关闭 (a close: `skill.end('manual')`) starts the 临死模式 for before_dead_duration s: the
//   skill's bonuses and range stay, four hits, 阻回 + 沉默, 不死 (her negative pool never knocks her out); every other allied
//   operator on her range holds 不死 and the part of a damage instance past its HP becomes her 流失 (a 流失 it takes is not
//   passed on); then she leaves the field (a retreat with the death animation, as 史尔特尔's 余烬; the official partial DP
//   refund of a withdrawal is not modelled — no retreat in the sim refunds DP). No strategy of this mode closes it: PRTS
//   帮助 lists the 上半 row that did as removed in 下半, so in a fight the skill simply runs its `duration`.

import { num, talentBb, traitBb, skillRec, up, byEnemyDamage } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { bodyInRadius } from '../../../body.js';
import { hasHp, damageAttackType } from '../../../attack.js';
import { COLS } from '../../../constants.js';
import { sin, cos, atan2 } from '../../../detmath.js';

const S1 = 'skchr_hsgma2_1';
const S2 = 'skchr_hsgma2_2';
const S3 = 'skchr_hsgma2_3';
/** S2's shield (PRTS 备注): start 1.2 tiles ahead, 365° counter-clockwise at 90°/s, collision radius 1.0, −80 % near a target. */
const SHIELD_START = 1.2;
const SHIELD_TURN = 365;
const SHIELD_SPEED = 90;
const SHIELD_RADIUS = 1.0;
const SHIELD_SLOW = 0.8;
/** An engine cap on S2's run (the shield's turn ends it long before: 365° at 18°/s takes 20.3 s). */
const S2_CAP = 60;
/** S3's x-2 when the data carries no grid. */
const X2 = Object.freeze([[2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -2], [0, -1], [0, 0], [0, 1],
  [0, 2], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1]]);
const GROUND = Object.freeze({ canHitFly: false });
const EGO = 'talent:hsgma2:ego';
const EGO_REGEN = 'talent:hsgma2:egoRegen';
const BERSERK = 'talent:hsgma2:berserk';
const DYING = 'skill:hsgma2:dying';
const ASTX = 'hsgma2:astx';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default {
  char_1044_hsgma2: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const throwParts = { hits: 3, atkScale: num(b2['attack@atk_scale'], 1), hitAllBlocked: true };
    // this unit's attack overrides (the kit is built per unit): S2's throw turns into plain arts attacks after it lands,
    // S3's two hits become four in the 临死模式
    const s2Attack = { dmgType: 'arts' };
    const s3Attack = { dmgType: 'arts', hits: 2 };
    const plainS2 = () => { delete s2Attack.hits; delete s2Attack.atkScale; delete s2Attack.hitAllBlocked; };

    /** S2: the shield's centre after `turned` degrees (row 0 is the bottom row: counter-clockwise = a growing angle). */
    const shieldAt = (unit, sh) => {
      const a = sh.a0 + (sh.turned * Math.PI) / 180;
      return { x: unit.x + SHIELD_START * cos(a), y: unit.y + SHIELD_START * sin(a) };
    };
    const touching = (battle, unit, p) => battle.enemies.filter((e) => canTargetEnemy(unit, e, GROUND) && bodyInRadius(e, p.x, p.y, SHIELD_RADIUS));
    /** S2: one shield pulse — 停顿, the arts hit, and her heal of heal_ratio × the HP it removed (ignoring her 禁疗). */
    const shieldPulse = (battle, unit, p) => {
      for (const e of touching(battle, unit, p)) {
        battle.applyStatus(e, 'sluggish', { duration: num(b2.sluggish, 1), source: unit });
        if (!e.alive) continue;
        const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.shield_atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'hsgma2:shield'] });
        if (dealt > 0 && unit.alive) battle.heal(unit, unit, dealt * num(b2.heal_ratio), { self: true, ignoreHealFree: true });
        battle.fx('strike', { x: p.x, y: p.y, id: unit.id, skill: 'hsgma2:shield' });
      }
    };

    return {
      trait: { dmgType: 'phys' },
      skills: {
        [S1]: {
          kind: 'toggle', trigger: { rule: 'SP_FULL' },
          mods: nz({ atkPct: num(b1.atk), defPct: num(b1.def) }),
          attack: { dmgType: 'arts' },
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'hsgma2:karma', tags: ['skill'], observeInjury(c) {
              const src = c.source;
              if (!unit.alive || !byEnemyDamage(c) || !src.alive) return;
              battle.dealDamage({ source: unit, target: src, amount: unit.s.atk * num(b1.atk_scale), type: 'arts',
                attackType: 'NORMAL', applyWay: 'NONE', calculation: 'precomputed',
                isSkill: true, ignoreSelect: true, tags: ['skill', 'counter'] });
              battle.fx('counter', { x: src.x, y: src.y, id: unit.id });
            } });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'hsgma2:karma'); },
        },
        [S2]: {
          kind: 'duration', duration: S2_CAP,
          attack: s2Attack,
          onStart({ unit }) { Object.assign(s2Attack, throwParts); unit.mem.hsShield = null; },
          onAttack({ battle, unit }) {
            if (!('hits' in s2Attack)) return;
            plainS2(); // the throw was this attack: the shield flies from now on
            const [fr, fc] = unit.fwd;
            unit.mem.hsShield = { a0: atan2(fr, fc), turned: 0, acc: 0 };
            battle.fx('zone', { x: unit.x, y: unit.y, radius: SHIELD_START + SHIELD_RADIUS, dur: SHIELD_TURN / SHIELD_SPEED, id: unit.id, skill: 'hsgma2:shield' });
            shieldPulse(battle, unit, shieldAt(unit, unit.mem.hsShield));
          },
          onTick({ battle, unit, skill, dt }) {
            const sh = unit.mem.hsShield;
            if (!sh) return;
            const iv = Math.max(0.05, num(b2.interval, 0.5));
            sh.acc += dt;
            while (sh.acc + 1e-9 >= iv && unit.mem.hsShield === sh) { sh.acc -= iv; shieldPulse(battle, unit, shieldAt(unit, sh)); } // loop-cap: interval floored before the loop
            if (unit.mem.hsShield !== sh) return;
            const slowed = touching(battle, unit, shieldAt(unit, sh)).length > 0;
            sh.turned += SHIELD_SPEED * (slowed ? 1 - SHIELD_SLOW : 1) * dt;
            if (sh.turned >= SHIELD_TURN - 1e-9) skill.end('shield');
          },
          onEnd({ unit }) { unit.mem.hsShield = null; plainS2(); },
        },
        [S3]: {
          kind: 'duration',
          mods: nz({ hpPct: num(b3.max_hp), atkPct: num(b3.atk) }),
          targeting: { rangeGrid: skillRec(chess, S3)?.rangeGrid ?? X2, maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 1))), canHitFly: true },
          attack: s3Attack,
          onStart({ unit }) { s3Attack.hits = 2; unit.mem.hsDying = null; },
          onEnd({ battle, unit, skill, reason }) {
            const dying = unit.mem.hsDying;
            if (!dying && reason === 'manual' && unit.alive && unit.deployed) {
              // 主动关闭 ⇒ 临死模式: the skill keeps running (its bonuses, range and override stay; no skillStart — it is
              // no new cast) for before_dead_duration s with four hits, 阻回 + 沉默, and 不死 (the fatal hooks below)
              const dur = num(b3.before_dead_duration, 11);
              unit.mem.hsDying = { seq: unit.deploySeq };
              s3Attack.hits = 4;
              skill.active = true;
              skill.timeLeft = dur;
              battle.addBuff(unit, { key: DYING, duration: dur, flags: { noSp: true, silence: true }, visible: true, tags: ['skill'] });
              battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
              return;
            }
            if (!dying) return;
            unit.mem.hsDying = null;
            s3Attack.hits = 2;
            battle.removeBuff(unit, DYING);
            // "11秒后强制退出战场" (视为撤回干员)
            if (reason === 'duration' && unit.alive && unit.deployed) battle.retreat(unit, { reason: 'retreat', dying: true });
          },
        },
      },
      talents: [
        { install(battle, unit) { // 业火: 我执 — the negative pool, 禁疗, the quiet-time regeneration
          const capOf = () => num(t0.max_minus_hp_ratio, 2) * unit.s.maxHp;
          const quiet = num(t0['hsgma2_t_1[heal].interval'], 5);
          const regen = num(t0['hsgma2_t_1[heal].hp_recovery_per_sec_by_max_hp_ratio']);
          // the pool as a share of its cap, read when a snapshot is taken (b.snap `neg`, snapshot.js negView): the green HP bar
          // sits on the 1-HP floor in 我执, so the client draws the pool as the red bar — display only
          unit.negFill = () => (unit.mem.hsEgo && unit.mem.hsEgo.pool > 0 ? unit.mem.hsEgo.pool / Math.max(1e-9, capOf()) : 0);
          const enter = (pool) => {
            unit.mem.hsEgo = { pool: Math.max(0, pool), lastHurt: battle.time };
            battle.addBuff(unit, { key: EGO, status: 'healFree', flags: { noHeal: true, healFree: true }, tags: ['talent'] });
            battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id, talent: 'hsgma2:ego' });
          };
          const leave = () => {
            unit.mem.hsEgo = null;
            battle.removeBuff(unit, EGO);
            battle.removeBuff(unit, EGO_REGEN);
          };
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.hsOverflow = false; leave(); } }, { owner: unit });
          // a damage instance (after the shields): into the pool while in 我执, or the lethal one opens it
          battle.on('hpDamage', (c) => {
            if (c.target !== unit || !unit.alive) return;
            const ego = unit.mem.hsEgo;
            if (ego) {
              ego.lastHurt = battle.time;
              if (ego.pool + c.amount < capOf()) { ego.pool += c.amount; c.amount = 0; } else unit.mem.hsOverflow = true;
              return;
            }
            if (c.amount < unit.hp) return;
            const over = c.amount - unit.hp;
            if (over < capOf()) { c.amount = Math.max(0, unit.hp - 1); enter(over); } else unit.mem.hsOverflow = true;
          }, { owner: unit, priority: -50 });
          // HP reaching 0 anyway: the 临死模式's 不死 holds her; a full pool knocks her out; a 流失 goes to the pool
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented) return;
            const overflow = !!unit.mem.hsOverflow;
            unit.mem.hsOverflow = false;
            const ego = unit.mem.hsEgo;
            if (unit.mem.hsDying) {
              c.prevented = true;
              if (ego) ego.pool = Math.min(capOf(), ego.pool + c.amount); else enter(Math.min(capOf(), c.amount));
              return;
            }
            if (overflow) return;
            const pool = (ego ? ego.pool : 0) + c.amount;
            if (pool >= capOf()) return;
            c.prevented = true;
            if (ego) ego.pool = pool; else enter(pool);
          }, { owner: unit, priority: -40 });
          battle.on('tick', () => {
            unit.mem.hsOverflow = false;
            const ego = unit.mem.hsEgo;
            if (!ego) return;
            if (!up(unit)) { leave(); return; }
            // HP above the 1-HP floor (her regeneration, a heal that ignores 禁疗) clears the pool first
            const surplus = unit.hp - 1;
            if (surplus > 0 && ego.pool > 0) { const take = Math.min(surplus, ego.pool); ego.pool -= take; unit.hp -= take; }
            if (!(ego.pool > 1e-9)) { leave(); return; }
            const want = regen > 0 && battle.time - ego.lastHurt >= quiet - 1e-9;
            const has = !!unit.findBuff(EGO_REGEN);
            if (want && !has) battle.addBuff(unit, { key: EGO_REGEN, mods: { hpRegenRatio: regen }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, EGO_REGEN);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 鬼之架势: 坚忍 RES / ATK by the HP lost; AST-X stage 3: ATK +atk more at the maximum
          const hi = num(t1.max_hp_ratio, 1), lo = num(t1.min_hp_ratio, 0.3);
          const res0 = num(t1.max_magic_resistance), res1 = num(t1.min_magic_resistance);
          const atk0 = num(t1.max_atk), atk1 = num(t1.min_atk), extra = num(t1.atk);
          if (!(hi > lo) || !(res0 || res1 || atk0 || atk1)) return;
          battle.on('tick', () => {
            const cur = unit.findBuff(BERSERK);
            if (!up(unit)) { if (cur) battle.removeBuff(unit, BERSERK); return; }
            const f = clamp01((hi - unit.hpRatio) / (hi - lo));
            if (cur && Math.abs((cur.data?.f ?? -1) - f) < 1e-4) return;
            const mods = nz({ resFlat: res0 + (res1 - res0) * f, atkPct: atk0 + (atk1 - atk0) * f + (f >= 1 - 1e-9 ? extra : 0) });
            if (!Object.keys(mods).length) { if (cur) battle.removeBuff(unit, BERSERK); return; }
            battle.addBuff(unit, { key: BERSERK, mods, data: { f }, tags: ['talent'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S3 attacks air as well: its expanded auto-cast area must not inherit the inactive ground-only profile.
        if (unit.skill?.id === S3) unit.skill.addTriggerRange(() => [{
          keys: absoluteRangeKeys(skillRec(chess, S3)?.rangeGrid ?? X2, unit.tileR, unit.tileC, unit.dir, unit.s.baseRangeExtend || 0),
          profile: { canHitFly: true },
        }]);
        // AST-X 无迹: her attack damage ⇒ +atk_scale × ATK arts (附加伤害); an enemy damage instance she takes (the official
        // hsgma2_e_003_tr_take: ON_TAKE_DAMAGE from the other side) ⇒ atk_scale × ATK arts back
        const astx = num(tb.atk_scale);
        const moduleAffecting = () => !!unit.skill?.active || !!unit.mem.hsDying;
        if (astx > 0) {
          battle.on('damageOutput', (c) => {
            const t = c.target;
            if (!moduleAffecting() || c.source !== unit || !c.dmg?.isAttack || damageAttackType(c.dmg) !== 'NORMAL'
            || c.dmg.tags?.includes(ASTX) || c.dmg.type === 'element' || !t || t.side !== 'enemy' || !hasHp(t)) return;
            battle.dealDamage({ source: unit, target: t, amount: unit.s.atk * astx, type: 'arts',
            attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed', origin: c.dmg, tags: ['module', ASTX] });
          }, { owner: unit, priority: -20 });
          battle.addBuff(unit, { key: 'hsgma2:moduleCounter', persist: true, allowDead: true, observeInjury(c) {
            const s = c.source;
            if (!moduleAffecting() || !unit.alive || !byEnemyDamage(c) || !s.alive) return;
            battle.dealDamage({ source: unit, target: s, amount: unit.s.atk * astx, type: 'arts',
            attackType: 'NORMAL', applyWay: 'NONE', calculation: 'precomputed', ignoreSelect: true, tags: ['module', ASTX, 'counter'] });
          } });
        }
        // S3 临死模式: every other allied operator on her range holds 不死; the part of a damage instance past its HP is her 流失
        const shelters = (t) => !!unit.mem.hsDying && up(unit) && !!t && t !== unit && t.side === 'ally' && t.kind === 'op' && t.alive
          && !!unit.rangeKeySet && unit.rangeKeySet.has(t.tileR * COLS + t.tileC);
        battle.on('hpDamage', (c) => {
          const t = c.target;
          if (!shelters(t) || c.amount < t.hp) return;
          const over = c.amount - t.hp;
          c.amount = Math.max(0, t.hp - 1);
          if (over > 0) battle.loseHp(unit, over, { source: c.credit ?? null, tags: ['skill', 'hsgma2:shoulder'] });
        }, { owner: unit, priority: -60 });
        battle.on('fatal', (c) => { if (!c.prevented && shelters(c.unit)) c.prevented = true; }, { owner: unit, priority: -40 });
      },
    };
  },
};
