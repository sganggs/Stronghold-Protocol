// server/sim/content/kits/ops/chess_char_3_19-vigil.js — 伺夜 (char_427_vigil) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, selectedId, altSkills, alive, fx, textNum, tacticalPoint } from '../shared/tier3.js';
import { installWolfTacticalPoint, wolfReturnNow, wolfShadowInterval, wolfTacticalPoint } from '../../tokens.js';

/** Tokens `tokenId` summoned by / placed for `owner` (board pieces included). */
const tokensOf = (battle, owner, tokenId) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === tokenId && t.ownerUnit === owner && !t.mem.isClone);

export default {
  // ---- 3_19 伺夜 · 战术家 — the tactical reinforcement is the wolf pack (狼群领袖: 2 wolves, +1 every 25 s up to 3, each
  //      wolf = +1 block and one more bite, a wolf is lost instead of the pack dying; the fatal hit on the last one, or a
  //      撤退, puts the pack in its 战术点形态 — out of the fight for the 狼影 interval, then back on its tile with one
  //      wolf: tokens.js installWolfTacticalPoint, PRTS 狼群领袖 备注); 狼群天性: DEF ignore vs pack-blocked
  //      enemies; S3 领袖的尊严: DP over time, 三连击, bonus arts vs pack-blocked enemies; 精锐 module: pack takes less
  //      damage from the enemies it blocks (token module talent). A 狼群 piece placed in the prep phase is the pack.
  //      S1 领袖的呼唤 (自动触发, only while the pack is on the field — standing or in its 战术点形态): +cost DP, and by the
  //      pack's state (PRTS 备注) ① 战术点形态: back at once with one “狼影” and a fresh growth cycle, ② below the
  //      talent's maximum: one more “狼影” (its own cycle untouched), ③ at the maximum: the pack's HP to max; S2 领袖的馈赠
  //      (only while the pack stands): +cost DP, the pack recovers hp_ratio of its max HP and its next attack hits
  //      ×atk_scale — a kill by that attack gives +cost DP.
  //      精锐 module TAC-Y: trait ×165 % (profession layer) and "援军阻挡的敌人更容易受到我方的攻击": the pack's token module
  //      talent taunt_level (+1) goes to the enemies it blocks — the enemy-side 嘲讽等级 our operators target first
  //      (targeting.js; research 05: "更容易受到我方的攻击" = enemy taunt.taunt_level), never to the pack itself.
  chess_char_3_19_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const sel = selectedId(chess, d);
    const t0 = d.talents?.[0] ?? {}, t1 = talentBb(d, 1);
    const wolfId = t0.tokenKey ?? (d.tokens || []).find((t) => /wolf/.test(String(t))) ?? 'token_10028_vigil_wolf';
    const initial = textNum(t0.description, /初始(\d+|[一二两三四五])只/, 2);
    const maxWolves = textNum(t0.description, /至多(\d+|[一二两三四五])只/, 3);
    const hits = textNum(d.skill?.description, /(\d+|[一二两三四五])连击/, 3);
    const bonus = num(bb['attack@vigil_s_3.atk_scale'], 0);
    const pen = num(t1.def_penetrate_fixed, 0);
    /** The standing pack (狼群天性, S3, the TAC-Y mark, S2). */
    const wolfOf = (u) => (u.trait.reinforcement && u.trait.reinforcement.alive ? u.trait.reinforcement : null);
    /** The pack on the field in either form — standing, or in its 战术点形态 (only while 伺夜 stands: tokens.js). */
    const packOf = (u) => {
      const w = u.trait.reinforcement;
      return w && (w.alive || wolfTacticalPoint(w)) ? w : null;
    };
    const wolfKit = (vigil) => ({
      skill: null,
      trait: { hitsFn: (b, w) => Math.max(1, w.mem.wolves || 1) },
      install(battle, w) {
        w.mem.wolfCapacity = maxWolves;
        const tal = w.def.talents || [];
        const wb = tal[0]?.bb ?? {};
        const per = num(wb.block_cnt, num(wb['vigil_wolf_t_1_enhance[trigger].block_cnt'], 1));
        // the 狼影 interval from the data (tokens.js wolfShadowInterval): the growth cycle — and the 战术点形态's length
        const grow = wolfShadowInterval(w.def);
        // (mem.shadows mirrors the count for content reading tokens.js wolfShadows())
        const apply = () => { w.mem.shadows = w.mem.wolves; battle.addBuff(w, { key: 'token:wolves', mods: { blockCnt: per * w.mem.wolves }, allowDead: true }); };
        w.mem.addWolf = () => {
          if (!w.alive || w.mem.wolves >= maxWolves) return false;
          w.mem.wolves++;
          apply();
          fx(battle, 'summon', w, { src: vigil.id, wolves: w.mem.wolves });
          return true;
        };
        // every deployment: the initial count — or one “狼影” back from the 战术点形态 (tokens.js wolfReturnNow: "持续时间
        // 结束后狼影层数变回1层", S1 ①) — and a fresh growth cycle (the previous one stops at its next tick)
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== w) return;
          const back = w.mem.wolfReturn;
          w.mem.wolves = back ? 1 : Math.max(1, Math.min(maxWolves, initial));
          apply();
          if (back && back.src == null) fx(battle, 'summon', w, { wolves: w.mem.wolves }); // (S1 ① shows its own)
          const seq = w.deploySeq;
          if (grow > 0) {
            battle.every(grow, (b, sched) => {
              if (!w.alive || w.deploySeq !== seq) { sched.cancel(); return; }
              w.mem.addWolf();
            }, { owner: w });
          }
        }, { owner: w, priority: 20 });
        // fatal with more than one wolf: one is lost, full HP; on the last one the knock-out goes through — 战术点形态
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== w || ctx.prevented || w.mem.wolves <= 1) return;
          w.mem.wolves--;
          apply();
          ctx.prevented = true;
          w.hp = w.s.maxHp;
          fx(battle, 'revive', w, { wolves: w.mem.wolves });
        }, { owner: w });
        installWolfTacticalPoint(battle, w, {
          onEnter: () => {
            w.mem.wolves = 0;
            apply();
            fx(battle, 'wolfShadowLost', w, { wolves: 0 });
          },
        });
        const mod = tal.find((t) => t && t.bb && t.bb.damage_scale != null);
        if (mod) {
          battle.on('hit', (ctx) => {
            if (ctx.target === w && ctx.source && ctx.source.blockedBy === w) ctx.dmg.mul *= num(mod.bb.damage_scale, 1);
          }, { owner: w });
        }
      },
    });
    // TAC-Y token module talent (taunt_level) of the pack — whichever kit runs it (this one or a tokens.js board piece):
    // the enemies it blocks carry that taunt level while they stay blocked (short refreshed buff: nothing lingers when
    // the pack or 伺夜 leaves)
    const packTaunt = (w) => {
      if (w.mem.packTaunt == null) {
        const t = (w.def?.talents || []).find((x) => x && x.bb && x.bb.taunt_level != null);
        w.mem.packTaunt = t ? num(t.bb.taunt_level) : 0;
      }
      return w.mem.packTaunt;
    };
    const installPackMark = (battle, unit) => {
      let cur = new Set();
      const levelOf = (w) => (w && alive(w) && alive(unit) ? packTaunt(w) : 0);
      const mark = (e, w, lvl) => battle.addBuff(e, { key: 'token:pack_mark', duration: 0.25, refresh: 'extend', mods: { taunt: lvl }, source: w, visible: true });
      // at once when the pack blocks (the operators attacking this tick already see it), kept / dropped every 0.1 s
      battle.on('blocked', (ctx) => {
        const w = wolfOf(unit), lvl = ctx.blocker === w ? levelOf(w) : 0;
        if (lvl && ctx.enemy.alive) { mark(ctx.enemy, w, lvl); cur.add(ctx.enemy); }
      }, { owner: unit });
      battle.every(0.1, () => {
        const w = wolfOf(unit);
        const lvl = levelOf(w);
        const next = new Set();
        if (lvl) {
          for (const e of w.blocking) {
            if (!e.alive || e.side !== 'enemy' || e.blockedBy !== w) continue;
            mark(e, w, lvl);
            next.add(e);
          }
        }
        for (const e of cur) {
          if (next.has(e)) continue;
          const b = e.findBuff('token:pack_mark');
          if (b) battle.removeBuff(e, b);
        }
        cur = next;
      }, { owner: unit, immediate: true });
    };
    /**
     * One more “狼影” (S1 ②) on a standing pack: this kit's pack, or a 狼群 board piece run by content/tokens.js (same
     * 'wolf:shadows' buff). False at the maximum. Neither pack's own growth cycle is touched ("与狼群本身的刷新周期互相独立").
     */
    const addShadow = (battle, vigil, w) => {
      if (typeof w.mem.addWolf === 'function') return w.mem.addWolf();
      const n = Math.max(1, w.mem.shadows ?? 1);
      if (n >= maxWolves) return false;
      const wb = w.def?.talents?.[0]?.bb ?? {};
      const per = num(wb['vigil_wolf_t_1_enhance[trigger].block_cnt'], num(wb.block_cnt, 1));
      w.mem.shadows = n + 1;
      battle.addBuff(w, { key: 'wolf:shadows', persist: true, allowDead: true, refresh: 'replace', mods: { blockCnt: w.mem.shadows * per } });
      fx(battle, 'summon', w, { src: vigil.id, wolves: w.mem.shadows });
      return true;
    };
    const dpGain = (battle, unit, n) => { if (n > 0) { battle.addDp(unit.ownerId, n); fx(battle, 'dp', unit, { n }); } };
    // S1: the cast — ready and the pack on the field in either form (PRTS 备注 「仅场上存在狼群时可触发技能」 with ① for its
    // 战术点形态)
    const installCall = (battle, unit) => {
      battle.on('tick', () => {
        const sk = unit.skill;
        if (!alive(unit) || !sk || !sk.ready || sk.active || !unit.canAct || unit.s.flags.silence || !packOf(unit)) return;
        sk.activate('SP_FULL');
      }, { owner: unit });
    };
    // S2: the pack's empowered next attack (armed by the cast; ×scale on its hits; a kill pays once)
    const installGift = (battle, unit) => {
      // the cast: ready, the pack on the field in either form, no unused gift on it (PRTS 备注 「仅场上存在狼群，且狼群未获得此技能的
      // 充能时可触发技能」 — the words of S1's, whose 备注 counts the 战术点形态 [ASSUMED the same for S2])
      battle.on('tick', () => {
        const sk = unit.skill, w = packOf(unit);
        if (!alive(unit) || !sk || !sk.ready || sk.active || !unit.canAct || unit.s.flags.silence || !w || w.mem.vigilGift) return;
        sk.activate('SP_FULL');
      }, { owner: unit });
      battle.on('beforeAttack', (ctx) => {
        const w = wolfOf(unit);
        if (!w || ctx.attacker !== w || !w.mem.vigilGift) return;
        w.mem.vigilGiftOn = w.mem.vigilGift;
        w.mem.vigilGift = null;
      }, { owner: unit, priority: -100 });
      battle.on('hit', (ctx) => {
        const g = ctx.source?.mem?.vigilGiftOn;
        if (g && ctx.dmg.isAttack && ctx.source === wolfOf(unit)) ctx.dmg.mul *= g.scale;
      }, { owner: unit });
      battle.on('kill', (ctx) => {
        const g = ctx.killer?.mem?.vigilGiftOn;
        if (!g || g.paid || ctx.victim.side !== 'enemy' || ctx.killer !== unit.trait.reinforcement) return;
        g.paid = true;
        dpGain(battle, unit, g.dp);
      }, { owner: unit });
      battle.on('attack', (ctx) => { if (ctx.attacker?.mem?.vigilGiftOn && ctx.attacker === unit.trait.reinforcement) ctx.attacker.mem.vigilGiftOn = null; }, { owner: unit });
    };
    return {
      trait: { install(battle, unit) {
        // The pack is the tactician's 援军. The match also hands the player the 狼群 token to place in the prep phase
        // (= choosing the tactical point): that board piece (tokens.js kit, owner-coupled effects left to this kit) is
        // the pack when present — deployed early on its own tile if 伺夜 deploys first — never a second pack. Summoned at
        // each deployment of 伺夜; a knocked-out pack is not summoned again: it sits in its 战术点形态 and comes back by
        // itself (tokens.js installWolfTacticalPoint — both packs; until 0.2.0 it came back after the token's 10 s redeploy
        // time with its initial wolves).
        const spawn = () => {
          if (!alive(unit) || packOf(unit)) return;
          const pieces = tokensOf(battle, unit, wolfId);
          const live = pieces.find((t) => alive(t));
          if (live) { unit.trait.reinforcement = live; return; }
          const waiting = pieces.find((t) => !t.alive && !t.removed);
          if (waiting && battle.redeploy(waiting, { free: true })) {
            unit.trait.reinforcement = waiting;
            fx(battle, 'summon', waiting, { src: unit.id, token: wolfId, wolves: waiting.mem.shadows });
            return;
          }
          const board = pieces.find((t) => t.uid != null);
          const tile = tacticalPoint(battle, unit, board ? [board.homeR, board.homeC] : null);
          if (!tile) return;
          const w = battle.spawnToken(unit, wolfId, tile[0], tile[1], { kit: wolfKit(unit) });
          unit.trait.reinforcement = w;
          if (!w) return;
          fx(battle, 'summon', w, { src: unit.id, token: wolfId, wolves: w.mem.wolves });
        };
        battle.on('deploy', (c) => { if (c.unit === unit) spawn(); }, { owner: unit });
        installPackMark(battle, unit);
        // "持有者离场后强制撤退场上的狼群（不触发上述效果）": a standing pack leaves with him ('expired': no 战术点形态); one in
        // its 战术点形态 ends it there (tokens.js) and waits for his redeploy
        battle.on('death', (c) => {
          if (c.unit !== unit) return;
          const w = wolfOf(unit);
          if (w) battle.retreat(w, { reason: 'expired', permanent: true });
        }, { owner: unit });
      } },
      skill: {
        kind: 'duration',
        attack: { hits },
        onStart({ unit }) { unit.mem.vigilAcc = 0; unit.mem.vigilDp = 0; },
        onTick({ battle, unit, dt }) {
          const iv = num(bb.interval, 1.5), step = num(bb.cost, 1), cap = num(bb.value, 0);
          if (!(iv > 0) || !(step > 0)) return; // (junk blackboard: never spin)
          unit.mem.vigilAcc += dt;
          while (unit.mem.vigilAcc >= iv - 1e-9 && unit.mem.vigilDp + step <= cap + 1e-9) {
            unit.mem.vigilAcc -= iv;
            unit.mem.vigilDp += step;
            battle.addDp(unit.ownerId, step);
          }
        },
        onEnd({ battle, unit, reason }) {
          // the whole `value` is granted over a full duration (精锐: 11 × 1.364 s ends a hair after 15 s)
          const rest = num(bb.value, 0) - (unit.mem.vigilDp ?? 0);
          if (reason === 'duration' && rest > 1e-9) { battle.addDp(unit.ownerId, rest); unit.mem.vigilDp += rest; }
          fx(battle, 'dp', unit, { n: unit.mem.vigilDp ?? 0 });
        },
      },
      skills: altSkills(chess, d, bb, {
        // (自动触发: an AUTO skill takes no 技能策略 — the 战术家 row is for MANUAL skills. PRTS 备注 「仅场上存在狼群时可触发技能」
        // (the owner's decision of 2026-10-05): the kit casts it as soon as it is ready while the pack is on the field —
        // standing, or in its 战术点形态 while 伺夜 stands (installCall, packOf); without a pack it waits at full SP — until
        // 0.2.0 it fired at SP_FULL and paid its DP with no pack. The cast always pays +cost DP; its effect follows the
        // pack's state (备注 ①②③): ① in its 战术点形态 the pack comes back at once with one 狼影 and a fresh 狼影 cycle (its
        // pending return is cancelled — tokens.js wolfReturnNow), ② standing below the maximum: one more 狼影 (the pack's
        // own cycle untouched), ③ at the maximum: the pack's HP to max — a reset like the talent's, not a heal (the pack
        // holds 禁疗). Until 0.2.0 a knocked-out pack was waited for and the cast at the maximum only paid its DP.)
        skchr_vigil_1: (s) => ({
          kind: 'instant',
          trigger: 'NEVER',
          onStart({ battle, unit }) {
            dpGain(battle, unit, num(s.bb.cost, 0));
            const w = packOf(unit);
            if (!w) return;
            if (!w.alive) { // ①
              if (wolfReturnNow(battle, w, unit.id)) fx(battle, 'summon', w, { src: unit.id, wolves: w.mem.shadows });
              return;
            }
            if (addShadow(battle, unit, w)) return; // ②
            w.hp = w.s.maxHp; // ③
            fx(battle, 'revive', w, { src: unit.id, wolves: w.mem.shadows });
          },
        }),
        // (自动触发, PRTS 备注 「仅场上存在狼群，且狼群未获得此技能的充能时可触发技能」: no enemy needed — the kit casts it as soon
        // as it is ready while the pack stands and holds no unused gift (installGift); until 0.2.0 the data's DEFAULT made it
        // wait for 伺夜's own next attack, so it never fired with no enemy in his range. A pack in its 战术点形态 counts as on the
        // field — S2's 备注 uses S1's words and S1's lists that form [ASSUMED for S2; the 0.2.0 follow-up's recommended
        // reading]: the cast pays its DP at once and the gift waits on the pack, its next attack once it is back (until 0.2.0
        // S2 waited for the pack); a gift the pack holds stays on it through the form [ASSUMED])
        skchr_vigil_2: (s) => ({
          kind: 'instant',
          trigger: 'NEVER',
          onStart({ battle, unit }) {
            dpGain(battle, unit, num(s.bb.cost, 0));
            const w = packOf(unit);
            if (!w) return;
            // (a pack in its 战术点形态 has no HP to restore: it comes back at full HP, the gift kept on it)
            const hr = num(s.bb['vigil_wolf_s_2.hp_ratio'], 0);
            if (hr > 0 && w.alive) battle.heal(w, w, w.s.maxHp * hr, { self: true });
            w.mem.vigilGift = { scale: num(s.bb['vigil_wolf_s_2.atk_scale'], 1), dp: num(s.bb['vigil_wolf_s_2.cost'], 0), paid: false };
            fx(battle, 'buff', w, { src: unit.id, skill: 'vigil_2' });
          },
        }),
      }),
      install(battle, unit) {
        if (sel === 'skchr_vigil_1') installCall(battle, unit);
        if (sel === 'skchr_vigil_2') installGift(battle, unit);
      },
      talents: [
        { install() { /* 狼群领袖: the pack itself (trait.install / wolfKit) */ } },
        { install(battle, unit) {
          battle.on('hit', (ctx) => {
            const w = wolfOf(unit);
            // "伺夜和狼群对其的攻击无视其175防御力" (200 at full potential): their attacks only (not item procs or other non-attack damage)
            if (!w || pen <= 0 || !ctx.dmg.isAttack || (ctx.source !== unit && ctx.source !== w) || ctx.target.blockedBy !== w) return;
            ctx.dmg.defIgnoreFlat += pen;
          }, { owner: unit });
          battle.on('damaged', (ctx) => {
            const w = wolfOf(unit);
            if (!w || !(bonus > 0) || !unit.skill?.active || !ctx.dmg?.isAttack || (ctx.source !== unit && ctx.source !== w)) return;
            const e = ctx.target;
            if (e.side !== 'enemy' || !e.alive || e.blockedBy !== w) return;
            // "狼群与伺夜攻击…时，额外造成…": the extra hit belongs to that attack's dealer (a bite's bonus is the pack's
            // damage — never re-typed by 伺夜's 弱点伤害 特质), its size to 伺夜's ATK (same as tokens.js unmanaged mode)
            battle.dealDamage(ctx.source, e, { amount: unit.s.atk * bonus, type: 'arts', canDodge: false, isSkill: true, tags: ['skill', 'vigilBonus'] });
          }, { owner: unit });
        } },
      ],
    };
  },
};
