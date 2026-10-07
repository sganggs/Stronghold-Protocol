// server/sim/content/enemies.js — enemy special types (特训敌人) and individual enemy abilities (DESIGN §7).
//
// Battle side: install(battle) registers ONE set of global dispatch hooks per battle (ensureInstalled — idempotent,
// bosses.js calls it too) and attaches an ability list to every spawned enemy whose key has a kit in KITS.
// Every number comes from the enemy's talent / skill blackboard (data/enemies.json, merged with the wave template's
// `overrides[key].talents/skills` — the engine only applies `overrides.stats`). Numbers that exist nowhere in the
// data are named constants (enemies/helpers.js when several kit families use them, else in the family's file), marked
// [ASSUMED] or sourced from the official term table (gamedata_const termDescriptionDict) / PRTS.
//
// Runtime model: `enemy.mem.ab = { key, t (talent bb), tS (talent bbStr), sk {prefabKey → {cd, icd, sp, bb, bs}},
//   list [abilities], times, hitShield, atkType, immune, … }`. An ability is a plain object with optional methods
//   spawn(b,e,a,ab) · dealt(c,…) ('damaged' by one of e's ATTACKS on an ally, non-element) · taken(c,…) ('damaged' on e,
//   non-element) · hitIn(c,…) ('hit' on e, late: after every other hit handler) · hitOut(c,…) ('hit' from e, early) ·
//   (`c.source` is null for 无来源 damage — element bursts; target-side reactions that must still fire, e.g. damage
//   sharing, read `c.source || c.credit`, `credit` naming the unit that filled the gauge) ·
//   before(c,…) (beforeAttack of e) · attack(c,…) · blocked(c,…) · killed(c,…) (return true = revived; the kill is then
//   hidden from later 'kill' handlers) · death(c,…) · status(c,…) (statusApplied on e) · burst(c,…) (elementBurst on e)
//   · tick(b,e,a,dt) every `iv` s (every tick when iv is 0) · skill: `cd`/`left`(=icd)/`cond`/`fire` (cooldown runs
//   continuously; fires when ready, the enemy can act and `cond` holds). `sil: true` = the ability's handbook line
//   is flagged SILENCE (沉默 disables it: exactly the data's `format: "SILENCE"` lines — and 萨卡兹枯朽战士 / 组长's
//   死亡爆炸, a NORMAL line whose client template checks 沉默: archetypes.js kitPolluted); stun / freeze / sleep block
//   skills. Enemy SP skills ("数次攻击后…"): SP +1 per attack, the (spCost+1)-th attack is the skill attack (official
//   粉碎攻坚手 text: spCost 2 = "攻击2次后，下一次攻击").
// Shared mechanics: reborn() — "首次被击倒后重生 / 第二形态" (the first KO is hidden from kill credit and bounty; a
//   rebirth of Reborn.duration s, untargetable and inert, then the new form); artsBarrier() — "吸收法术伤害的屏障"
//   (absorbs arts after RES); frontGuard() — "来自正面的伤害降低" (facing = walking direction or the bigger crowd);
//   unbalanced() — 失衡 detection (displacement beyond the enemy's own speed; engine displace() has no hook);
//   husk() — "被击倒时暂时变为…，一段时间后重生" (Revive[Trigger]: every knock-out of the first form ⇒ 1 s 重生 ⇒ a walking
//   hit-count husk — 隐匿 逐火 embers, the unblockable 再生 puppet — until the real death or its revival); every 重生
//   (reborn / husk / statue) clears the enemy's statuses and the buffs allies gave it (rebirthCleanse, PRTS 特殊机制
//   §重生 "清空自身身上除白名单外所有Buff"); a data-unarmed
//   enemy armed by a form (转译基底) sets `e.profile` noAttack / melee / dmgType / maxTargets and attacks through the
//   engine (ai.js enemyAttack); float() — 近地悬浮 (an air unit that
//   keeps its ground path, Unit.isFlying; kitSyufo / kitParrot lose it when stunned). `e.profile.canTarget(ally)` = the
//   enemy's own target rule (只攻击地面单位 …), applied by the engine to the candidates before its priority order; a
//   special priority (优先攻击防御力最高的… / 生命上限最高的…) sorts by its key, ties by taunt then latest deployed
//   (targeting.js aggroCmp — PRTS 索敌: 特殊优先级 → 仇恨值). Area effects — splash, blasts, area skills and statuses,
//   pulses, the zones an enemy leaves, chain / bounce jumps, 周围四格 additions, whole-column / whole-field skills —
//   select with areaAllies / areaAlliesInTiles / fieldAllies (targeting.js areaSelectable; PRTS 作战机制 §AOE伤害判定
//   "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"): no 隐匿 ally, the one blocking the enemy included (GitHub #97), no untargetable
//   or sleeping one, no airborne 起飞 one for a ground enemy; 迷彩 is not checked (splash-type, 中点判定 / 格子判定 and
//   aura effects ignore it — ba.camou "无法躲避溅射类攻击", PRTS 异常效果 迷彩; the sites with no such reading are
//   [ASSUMED] in DESIGN §22.12). Buff auras select with auraAllies (auraSelectable: 隐匿 kept out, 起飞 not). A locked
//   target (an attack's, a channel's, a C4's) is hit as a direct pick, only the others around it as an area
//   (targetAndArea). Until 0.1.2 they took every ally in the area (GitHub issue #32 item 6; DESIGN §22.12). An airborne ally
//   (起飞, flag `liftoff`) is no target of a ground enemy (对地规避, targeting.js evadesGround): targetsNear / allTargets
//   skip it through canTargetAlly, the area selectors through areaSelectable, and the engine refuses a ground enemy's
//   damage and statuses on it. Not selections, so they still reach it (`ignoreSelect`): abilities PRTS marks "无视无法
//   选择 / 无视(目标)可选性" (【污染秽蚀】, 【盲信之誓】, 萨卡兹悖谬暴虐兵长's 暴击 splash, 假想敌：淤困's burst spread),
//   direct picks of the attacker (碎铳之簧's counter — PRTS 异常效果 "'直接选中'的能力…不受这些仅在选择时生效的异常效果
//   制约"), the blasts of flying units credited to a ground leader (刺胄之弹, 斩胄之剑 / 破胄之锤) and the ticks of a debuff
//   already on it (出血, 沙狱, “庞贝”'s burning, 淤困, 【自然涌动】 — a tick selects nobody). Ground enemies' buff auras
//   (深池伙友卫队, 扎罗's 远古威慑) and the sourceless 毒雾 of 假想敌：蚀裂 still reach it [ASSUMED, §21.22] while keeping
//   a 隐匿 ally out; 寒霜's aura (PRTS: its debuff "无视隐匿状态起作用") and map / tile effects (“墓碑” — PRTS: a map effect —,
//   【国度】, the chimera's 源石污染区 [ASSUMED]) reach every ally.
//
// Special types (factions.json):
//   FLY        — engine (FLY motion, ranged-only targeting). Flyer kits in enemies/fly.js (御4, 护障, 寒霜, 萨科塔之翼/眼, 黑云 …).
//   TIMES 频次 — "需要N次伤害击倒": maxHp := N hits; engine buff flag hitCount — every damage instance (any type, element
//                bursts included) removes exactly 1 on its own DamageInfo (茶器 hitCountArts: phys removes 0); HP loss
//                (loseHp) bypasses the rule. The faction's enemies
//                create those units (death spawns, embers, blades, 再生).
//   ELEMENT    — element damage on hit = ATK × ep_damage_ratio into the ally's gauge. 侵蚀 (erosion) is an engine
//                gauge whose burst is the official one (termDescription ba.dt.erosion: "永久降低100点防御力并受到800点物理伤害").
//   DOT        — damage zones (污染秽蚀: true damage, one tick per second however many cover a unit, "可对空，无视无法选择"
//                — `ignoreSelect`, 起飞 / 隐匿 allies included; 燃烧区域: the enemy's area selection — PRTS 集团军重型火炮
//                "碰撞不受迷彩制约，不可对空", no 无视无法选择 —, so no 起飞 or 隐匿 ally; 假想敌：蚀裂's sourceless
//                毒雾 skips a 隐匿 ally, not a 起飞 one), bleeding (removed by healing), pulsing damage around an enemy
//                (area selection).
//   INVISIBLE  — permanent `stealth` flag (engine: untargetable unless blocked or revealed). An operator's radius area
//                damage skips an unblocked one too (Battle.foesInRadius: profession splash around a struck target,
//                skill circles — PRTS 作战机制 §AOE伤害判定 "对攻击范围内的每个可以被选中的敌人进行判定"; until 0.1.1 it
//                still hit it); tile selectors (enemiesInKeys) always skipped it. After a block it hides again only
//                STEALTH_RESTORE (3) s later — or after the "（解除阻挡N秒后恢复）" of its PRTS page (STEALTH_RESTORE_BY_KEY,
//                清明's veil 0 s) — Battle._stealthSwitch / targeting.js enemyStealthed (until 0.1.2: at once).
//                The mirror rule for an ally's 隐匿 — enemy area effects skip it even when it blocks the enemy (0.1.3, GitHub #97) — is areaAllies.
//   REFLECTION — 折射 (ba.refraction "生效时，法术抗性+70"): RES +refracting.magic_resistance while NOT silenced
//                (the ability line is SILENCE-flagged: silencing turns it off); 镜膜 also gets max HP +100 % while on.
//   SPECIAL    — mostly stats; prisoners, 穿刺手, 暴虐兵长, 镜卫, 动力装甲 … in enemies/special.js.
// Every enemy key of data/enemies.json is either in KITS (this file), BOSS_KEYS (bosses.js) or STATS_ONLY (with the
// reason) — pinned by test/content/enemies_bosses.test.js. Bounty (悬赏) leaders are included: multi-form ones
// (巨大的丑东西, 杰斯顿, 自在, 锏, 扎罗) get their second form; event-only mechanics (芦苇, 摄影区, 狂欢时刻, 悬索桥, 唤血祭坛,
// 封冻/供暖器, 赘生甲壳, 锁链, 血债账款, 晦明) have no counterpart in this mode and are listed where they apply.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): 'explode' {r, kind} · 'zone' {r, dur, kind} · 'telegraph' {r, dur,
//   kind, tiles?, id?, form?} (delayed strikes, charges, 'reborn' with form 'reborn') · 'beam' {from, to, kind} ·
//   'summon' {id, key} · 'ember' {id, hits, dur, form: 'husk'} · 'revive' {id, kind?, form: 'form2' | 'revived' | 'fly'}
//   · 'stone' {id, dur, form: 'stone'} · 'blink' {id, fx, fy} · 'charge' {id, tx, ty} · 'expose' {id} · 'shieldBreak'
//   {id} · 'liberate' {id, form: 'liberty'} · 'phase' {id, kind, dur?, form?} (form changes — 掠海漂移体 'crawl', 暴鸰
//   'bombed', translator_*, a prisoner's 'warning' — and barrier / charge states) · 'lpLoss' {value, reason} · 'steal' · 'ignite'. Forms go through
//   setForm(): the unit keeps it (`e.form`, UnitInfo `form`) and the fx's `form` is the model's clip set from then on
//   (render/app.js → UnitView.setForm, units.js FORMS); the client keeps every fx with a `form` through catch-ups and
//   hidden tabs (shared/protocol.js fxForm).
// Custom hook: 'lpLoss' {amount, reason, source} — leader "扣除目标生命" effects; also summed into result.lpLoss.
//
// Code layout (0.2.0): this file installs the battle-wide dispatch hooks (ensureInstalled), runs the global
// dispatchers, builds KITS from the kit families and lists STATS_ONLY; the rest lives in server/sim/content/enemies/ —
//   helpers.js      constants several families use, per-battle state, ability bookkeeping (abOf / attach / dispatch, T,
//                   canCast …), selection and damage helpers (elem, hurt, areaAllies & friends, zone, spawnChildren,
//                   setForm, lpLoss, expose, absorbArts …)
//   archetypes.js   ability building blocks (stealth, splashAttack, deathBoom, refraction, float, reborn, husk, statue,
//                   artsBarrier, bleed, pollution, dmgZone, skill(), blinkForward …) and the archetype kits reused by
//                   several keys (kitEp, kitStealth, kitTimes, kitRefraction, kitPrisoner, kitDeathSpawn, kitStun3 …)
//   invisible.js, times.js, element.js, dot.js, reflection.js, fly.js, special.js — one file per special type
//                   (factions.json): its kits, its kit-only constants and its part of KITS
//   leaders.js      bounty (悬赏) leaders: kitLeaderMisc (single form) and the multi-form kits
// Every name this file exported before the split is still exported from here.

