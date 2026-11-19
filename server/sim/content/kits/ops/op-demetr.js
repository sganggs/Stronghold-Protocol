// server/sim/content/kits/ops/op-demetr.js — 贝洛内 (char_4037_demetr) 自选 operator kit: 6★ 斗士 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, his module at every form and his summon 牵绊.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4037_demetr, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, FGT-Y (his only module) at stage 1 (tier 5) or 3 (tier 6) or none. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json; the 牵绊 token
// record backups.json tokens.token_10065_demetr_dmtpos); PRTS 贝洛内 (家族手段 备注 "防御减少效果于贝洛内每次普通攻击时，计算伤害前
// 施加（可影响当次攻击）…防御减少方式为最终乘算…多个贝洛内之间的【手段】间仅防御减少量最高者生效…每0.1秒自然更新一次；当具有≥6层层数
// 的【手段】自然更新/响应更新时，若该【手段】的来源（贝洛内）不处于2技能状态或已离场，层数将强制变回5层…增伤效果为线性提升，可对任何来自
// 贝洛内的伤害（不止普通攻击）生效"; 街头直觉 备注 "部署时立刻获得80%物理/法术闪避，之后每秒衰减2%（至多衰减20次），最终变为40%";
// 家主的余裕 备注 "可触发两次第一天赋"; 军师的手段 备注; 清算 备注 — the 牵绊 rules, "每次移动的目标地块必须为合法、可部署、未部署有
// 牵绊/贝洛内自己以外单位的地面地块", "在受到致命伤害结算后立即结束技能，因返回而部署时获得短暂的不死", "若技能开启时，若存在目标则会立刻
// 尝试移动；否则会尝试原地移动一次", "技能结束时，若不位于初始位置且场上不存在牵绊，贝洛内将被强制撤退"); PRTS 牵绊 备注 (无敌, 孤立,
// 晕眩 / 冻结 / 寒冷 / 沉睡 免疫); PRTS 卫戍协议/帮助 特殊策略 (【清算】 "在自定义范围内存在敌人时释放技能", x-2); gamedata_const
// ba.addash 移动 "不退场，以当前血量在目标位置部署"; the client's battle data — charpack char_4037_demetr (every attack ability
// carries demetr_t1[def_dec]; S2 mode `demetr_s2[mark]`; S3 modes), skchr_demetr_3 (FlyToTarget / FlyToTargetSecond: the
// x-2 selector around his located tile, buildable melee low-ground tiles empty but for him and his token; RespawnEnd), buff
// _template_data `demetr_t1[def_dec]` / `[def_dec_core]` / `[dmg_inc]`, `demetr_t2[evade]`, `demetr_s3[bonus]` / `[target_timer]`
// / `[timer]` / `[elite_finish_listener]` / `[undeadable]` / `[restore]`; his skeleton (Skill_3_Back 0.5 s).
// - Trait (斗士) "能够阻挡一个敌人": the profession default (block 1, melee, ground only). Module FGT-Y “实用的工具” "生命值高于
//   50%时攻击速度+10" (trait bb attack_speed / hp_ratio): ASPD while HP > hp_ratio.
// - T1 家族手段 (bb attack@def / attack@limited_stack_cnt / attack@s2_limited_stack_cnt / attack@def_dec_duration,
//   min/max_hp_ratio, min/max_add_on_scale): each of his attack hits puts 【手段】 on its target before the damage (it counts
//   for that hit): one stack more (at most limited_stack_cnt, s2_limited_stack_cnt while S2 runs), DEF ×(1 − |def| × stacks)
//   (FINAL_SCALER), def_dec_duration s from the last hit; at s2_limited_stack_cnt stacks the target is 停顿 (sluggish) for as
//   long as it keeps them; every 0.1 s a 【手段】 above limited_stack_cnt whose 贝洛内 is not in S2 (or not on the field) drops
//   back to limited_stack_cnt, keeping its time. One 【手段】 per enemy per 贝洛内 (demetr_t1[def_dec] CheckContainsBuff /
//   AssignBuffBlackboardFromOthers with the source filter): stacks, the timer and the S2 cap are that source's own. Only the
//   strongest reduction acts (the core's overrideEffectKey demetr_buff_01, priorityBBKeys ["def"] — PRTS 「仅防御减少量最高者
//   生效」): DEF ×(1 − |def| × stacks) of that one, not a sum and not a product. A lone 贝洛内 keeps the single MEANS_KEY
//   buff. And every damage of his ×(1 + add-on), the add-on linear from min_add_on_scale at min_hp_ratio of the target's HP
//   to max_add_on_scale at max_hp_ratio and below (DamageScaleAccordingToHpRatio, the target's HP before the hit). FGT-Y
//   stage 3: 8 % per stack, +50 % at most.
// - T2 街头直觉 (bb init_prob / dec_prob / trig_cnt): from every deployment — a 【移动】 is one (demetr_s3_t[born_sync]) —
//   physical and arts dodge init_prob, −dec_prob each second trig_cnt times (80 % → 40 %), then stays.
// - S1 家主的余裕 (AUTO, attack SP 4; data DEFAULT): the next attack strikes its target twice for atk_scale × ATK physical
//   (`_additionalTimes` 1 — both strikes land in the attack [ASSUMED: the skeleton's 0.2 s between them is not modelled]);
//   each strike adds a 【手段】 stack.
// - S2 军师的手段 (MANUAL, 15 / 18 s; data ACTIVE_RANGE on its 3-13): range 3-13, ASPD +attack_speed, every attack strikes
//   attack@max_target targets for attack@atk_scale × ATK physical; 【手段】 up to s2_limited_stack_cnt and 停顿 at the cap. Its
//   attack is a projectile in the client (projectile_chr_demetr_s2): the hits land at the attack [ASSUMED: flight not
//   modelled]; ground targets only, as every attack of his (selector targetMotion 1).
// - S3 清算 (MANUAL, 30 s; data CUSTOM_RANGE on x-2): ATK +atk, ASPD +attack_speed, each damage instance attack@…prob to be
//   ×prob_atk_scale (AtkScaleUp: on the attack's ATK, before DEF). At the cast he 【移动】s (Battle.moveRedeploy: no exit, HP
//   / buffs / the skill kept, deploy effects again — 街头直觉's 80 %) onto the tile of the first ground enemy of the x-2 around
//   his located tile (his tile at the cast) whose tile he may take — a melee-buildable low-ground tile of the field, nobody
//   on it but his 牵绊 or himself, no knocked-out operator, no other piece's reserved tile — in the usual target order
//   (sortEnemyTargets); without one he moves in place once. He takes another target the same way when the elite / leader
//   enemy he attacked last (within attack@finish_listener_duration s) is knocked out, and whenever 1 s (interval × time_stack)
//   passed without him dealing damage — retried every interval while no target exists, never while he cannot act. Leaving his
//   located tile he leaves 牵绊 there (when none of his is up); moving back onto it retreats 牵绊 first. A lethal hit while it
//   runs does not knock him out: 不死, untargetable, blocking nothing, 禁疗 (demetr_s3[undeadable]) and the skill ends on the
//   next tick. At the end he returns — a 【移动】 onto his located tile (in place when he is there) that empties his SP — and
//   gets a short 不死 (RETURN_UNDYING); not on that tile and no 牵绊 of his up (or the tile taken) ⇒ forced retreat ('retreat').
//   The client's wind-up / landing clips (Skill_3_ReStart_Begin 0.2 s, _End 0.3 s) are not modelled: each move is instant
//   [ASSUMED].
// - 牵绊 (token_10065_demetr_dmtpos, S3 only — its variant bySkill 2): "贝洛内技能结束时返回该位置，并且其他干员不能部署" — it holds
//   his located tile; 无敌, untargetable, 孤立, no attack, blocks nothing (blockCnt 0) — PRTS 牵绊 备注.
// Melee, ground-only (data canHitFly false: no anti-air); ground enemies target him normally (no 起飞 / 迷彩 / 隐匿).

