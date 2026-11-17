// server/sim/content/kits/ops/op-phatm2.js — 酒神 (char_1042_phatm2) 自选 operator kit: 6★ 巫役 (辅助), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, her module (RIT-X 酒神之心) at every form, and the kits of
// her summons 本能的召唤 (token_10054_phatm2_encdool) and 迷狂牢笼 (token_10055_phatm2_mndclv). Kit contract and the 自选
// rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1042_phatm2): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / token_table / range_table (zh_CN, as built into backups.json),
// PRTS 酒神 (形为心役 备注 "溅射半径1.3（中点判定）；先造成神经损伤与溅射，随后造成伤害"; 堕梦 备注 "于敌人成功普通攻击前之前触发
// （意味着触发的元素爆发可打断当次普攻，且不会触发成功攻击前的效果）"; 群体性谵妄 备注 on 本能的召唤; 空剧场 备注 "技能开始时，
// 对攻击范围内所有处于元素损伤爆发中的敌人触发一次第一天赋…尝试为其生成一次迷狂牢笼（不刷新已存在的牢笼）…迷狂牢笼只能生成于
// 不存在角色类单位的低地地块…所在地块已存在迷狂牢笼时改为将其刷新1次"), PRTS 本能的召唤 / 迷狂牢笼 (their 备注), and the
// client's battle data read from the local install — charpack char_1042_phatm2 (T1: phatm2_t_1 an active buff of every
// attack; T2: phatm2_t_2 on the enemies of her range, phatm2_t_2[global] on every enemy, phatm2_t_2[s3] in S3's range; S3:
// SpawnToken → phatm2_s_3[token] on the enemies of its range) and buff_template_data phatm2_t_1 / [range], phatm2_t_2 /
// [global] / [s3], phatm2_s_1[unmove], phatm2_s_2 / [damage] / [die], phatm2_s2_token_cache, token_phatm2_encdool_* ,
// phatm2_s_3[trigger] / [sanity] / [token] / [token][trigger] / [die] / [token_cooldown] / [token_clear_cooldown],
// token_phatm2_mndclv[passive].
// - Trait (巫役) "攻击造成法术伤害，可以造成元素损伤": ranged arts bolts (y-2, hits air units), blocks 1, ground enemies target
//   her. RIT-X “酒神之心” (trait bb ep_damage_scale) "对精英和领袖敌人造成的元素损伤提升18%": every element fill she deals
//   (her summon's too: "来源均为酒神自身") on an ELITE / BOSS / leader enemy ×1.18 — an `elementHit` multiplier (the kits'
//   convention: 塑心 强弱法).
// - T1 形为心役 "攻击附带相当于攻击力30%的神经损伤，并对目标周围其他敌人造成一次相当于攻击力20%的神经损伤" (full potential: 33 % / 23 %): every damage
//   instance of her normal attacks first gives its target attack@ep_damage_ratio × ATK 神经损伤 and every other selectable
//   enemy within range_radius (1.3, 中点判定; S2 talent@range_radius 1.5) of it ep_damage_ratio × ATK — before the damage (a
//   late `hit` handler, after any cancel; a hit dodged afterwards still carried it [ASSUMED], as 塑心 S2). S1's two hits
//   each carry it [ASSUMED: per damage instance].
// - T2 堕梦 "在场时，全场处于神经损伤爆发期间的敌人攻击速度-12；攻击范围内的敌人普通攻击时受到70点神经损伤" (full potential: −16): while she is on
//   the field every enemy in a 神经损伤 burst (its 爆发冷却, `neuralBurst`) has ASPD −|attack_speed| (one "同名" effect,
//   the strongest — priorityBBKeys); an enemy of her attack range starting a normal attack first takes `value` 神经损伤 —
//   the engine's `enemyAttackStart` hook, before 麻痹 is checked, so a burst it causes interrupts that very attack. RIT-X
//   stage 2+: −24 / 90 (the talent change).
// - S1 暗夜回声 (AUTO, attack SP 3, data DEFAULT — a "next attack"): that attack picks an enemy not in a burst first
//   (`notBurst`) and hits twice for atk_scale × ATK arts (times), then 束缚 (`bind`) for `unmove` s; while that root holds
//   (its final duration after 抵抗) the target takes 神经损伤 ×ep_damage_scale from anyone (phatm2_s_1[unmove]
//   EpDamageScale; one effect per target, the strongest) — the root lands after the two hits [ASSUMED].
// - S2 群体性谵妄 (AUTO, 持续时间无限 ⇒ a toggle until she leaves; an AUTO skill acting on herself and her summon: SP_FULL —
//   the owner's AUTO rule): ASPD +attack_speed, T1's splash radius talent@range_radius; her placed 本能的召唤 piece takes the
//   field on its tile when the skill starts and again each time it is ready ("退场时返还1个可部署的本能的召唤": its own 25 s
//   redeploy time) while the skill runs (content/tokens.js releaseSkillSummon; like every placed skill summon it also deploys
//   once, free, at the battle start — PRTS 卫戍协议/帮助); her leaving withdraws it ("酒神退场时强制撤退场上的本能的召唤").
//   本能的召唤 (kit below): untargetable, no attack, blocks nothing; every 0.1 s it 诱导s (the catalogue `attract`, to its
//   tile, for the rest of its life) the enemies of its x-1 (13 tiles) it can lure — at most max_target in all, ELITE / leader
//   first [ASSUMED: then the nearest], only "可达" ones (a ground path to its tile; flyers always); it leaves 10 s after its
//   deployment or as soon as one of them is within ability_range_radius (0.4) of it; whenever it leaves (any reason) every
//   selectable enemy of its x-1 is 停顿 `sluggish` s and for buff_time s takes, every interval_damage s from 0.1 s on,
//   ep_damage_ratio_token × ATK 神经损伤 (fixed: "不受目标损伤抗性影响" — the 损伤抵抗 share added back) and atk_scale × ATK arts
//   (持续伤害, not dodgeable) — her ATK when it was deployed ("缓存攻击力"), credited to her (无来源 once she left).
// - S3 空剧场 (MANUAL, ACTIVE_RANGE on y-8, 30 s): range y-8, ATK +atk, an enemy not in a burst first; every enemy she gives
//   神经损伤 meanwhile (a real gauge gain) takes ep_damage_ratio × her ATK 神经损伤 0.1 s later and every `interval` s after
//   until it is in a burst (any element) or the skill ends; enemies of her range in a 神经损伤 爆发冷却 recover
//   talent@ep_break_recover_speed (+50 %) faster (the cooldown runs 1.5×); an enemy of her range whose 神经损伤 bursts gets a
//   迷狂牢笼 on its ground tile (a low tile with no unit on it; an existing 牢笼 there is refreshed instead). At its start every
//   enemy of her range already in an element burst sets T1's splash off around it once and, in a 神经损伤 burst, gets a 牢笼
//   (none refreshed); 牢笼 left from an earlier cast stay. When it ends every 牢笼 of hers lasts
//   phatm2_s_3[token_cooldown].interval (30) s more; her leaving withdraws them.
//   迷狂牢笼 (kit below): 孤立 + 禁疗, no attack, 迷彩 (only the enemies it blocks target it), every damage it takes from
//   one of them is 1, any other damage (无来源 too) none — 3 HP: three hits; at its spawn / refresh it blocks every unblocked
//   enemy on its tile, ground or air, whatever its capacity — none holding 不可阻挡 (恐惧, 诱导, 浮空, 沉睡: DESIGN §24.9) —,
//   back to full HP, block count = their weight; it takes no other enemy by contact (flag `noNewBlock`); with nobody blocked
//   it leaves at once.
// Statuses: 束缚 (S1), 停顿 + 诱导 (本能的召唤); 神经损伤 bursts (engine: 3 麻痹 + 6000 元素伤害).