import { TICK } from '../constants.js';
import { stOf, abOf, attach, safe, dispatch, canCast, elem, alliesInTiles } from './enemies/helpers.js';
import { INVISIBLE_KITS } from './enemies/invisible.js';
import { TIMES_KITS } from './enemies/times.js';
import { ELEMENT_KITS } from './enemies/element.js';
import { DOT_KITS } from './enemies/dot.js';
import { REFLECTION_KITS } from './enemies/reflection.js';
import { FLY_KITS } from './enemies/fly.js';
import { SPECIAL_KITS } from './enemies/special.js';
import { LEADER_KITS } from './enemies/leaders.js';

export {
  EROSION, EROSION_BURST, HUSK_REBIRTH, nthOf, abOf, attach, T, silenced, canCast, elem, hurt, alliesInTiles,
  targetsNear, allTargets, areaAllies, areaAlliesInTiles, fieldAllies, auraAllies, targetAndArea, byPriority, zone,
  remainingRoute, stayRoute, spawnChildren, stepToward, setHits, hitCount, isHitCount, setForm, lpLoss, expose,
  expectedFinal, absorbArts,
} from './enemies/helpers.js';
export { TRANSLATOR_CHANGE } from './enemies/leaders.js';
export { BOMBD_RELEASE, BOMBD_POST_DELAY } from './enemies/fly.js';
export { HOVER_KEYS, blinkForward } from './enemies/archetypes.js';

