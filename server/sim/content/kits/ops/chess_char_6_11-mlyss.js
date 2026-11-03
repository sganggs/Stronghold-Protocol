// server/sim/content/kits/ops/chess_char_6_11-mlyss.js — 缪尔赛思 (char_249_mlyss) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { bodyInRange } from '../../../body.js';
import {
  num, bv, tbb, tdesc, moduleBb, parseN, live, isTok, onDefaultSkill, selectedSkill, AROUND8, N4, bstate, bestTile,
  pullToward, elementDmg,
} from '../shared/tier6.js';
import { holdProtect } from '../shared/tier1.js';
import { isVersionData } from '../../tokens.js';

/**
 * 莱茵生命 (character_table groupId "rhine") members sold as shop chess (checked against the official table): today's five,
 * the list of before versions M0, which data without config.version (the default data and the plugin content sets on it)
 * keeps. On another version's build (support isVersionData) also 第一期's 星源 (DESIGN §35.22.4). 伊芙利特 and 淬羽赫默
 * (shop chess in 第一期, 自选 picks today) and today's other 自选 members are left out until the maintainer decides whether
 * 自选 members count (M2, DESIGN §35.22.5).
 */
const RHINE = new Set(['char_108_silent', 'char_128_plosis', 'char_202_demkni', 'char_249_mlyss', 'char_1047_halo2']);
const RHINE_VERSION = new Set([...RHINE, 'char_135_halo']);
/** The 莱茵生命 list of `data` (default: the loaded data). */
export const rhineOf = (data) => (isVersionData(data) ? RHINE_VERSION : RHINE);
/** A 莱茵生命 member of the loaded data's list: 开源节流's SP on copy and on deploy, and its cost cut. */
export const isRhine = (u) => rhineOf().has(u?.def?.charId);

// ------------------------------------------------------------------------------------------------------------------
// 缪尔赛思 chess_char_6_11 (战术家) — S3 浅层非熵适应; 净水即生命 (流形); 开源节流; module 梳妆流形
//
// Module “缪尔赛思和朋友们” (TAC-D, CN 2.7.91; the tier-6 elite fields stage 3). Her 援军 is her 流形 (content/tokens.js
// ensureReinforcement; the engine's generic 援军 only when no 流形 could take the field).
// - 特性追加 「自身与援军造成伤害时附带相当于12%伤害的侵蚀损伤」 (talent part ep_damage_ratio): every HP damage she, a 流形
//   of hers (split clones included [ASSUMED]: they are 流形 too) or her 援军 deals to an enemy with HP left attaches
//   ep_damage_ratio × that damage (post-mitigation) of 侵蚀损伤, its dealer the source — the rider convention of 盟约·辅助干员
//   迭代元素 (no 元素伤害, burst or gauge fill carries one) — while she is on the field [ASSUMED].
// - 净水即生命 「缪尔赛思或流形攻击范围内有敌人侵蚀损伤爆发后，对其造成相当于缪尔赛思攻击力400%元素伤害且流形获得80点技力」
//   (the talent part holding atk_scale / sp: stage 2 200 % / 45, stage 3 400 % / 80): whoever filled the gauge, an
//   enemy whose 侵蚀 bursts inside her current range or a 流形's takes atk_scale × her ATK 元素伤害 from her, and every
//   流形 of hers gains sp SP, in the `elementBurst` hook — before the burst's own hit [ASSUMED order, as 纯烬艾雅法拉
//   熔点引爆], while she is on the field [ASSUMED]. Its 「复制全部属性」 is the 流形 variant's (scale 1, tokens.json byModule).

/**
 * The operator a 流形 copies: the nearest (Chebyshev tiles) living operator of its player on the field, not the summoner;
 * ties → higher base ATK → lower id. Same pick as content/tokens.js (unmanaged 流形), so both paths agree.
 */
function pickCopyTarget(battle, owner, t) {
  let best = null, bs = null;
  for (const a of battle.allyUnits) {
    if (a.kind !== 'op' || !live(a) || a === owner || a.ownerId !== owner.ownerId) continue;
    const s = [Math.max(Math.abs(a.tileR - t.tileR), Math.abs(a.tileC - t.tileC)), -a.base.atk, a.id];
    let less = !bs;
    if (!less) for (let i = 0; i < 3; i++) { if (s[i] < bs[i]) { less = true; break; } if (s[i] > bs[i]) break; }
    if (less) { best = a; bs = s; }
  }
  return best;
}