import { num, up, traitBb, talentBb, skillRec, once } from '../shared/tier1.js';
import { isElite, onElementHit, elementDmg } from '../shared/tier6.js';
import { releaseSkillSummon, startCountdown } from '../../tokens.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { hasHp, burstLocked } from '../../../attack.js';
import { MIN_DAMAGE_RATIO } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_phatm2_1';
const S2 = 'skchr_phatm2_2';
const S3 = 'skchr_phatm2_3';
export const CALL = 'token_10054_phatm2_encdool';
export const CAGE = 'token_10055_phatm2_mndclv';
/** phatm2_s_1[unmove]: the root's 神经损伤 amplifier (one per target, the strongest). */
export const UNMOVE = 'phatm2:unmove';
/** phatm2_t_2[attack_speed]: the ASPD cut of enemies in a 神经损伤 burst (one per enemy, the strongest). */
export const DREAM = 'phatm2:dream';
/** The client's trigger period of her field / range effects. */
const IV = 0.1;
const HOLD = IV + 0.05;
/** 本能的召唤 / 迷狂牢笼 numbers the token records may lack (PRTS 本能的召唤: 10 s, 0.4; the S3 cooldown 30 s). */
const CALL_LIFE = 10, CALL_ARRIVE = 0.4, CAGE_AFTER = 30;
/** 本能的召唤's area when its record carries no grid: x-1 (range_table: the 13-tile diamond). */
const X1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
/** Selection profile of her effects on enemies: ground and air. */
const ANY = Object.freeze({ canHitFly: true });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (u, id) => !!(u && u.skill && u.skill.id === id && u.skill.active);
const keysAt = (grid, u) => new Set(absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, 0));