// ---------------------------------------------------------------------------------------------------------------
// per-battle state + installation

/** Register the global dispatch hooks once per battle (idempotent). */
export function ensureInstalled(b) {
  const st = stOf(b);
  if (st.installed) return st;
  st.installed = true;
  b.on('enemySpawn', ({ enemy }) => onSpawn(b, enemy), { priority: 100 });
  b.on('hit', (c) => onHitOut(b, c), { priority: 200 });
  b.on('hit', (c) => chaliceShare(b, c), { priority: -400 });
  b.on('hit', (c) => onHitIn(b, c), { priority: -500 });
  b.on('damaged', (c) => onDamaged(b, c), { priority: 50 });
  b.on('beforeAttack', (c) => onBeforeAttack(b, c), { priority: 50 });
  b.on('attack', (c) => { if (c.attacker && c.attacker.side === 'enemy') dispatch(b, c.attacker, 'attack', c); }, { priority: 50 });
  b.on('blocked', (c) => dispatch(b, c.enemy, 'blocked', c), { priority: 50 });
  b.on('kill', (c) => onKill(b, c), { priority: 1000 });
  b.on('death', (c) => onDeath(b, c), { priority: 50 });
  b.on('beforeStatus', (c) => {
    const ab = c.target && c.target.mem && c.target.mem.ab;
    if (!ab) return;
    if (ab.immune && ab.immune.has(c.status)) c.cancel = true;
  }, { priority: 50 });
  b.on('statusApplied', (c) => { if (c.target && c.target.side === 'enemy') dispatch(b, c.target, 'status', c); }, { priority: 50 });
  b.on('heal', (c) => {
    // 逐腐兽 bleeding ends when the target receives healing (natural regeneration excluded)
    if (c.amount > 0 && c.target && c.target.side === 'ally' && !(c.opts && c.opts.regen) && c.target.findBuff('ab:bleed')) b.removeBuff(c.target, 'ab:bleed');
  }, { priority: -50 });
  b.on('elementBurst', (c) => onBurst(b, c), { priority: 50 });
  b.on('tick', (c) => onTick(b, c.dt), { priority: 50 });
  b.on('battleEnd', ({ result }) => { if (st.lpLoss > 0 && result) result.lpLoss = (result.lpLoss ?? 0) + st.lpLoss; });
  return st;
}

