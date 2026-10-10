// server/sim/content/kits/ops/op-shu.js — 黍 (char_2025_shu) 自选 operator kit: 6★ 守护者 (重装), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_2025_shu, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, GUA-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 黍 (百谷长青 备注
// "本天赋效果为永久地块效果，自身退场时清空所有地块的播种效果，不对装置职业的目标生效。生命恢复的提供方式为增加位于地块上干员的
// “生命回复速度”属性，不受治疗加成和禁疗影响"; 天有四时 修正 "在场时" / "编入队伍且"; S1 修正 "小于等于一半"; S2 备注 "实际效果为技能
// 期间普通攻击改为治疗友方单位（受攻速和缴械影响，非停止攻击），“特殊间隔”指攻击间隔+1.3"; S3 备注 "技能持续期间视野扩大至治疗范围，
// 自身普通攻击同时触发治疗，无攻击目标时普通攻击可直接进行治疗", the 【播种标记】 and its teleport, "攻击力/攻击速度提升效果无视孤立");
// PRTS 卫戍协议/帮助 §技能操作 (黍【离离枯荣】 "技能范围内存在可治疗的我方单位时释放技能"); the client's battle data: buff templates
// shu_t_1 / shu_t_1[char] / shu_farm_buff[char] / shu_s_2 / shu_s_3 / shu_s_3[in_range] / shu_s_3[heal_in_attack] /
// shu_s_3[enemy][enter|leave|mark] / heal_scale_up[hpratio][LE], her charpack (the S2 / S3 modes' Attack / Heal
// abilities, DoFarm / EnemyListener tile abilities and their selectors, the 天有四时 auras and deck part) and the skill
// prefabs skchr_shu_1..3; Arknights Terra Wiki "Shu".
// - Trait (守护者) "技能可以治疗友方单位": her normal attack is a melee physical strike (ground-only, block 3, range 0-1 — her own
//   tile); only her skills heal. Module GUA-X “钦天司时” "治疗生命值低于50%的友方单位时治疗量提升15%" (trait bb heal_scale /
//   hp_ratio): every heal of hers on a target at or below hp_ratio ×heal_scale (the client template is heal_scale_up
//   [hpratio][LE]: at or below — the text says 低于), never an HP-regen tick.
// - T1 百谷长青 (shu_t_1): every heal she outputs (S1 / S2 / S3; never a regen tick) sows the healed unit's tile and the four
//   next to it (DoFarm, range x-5) — tiles that can be deployed on or walked (the tile selector: buildable or passable). A
//   sown tile stays sown until she leaves the field (death / retreat clears them all). Every allied unit standing on one —
//   operators and summons, not 装置 (professionMask 767) nor a 孤立 unit (no ignoreTargetFree) — has 生命回复速度
//   +hp_recovery_per_sec (an hpRegen buff, checklist 11: 禁疗 / 无法被友方治疗 do not stop it — 斥罪 too) and 庇护
//   damage_resistance (the shared applyStrongest key PROTECT), refreshed every FARM_EVERY s (and at once on a sowing and at
//   S2's start / end); both × S2's extra_extend_scale while S2 runs (shu_s_2 sets DoFarm's extra_extend_scale). Two 黍 of a
//   shared field: the stronger regeneration and 庇护 hold. GUA-X stage 3 (full potential): 85 / s, 17 % and
//   "部署时立即给所处地块播种该效果" (bbStr born_range_id 0-1: her own tile at every deployment).
// - T2 天有四时: while she is deployed, ≥ PROF_NEEDED different professions among the allied operators on the field ⇒ every
//   allied operator's max HP +max_hp; ≥ PROF_NEEDED operators of one profession ⇒ ASPD +attack_speed (charpack auras:
//   operators only, 孤立 included); if her squad (her player's operators, deployed or not) holds ≥ SUI_NEEDED 【岁】 operators
//   (character_table groupId 'sui': 年 夕 令 重岳 黍 余 望) ⇒ every operator of the squad ATK +atk for the battle and +sp SP
//   every `interval` s of each deployment (modify_sp[trigger]; an SP gift — a 决战者's 阻回 refuses it), whether she is
//   deployed or not (Terra). The counts 3 / 4 exist in the text and the charpack only (minCount / minCntToTrig).
// - S1 化被草木 (AUTO, time SP, 可充能 1 / 2 次; data DEFAULT): the client prefab is 塞雷娅 S1 急救's (a SkillTrigger on an
//   ally of HP ≤ half — _maxHpRatio 0.5 — _cancelIfSearchTargetFailed), whose PRTS 备注 reads "此技能仅在周围有符合血量条件的友方
//   单位时可触发，触发时会替换当次攻击": the engine's DEFAULT with `allies` / `hpAtMost` on the skill range x-4 — at her attack,
//   with an ally of x-4 at ≤ half HP, that attack heals the lowest such ally for heal_scale × ATK instead (as 塞雷娅's kit).
// - S2 嘉禾盈仓 (MANUAL; data DEFAULT — the owner's 重装 exception of 2026-10-05, rawRule TAKE_DAMAGE): `duration` s, her
//   attacks become heals of up to attack@max_target injured allied units on the skill range x-1 (her range meanwhile:
//   _rangeIdModeIndex 1) for ATK, ATK +atk, block +block_cnt, attack interval +base_attack_time s (a flat +1.3 on her 1.2
//   s; ASPD and 缴械 still count), T1 ×extra_extend_scale.
// - S3 离离枯荣 (MANUAL): her range becomes the skill range x-2 (_rangeIdModeIndex 2; "视野扩大至治疗范围"), ATK +atk; every
//   attack on an enemy also heals the most injured allied unit of that range other than herself for ATK
//   (shu_s_3[heal_in_attack]: the Heal selector excluding her); with no enemy to attack her attack heals the most injured
//   allied unit of the range, herself included (the mode's Attack-else-Heal ability). While a ground enemy stands on a
//   sown tile every allied operator of her range — 孤立 ones too — ATK +e_atk and ASPD +e_attack_speed (× min(enemies,
//   e_max_stack_cnt)); a ground enemy that enters a sown tile is marked with that tile (once) and each time it then enters
//   a tile at a Manhattan distance ≥ max_distance from it, it is put back on that tile's centre (unblocked, its route
//   re-planned from there; waypoints already passed stay passed), stealth or 无敌 notwithstanding; a 消失 (hidden) enemy loses
//   its mark and every mark ends with the skill (the client attaches it to shu_s_3). No enemy of the mode holds
//   免疫传送 (data otherImmunities). Trigger: the data's — her own row TRY_SEARCH_ALLY_SKILL (PRTS "技能范围内存在可治疗的我方
//   单位时释放技能"), which tools/build-data.mjs (TRIGGER_ALLY_RULES) writes as the engine's SKILL_RANGE + `allies` on the
//   skill range x-2 (an injured, healable allied unit there, herself included; 古米 S1's option).

