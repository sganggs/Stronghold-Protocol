// server/sim/content/kits/ops/op-necras.js — 死芒 (char_450_necras) 自选 operator kit: 6★ 塑灵术师 (术师), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, the module SOC-X 未处理的遗产 at every form, and the kit of
// her summon 悲叹的仆役 (token_10043_necras_skeltn) and its special form. Kit contract and the 自选 rules: ../README.md ("How to
// add an operator (自选)").
//
// Forms (data/backups.json units.char_450_necras): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / the token row (zh_CN, as built into backups.json), PRTS 死芒
// (复燃 备注 "天赋无视敌人隐匿效果。优先在被击倒敌人所在地块进行召唤，此地块不可部署或非通过击杀触发此天赋时于攻击范围内随机可部署地块
// （优先存在敌人的）进行召唤，召唤物的朝向与死芒保持一致", "无法再次召唤时尝试升级召唤物（无视孤立）：优先选择未升级的>生命值最低>仇恨值
// 最高的召唤物，令其升级（若未升级）并治疗其100%生命值（无视禁疗…不受治疗效果增减影响）"; the module page; S1 备注 "重新召唤以第一天赋的
// 逻辑进行。每个被移除的已升级的召唤物提供2次召唤；重新召唤每间隔0.1s进行一次", "被动伤害范围半径1.5(中点判定)，可对空，伤害来源为死芒
// 自身"; S2 备注 "额外召唤以第一天赋的逻辑进行", "可被眩晕/冰冻/沉默效果打断；目标被击倒/离地，或进入消失状态时中断与该目标的链接；所有链接
// 全部中断时立刻中止技能"; S3 备注 "场上不存在特殊召唤物时，下一个生成的召唤物会变为特殊召唤物…最大生命值+200%，攻击力+200%，防御力+100%，
// 法术抗性+10，攻击间隔+0.7，阻挡数+1", "特殊召唤物每次升级时：最大生命值+80%，攻击力+80%，防御力+40%；第3/6次升级时额外获得：获得阻挡数
// +1，技能攻击距离+1", "攻击范围扩大并进行技能描述的普通攻击（触发攻击无需目标），直至达到重复上限后停止技能", "可以消耗普通召唤物时，消耗一个
// 普通召唤物进行治疗（必定治疗且无视禁疗）…消耗已升级的普通召唤物时该流程会进行2次"), PRTS 悲叹的仆役 (备注: 持有禁疗; "自身不是特殊形态
// 召唤物时，持有阻回、沉默，且自身的技力自然回复速度属性强制归0"; "普通攻击造成法术伤害，可以且优先攻击自身阻挡的单位"; 怨火缠身 "仅持有
// 者携带技能冠死以冕时，自身才会携带此技能"), PRTS 分支特性信息 塑灵术师 ("可对空", "干员离场时，其附属的召唤物会随之退场"), and the client's
// battle data read from the local install — charpack char_450_necras (talent 1 necras_t_1 on the enemies of her range,
// stealth ignored; NecrasTokenSelector: melee low buildable tiles of her range, enemy tiles first, random; SpawnToken =
// [TrySpawnToken, UpgradeToken], UpgradeToken = [TryUpgradeToken (a token without necras_t_1[upgrade], lowest HP first), HealToken
// (a token that is no special form)]; talent 2 necras_t_2 on her and her tokens; talent 3 necras_t_3 (S1 only) and talent 4
// necras_t_4 (S3 only) on her tokens; UpgradeDragon; the S3 mode attack with `_allowNoTarget` and necras_s_3[before_attack] /
// [after_attack]), the token prefab token_10043_necras_skeltn (skeltn_block_skill: 沉默 + 阻回 + SP_RECOVERY 0; skeltn_heal_free
// 禁疗; Default / Dragon / Skill modes; the special form holds necras_t_1[upgrade]), the skill prefabs skchr_necras_1 / 2 / 3 and
// sktok_necras_skeltn_3, projectile_chr_necras_s2 (`_getLifeTimeFromBB` hit_duration, `_isSilenceable`, `_dontHitInvincibleTarget`,
// `_detachAllBuffsWhenStopped`), the equip prefabs (necras_e_002_tr; stage 3 necras_e_002_t on the enemies of her range and
// necras_e_002_t[token] on those of her tokens' ranges) and buff_template_data (necras_t_1 / [spawn_token] / [upgrade],
// necras_t_2 DamageScale, necras_t_3 / [damage], necras_t_4 / [dragon], necras_s_1 / [fallback], necras_s_2 / [damage_sleep],
// necras_s_3 / [after_attack], necras_upgrade_dragon, necras_e_002_tr AtkScaleUp, necras_e_002_t / [token]).
//
// - Trait (塑灵术师) "攻击造成法术伤害，可以通过击倒敌人生成召唤物，可攻击到自身召唤物阻挡的敌人": ranged arts, 3-1, hits air; the tiles of
//   the enemies her 悲叹的仆役 block are her targets too (Battle.setExtraRange, re-read every tick). SOC-X adds "且攻击力提升至115%"
//   (trait bb atk_scale; necras_e_002_tr AtkScaleUp): her damage on an enemy one of her summons blocks × atk_scale.
// - T1 复燃 "攻击范围内敌人被击倒时生成一个悲叹的仆役，最多召唤3个，若无法再次召唤则使一个悲叹的仆役升级（提升阻挡数与更多的生命、攻击和防御）":
//   an enemy knocked out on her attack range (by anyone; stealth ignored) queues one summon on its tile; queued summons are
//   made one every 0.1 s: with fewer than max_token_cnt of hers on the field, a 悲叹的仆役 on the hinted tile when it is a free,
//   low melee tile of her range, else on a random such tile of her range (those with an enemy first), facing as she does —
//   no tile ⇒ the upgrade instead; at the cap: the upgrade — a 悲叹的仆役 not yet upgraded (lowest HP, then the highest 仇恨值)
//   gets max_hp / atk / def (Σpct) and block_cnt, every one already upgraded: the lowest-HP one (not the special form) — and is
//   healed to full (无视禁疗). SOC-X stage 2+ (the module's own talent part, read apart from the base talent whose `atk` it
//   shares): "自身和召唤物攻击范围内敌人被击倒时在10秒内自身攻击力+25%，并在攻击范围内生成一个悲叹的仆役": a knock-out on her range
//   or on one of her summons' ranges ⇒ her ATK +atk for atk_duration s (refreshed), and one on a summon's range only queues a
//   summon with no tile (a random tile of her range).
// - T2 回光黯淡 "自身和召唤物攻击生命低于50%的敌人时攻击力提升至140%" (full potential: 60%, 145%): every damage she or her
//   summons deal to an enemy below hp_ratio HP × damage_scale (necras_t_2 DamageScale: the final damage).
// - 悲叹的仆役: the token's stats for her form; arts melee, x-5, blocks 1 (upgraded 2), 禁疗; the normal form holds 阻回 / 沉默 (no
//   skill). Her leaving withdraws them; each is withdrawn when she leaves (WithdrawTokens).
// - S1 噩愿 (MANUAL, data DEFAULT): passive — each 悲叹的仆役 made or upgraded (the T1 upgrade) strikes every enemy within
//   range_radius (中点判定, air units too) for her ATK × atk_scale arts (source: her); active — every 悲叹的仆役 of hers is
//   withdrawn and queues 1 summon (2 for an upgraded one); none ⇒ 1.
// - S2 折朽 (MANUAL, DEFAULT): 12 s; up to max_target enemies of her range are linked: 沉睡 while linked and every interval s her
//   ATK × atk_scale arts on each (through the sleep: necras_s_2[damage_sleep]); she makes no attack meanwhile. A link breaks when
//   its target is knocked out, airborne (浮空 / a flyer's ascent) or gone (hidden, removed); the skill ends when none is left,
//   or when she is stunned, frozen or silenced. A linked target knocked out queues additional_token_cnt summons (no tile).
// - S3 冠死以冕 (MANUAL, data SKILL_RANGE on its 3-3): passive — when she has no special form, the next 悲叹的仆役 made becomes it
//   (her hidden talent: +200 % max HP / ATK, +100 % DEF, +10 RES, +0.7 s attack interval, block +1), which holds 怨火缠身
//   (AUTO, 15 SP over time, 8 s: every second its ATK × attack@atk_scale arts on every enemy of its 1-1, the first at the cast
//   [ASSUMED]) and is upgraded only by this skill (≤ attack@max_stack_cnt): +attack@max_hp / atk / def (Σpct per upgrade), healed
//   attack@hp_ratio of its max HP; the 3rd and 6th add block +attack@block_cnt and 攻击距离 +attack@ability_range_forward_extend.
//   Active — her range is the 3-3 while it runs; two "attacks" at her attack interval (the first at the cast; no target needed):
//   each strikes every enemy of the 3-3 for ATK × attack@atk_scale arts, then consumes her earliest normal 悲叹的仆役 (withdrawn)
//   and upgrades the special form once — twice (0.1 s apart) when the consumed one was upgraded.
// [ASSUMED] the earliest-made normal summon is the one consumed (PRTS: 实体栈 order, unpredictable); the special form's 攻击距离
// widens its x-5 too (the attribute ABILITY_RANGE_FORWARD_EXTEND); the S3 strikes are skill damage (no normal-attack procs).