import { num, talentBb, traitBb, skillRec, up, onHitBy, toggleBuff, once } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { isElite } from '../shared/tier6.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_demetr_1';
const S2 = 'skchr_demetr_2';
const S3 = 'skchr_demetr_3';
export const BOND = 'token_10065_demetr_dmtpos';
/** S3's search area when the data carries none (x-2: the 5 × 5 square around him without its corners). */
const X2 = Object.freeze([[2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -2], [0, -1], [0, 0], [0, 1],
  [0, 2], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1]]);
/** "因返回而部署时获得短暂的不死" (PRTS 备注; no number): his return clip, Skill_3_Back 0.5 s [ASSUMED]. */
export const RETURN_UNDYING = 0.5;
/** 【手段】 on an enemy (one per source; a lone 贝洛内 keeps MEANS_KEY, each further one is MEANS_KEY#id) and its 停顿 at the S2 cap; the 【手段】 refresh tick (PRTS 备注 "每0.1秒自然更新一次"). */
export const MEANS_KEY = 'talent:demetr:means';
export const MEANS_SLUG_KEY = 'talent:demetr:means:sluggish';
const MEANS_TICK = 0.1;
export const STREET_KEY = 'talent:demetr:street';
export const UNDEAD_KEY = 'skill:demetr:undeadable';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const s2On = (u) => !!(u && u.skill && u.skill.active && u.skill.id === S2);
const s3On = (u) => !!(u && u.skill && u.skill.active && u.skill.id === S3);