import { num, traitBb, skillRec, batMod, up, giveSp, holdProtect } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { effectiveProfile, acquireTargets, performAttack } from '../../../ai.js';

const S1 = 'skchr_shu_1';
const S2 = 'skchr_shu_2';
const S3 = 'skchr_shu_3';
/** The skill ranges when the data carries none: x-4 (S1, 周围), x-1 (S2), x-2 (S3) — range_table. */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
const X1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
const X2 = Object.freeze([[2, -1], [2, 0], [2, 1], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2],
  [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [-2, -1], [-2, 0], [-2, 1]]);
/** shu_t_1 sows the healed unit's tile and the four next to it (range x-5, symmetric). */
const SOW = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
/** Range ids a talent's bbStr may name (GUA-X stage 3 born_range_id '0-1': her own tile). */
const RANGE_IDS = Object.freeze({ '0-1': Object.freeze([[0, 0]]) });
/** S1 "血量不足一半" — PRTS 修正 小于等于, the prefab's _maxHpRatio 0.5. */
const HALF_HP = 0.5;
/** T1's tile effect refresh and hold. */
const FARM_EVERY = 0.25;
const FARM_HOLD = 0.35;
/** T2 "三名不同 / 相同职业干员", "四名【岁】干员" (the charpack's minCount / minCntToTrig; no blackboard key). */
const PROF_NEEDED = 3;
const SUI_NEEDED = 4;
/** 【岁】: character_table groupId 'sui' (data/backups.json diy.operators powers carry it for the 自选 picks). */
const SUI = new Set(['char_2014_nian', 'char_2015_dusk', 'char_2023_ling', 'char_2024_chyue', 'char_2025_shu', 'char_2026_yu', 'char_2027_wang']);
const FARM = 'talent:shu:farm';
const HARVEST = 'skill:shu:harvest';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const gridOf = (chess, id, fallback) => { const g = skillRec(chess, id)?.rangeGrid; return g?.length ? g : fallback; };
/** The talent record with data index `i` (null when absent). */
const talentRec = (chess, i) => (chess?.talents ?? []).find((t) => t && t.index === i) ?? null;
/** The tile key of a unit's position (an enemy: its 判定中心). */
const tileKey = (u) => Math.round(u.y) * COLS + Math.round(u.x);
/** An allied unit her heals and tiles may take: on the field, not a device. */
const onField = (a) => !!a && a.alive && a.deployed && !a.hidden && a.kind !== 'device';