/**
 * 流形 copy (token talent "复制目标90%的生命值、攻击力、防御力、法抗，以及阻挡数、攻击间隔、攻击范围、初始伤害类型（不攻击、
 * 治疗类型则不继承）"): scale × HP/ATK/DEF/RES, block count, BAT/ASPD, range and damage type. The attack itself stays the
 * token's single-target attack (melee or ranged after the copied position) — splash/chain/multi-hit shapes are not
 * listed and not copied. `ranged` (近/远程位) decides the special trait (steal / split).
 */
function copyInto(battle, t, src, scale, ranged) {
  const sb = src.base, b = t.base;
  b.maxHp = Math.max(1, num(sb.maxHp, b.maxHp) * scale);
  for (const k of ['atk', 'def', 'res']) if (Number.isFinite(sb[k])) b[k] = sb[k] * scale;
  for (const k of ['blockCnt', 'bat', 'aspd']) if (Number.isFinite(sb[k])) b[k] = sb[k];
  if (Array.isArray(src.rangeGrid) && src.rangeGrid.length) t.rangeGrid = src.rangeGrid;
  const sp = src.profile || {};
  const p = t.profile;
  if (p) {
    p.attack = ranged ? 'ranged' : 'melee';
    // (a 阵法术师 / 轰击术师's instant 'beam' is their every-enemy-in-range shape: the copy fires a plain bolt)
    p.projectile = ranged ? (sp.projectile && sp.projectile !== 'none' && sp.projectile !== 'orb' && sp.projectile !== 'beam' ? sp.projectile : 'bolt') : 'none';
    p.canHitFly = ranged ? true : !!sp.canHitFly;
    if (!(sp.dmgType === 'heal' || sp.dmgType === 'none' || sp.noAttack || sp.noAttackUnlessSkill)) p.dmgType = sp.dmgType;
    p.heal = null;
    p.noAttack = false;
    p.noAttackUnlessSkill = false;
  }
  battle.removeBuff(t, 'mlyss:stolen');
  t.mem.mlyss = { ranged, from: src.id, stolenAtk: 0, stolenDef: 0, attacks: 0 }; // "复制后重置"
  t.markDirty();
  t.hp = t.s.maxHp;
  battle.refreshRange(t); // the copied grid: current + initial range, trigger keys
}