import { num, talentBb, traitBb, skillRec, moduleOn, up, batMod } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets, aggroCmp } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_necras_1';
const S2 = 'skchr_necras_2';
const S3 = 'skchr_necras_3';
export const SKELETON = 'token_10043_necras_skeltn';
/** The summon queue: one summon / upgrade every 0.1 s (necras_t_1[spawn_token] interval). */
const QUEUE_EVERY = 0.1;
/** UpgradeDragon twice for an upgraded summon: the second 0.1 s later (necras_s_3[delay_upgrade]). */
const DELAY_UPGRADE = 0.1;
const UPGRADE_KEY = 'necras:upgrade';
const DRAGON_KEY = 'necras:dragon';
const DRAGON_UP_KEY = 'necras:dragonUp';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileKey = (r, c) => r * COLS + c;
/** The module the record fights with (its active one), or null. */
function activeModule(chess) {
  if (!moduleOn(chess)) return null;
  return (chess.modules ?? []).find((m) => m && m.uniEquipId === chess.module.id) ?? null;
}
/** Her state for the battle. */
const stateOf = (unit) => unit.mem.necras ?? (unit.mem.necras = { queue: [], skels: [], dragon: null, timer: null });
const skelsUp = (unit) => stateOf(unit).skels.filter((s) => up(s));
/** Her own attack range (no extra keys): the live grid behind her rangeKeys. */
const ownRange = (unit) => new Set(absoluteRangeKeys(unit.liveRangeGrid ?? unit.rangeGrid ?? [[0, 0]], unit.tileR, unit.tileC, unit.dir, 0));