/** 牵绊's kit (a fresh one per summon): no attack, 无敌 and 孤立 (spawnToken adds untargetable). */
export function bondKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, tok) {
      battle.addBuff(tok, { key: 'token:demetr:bond', flags: { invulnerable: true, isolated: true }, persist: true, allowDead: true });
    },
  };
}

const isMeans = (b) => b.key === MEANS_KEY || (typeof b.key === 'string' && b.key.startsWith(`${MEANS_KEY}#`));
const meansRecs = (e) => e.buffs.filter(isMeans);
const recOfSrc = (e, unit) => meansRecs(e).find((b) => b.data?.src === unit) ?? null;
const cutOf = (d) => d.pct * d.stacks;

/** The key of this source's 【手段】: the only one on the enemy stays MEANS_KEY. */
function meansKey(e, unit) {
  const cur = recOfSrc(e, unit);
  if (cur) return cur.key;
  return e.findBuff(MEANS_KEY) ? `${MEANS_KEY}#${unit.id}` : MEANS_KEY;
}

/**
 * DEF multiplier of every 【手段】 on `e`: only the largest |def| × stacks multiplies (the rest stay ×1, so they do not
 * compound). An equal cut keeps the earlier buff — the resulting DEF is the same either way.
 */
function syncCuts(e) {
  const recs = meansRecs(e);
  if (!recs.length) return;
  let best = recs[0], bestCut = cutOf(best.data);
  for (let i = 1; i < recs.length; i++) {
    const c = cutOf(recs[i].data);
    if (c > bestCut) { best = recs[i]; bestCut = c; }
  }
  const win = Math.max(0, 1 - bestCut);
  let dirty = false;
  for (const r of recs) {
    const want = r === best ? win : 1;
    if (!r.mods || r.mods.defMul !== want) { r.mods = { defMul: want }; dirty = true; }
  }
  if (dirty) e.markDirty();
}

/**
 * 停顿 while any source's own stacks are at its S2 cap (demetr_t1[def_dec_core] creates sluggish[inf] when cur_stack
 * equals s2_limited_stack_cnt). One buff, not a product of several [ASSUMED: the DB buff sluggish[inf] is same-key and
 * does not stack]. It lasts as long as the longest such 【手段】.
 */
function syncSluggish(battle, e) {
  let dur = 0, src = null;
  for (const r of meansRecs(e)) {
    const d = r.data;
    if (!d || !(d.stacks >= d.cap8) || !(r.timeLeft > dur)) continue;
    dur = r.timeLeft;
    src = d.src;
  }
  if (!(dur > 1e-6)) {
    if (e.findBuff(MEANS_SLUG_KEY)) battle.removeBuff(e, MEANS_SLUG_KEY);
    return;
  }
  battle.addBuff(e, { key: MEANS_SLUG_KEY, duration: dur, refresh: 'replace', source: src, status: 'sluggish', mods: { moveMul: 0.2 }, visible: true, tags: ['talent'] });
}

function onMeansExpire({ battle, unit }) {
  syncCuts(unit);
  syncSluggish(battle, unit);
}