function mlyss(bb, chess, def) {
  const tokId = def?.talents?.[0]?.tokenKey || (chess?.tokens || [])[0] || 'token_10030_mlyss_wtrman';
  // module talent parts (index −1): TAC-D's burst part is the one holding atk_scale (its `sp` goes to the 流形, never to
  // 开源节流's read below); the other parts merge as before (TAC-D ep_damage_ratio, TAC-Y sp / sp_other)
  const modParts = (chess?.talents || []).filter((t) => t && t.index === -1 && t.bb);
  const burstBb = modParts.find((t) => num(t.bb.atk_scale) > 0)?.bb ?? {};
  const t1 = tbb(def, 1), mod = moduleBb({ talents: modParts.filter((t) => t.bb !== burstBb) });
  const epRatio = num(mod.ep_damage_ratio), burstScale = num(burstBb.atk_scale), burstSp = num(burstBb.sp);
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const reinfCut = parseN(chess?.trait?.moduleDesc, /伤害降低(\d+(?:\.\d+)?)%/, 0) / 100;
  // S3 (default) only: melee pulse interval, ranged-copy bind
  const pulseIv = Math.max(0.2, bv(bb, 'interval', 2)), bindDur = isDef ? bv(bb, 'duration', 1.5) : 0;
  // "自身与流形攻击力+N%（攻击速度+N）" — every skill of hers buffs the 流形 too while it runs
  const manifoldMods = { atkPct: num(bb.atk), ...(num(bb.attack_speed) ? { aspd: num(bb.attack_speed) } : {}) };
  const buffManifold = (battle, t, dur) => battle.addBuff(t, { key: 'mlyss:s3', mods: manifoldMods, duration: dur });
  // module 落叶四季 (开源节流): copying a 莱茵生命 operator ⇒ she gains `sp`; deploying the copied one ⇒ it gains `sp_other`
  const rhineSp = num(mod.sp), rhineSpOther = num(mod.sp_other);
  const tokTal = (t, key) => { for (const x of t.def?.talents || []) if (x?.bb && typeof x.bb[key] === 'number') return x.bb; return {}; };
  // "其被击败后会在25秒后自动刷新" (token talent interval; the talent text as a fallback)
  const respawnOf = (t) => num(tokTal(t, 'scale').interval, parseN(tdesc(def, 0), /(\d+(?:\.\d+)?)秒后自动刷新/, 25));
  const isRanged = (src) => (src.def?.position ? src.def.position === 'RANGED' : src.profile?.attack === 'ranged');

  const copyNearest = (battle, unit, t) => {
    const src = pickCopyTarget(battle, unit, t);
    if (!src) { // nobody to copy: the copy skill is not spent — it ends and stays ready (no attack without a copy)
      if (t.skill?.active) { t.skill.end('noTarget'); t.skill.gainSp(t.skill.spCost, 'refund'); }
      return;
    }
    copyInto(battle, t, src, num(tokTal(t, 'scale').scale, 1), isRanged(src));
    battle.fx('copy', { x: t.x, y: t.y, id: t.id, src: src.id });
    if (rhineSp > 0 && isRhine(src) && unit.skill) unit.skill.gainSp(rhineSp, 'talent');
  };
  const mineLive = (battle, unit) => battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x));

  const skills = {
    // S1 渐进性润化: fake_cost DP over the skill (1 every mlyss_s_1[cost].interval s, the rest at its end), she and her
    // 流形 ATK / ASPD +
    skchr_mlyss_1: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      onStart({ battle, unit, skill }) {
        unit.mem.mlyDp = { acc: 0, got: 0 };
        for (const t of mineLive(battle, unit)) buffManifold(battle, t, skill.timeLeft);
      },
      onTick({ battle, unit, dt }) {
        const m = unit.mem.mlyDp;
        if (!m) return;
        const iv = Math.max(0.1, bv(bb, 'interval', 1.364)), total = Math.floor(num(bb.fake_cost, 11)), per = bv(bb, 'cost', 1);
        m.acc += dt;
        while (m.acc + 1e-9 >= iv && m.got < total) { m.acc -= iv; m.got++; battle.addDp(unit.ownerId, per); } // loop-cap: interval floored and a DP total
      },
      onEnd({ battle, unit, reason }) {
        const m = unit.mem.mlyDp;
        unit.mem.mlyDp = null;
        const total = Math.floor(num(bb.fake_cost, 11));
        if (m && reason === 'duration' && m.got < total) battle.addDp(unit.ownerId, (total - m.got) * bv(bb, 'cost', 1));
      },
    },
    // S2 生态耦合: +cost DP, she and her 流形 ATK +; melee copies regenerate hp ratio / s and take 庇护; ranged copies
    // attack twice at random targets of their range (install)
    skchr_mlyss_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        battle.addDp(unit.ownerId, num(bb.cost));
        battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost) });
        for (const t of mineLive(battle, unit)) buffManifold(battle, t, skill.timeLeft);
      },
    },
  };

  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_mlyss_2') {
        const regen = num(bb.hp_recovery_per_sec_by_max_hp_ratio), dr = num(bb.damage_resistance);
        battle.every(0.25, () => {
          const on = !!unit.skill?.active && live(unit);
          for (const t of battle.allyUnits) {
            if (!isTok(t, tokId, unit) || !t.profile) continue;
            const m = t.mem.mlyss;
            if (t.mem.mlyssHits == null) t.mem.mlyssHits = Math.max(1, Math.floor(num(t.profile.hits, 1)));
            const ranged = !!(m && m.ranged);
            t.profile.hits = on && ranged && live(t) ? t.mem.mlyssHits * 2 : t.mem.mlyssHits; // 二连击
            if (on && m && !ranged && live(t)) {
              battle.addBuff(t, { key: 'mlyss:eco', duration: 0.4, refresh: 'replace', visible: true, mods: { hpRegenRatio: regen } });
              // "获得15%的庇护": the shared 庇护 (holdProtect — 同名效果取最高 with every other source)
              holdProtect(battle, t, dr, 0.4, unit);
            }
          }
        }, { owner: unit });
        battle.on('beforeAttack', (ctx) => { // ranged copies: 随机攻击范围内的目标
          const t = ctx.attacker;
          if (!isTok(t, tokId, unit) || !t.mem.mlyss?.ranged || !unit.skill?.active) return;
          const c = battle.enemiesInKeys(t.rangeKeys, t, ctx.profile);
          if (c.length) ctx.targets = [battle.rng.pick(c)];
        }, { owner: unit });
      }
      if (rhineSpOther > 0) battle.on('deploy', ({ unit: u, initial }) => { // the copied 莱茵生命 operator is deployed
        if (initial || !u || u.kind !== 'op' || u.ownerId !== unit.ownerId || !isRhine(u) || !u.skill) return;
        if (battle.allyUnits.some((t) => isTok(t, tokId, unit) && live(t) && t.mem.mlyss?.from === u.id)) u.skill.gainSp(rhineSpOther, 'talent');
      }, { owner: unit });
      // module TAC-D (see the header): the erosion rider of her and her 援军, and 净水即生命's burst follow-up
      if (epRatio > 0) battle.on('damaged', (ctx) => {
        const s = ctx.source, e = ctx.target, d = ctx.dmg;
        if (!s || !e || e.side !== 'enemy' || !(ctx.amount > 0) || !live(unit)) return;
        if (s !== unit && !isTok(s, tokId, unit) && s !== unit.trait?.reinforcement) return;
        if (ctx.type === 'element' || ctx.type === 'elemental' || (d && d.tags && d.tags.includes('burst'))) return;
        elementDmg(battle, s, e, 'erosion', ctx.amount * epRatio, ['trait', 'mlyss:erosion']);
      }, { owner: unit });
      if (burstScale > 0 || burstSp > 0) battle.on('elementBurst', ({ target: e, element }) => {
        if (element !== 'erosion' || !e || e.side !== 'enemy' || !e.alive || !live(unit)) return;
        const mine = battle.allyUnits.filter((t) => isTok(t, tokId, unit) && live(t));
        if (!bodyInRange(e, unit.rangeKeySet) && !mine.some((t) => bodyInRange(e, t.rangeKeySet))) return;
        if (burstScale > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * burstScale, type: 'elemental', element: 'erosion', canDodge: false, tags: ['talent', 'mlyss:burst'] });
        if (burstSp > 0) for (const t of mine) t.skill?.gainSp(burstSp, 'talent');
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        battle.addDp(unit.ownerId, num(bb.cost));
        battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost) });
        const S = unit.mem;
        let ranged = false;
        for (const t of battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x))) {
          buffManifold(battle, t, skill.timeLeft);
          if (t.mem.mlyss?.ranged) ranged = true;
        }
        if (ranged) { // 刷新所有流形: heal the living ones, respawn the destroyed ones now
          for (const t of battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x))) t.hp = t.s.maxHp;
          for (const p of (S.mlyssPending || []).splice(0)) { p.timer?.cancel?.(); p.spawn(); }
        }
        S.mlyssPulse = battle.every(pulseIv, () => { // melee copies: pull the 8 surrounding tiles + stun blocked units
          if (!unit.skill?.active) return;
          for (const t of battle.allyUnits) {
            if (!isTok(t, tokId, unit) || !live(t) || !t.mem.mlyss || t.mem.mlyss.ranged) continue;
            for (const e of battle.unitsInGrid(t, AROUND8, { side: 'enemy' })) pullToward(battle, t, e, num(t.def?.skill?.bb?.force));
            for (const e of t.blocking) if (e.alive) battle.applyStatus(e, 'stun', { duration: pulseIv + 0.1, source: unit });
            battle.fx('pulse', { x: t.x, y: t.y, id: t.id });
          }
        }, { owner: unit, immediate: true });
      },
      onEnd({ unit }) { if (unit.mem.mlyssPulse) unit.mem.mlyssPulse.cancel(); unit.mem.mlyssPulse = null; },
    },
    talents: [
      { install(battle, unit) { // 净水即生命: 流形 copy / respawn / melee steal / ranged split
        unit.mem.mlyssPending = [];
        const S = bstate(battle);
        S.robbed ??= new WeakMap(); // enemy → { atk, def } stolen by any 流形
        const mine = (t) => isTok(t, tokId, unit);
        // her 流形 on the field (split clones aside: deployLimit 1 counts the 流形 itself)
        const standing = () => battle.allyUnits.some((t) => mine(t) && live(t) && !t.mem.mlyssClone);
        const cancelPending = () => { for (const p of unit.mem.mlyssPending.splice(0)) p.timer?.cancel?.(); };
        battle.on('deploy', ({ unit: t }) => {
          if (!mine(t)) return;
          const clone = unit.mem.mlyssCloneOf;
          if (clone) { // a split copy: same stats as its origin, never copies/splits/respawns itself
            unit.mem.mlyssCloneOf = null;
            t.mem.mlyssClone = true;
            t.mem.isClone = true; // content/tokens.js skips clones too (her redeploy must bring a real 流形, not adopt a clone)
            copyInto(battle, t, clone, 1, true);
            return;
          }
          cancelPending(); // a 流形 stands again (tactical re-summon, S3 refresh): no second one later
          t.mem.mlyssHome = [t.tileR, t.tileC];
          const sp = num(tokTal(t, 'sp').sp);
          if (sp > 0 && !unit.mem.mlyssFirst && t.skill) t.skill.gainSp(sp, 'talent'); // elite: first deployment +5 SP
          unit.mem.mlyssFirst = true;
          if (unit.skill?.active && unit.skill.isTimed) buffManifold(battle, t, unit.skill.timeLeft);
        }, { owner: unit });
        battle.on('skillStart', ({ unit: t }) => { if (mine(t) && !t.mem.mlyssClone) copyNearest(battle, unit, t); }, { owner: unit });
        // trigger rule MLYSS_WTRMAN ("全部技能，受流形影响") [ASSUMED]: DEFAULT (engine), and an enemy inside the range of one
        // of her copied 流形 also satisfies it (her S3 acts through the 流形: pull/stun or bind around them)
        if (unit.skill) unit.skill.addTriggerRange(() => battle.allyUnits.filter((t) => mine(t) && live(t) && t.mem.mlyss));
        battle.on('tick', () => { // without a dedicated token kit the copy fires once ready and someone can be copied
          for (const t of battle.allyUnits) {
            if (!mine(t) || !live(t) || t.mem.mlyssClone || !t.kit?.generic || !t.skill || t.skill.active || !t.skill.ready || t.skill.opCooling) continue;
            if (pickCopyTarget(battle, unit, t)) t.skill.activate('MLYSS_WTRMAN');
          }
        }, { owner: unit });
        // "其被击败后会在25秒后自动刷新": one pending respawn at a time, on its tile, only while she is on the field and no
        // 流形 of hers stands (her redeploy summons it again as her 援军, tokens.js); expired / replaced ones do not return
        battle.on('death', ({ unit: t, reason }) => {
          if (t === unit) { cancelPending(); return; }
          if (!mine(t) || t.mem.mlyssClone || reason !== 'killed' || !t.mem.mlyssHome || standing()) return;
          cancelPending();
          const [r, c] = t.mem.mlyssHome;
          const entry = { spawn: null, timer: null };
          let tries = 0;
          entry.spawn = () => {
            const i = unit.mem.mlyssPending.indexOf(entry);
            if (i >= 0) unit.mem.mlyssPending.splice(i, 1);
            if (battle.finished || !live(unit) || standing() || tries++ > 120) return;
            if (battle.isReservedTile(r, c) || !battle.spawnToken(unit, tokId, r, c)) { // its tile is taken: retry in 1 s
              entry.timer = battle.after(1, entry.spawn, { owner: unit });
              unit.mem.mlyssPending.push(entry);
            }
          };
          entry.timer = battle.after(respawnOf(t), entry.spawn, { owner: unit });
          unit.mem.mlyssPending.push(entry);
        }, { owner: unit });
        battle.on('attack', ({ attacker: t, targets }) => {
          if (!mine(t) || !t.mem.mlyss || !live(t)) return;
          const tal = tokTal(t, 'steal_atk');
          const m = t.mem.mlyss;
          if (!m.ranged) { // melee copy: 每次攻击偷取敌方10点攻击力与防御力（最高250点）— a capped copy steals nothing more
            const sa = num(tal.steal_atk), sd = num(tal.steal_def, sa);
            const capA = num(tal.steal_atk_max, Infinity), capD = num(tal.steal_def_max, capA);
            let changed = false;
            for (const e of targets) {
              if (!e.alive || e.side !== 'enemy') continue;
              const ga = Math.max(0, Math.min(sa, capA - m.stolenAtk)), gd = Math.max(0, Math.min(sd, capD - m.stolenDef));
              if (!(ga > 0 || gd > 0)) break;
              m.stolenAtk += ga; m.stolenDef += gd;
              const rb = S.robbed.get(e) || { atk: 0, def: 0 };
              rb.atk += ga; rb.def += gd;
              S.robbed.set(e, rb);
              battle.addBuff(e, { key: 'mlyss:robbed', mods: { atkFlat: -rb.atk, defFlat: -rb.def }, source: t });
              changed = true;
            }
            if (changed) battle.addBuff(t, { key: 'mlyss:stolen', mods: { atkFlat: m.stolenAtk, defFlat: m.stolenDef } });
          } else if (!t.mem.mlyssClone) { // ranged copy: split every N attacks (the clone lasts `interval` s)
            const every = Math.max(1, Math.floor(bv(tal, 'max_stack_cnt', 10)));
            if (++m.attacks % every !== 0) return;
            const tiles = N4.slice(1).map(([dr, dc]) => [t.tileR + dr, t.tileC + dc])
              .filter(([r, c]) => battle.grid.inRect(r, c) && !battle.isReservedTile(r, c) && battle.grid.canStand(r, c, { ranged: true }));
            const tile = bestTile(battle, tiles);
            if (!tile) return;
            unit.mem.mlyssCloneOf = t;
            let cl = null;
            try { cl = battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: num(tal.interval, 25), kit: { skill: null } }); } finally { unit.mem.mlyssCloneOf = null; }
            if (cl) battle.fx('split', { x: cl.x, y: cl.y, id: cl.id, src: t.id });
          }
        }, { owner: unit });
        battle.on('damaged', (ctx) => { // S3, ranged copies: attacks bind
          const t = ctx.source;
          if (!mine(t) || !t.mem.mlyss?.ranged || !unit.skill?.active || !ctx.dmg?.isAttack || !ctx.target.alive || !(bindDur > 0)) return;
          battle.applyStatus(ctx.target, 'bind', { duration: bindDur, source: unit });
        }, { owner: unit });
        battle.on('hit', (ctx) => { // module: 援军 / 流形 take less damage from the enemies they block
          const t = ctx.target, s = ctx.source;
          if (!t || !s || s.side !== 'enemy' || s.blockedBy !== t) return;
          if (mine(t)) { // 流形 (her 援军): token module part, unless its token kit (content/tokens.js) applies it
            if (!t.kit?.fromTokens) { const ds = num(tokTal(t, 'damage_scale').damage_scale, 1); if (ds > 0 && ds < 1) ctx.dmg.mul *= ds; }
          } else if (reinfCut > 0 && t === unit.trait?.reinforcement) ctx.dmg.mul *= 1 - reinfCut; // engine 援军
        }, { owner: unit });
        // module 落叶四季: "援军阻挡的敌人更容易受到我方的攻击" — the 流形's module part (token talent taunt_level: +1) on
        // the enemies it blocks: our operators pick higher-taunt enemies first (targeting.js sortEnemyTargets)
        battle.every(0.25, () => {
          for (const t of battle.allyUnits) {
            if (!mine(t) || !live(t) || !t.blocking.length) continue;
            const lv = num(tokTal(t, 'taunt_level').taunt_level);
            if (!(lv > 0)) continue;
            for (const e of t.blocking) if (e.alive) battle.addBuff(e, { key: 'mlyss:exposed', mods: { taunt: lv }, duration: 0.4, refresh: 'replace', source: t });
          }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 开源节流: 莱茵生命 ops of the owner cost less DP to redeploy
        const S = bstate(battle);
        S.rhine ??= new Set();
        if (S.rhine.has(unit.ownerId)) return;
        S.rhine.add(unit.ownerId);
        const cut = num(t1.cost), first = num(t1.runtime_cost);
        battle.on('battleStart', () => {
          const rh = battle.allyUnits.filter((a) => a.kind === 'op' && a.ownerId === unit.ownerId && isRhine(a)).sort((a, b) => a.deploySeq - b.deploySeq);
          rh.forEach((a, i) => { a.base.cost = Math.max(0, a.base.cost + cut + (i === 0 ? first : 0)); });
        });
      } },
    ],
  };
}

export default {
  chess_char_6_11_a: mlyss,
};
