// server/sim/content/kits/ops/op-nasti.js — 娜斯提 (char_4212_nasti) 自选 operator kit: 6★ 工匠 (辅助), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, the module CRA-X 工程师们 at every form, and the kits of her
// three <支援装置>: “质检专员” (token_10059_nasti_nstdef, S1), “监工专员” (token_10060_nasti_nstchr, S2) and “应急承重小组”
// (token_10061_nasti_nstbld, S3: the 小工程师 and the 高台 it builds). Kit contract and the 自选 rules: ../README.md ("How to
// add an operator (自选)"). The device stock / return / leave-with-the-owner rules are 白铁's (op-ironmn.js), shared.
//
// Forms (data/backups.json units.char_4212_nasti): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / the token rows (zh_CN, as built into backups.json), PRTS
// 娜斯提 (前方施工 备注 "所有装置的效果均为对自身攻击范围内所有单位生效的光环效果", "自身<支援装置>提供的效果均可叠加", "<X模组>首个
// 装置部署费用-3；…若装置攻击范围内存在另一同来源同名的装置，将使用自身攻击范围+对方攻击范围形成复合范围"; 注意安全 备注 "远程敌人出现后，
// 此天赋额外效果在娜斯提退场前永久生效", "对敌人/干员的判定无视不可选中类效果/孤立", "“高台干员”指实际可部署于远程位的干员"; S2 备注 "此
// 技能提供的屏障持续时间无限；自身退场时，清除此技能提供的所有屏障"; CRA-X: 质检 / 监工 −2, 应急承重小组 −3 部署费用), PRTS “质检专员”
// / “监工专员” / “应急承重小组” (备注: 常态持有禁疗、无敌 / 禁疗、静默; 监工 "生命值满/持有者技能开启期间，获得阻回、静默", 取缔无效流程
// "生命回复速度属性不受此影响", skill "流失生命效果于获得技力/屏障效果后紧接着处理…会先提供技力和屏障再导致装置死亡"; 应急承重小组: the two
// forms, "前方地块为可部署近战位的低地地块…则在前方地块上召唤一个高台形态的此装置。高台形态的此装置不计入部署数量上限", "仅高台形态装置
// 已激活，且生命值未满时…可对其进行治疗，仅成功治疗后流失生命值", 未激活 = 装置类 + 无敌 + 不可阻挡, 激活 = 默认类, 阻挡数+1, 高地 /
// 仅远程, 重叠部署; 第二次升级起 +1000 / +100 / +5; 最高级 阻回), PRTS 分支特性信息 工匠, PRTS 卫戍协议/帮助 (§战斗部署, §作战阶段 —
// as op-ironmn.js), and the client's battle data read from the local install — charpack char_4212_nasti (nasti_t_1
// charge_token[born]; T2: PassiveTrigger nasti_t2[res] = damage_resistance[inf], AuraTrigger on enemies of applyWay RANGED
// (`_applyWay` 2, every level and motion) ⇒ AuraBuff: OwnerBuff nasti_t2[res_plus] (overrides [res]) + nasti_t2[add_sp], and
// AuraBuffCore on our operators (professionMask 639, `_buildableType` 2, ignoring 孤立) the same two; nasti_a[die_kill_token]
// KillTokens of modes 0–4 — a 3-times-upgraded 高台 (mode 5) stays; S1 / S2 / S3 modes), the token prefabs nstdef / nstchr /
// nstbld (range abilities with the CRA-X stage-3 SharedValidator: same token id, same host, host holding nasti_e[class_3_mark];
// nstchr: EnsureBlood nasti_nstchr[blood_one], full_blood ⇒ 阻回, Special mode RecoverSp add_char_sp / update_shield /
// dec_blood; nstbld: BuildFactory create_m3 (Nstlv1Tile: buildableType melee, low ground, not tile type 16), m345_update on a
// full SP, M4–M6 modes `_keepCurrentPassableMask`), the skill prefabs skchr_nasti_1 / 2 / 3 and sktok_nasti_nstchr (add_hp
// +value, `_hpRatio` 1), the equip prefabs (trigger_charge_token +cnt at each deployment; stage 2+ nasti_e[first_token_cost_dec]
// UNTIL_NEXT_SPAWN; stage 3 nasti_e[class_3_mark]) and buff_template_data (the templates named here).
//
// - Trait (工匠) "能够阻挡两个敌人，使用<支援装置>协助作战": melee physical, 1-1, blocks 2, ground only — and the device rules of
//   op-ironmn.js: the picked skill's hand pieces deploy with the board for free; her stock is cnt (3) + CRA-X's trait cnt (1)
//   after each of her deployments, capped there; a device that left comes back on its tile after its redeploy time, paying
//   its cost, spending one stock, while she stands; her leaving withdraws her devices (a level-3 高台 stays).
// - T1 前方施工 "可以携带3个<支援装置>(最多可部署2个)": that stock; 2 hand pieces (data deployLimit 2). Every device's effect is
//   an aura on the operators of its range (1-1: its tile and the one it faces); her devices' effects stack (one buff per
//   device). CRA-X stage 2+ "首个装置部署费用减少": after each of her deployments her next device deployment costs value (−3)
//   less (UNTIL_NEXT_SPAWN — the battle-start deployment, free here, uses it up); stage 3 "装置可与攻击范围内其他装置共同提供效
//   果": a device with another same-name device of hers on its range also reaches that device's range (one step).
// - T2 注意安全 "获得10%庇护；远程敌人出现后，改为使自身和场上的高台干员获得15%庇护，且每6秒获得1点技力" (full potential: 12 % /
//   18 %): 庇护 (ba.protect, the shared applyStrongest key 'protect': physical and arts damage taken ×(1 − v), the strongest
//   wins) nasti_t2[res] on her; once a 远程 enemy (applyWay RANGED — ALL too [ASSUMED: the 2 bit]) is on the field,
//   untargetable or stealthed too, until she leaves: [res_plus] on her and on every operator of our side whose position is
//   远程 (RANGED / ALL — "实际可部署于远程位"), 孤立 ones too, and each of them +1 SP every interval s it holds it (the first
//   one interval after; none at full SP or during a skill).
// - Module CRA-X “工程师们” "<支援装置>的持有上限+1且部署费用减少": stock +1, the data costs (2 / 2 / 3).
// - “质检专员” (S1): "使前方干员的防御力+25%" (Σpct); while her S1 runs: DEF +talent@def instead, block +talent@block_cnt, and
//   it loses talent@hp_ratio of its max HP each second (流失; the first one 1 s into the skill).
// - “监工专员” (S2): max HP 8 (data), init_hp 3 at each deployment ("仅可通过自身技能补充生命"); its skill (AUTO, 6 SP over
//   time) "开启技能时回复1点生命值" fires whenever its SP is full and its HP is not (阻回 while its HP is full or 娜斯提's skill
//   runs — the client's full_blood / Special mode). Activated by her S2 (the devices on the field at the cast): every
//   talent@interval s, the first 0.05 s in: each operator of its range +talent@sp SP (none during its skill) and a 屏障 of
//   talent@shield_each_hp_rate × 娜斯提's max HP (one barrier per operator from her, filled up to talent@shield_max_hp_rate ×
//   her max HP; it lasts until used or until she leaves), then the device loses talent@hp HP; activated devices leave when
//   her skill ends.
// - “应急承重小组” (S3): the 小工程师 (invulnerable, untargetable, 禁疗, 阻回) builds the 高台 on the tile it faces when it is
//   deployed, if she has none and that tile is a free low melee tile (canStand melee, low); the 高台 (one per 娜斯提, outside the
//   deploy limit) gains 1 SP / s of its own (the token's INCREASE_WITH_TIME) and each 小工程师 whose range holds it gives it
//   m1_sp SP each second (m2_sp while her S3 runs) while it is not at its top level; a full SP (50) upgrades it (SP cleared):
//   level 1 = activated (attackable, block 1), level 2 = +1000 max HP / +100 DEF / +5 RES (m5 attribute_up), level 3 = the
//   m6 values instead + 阻回. A 小工程师 heals an activated 高台 of its range that is not at full HP hp_ratio of its max HP
//   each second (×2 in her S3) and then loses 2 % of its own (hp_ratio × cnt — "仅成功治疗后流失生命值", 流失). Before level 1 the
//   高台 is invulnerable, untargetable and blocks nobody. The 高台's tile stays walkable (`_keepCurrentPassableMask`) and keeps
//   its look of ground; the operator bonuses of a 高台 (m4 / m5 / m6_bonus: +ATK / +max HP for the operator deployed on it)
//   never apply here — nobody deploys during a battle of this mode and the 高台 is only built on a free tile [ASSUMED: N/A].
// - S1 “拱卫” (MANUAL, data DEFAULT): 38 / 40 s, ATK +atk, DEF +def, every enemy she blocks at once; +1 stock at the start.
// - S2 “执行” (MANUAL, DEFAULT): 4 s, 停止攻击; every attack@nasti_s2[update_shield].interval s a 屏障 of shield_each_hp_rate ×
//   her max HP on herself, up to shield_max_hp_rate × it (infinite, gone when she leaves); activates her 监工专员; +1 stock at
//   its end.
// - S3 栖脚地 (MANUAL, DEFAULT): 15 s, ATK +atk, DEF +def; her 小工程师 work twice as hard; +1 stock at the start.
// [ASSUMED] (beyond op-ironmn.js's): the 监工专员 loses its 1 HP per pulse with or without an operator in range (dec_blood is a
// passive buff of the ability); the combined range one step deep; the 小工程师's 1 s heal / SP timer runs from its deployment.