/**
 * 神经损伤 of a fixed value that ignores the target's 损伤抵抗 (PRTS 群体性谵妄 备注 "不受目标损伤抗性影响": the client's
 * ApplyFixedElementDamage): the share the engine takes off (attack/element.js elementIntake) is added back first.
 */
function fixedNeural(battle, src, e, amount, sourceless = false) {
  if (!(amount > 0) || !hasHp(e)) return 0;
  const res = Math.min(1, Math.max(0, (Number(e.def?.epResistance) || 0) / 100));
  const k = Math.max(MIN_DAMAGE_RATIO, 1 - res);
  return battle.dealDamage(src, e, { type: 'element', element: 'neural', amount: amount / k, sourceless, tags: ['skill', 'phatm2:fixed'] });
}

/**
 * 本能的召唤's kit (the skill-summon piece of her S2: a fresh one per piece). `owner` = 酒神, `b2` = her S2 blackboard
 * (fallback for the token's own skill blackboard).
 */
function callKit(t, owner, b2) {
  const sb = t.def?.skill?.bb ?? {};
  const pick = (k, d) => num(sb[k], num(b2[k], d));
  const life = num((t.def?.talents ?? []).find((x) => x && x.bb && x.bb.duration != null)?.bb?.duration, pick('interval', CALL_LIFE));
  const cap = Math.max(1, Math.floor(pick('max_target', 4))), arrive = pick('ability_range_radius', CALL_ARRIVE);
  const grid = t.def?.rangeGrid ?? X1;
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, tok) {
      let lured = [], endAt = 0, atk = 0;
      const mine = (e) => { const a = e.findBuff('attract'); return a && a.source === tok ? a : null; };
      battle.on('deploy', (c) => {
        if (c.unit !== tok) return;
        lured = [];
        endAt = battle.time + life;
        atk = owner.s.atk;   // 缓存攻击力: her ATK at the deployment (PRTS 备注)
        startCountdown(battle, tok, life); // a countdown summon (content/tokens.js): 无敌, 禁疗 [ASSUMED], its bar = the life left
        const seq = tok.deploySeq;
        battle.after(life, () => { if (tok.alive && tok.deploySeq === seq) battle.retreat(tok, { reason: 'expired', permanent: true }); }, { owner: tok });
      }, { owner: tok });
      // 诱导 the enemies entering its x-1 (every 0.1 s, at most `cap` in all)
      battle.every(IV, () => {
        if (!up(tok) || lured.length >= cap) return;
        const keys = keysAt(grid, tok);
        const cands = battle.enemiesInKeys([...keys], tok, ANY).filter((e) => !lured.includes(e) && !e.s.flags.attract
          && (e.motion === 'FLY' || !!battle.grid.waypoints(Math.round(e.y), Math.round(e.x), tok.tileR, tok.tileC)));
        cands.sort((a, b) => (isElite(b) - isElite(a)) || (hypot(a.x - tok.x, a.y - tok.y) - hypot(b.x - tok.x, b.y - tok.y)) || a.spawnSeq - b.spawnSeq);
        for (const e of cands) {
          if (lured.length >= cap) break;
          if (battle.applyStatus(e, 'attract', { duration: Math.max(0.05, endAt - battle.time), source: tok, point: [tok.tileR, tok.tileC] })) {
            lured.push(e);
            battle.fx('lure', { x: e.x, y: e.y, id: e.id, src: tok.id });
          }
        }
      }, { owner: tok });
      // the first lured enemy within `arrive` of it: it leaves
      battle.on('tick', () => {
        if (!up(tok)) return;
        if (lured.some((e) => e.alive && mine(e) && hypot(e.x - tok.x, e.y - tok.y) <= arrive + 1e-9)) battle.retreat(tok, { reason: 'expired', permanent: true });
      }, { owner: tok });
      // leaving (any reason): 停顿 + the damage over time on every selectable enemy of its x-1; the 诱导 ends
      battle.on('death', (c) => {
        if (c.unit !== tok || battle.finished) return;
        for (const e of lured) { const a = e.alive ? mine(e) : null; if (a) battle.removeBuff(e, a); }
        lured = [];
        const keys = keysAt(grid, tok);
        const slow = pick('sluggish', 6), dur = pick('buff_time', 6), iv = Math.max(0.1, pick('interval_damage', 0.5));
        const ep = pick('ep_damage_ratio_token', 0), scale = pick('atk_scale', 1), a0 = atk;
        battle.fx('aoe', { x: tok.x, y: tok.y, radius: 2, id: tok.id, skill: 'phatm2:call' });
        for (const e of battle.enemiesInKeys([...keys], tok, ANY)) {
          if (slow > 0) battle.applyStatus(e, 'sluggish', { duration: slow, source: owner });
          battle.addBuff(e, {
            key: `phatm2:delirium#${owner.id}`, duration: dur, source: owner, tags: ['skill'], data: { next: battle.time + IV },
            onTick: ({ battle: b, unit: tgt, buff }) => {
              if (b.time + 1e-9 < buff.data.next) return;
              buff.data = { next: buff.data.next + iv };
              const gone = !owner.alive;
              fixedNeural(b, owner, tgt, a0 * ep, gone);
              if (tgt.alive) b.dealDamage(owner, tgt, { amount: a0 * scale, type: 'arts', canDodge: false, isSkill: true, sourceless: gone, tags: ['skill', 'dot', 'phatm2:delirium'] });
            },
          });
        }
      }, { owner: tok, priority: 10 });
      // "退场时返还1个可部署的本能的召唤": while her S2 runs it comes back after its own redeploy time (the dock's, −10, first)
      battle.on('death', (c) => {
        if (c.unit === tok && !battle.finished && skillOn(owner, S2) && up(owner)) releaseSkillSummon(battle, owner, CALL);
      }, { owner: tok, priority: -20 });
    },
  };
}