/** Write this source's 【手段】 (refresh resets its own timer; a cap drop passes the time it had left). */
function writeMeans(battle, e, unit, data, dur) {
  battle.addBuff(e, {
    key: meansKey(e, unit), duration: dur, refresh: 'replace', source: unit,
    mods: { defMul: 1 }, data: { ...data, src: unit }, tags: ['talent'], onExpire: onMeansExpire,
  });
}

/** Put / refresh this 贝洛内's 【手段】 on `e` (demetr_t1[def_dec], filtered to its source) and retarget the DEF cut. */
function applyMeans(battle, unit, e, p) {
  const cur = recOfSrc(e, unit);
  const old = cur?.data?.stacks ?? 0;
  const cap = s2On(unit) ? p.cap8 : p.cap5;
  const stacks = old < cap ? old + 1 : old;
  writeMeans(battle, e, unit, { stacks, pct: p.pct, cap5: p.cap5, cap8: p.cap8 }, p.dur);
  syncCuts(e);
  syncSluggish(battle, e);
}

/** The 0.1 s update of every 【手段】 (battle-wide, once): above its own normal cap without its 贝洛内 in S2 ⇒ back to it. */
function installMeansTick(battle) {
  once(battle, 'demetr:means', () => battle.every(MEANS_TICK, () => {
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      const pending = [];
      for (const b of meansRecs(e)) {
        const d = b.data;
        if (!d || !(d.stacks > d.cap5)) continue;
        if (up(d.src) && s2On(d.src)) continue;
        pending.push(b);
      }
      if (!pending.length) continue;
      for (const b of pending) {
        const d = b.data;
        writeMeans(battle, e, d.src, { stacks: d.cap5, pct: d.pct, cap5: d.cap5, cap8: d.cap8 }, b.timeLeft);
      }
      syncCuts(e);
      syncSluggish(battle, e);
    }
  }));
}

