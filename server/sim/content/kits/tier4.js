// server/sim/content/kits/tier4.js — hand-authored kits for every tier-4 chess (26: 22 visible + 4 hidden).
// export default { [baseChessId]: (bb, chess, def) => Kit }  (docs/SIM.md §7.2). The same kit serves the elite
// (精锐 `_b`) id: `bb` is the Lv4 / Lv7 skill blackboard, talent/trait blackboards come from `def` (module talent and
// trait upgrades of elites are already merged into the data), `def.raw.module.active` tells whether the module runs.
// Every number comes from a blackboard (skill `bb`, `def.talents[i].bb`, `def.traitBb`, token data); literals below
// are only fall-backs for missing keys or documented [ASSUMED] shapes (tornado radius …).
//
// Notes shared by several kits:
// - `base_attack_time` in skill blackboards is a FLAT change of the base attack time in seconds (白面鸮 −1.8 on 2.85 s
//   ⇒ 1.05 s; 水月 −0.7 on 3.5 s) and is converted to the engine's `batPct` (÷ base BAT). 焰尾's +0.7 (text: 攻击间隔
//   缩短) is a multiplier (×0.7) and 信仰搅拌机's 0.6 is the counter interval ratio — both handled in their kits.
// - "技力光环 (同类效果取最高)" (莫斯提马, 白面鸮) share the buff key `aura:spRecovery`; a unit keeps the highest one.
// - Auras refresh short buffs every AURA s so they lapse within a few ticks after the source leaves.
// - Talents that name a faction use data fields: nationId (拉特兰 laterano, 卡西米尔 kazimierz, 谢拉格 kjerag),
//   profession (术师 CASTER, 重装 TANK, 先锋 PIONEER), enemy tags (萨卡兹 sarkaz, 海怪 seamonster); 深海猎人 = research
//   groupId `abyssal` (data/chess.json has no groupId: charIds from docs/research/03-operators.json).
// - "友方干员" effects touch operators only (summons/devices excluded); SP gifts skip units whose timed skill runs
//   (AK: no SP gain during a skill — the engine's gainSp enforces it too; the kits skip such units when picking).
// - On-hit effects of 卡涅利安's attacks land on every enemy the attack strikes — the 阵法术师 trait strikes every enemy
//   on her range at once (professions.js `allInRange` / `rangeAoe`, community report E3): S2's 停顿 / 束缚 via a
//   `damaged` hook, the charged S3 mark via a `hit` hook (it applies before the damage, PRTS 备注).
// - Dodge from a skill that adds to other dodge sources (焰尾 S3) is rolled independently in a `hit` hook, so the
//   sources combine as 1 − Π(1 − p) (the same rule the engine now applies to stacked dodge mods).
// - Operator loadouts (DESIGN §16): every selectable non-default skill of the 22 visible chess is authored in the kit's
//   `skills` map (see alt() below); logic of one skill (counters, deferrals, auras…) only runs when it is selected,
//   and module effects check the selected module (moduleIs / the module-merged trait & talent blackboards).
//   `node tools/kit-coverage.mjs --tier 4 --strict`; tests: test/content/kits_alt_t4.test.js.

import { COLS } from '../../constants.js';
import { bodyDist, bodyInKeys } from '../../body.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../targeting.js';
import { normalizeChess } from '../../simdata.js';
import { aggregateMods } from '../../buffs.js';
import { CAT_SHIELD_KEY } from '../tokens.js';
import { isHpLoss } from '../../damage.js';
import { holdsUndying } from '../items/battle.js';

const TICK_EPS = 0.01;     // minimal status duration (s)
const AURA = 0.2;          // aura refresh period (s)
const AURA_DUR = 0.25;     // aura buff lifetime (s): lapses ~1 tick after the source stops refreshing it
const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);
const LINE = Object.freeze(Array.from({ length: COLS }, (_, i) => Object.freeze([0, i])));
/** 卡涅利安 S3 食噬之印: the ATK bonus climbs in 1 s steps over 20 s (PRTS 备注; the blackboard has no ramp time). */
const BILLRO_S3_RAMP = 20;
/** 卡涅利安 S3 charged mark: one buff per enemy, shared by every 卡涅利安 (PRTS 备注), ≤ 5 stacks (skill text). */
const BILLRO_MARK = 'billro:mark';
/** 阿罗玛's 非首次标记 (talent 起泡性能测试): one per enemy, shared by every 阿罗玛 (PRTS 备注). */
const AROMA_MARK = 'aroma:bubbled';
const BILLRO_MARK_MAX = 5;

// ---------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : d));
const tbb = (def, i) => (def && def.talents && def.talents[i] && def.talents[i].bb) || {};
/** Hidden module talent blackboard (name null, e.g. 水月 move_speed, 魔王 cnt/atk). */
const moduleBb = (def) => (def?.talents || []).filter((t) => !t.name && t.bb && Object.keys(t.bb).length).reduce((o, t) => Object.assign(o, t.bb), {});
const grid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);
/** Flat BAT change (s) → batPct. */
const batFlat = (def, v) => { const b = num(def?.stats?.bat, 1) || 1; return Math.max(-0.9, num(v, 0) / b); };
const tileKey = (u) => Math.round(u.y) * COLS + Math.round(u.x);
const nationOf = (u) => u?.def?.raw?.nationId ?? null;
const isAbyssal = (u) => u?.def?.raw?.groupId === 'abyssal' || ABYSSAL.has(u?.def?.charId ?? u?.def?.raw?.charId);
const enemyHasTag = (e, tag) => !!e && e.side === 'enemy' && Array.isArray(e.def?.tags) && e.def.tags.includes(tag);
const keySet = (unit) => unit.rangeKeySet || new Set(unit.rangeKeys || []);
/** Every living, visible enemy standing on the unit's range (ignores stealth/untargetable: auras, reveals). */
function enemiesOnRange(battle, unit, keys = null) {
  const set = keys || keySet(unit);
  const out = [];
  for (const e of battle.enemies) if (e.alive && !e.hidden && bodyInKeys(e, set)) out.push(e);
  return out;
}
/** Targetable enemies in the unit's current range (flyers included), best targets first. */
function targetsInRange(battle, unit, n = 0, keys = null) {
  const list = battle.enemiesInKeys(keys || unit.rangeKeys, unit, { canHitFly: true });
  sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}
/** Targetable enemies on the tiles of `g` (offsets) around the unit. */
function targetsInGrid(battle, unit, g) {
  return battle.unitsInGrid(unit, g, { side: 'enemy' }).filter((e) => canTargetEnemy(unit, e, { canHitFly: true }));
}
/** Run `fn` every `iv` s while the unit is alive and deployed. */
const whileDeployed = (battle, unit, iv, fn) => battle.every(iv, () => { if (unit.alive && unit.deployed) fn(); }, { owner: unit });
/** Short-lived aura buff. */
const pulse = (battle, target, key, mods, extra = {}) => battle.addBuff(target, { key, mods, duration: AURA_DUR, ...extra });
/** Keep (or remove) a permanent self buff. */
function toggleBuff(battle, unit, key, on, mods) {
  const cur = unit.findBuff(key);
  if (on) {
    if (!cur || JSON.stringify(cur.mods) !== JSON.stringify(mods)) battle.addBuff(unit, { key, mods });
  } else if (cur) battle.removeBuff(unit, key);
}
/** "技力光环（同类效果取最高）": shared key, highest value wins. */
function spAura(battle, source, value, filter) {
  whileDeployed(battle, source, AURA, () => {
    for (const a of battle.alliesFor(source, source.ownerId)) {
      if (!filter(a)) continue;
      const cur = a.findBuff('aura:spRecovery');
      if (cur && cur.source !== source && cur.source?.alive && (cur.data?.v ?? 0) > value) continue;
      battle.addBuff(a, { key: 'aura:spRecovery', mods: { spRecoveryFlat: value }, duration: AURA_DUR, source, data: { v: value } });
    }
  });
}
/**
 * 鼓舞 (ba.inspire "获得额外附加的基础属性加成（同类属性取最高）"): +`val` ATK (or max HP) on top of the target's own
 * percentage multipliers (the flat mod is compensated, so an ATK+% skill does not scale it), the strongest source wins
 * (the ATK key `inspire` is shared with tier6's 鼓舞); units flagged `mem.noInspire` (bards: 自身不受鼓舞影响) never
 * receive it. Refreshed by an aura: lapses within AURA_DUR once the source stops.
 */
function inspire(battle, target, val, src, stat = 'atk') {
  if (!(val > 0) || !target || !target.alive || target.mem?.noInspire) return;
  const key = stat === 'hp' ? 'inspire:hp' : 'inspire';
  const cur = target.findBuff(key);
  if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 1e-6) return;
  const { add, mul } = aggregateMods(target.buffs.filter((b) => b.key !== key));
  const f = stat === 'hp' ? Math.max(0, 1 + (add.hpPct ?? 0)) * (mul.hpMul ?? 1) : Math.max(0, 1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
  const flat = f > 1e-6 ? val / f : val;
  battle.addBuff(target, { key, mods: stat === 'hp' ? { hpFlat: flat } : { atkFlat: flat }, duration: AURA_DUR, source: src, visible: true, data: { src: src.id, val } });
}
/** Reveal stealthed enemies on the given tiles. */
/** RES cut mods for a blackboard magic_resistance value (battle.applyStrongest): |v| < 1 = ×(1 + v), else flat v. */
const resCut = (v) => (Math.abs(v) < 1 ? { resMul: Math.max(0, 1 + v) } : { resFlat: v });
const reveal = (battle, enemies) => { for (const e of enemies) if (e.s.flags.stealth) pulse(battle, e, 'aura:reveal', null, { flags: { reveal: true } }); };
/**
 * Knock-back of 力度 `force` away from `from` (a radial push, Battle.push: the official 力度 − 重量 distance — PRTS 推与拉;
 * user playtest #6 item 14). Returns the tiles moved.
 */
function shove(battle, e, from, force) {
  return e && e.alive ? battle.push(e, num(force, 0), { from }) : 0;
}
/**
 * Free tile for a summon/device: in the rect, standable, not reserved (Battle.isReservedTile: empty, no knocked-out
 * operator lying there) and not the home tile of any ally (dead ones redeploy there).
 */
function freeTile(battle, r, c, { ranged = false, ground = false } = {}) {
  if (!Number.isInteger(r) || !Number.isInteger(c) || !battle.grid.inRect(r, c)) return false;
  if (battle.isReservedTile(r, c)) return false;
  if (!battle.grid.canStand(r, c, { ranged })) return false;
  if (ground && !battle.grid.groundPassable(r, c)) return false;
  for (const u of battle.allyUnits) if (!u.removed && u.homeR === r && u.homeC === c && u.kind !== 'device') return false;
  return true;
}
const skillActive = (u) => !!(u.skill && u.skill.active && u.skill.kind !== 'passive');
/** HP at 0 (boss pool: pool HP) — a `damaged` hook sees the lethal hit before the kill, while the unit is still `alive`. */
const downed = (u) => (u.bossPool ? !(u.bossPool.hp > 0) : !(u.hp > 0));

// ---- operator loadouts (DESIGN §16) ----------------------------------------------------------------------------
// The kit function receives the def of the SELECTED skill / module: `bb` = that skill's blackboard (normal Lv4 /
// elite Lv7), `def.skill` its record, talents / trait already carry the selected module's changes. `skills` holds the
// hand-authored spec of every selectable non-default skill (only the selected one is built, with its own `bb`);
// install / talent logic that belongs to ONE skill is gated on that skill being the selected one.

/** Id of the selected skill. */
const selId = (def) => def?.skill?.id ?? def?.raw?.skill?.skillId ?? null;
/** Is `id` the selected skill? */
const isSel = (def, id) => selId(def) === id;
/** `skills` map of a kit: the spec of the selected skill when a builder exists for it (DESIGN §16 kit contract). */
function alt(def, builders) {
  const id = selId(def);
  return id && typeof builders[id] === 'function' ? { [id]: builders[id]() } : {};
}
/** Is module `id` the active one? (elites; `'none'` / normal chess ⇒ false) */
const moduleIs = (def, id) => !!(def?.raw?.module?.active && def.raw.module.id === id);
/** Instant or charges kind from the data (maxChargeTime). */
const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');
/** Enemy leaders / elites (精英或领袖敌人). */
const isEliteEnemy = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
/** No other ally operator / summon on the 4 (or 8) tiles around the unit. */
function lonely(battle, unit, diag = false) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((!dr && !dc) || (!diag && dr && dc)) continue;
      const r = unit.tileR + dr, c = unit.tileC + dc;
      if (!battle.grid.inBounds(r, c)) continue;
      const o = battle.unitAt(r, c);
      if (o && o !== unit && o.side === 'ally' && o.kind !== 'device') return false;
    }
  }
  return true;
}
/**
 * Permanent forward range extension (攻击距离 +n): every range, skill ranges included — except a skill whose range ignores
 * 攻击距离 (`targeting.noRangeExtend`). SPT-Y's "攻击距离+1（不受技能攻击范围变化影响）" reads, as PRTS 修正 it, "（部分技能不受
 * 此影响）" (原因: 语序颠倒、表述模糊) — 信仰搅拌机 S3 备注 "此技能的攻击范围不受'攻击距离'属性影响".
 */
const rangeUp = (battle, unit, n = 1) => battle.addBuff(unit, { key: 'module:range', mods: { rangeExtend: n }, persist: true, allowDead: true });
/**
 * Module "攻击范围扩大" given as a new range (the selected module's data-only talent `rangeGrid`, e.g. SPC-X / RIN-X:
 * the 3×3 caster range + ONE centre tile [0,3]). It replaces the unit's own range — so also the initial range of the
 * DEFAULT trigger — while a skill with its own range (莫斯提马 S3, 白面鸮 S2…) keeps that range, as in AK. Null when the
 * selected module (or 'none') changes no range. (The rangeGrid-only talent is dropped from `def.talents`: read the
 * module record.)
 */
function moduleRangeGrid(def) {
  const m = def?.raw?.module;
  if (!m || !m.active || !m.id) return null;
  const rec = (def.raw.modules || []).find((x) => x && x.uniEquipId === m.id);
  for (const t of rec?.talentChanges || []) { const g = grid(t?.rangeGrid); if (g) return g; }
  return null;
}
const applyModuleRange = (battle, unit, def) => { const g = moduleRangeGrid(def); if (g) { unit.rangeGrid = g; battle.refreshRange(unit); } };
/**
 * Pull `e` "至面前" of the unit with 力度 `force` (Battle.pullToFront: the official 拉力起点 half a tile ahead, 急停 0.6708
 * around it, 力度 − 重量 — weight ≤ force all the way, one heavier a third of the way, …); returns the distance moved.
 */