/** 迷狂牢笼's kit (spawned by her S3: a fresh one per cage). */
function cageKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, cage) {
      battle.addBuff(cage, { key: 'trait:cage', flags: { isolated: true, noHeal: true, camou: true, noNewBlock: true }, persist: true, allowDead: true });
      // only the enemies it blocks hurt it, 1 per hit
      battle.on('hit', (c) => { if (c.target === cage && (!c.source || !cage.blocking.includes(c.source))) c.dmg.cancel = true; }, { owner: cage, priority: 1000 });
      battle.on('hpDamage', (c) => { if (c.target === cage && c.amount > 1) c.amount = 1; }, { owner: cage });
      battle.on('tick', () => {
        if (!up(cage)) return;
        if (!cage.blocking.length || (cage.mem.cageUntil != null && battle.time + 1e-9 >= cage.mem.cageUntil)) battle.retreat(cage, { reason: 'expired', permanent: true });
      }, { owner: cage });
    },
  };
}

/**
 * A 牢笼 blocks every unblocked enemy on its tile (spawn / refresh): full HP again, block count = their weight. Never one
 * holding 不可阻挡 — as Battle._checkBlock: the flag (恐惧 / 诱导 carry it), 浮空, 沉睡 (SLEEPING = 无法行动+无敌+不可阻挡, DESIGN
 * §24.9: a sleeper on its tile stays free and is not counted).
 */