export function install(battle) { ensureInstalled(battle); }

export function registerMeta() {}

// ---------------------------------------------------------------------------------------------------------------
// global dispatchers

function onSpawn(b, e) {
  const kit = KITS[e.defId];
  if (typeof kit !== 'function') return;
  const ab = abOf(b, e);
  const list = safe(b, e, () => kit(ab, e, b)) || [];
  attach(b, e, list);
}

function onHitOut(b, c) {
  const s = c.source;
  if (!s || s.side !== 'enemy' || !s.mem.ab || c.dmg.cancel) return;
  const ab = s.mem.ab;
  if (ab.atkType && c.dmg.isAttack && c.dmg.type !== 'element') c.dmg.type = ab.atkType;
  dispatch(b, s, 'hitOut', c);
}

function onHitIn(b, c) {
  const t = c.target;
  if (!t || t.side !== 'enemy' || !t.mem.ab || c.dmg.cancel) return;
  const ab = t.mem.ab;
  dispatch(b, t, 'hitIn', c);
  if (c.dmg.cancel) return;
  const ty = c.dmg.type;
  if (ab.hitShield > 0 && (ty === 'phys' || ty === 'arts')) {
    // "可以抵挡一次物理或法术伤害" / 再生's aura shield: the whole instance is negated
    c.dmg.cancel = true;
    ab.hitShield--;
    if (ab.hitShield <= 0) b.fx('shieldBreak', { x: t.x, y: t.y, id: t.id });
  }
}