export default {
  char_2025_shu: (bb, chess) => {
    const tb = traitBb(chess);
    const r0 = talentRec(chess, 0), t0 = r0?.bb ?? {}, t1 = talentRec(chess, 1)?.bb ?? {};
    const born = RANGE_IDS[r0?.bbStr?.born_range_id] ?? null;
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1);
    // GUA-Y stages 2/3: the extra ATK sits on the module's hidden talent (index -1), not 天有四时.
    const seasonAtk = num(talentRec(chess, -1)?.bb?.atk);
    const squadOf = (battle, unit) => battle.allyUnits.filter((a) => a.kind === 'op' && a.ownerId === unit.ownerId);
    const suiReady = (battle, unit) => squadOf(battle, unit).filter((a) => SUI.has(a.def?.charId)).length >= SUI_NEEDED;
    const g1 = gridOf(chess, S1, X4), g2 = gridOf(chess, S2, X1), g3 = gridOf(chess, S3, X2);

    /** The sown tiles of her current deployment (a Set of tile keys). */
    const sown = (unit) => {
      if (unit.mem.shuSownSeq !== unit.deploySeq || !unit.mem.shuSown) { unit.mem.shuSown = new Set(); unit.mem.shuSownSeq = unit.deploySeq; }
      return unit.mem.shuSown;
    };
    /** T1's tile effect on every allied unit standing on a sown tile (× S2's extra_extend_scale while it runs). */
    const farm = (battle, unit) => {
      if (!up(unit)) return;
      const tiles = sown(unit);
      if (!tiles.size) return;
      const scale = unit.skill?.active && unit.skill.id === S2 ? num(b2.extra_extend_scale, 1) : 1;
      const hp = num(t0.hp_recovery_per_sec) * scale, dr = num(t0.damage_resistance) * scale;
      for (const a of battle.allyUnits) {
        if (!onField(a) || !tiles.has(a.tileR * COLS + a.tileC) || !battle.allySelectable(a, unit)) continue;
        const cur = a.findBuff(FARM);
        if (hp > 0 && !(cur && cur.source !== unit && (cur.data?.v ?? 0) > hp && cur.timeLeft > 0.05)) {
          battle.addBuff(a, { key: FARM, duration: FARM_HOLD, mods: { hpRegen: hp }, source: unit, data: { v: hp }, tags: ['talent'] });
        }
        holdProtect(battle, a, dr, FARM_HOLD, unit);   // 庇护: the shared effect (同名效果取最高)
      }
    };
    /** Sow the tiles of `grid` around (r, c) — only tiles that can be deployed on or walked. Returns the new ones. */
    const sow = (battle, unit, r, c, grid) => {
      const tiles = sown(unit);
      let n = 0;
      for (const [dr, dc] of grid) {
        const rr = r + dr, cc = c + dc;
        if (!battle.grid.inRect(rr, cc)) continue;
        const t = battle.grid.tile(rr, cc);
        if (!t || (t.build === 'NONE' && t.pass !== 'ALL')) continue;
        const k = rr * COLS + cc;
        if (!tiles.has(k)) { tiles.add(k); n++; }
      }
      if (n > 0) { battle.fx('healField', { x: c, y: r, id: unit.id }); farm(battle, unit); }
      return n;
    };
    /** S3: the most injured healable allied unit of her current range (`others`: not herself). */
    const healTarget = (battle, unit, others) => {
      const list = battle.injuredAlliesInKeys(unit.rangeKeySet || new Set(unit.rangeKeys || []), unit);
      return others ? list.find((a) => a !== unit) ?? null : list[0] ?? null;
    };

    return {
      skills: {
        [S1]: {
          kind: num(s1?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          trigger: { rule: 'DEFAULT', grid: g1, allies: true, hpAtMost: HALF_HP },
          targeting: { rangeGrid: g1 },
          attack: { dmgType: 'heal', heal: { mode: 'single', hpAtMost: HALF_HP }, healScale: num(b1.heal_scale, 1), projectile: 'none' },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk), blockCnt: num(b2.block_cnt), batPct: batMod(b2.base_attack_time, chess) },
          targeting: { rangeGrid: g2, maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 2))) },
          attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: 1, projectile: 'none' },
          onStart({ battle, unit }) { farm(battle, unit); },
          onEnd({ battle, unit }) { farm(battle, unit); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk) },
          targeting: { rangeGrid: g3 },
          onStart({ unit }) { unit.mem.shuMarks = new Map(); },
          onAttack({ battle, unit, targets }) {
            // shu_s_3[heal_in_attack]: an attack on an enemy also heals the most injured allied unit of her range but her
            if (!targets?.length || targets[0].side !== 'enemy') return;
            const a = healTarget(battle, unit, true);
            if (a) battle.heal(unit, a, unit.s.atk * unit.s.atkScaleMul);
          },
          onTick({ battle, unit }) {
            if (!up(unit)) return;
            const tiles = sown(unit);
            // 有地面敌人处于播种地块时: the allied operators of her range ATK / ASPD + (孤立 ones too)
            let onSown = 0;
            for (const e of battle.enemies) if (e.alive && !e.hidden && !e.isFlying && tiles.has(tileKey(e))) onSown++;
            const stacks = Math.min(onSown, Math.max(1, Math.floor(num(b3.e_max_stack_cnt, 1))));
            if (stacks > 0) {
              const keys = unit.rangeKeySet || new Set(unit.rangeKeys || []);
              for (const a of battle.allyUnits) {
                if (a.kind !== 'op' || !onField(a) || !keys.has(a.tileR * COLS + a.tileC)) continue;
                battle.addBuff(a, { key: HARVEST, duration: 0.1, mods: { atkPct: num(b3.e_atk) * stacks, aspd: num(b3.e_attack_speed) * stacks }, source: unit, tags: ['skill'] });
              }
            }
            // 【播种标记】: a ground enemy entering a sown tile records it; ≥ max_distance (Manhattan) away it is put back there
            const marks = unit.mem.shuMarks ?? (unit.mem.shuMarks = new Map());
            const far = Math.max(1, num(b3.max_distance, 4));
            for (const e of battle.enemies) {
              const m = marks.get(e.id);
              if (!e.alive || e.hidden) { if (m) marks.delete(e.id); continue; }
              const k = tileKey(e);
              if (!m) {
                if (!e.isFlying && tiles.has(k)) marks.set(e.id, { r: Math.round(e.y), c: Math.round(e.x), last: k });
                continue;
              }
              if (k === m.last) continue;
              m.last = k;
              const dist = Math.abs(Math.floor(k / COLS) - m.r) + Math.abs((k % COLS) - m.c);
              if (dist < far - 1e-9) continue;
              e.x = m.c;
              e.y = m.r;
              battle._unblock(e);
              if (e.route) e.route.pts = null;
              m.last = m.r * COLS + m.c;
              battle.fx('teleport', { x: m.c, y: m.r, id: e.id, src: unit.id });
            }
            // no enemy to attack: her attack heals the most injured allied unit of her range (herself included)
            if (unit.atkCd > 0 || !unit.canAct || unit.s.flags.disarm || !unit.profile) return;
            const prof = effectiveProfile(unit);
            if (acquireTargets(battle, unit, prof).length) return;
            const a = healTarget(battle, unit, false);
            if (!a) return;
            performAttack(battle, unit, { ...prof, dmgType: 'heal', heal: { mode: 'single' }, atkScale: 1, healScale: 1, projectile: 'none', splashRadius: 0, chain: null, hits: 1 }, [a]);
            unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
          },
          onEnd({ unit }) { unit.mem.shuMarks = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 百谷长青: every heal she outputs sows the healed unit's x-5; the sown tiles regenerate / 庇护
          battle.on('heal', (c) => {
            if (c.source !== unit || !up(unit) || c.opts?.regen || !(c.amount > 0) || !onField(c.target)) return;
            sow(battle, unit, c.target.tileR, c.target.tileC, SOW);
          }, { owner: unit, priority: -20 });
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            sown(unit).clear();
            if (born) sow(battle, unit, unit.tileR, unit.tileC, born);   // GUA-X stage 3: 部署时立即给所处地块播种该效果
          }, { owner: unit });
          battle.on('death', (ctx) => { // 自身退场时清空所有地块的播种效果
            if (ctx.unit !== unit) return;
            sown(unit).clear();
            for (const a of battle.allyUnits) if (a.findBuff(FARM)?.source === unit) battle.removeBuff(a, FARM);
          }, { owner: unit });
          battle.every(FARM_EVERY, () => farm(battle, unit), { owner: unit, immediate: true });
        } },
        { install(battle, unit) { // 天有四时
          const hpUp = num(t1.max_hp), asUp = num(t1.attack_speed);
          battle.every(FARM_EVERY, () => {
            if (!up(unit)) return;
            const ops = battle.allyUnits.filter((a) => a.kind === 'op' && onField(a));
            const per = new Map();
            for (const a of ops) { const p = a.def?.profession ?? '?'; per.set(p, (per.get(p) ?? 0) + 1); }
            const many = per.size >= PROF_NEEDED, same = Math.max(0, ...per.values()) >= PROF_NEEDED;
            const bonus = seasonAtk > 0 && Number(many) + Number(same) + Number(suiReady(battle, unit)) >= 2;
            for (const a of ops) {
              if (many && hpUp) battle.addBuff(a, { key: 'talent:shu:seasons:hp', duration: FARM_HOLD, mods: { hpPct: hpUp }, source: unit, tags: ['talent'] });
              if (same && asUp) battle.addBuff(a, { key: 'talent:shu:seasons:aspd', duration: FARM_HOLD, mods: { aspd: asUp }, source: unit, tags: ['talent'] });
              if (bonus) battle.addBuff(a, { key: 'talent:shu:seasons:atk', duration: FARM_HOLD, mods: { atkPct: seasonAtk }, source: unit, tags: ['talent'] });
            }
          }, { owner: unit, immediate: true });
          // 编入队伍且编队中有四名【岁】干员: her squad's operators ATK + for the battle, +sp SP every `interval` s deployed
          const ownSquad = () => squadOf(battle, unit);
          const atk = num(t1.atk), sp = num(t1.sp), iv = num(t1.interval);
          const spBuff = (a) => {
            if (sp > 0 && iv > 0) battle.addBuff(a, { key: 'talent:shu:suiSp', interval: iv, onTick: ({ unit: x }) => giveSp(x, sp), source: unit, tags: ['talent'] });
          };
          const apply = () => {
            if (unit.mem.shuSuiDone) return;
            unit.mem.shuSuiDone = true;
            const squad = ownSquad();
            if (squad.filter((a) => SUI.has(a.def?.charId)).length < SUI_NEEDED) return;
            const members = new Set(squad);
            for (const a of squad) {
              if (atk) battle.addBuff(a, { key: 'talent:shu:sui', mods: { atkPct: atk }, persist: true, allowDead: true, source: unit, tags: ['talent'] });
              if (onField(a)) spBuff(a);
            }
            battle.on('deploy', (ctx) => { if (members.has(ctx.unit)) spBuff(ctx.unit); }, { owner: unit });
          };
          if (battle.started) apply();
          else battle.on('battleStart', apply, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // GUA-Y: damage reduction, independent of the sown tile's 庇护 (official trait damage_resistance).
        const dr = num(tb.damage_resistance);
        if (dr > 0) battle.on('deploy', ({ unit: u }) => {
          if (u === unit) battle.addBuff(unit, { key: 'shu:gua-y', mods: { dmgTakenMul: 1 - dr }, source: unit, tags: ['module'] });
        }, { owner: unit });
        // GUA-X: 治疗生命值低于50%的友方单位时治疗量提升15% (heal_scale_up[hpratio][LE]: at or below hp_ratio)
        const hs = num(tb.heal_scale, 1), hr = num(tb.hp_ratio);
        if (hs !== 1 && hr > 0) {
          battle.on('heal', (c) => {
            if (c.source === unit && !c.opts?.regen && c.target && c.target.hpRatio <= hr + 1e-9) c.amount *= hs;
          }, { owner: unit });
        }
      },
    };
  },
};