function cageBlock(battle, cage) {
  let added = 0;
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden || e.blockedBy || Math.round(e.y) !== cage.tileR || Math.round(e.x) !== cage.tileC) continue;
    const f = e.s.flags;
    if (f.unblockable || f.levitate || f.fear || f.sleep) continue;
    e.blockedBy = cage;
    cage.blocking.push(e);
    e.moving = false;
    added++;
    if (battle.hasHook('blocked')) battle.emit('blocked', { blocker: cage, enemy: e });
  }
  if (added) {
    let w = 0;
    for (const e of cage.blocking) w += e.blockWeight ?? 1;
    battle.addBuff(cage, { key: 'cage:block', mods: { blockCnt: w }, persist: true, allowDead: true });
    cage.hp = cage.s.maxHp;
  }
  return added;
}

/** 空剧场: a 牢笼 on enemy `e`'s ground tile — or the one already there refreshed (`refresh`). */
function cageAt(battle, owner, e, refresh) {
  const r = Math.round(e.y), c = Math.round(e.x);
  if (!battle.grid.inRect(r, c)) return null;
  const there = battle.allyUnits.find((t) => t.alive && t.deployed && t.kind === 'token' && t.defId === CAGE && t.tileR === r && t.tileC === c);
  if (there) { if (refresh) cageBlock(battle, there); return there; }
  if (!battle.grid.isLow(r, c) || battle.unitAt(r, c)) return null;
  const cage = battle.spawnToken(owner, CAGE, r, c, { kit: cageKit() });
  if (!cage) return null;
  if (!skillOn(owner, S3)) cage.mem.cageUntil = battle.time + CAGE_AFTER;
  cageBlock(battle, cage);
  battle.fx('summon', { x: cage.x, y: cage.y, id: cage.id, token: CAGE });
  return cage;
}

const callsOf = (battle, owner) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === CALL && t.ownerUnit === owner);
const cagesOf = (battle, owner) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === CAGE && t.ownerUnit === owner && t.alive);