import { num, talentBb, traitBb, skillRec, up, giveSp, holdProtect } from '../shared/tier1.js';
import { burstLimit, stepOf } from '../../../../../shared/plugins/steps.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { COLS } from '../../../constants.js';
import { frontOf } from '../../../dir.js';
import { deviceState, devicesUp, rechargeDevices, deviceAura, opsOn, deviceReturn, devicesLeaveWithOwner } from './op-ironmn.js';

const S1 = 'skchr_nasti_1';
const S2 = 'skchr_nasti_2';
const S3 = 'skchr_nasti_3';
export const NSTDEF = 'token_10059_nasti_nstdef';
export const NSTCHR = 'token_10060_nasti_nstchr';
export const NSTBLD = 'token_10061_nasti_nstbld';
const DEVICES = new Set([NSTDEF, NSTCHR, NSTBLD]);
/** A device's 1-1 when its def carries none. */
const FRONT1 = Object.freeze([[0, 0], [0, 1]]);
/** 注意安全's 庇护 refresh: a little longer than the check period, so it never lapses while it holds. */
const T2_PERIOD = 0.25;
const PROTECT_HOLD = T2_PERIOD + 0.05;
/** 监工专员 Special mode: dec_blood `firstTriggerInterval` 0.05 s. */
const CHR_FIRST = 0.05;
/** 小工程师 talent buffs: triggerInterval 1 s. */
const BLD_EVERY = 1;
/** Enemies that count as 远程 (AuraTriggerCore `_applyWay` 2). */
const RANGED_WAYS = new Set(['RANGED', 'ALL']);
/** Operators "实际可部署于远程位" (`_buildableType` 2). */
const RANGED_POS = new Set(['RANGED', 'ALL']);

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tokBb = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null)?.bb ?? {};
const tileOf = (u) => u.tileR * COLS + u.tileC;
const ownKeys = (u) => absoluteRangeKeys(u.rangeGrid ?? u.def?.rangeGrid ?? FRONT1, u.tileR, u.tileC, u.dir, 0);
/** The barrier key of the shields her S2 devices give (one per operator from her: nasti_nstchr_m2[shield_core]). */
const shieldKey = (owner) => `nasti:shield:${owner.id}`;
const SELF_SHIELD = 'nasti:s2shield';