function pullToFront(battle, unit, e, force) {
  return e && e.alive ? battle.pullToFront(e, unit, num(force, 0)) : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// kits

const kits = {
  // ===== 信仰搅拌机 (shotprotector) S3 退休前布道 — ammo 30 counters; talents 扫射迎宾仪礼 / 架盾送客仪礼; module: reveal
  //       S1 铳骑主考官 (自动触发 ⇒ DEFAULT: next attack ×3 hits + reload an adjacent 拉特兰 ammo skill), S2 八臂电锯侠 (ammo;
  //       a fatal hit is blocked for `ammo_cost` bullets); module SPT-Y 老朋友: range +1 (not on S3's range, PRTS 备注)
  chess_char_4_01_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const counterMax = Math.max(1, Math.floor(num(bb['attack@max_target'], 3)));
    const counterRatio = num(bb.base_attack_time, 0.6); // 反击最小间隔 = 实际攻击间隔 × ratio (not a BAT change)
    const g = grid(def.skill?.rangeGrid);
    const S2 = isSel(def, 'skchr_rmixer_2'), S3 = isSel(def, 'skchr_rmixer_3');
    return {
      skills: alt(def, {
        // 铳骑主考官: the next attack is a triple hit of atk_scale each and reloads `charge` bullet(s) into ONE other
        // 拉特兰 operator around him (8 tiles, [ASSUMED] nearest first) whose ammo skill runs
        skchr_rmixer_1: () => ({
          kind: instantKind(def),
          attack: {
            atkScale: num(bb.atk_scale, 1.3), hits: 3,
            onHit({ battle, unit }) {
              const n = num(bb.charge, 1);
              const cand = battle.alliesInRadius(unit.x, unit.y, 1.5, unit.ownerId)
                .filter((a) => a !== unit && a.kind === 'op' && nationOf(a) === 'laterano' && a.skill && a.skill.active && a.skill.kind === 'ammo')
                .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y) || a.id - b.id);
              if (!cand[0] || !(n > 0)) return;
              cand[0].skill.addAmmo(n);
              battle.fx('reload', { x: cand[0].x, y: cand[0].y, id: cand[0].id, n });
            },
          },
        }),
        // 八臂电锯侠: ATK/DEF up, 42/45 bullets; the fatal-hit guard is installed below
        skchr_rmixer_2: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 42),
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          onStart({ battle, unit }) { battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 30),
        mods: { hpPct: num(bb.max_hp), atkPct: num(bb.atk), defPct: num(bb.def) },
        // 3-13 exactly: SPT-Y's 攻击距离+1 does not reach it (PRTS 备注; reviewer of community report E1 after 0.1.0)
        targeting: g ? { rangeGrid: g, noRangeExtend: true } : undefined,
        attack: { noAttack: true },                 // 停止主动攻击敌人 (ammo is spent by counters)
        onStart({ battle, unit }) {
          unit.mem.counterReady = -Infinity;
          for (const a of battle.allies(unit.ownerId)) {
            if (a === unit || a.kind !== 'op' || nationOf(a) !== 'laterano') continue;
            if (a.skill && a.skill.active && a.skill.kind === 'ammo') { a.skill.addAmmo(num(bb.ammo, 0)); battle.fx('reload', { x: a.x, y: a.y, id: a.id, n: num(bb.ammo, 0) }); }
          }
          battle.fx('sermon', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 扫射迎宾仪礼: every damage dealt → DEF +30 / ASPD +3 for 10 s, ≤ 3 stacks
          battle.on('damaged', (c) => {
            if (c.source !== unit || !unit.alive || c.target.side !== 'enemy' || !(c.amount > 0)) return;
            battle.addBuff(unit, { key: 'rmixer:t1', duration: num(t0.duration, 10), refresh: 'stack', maxStacks: Math.max(1, num(t0.max_stack_cnt, 3)),
              mods: { defFlat: num(t0.def), aspd: num(t0.attack_speed) } });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 架盾送客仪礼: no active attack for 8 s → shield 15 % max HP; timer restarts when it breaks
          const since = () => Math.max(unit.deployedAt, unit.mem.lastActiveAtk ?? -Infinity, unit.mem.shieldLostAt ?? -Infinity);
          battle.on('attack', (c) => { if (c.attacker === unit && !unit.mem.inCounter) unit.mem.lastActiveAtk = battle.time; }, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.lastActiveAtk = -Infinity; unit.mem.shieldLostAt = -Infinity; } }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => {
            if (unit.findBuff('rmixer:shield') || battle.time - since() < num(t1.interval, 8) - 1e-9) return;
            battle.addBuff(unit, { key: 'rmixer:shield', shield: unit.s.maxHp * num(t1.shield, 0.15), visible: true,
              onRemove: () => { unit.mem.shieldLostAt = battle.time; } });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
          });
        } },
      ],
      install(battle, unit) {
        if (S2) {
          // S2 "技能期间若受到致命伤害，立即消耗N发弹药抵挡这次伤害": the lethal hit is negated (HP back to its value
          // before the hit) and N bullets go; with fewer left it still blocks, spends them all and the skill ends (PRTS 备注
          // "弹药量不足时仍可抵挡致命伤害，此时将消耗所有剩余弹药并退出技能状态"). "自身持有不死时此效果不会生效": a 不死
          // that runs before it (骑士戒律, priority 20) has already prevented the hit; 坚固维式重锤's held window
          // (items/battle.js holdsUndying: this deployment's, not run out) runs last, so the guard steps aside while it lasts
          const cost = Math.max(1, Math.floor(num(bb.ammo_cost, 30)));
          battle.on('hit', (c) => { if (c.target === unit) unit.mem.rmixerPre = { dmg: c.dmg, hp: unit.hp }; }, { owner: unit, priority: -100 });
          battle.on('fatal', (c) => {
            const sk = unit.skill;
            if (c.unit !== unit || c.prevented || !sk || !sk.active || sk.kind !== 'ammo' || !(sk.ammoLeft > 0)) return;
            if (holdsUndying(battle, unit)) return;
            c.prevented = true;
            const pre = unit.mem.rmixerPre;
            unit.hp = pre && pre.dmg === c.dmg ? Math.max(1, Math.min(unit.s.maxHp, pre.hp)) : 1;
            const spent = Math.min(cost, sk.ammoLeft);
            sk.ammoLeft -= spent;
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, n: spent });
            if (sk.ammoLeft <= 0) sk.end('ammo');
          }, { owner: unit });
        }
        // module SPT-Y (elite, 老朋友): 攻击距离+1 — S1 / S2 keep it, S3's 3-13 does not (noRangeExtend above)
        if (num(def.traitBb?.ability_range_forward_extend, 0) > 0) rangeUp(battle, unit, num(def.traitBb.ability_range_forward_extend, 1));
        // module SPT-X (elite default): 攻击范围内敌人的隐匿效果失效
        if (moduleIs(def, 'uniequip_002_rmixer')) whileDeployed(battle, unit, AURA, () => reveal(battle, enemiesOnRange(battle, unit)));
        if (!S3) return;
        // S3 counter (PRTS 备注 "反击受到任何伤害后均可触发，无需目标，视为普通攻击，受各类无法触发普通攻击效果的影响"): ANY damage
        // she takes — an enemy's attack, a zone, the 无来源 源石溶剂 tick (items/battle.js periodic_damage) — fires one volley at
        // ≤ 3 enemies in range (the attacker first), at most once per actual interval × ratio. With no enemy in range the
        // counter still happens and spends its bullet (无需目标: the drain alone empties the skill — 莫斯提马's 特质 turns those
        // bullets into 拉特兰 layers, player report D1). A 流失 (Battle.loseHp, tag 'hpLoss': it skips every damage event —
        // PRTS 作战机制) and an element 损伤 never counter; stunned / disarmed: no counter
        battle.on('damaged', (c) => {
          const d = c.dmg;
          if (c.target !== unit || !unit.canAct || unit.s.flags.disarm || !skillActive(unit) || !d || c.type === 'element') return;
          if (isHpLoss(d)) return;
          if (battle.time < (unit.mem.counterReady ?? -Infinity) - 1e-9) return;
          const list = targetsInRange(battle, unit);
          const i = c.source ? list.indexOf(c.source) : -1;
          if (i > 0) { list.splice(i, 1); list.unshift(c.source); }
          const targets = list.slice(0, counterMax);
          unit.mem.counterReady = battle.time + unit.s.interval * counterRatio;
          unit.mem.inCounter = true;
          try {
            if (targets.length) battle.forceAttack(unit, targets);
            else { unit.stats.attacks++; unit.skill.onAttackPerformed([], true); } // a counter into nothing: its bullet goes
          } finally { unit.mem.inCounter = false; }
          battle.fx('counter', { x: unit.x, y: unit.y, id: unit.id, n: targets.length });
        }, { owner: unit });
      },
    };
  },

  // ===== 莫斯提马 (splashcaster) S3 序时之匙 — ripple hits all in range, +ATK, talent 2 ×3, small knock-back
  //       S1 攻击力强化·γ型; S2 荒时之锁 (every enemy in range stunned for the rest of the skill, 100 %/120 % ATK arts
  //       per second); module SPC-X (资深万国信使定制斗篷): 攻击范围扩大
  chess_char_4_02_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const g = grid(def.skill?.rangeGrid);
    const force = num(bb['attack@force'], num(bb.force, 0));
    const S3 = isSel(def, 'skchr_mostma_3');
    return {
      skills: alt(def, {
        'skcom_atk_up[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }),
        skchr_mostma_2: () => ({
          kind: 'duration',
          onStart({ battle, unit, skill }) {
            unit.mem.timeLock = { acc: 0, locked: new Set() };
            battle.fx('zone', { x: unit.x, y: unit.y, id: unit.id, duration: skill.duration });
          },
          onTick({ battle, unit, skill, dt }) {
            const L = unit.mem.timeLock;
            if (!L) return;
            // every enemy standing in her range (entering later too) is stunned until the skill ends
            for (const e of enemiesOnRange(battle, unit)) {
              if (L.locked.has(e.id)) continue;
              L.locked.add(e.id);
              battle.applyStatus(e, 'stun', { duration: Math.max(TICK_EPS, skill.timeLeft), source: unit });
            }
            L.acc += dt;
            while (L.acc + 1e-9 >= 1) {
              L.acc -= 1;
              for (const e of enemiesOnRange(battle, unit)) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'timeLock'] });
              }
            }
          },
          onEnd({ unit }) { unit.mem.timeLock = null; },
        }),
      }),
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module SPC-X: 攻击范围扩大 (module range grid)
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        targeting: { ...(g ? { rangeGrid: g } : {}), allInRange: true },
        attack: { projectile: 'none', splashRadius: 0, onHit({ battle, unit, target }) { if (target && target.alive) shove(battle, target, unit, force); } },
        onAttack({ battle, unit }) { battle.fx('ripple', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec, 0.4), (a) => a.def?.profession === 'CASTER'); } },
        { install(battle, unit) { // 主观缓时: enemies in range −15 % move speed (×talent_scale during S3)
          whileDeployed(battle, unit, AURA, () => {
            const v = num(t1.move_speed, -0.15) * (S3 && skillActive(unit) ? num(bb.talent_scale, 3) : 1);
            for (const e of enemiesOnRange(battle, unit)) pulse(battle, e, `mostma:slow:${unit.id}`, { moveMul: Math.max(0, 1 + v) }, { status: 'slow', visible: true });
          });
        } },
      ],
    };
  },

  // ===== 耶拉 (funnel, hidden) S2 心随意动 — +1 drone locking targets, ATK up, chance to chill; talent 低眉
  chess_char_4_03_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const n = 1 + Math.max(0, Math.floor(num(bb['attack@cnt'], 1)));
    const prob = num(bb['attack@prob'], 0), cold = num(bb['attack@cold'], 0);
    const funnel = (unit) => unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
    return {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        targeting: { maxTargets: n },
        attack: {
          // every drone ramps on its own locked target (trait init/delta/max): the multipliers are queued per target
          // by the beforeAttack hook below (two drones on the same enemy ramp independently)
          dmgMul: (battle, unit, target) => {
            const q = unit.mem.kjeraQueue && unit.mem.kjeraQueue.get(target.id);
            return q && q.length ? q.shift() : funnel(unit).init;
          },
          onHit({ battle, unit, target }) {
            if (target && target.alive && cold > 0 && battle.rng.chance(prob)) battle.applyStatus(target, 'cold', { duration: cold, source: unit });
          },
        },
        onStart({ battle, unit }) { unit.mem.kjeraDrones = []; unit.mem.kjeraQueue = new Map(); battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n }); },
        onEnd({ unit }) { unit.mem.kjeraDrones = []; unit.mem.kjeraQueue = null; },
      },
      talents: [{ install(battle, unit) { // 低眉: ATK +10 %, +16 % with ≥ 2 ground tiles in range
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          let low = 0;
          for (const k of unit.rangeKeys || []) if (battle.grid.isLow((k / COLS) | 0, k % COLS)) low++;
          const v = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'kjera:t1', mods: { atkPct: v } });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // n drones, each locked on its enemy until that enemy dies (while at least one enemy is in her range). A free
        // drone takes an enemy no other drone holds, else doubles up on the best target (a lone enemy/boss gets both).
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || !skillActive(unit)) return;
          const ok = (e) => !!e && e.alive && canTargetEnemy(unit, e, { canHitFly: true });
          const cands = c.targets.filter(ok);
          const drones = unit.mem.kjeraDrones || (unit.mem.kjeraDrones = []);
          const held = new Set();
          for (let i = 0; i < n; i++) { if (drones[i] && ok(drones[i].e)) held.add(drones[i].e); else drones[i] = null; }
          for (let i = 0; i < n; i++) {
            if (drones[i]) continue;
            const e = cands.find((x) => !held.has(x)) ?? cands[0] ?? drones.find((d) => d)?.e;
            if (!e) continue;
            held.add(e);
            drones[i] = { e, scale: null };
          }
          const f = funnel(unit);
          const q = unit.mem.kjeraQueue || (unit.mem.kjeraQueue = new Map());
          const out = [];
          for (const d of drones) {
            if (!d) continue;
            d.scale = d.scale == null ? f.init : Math.min(f.max, d.scale + f.delta);
            out.push(d.e);
            const l = q.get(d.e.id);
            if (l) l.push(d.scale); else q.set(d.e.id, [d.scale]);
          }
          if (out.length) c.targets = out;
        }, { owner: unit, priority: 10 });
        // queued multipliers of shots that never landed (target died mid-flight) are dropped with the target
        battle.on('death', (c) => { if (c.unit.side === 'enemy' && unit.mem.kjeraQueue) unit.mem.kjeraQueue.delete(c.unit.id); }, { owner: unit });
      },
    };
  },

  // ===== 伊内丝 (agent) S2 暗夜无明 — stealth, +ATK, +1 DP & steal ASPD per attack; talents 影织 / 影哨
  //       S1 淬影突袭 (next attack: 3 s arts DoT 40 %/55 % ATK per s, not stacking, +2 DP); S3 独影归途 (passive: the
  //       first deployment leaves a 影哨 and retreats with the redeploy timer refreshed; every deployment: ATK up for
  //       the skill duration, the sentry is recalled through ≤ 4/5 enemies for 110 %/140 % phys, +1 DP per damage)
  chess_char_4_04_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid);
    const step = num(bb['attack@steal_atk_speed'], 5), maxSteal = num(bb['attack@steal_atk_speed_max'], 50);
    const S3 = isSel(def, 'skchr_ines_3');
    const clearAspd = (battle, unit) => {
      for (const id of unit.mem.inesAspdVictims || []) { const e = battle.unitById(id); if (e) battle.removeBuff(e, `ines:aspd:${unit.id}`); }
      unit.mem.inesAspdVictims = [];
      unit.mem.inesAspd = 0;
      battle.removeBuff(unit, 'ines:aspdGain');
    };
    const s3Dur = num(def.skill?.duration, 11);
    return {
      skills: alt(def, {
        skchr_ines_1: () => ({
          kind: instantKind(def),
          attack: {
            onHit({ battle, unit, target }) {
              battle.addDp(unit.ownerId, num(bb.cost, 2));
              if (!target || !target.alive || target.side !== 'enemy') return;
              const scale = num(bb.bleed_atk_scale, 0.4);
              // （不叠加）: a new DoT replaces the running one
              battle.addBuff(target, { key: `ines:bleed:${unit.id}`, duration: num(bb.bleed_duration, 3) + 1e-6, interval: 1, source: unit, visible: true, refresh: 'extend',
                onTick: ({ unit: t }) => battle.dealDamage(unit, t, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'dot'] }) });
            },
          },
        }),
        skchr_ines_3: () => ({
          kind: 'duration', duration: s3Dur, spCost: 0, spType: 'none', trigger: 'NEVER',
          onStart({ battle, unit }) {
            battle.addBuff(unit, { key: 'ines:s3', mods: { atkPct: num(bb.atk) }, visible: true });
            // 立刻收回影哨: the sentry flies back to her and hits ≤ max_target enemies on its way (within
            // projectile_range of the segment, [ASSUMED] nearest to its start first)
            const from = unit.mem.inesSentryAt;
            if (!unit.mem.sentry || !from) return;
            unit.mem.sentry = null;
            unit.mem.inesSentryAt = null;
            const ax = from.x, ay = from.y, bx = unit.x, by = unit.y;
            const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
            const w = num(bb.projectile_range, 1.4);
            const hits = [];
            for (const e of battle.aliveEnemies()) {
              if (!canTargetEnemy(unit, e, { canHitFly: true })) continue;
              const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((e.x - ax) * (bx - ax) + (e.y - ay) * (by - ay)) / L2)) : 0;
              const d = bodyDist(e, ax + t * (bx - ax), ay + t * (by - ay));
              if (d <= w + 1e-9) hits.push({ e, t, d });
            }
            hits.sort((a, b) => a.t - b.t || a.d - b.d || a.e.id - b.e.id);
            const amount = unit.s.atk * num(bb.atk_scale, 1.1); // one projectile: ATK taken when it flies back
            for (const { e } of hits.slice(0, Math.max(1, Math.floor(num(bb.max_target, 4))))) {
              battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill', 'sentryRecall'] });
            }
            battle.fx('beam', { x: ax, y: ay, tx: bx, ty: by, id: unit.id });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, 'ines:s3'); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        flags: { stealth: true },
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) { clearAspd(battle, unit); battle.fx('stealth', { x: unit.x, y: unit.y, id: unit.id }); },
        onAttack({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost, 1)); },
        onHit({ battle, unit, target }) {
          if (!target || !target.alive || target.side !== 'enemy') return;
          const room = maxSteal - (unit.mem.inesAspd ?? 0);
          if (room <= 0) return;
          const s = Math.min(step, room);
          unit.mem.inesAspd = (unit.mem.inesAspd ?? 0) + s;
          const key = `ines:aspd:${unit.id}`;
          const cur = target.findBuff(key);
          battle.addBuff(target, { key, mods: { aspd: (cur?.mods?.aspd ?? 0) - s }, source: unit });
          if (!(unit.mem.inesAspdVictims ||= []).includes(target.id)) unit.mem.inesAspdVictims.push(target.id);
          battle.addBuff(unit, { key: 'ines:aspdGain', mods: { aspd: unit.mem.inesAspd } });
        },
        onEnd({ battle, unit }) { clearAspd(battle, unit); },
      },
      talents: [
        { install(battle, unit) { // 影织: first damage on each enemy → bind 5 s + steal 90 ATK until it dies or Ines leaves
          unit.mem.woven = new Set();
          unit.mem.atkVictims = [];
          const refresh = () => {
            unit.mem.atkVictims = unit.mem.atkVictims.filter((id) => battle.unitById(id)?.alive);
            const gain = Math.min(num(t0.steal_atk_max, Infinity), num(t0.steal_atk, 90) * unit.mem.atkVictims.length);
            if (unit.alive) { if (gain > 0) battle.addBuff(unit, { key: 'ines:atkGain', mods: { atkFlat: gain } }); else battle.removeBuff(unit, 'ines:atkGain'); }
          };
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !unit.alive || e.side !== 'enemy' || c.type === 'element' || unit.mem.woven.has(e.id)) return;
            unit.mem.woven.add(e.id);
            if (!e.alive) return;
            battle.applyStatus(e, 'bind', { duration: num(t0.duration, 5), source: unit });
            battle.addBuff(e, { key: `ines:atkSteal:${unit.id}`, mods: { atkFlat: -num(t0.steal_atk, 90) }, source: unit });
            unit.mem.atkVictims.push(e.id);
            refresh();
            battle.fx('shadowWeave', { x: e.x, y: e.y, id: e.id });
          }, { owner: unit });
          battle.on('death', (c) => {
            if (c.unit.side === 'enemy' && unit.mem.atkVictims.includes(c.unit.id)) refresh();
            if (c.unit !== unit) return;
            for (const id of unit.mem.atkVictims) { const e = battle.unitById(id); if (e) battle.removeBuff(e, `ines:atkSteal:${unit.id}`); }
            unit.mem.atkVictims = [];
            unit.mem.woven = new Set();
          }, { owner: unit });
        } },
        { install(battle, unit) { // 影哨: reveal + −30 % move speed in range; a sentry keeps it after she leaves (max 1)
          const mods = { moveMul: Math.max(0, 1 + num(t1.move_speed, -0.3)) };
          battle.on('death', (c) => {
            if (c.unit !== unit || c.reason === 'expired') return;
            unit.mem.sentry = new Set(unit.baseRangeKeys || unit.rangeKeys || []);
            battle.fx('sentry', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
          battle.every(AURA, () => {
            const set = new Set();
            if (unit.alive && unit.deployed) for (const k of unit.rangeKeys || []) set.add(k);
            if (unit.mem.sentry) for (const k of unit.mem.sentry) set.add(k);
            if (!set.size) return;
            for (const e of enemiesOnRange(battle, unit, set)) pulse(battle, e, `ines:sentry:${unit.id}`, mods, { flags: { reveal: true } });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (S3) {
          battle.on('deploy', (c) => {
            if (c.unit !== unit || c.move) return;
            if (unit.mem.inesS3Placed) {
              unit.skill.activate('deploy');
              return;
            }
            // 首次部署 only places a 影哨 and retreats; it is not a skill activation.
            // 立刻刷新再部署时间: redeploy as soon as its DP cost is affordable.
            unit.mem.inesS3Placed = true;
            battle.after(0, () => {
              if (!unit.alive || !unit.deployed) return;
              battle.retreat(unit, { reason: 'retreat' });
              unit.respawnAt = battle.time;
              battle.fx('sentry', { x: unit.x, y: unit.y, id: unit.id });
            }, { owner: unit });
          }, { owner: unit });
          // where the talent's 影哨 stays (every leave but an expiry), for the recall of the next deployment
          battle.on('death', (c) => { if (c.unit === unit && c.reason !== 'expired') unit.mem.inesSentryAt = { x: unit.x, y: unit.y }; }, { owner: unit, priority: 5 });
          // 技能期间每对一个敌人造成伤害就获得1点部署费用
          battle.on('damaged', (c) => {
            if (c.source !== unit || c.target.side !== 'enemy' || !(c.amount > 0) || c.type === 'element' || !unit.skill?.active || !(unit.skill.timeLeft > 0)) return;
            battle.addDp(unit.ownerId, num(bb.cost, 1));
          }, { owner: unit });
        }
        // module (elite): the first retreat's redeploy time is 35 % shorter
        const rt = num(tb.respawn_time, 0);
        if (!rt) return;
        battle.on('death', (c) => {
          if (c.unit !== unit || unit.mem.firstRetreatDone || !Number.isFinite(unit.respawnAt)) return;
          unit.mem.firstRetreatDone = true;
          unit.respawnAt = unit.deathAt + (unit.respawnAt - unit.deathAt) * Math.max(0, 1 + rt);
        }, { owner: unit });
      },
    };
  },

  // ===== 蜜蜡 (phalanx, hidden) S2 守卫尖碑 — obelisk on a melee tile in range: 200 % arts burst + stun, blocks 3
  chess_char_4_05_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const tokenId = def.raw?.skill?.overrideTokenKey ?? (def.tokens || [])[0] ?? 'token_10011_beewax_oblisk';
    const keepDef = num(tb['soil_e_002[buff].def'], 0), keepRes = num(tb['soil_e_002[buff].magic_resistance'], 0);
    const obeliskKit = { skill: null, talents: [], trait: { noAttack: true } };
    return {
      skill: {
        kind: 'duration',
        onStart({ battle, unit }) {
          if (keepDef || keepRes) battle.addBuff(unit, { key: 'beewax:keep', mods: { defPct: keepDef, resFlat: keepRes } });
          // melee deploy tile in range: nearest to the most advanced enemy (path tile first)
          const foes = targetsInRange(battle, unit);
          const ref = foes[0] || battle.aliveEnemies().filter((e) => !e.hidden).sort((a, b) => battle.remainingDistance(a) - battle.remainingDistance(b))[0] || unit;
          let best = null, bd = Infinity;
          for (const k of unit.rangeKeys || []) {
            const r = (k / COLS) | 0, c = k % COLS;
            if (!freeTile(battle, r, c)) continue;
            const d = Math.hypot(c - ref.x, r - ref.y) + (battle.grid.groundPassable(r, c) ? 0 : 5);
            if (d < bd - 1e-9) { bd = d; best = [r, c]; }
          }
          if (!best) return;
          const tok = battle.tokenDef(tokenId, unit); // the owner's skill / module variant (DESIGN §16)
          const dur = num(tok?.talents?.[0]?.bb?.duration, num(def.skill?.duration, 20));
          const ob = battle.spawnToken(unit, tokenId, best[0], best[1], { duration: dur, kit: obeliskKit });
          if (!ob) return;
          unit.mem.obelisk = ob;
          battle.fx('obelisk', { x: ob.x, y: ob.y, id: ob.id });
          const tokGrid = grid(tok?.skill?.rangeGrid) || [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]];
          for (const e of targetsInGrid(battle, ob, tokGrid)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 2), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 1), source: unit });
          }
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'beewax:keep'); },
      },
      talents: [{ install(battle, unit) { // 沙原的庇护: +4 % max HP/s while the skill is off
        const set = () => toggleBuff(battle, unit, 'beewax:regen', unit.alive && !skillActive(unit), { hpRegenRatio: num(t0.hp_recovery_per_sec_by_max_hp_ratio, 0.04) });
        for (const ev of ['deploy', 'skillStart', 'skillEnd']) battle.on(ev, (c) => { if (c.unit === unit) set(); }, { owner: unit });
      } }],
    };
  },

  // ===== 寒芒克洛丝 (fastshot) S2 封喉 — double shot → 4 shots after 40 hits; talent 中的 (20 % ×1.5 + 0.2 s stun)
  //       S1 无痕 (ATK up, double shot, 迷彩 = the engine's `camou` flag: only an enemy she blocks targets her)
  chess_char_4_06_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const need = num(bb['attack@max_stack_count'], 40);
    const S2 = isSel(def, 'skchr_kroos2_2');
    return {
      skills: alt(def, {
        skchr_kroos2_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          flags: { camou: true },
          attack: { hits: 2 },
          onStart({ battle, unit }) { battle.fx('camouflage', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { batPct: batFlat(def, bb.base_attack_time) },
        attack: { hitsFn: (battle, unit) => ((unit.mem.kroosHits ?? 0) >= need ? 4 : 2) },
        onStart({ unit }) { unit.mem.kroosHits = 0; },
      },
      talents: [{ install(battle, unit) {
        // 中的: the ×1.5 is rolled before mitigation; the stun (and the S2 "击中目标" count) only for shots that landed
        const crits = new WeakSet();
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.dmg.isAttack || c.target.side !== 'enemy') return;
          if (battle.rng.chance(num(t0.prob, 0.2))) { c.dmg.mul *= num(t0.atk_scale, 1.5); crits.add(c.dmg); }
        }, { owner: unit });
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.dmg || !c.dmg.isAttack || c.target.side !== 'enemy') return;
          if (S2 && skillActive(unit)) {
            unit.mem.kroosHits = (unit.mem.kroosHits ?? 0) + 1;
            if (unit.mem.kroosHits === need) battle.fx('quadShot', { x: unit.x, y: unit.y, id: unit.id });
          }
          if (!crits.has(c.dmg)) return;
          crits.delete(c.dmg);
          if (c.target.alive) battle.applyStatus(c.target, 'stun', { duration: num(t0.stun, 0.2), source: unit });
          battle.fx('crit', { x: c.target.x, y: c.target.y, id: c.target.id });
        }, { owner: unit });
      } }],
    };
  },

  // ===== 风笛 (charger) S2 高效冲击 — next attack 145 % ×2 (charges); talents 精密填弹 / 军事传统
  //       S1 迅捷打击·γ型; S3 闭膛连发 (BAT +0.7 s, block +1, ATK/DEF up, triple hits); module CHG-Y (“棍棒与口袋”):
  //       attacks on enemies below 40 % HP use 115 % ATK
  chess_char_4_07_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    return {
      skills: alt(def, {
        'skcom_quickattack[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } }),
        skchr_bpipe_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt, 1), batPct: batFlat(def, bb.base_attack_time) },
          attack: { hits: 3 },
          onStart({ battle, unit }) { battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      install(battle, unit) {
        const hr = num(tb.hp_ratio, 0), sc = num(tb.atk_scale, 0);
        if (!(hr > 0) || !(sc > 0)) return;
        battle.on('hit', (c) => { // 攻击力提升至115% (before mitigation)
          if (c.source === unit && c.dmg.isAttack && c.target.side === 'enemy' && c.target.hpRatio < hr) c.dmg.amount *= sc;
        }, { owner: unit });
      },
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        attack: { atkScale: num(bb.atk_scale, 1.45), hits: 2 },
        onStart({ battle, unit }) { battle.fx('charge', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { // 精密填弹: 25 % → ×1.3 and one extra target
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit) return;
            unit.mem.bpBoost = battle.rng.chance(num(t0.prob, 0.25));
            if (!unit.mem.bpBoost) return;
            const extra = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile).filter((e) => !c.targets.includes(e));
            sortEnemyTargets(battle, unit, extra, c.profile?.priority ?? null);
            if (extra[0]) c.targets = [...c.targets, extra[0]];
          }, { owner: unit });
          battle.on('hit', (c) => { if (c.source === unit && c.dmg.isAttack && unit.mem.bpBoost) c.dmg.mul *= num(t0.atk_scale, 1.3); }, { owner: unit });
          battle.on('attack', (c) => { if (c.attacker === unit) unit.mem.bpBoost = false; }, { owner: unit });
        } },
        { install(battle, unit) { // 军事传统: every 先锋 of the team starts with +6 SP
          battle.on('deploy', (c) => {
            const u = c.unit;
            if (u.side !== 'ally' || u.kind !== 'op' || u.ownerId !== unit.ownerId || u.def?.profession !== 'PIONEER' || !u.skill || (u.skill.active && u.skill.isTimed)) return;
            u.skill.gainSp(num(t1.sp, 6), 'init');
          }, { owner: unit });
        } },
      ],
    };
  },

  // ===== 瑰盐 (ringhealer, hidden) S2 绝妙的长效药呀 — allies in range: 20 % of phys/arts damage → 5 s HP loss
  chess_char_4_08_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const scale = num(bb['attack@damage_scale'], 0.8), fin = num(bb['attack@final_duration'], 5), iv = Math.max(0.1, num(bb['attack@interval'], 1));
    return {
      skill: { kind: 'duration', heal: true, mods: { batPct: batFlat(def, bb.base_attack_time) },
        onStart({ battle, unit }) { battle.fx('saltWard', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { // 最好的草药医生: own ATK −5 %, operators in range receive +15 % healing
        battle.addBuff(unit, { key: 'rosesa:t1', mods: { atkPct: num(t0.atk, -0.05) }, persist: true, allowDead: true });
        whileDeployed(battle, unit, AURA, () => {
          for (const a of battle.alliesInGrid(unit)) if (a.kind === 'op') pulse(battle, a, `rosesa:heal:${unit.id}`, { healingTakenMul: num(t0.heal_scale, 1.15) });
        });
      } }],
      install(battle, unit) {
        const deferred = new WeakSet();
        battle.on('hit', (c) => {
          const t = c.target;
          // "友方干员": operators only (summons/devices keep the full hit)
          if (!skillActive(unit) || !unit.alive || t.side !== 'ally' || t.kind !== 'op' || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
          if (!keySet(unit).has(t.tileR * COLS + t.tileC)) return;
          c.dmg.mul *= scale;
          deferred.add(c.dmg);
        }, { owner: unit, priority: -5 });
        battle.on('damaged', (c) => {
          if (!deferred.has(c.dmg) || !(c.amount > 0) || !c.target.alive) return;
          deferred.delete(c.dmg);
          const total = (c.amount * (1 - scale)) / Math.max(1e-6, scale);
          const per = total / Math.max(1, Math.round(fin / iv));
          const src = c.source;
          battle.addBuff(c.target, { key: 'rosesa:dot', refresh: 'independent', maxStacks: 1000, duration: fin + 1e-6, interval: iv,
            onTick: ({ unit: tgt }) => battle.loseHp(tgt, per, { source: src && src.side === 'enemy' ? src : null }) });
        }, { owner: unit });
        // module (elite) RIN-X: 攻击范围扩大 (module range grid)
        applyModuleRange(battle, unit, def);
      },
    };
  },

  // ===== 水月 (stalker) S2 囚徒困境 — faster, +ATK, talent 1 +1 target & bind; talents 创伤性癔症 / 反移情; module slow
  //       S1 唤醒 (charges: next attack 200 %/230 %, talent 1 ×2.0/×2.3); S3 镜花水月 (wider range, ATK up, talent 1 +2
  //       targets & stun; an attack hitting < 3 enemies costs 15 % max HP); modules: AMB-Y 65 % dodge (trait, profession)
  chess_char_4_09_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const S1 = isSel(def, 'skchr_mizuki_1'), S2 = isSel(def, 'skchr_mizuki_2'), S3 = isSel(def, 'skchr_mizuki_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_mizuki_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 2) } }),
        skchr_mizuki_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit }) { battle.fx('ripple', { x: unit.x, y: unit.y, id: unit.id }); },
          onAttack({ battle, unit, targets }) {
            if ((targets || []).filter((e) => e.side === 'enemy').length >= 3) return;
            battle.loseHp(unit, unit.s.maxHp * num(bb['attack@hp_ratio'], 0.15), { tags: ['skill', 'selfLoss'] }); // (no source: not damage dealt)
          },
        }),
      }),
      skill: { kind: 'duration', mods: { batPct: batFlat(def, bb.base_attack_time), atkPct: num(bb.atk) },
        onStart({ battle, unit }) { battle.fx('dilemma', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [
        { install(battle, unit) { // 创伤性癔症: +50 % ATK arts to the lowest-HP enemy hit (S2 +1 target & bind, S3 +2 & stun, S1 ×2)
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.alive) return;
            const act = skillActive(unit) && (S2 || S3);
            const n = Math.max(1, Math.floor(num(t0['attack@max_target'], 1))) + (act ? Math.floor(num(bb['attack@max_target'], 1)) : 0);
            const mul = S1 && c.isSkill ? num(bb.talent_scale, 2) : 1;
            const list = c.targets.filter((e) => e.alive && e.side === 'enemy').sort((a, b) => a.hp - b.hp || a.id - b.id).slice(0, n);
            for (const e of list) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0['attack@mizuki_t_1.atk_scale'], 0.5) * mul, type: 'arts', tags: ['talent'] });
              if (!act || !e.alive) continue;
              if (S2) battle.applyStatus(e, 'bind', { duration: num(bb['attack@unmovable'], 0.8), source: unit });
              else battle.applyStatus(e, 'stun', { duration: num(bb['attack@stun'], 0.7), source: unit });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 反移情: ATK +10 % while an enemy in range is below 50 % HP
          whileDeployed(battle, unit, 0.1, () => {
            const on = enemiesOnRange(battle, unit).some((e) => e.hpRatio < num(t1.hp_ratio, 0.5));
            toggleBuff(battle, unit, 'mizuki:t2', on, { atkPct: num(t1.atk, 0.1) });
          });
        } },
      ],
      install(battle, unit) {
        const ms = num(mb.move_speed, 0);
        if (ms) whileDeployed(battle, unit, AURA, () => { for (const e of enemiesOnRange(battle, unit)) pulse(battle, e, `mizuki:slow:${unit.id}`, { moveMul: Math.max(0, 1 + ms) }); });
      },
    };
  },

  // ===== 阿罗玛 (blastcaster) S2 小心地滑 — +ATK, levitated enemies take 65 % ATK arts on landing; talent 起泡性能测试
  //       S1 强效清洁 (charges: next attack 150 %/180 % arts, flying victims +55 %/70 % ATK arts)
  chess_char_4_10_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const land = num(bb['attack@atk_scale_when_fly_finish'], 0.65);
    const S2 = isSel(def, 'skchr_aroma_2');
    return {
      skills: alt(def, {
        skchr_aroma_1: () => ({
          kind: instantKind(def),
          attack: {
            atkScale: num(bb.atk_scale, 1.5),
            onEachHit({ battle, unit, target }) { // every enemy of her line the blast strikes that flies
              if (target && target.alive && target.isFlying) battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb.atk_scale_to_fly, 0.55), type: 'arts', isSkill: true, tags: ['skill', 'antiAir'] });
            },
          },
        }),
      }),
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk) }, onStart({ battle, unit }) { battle.fx('slippery', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { // first attack on each enemy: ×1.1 and levitate 2.5 s
        // PRTS 阿罗玛 备注: "天赋采用施加非首次标记的方式判断是否为'首次进行攻击'，自身离场时移除自身已施加的标记，不同阿罗玛之间的
        // 非首次标记通用" — one mark per enemy (AROMA_MARK, the setter as source) for every 阿罗玛; hers go when she leaves
        // the field (until 0.1.1 each 阿罗玛 kept her own list, so two of them both triggered on one enemy)
        unit.mem.bubbled = new Set(); // the enemies she marked
        battle.on('hit', (c) => {
          const e = c.target;
          if (c.source !== unit || !c.dmg.isAttack || e.side !== 'enemy' || e.findBuff(AROMA_MARK)) return;
          battle.addBuff(e, { key: AROMA_MARK, source: unit });
          unit.mem.bubbled.add(e.id);
          c.dmg.mul *= num(t0.damage_scale, 1.1);
          if (battle.applyStatus(e, 'levitate', { duration: num(t0.levitate_duration, 2.5), source: unit })) battle.fx('levitate', { x: e.x, y: e.y, id: e.id });
        }, { owner: unit });
        battle.on('death', (c) => {
          if (c.unit !== unit) return;
          for (const id of unit.mem.bubbled) {
            const e = battle.unitById(id);
            if (e && e.findBuff(AROMA_MARK)?.source === unit) battle.removeBuff(e, AROMA_MARK);
          }
          unit.mem.bubbled.clear();
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // S2: landing damage for every levitated enemy (any source) that lands inside her range while the skill runs
        const floating = new Map();
        battle.on('statusApplied', (c) => { if (c.status === 'levitate' && c.target.side === 'enemy') floating.set(c.target.id, c.target); }, { owner: unit });
        battle.every(1 / 30, () => {
          for (const [id, e] of floating) {
            if (!e.alive) { floating.delete(id); continue; }
            if (e.findBuff('levitate')) continue;
            floating.delete(id);
            if (S2 && unit.alive && unit.deployed && skillActive(unit) && bodyInKeys(e, keySet(unit))) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * land, type: 'arts', isSkill: true, tags: ['skill', 'landing'] });
              battle.fx('splash', { x: e.x, y: e.y, id: e.id });
            }
          }
        }, { owner: unit });
        // module (elite) trait: farther targets take more damage (up to ×1.1)
        const ds = num(tb.damage_scale, 0);
        if (ds > 0) {
          const lo = num(tb.min_dist, 0), hi = num(tb.max_dist, 4);
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg.isAttack) return;
            const d = Math.hypot(c.target.x - unit.x, c.target.y - unit.y);
            c.dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo)));
          }, { owner: unit });
        }
      },
    };
  },

  // ===== 凯瑟琳 (craftsman) S2 战火淬炼 — stops attacking, HP/DEF up, devices give 6 %/s shields; talent 定向支援信号
  //       "携带3个支援装置（最多部署2个）": the 爬行号·防护单元 are hand pieces (2 = the deploy limit) the player places and
  //       turns towards an operator (user playtest #6, PRTS 卫戍协议/帮助 §战斗部署); they deploy with the board and the
  //       token kit (tokens.js catShield) gives the shields — S2 overwrite_ratio per second while this skill runs — so
  //       this kit places nothing (none placed ⇒ no device).
  //       S1 岁月锻打 (passive: she and every other operator holding a device shield ATK/DEF +8 %/+11 %); module CRA-X
  //       carries one more device (talent cnt, data — a spare the hand never shows)
  chess_char_4_11_a: (bb, chess, def) => ({
    skills: alt(def, {
      skchr_cathy_1: () => ({
        kind: 'passive',
        mods: { atkPct: num(bb.s1_atk), defPct: num(bb.s1_def) },
        onStart({ battle, unit }) {
          unit.mem.forgeAura?.cancel();
          unit.mem.forgeAura = whileDeployed(battle, unit, AURA, () => {
            for (const a of battle.allies(unit.ownerId)) {
              if (a === unit || a.kind !== 'op' || !a.findBuff(CAT_SHIELD_KEY)) continue;
              pulse(battle, a, `cathy:forge:${unit.id}`, { atkPct: num(bb.s1_atk), defPct: num(bb.s1_def) });
            }
          });
        },
      }),
    }),
    skill: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp), defPct: num(bb.def) },
      attack: { noAttack: true },
      onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
    },
  }),

  // ===== 歌蕾蒂娅 (hookmaster) S3 缺水的碎漩狂舞 — bind a far target, tornado: slow, 85 % arts pulses + pull, final pull
  //       S1 缺水的大洋裂断 (charges: next attack pulls the target to her front, 150 %/180 %); S2 缺水的掌握怒海 (BAT +0.5 s,
  //       wider range, ≤ 2 targets — blocked first — at 135 %/150 % and pulled to her front); module HOK-Y (淡金坠饰):
  //       a pull towards herself of an enemy farther than 2.5 tiles is one force level stronger
  chess_char_4_12_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const tb = def.traitBb || {};
    const R = 1.5; // [ASSUMED] tornado radius (no blackboard key)
    const force = num(bb.force, num(bb['attack@force'], 0));
    const iv = Math.max(0.1, num(bb.interval, 1.5));
    const g = grid(def.skill?.rangeGrid);
    const dragDmg = (battle, unit, e, moved) => { // module: dragged enemies take arts damage ∝ distance
      if (!(moved > 0) || !(num(tb.value, 0) > 0) || !e.alive) return;
      battle.dealDamage(unit, e, { amount: num(tb.value) * moved / Math.max(1e-6, num(tb.dist, 1)), type: 'arts', isSkill: true, tags: ['drag'] });
    };
    // module HOK-Y: "向自身拖拽较远的敌人时力度提升一个等级"
    const farR = num(mb['skill@range_radius'], num(mb['attack@range_radius'], 0)), farF = num(mb['skill@delta_force'], num(mb['attack@delta_force'], 0));
    const selfForce = (unit, e, f) => (farR > 0 && farF > 0 && Math.hypot(e.x - unit.x, e.y - unit.y) > farR + 1e-9 ? f + farF : f);
    const pullSelf = (battle, unit, e, f) => { if (e && e.alive) dragDmg(battle, unit, e, pullToFront(battle, unit, e, selfForce(unit, e, f))); };
    return {
      skills: alt(def, {
        skchr_glady_1: () => ({
          kind: instantKind(def),
          attack: { atkScale: num(bb.atk_scale, 1.5), onHit({ battle, unit, target }) { pullSelf(battle, unit, target, num(bb.force, 1)); } },
        }),
        skchr_glady_2: () => ({
          kind: 'duration',
          mods: { batPct: batFlat(def, bb.base_attack_time) },
          // (target sorting already puts the enemies she blocks first)
          targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))) },
          attack: { atkScale: num(bb['attack@atk_scale'], 1.35), onEachHit({ battle, unit, target }) { pullSelf(battle, unit, target, num(bb['attack@force'], 1)); } },
          onStart({ battle, unit }) { battle.fx('wake', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        onStart({ battle, unit, skill }) {
          const foes = targetsInRange(battle, unit).sort((a, b) => bodyDist(b, unit.x, unit.y) - bodyDist(a, unit.x, unit.y) || a.id - b.id);
          const t = foes[0];
          unit.mem.tornado = t ? { x: t.x, y: t.y, acc: 0 } : null;
          if (!t) return;
          battle.applyStatus(t, 'bind', { duration: skill.duration, source: unit });
          battle.fx('tornado', { x: t.x, y: t.y, id: unit.id, r: R, duration: skill.duration });
        },
        onTick({ battle, unit, dt }) {
          const T = unit.mem.tornado;
          if (!T) return;
          const inside = battle.foesInRadius(T.x, T.y, R);
          for (const e of inside) pulse(battle, e, `glady:slow:${unit.id}`, { moveMul: Math.max(0, 1 + num(bb.move_speed, -0.5)) });
          T.acc += dt;
          if (T.acc + 1e-9 < iv) return;
          T.acc -= iv;
          for (const e of inside) {
            if (!e.alive || e.s.flags.untargetable) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 0.85), type: 'arts', isSkill: true, tags: ['skill', 'tornado'] });
            // "小力地拖拽至中心": a pull to the marked point (PRTS 推与拉: its 6 tornado pulls stop 0.05 from it)
            if (e.alive) dragDmg(battle, unit, e, battle.pull(e, force, { to: T, stop: 0.05 }));
          }
          battle.fx('tornadoPulse', { x: T.x, y: T.y, id: unit.id, r: R });
        },
        onEnd({ battle, unit, reason }) {
          const T = unit.mem.tornado;
          unit.mem.tornado = null;
          if (!T || reason === 'death' || !unit.alive) return;
          for (const e of battle.foesInRadius(T.x, T.y, R)) pullSelf(battle, unit, e, force);
          battle.fx('pull', { x: T.x, y: T.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 阿戈尔的波涛: 深海猎人 regen 2.5 %/s, −25 % phys/arts damage from 海怪
          whileDeployed(battle, unit, AURA, () => {
            for (const a of battle.allies(unit.ownerId)) if (isAbyssal(a)) pulse(battle, a, 'glady:tide', { hpRegenRatio: num(t0.hp_recovery_per_sec_by_max_hp_ratio, 0.025) });
          });
          battle.on('hit', (c) => {
            if (!c.target.findBuff?.('glady:tide') || !enemyHasTag(c.source, 'seamonster') || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
            c.dmg.mul *= 1 - num(t0.damage_resistance, 0.25);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 弱肉强食: ×1.3 against enemies of weight ≤ 3
          battle.on('hit', (c) => {
            if (c.source === unit && c.dmg.isAttack && c.target.side === 'enemy' && c.target.s.massLevel <= num(t1.value, 3)) c.dmg.mul *= num(t1.atk_scale, 1.3);
          }, { owner: unit });
        } },
      ],
    };
  },

  // ===== 灵知 (underminer) S2 零度爆发 — charges: 130 % arts + cold to all in range, charged ⇒ 2nd cold; 坚冰 / 殊途同归
  //       S1 高速思考 (next attack: 2 × 135 %/150 % arts); S3 失温症 (ASPD up, 2 targets — unfrozen first; frozen enemies
  //       in range stay frozen until the skill ends, then take 300 %/400 % arts and thaw); module UMD-Y (一号项目模型):
  //       +0.25 SP/s while an elite / leader enemy is in range
  chess_char_4_13_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S3 = isSel(def, 'skchr_gnosis_3');
    const frozen = (e) => !!e.findBuff('freeze');
    return {
      skills: alt(def, {
        skchr_gnosis_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 1.35), hits: 2 } }),
        skchr_gnosis_3: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(bb.max_target, 2))) },
          onStart({ battle, unit }) { unit.mem.hypothermia = new Set(); battle.fx('coldWind', { x: unit.x, y: unit.y, id: unit.id }); },
          onTick({ battle, unit, skill }) {
            const H = unit.mem.hypothermia;
            if (!H) return;
            // 范围内所有敌人的冻结延长至技能结束
            for (const e of enemiesOnRange(battle, unit)) {
              const f = e.findBuff('freeze');
              if (!f) continue;
              H.add(e.id);
              if (f.timeLeft < skill.timeLeft) { f.timeLeft = skill.timeLeft; f.duration = Math.max(f.duration, skill.timeLeft); }
            }
          },
          onEnd({ battle, unit, reason }) {
            const H = unit.mem.hypothermia;
            unit.mem.hypothermia = null;
            if (!H || reason === 'death' || !unit.alive) return;
            // 技能结束时对所有冻结的敌人造成N%的法术伤害并结束冻结 (the frozen enemies of her range)
            const list = enemiesOnRange(battle, unit).filter(frozen);
            for (const id of H) { const e = battle.unitById(id); if (e && e.alive && frozen(e) && !list.includes(e)) list.push(e); }
            for (const e of list) {
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 3), type: 'arts', isSkill: true, tags: ['skill', 'shatter'] });
              if (e.alive) battle.removeStatus(e, 'freeze');
            }
            battle.fx('iceSpike', { x: unit.x, y: unit.y, id: unit.id, n: list.length });
          },
        }),
      }),
      install(battle, unit) {
        if (S3) {
          // 优先攻击未冻结的单位 (while S3 runs)
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillActive(unit)) return;
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile);
            for (const e of battle.blockedTargets(unit, c.profile)) if (!cands.includes(e)) cands.push(e); // DESIGN §20.3
            if (cands.length <= 1) return;
            sortEnemyTargets(battle, unit, cands, c.profile?.priority ?? null);
            const n = Math.max(1, Math.floor((c.profile?.maxTargets || 1) + unit.s.maxTargets));
            c.targets = [...cands.filter((e) => !frozen(e)), ...cands.filter(frozen)].slice(0, n);
          }, { owner: unit, priority: 5 });
        }
        const sp = num(tb.sp_recovery_per_sec, 0); // module UMD-Y
        if (sp > 0) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'gnosis:module', enemiesOnRange(battle, unit).some(isEliteEnemy), { spRecoveryFlat: sp }));
      },
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        onStart({ battle, unit, skill }) {
          const charged = skill.maxCharges > 1 && skill.charges + 1 >= skill.maxCharges; // cast with every charge stored
          for (const e of targetsInRange(battle, unit)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.3), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            if (!e.alive) continue;
            battle.applyStatus(e, 'cold', { duration: num(bb.cold, 2.5), source: unit });
            if (charged && e.alive) battle.applyStatus(e, 'cold', { duration: num(bb.cold, 2.5), source: unit });
          }
          battle.fx('frostNova', { x: unit.x, y: unit.y, id: unit.id, charged });
        },
      },
      talents: [
        { install(battle, unit) { // 坚冰: attacks chill 1 s; cold enemies in range fragile 25 %, frozen 50 %
          battle.on('damaged', (c) => {
            if (c.source === unit && c.dmg?.isAttack && !c.dmg.isSplash && c.target.side === 'enemy' && c.target.alive) battle.applyStatus(c.target, 'cold', { duration: num(t0.cold, 1), source: unit });
          }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => {
            for (const e of enemiesOnRange(battle, unit)) {
              const f = e.s.flags;
              const m = f.freeze ? num(t0.damage_scale_freeze, 1.5) : f.cold ? num(t0.damage_scale_cold, 1.25) : 0;
              // 同名效果取最高: one 坚冰 per enemy, the strongest — two 灵知 (a pair / 联防 partner's copy) never compound
              if (m) battle.applyStrongest(e, 'gnosis:fragile', { duration: 0.15, value: m, mods: (v) => ({ dmgTakenMul: v }), source: unit });
            }
          });
        } },
        { install(battle, unit) { // 殊途同归: 10 s after deployment every 谢拉格 operator gains 抵抗 (negative status durations ×0.5)
          // engine `resist` status (applied before a new status lands, so a longer one already running is never
          // shortened; 同名效果不叠加: several 灵知 — or 流明's 抵抗 — never compound)
          const value = Math.min(1, Math.max(0, -num(t1.one_minus_status_resistance, -0.5)));
          whileDeployed(battle, unit, AURA, () => {
            if (battle.time - unit.deployedAt < num(t1.interval, 10) - 1e-9 || !(value > 0)) return;
            for (const a of battle.allies(unit.ownerId)) if (a.kind === 'op' && nationOf(a) === 'kjerag') battle.applyStatus(a, 'resist', { duration: AURA_DUR, value, source: unit });
          });
        } },
      ],
    };
  },

  // ===== 莱恩哈特 (splashcaster) S2 解构与爆破 — charges: 170 % arts to all in the wider range + RES −8 % for 6 s; 破片杀伤
  chess_char_4_14_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const g = grid(def.skill?.rangeGrid);
    const mr = num(bb.magic_resistance, 0);
    return {
      skills: alt(def, { 'skcom_atk_up[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk) } }) }), // S1 攻击力强化·γ型
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) {
          for (const e of targetsInRange(battle, unit)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.7), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            // 同名效果取最高: one RES cut per enemy (the strongest), never one per 莱恩哈特
            if (e.alive && mr) battle.applyStrongest(e, 'lionhd:res', { duration: num(bb.duration, 6), value: mr, mods: resCut, source: unit });
          }
          battle.fx('explosion', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [{ install(battle, unit) { // 破片杀伤: ATK +4 % per enemy in range (≤ 5)
        whileDeployed(battle, unit, 0.1, () => {
          const n = Math.min(num(t0.max_valid_stack_cnt, 5), targetsInRange(battle, unit).length);
          toggleBuff(battle, unit, 'lionhd:t1', n > 0, { atkPct: num(t0.atk, 0.04) * n });
        });
      } }],
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module SPC-X (elite default): 攻击范围扩大
    };
  },

  // ===== 录武官 (physician, hidden) S2 一点关窍 — +ATK; healed allies regain 80 HP per hit taken for 10 s; 学成于聚
  chess_char_4_15_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    return {
      skill: {
        kind: 'duration', heal: true,
        mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) { battle.fx('knack', { x: unit.x, y: unit.y, id: unit.id }); },
        onHit({ battle, unit, target }) {
          if (target && target.alive && target.side === 'ally' && target.kind === 'op') battle.addBuff(target, { key: `reckpr:guard:${unit.id}`, duration: num(bb['attack@buff_duration'], 10), visible: true, source: unit });
        },
      },
      talents: [{ install(battle, unit) { // 学成于聚: an operator in range casts ⇒ +1 SP and ASPD +16 for 8 s
        battle.on('skillStart', (c) => {
          const a = c.unit;
          if (a === unit || a.side !== 'ally' || a.kind !== 'op' || !unit.alive || !unit.deployed || !keySet(unit).has(a.tileR * COLS + a.tileC)) return;
          if (!battle.rng.chance(num(t0.prob, 1))) return;
          if (!skillActive(unit)) unit.skill?.gainSp(num(t0.sp, 1), 'talent');
          battle.addBuff(unit, { key: 'reckpr:t1', duration: num(t0.duration, 8), mods: { aspd: num(t0.attack_speed, 16) }, maxStacks: Math.max(1, num(t0.max_stack_cnt, 1)) });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        battle.on('damaged', (c) => {
          const t = c.target;
          if (t.side !== 'ally' || !t.alive || !(c.amount > 0) || isHpLoss(c.dmg) || !t.findBuff(`reckpr:guard:${unit.id}`)) return;
          battle.heal(unit, t, num(bb['attack@fixed_heal_value'], 80));
        }, { owner: unit });
        installLowHpHealBonus(battle, unit, tb);
      },
    };
  },

  // ===== 缄默德克萨斯 (executor) S3 剑雨滂沱 (passive) — deploy burst 2×115 % + 1.5 s stun, sword rain 1/s; talents
  //       S1 细雨无声 (passive, for the skill duration: ATK up; hits silence the target 5 s/8 s — 失去特殊能力 — with
  //       260/320 arts per s meanwhile); S2 阵雨连绵 (passive: deploy burst 150 %/180 % arts + RES −15 %/−20 % around her;
  //       for the skill duration ATK up and attacks become arts double hits). Talent 德克萨斯传统 applies to every passive.
  //       The S3 rain hits air units (PRTS 备注 "效果可对空"); so does the S2 deploy burst [ASSUMED: no note].
  chess_char_4_16_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid) || [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]];
    const S1 = isSel(def, 'skchr_texas2_1'), S2 = isSel(def, 'skchr_texas2_2');
    const dur = num(def.skill?.duration, S1 ? 11 : S2 ? 8 : 6);
    const castS1 = (battle, unit) => {
      if (!unit.alive || !unit.deployed) return;
      battle.fx('swordRain', { x: unit.x, y: unit.y, id: unit.id });
    };
    const castS2 = (battle, unit) => {
      if (!unit.alive || !unit.deployed) return;
      const mr = num(bb.magic_resistance, 0);
      for (const e of targetsInGrid(battle, unit, g)) {
        battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.5), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
        // 同名效果取最高: one RES cut per enemy (the strongest), never one per 缄默德克萨斯
        if (e.alive && mr) battle.applyStrongest(e, 'texas2:resDown', { duration: num(bb.debuff_duration, 8), value: mr, mods: resCut, source: unit });
      }
      battle.fx('swordStorm', { x: unit.x, y: unit.y, id: unit.id });
    };
    const castS3 = (battle, unit) => {
      if (!unit.alive || !unit.deployed) return;
      for (const e of targetsInGrid(battle, unit, g)) {
        for (let i = 0; i < 2 && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['appear.atk_scale'], 1.15), type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
        if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb['appear.stun'], 1.5), source: unit });
      }
      battle.fx('swordStorm', { x: unit.x, y: unit.y, id: unit.id });
      unit.mem.rainTimer?.cancel();
      unit.mem.rainTimer = battle.every(Math.max(0.1, num(bb['texas2_s_3[sword].interval'], 1)), (b, sched) => {
        if (!unit.alive || !unit.deployed || !unit.skill?.active) { sched.cancel(); return; }
        const list = targetsInGrid(b, unit, g);
        sortEnemyTargets(b, unit, list, null);
        for (const e of list.slice(0, Math.max(1, Math.floor(num(bb.max_target, 2))))) {
          b.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 0.85), type: 'arts', isSkill: true, tags: ['skill', 'swordRain'] });
          if (e.alive) b.applyStatus(e, 'stun', { duration: num(bb.stun, 0.2), source: unit });
          b.fx('swordRain', { x: e.x, y: e.y, id: e.id });
        }
      }, { owner: unit });
      // Duration advances by dt in the ally phase; align the rain with that clock so the final wave lands before end.
      unit.mem.rainTimer.due -= battle.dt;
    };
    const cast = S1 ? castS1 : S2 ? castS2 : castS3;
    const skill = {
      kind: 'duration', activateOnDeploy: true, duration: dur, spCost: 0, spType: 'none', trigger: 'NEVER',
      mods: { atkPct: num(t0.atk, 0.2) + (S1 || S2 ? num(bb.atk) : 0) },
      onStart({ battle, unit, reason }) {
        if (reason === 'kill' && unit.mem.texasRecastPending) {
          unit.mem.texasRecastPending = false; // the synchronous burst already performed this recast
          return;
        }
        unit.mem.texasCasting = true;
        cast(battle, unit);
        unit.mem.texasCasting = false;
      },
      onEnd({ unit, reason }) {
        if (reason === 'recast' && unit.mem.texasRecastPending) return;
        unit.mem.rainTimer?.cancel();
      },
    };
    return {
      skill,
      skills: alt(def, {
        skchr_texas2_1: () => skill,
        skchr_texas2_2: () => skill,
      }),
      // S2: 攻击变为二连击 while the passive lasts
      trait: S2 ? { hitsFn: (b, u) => (u.skill?.active ? 2 : 1) } : undefined,
      talents: [
        { install(battle, unit) { // 德克萨斯传统 (2nd half): first kill of each deployment ⇒ full heal + recast
          // (the passive's deploy burst runs inside skill.reset, BEFORE the `deploy` hook: the per-deployment state is
          // therefore reset when she leaves the field, so a kill by the deploy burst itself counts)
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            unit.mem.texasKilled = unit.mem.texasCasting = unit.mem.texasRecastPending = false;
          }, { owner: unit });
          battle.on('kill', (c) => {
            if (c.killer !== unit || !unit.alive || c.victim.side !== 'enemy' || unit.mem.texasKilled) return;
            unit.mem.texasKilled = true;
            battle.removeBuff(unit, 'texas2:swordplay');
            battle.heal(unit, unit, unit.s.maxHp * num(t0.hp_ratio, 1), { self: true });
            if (unit.mem.texasCasting) {
              unit.mem.texasRecastPending = true;
              cast(battle, unit); // preserve the burst's synchronous reentry and damage order
            } else {
              unit.skill.end('recast');
              unit.skill.activate('kill', { free: true });
            }
          }, { owner: unit });
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || !unit.mem.texasRecastPending) return;
            // Complete the lifecycle after observers received the outer start; the burst already recast above.
            unit.skill.end('recast');
            unit.skill.activate('kill', { free: true });
          }, { owner: unit, priority: -2000 });
        } },
        { install(battle, unit) { // 德克萨斯剑术: until her first kill after each deployment: ASPD +8, −25 % damage taken
          battle.on('deploy', (c) => {
            if (c.unit !== unit || unit.mem.texasKilled) return; // the deploy burst may already have scored the kill
            battle.addBuff(unit, { key: 'texas2:swordplay', mods: { aspd: num(t1.attack_speed, 8), dmgTakenMul: 1 - num(t1.damage_resistance, 0.25) } });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (S1) {
          // 攻击使命中目标失去特殊能力N秒，期间目标每秒受到X点法术伤害 (landed normal attacks while the passive lasts)
          const sil = num(bb['attack@silence'], 5), dotDur = num(bb['attack@texas2_s_1[dot].duration'], sil);
          const dot = num(bb['attack@texas2_s_1[dot].dot_damage'], 260), dotIv = Math.max(0.1, num(bb['attack@texas2_s_1[dot].interval'], 1));
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !c.dmg?.isAttack || e.side !== 'enemy' || !e.alive || !unit.skill?.active) return;
            battle.applyStatus(e, 'silence', { duration: sil, source: unit });
            battle.addBuff(e, { key: `texas2:drizzleDot:${unit.id}`, duration: dotDur + 1e-6, interval: dotIv, source: unit, refresh: 'extend', // a re-hit refreshes it, the per-second ticks keep their rhythm
              onTick: ({ unit: t }) => battle.dealDamage(unit, t, { amount: dot, type: 'arts', isSkill: true, tags: ['skill', 'dot'] }) });
          }, { owner: unit });
        }
        if (S2) {
          // 攻击…造成法术伤害 while the passive lasts (the double hit is the kit trait's hitsFn)
          battle.on('hit', (c) => {
            if (c.source === unit && c.dmg.isAttack && c.dmg.type === 'phys' && unit.skill?.active) c.dmg.type = 'arts';
          }, { owner: unit, priority: 50 });
        }
        const a = num(tb.atk, 0); // module (elite): ATK +10 % with no ally on the 4 adjacent tiles
        if (!a) return;
        whileDeployed(battle, unit, AURA, () => toggleBuff(battle, unit, 'texas2:module', lonely(battle, unit), { atkPct: a }));
      },
    };
  },

  // ===== 星熊 (protector) S2 荆棘 (passive) — DEF +13 %, counters every attacker for 65 % ATK phys; talents
  //       S1 战意 (TAKE_DAMAGE: DEF/ATK up); S3 力之锯 (ATK/DEF up, cuts every enemy on her front tile — all enemies of her
  //       range); module PRO-X (护身符): DEF +20 % while blocking
  chess_char_4_17_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S2 = isSel(def, 'skchr_hsguma_2');
    return {
      skills: alt(def, {
        skchr_hsguma_1: () => ({ kind: 'duration', mods: { defPct: num(bb.def), atkPct: num(bb.atk) } }),
        skchr_hsguma_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          targeting: { allInRange: true },
          onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: { kind: 'passive', mods: { defPct: num(bb.def) } },
      talents: [
        { install(battle, unit) { // 战术装甲: 25 % 伤害抵挡 — negates an enemy phys/arts damage instance ("抵挡一次物理或法术伤害")
          battle.on('hit', (c) => { // 抵挡 is target-side: a 无来源 burst (source null) counts via the enemy credited with it
            const src = c.source || c.credit;
            if (c.target !== unit || !src || src.side !== 'enemy' || c.dmg.cancel || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
            if (battle.rng.chance(num(t0.prob, 0.25))) { c.dmg.cancel = true; battle.fx('block', { x: unit.x, y: unit.y, id: unit.id }); }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 特种作战策略: 重装 allies DEF +6 %
          whileDeployed(battle, unit, AURA, () => { for (const a of battle.allies(unit.ownerId)) if (a.def?.profession === 'TANK') pulse(battle, a, 'hsguma:def', { defPct: num(t1.def, 0.06) }); });
        } },
      ],
      install(battle, unit) {
        const bd = num(tb.def, 0); // module PRO-X: 阻挡敌人时防御力+20%
        if (bd) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'hsguma:module', unit.blocking.length > 0, { defPct: bd }));
        if (!S2) return;
        battle.on('damaged', (c) => {
          const src = c.source;
          if (c.target !== unit || !unit.alive || !src || src.side !== 'enemy' || !src.alive || !c.dmg?.isAttack) return;
          battle.dealDamage(unit, src, { amount: unit.s.atk * num(bb.atk_scale, 0.65), type: 'phys', canDodge: false, isSkill: true, tags: ['counter'] });
          battle.fx('thorns', { x: unit.x, y: unit.y, id: unit.id });
        }, { owner: unit });
      },
    };
  },

  // ===== 泥岩 (unyield) S2 岩崩锤 — next attack: heal 4 %, 190 % phys to all ground enemies around, 30 % stun; talents
  //       S1 防御力强化·γ型 (TAKE_DAMAGE); S3 秽壤的血脉 (10 s dormant — cannot act, takes no damage, keeps blocking —
  //       with enemies around −60 % speed; then ground enemies around stunned 3 s/3.5 s and for the rest of the skill
  //       BAT −0.3 s, ATK/DEF up, attacks every blocked enemy); module UNY-Y (沃土的愿景): ATK/DEF +8 % with no ally
  //       on the 8 tiles around
  chess_char_4_18_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid) || [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]];
    const sleep = num(bb.sleep, 10);
    return {
      skills: alt(def, {
        'skcom_def_up[3]': () => ({ kind: 'duration', mods: { defPct: num(bb.def) } }),
        skchr_mudrok_3: () => ({
          kind: 'duration',
          attack: { hitAllBlocked: true },
          onStart({ battle, unit }) {
            unit.mem.mudS3 = { awake: false, t: 0 };
            battle.addBuff(unit, { key: 'mudrok:dormant', duration: sleep + 1, flags: { invulnerable: true, disarm: true }, visible: true });
            battle.fx('stone', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ battle, unit, dt }) {
            const M = unit.mem.mudS3;
            if (!M || M.awake) return;
            M.t += dt;
            for (const e of targetsInGrid(battle, unit, g)) pulse(battle, e, `mudrok:slow:${unit.id}`, { moveMul: Math.max(0, 1 + num(bb.move_speed, -0.6)) });
            if (M.t + 1e-9 < sleep) return;
            M.awake = true;
            battle.removeBuff(unit, 'mudrok:dormant');
            for (const e of targetsInGrid(battle, unit, g)) if (!e.isFlying && e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 3), source: unit });
            battle.addBuff(unit, { key: 'mudrok:awake', mods: { atkPct: num(bb.atk), defPct: num(bb.def), batPct: batFlat(def, bb.base_attack_time) } });
            battle.fx('rockfall', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) {
            unit.mem.mudS3 = null;
            battle.removeBuff(unit, 'mudrok:dormant');
            battle.removeBuff(unit, 'mudrok:awake');
          },
        }),
      }),
      skill: {
        kind: 'instant',
        targeting: { rangeGrid: g, allInRange: true, canHitFly: false },
        attack: {
          atkScale: num(bb.atk_scale, 1.9), groundOnly: true,
          onHit({ battle, unit, target }) {
            if (target && target.alive && battle.rng.chance(num(bb.buff_prob, 0.3))) battle.applyStatus(target, 'stun', { duration: num(bb.stun, 0.5), source: unit });
          },
        },
        onStart({ battle, unit }) {
          battle.heal(unit, unit, unit.s.maxHp * num(bb.hp_ratio, 0.04), { self: true });
          battle.fx('rockslide', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 沃土予身: a hit-negating layer every 9 s (≤ 3, 1 on deploy); each broken layer heals 20 %
          const setLayers = (n) => {
            unit.mem.layers = n;
            if (n > 0) battle.addBuff(unit, { key: 'mudrok:layers', shieldHits: n, visible: true });
            else battle.removeBuff(unit, 'mudrok:layers');
          };
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            setLayers(Math.min(num(t0.max_times, 3), num(t0.times, 1)));
            unit.mem.layerTimer?.cancel();
            unit.mem.layerTimer = whileDeployed(battle, unit, num(t0.interval, 9), () => {
              if ((unit.mem.layers ?? 0) < num(t0.max_times, 3)) setLayers(Math.min(num(t0.max_times, 3), (unit.mem.layers ?? 0) + num(t0.times, 1)));
            });
          }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.target !== unit || !unit.alive) return;
            const left = unit.findBuff('mudrok:layers')?.shieldHits ?? 0;
            const broken = (unit.mem.layers ?? 0) - left;
            if (broken <= 0) return;
            unit.mem.layers = left;
            battle.heal(unit, unit, unit.s.maxHp * num(t0.hp_ratio, 0.2) * broken, { self: true });
            battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 手足相惜: −30 % damage from 萨卡兹 enemies
          battle.on('hit', (c) => { if (c.target === unit && enemyHasTag(c.source, 'sarkaz')) c.dmg.mul *= 1 - num(t1.damage_resistance, 0.3); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const ds = num(tb.damage_scale, 0); // module (elite): −15 % damage from enemies it blocks
        if (ds > 0) battle.on('hit', (c) => { if (c.target === unit && c.source && c.source.blockedBy === unit) c.dmg.mul *= ds; }, { owner: unit });
        const ma = num(tb.atk, 0), md = num(tb.def, 0); // module UNY-Y: 周围8格没有友方干员时攻击力和防御力+8%
        if (ma || md) whileDeployed(battle, unit, AURA, () => toggleBuff(battle, unit, 'mudrok:module', lonely(battle, unit, true), { atkPct: ma, defPct: md }));
      },
    };
  },

  // ===== 焰尾 (pioneer) S3 焰心 — 8 DP over the skill, faster, +ATK, block +1, 60 % dodge; talents 前锋剑术 / 红松骑士团团长
  //       S1 迅敏直觉 (+6 DP, dodges the next physical attack); S2 “红松林” (+11/12 DP; ≤ 6 enemies around: 2 × 180 %/210 %
  //       phys + 0.5 s stun, air units too — PRTS 备注 "※可对空"; allies around +40 %/45 % physical dodge for 10 s);
  //       module SOL-X (她们的未来): ATK/DEF +8 % while blocking. Her dodges (any source) feed talent 前锋剑术.
  chess_char_4_19_a: (bb, chess, def) => {
    const t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const total = Math.max(0, Math.floor(num(bb.value, 8))), per = num(bb.cost, 1);
    const p = num(bb.prob, 0.6);
    const S1 = isSel(def, 'skchr_flamtl_1'), S3 = isSel(def, 'skchr_flamtl_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        // (自动触发: an AUTO skill takes no 技能策略 — an AUTO DP skill fires as soon as it is ready, like 伺夜 S1)
        skchr_flamtl_1: () => ({
          kind: 'instant',
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost, 6));
            battle.addBuff(unit, { key: 'flamtl:evade', visible: true });
            battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost, 6) });
          },
        }),
        skchr_flamtl_2: () => ({
          kind: 'instant',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost, 11));
            const area = g || [[0, 0], [0, 1]];
            const foes = targetsInGrid(battle, unit, area);
            sortEnemyTargets(battle, unit, foes, null);
            for (const e of foes.slice(0, Math.max(1, Math.floor(num(bb.max_target, 6))))) {
              for (let i = 0; i < 2 && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1.8), type: 'phys', isSkill: true, tags: ['skill', 'redPine'] });
              if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 0.5), source: unit });
            }
            for (const a of battle.unitsInGrid(unit, area, { side: 'ally' })) {
              if (a.kind === 'device' || !battle.allySelectable(a, unit)) continue;
              battle.addBuff(a, { key: 'flamtl:redPine', duration: num(bb['flamtl_s_2.duration'], 10), mods: { dodgePhys: num(bb['flamtl_s_2.prob'], 0.4) }, visible: true, source: unit });
            }
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
          },
        }),
      }),
      skill: {
        kind: 'duration',
        // the 60 % dodge is rolled on its own in the `hit` hook below (independent of other dodge sources such as her
        // talent's 22 %: 1 − (1−p)(1−q), never an additive 80 % + 22 % = 100 % immunity)
        mods: { atkPct: num(bb.atk), batPct: Math.max(-0.9, num(bb.base_attack_time, 1) - 1), blockCnt: num(bb.block_cnt, 1) },
        onStart({ battle, unit, skill }) { unit.mem.flame = { acc: 0, given: 0, step: skill.duration / Math.max(1, total) }; battle.fx('flame', { x: unit.x, y: unit.y, id: unit.id }); },
        onTick({ battle, unit, dt }) {
          const F = unit.mem.flame;
          if (!F) return;
          F.acc += dt;
          while (F.acc + 1e-9 >= F.step && F.given < total) { F.acc -= F.step; F.given++; battle.addDp(unit.ownerId, per); }
        },
        onEnd({ battle, unit, reason }) {
          const F = unit.mem.flame;
          unit.mem.flame = null;
          if (F && reason === 'duration' && F.given < total) battle.addDp(unit.ownerId, per * (total - F.given));
        },
      },
      install(battle, unit) {
        if (S1) {
          battle.on('hit', (c) => { // S1: "闪避下次物理攻击"
            const d = c.dmg;
            if (c.target !== unit || d.cancel || d.type !== 'phys' || !d.isAttack || !c.source || c.source.side !== 'enemy' || !unit.findBuff('flamtl:evade')) return;
            battle.removeBuff(unit, 'flamtl:evade');
            d.cancel = true;
            battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
            battle.emit('dodge', { source: c.source, target: unit, dmg: d });
          }, { owner: unit, priority: 20 });
        }
        const ma = num(tb.atk, 0), md = num(tb.def, 0); // module SOL-X: 阻挡敌人时攻击力和防御力各+8%
        if (ma || md) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'flamtl:module', unit.blocking.length > 0, { atkPct: ma, defPct: md }));
        if (!S3) return;
        battle.on('hit', (c) => { // S3: "获得60%的物理和法术闪避"
          const d = c.dmg;
          if (c.target !== unit || !skillActive(unit) || d.cancel || !d.canDodge || (d.type !== 'phys' && d.type !== 'arts')) return;
          if (!battle.rng.chance(p)) return;
          d.cancel = true;
          battle.fx('dodge', { x: unit.x, y: unit.y, id: unit.id });
          battle.emit('dodge', { source: c.source, target: unit, dmg: d });
        }, { owner: unit, priority: 20 });
      },
      talents: [
        { install(battle, unit) { // 前锋剑术: after a dodge the next attack hits twice and every blocked enemy
          battle.on('dodge', (c) => { if (c.target === unit) unit.mem.riposte = true; }, { owner: unit });
          battle.on('death', (c) => { if (c.unit === unit) unit.mem.riposte = unit.mem.riposteNow = false; }, { owner: unit });
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.mem.riposte) return;
            unit.mem.riposte = false;
            unit.mem.riposteNow = true;
            const extra = unit.blocking.filter((e) => e.alive && canTargetEnemy(unit, e, c.profile) && !c.targets.includes(e));
            c.targets = [...c.targets, ...extra];
          }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.mem.riposteNow) return;
            unit.mem.riposteNow = false;
            for (const e of c.targets) if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul, type: 'phys', isAttack: true, tags: ['riposte'] });
            battle.fx('riposte', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 红松骑士团团长: 卡西米尔 operators +22 % physical dodge
          whileDeployed(battle, unit, AURA, () => { for (const a of battle.allies(unit.ownerId)) if (nationOf(a) === 'kazimierz') pulse(battle, a, 'flamtl:dodge', { dodgePhys: num(t1.prob, 0.22) }); });
        } },
      ],
    };
  },

  // ===== 远牙 (longrange) S3 光羽箭 — infinite line, +ATK, ×1.25 beyond the normal range; talents 凝神 / 屏息; module
  //       S1 迅捷打击·γ型; S2 同盟支援 (ASPD up; enemies blocked by any ally anywhere on the field are in range — their
  //       tiles are extra range keys while the skill runs). Talent 屏息 (taunt −1, ignores dodge) covers every skill.
  //       Module DEA-Y (支持者来信): +1 SP when an attacked enemy survives the hit
  chess_char_4_20_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S3 = isSel(def, 'skchr_fartth_3');
    const taunt = num(t1.taunt_level, -1);
    const setAllied = (battle, unit, keys) => {
      const sig = keys ? keys.join(',') : '';
      if (sig === (unit.mem.alliedSig ?? '')) return;
      unit.mem.alliedSig = sig;
      battle.setExtraRange(unit, keys);
    };
    return {
      skills: alt(def, {
        'skcom_quickattack[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), taunt } }),
        skchr_fartth_2: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed), taunt },
          onStart({ battle, unit }) { battle.fx('link', { x: unit.x, y: unit.y, id: unit.id }); },
          onTick({ battle, unit }) {
            const keys = [];
            for (const e of battle.enemies) if (e.alive && !e.hidden && e.blockedBy && e.blockedBy.side === 'ally' && e.blockedBy.alive) keys.push(tileKey(e));
            keys.sort((a, b) => a - b);
            setAllied(battle, unit, keys.length ? keys : null);
          },
          onEnd({ battle, unit }) { setAllied(battle, unit, null); },
        }),
      }),
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), taunt: num(t1.taunt_level, -1) }, targeting: { rangeGrid: LINE },
        onStart({ battle, unit }) { battle.fx('featherArrow', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [
        { install(battle, unit) { // 凝神: ATK +15 % when not hurt for 10 s
          battle.on('damaged', (c) => { if (c.target === unit && c.amount > 0 && !isHpLoss(c.dmg)) unit.mem.lastHurt = battle.time; }, { owner: unit }); // (a 流失 is not 受伤害)
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.lastHurt = -Infinity; }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'fartth:focus', battle.time - (unit.mem.lastHurt ?? -Infinity) >= num(t0.delay, 10) - 1e-9, { atkPct: num(t0.atk, 0.15) }));
        } },
        { install(battle, unit) { // 屏息 (2nd half): skill attacks ignore physical dodge
          battle.on('hit', (c) => { if (c.source === unit && skillActive(unit) && c.dmg.type === 'phys') c.dmg.canDodge = false; }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (isSel(def, 'skchr_fartth_2')) {
          // 同盟支援 reaches BLOCKED enemies outside her range only: the blocked enemies' tiles are extra range keys, so an
          // unblocked enemy (a flyer…) standing on such a tile outside her own range is dropped for the next valid target
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillActive(unit) || !unit.extraRangeKeys) return;
            const own = new Set(absoluteRangeKeys(unit.rangeGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend));
            const ok = (e) => bodyInKeys(e, own) || !!(e.blockedBy && e.blockedBy.side === 'ally' && e.blockedBy.alive);
            if (c.targets.every(ok)) return;
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile);
            for (const e of battle.blockedTargets(unit, c.profile)) if (!cands.includes(e)) cands.push(e); // DESIGN §20.3
            for (let i = cands.length - 1; i >= 0; i--) if (!ok(cands[i])) cands.splice(i, 1);
            sortEnemyTargets(battle, unit, cands, c.profile?.priority ?? null);
            c.targets = cands.slice(0, Math.max(1, c.targets.length));
          }, { owner: unit, priority: 5 });
        }
        const sp = num(tb.sp, 0); // module DEA-Y: 攻击的敌人未被击倒时自身额外获得1点技力
        if (sp > 0) {
          // (`damaged` fires before the kill: a lethal hit leaves the target `alive` with 0 HP — that one gives no SP)
          battle.on('damaged', (c) => {
            if (c.source === unit && c.dmg?.isAttack && !c.dmg.isSplash && c.target.side === 'enemy' && c.target.alive && !downed(c.target)) unit.skill?.gainSp(sp, 'module');
          }, { owner: unit });
        }
        const ds = num(tb.damage_scale, 0), lo = num(tb.min_dist, 1), hi = num(tb.max_dist, 4.5);
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.dmg.isAttack) return;
          if (S3 && skillActive(unit) && unit.baseRangeKeys && !bodyInKeys(c.target, unit.baseRangeKeys)) c.dmg.mul *= num(bb.damage_scale, 1.25);
          if (ds > 0) { const d = Math.hypot(c.target.x - unit.x, c.target.y - unit.y); c.dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo))); }
        }, { owner: unit });
      },
    };
  },

  // ===== 白面鸮 (ringhealer) S2 脑啡肽 — wider range, much faster heals; talent 技力光环 (+0.3 SP/s to all allies)
  chess_char_4_21_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, { 'skcom_heal_up[3]': () => ({ kind: 'duration', heal: true, mods: { atkPct: num(bb.atk) } }) }), // S1 治疗强化·γ型
      skill: { kind: 'duration', heal: true, mods: { batPct: batFlat(def, bb.base_attack_time) }, targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) { battle.fx('healField', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [{ install(battle, unit) { spAura(battle, unit, num(t0.sp_recovery_per_sec, 0.3), (a) => a.kind !== 'device'); } }],
      install(battle, unit) { applyModuleRange(battle, unit, def); }, // module RIN-X (elite default): 攻击范围扩大
    };
  },

  // ===== 银灰 (lord) S3 真银斩 — DEF −70 %, ATK +125 %, wider range, ≤ 4 targets at melee scale; 领袖 / 鹰眼视觉; module
  //       S1 强力击·γ型 (attack SP: next attack 205 %/225 %); S2 雪境生存法则 (toggle — [ASSUMED] once switched on it stays
  //       on for the deployment: smaller range, DEF up, 3.5 %/4 % max HP regen per s)
  chess_char_4_22_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_svrash_1: () => ({ kind: instantKind(def), attack: { atkScale: num(bb.atk_scale, 2.05) } }),
        skchr_svrash_2: () => ({
          kind: 'toggle',
          mods: { defPct: num(bb.def), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) },
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit }) { battle.fx('snow', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { defPct: num(bb.def), atkPct: num(bb.atk) },
        targeting: { ...(g ? { rangeGrid: g } : {}), maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 4))) },
        attack: { projectile: 'none', dmgMul: () => 1 },       // 视为近距离攻击: no ranged ×0.8
        onStart({ battle, unit }) { battle.fx('truesilver', { x: unit.x, y: unit.y, id: unit.id }); },
        onAttack({ battle, unit }) { battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { // 领袖: ATK +10 %; every unit of the team redeploys 10 % faster
          battle.addBuff(unit, { key: 'svrash:t1', mods: { atkPct: num(t0.atk, 0.1) }, persist: true, allowDead: true });
          const p = battle.getPlayer(unit.ownerId);
          for (const a of p ? p.units : []) if (a.kind === 'op') battle.addBuff(a, { key: 'svrash:leader', mods: { redeployMul: Math.max(0, 1 + num(t0.respawn_time, -0.1)) }, persist: true, allowDead: true });
        } },
        { install(battle, unit) { whileDeployed(battle, unit, AURA, () => reveal(battle, enemiesOnRange(battle, unit))); } }, // 鹰眼视觉
      ],
      install(battle, unit) {
        const m = num(tb.atk_scale_m, 0); // module (elite): attacks add 10 % ATK arts damage
        if (!(m > 0)) return;
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.dmg?.isAttack || c.type !== 'phys' || !c.target.alive || c.target.side !== 'enemy') return;
          battle.dealDamage(unit, c.target, { amount: unit.s.atk * m, type: 'arts', tags: ['module'] });
        }, { owner: unit });
      },
    };
  },

  // ===== 百炼嘉维尔 (centurion) S3 丛林之魂 — ATK/ASPD/block up, takes 50 % now, the rest as 20 s HP loss; talents; module
  //       S1 精准痛击 (ATK up, heals herself 30 %/35 % of the damage dealt); S2 链锯强袭 (wider range, ATK/DEF up, pulls
  //       unblocked enemies it hits to her front); module CEN-Y (好锯多磨): −20 % physical damage taken above 50 % HP
  chess_char_4_23_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const dr = Math.max(0, Math.min(0.99, num(bb.damage_resistance, 0.5)));
    const fin = num(bb.final_duration, 20), iv = Math.max(1 / 30, num(bb.interval, 0.1));
    const S3 = isSel(def, 'skchr_gvial2_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_gvial2_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          onHit({ battle, unit, dealt }) { if (dealt > 0 && unit.alive) battle.heal(unit, unit, dealt * num(bb.heal_scale, 0.3), { self: true }); },
        }),
        skchr_gvial2_2: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          targeting: g ? { rangeGrid: g } : undefined,
          attack: { onEachHit({ battle, unit, target }) { if (target && target.alive && !target.blockedBy) pullToFront(battle, unit, target, num(bb['attack@force'], 1)); } },
          onStart({ battle, unit }) { battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), blockCnt: num(bb.block_cnt, 2) },
        onStart({ battle, unit }) { unit.mem.gvialDebt = 0; battle.fx('jungleSoul', { x: unit.x, y: unit.y, id: unit.id }); },
        onEnd({ battle, unit, reason }) {
          const debt = unit.mem.gvialDebt ?? 0;
          unit.mem.gvialDebt = 0;
          if (reason === 'death' || !unit.alive || !(debt > 0)) return;
          const per = debt * iv / fin;
          battle.addBuff(unit, { key: 'gvial:bleed', refresh: 'independent', maxStacks: 10, duration: fin + 1e-6, interval: iv, visible: true,
            onTick: ({ unit: u }) => battle.loseHp(u, per) });
        },
      },
      talents: [
        { install(battle, unit) { // 战地巨斧: ATK/DEF +10 %, +4 % per extra blocked enemy
          whileDeployed(battle, unit, 0.1, () => {
            const extra = Math.max(0, unit.blocking.length - 1);
            toggleBuff(battle, unit, 'gvial:t1', true, { atkPct: num(t0.atk, 0.1) + num(t0.atk_add, 0.04) * extra, defPct: num(t0.def, 0.1) + num(t0.def_add, 0.04) * extra });
          });
        } },
        { install(battle, unit) { // 医学背景: healing received +20 %, +40 % below half HP
          battle.on('heal', (c) => { if (c.target === unit) c.amount *= unit.hpRatio < num(t1.hp_ratio, 0.5) ? num(t1.heal_scale_2, 1.4) : num(t1.heal_scale_1, 1.2); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const s = num(tb.atk_scale, 0); // module (elite): ×1.1 against blocked enemies
        if (s > 0) battle.on('hit', (c) => { if (c.source === unit && c.dmg.isAttack && c.target.blockedBy === unit) c.dmg.mul *= s; }, { owner: unit });
        const yr = num(tb.hp_ratio, 0), yd = num(tb.damage_resistance, 0); // module CEN-Y: 生命值高于50%时受到的物理伤害降低20%
        if (yr > 0 && yd > 0) battle.on('hit', (c) => { if (c.target === unit && c.dmg.type === 'phys' && unit.hpRatio > yr) c.dmg.mul *= 1 - yd; }, { owner: unit });
        if (!S3) return;
        const deferred = new WeakSet();
        battle.on('hit', (c) => {
          if (c.target !== unit || !skillActive(unit)) return;
          c.dmg.mul *= 1 - dr;
          deferred.add(c.dmg);
        }, { owner: unit, priority: -5 });
        battle.on('damaged', (c) => {
          if (c.target !== unit || !deferred.has(c.dmg)) return;
          deferred.delete(c.dmg);
          if (c.amount > 0) unit.mem.gvialDebt = (unit.mem.gvialDebt ?? 0) + (c.amount * dr) / (1 - dr);
        }, { owner: unit });
      },
    };
  },

  // ===== 卡涅利安 (phalanx) S2 沙缚镣锁 — faster attacks on every enemy in range (the trait's 群体法术伤害), 0.3 s
  //       sluggish on each; charged: ATK +10 % and bind; talents
  //       S1 沙暴守卫 (SEARCH: ATK/DEF up; charged — cast with every charge stored — "特性效果在技能期间继续生效", PRTS 备注
  //       "应用蓄力时：应用技能未开启时的特性": the skill-off trait stays in force, the DEF/RES guard AND 不攻击 — she makes
  //       no attack until the skill ends, a pure guard);
  //       S3 食噬之印 (wider range, ATK +0 % → +140 %/+200 % in 1 s steps over 20 s — PRTS 备注; charged: each attack adds a
  //       stack of the mark BEFORE its damage — PRTS 备注 "于攻击造成伤害前生效，多层效果之间加算叠加" — +20 % damage from
  //       her per stack, ≤ 5, so ×1.2 on the first hit and ×2.0 from the 5th, until the skill ends; one mark per enemy:
  //       another 卡涅利安 only adds stacks to it, the bonus is the setter's — PRTS 备注 popup). Talent 生命之餐 heals on
  //       every skill; module PLX-X keeps part of the guard during any skill, PLX-Y (乡音): +3 % damage per enemy in range
  //       (≤ 5)
  chess_char_4_24_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const tb = def.traitBb || {};
    const keepDef = num(tb['billro_e_002[buff].def'], 0), keepRes = num(tb['billro_e_002[buff].magic_resistance'], 0);
    const S1 = isSel(def, 'skchr_billro_1'), S2 = isSel(def, 'skchr_billro_2'), S3 = isSel(def, 'skchr_billro_3');
    const g = grid(def.skill?.rangeGrid);
    const isCharged = (skill) => skill.maxCharges > 1 && skill.charges + 1 >= skill.maxCharges; // cast with every charge stored
    return {
      // charged S1: the skill-off trait's 不攻击 stays in force while the skill lasts (PRTS S1 备注) — no attack at all
      trait: S1 ? { canAttack: (battle, u) => !(skillActive(u) && u.mem.billroCharged) } : null,
      skills: alt(def, {
        skchr_billro_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          onStart({ battle, unit, skill }) {
            unit.mem.billroCharged = isCharged(skill);
            // 蓄力额外效果：特性效果在技能期间继续生效 (the profession removes its own guard buff when a skill starts; the
            // kit trait's canAttack keeps the trait's 不攻击)
            if (unit.mem.billroCharged) battle.addBuff(unit, { key: 'billro:s1guard', mods: { defPct: num(unit.profile?.guardDef, 2), resFlat: num(unit.profile?.guardRes, 20) } });
            battle.fx('shell', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) { unit.mem.billroCharged = false; battle.removeBuff(unit, 'billro:s1guard'); },
        }),
        skchr_billro_3: () => ({
          kind: 'duration',
          targeting: g ? { rangeGrid: g } : undefined,
          onStart({ battle, unit, skill }) {
            unit.mem.billroCharged = isCharged(skill);
            unit.mem.billroRamp = 0;
            unit.mem.billroMarked = new Set();
            battle.addBuff(unit, { key: 'billro:s3atk', mods: { atkPct: 0 } });
            battle.fx('devour', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ unit, dt }) { // 攻击力逐渐增至+N%: PRTS 备注 "从+0%开始在20秒内线性增加，攻击力每1秒更新1次"
            unit.mem.billroRamp = (unit.mem.billroRamp ?? 0) + dt;
            const steps = Math.min(BILLRO_S3_RAMP, Math.floor(unit.mem.billroRamp + 1e-9));
            const b = unit.findBuff('billro:s3atk');
            if (b && b.mods.atkPct !== num(bb.atk) * steps / BILLRO_S3_RAMP) { b.mods = { atkPct: num(bb.atk) * steps / BILLRO_S3_RAMP }; unit.markDirty(); }
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, 'billro:s3atk');
            // "持续至技能结束": the marks she set end with her skill (stacks another 卡涅利安 added to them included)
            for (const id of unit.mem.billroMarked || []) {
              const e = battle.unitById(id);
              if (e && e.findBuff(BILLRO_MARK)?.source === unit) battle.removeBuff(e, BILLRO_MARK);
            }
            unit.mem.billroMarked = null;
            unit.mem.billroCharged = false;
          },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { batPct: batFlat(def, bb.base_attack_time) },
        onStart({ battle, unit, skill }) {
          const charged = isCharged(skill);
          unit.mem.billroCharged = charged;
          if (charged) battle.addBuff(unit, { key: 'billro:charged', mods: { atkPct: num(bb.atk, 0.1) } });
          battle.fx(charged ? 'sandChainsCharged' : 'sandChains', { x: unit.x, y: unit.y, id: unit.id });
        },
        onEnd({ battle, unit }) { unit.mem.billroCharged = false; battle.removeBuff(unit, 'billro:charged'); },
      },
      talents: [
        { install(battle, unit) { // 生命之餐: every skill start heals 40 % max HP (×2 when charged)
          battle.on('skillStart', (c) => {
            if (c.unit !== unit) return;
            const charged = isCharged(c.skill);
            battle.heal(unit, unit, unit.s.maxHp * (charged ? num(t0['billro_t_1[enhance].heal_scale'], 0.8) : num(t0.heal_scale, 0.4)), { self: true });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 蓄势待发: +0.6 SP/s once a charge is stored
          whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'billro:t2', !!unit.skill && unit.skill.charges >= 1 && !skillActive(unit), { spRecoveryFlat: num(t1.sp_recovery_per_sec, 0.6) }));
        } },
      ],
      install(battle, unit) {
        // module PLX-X (elite default): 技能开启时保留部分效果 (any skill; a charged S1 keeps the whole guard instead)
        if (keepDef || keepRes) {
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || (S1 && unit.mem.billroCharged)) return;
            battle.addBuff(unit, { key: 'billro:keep', mods: { defPct: keepDef, resFlat: keepRes } });
          }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit) battle.removeBuff(unit, 'billro:keep'); }, { owner: unit });
        }
        // module PLX-Y: 范围内敌人越多造成的伤害越高（每个 +3 %，最多 5 个）
        const per = num(mb.damage_scale, 0), cap = num(mb.max_valid_stack_cnt, 5);
        if (per > 0) {
          battle.on('hit', (c) => {
            if (c.source !== unit || c.target.side !== 'enemy') return;
            const n = Math.min(cap, enemiesOnRange(battle, unit).length);
            if (n > 0) c.dmg.mul *= 1 + per * n;
          }, { owner: unit });
        }
        if (S3) {
          // charged S3 食噬之印: each attack adds a stack BEFORE its damage (PRTS 备注 "于攻击造成伤害前生效"); stacks add up,
          // +20 % damage taken from the mark's setter per stack. One mark per enemy (PRTS 备注 popup: "存在则为已有的BUFF叠加
          // 一次加成，不存在则给与敌人仅对此卡涅利安的伤害生效的一个食噬之印BUFF"): another 卡涅利安 stacks it without the bonus
          const per = num(bb['attack@damage_scale'], 0.2);
          battle.on('hit', (c) => {
            const e = c.target;
            if (c.source !== unit || e.side !== 'enemy') return;
            let m = e.findBuff?.(BILLRO_MARK) || null;
            if (c.dmg.isAttack && skillActive(unit) && unit.mem.billroCharged) {
              if (m) battle.addBuff(e, { key: BILLRO_MARK, refresh: 'stack', maxStacks: BILLRO_MARK_MAX, duration: m.timeLeft });
              else {
                m = battle.addBuff(e, { key: BILLRO_MARK, refresh: 'stack', maxStacks: BILLRO_MARK_MAX, duration: Math.max(0.1, (unit.skill?.timeLeft ?? 0) + 0.1), source: unit, visible: true });
                if (m) unit.mem.billroMarked?.add(e.id);
              }
            }
            if (m && m.source === unit) c.dmg.mul *= 1 + per * (m.stacks || 1);
          }, { owner: unit });
        }
        if (!S2) return;
        // "每次攻击对目标造成0.3秒停顿" (charged: 束缚): every enemy her attack damages — each one on her range
        battle.on('damaged', (c) => {
          const e = c.target;
          if (c.source !== unit || !c.dmg || !c.dmg.isAttack || e.side !== 'enemy' || !e.alive || !skillActive(unit)) return;
          if (unit.mem.billroCharged) battle.applyStatus(e, 'bind', { duration: num(bb['attack@root'], 0.3), source: unit });
          else battle.applyStatus(e, 'sluggish', { duration: num(bb['attack@sluggish'], 0.3), source: unit });
        }, { owner: unit });
      },
    };
  },

  // ===== 魔王 (bard) S3 编织重构现世 — wider range, trait 65 %, motes stay, 鼓舞 +65 % of her max HP, HP redistribution
  //       S1 往昔萦绕身旁 (SP_FULL toggle, 持续时间无限: trait 20 %/28 %, motes respawn in `talent_cool_down` s); S2 明日渺远不及
  //       (motes cap +3 and 6 at once, wider orbit — enemies within outside_radius — no longer touch operators: a mote
  //       hitting an enemy deals 220 %/260 % ATK true damage + 3 s bind and respawns like any mote [ASSUMED]; 鼓舞: other
  //       allies in range ATK + 65 %/80 % of her ATK)
  chess_char_4_25_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const g = grid(def.skill?.rangeGrid);
    const redistIv = Math.max(0.5, num(bb['attack@cetsyr_s_3[cal_hp_ratio].interval'], 2));
    const S1 = isSel(def, 'skchr_cetsyr_1'), S2 = isSel(def, 'skchr_cetsyr_2'), S3 = isSel(def, 'skchr_cetsyr_3');
    const baseCnt = Math.max(0, Math.floor(num(t0.cnt, 3)));
    const MOTE_GAP = 0.5; // [ASSUMED] minimal time between two motes hitting the same enemy (s)
    const setTrait = (unit, v) => { unit.mem.bardBase ??= unit.profile.auraRatio; unit.profile.auraRatio = num(v, unit.mem.bardBase); };
    const resetTrait = (unit) => { if (unit.mem.bardBase != null) unit.profile.auraRatio = unit.mem.bardBase; };
    return {
      skills: alt(def, {
        skchr_cetsyr_1: () => ({
          kind: 'toggle',
          trigger: 'SP_FULL', // 自动触发 (no 技能策略: the 吟游者 row is for MANUAL skills): on as soon as it is ready
          onStart({ battle, unit }) { setTrait(unit, bb['attack@atk_to_hp_recovery_ratio']); battle.fx('mote', { x: unit.x, y: unit.y, id: unit.id }); },
          onEnd({ unit }) { resetTrait(unit); },
        }),
        skchr_cetsyr_2: () => ({
          kind: 'duration',
          onStart({ battle, unit }) {
            // “微尘”上限+3，立刻获得6枚“微尘”
            unit.mem.motes = new Array(baseCnt + 3).fill(-Infinity);
            unit.mem.moteHit = new Map();
            battle.fx('reweave', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.motes.length });
          },
          onTick({ battle, unit }) { // 鼓舞: other allies in range ATK + x % of her ATK
            for (const a of battle.alliesInGrid(unit)) if (a !== unit) inspire(battle, a, unit.s.atk * num(bb['attack@atk'], 0.65), unit);
          },
          onEnd({ battle, unit }) {
            // back to the normal cap: the motes that come back first are kept
            unit.mem.motes = (unit.mem.motes || []).slice().sort((a, b) => a - b).slice(0, baseCnt);
            unit.mem.moteHit = null;
          },
        }),
      }),
      skill: {
        kind: 'duration',
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) {
          setTrait(unit, bb['attack@atk_to_hp_recovery_ratio']);
          unit.mem.redist = 0;
          battle.fx('reweave', { x: unit.x, y: unit.y, id: unit.id });
        },
        onTick({ battle, unit, dt }) {
          const others = battle.alliesInGrid(unit).filter((a) => a !== unit);
          for (const a of others) inspire(battle, a, unit.s.maxHp * num(bb.max_hp, 0.65), unit, 'hp');
          unit.mem.redist += dt;
          if (unit.mem.redist + 1e-9 < redistIv) return;
          unit.mem.redist -= redistIv;
          const pool = battle.alliesInGrid(unit).filter((a) => !(a.s.flags.noHeal || a.profile?.noHeal) || a === unit);
          let hp = 0, max = 0;
          for (const a of pool) { hp += a.hp; max += a.s.maxHp; }
          if (!(max > 0) || pool.length < 2) return;
          const ratio = Math.min(1, hp / max);
          for (const a of pool) a.hp = Math.max(1, Math.min(a.s.maxHp, a.s.maxHp * ratio));
          battle.fx('redistribute', { x: unit.x, y: unit.y, id: unit.id, ratio: Math.round(ratio * 1000) / 1000 });
        },
        onEnd({ unit }) { if (unit.mem.bardBase != null) unit.profile.auraRatio = unit.mem.bardBase; },
      },
      talents: [
        { install(battle, unit) { // 过往尘埃: 3 motes; touching an operator ⇒ her trait heal ×1.5 on it for 6 s; mote back after 6 s
          unit.mem.motes = new Array(baseCnt).fill(-Infinity);
          unit.mem.noInspire = true; // trait: 自身不受鼓舞影响 (another bard's 鼓舞 skips her)
          const cooldown = () => (S1 && skillActive(unit) ? num(bb.talent_cool_down, 3) : num(t0.cooldown, 6)); // S1: 重生速度加快
          const takeMote = () => {
            const i = unit.mem.motes.findIndex((t) => t <= battle.time + 1e-9);
            if (i < 0) return false;
            unit.mem.motes[i] = battle.time + cooldown();
            return true;
          };
          whileDeployed(battle, unit, 0.25, () => {
            if (S2 && skillActive(unit)) {
              // S2: motes orbit wider and hit enemies instead of operators
              const hitAt = unit.mem.moteHit || (unit.mem.moteHit = new Map());
              const foes = battle.foesInRadius(unit.x, unit.y, num(bb.outside_radius, 2)).filter((e) => canTargetEnemy(unit, e, { canHitFly: true }))
                .sort((a, b) => a.id - b.id);
              for (const e of foes) {
                if ((hitAt.get(e.id) ?? -Infinity) > battle.time + 1e-9) continue;
                if (!takeMote()) break;
                hitAt.set(e.id, battle.time + MOTE_GAP);
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 2.2), type: 'true', isSkill: true, tags: ['skill', 'mote'] });
                if (e.alive) battle.applyStatus(e, 'bind', { duration: num(bb.unmoveable_duration, 3), source: unit });
                battle.fx('mote', { x: e.x, y: e.y, id: e.id });
              }
              return;
            }
            const keep = S3 && skillActive(unit); // S3: “微尘”不再消失
            for (const a of battle.alliesInRadius(unit.x, unit.y, num(t0.range_radius, 1.15), unit.ownerId)) {
              if (a === unit || a.kind !== 'op' || a.findBuff(`cetsyr:mote:${unit.id}`)) continue;
              if (!keep && !takeMote()) break;
              battle.addBuff(a, { key: `cetsyr:mote:${unit.id}`, duration: num(t0.talent_duration, 6), visible: true, source: unit });
              battle.fx('mote', { x: a.x, y: a.y, id: a.id });
            }
          });
          battle.on('heal', (c) => {
            if (c.source === unit && c.opts?.aura && c.target.findBuff(`cetsyr:mote:${unit.id}`)) c.amount *= num(t0['attack@trait_mul'], 1.5);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 魔王残响: every ally takes −10 % damage from 萨卡兹 enemies (while she is in the squad)
          battle.on('hit', (c) => {
            if (c.target.side === 'ally' && c.target.ownerId === unit.ownerId && enemyHasTag(c.source, 'sarkaz')) c.dmg.mul *= 1 - num(t1.damage_resistance, 0.1);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const a = num(mb.atk, 0), cnt = num(mb.cnt, 2); // module (elite): ≥ 2 other operators in her normal range ⇒ ATK +8 %
        if (!a) return;
        whileDeployed(battle, unit, AURA, () => {
          const set = new Set(unit.baseRangeKeys || []);
          const n = battle.allies(unit.ownerId).filter((o) => o !== unit && o.kind === 'op' && set.has(o.tileR * COLS + o.tileC)).length;
          toggleBuff(battle, unit, 'cetsyr:module', n >= cnt, { atkPct: a });
        });
      },
    };
  },

  // ===== 华法琳 (physician) S1 紧急包扎 — charges: a heal on an ally below 50 % adds 15 % of its max HP; 血液样本回收
  //       S2 不稳定血浆 (she and one random other ally in range: ATK +45 %/+60 %, lose 3 % max HP per s, 15 s)
  chess_char_4_26_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    const S1 = isSel(def, 'skchr_bldsk_1');
    const plasma = (battle, unit, a) => battle.addBuff(a, {
      key: 'bldsk:plasma', duration: num(bb.duration, 15) + 1e-6, interval: Math.max(0.1, num(bb.interval, 1)), mods: { atkPct: num(bb.atk) }, visible: true, source: unit,
      onTick: ({ unit: t }) => battle.loseHp(t, t.s.maxHp * num(bb.hp_ratio, 0.03), { tags: ['skill', 'plasma'] }), // (no source: not damage dealt)
    });
    return {
      skills: alt(def, {
        skchr_bldsk_2: () => ({
          kind: 'instant', heal: true,
          onStart({ battle, unit }) {
            plasma(battle, unit, unit);
            const pick = battle.rng.pick(battle.alliesInGrid(unit).filter((a) => a !== unit));
            if (pick) plasma(battle, unit, pick);
            battle.fx('bloodBattle', { x: unit.x, y: unit.y, id: unit.id, target: pick ? pick.id : null });
          },
        }),
      }),
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        heal: true,
        trigger: { rule: 'CUSTOM_RANGE', grid: [] }, // never auto-cast by the engine: fired by the kit on a < 50 % heal target
      },
      talents: [{ install(battle, unit) { // 血液样本回收: an enemy falls in range ⇒ +2 SP to her and a random ally in range
        battle.on('death', (c) => {
          const e = c.unit;
          if (c.reason !== 'killed' || e.side !== 'enemy' || !unit.alive || !unit.deployed || !bodyInKeys(e, keySet(unit))) return;
          unit.skill?.gainSp(num(t0['bldsk_t_1[self].sp'], 2), 'talent');
          // SP cannot be gained while a timed skill runs (engine gainSp ignores it): such allies are not picked
          const pick = battle.rng.pick(battle.alliesInGrid(unit).filter((a) => a !== unit && a.skill && !a.skill.noSkill && a.skill.kind !== 'passive' && !(a.skill.active && a.skill.isTimed)));
          if (pick) { pick.skill.gainSp(num(t0['bldsk_t_1[rand].sp'], 2), 'talent'); battle.fx('spGift', { x: pick.x, y: pick.y, id: pick.id }); }
        }, { owner: unit });
      } }],
      install(battle, unit) {
        installLowHpHealBonus(battle, unit, tb);
        if (!S1) return;
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit) return;
          const t = c.targets[0];
          const sk = unit.skill;
          if (!t || t.side !== 'ally' || t.hpRatio >= 0.5 || !sk || !sk.ready || unit.s.flags.silence) return;
          if (sk.activate('DEFAULT')) unit.mem.bandage = t;
        }, { owner: unit, priority: 5 });
        battle.on('attack', (c) => {
          if (c.attacker !== unit || !unit.mem.bandage) return;
          const t = unit.mem.bandage;
          unit.mem.bandage = null;
          unit.mem.skipSp = true; // the skill heal recovers no attack SP (AK)
          if (t.alive) { battle.heal(unit, t, t.s.maxHp * num(bb.hp_ratio, 0.15)); battle.fx('bandage', { x: t.x, y: t.y, id: t.id }); }
        }, { owner: unit });
        battle.on('spGain', (c) => { if (c.unit === unit && c.reason === 'attack' && unit.mem.skipSp) { unit.mem.skipSp = false; c.amount = 0; } }, { owner: unit });
      },
    };
  },
};

/** Physician module trait (录武官, 华法琳 elites): heals on allies below hp_ratio are ×heal_scale. */
function installLowHpHealBonus(battle, unit, tb) {
  const s = num(tb.heal_scale, 0), r = num(tb.hp_ratio, 0);
  if (!(s > 0) || !(r > 0)) return;
  battle.on('heal', (c) => { if (c.source === unit && c.target !== unit && c.target.hpRatio < r) c.amount *= s; }, { owner: unit });
}

// DESIGN §5.6 documents `(bb, chess)`; content/index.js also passes the normalised def — rebuild it when absent.
export default Object.freeze(Object.fromEntries(Object.entries(kits).map(([id, f]) => [id, (bb, chess, def) => f(bb || {}, chess, def || normalizeChess(chess))])));