export default {
  char_1042_phatm2: (bb, chess) => {
    const tb = traitBb(chess);
    const t1 = talentBb(chess, 0), t2 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const eliteScale = num(tb.ep_damage_scale, 1);
    const mainRatio = num(t1['attack@ep_damage_ratio']), splashRatio = num(t1.ep_damage_ratio);
    const splashR = num(t1.range_radius, 1.3), s2R = num(b2['talent@range_radius'], splashR);
    const dreamAspd = Math.abs(num(t2.attack_speed)), dreamValue = num(t2.value);
    const s3Ratio = num(b3.ep_damage_ratio), s3Iv = Math.max(0.1, num(b3.interval, 1));
    const s3Recover = num(b3['talent@ep_break_recover_speed']), s3After = num(b3['phatm2_s_3[token_cooldown].interval'], CAGE_AFTER);
    const s3DotKey = (u) => `phatm2:s3dot#${u.id}`;
    /** T1's splash around `t`: every other selectable enemy within the radius (中点判定). */
    const splash = (battle, unit, t, r) => {
      if (!(splashRatio > 0)) return;
      for (const e of battle.foesInRadius(t.x, t.y, r, true)) if (e !== t) elementDmg(battle, unit, e, 'neural', unit.s.atk * splashRatio, ['talent']);
    };
    return {
      skills: {
        [S1]: {
          kind: 'instant',
          targeting: { priority: 'notBurst' },
          attack: {
            atkScale: num(b1.atk_scale, 1), hits: Math.max(1, Math.floor(num(b1.times, 2))),
            onHit({ battle, unit, target }) {
              if (!target || !target.alive || !battle.applyStatus(target, 'bind', { duration: num(b1.unmove), source: unit })) return;
              const root = target.buffs.find((b) => b.status === 'bind');
              const dur = root && Number.isFinite(root.timeLeft) ? root.timeLeft : num(b1.unmove);
              battle.applyStrongest(target, UNMOVE, { duration: dur, value: num(b1.ep_damage_scale, 1), mods: () => ({}), source: unit });
            },
          },
        },
        [S2]: {
          kind: 'toggle', trigger: 'SP_FULL', mods: { aspd: num(b2.attack_speed) },
          onStart({ battle, unit }) { releaseSkillSummon(battle, unit, CALL); },
          onEnd({ battle, unit }) { withdrawCalls(battle, unit); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: s3?.rangeGrid ?? null, priority: 'notBurst' },
          onStart({ battle, unit }) {
            for (const c of cagesOf(battle, unit)) c.mem.cageUntil = null;   // phatm2_s_3[token_clear_cooldown]
            for (const e of [...battle.enemies]) {
              if (!e.alive || e.hidden || !e.s.flags.burstLock || !bodyInRange(e, unit.rangeKeySet)) continue;
              splash(battle, unit, e, splashR);
              if (e.alive && e.findBuff('neuralBurst')) cageAt(battle, unit, e, false);
            }
          },
          onTick({ battle, unit, dt }) {
            if (!(s3Recover > 0)) return;
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || !bodyInRange(e, unit.rangeKeySet)) continue;
              const lock = e.findBuff('neuralBurst');
              if (lock && Number.isFinite(lock.timeLeft)) lock.timeLeft -= dt * s3Recover;
            }
          },
          onEnd({ battle, unit }) {
            const key = s3DotKey(unit);
            for (const e of battle.enemies) if (e.findBuff(key)) battle.removeBuff(e, key);
            for (const c of cagesOf(battle, unit)) c.mem.cageUntil = battle.time + s3After;
          },
        },
      },
      talents: [
        { install(battle, unit) { // 形为心役: each hit of her attacks — its target, then the enemies around it
          battle.on('hit', (c) => {
            const t = c.target, d = c.dmg;
            if (c.source !== unit || !t || t.side !== 'enemy' || !d || d.cancel || !d.isAttack || d.isSplash || !hasHp(t)) return;
            if (mainRatio > 0) elementDmg(battle, unit, t, 'neural', unit.s.atk * mainRatio, ['talent']);
            splash(battle, unit, t, skillOn(unit, S2) ? s2R : splashR);
          }, { owner: unit, priority: -1000 });
        } },
        { install(battle, unit) { // 堕梦: ASPD cut in a 神经损伤 burst (the field); 神经损伤 on a normal attack (her range)
          if (dreamAspd > 0) {
            const slow = (e) => battle.applyStrongest(e, DREAM, { duration: HOLD, value: dreamAspd, mods: (v) => ({ aspd: -v }), source: unit });
            battle.every(IV, () => {
              if (!up(unit)) return;
              for (const e of battle.enemies) if (e.alive && !e.hidden && e.findBuff('neuralBurst')) slow(e);
            }, { owner: unit, immediate: true });
            battle.on('elementBurst', (c) => { if (up(unit) && c.element === 'neural' && c.target && c.target.side === 'enemy' && c.target.alive) slow(c.target); }, { owner: unit });
          }
          if (dreamValue > 0) {
            battle.on('enemyAttackStart', (c) => {
              const e = c.enemy;
              if (!up(unit) || !e || !hasHp(e) || !bodyInRange(e, unit.rangeKeySet)) return;
              elementDmg(battle, unit, e, 'neural', dreamValue, ['talent']);
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 本能的召唤: her placed pieces run its kit; her leaving withdraws it and every 迷狂牢笼
          for (const t of callsOf(battle, unit)) {
            if (t.alive || t.deployed) continue;
            // (no offOwner for a piece set up before her: its hooks are content/tokens.js's dock hooks — the generic token
            // kit registers none — and they must stay)
            battle._setupUnit(t, callKit(t, unit, b2));
          }
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            withdrawCalls(battle, unit);
            for (const t of cagesOf(battle, unit)) battle.retreat(t, { reason: 'expired', permanent: true });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // RIT-X: her element damage on elite / leader enemies ×ep_damage_scale
        if (eliteScale > 1) onElementHit(battle, unit, (c) => (c.source === unit && c.target.side === 'enemy' && isElite(c.target) ? eliteScale : 1));
        // S1's root: 神经损伤 taken ×its value while it holds (one battle-wide handler, whoever rooted)
        once(battle, 'phatm2:unmove', () => {
          battle.on('elementHit', (c) => {
            const d = c.dmg, t = c.target;
            if (!d || d.type !== 'element' || d.element !== 'neural' || !t) return;
            const v = t.findBuff(UNMOVE)?.data?.value;
            if (v > 1) d.mul *= v;
          });
        });
        if (unit.skill?.id !== S3) return;
        // 空剧场: her 神经损伤 starts the per-second 神经损伤 (until a burst); a 神经损伤 burst in her range: a 牢笼
        battle.on('damaged', (c) => {
          const e = c.target;
          if (!skillOn(unit, S3) || c.source !== unit || c.type !== 'element' || c.dmg?.element !== 'neural' || !(c.amount > 0)) return;
          if (!e || e.side !== 'enemy' || !e.alive || e.findBuff(s3DotKey(unit)) || burstLocked(e)) return;
          battle.addBuff(e, {
            key: s3DotKey(unit), source: unit, tags: ['skill'], data: { next: battle.time + IV },
            onTick: ({ battle: b, unit: tgt, buff }) => {
              if (burstLocked(tgt)) { b.removeBuff(tgt, buff); return; }
              if (b.time + 1e-9 < buff.data.next) return;
              buff.data = { next: buff.data.next + s3Iv };
              elementDmg(b, unit, tgt, 'neural', unit.s.atk * s3Ratio, ['skill', 'dot', 'phatm2:theatre']);
              if (tgt.alive && burstLocked(tgt)) b.removeBuff(tgt, buff);
            },
          });
        }, { owner: unit });
        battle.on('elementBurst', (c) => {
          const e = c.target;
          if (c.element !== 'neural' || !skillOn(unit, S3) || !up(unit) || !e || e.side !== 'enemy' || !e.alive || !bodyInRange(e, unit.rangeKeySet)) return;
          cageAt(battle, unit, e, true);
        }, { owner: unit });
      },
    };
  },
};

/** Her S2's end or her leaving: the 本能的召唤 in stock is gone and the one on the field leaves. */
function withdrawCalls(battle, unit) {
  const stock = unit.mem.summonStock;
  if (stock) stock[CALL] = 0;
  for (const t of callsOf(battle, unit)) if (t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
}