function onDamaged(b, c) {
  const { source: s, target: t, dmg } = c;
  if (!dmg || dmg.type === 'element') return;
  if (t && t.side === 'enemy' && t.mem.ab) dispatch(b, t, 'taken', c);
  if (s && s.side === 'enemy' && s.mem.ab && dmg.isAttack && t && t.side === 'ally') dispatch(b, s, 'dealt', c);
}

function onBeforeAttack(b, c) {
  const a = c.attacker;
  if (a && a.side === 'enemy' && a.mem.ab) dispatch(b, a, 'before', c);
}

function onKill(b, c) {
  const v = c.victim;
  if (!v || v.side !== 'enemy' || !v.mem.ab) return;
  if (dispatch(b, v, 'killed', c) && v.hp > 0) c.stopPropagation = true; // revived: not a kill for anyone else
}

function onDeath(b, c) {
  const u = c.unit;
  const st = stOf(b);
  if (u && u.side === 'enemy' && u.mem.ab) dispatch(b, u, 'death', c);
  if (st.deathWatch.size) for (const w of [...st.deathWatch]) { if (!w.alive) { st.deathWatch.delete(w); continue; } dispatch(b, w, 'otherDeath', c); }
}

function onBurst(b, c) {
  const t = c.target;
  if (!t) return;
  if (t.side === 'enemy') { if (t.mem.ab) dispatch(b, t, 'burst', c); return; }
  // 假想敌：淤困 parasite: the host's burst spreads the same element to the 4 neighbouring allies — PRTS 天赋 "（中点判定，
  // 无视目标可选性，不受迷彩制约）": every ally there, 隐匿 / untargetable / airborne 起飞 ones included (`ignoreSelect`)
  const par = t.findBuff('ab:parasite');
  if (par && par.data && par.data.src) {
    const src = par.data.src;
    for (const o of alliesInTiles(b, t.tileR, t.tileC, 'plus', 1)) if (o !== t) elem(b, src, o, c.element, par.data.spread, { ignoreSelect: true });
  }
}

/**
 * Which of the enemy's data skill slots (`data/enemies.json` `skills[]`, the client's `skillIndex`) an ability casts:
 * an ability that names its slot (an explicit `index`), else the slot whose `prefabKey` / id names the ability — the boss
 * kits name their abilities exactly like the data (盐风主教昆图斯's `Tidewater` / `Rockfall` / `SummonTentac` are
 * skills[0..2], whose clips are the skeleton's Skill_01..04, docs/research/13 §7). Returns -1 when the ability has no
 * data slot (most enemies: one generic ability, index 0).
 */
export function castSkillSlot(e, a) {
  if (Number.isInteger(a?.index) && a.index >= 0 && a.index < 10) return a.index;
  const id = a?.id ?? a?.name;
  const list = e?.def?.skills;
  if (typeof id !== 'string' || !id || !Array.isArray(list)) return -1;
  return list.findIndex((s) => s && (s.prefabKey === id || s.key === id || s.id === id || s.name === id));
}