export default {
  char_4037_demetr: (bb, chess) => {
    const tb = traitBb(chess);       // FGT-Y: attack_speed / hp_ratio
    const t0 = talentBb(chess, 0);   // 家族手段 (FGT-Y stage 3: def −0.08, max_add_on_scale 0.5)
    const t1 = talentBb(chess, 1);   // 街头直觉
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const area = s3?.trigger?.customRangeGrid ?? X2;
    const means = {
      pct: Math.abs(num(t0['attack@def'])), cap5: Math.max(1, Math.floor(num(t0['attack@limited_stack_cnt'], 5))),
      cap8: Math.max(1, Math.floor(num(t0['attack@s2_limited_stack_cnt'], 8))), dur: num(t0['attack@def_dec_duration'], 10),
    };
    const hpHi = num(t0.min_hp_ratio, 1), hpLo = num(t0.max_hp_ratio, 0.2);
    const addLo = num(t0.min_add_on_scale), addHi = num(t0.max_add_on_scale);
    const iv = num(b3['attack@demetr_s3[target_timer].interval'], 0.5);
    const idle = iv * Math.max(1, num(b3['attack@demetr_s3[target_timer].time_stack'], 2));
    const listen = num(b3['attack@finish_listener_duration'], 3);
    const prob = num(b3['attack@demetr_s3[bonus].prob']), probScale = num(b3['attack@demetr_s3[bonus].prob_atk_scale'], 1);

    /** A tile he may 【移动】 onto (FlyToTarget selector options, PRTS 备注). */
    const tileOk = (battle, unit, st, r, c) => {
      if (!battle.grid.inRect(r, c) || !battle.grid.canStand(r, c) || !battle.grid.isLow(r, c) || battle.downOn(r, c)) return false;
      if (r === unit.tileR && c === unit.tileC) return true;
      const occ = battle.unitAt(r, c);
      if (occ) return occ === st.bond;
      return !battle.isReservedTile(r, c);
    };
    /** The first ground enemy of the x-2 around his located tile standing on a tile he may take. */
    const pickTarget = (battle, unit, st) => {
      const keys = absoluteRangeKeys(area, st.home[0], st.home[1], unit.dir, 0);
      const list = battle.enemiesInKeys(keys, unit, { canHitFly: false, groundOnly: true })
        .filter((e) => !e.isFlying && tileOk(battle, unit, st, Math.round(e.y), Math.round(e.x)));
      sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
      return list[0] ?? null;
    };
    const retreatBond = (battle, st) => {
      if (st.bond && st.bond.alive) battle.retreat(st.bond, { reason: 'expired', permanent: true });
      st.bond = null;
    };
    /** One 【移动】 of S3 onto (r, c): 牵绊 retreated first when it is his located tile, left there when he leaves it. */
    const moveTo = (battle, unit, st, r, c) => {
      const [hr, hc] = st.home;
      const home = r === hr && c === hc;
      if (home && (unit.tileR !== hr || unit.tileC !== hc)) retreatBond(battle, st);
      const fromX = unit.x, fromY = unit.y;
      if (!battle.moveRedeploy(unit, r, c)) return false;
      battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
      if (!home && !(st.bond && st.bond.alive)) st.bond = battle.spawnToken(unit, BOND, hr, hc, { untargetable: true, kit: bondKit() });
      return true;
    };
    /** FlyToTarget(Second): move onto the next target's tile; false without one (or when he cannot act). */
    const flyTo = (battle, unit, st) => {
      if (!up(unit) || !unit.canAct || st.undead) return false;
      const t = pickTarget(battle, unit, st);
      if (!t || !moveTo(battle, unit, st, Math.round(t.y), Math.round(t.x))) return false;
      st.next = battle.time + idle;
      return true;
    };

    return {
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1), hits: 2 } },
        [S2]: {
          kind: 'duration',
          mods: { aspd: num(b2.attack_speed) },
          targeting: { ...(s2?.rangeGrid?.length ? { rangeGrid: s2.rangeGrid } : {}), maxTargets: Math.max(1, num(b2['attack@max_target'], 3)) },
          attack: { atkScale: num(b2['attack@atk_scale'], 1) },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3['attack@demetr_s3[bonus].atk']), aspd: num(b3['attack@demetr_s3[bonus].attack_speed']) },
          onStart({ battle, unit, skill }) {
            const st = { home: [unit.tileR, unit.tileC], bond: null, next: battle.time + idle, act: skill.activations, lastHit: null, lastHitAt: -Infinity, retarget: false, undead: false };
            unit.mem.demetrS3 = st;
            // "若技能开启时，若存在目标则会立刻尝试移动；否则会尝试原地移动一次"
            if (!flyTo(battle, unit, st) && up(unit)) moveTo(battle, unit, st, unit.tileR, unit.tileC);
          },
          onTick({ battle, unit }) {
            const st = unit.mem.demetrS3;
            if (!st) return;
            // the elite / leader he attacked last fell: FlyToTargetSecond at once (one try; the idle timer runs on)
            if (st.retarget) {
              st.retarget = false;
              if (flyTo(battle, unit, st)) return;
            }
            if (battle.time + 1e-9 < st.next) return;
            // no target (or he cannot act): the timer keeps counting — the next try at its next interval
            if (!flyTo(battle, unit, st)) {
              const step = stepOf('attack@demetr_s3[target_timer].interval', iv, 0.5);
              let guard = 0;
              while (st.next <= battle.time + 1e-9 && guard++ < STEP_PER_TICK) st.next += step; // loop-cap: stepOf interval
            }
          },
          onEnd({ battle, unit }) {
            const st = unit.mem.demetrS3;
            unit.mem.demetrS3 = null;
            if (!st) return;
            battle.removeBuff(unit, UNDEAD_KEY);
            if (!unit.alive || !unit.deployed) { retreatBond(battle, st); return; }
            const [hr, hc] = st.home;
            const atHome = unit.tileR === hr && unit.tileC === hc;
            const bondUp = !!(st.bond && st.bond.alive);
            retreatBond(battle, st);
            const fromX = unit.x, fromY = unit.y;
            // 【返回】: a 【移动】 onto the located tile (in place when he stands on it) that empties the SP (demetr_s3[restore])
            if ((atHome || bondUp) && battle.moveRedeploy(unit, hr, hc, { clearSp: true })) {
              if (!atHome) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
              unit.mem.demetrGraceUntil = battle.time + RETURN_UNDYING;
              return;
            }
            battle.retreat(unit, { reason: 'retreat' });   // "贝洛内将被强制撤退"
          },
        },
      },
      talents: [
        { install(battle, unit) { // 家族手段
          installMeansTick(battle);
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
            if (means.pct > 0) applyMeans(battle, unit, c.target, means);
          }, { owner: unit, priority: 10 });
          if (addHi || addLo) {
            onHitBy(battle, unit, (c) => {
              const r = c.target.hpRatio;
              const t = hpHi > hpLo ? Math.min(1, Math.max(0, (hpHi - r) / (hpHi - hpLo))) : (r <= hpLo ? 1 : 0);
              c.dmg.mul *= 1 + addLo + (addHi - addLo) * t;
            });
          }
        } },
        { install(battle, unit) { // 街头直觉
          const init = num(t1.init_prob), dec = num(t1.dec_prob), cnt = Math.max(0, Math.floor(num(t1.trig_cnt)));
          if (!(init > 0)) return;
          const set = (p) => battle.addBuff(unit, { key: STREET_KEY, mods: { dodgePhys: p, dodgeArts: p }, data: { p }, tags: ['talent'] });
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            const seq = unit.deploySeq;
            let p = init, n = 0;
            set(p);
            if (!(dec > 0) || !cnt) return;
            battle.every(1, (b, sc) => {
              if (!unit.alive || unit.deploySeq !== seq) { sc.cancel(); return; }
              p = Math.abs(p - dec);
              set(p);
              if (++n >= cnt) sc.cancel();
            }, { owner: unit });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // FGT-Y: 生命值高于50%时攻击速度+10
        const aspd = num(tb.attack_speed);
        if (aspd) toggleBuff(battle, unit, 'trait:demetr:aspd', () => unit.hpRatio > num(tb.hp_ratio, 0.5), { aspd });
        // S3 清算: ×prob_atk_scale at prob per damage instance (AtkScaleUp: the attack's ATK, before DEF)
        if (prob > 0 && probScale !== 1) {
          onHitBy(battle, unit, (c) => {
            if (s3On(unit) && battle.rng.chance(prob)) c.dmg.amount *= probScale;
          });
        }
        // S3: the target he attacked last (an elite / leader one re-targets him when it falls within `listen` s)
        battle.on('hit', (c) => {
          const st = unit.mem.demetrS3;
          if (!st || c.source !== unit || !c.dmg?.isAttack || !c.target || c.target.side !== 'enemy') return;
          st.lastHit = c.target;
          st.lastHitAt = battle.time;
        }, { owner: unit });
        // S3: 1 s without output damage re-targets him (the timer restarts with each damage instance he deals)
        battle.on('damaged', (c) => {
          const st = unit.mem.demetrS3;
          if (st && c.source === unit && c.target && c.target.side === 'enemy') st.next = battle.time + idle;
        }, { owner: unit });
        battle.on('death', (c) => {
          const st = unit.mem.demetrS3;
          if (!st || c.reason !== 'killed' || c.unit !== st.lastHit || !isElite(c.unit) || battle.time - st.lastHitAt > listen + 1e-9) return;
          st.lastHit = null;
          st.retarget = true;   // taken in his next skill tick (the enemy index of that tick sees every enemy)
        }, { owner: unit });
        // S3: 受到致命伤害时不撤退但会结束技能 (demetr_s3[undeadable]); the return's short 不死
        battle.on('fatal', (c) => {
          if (c.unit !== unit || c.prevented) return;
          const st = unit.mem.demetrS3;
          if (st && s3On(unit)) {
            c.prevented = true;
            if (st.undead) return;
            st.undead = true;
            battle.addBuff(unit, { key: UNDEAD_KEY, flags: { untargetable: true, noBlock: true, healFree: true }, tags: ['skill'], visible: true });
            battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
            const act = st.act;
            battle.after(0, () => { if (unit.mem.demetrS3 === st && s3On(unit) && unit.skill.activations === act) unit.skill.end('fatal'); }, { owner: unit });
            return;
          }
          if (battle.time < (unit.mem.demetrGraceUntil ?? -Infinity) - 1e-9) c.prevented = true;
        }, { owner: unit, priority: -50 });
      },
    };
  },
};