export default {
  char_450_necras: (bb, chess) => {
    const base0 = talentBb({ talents: chess?.talentsBase ?? chess?.talents }, 0);   // 复燃 without the module part
    const mod = activeModule(chess);
    const modT0 = (mod?.talentChanges ?? []).filter((t) => t && t.talentIndex === 0).reduce((o, t) => Object.assign(o, t.bb ?? {}), {});
    const t1 = talentBb(chess, 1);
    const dragonBb = (chess?.talents ?? []).find((t) => t && t.bb && t.bb.base_attack_time != null)?.bb ?? {};
    const maxCnt = num(base0.max_token_cnt, 3);
    const up0 = { hpPct: num(base0.max_hp), atkPct: num(base0.atk), defPct: num(base0.def), blockCnt: num(base0.block_cnt) };
    const killAtk = num(modT0.atk), killDur = num(modT0.atk_duration);
    const lowHp = num(t1.hp_ratio), lowMul = num(t1.damage_scale, 1);
    const traitScale = num(traitBb(chess).atk_scale, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);

    /** Free low melee tiles of her range, those with an enemy first (NecrasTokenSelector). */
    const spawnTiles = (battle, unit) => {
      const keys = ownRange(unit);
      const free = [], withEnemy = [];
      for (const k of keys) {
        const r = Math.floor(k / COLS), c = k % COLS;
        if (!battle.grid.inRect(r, c) || battle.isReservedTile(r, c) || !battle.grid.canStand(r, c, { ranged: false })) continue;
        free.push([r, c]);
        if (battle.enemies.some((e) => e.alive && !e.hidden && Math.round(e.y) === r && Math.round(e.x) === c)) withEnemy.push([r, c]);
      }
      return withEnemy.length ? withEnemy : free;
    };
    const tileOk = (battle, unit, r, c) => Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c)
      && ownRange(unit).has(tileKey(r, c)) && !battle.isReservedTile(r, c) && battle.grid.canStand(r, c, { ranged: false });

    /** S1's passive strike around a summon made or upgraded. */
    const s1Strike = (battle, unit, s) => {
      if (unit.skill?.id !== S1 || !up(unit)) return;
      const scale = num(b1.atk_scale), rad = num(b1.range_radius, 1.5);
      if (!(scale > 0)) return;
      for (const e of battle.foesInRadius(s.x, s.y, rad, true)) {
        if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'necras:s1'] });
      }
      battle.fx('aoe', { x: s.x, y: s.y, radius: rad, id: unit.id, skill: 'necras:s1' });
    };

    /** The T1 upgrade (or, every summon upgraded, the heal of the lowest one) — never the special form. */
    const upgradeOne = (battle, unit) => {
      const list = skelsUp(unit).filter((s) => !s.mem.necrasDragon);
      if (!list.length) return false;
      const byHp = (a, b) => a.hp - b.hp || aggroCmp(a, b);
      const fresh = list.filter((s) => !s.findBuff(UPGRADE_KEY)).sort(byHp);
      const s = fresh[0] ?? list.slice().sort(byHp)[0];
      if (fresh.length) {
        const mods = Object.fromEntries(Object.entries(up0).filter(([, v]) => v));
        battle.addBuff(s, { key: UPGRADE_KEY, mods, persist: true, allowDead: true, tags: ['talent'] });
        s1Strike(battle, unit, s);
      }
      battle.heal(s, s, s.s.maxHp, { self: true, ignoreHealFree: true });
      battle.fx('grow', { x: s.x, y: s.y, id: s.id });
      return true;
    };

    /** A new 悲叹的仆役 on [r, c]; the special form when S3 is carried and she has none. */
    const makeSkeleton = (battle, unit, r, c) => {
      const s = battle.spawnToken(unit, SKELETON, r, c, { kit: skeletonKit(unit, battle.tokenDef(SKELETON, unit)), dir: unit.dir, anySource: true });
      if (!s) return null;
      const st = stateOf(unit);
      st.skels.push(s);
      if (unit.skill?.id === S3 && !(st.dragon && up(st.dragon))) {
        st.dragon = s;
        s.mem.necrasDragon = true;
        battle.addBuff(s, { key: DRAGON_KEY, persist: true, allowDead: true, tags: ['talent'], mods: {
          hpPct: num(dragonBb.max_hp), atkPct: num(dragonBb.atk), defPct: num(dragonBb.def), resFlat: num(dragonBb.magic_resistance),
          batPct: batMod(dragonBb.base_attack_time, { stats: s.def.stats }), blockCnt: num(dragonBb.block_cnt) } });
        battle.removeBuff(s, 'necras:normal');
        s.hp = s.s.maxHp;
      }
      battle.fx('summon', { x: s.x, y: s.y, id: s.id, src: unit.id });
      s1Strike(battle, unit, s);
      return s;
    };

    /** Process the queue head (one summon / upgrade per QUEUE_EVERY). */
    const step = (battle, unit) => {
      const st = stateOf(unit);
      if (!up(unit)) { st.queue.length = 0; return; }
      if (!st.queue.length) return;
      const hint = st.queue.shift();
      if (skelsUp(unit).length < maxCnt) {
        let tile = hint && tileOk(battle, unit, hint[0], hint[1]) ? hint : null;
        if (!tile) { const opts = spawnTiles(battle, unit); tile = opts.length ? battle.rng.pick(opts) : null; }
        if (tile && makeSkeleton(battle, unit, tile[0], tile[1])) return;
      }
      upgradeOne(battle, unit);
    };
    /** Queue `n` summons (tile hint or null). */
    const queue = (battle, unit, n, hint = null) => {
      const st = stateOf(unit);
      for (let i = 0; i < n; i++) st.queue.push(hint);
      if (st.timer) return;
      st.timer = battle.every(QUEUE_EVERY, (b, sc) => {
        if (!st.queue.length) { sc.cancel(); st.timer = null; return; }
        step(b, unit);
      }, { owner: unit });
    };

    /** UpgradeDragon: one more upgrade of her special form (≤ max), healed attack@hp_ratio. */
    const upgradeDragon = (battle, unit) => {
      const d = stateOf(unit).dragon;
      if (!d || !up(d)) return;
      const max = num(b3['attack@max_stack_cnt'], 6);
      const n = Math.min(max, (d.mem.necrasUps ?? 0) + 1);
      d.mem.necrasUps = n;
      const third = Math.floor(n / 3);
      battle.addBuff(d, { key: DRAGON_UP_KEY, persist: true, allowDead: true, tags: ['skill'], mods: {
        hpPct: num(b3['attack@max_hp']) * n, atkPct: num(b3['attack@atk']) * n, defPct: num(b3['attack@def']) * n,
        ...(num(b3['attack@magic_resistance']) ? { resFlat: num(b3['attack@magic_resistance']) * n } : {}),
        ...(third ? { blockCnt: num(b3['attack@block_cnt'], 1) * third, rangeExtend: num(b3['attack@ability_range_forward_extend'], 1) * third } : {}) } });
      battle.heal(d, d, d.s.maxHp * num(b3['attack@hp_ratio']), { self: true, ignoreHealFree: true });
      battle.fx('grow', { x: d.x, y: d.y, id: d.id, n });
    };

    /** 悲叹的仆役 kit (`def` = its token def for her loadout: 怨火缠身 only when she carries S3). */
    const skeletonKit = (owner, def) => {
      const sk = def?.skill ?? null;
      const sb = sk?.bb ?? {};
      const grid = sk?.rangeGrid ?? [[0, 0], [0, 1]];
      const scale = num(sb['attack@atk_scale']);
      const dragonSkill = sk && sk.id === 'sktok_necras_skeltn_3' ? {
        // 怨火缠身 (the special form only: the normal form holds 阻回 / 沉默): every second its ATK × attack@atk_scale arts on every
        // enemy of its 1-1 (攻击距离 included), 8 s
        kind: 'duration',
        duration: num(sb['attack@duration'], num(sk.duration, 8)),
        attack: { noAttack: true },
        onStart({ battle: b, unit: me }) {
          const seq = me.skill.activations;
          const hit = () => {
            if (!me.skill.active || me.skill.activations !== seq || !up(me)) return false;
            const keys = absoluteRangeKeys(grid, me.tileR, me.tileC, me.dir, me.s.rangeExtend || 0);
            for (const e of b.enemiesInKeys(keys, me, { canHitFly: false })) b.dealDamage(me, e, { amount: me.s.atk * scale, type: 'arts', isSkill: true, tags: ['summon', 'skill'] });
            b.fx('aoe', { x: me.x, y: me.y, radius: 1, id: me.id, skill: 'necras:dragon' });
            return true;
          };
          hit();
          b.every(1, (b2, sc) => { if (!hit()) sc.cancel(); }, { owner: me });
        },
      } : null;
      return {
        skill: dragonSkill,
        trait: {},
        talents: [],
        install(battle, me) {
          battle.addBuff(me, { key: 'necras:healFree', flags: { noHeal: true }, persist: true, allowDead: true });   // 禁疗
          battle.addBuff(me, { key: 'necras:normal', flags: { noSp: true, silence: true }, persist: true, allowDead: true });
          // T2 回光黯淡: her summons' damage too
          battle.on('hit', (ctx) => {
            if (ctx.source !== me || !ctx.target || ctx.target.side !== 'enemy') return;
            if (lowHp > 0 && lowMul !== 1 && ctx.target.hpRatio < lowHp) ctx.dmg.mul = (ctx.dmg.mul ?? 1) * lowMul;
          }, { owner: me });
        },
      };
    };

    return {
      skills: {
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            // 立刻重新召唤所有悲叹的仆役: each withdrawn, 1 summon (2 if upgraded); none ⇒ 1
            const list = skelsUp(unit);
            let n = 0;
            for (const s of list) {
              n += s.findBuff(UPGRADE_KEY) ? 2 : 1;
              battle.retreat(s, { reason: 'expired', permanent: true });
            }
            queue(battle, unit, n || 1, null);
          },
        },
        [S2]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            const max = Math.max(1, Math.floor(num(b2.max_target, 2)));
            const list = battle.enemiesInKeys([...ownRange(unit)], unit, unit.profile);
            sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
            const links = list.slice(0, max).map((e) => ({ e, seq: e.deploySeq, flying: e.isFlying }));
            const seq = unit.skill.activations;
            const dur = unit.skill.timeLeft;
            unit.mem.necrasLinks = links;
            for (const l of links) {
              if (battle.applyStatus(l.e, 'sleep', { duration: dur, source: unit })) battle.fx('sleep', { x: l.e.x, y: l.e.y, id: l.e.id });
            }
            const broken = (l) => !l.e.alive || l.e.hidden || l.e.removed || l.e.deploySeq !== l.seq || (!l.flying && l.e.isFlying);
            const scale = num(b2.atk_scale);
            const every = num(b2.interval, 0.5);
            battle.every(every, (b, sc) => {
              if (!unit.skill.active || unit.skill.activations !== seq || unit.skill.id !== S2) { sc.cancel(); return; }
              for (const l of links) if (!l.done && !broken(l)) b.dealDamage(unit, l.e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, ignoreSleep: true, tags: ['skill', 'necras:s2'] });
            }, { owner: unit });
            // the links: a broken one releases its target; none left (or her 晕眩 / 冰冻 / 沉默) ends the skill
            battle.every(0.05, (b, sc) => {
              if (!unit.skill.active || unit.skill.activations !== seq || unit.skill.id !== S2) { sc.cancel(); return; }
              for (const l of links) {
                if (l.done || !broken(l)) continue;
                l.done = true;
                if (l.e.alive && l.e.findBuff('sleep')) b.removeStatus(l.e, 'sleep');
              }
              const f = unit.s.flags;
              if (links.every((l) => l.done) || f.stun || f.freeze || f.silence) unit.skill.end('links');
            }, { owner: unit });
          },
          onEnd({ battle, unit }) {
            for (const l of unit.mem.necrasLinks ?? []) {
              if (!l.done && l.e.alive && l.e.findBuff('sleep')) battle.removeStatus(l.e, 'sleep');
              l.done = true;
            }
            unit.mem.necrasLinks = null;
          },
        },
        [S3]: {
          kind: 'duration',
          duration: 999,
          targeting: { rangeGrid: s3?.rangeGrid ?? null },
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            const seq = unit.skill.activations;
            const strike = (k) => {
              if (!unit.skill.active || unit.skill.activations !== seq || !up(unit)) return;
              // a normal attack of the S3 mode: none while she cannot act (晕眩 / 冻结 …) — it waits
              if (!unit.canAct) { battle.after(0.1, () => strike(k), { owner: unit }); return; }
              const scale = num(b3['attack@atk_scale']);
              for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile)) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'necras:s3'] });
              }
              battle.fx('aoe', { x: unit.x, y: unit.y, radius: 3, id: unit.id, skill: 'necras:s3' });
              // 消耗一个悲叹的仆役使特殊仆役升级 (twice for an upgraded one)
              const prey = skelsUp(unit).filter((s) => !s.mem.necrasDragon).sort((a, b) => a.deploySeq - b.deploySeq)[0] ?? null;
              if (prey) {
                const twice = !!prey.findBuff(UPGRADE_KEY);
                battle.retreat(prey, { reason: 'expired', permanent: true });
                upgradeDragon(battle, unit);
                if (twice) battle.after(DELAY_UPGRADE, () => upgradeDragon(battle, unit), { owner: unit });
              }
              const reps = Math.max(1, Math.floor(num(b3['attack@necras_s_3[attack_cnt].max_stack_cnt'], 2)));
              if (k + 1 >= reps) { unit.skill.end('done'); return; }
              battle.after(unit.s.interval, () => strike(k + 1), { owner: unit });
            };
            strike(0);
          },
        },
      },
      talents: [
        { install(battle, unit) {
          // 复燃 (+ SOC-X stage 2+): a knock-out on her range / on her summons' ranges
          battle.on('death', (ctx) => {
            const e = ctx.unit;
            if (!e || e.side !== 'enemy' || ctx.reason !== 'killed' || !up(unit)) return;
            const mine = bodyInKeys(e, ownRange(unit));
            const theirs = !mine && killAtk > 0 && skelsUp(unit).some((s) => bodyInKeys(e, new Set(s.rangeKeys ?? [])));
            if (!mine && !theirs) return;
            if (killAtk > 0 && killDur > 0) battle.addBuff(unit, { key: 'necras:killAtk', duration: killDur, mods: { atkPct: killAtk }, tags: ['talent'] });
            queue(battle, unit, 1, mine ? [Math.round(e.y), Math.round(e.x)] : null);
          }, { owner: unit });
          // her summons leave with her (WithdrawTokens)
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            const st = stateOf(unit);
            st.queue.length = 0;
            for (const s of skelsUp(unit)) battle.retreat(s, { reason: 'expired', permanent: true });
          }, { owner: unit });
          // S2: a linked target knocked out ⇒ additional_token_cnt summons
          battle.on('death', (ctx) => {
            if (ctx.reason !== 'killed' || !up(unit) || unit.skill?.id !== S2 || !unit.skill.active) return;
            const l = (unit.mem.necrasLinks ?? []).find((x) => x.e === ctx.unit && !x.done);
            if (!l) return;
            l.done = true;
            queue(battle, unit, Math.max(0, Math.floor(num(b2.additional_token_cnt, 2))), null);
          }, { owner: unit, priority: -5 });
        } },
        { install(battle, unit) {
          // 回光黯淡: her damage on an enemy below hp_ratio × damage_scale (final); SOC-X: × atk_scale on one her summon blocks
          battle.on('hit', (ctx) => {
            if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy') return;
            if (traitScale !== 1 && ctx.target.blockedBy && stateOf(unit).skels.includes(ctx.target.blockedBy)) ctx.dmg.amount *= traitScale;
            if (lowHp > 0 && lowMul !== 1 && ctx.target.hpRatio < lowHp) ctx.dmg.mul = (ctx.dmg.mul ?? 1) * lowMul;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // PRTS 卫戍协议/帮助: special targeting also supplies the DEFAULT attack opportunity (#440).
        // Query live owned blockers for both paths; S2's links still use its own effect range, S3 keeps SKILL_RANGE.
        const blockedKeys = () => {
          if (!up(unit)) return [];
          const keys = [];
          for (const s of skelsUp(unit)) for (const e of s.blocking) if (e.alive && e.blockedBy === s) keys.push(tileKey(Math.round(e.y), Math.round(e.x)));
          return [...new Set(keys)].sort((a, b) => a - b);
        };
        if (unit.skill?.id === S1 || unit.skill?.id === S2) {
          unit.skill.addTriggerRange(() => [{ keys: blockedKeys(), profile: unit.profile }], { attackOnly: true });
        }
        // trait: the enemies her summons block are her targets too
        battle.on('tick', () => {
          if (!up(unit)) return;
          const uniq = blockedKeys();
          const cur = unit.extraRangeKeys ?? [];
          if (uniq.length === cur.length && uniq.every((k, i) => k === cur[i])) return;
          battle.setExtraRange(unit, uniq.length ? uniq : null);
        }, { owner: unit });
      },
    };
  },
};