function onTick(b, dt) {
  const list = b.enemies;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e || !e.alive || !e.mem.ab) continue;
    const ab = e.mem.ab;
    for (let j = 0; j < ab.list.length; j++) {
      const a = ab.list[j];
      if (!e.alive) break;
      if (a.tick) {
        if (!(a.sil && e.s.flags.silence)) {
          if (!(a.iv > 0)) safe(b, e, () => a.tick(b, e, a, dt));
          else {
            a._acc = (a._acc ?? 0) + dt;
            let k = 0;
            while (a._acc >= a.iv - 1e-9 && k++ < 4 && e.alive) { a._acc -= a.iv; safe(b, e, () => a.tick(b, e, a, a.iv)); }
          }
        }
      }
      if (a.fire && a.cd != null) {
        a.left -= dt;
        if (a.left <= 1e-9 && canCast(e, a.sil) && (!a.cond || safe(b, e, () => a.cond(b, e, a)))) {
          a.left = Math.max(TICK, a.cd);
          a.casts = (a.casts ?? 0) + 1;
          e.skillAnimUntil = b.time + 0.5;
          const slot = castSkillSlot(e, a);
          if (slot >= 0 && slot !== e.castSkill) {
            e.castSkill = slot;   // the skill clip the client plays: the 'cast' event below + UnitInfo.skillIndex
            b._ev(['cast', e.id, slot]);
          }
          safe(b, e, () => a.fire(b, e, a));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// KITS: enemyKey → (ab, e, battle) => ability list. One line per key (name · what), in the family files
// (enemies/*.js); spread here in the original order — the same keys in the same order as before the split.

export const KITS = Object.freeze({
  ...INVISIBLE_KITS,
  ...TIMES_KITS,
  ...ELEMENT_KITS,
  ...DOT_KITS,
  ...REFLECTION_KITS,
  ...FLY_KITS,
  ...SPECIAL_KITS,
  ...LEADER_KITS,
});

/** Keys deliberately left to their data stats (reason). */
export const STATS_ONLY = Object.freeze({
  enemy_1000_gopro_2: 'plain melee', enemy_1001_bigbo: 'plain leader (bounty)', enemy_1005_yokai: 'FLY, no attack (engine)',
  enemy_1005_yokai_2: 'FLY ranged (engine)', enemy_1005_yokai_3: 'FLY ranged (engine)', enemy_1006_shield: 'heavy defender',
  enemy_1006_shield_2: 'heavy defender', enemy_1006_shield_3: 'heavy defender', enemy_1007_slime: 'plain',
  enemy_1010_demon: 'plain', enemy_1010_demon_2: 'plain', enemy_1041_lazerd: 'FLY arts (engine)', enemy_1041_lazerd_2: 'FLY arts (engine)',
  enemy_1043_zomsbr: 'regen is data (hpRecoveryPerSec 80)', enemy_1061_zomshd: 'regen is data (hpRecoveryPerSec 200)',
  enemy_1046_agent: 'plain', enemy_1071_dftman: 'plain', enemy_1092_mdgint: 'plain (bounty)',
  enemy_1251_lysyta: 'R-series armour interaction absent', enemy_1251_lysyta_2: 'same',
  enemy_1252_lysytb_2: 'same', enemy_1254_lypa_2: 'no listed ability', enemy_1325_cbgpro: 'plain', enemy_1325_cbgpro_2: 'plain',
  enemy_1367_dseed: 'altar pulse absent (骸骨拷打者 leaves them inert, uncounted, in place)',
  enemy_1381_winman: 'plain', enemy_1381_winman_2: 'plain', enemy_1387_winshd: '封冻/供暖器 zones absent', enemy_1415_mmkabi_2: 'chains absent',
  enemy_1433_dsbasi: 'plain', enemy_1433_dsbasi_2: 'plain', enemy_1438_dspred: '赘生甲壳 absent',
  enemy_2002_bearmi: 'plain', enemy_2002_bearmi_2: 'plain',
  enemy_9012_acloon: '炎佑 is a bond summon (bonds.js)', enemy_10040_cnvbln: '狂欢时刻 absent', enemy_10043_sailor: 'bridges/cannons absent',
  enemy_10073_mpcar: 'plain', enemy_10124_uashld_2: 'taunt is data; 矿工游击队 absent',
});

// 圣杯 damage sharing: ground enemies near a living chalice pass `share` of the damage they take to it.
function chaliceShare(b, c) {
  const st = stOf(b);
  if (!(st.chalices > 0)) return;
  const t = c.target;
  if (!t || t.side !== 'enemy' || t.isFlying || c.dmg.cancel || c.dmg.type === 'element' || (c.dmg.tags && c.dmg.tags.includes('chalice'))) return;
  for (const o of b.enemies) {
    if (!o.alive || o === t || o.defId !== 'enemy_1430_lrrook' || !o.mem.ab) continue;
    const a = o.mem.ab.list[0];
    if (!a || !(a.share > 0) || Math.hypot(o.x - t.x, o.y - t.y) > a.r) continue;
    const part = c.dmg.amount * a.share;
    c.dmg.amount -= part;
    // a 无来源 burst's share stays 无来源, credited like the burst (damage.js)
    b.dealDamage(c.dmg.sourceless ? c.credit : c.source, o, { amount: part, type: c.dmg.type, canDodge: false, sourceless: c.dmg.sourceless, tags: [...(c.dmg.tags || []), 'chalice'] });
    break;
  }
}