export default {
  char_4212_nasti: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const cnt = num(t0.cnt, 3) + num(traitBb(chess).cnt);
    const firstCut = -num(t0.value);                                  // CRA-X stage 2+: 首个装置部署费用 −3
    const combined = !!(chess?.module?.active && num(chess.module.level) >= 3);   // stage 3: nasti_e[class_3_mark]
    const resBase = num(t1['nasti_t2[res].damage_resistance']);
    const resPlus = num(t1['nasti_t2[res_plus].damage_resistance'], resBase);
    const spEvery = num(t1['nasti_t2[add_sp].interval']);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2Every = num(b2['attack@nasti_s2[update_shield].interval'], 0.5);
    const s2Each = num(b2['attack@nasti_s2[update_shield].shield_each_hp_rate']);
    const s2Max = num(b2['attack@nasti_s2[update_shield].shield_max_hp_rate']);

    const skillOn = (owner, id) => up(owner) && !!owner.skill?.active && owner.skill.id === id;
    /**
     * The tiles a device's effect reaches: its own range, and with CRA-X stage 3 the range of every same-name device of hers
     * standing on it ("复合范围", one step).
     */
    const reachOf = (battle, dev, owner) => {
      const keys = new Set(ownKeys(dev));
      if (combined) {
        for (const d of devicesUp(owner)) {
          if (d === dev || d.defId !== dev.defId || !keys.has(tileOf(d))) continue;
          for (const k of ownKeys(d)) keys.add(k);
        }
      }
      return keys;
    };

    /** “质检专员”. */
    const defKit = (dev, owner) => {
      const def = dev.def, tb = def.skill?.bb ?? {};
      const base = num(tokBb(def, 'def').def);
      const s1Def = num(tb['talent@def'], num(b1['talent@def'], base));
      const s1Block = num(tb['talent@block_cnt']);
      const s1Loss = num(tb['talent@hp_ratio']);
      return {
        skill: null,
        trait: { noAttack: true },
        talents: [],
        install(battle) {
          battle.addBuff(dev, { key: 'nasti:device', flags: { untargetable: true, invulnerable: true, noHeal: true }, persist: true, allowDead: true });
          // 严禁偷工减料 / S1 mode: the operators of its range
          deviceAura(battle, dev, { key: `nasti:nstdef:${dev.id}`, select: () => opsOn(battle, dev, reachOf(battle, dev, owner)),
            sig: () => (skillOn(owner, S1) ? 1 : 0),
            mods: () => (skillOn(owner, S1) ? { defPct: s1Def, ...(s1Block ? { blockCnt: s1Block } : {}) } : { defPct: base }) });
          // S1 mode: −talent@hp_ratio of its max HP each second (nasti_nstdef_t[self_damage], first after 1 s)
          let next = Infinity, was = false;
          battle.on('tick', () => {
            const on = up(dev) && skillOn(owner, S1);
            if (on && !was) next = battle.time + 1;
            was = on;
            if (!on || battle.time + 1e-9 < next) return;
            next += 1;
            if (s1Loss > 0) battle.loseHp(dev, dev.s.maxHp * s1Loss, { source: dev, tags: ['device'] });
          }, { owner: dev });
        },
      };
    };

    /** “监工专员”. */
    const chrKit = (dev, owner) => {
      const def = dev.def, tb = def.skill?.bb ?? {};
      const initHp = num(tokBb(def, 'init_hp').init_hp, 3);
      const heal = num(tb.value, 1);
      const sp = num(tb['talent@sp'], 1);
      const each = num(tb['talent@shield_each_hp_rate'], num(b2['talent@shield_each_hp_rate']));
      const cap = num(tb['talent@shield_max_hp_rate'], num(b2['talent@shield_max_hp_rate']));
      const loss = num(tb['talent@hp'], 1);
      return {
        skill: {
          kind: 'instant', trigger: 'SP_FULL',
          onStart({ battle, unit }) { battle.heal(unit, unit, heal, { self: true, ignoreHealFree: true }); },
        },
        trait: { noAttack: true },
        talents: [],
        install(battle) {
          battle.addBuff(dev, { key: 'nasti:device', flags: { untargetable: true, invulnerable: true, noHeal: true }, persist: true, allowDead: true });
          // 取缔无效流程: deployed with init_hp of its (data) max HP
          battle.on('deploy', (ctx) => { if (ctx.unit === dev) { dev.hp = Math.max(1, Math.min(dev.s.maxHp, initHp)); dev.mem.nastiActive = false; } }, { owner: dev });
          // 阻回 while its HP is full or 娜斯提's skill runs (full_blood; the Special mode)
          battle.on('tick', () => {
            if (!up(dev)) return;
            const stop = dev.hp >= dev.s.maxHp - 1e-9 || (up(owner) && !!owner.skill?.active);
            const has = dev.findBuff('nasti:nstchr:stop');
            if (stop && !has) battle.addBuff(dev, { key: 'nasti:nstchr:stop', flags: { noSp: true } });
            else if (!stop && has) battle.removeBuff(dev, 'nasti:nstchr:stop');
          }, { owner: dev, priority: 5 });
          // activated by her S2: pulses (SP + her barrier to the operators of its range), then −1 HP each
          dev.mem.nastiPulse = (b) => {
            if (!up(dev) || !dev.mem.nastiActive) return;
            for (const a of opsOn(b, dev, reachOf(b, dev, owner))) {
              if (giveSp(a, sp, 'device') > 0) b.fx('spGift', { x: a.x, y: a.y, id: a.id, from: dev.id });
              const hp = up(owner) ? owner.s.maxHp : 0;
              const key = shieldKey(owner);
              const cur = a.findBuff(key);
              const have = cur ? cur.shield : 0;
              const next = Math.min(hp * cap, have + hp * each);
              if (next > have + 1e-9) {
                if (cur) { cur.shield = next; a.markDirty(); } else b.addBuff(a, { key, shield: next, visible: true, source: owner, tags: ['skill'] });
                b.fx('shield', { x: a.x, y: a.y, id: a.id, from: dev.id });
              }
            }
            if (loss > 0) b.loseHp(dev, loss, { source: dev, tags: ['device'] });
          };
        },
      };
    };

    /** “应急承重小组” — the 小工程师 (a hand piece). */
    const bldKit = (dev, owner) => {
      const def = dev.def;
      const tb0 = tokBb(def, 'm1_sp');
      const sp1 = num(tb0.m1_sp, 1), sp2 = num(tb0.m2_sp, 2 * sp1);
      const heal1 = num(tb0['nasti_nstbld_m1[heal_m456].hp_ratio']), heal2 = num(tb0['nasti_nstbld_m2[heal_m456].hp_ratio'], 2 * heal1);
      const cost1 = heal1 * num(tb0['nasti_nstbld_m1[heal_m456].cnt'], 1), cost2 = heal2 * num(tb0['nasti_nstbld_m2[heal_m456].cnt'], 1);
      return {
        skill: null,
        // its heal of the 高台 ignores the 高台's 禁疗 ("_ignoreHealFree"): it heals through it (attack/heal.js heal healThrough)
        trait: { noAttack: true, healThrough: (h, t) => !!t && t.mem?.nastiPlatform === true && t.ownerUnit === owner },
        talents: [],
        install(battle) {
          battle.addBuff(dev, { key: 'nasti:device', flags: { untargetable: true, invulnerable: true, noHeal: true, noSp: true }, persist: true, allowDead: true });
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== dev || !up(owner)) return;
            // 承重结构部署: the 高台 on the tile it faces, if she has none and the tile is a free low melee tile
            const cur = owner.mem.nastiPlatform;
            if (cur && (cur.alive || !cur.removed)) return;
            const [r, c] = frontOf(dev.tileR, dev.tileC, dev.dir, 1);
            if (!battle.grid.inRect(r, c) || battle.isReservedTile(r, c) || !battle.grid.canStand(r, c, { ranged: false }) || !battle.grid.isLow(r, c)) return;
            const p = battle.spawnToken(owner, NSTBLD, r, c, { kit: platformKit(owner), dir: dev.dir, anySource: true });
            if (p) battle.fx('summon', { x: p.x, y: p.y, id: p.id, src: dev.id });
          }, { owner: dev });
          // every second: SP to the 高台 of its range below its top level; an activated, injured one healed (then −2 % own)
          battle.every(BLD_EVERY, () => {
            if (!up(dev)) return;
            const p = owner.mem.nastiPlatform;
            if (!p || !up(p) || !reachOf(battle, dev, owner).has(tileOf(p))) return;
            const m2 = skillOn(owner, S3);
            const lvl = p.mem.nastiLevel ?? 0;
            if (lvl < 3 && p.skill && p.skill.sp < p.skill.spCost) p.skill.gainSp(m2 ? sp2 : sp1, 'device');
            if (lvl >= 1 && p.hp < p.s.maxHp - 1e-6) {
              const healed = battle.heal(dev, p, p.s.maxHp * (m2 ? heal2 : heal1), { ignoreHealFree: true });
              if (healed > 0) battle.loseHp(dev, dev.s.maxHp * (m2 ? cost2 : cost1), { source: dev, tags: ['device'] });
            }
          }, { owner: dev });
        },
      };
    };

    /** The 高台 (a spawned unit, no hand piece): levels 0 (未激活) → 3. */
    const platformKit = (owner) => {
      const levelUp = (battle, p) => {
        const lvl = Math.min(3, (p.mem.nastiLevel ?? 0) + 1);
        p.mem.nastiLevel = lvl;
        const tb = p.def.skill?.bb ?? {};
        if (lvl === 1) {
          battle.removeBuff(p, 'nasti:platform:inert');
          battle.addBuff(p, { key: 'nasti:platform:block', mods: { blockCnt: 1 }, persist: true, allowDead: true });
        } else {
          const m = lvl === 2 ? 'm5' : 'm6';
          battle.addBuff(p, { key: 'nasti:platform:attr', persist: true, allowDead: true, mods: {
            hpFlat: num(tb[`attack@nasti_nstbld_${m}[attribute_up].max_hp`]), defFlat: num(tb[`attack@nasti_nstbld_${m}[attribute_up].def`]),
            resFlat: num(tb[`attack@nasti_nstbld_${m}[attribute_up].magic_resistance`]) } });
          if (lvl === 3) battle.addBuff(p, { key: 'nasti:platform:top', flags: { noSp: true }, persist: true, allowDead: true });
        }
        battle.fx('grow', { x: p.x, y: p.y, id: p.id, n: lvl });
      };
      return {
        skill: { kind: 'instant', trigger: 'SP_FULL', onStart({ battle, unit }) { levelUp(battle, unit); } },
        trait: { noAttack: true },
        talents: [],
        install(battle, p) {
          p.mem.nastiPlatform = true;
          p.mem.nastiLevel = 0;
          owner.mem.nastiPlatform = p;
          // the 小工程师's "不会受到攻击" (the token text, Battle._setupUnit) is not the 高台's: untargetable only until activated
          battle.removeBuff(p, 'trait:untargetable');
          battle.addBuff(p, { key: 'nasti:platform', flags: { noHeal: true }, persist: true, allowDead: true });   // 常态持有禁疗
          battle.addBuff(p, { key: 'nasti:platform:inert', flags: { untargetable: true, invulnerable: true }, persist: true, allowDead: true });
          battle.on('death', (ctx) => { if (ctx.unit === p && owner.mem.nastiPlatform === p) owner.mem.nastiPlatform = null; }, { owner: p });
        },
      };
    };

    const kitOf = (dev, owner) => (dev.defId === NSTDEF ? defKit(dev, owner) : dev.defId === NSTCHR ? chrKit(dev, owner) : bldKit(dev, owner));

    return {
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { atkPct: num(b1.atk), defPct: num(b1.def) },
          attack: { hitAllBlocked: true },
          onStart({ unit }) { rechargeDevices(unit, 1); },
        },
        [S2]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            const m = unit.mem;
            m.nastiS2 = { n: 0, at: battle.time };
            // 立即激活场上装置: the 监工专员 on the field now
            const chr = devicesUp(unit).filter((d) => d.defId === NSTCHR);
            for (const d of chr) d.mem.nastiActive = true;
            const seq = unit.skill.activations;
            const shield = () => {
              const s = m.nastiS2;
              if (!s) return;
              s.n++;
              if (!up(unit)) return;
              const cap = unit.s.maxHp * s2Max;
              const cur = unit.findBuff(SELF_SHIELD);
              const have = cur ? cur.shield : 0;
              const next = Math.min(cap, have + unit.s.maxHp * s2Each);
              if (next > have + 1e-9) {
                if (cur) { cur.shield = next; unit.markDirty(); } else battle.addBuff(unit, { key: SELF_SHIELD, shield: next, visible: true, tags: ['skill'] });
                battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
              }
            };
            m.nastiS2.shield = shield;
            battle.every(s2Every, (b, sc) => {
              if (!unit.skill.active || unit.skill.activations !== seq || unit.skill.id !== S2) { sc.cancel(); return; }
              shield();
            }, { owner: unit });
            // the devices' pulses: CHR_FIRST s in, then every talent@interval
            const ev = chr.length ? num(chr[0].def.skill?.bb?.['talent@interval'], 0.5) : 0.5;
            const pulse = () => { for (const d of chr) if (d.mem.nastiPulse) d.mem.nastiPulse(battle); };
            battle.after(CHR_FIRST, () => {
              if (!unit.skill.active || unit.skill.activations !== seq) return;
              pulse();
              battle.every(ev, (b, sc) => {
                if (!unit.skill.active || unit.skill.activations !== seq) { sc.cancel(); return; }
                pulse();
              }, { owner: unit });
            }, { owner: unit });
          },
          onEnd({ battle, unit, skill }) {
            const s = unit.mem.nastiS2;
            // the last shield tick that lands with the end (every interval of the duration)
            if (s && s.shield && up(unit)) {
              const every = stepOf('attack@nasti_s2[update_shield].interval', s2Every, 0.5);
              const bursts = every > 0 ? Math.min(burstLimit(8), Math.floor(Number(skill.duration) / every + 1e-9)) : 0;
              let guard = 0;
              while (s.n < bursts && guard++ < bursts) s.shield(); // loop-cap: burstLimit duration/interval
            }
            unit.mem.nastiS2 = null;
            // 激活的装置在娜斯提技能结束时离场
            for (const d of devicesUp(unit)) if (d.defId === NSTCHR && d.mem.nastiActive) battle.kill(d, null);
            rechargeDevices(unit, 1);
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), defPct: num(b3.def) },
          onStart({ unit }) { rechargeDevices(unit, 1); },
        },
      },
      talents: [
        { install(battle, unit) {
          // 前方施工: her device pieces run their kits; the stock; CRA-X stage 2+ the first device after each deployment −3 DP
          const st = deviceState(unit);
          st.cap = cnt;
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || !DEVICES.has(t.defId) || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, kitOf(t, unit));
            deviceReturn(battle, t, unit, {
              costOf: (d) => Math.max(0, num(d.base.cost) - (unit.mem.nastiFirst ? firstCut : 0)),
            });
            battle.on('deploy', (ctx) => { if (ctx.unit === t) unit.mem.nastiFirst = false; }, { owner: t, priority: -20 });
            st.devices.add(t);
          }
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            rechargeDevices(unit, cnt);
            unit.mem.nastiFirst = firstCut > 0;
          }, { owner: unit });
          devicesLeaveWithOwner(battle, unit);
          // she leaves: her S2 barriers go (nasti_s2[finish_shield]); a 高台 below level 3 goes with her (KillTokens modes 0–4)
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            for (const a of battle.allyUnits) if (a.findBuff(shieldKey(unit))) battle.removeBuff(a, shieldKey(unit));
            battle.removeBuff(unit, SELF_SHIELD);
            const p = unit.mem.nastiPlatform;
            if (p && up(p) && (p.mem.nastiLevel ?? 0) < 3) battle.kill(p, null);
          }, { owner: unit });
        } },
        { install(battle, unit) {
          // 注意安全: 庇护 res; once a 远程 enemy is on the field (until she leaves): res_plus on her and our 远程 operators, +1 SP
          // every interval s
          let triggered = false;
          const timers = new Map();
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) { triggered = false; timers.clear(); } }, { owner: unit });
          battle.every(T2_PERIOD, () => {
            if (!up(unit)) { triggered = false; timers.clear(); return; }
            if (!triggered) triggered = battle.enemies.some((e) => e.alive && !e.hidden && RANGED_WAYS.has(String(e.def?.applyWay ?? '').toUpperCase()));
            if (!triggered) {
              holdProtect(battle, unit, resBase, PROTECT_HOLD, unit);   // 庇护: the shared effect (同名效果取最高)
              return;
            }
            const who = [unit, ...battle.allyUnits.filter((a) => a !== unit && up(a) && !a.hidden && a.kind === 'op' && RANGED_POS.has(String(a.def?.position ?? '').toUpperCase()))];
            for (const a of [...timers.keys()]) if (!who.includes(a)) timers.delete(a);
            for (const a of who) {
              holdProtect(battle, a, resPlus, PROTECT_HOLD, unit);
              if (!(spEvery > 0)) continue;
              if (!timers.has(a)) { timers.set(a, battle.time + spEvery); continue; }
              if (battle.time + 1e-9 < timers.get(a)) continue;
              timers.set(a, timers.get(a) + spEvery);
              if (a.skill && a.skill.sp < a.skill.spCost && giveSp(a, 1, 'talent') > 0) battle.fx('spGift', { x: a.x, y: a.y, id: a.id, from: unit.id });
            }
          }, { owner: unit, immediate: true });
        } },
      ],
    };
  },
};
