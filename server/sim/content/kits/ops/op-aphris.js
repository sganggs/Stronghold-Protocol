// server/sim/content/kits/ops/op-aphris.js — 谬因 (char_4229_aphris) 自选 operator kit: 6★ 轰击术师 (术师), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, her module and her summon “中继器” at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4229_aphris, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Summon: tokens.token_10070_aphris_pc “中继器” (talent 链路协议; a hand piece the player places with a facing — data
// `placeable`, a talent summon: it deploys with the board, docs/SIM.md §1.1 token pieces).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 谬因 (链路协议 备注:
// her range "以自己所在格为起点向部署方向延伸，直至达到延伸距离上限" — 5 tiles from E1 —, "若延伸到了自身的中继器所在的地块，会令延伸
// 距离上限增加（并非增加谬因的攻击距离属性）并改变接下来的延伸方向", "尝试延伸到已延伸到的地块或地图边界外时延伸会提前终止", "索敌与攻击
// 始终采用格子判定", "攻击力增加效果不可叠加"; 取样优化 备注 "无视法抗效果为增加受益者的法术穿透属性（直接加算）"; 连续映射 备注
// "中继器持续时间结束时不再进行自动撤退"; 临界瞬爆 备注 "技能持续期间，自身的攻击范围可无限延伸直至无法继续延伸", "持有孤立的我方干员
// 也可令谬因攻击范围延伸效果转向"; 混沌的本质 备注 "技能开启后3秒内持有强制缴械", "“停顿时间延长”指的是增加本次攻击对该敌人施加的
// 停顿的时间", "技能开始/结束时强制撤回所有中继器", 修正 "清空再部署"); PRTS 中继器 (备注: 无敌, 禁疗, 孤立, 阻挡数 0, 再部署策略
// 队列); PRTS 卫戍协议/帮助 §作战阶段 ("若战场区初始部署有召唤物，若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个"); the client's
// battle data (charpack char_4229_aphris — the range selectors, the talent abilities; battle/prefabs [uc]skills skchr_aphris_1/2/3;
// buff_template_data aphris_token_add_atk_tohost, aphris_pc_t[with-draw], aphris_sk1(_token), aphris_sk2_switch_mode4,
// aphris_sk3 / [token-withdraw] / [on_finish], die_to_kill_token, charge_token[born]).
// - Range (链路协议; her selectors `_extendable`, `_extendValidator` = the 中继器, `_extendLengthEveryValidateChar` 2): a path,
//   not her data grid — from her tile along her facing, one tile at a time, up to her 5-1 length; reaching her own 中继器
//   adds 2 to the length still allowed and turns the path to that piece's facing; it stops at a tile it already holds or at
//   the map's edge. The path is her range (`unit.rangeGrid`, rebuilt when a piece or an operator comes or goes, at her
//   skill's start / end, and checked every tick): her attacks, the DEFAULT trigger, 取样优化 and the detail card all read it.
//   [ASSUMED] a huge enemy counts on every tile it covers (the engine's selection; PRTS: 格子判定 by its position), her hits
//   land at once (the client spaces them `_hitInterval` 0.05 s along the beam) and a 攻击距离 bonus (none exists for her in
//   this mode) would extend it as the engine extends any range.
// - Trait (轰击术师) "攻击造成超远距离的群体法术伤害": the profession's `rangeAoe` — every selectable enemy of her path at once,
//   air units too. Module BLA-Y “第三相态”: 部署费用 −8 (the attribute; stats 32 → 24), HP / ATK in the stats, no trait change;
//   stage 3 changes T1 (35 s piece, 再部署时间变短 — the piece's byModule respawnTime 30 → 20 —, ATK +35 %).
// - T1 链路协议: one 中继器 lasting the token talent's duration (25 s; BLA-Y stage 3: its hidden module talent, 35 s) from each
//   deployment (aphris_pc_t[with-draw]: it withdraws when that time is up unless it holds aphris_sk1_token — given to every
//   piece of hers when 连续映射 starts, and to a piece taking the field while 连续映射 or 混沌的本质 runs). Back on its tile its
//   respawnTime (30 / 20 s) after it left, paying its 3 DP — the 卫戍 auto redeploy of a placed summon, as 斯卡蒂的海嗣 —, and
//   only while 谬因 stands: her leaving the field withdraws it (die_to_kill_token), her (re)deployment makes it ready at once
//   (charge_token[born]). ATK +atk while one of hers stands (aphris_token_add_atk_tohost: one buff aphris_t1[atk], "不可叠加").
//   The piece "不会受到攻击" (data: untargetable) and holds 无敌, 禁疗 and 孤立 (PRTS 中继器; [ASSUMED] given by this kit — the
//   data's `abnormal` lacks them).
// - T2 取样优化 "攻击范围内的友方干员攻击时无视敌方10点法术抗性" (full potential: 13; aphris[t2]: attribute 27, 法术穿透, on allied operators — profession
//   mask 639 — of her attack range): resIgnoreFlat +magic_resist_penetrate_fixed on every allied operator standing on her path,
//   her own tile included [ASSUMED: the selector does not drop its owner], refreshed every AURA_IV s; several sources keep the
//   strongest.
// - S1 连续映射 (AUTO, 持续时间无限): ATK +atk (aphris_sk1) and the 中继器 marks above. An AUTO skill acting on herself fires at
//   full SP (`trigger: 'SP_FULL'`, the owner's AUTO rule, kits/README.md checklist 5); `toggle`.
// - S2 临界瞬爆 (MANUAL, data DEFAULT, 8 s): mode 4 (aphris_sk2_switch_mode4) — her normal attack is replaced by the beam
//   ability (`_preDelay` 0.167 = the Skill_2_Begin clip, then `_triggerDelta` 0.5; MAGICAL atk_scale): from BEAM_FIRST on,
//   every `interval` (0.5) s, every selectable enemy on her path takes atk_scale × ATK arts (16 hits in the 8 s). The path
//   meanwhile has no length limit (`_infinite`) and turns at her 中继器 and at every allied
//   operator it reaches (validators: the piece, allies of profession mask 639 — every operator profession; a 孤立 one too),
//   to that unit's facing. Trigger: the data's DEFAULT, plus — the owner's ACTIVE_RANGE rule (2026-10-05: a MANUAL skill
//   whose running range strictly contains her own casts with an enemy inside that range), which no data range can carry
//   for an unbounded path that bends — the beam's path as a content trigger range (skill.addTriggerRange: a targetable enemy
//   on the path she would fire along now, air units too as the beam hits them; 0.2.0 WE2, follow-up #16, O1's report).
// - S3 混沌的本质 (MANUAL, data DEFAULT, 20 发弹药 — `ammo`, attack@trigger_time): for charge_time (3) s from the cast 强制缴械
//   (aphris_sk3[sheltering], abnormal flag disarmed) and aphris_sk3[token-withdraw]: every 中继器 of hers withdrawn and its
//   redeploy time cleared (ResetTokenRespawnTime — the placed piece is back on its tile at once; the two extra pieces the
//   skill allows have no piece to place in the auto battle [ASSUMED: N/A]); attack interval +base_attack_time (−1.1 s on
//   2.9 s), ATK +atk, each attack attack@atk_scale × ATK on her path, and on every enemy it hits the buff aphris_sk3: 停顿
//   origin_sluggish + extra_sluggish × n s and n hits of extra_atk_scale × ATK arts, n = the 中继器 the path passed before the
//   enemy, at most max_times (1). It ends with its bullets; aphris_sk3[on_finish] withdraws every 中继器 and clears their
//   redeploy time again (so the piece is back at once, now with its normal lifetime).

import { num, talentBb, skillRec, up, batMod, toggleBuff } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { COLS } from '../../../constants.js';
import { dirVec, toLocal } from '../../../dir.js';

const S1 = 'skchr_aphris_1';
const S2 = 'skchr_aphris_2';
const S3 = 'skchr_aphris_3';
/** Her summon “中继器” (talent 链路协议). */
const RELAY = 'token_10070_aphris_pc';
/** Extra path length per 中继器 (the selectors' `_extendLengthEveryValidateChar`; "使该次攻击距离+2"). */
const RELAY_REACH = 2;
/** Talent-2 aura refresh period and buff length (the non-stacking aura convention of the kits). */
const AURA_IV = 0.25;
const AURA_DUR = 0.4;
/** S2 临界瞬爆: the first beam hit (skchr_aphris_2 `_preDelay`, the Skill_2_Begin clip's length), then every `interval` s. */
const BEAM_FIRST = 0.167;
/** How often a withdrawn 中继器 tries to come back once ready (her on the field, its tile free, DP paid). */
const RELAY_RETRY = 0.1;
const LINK_KEY = 'aphris:link';
const SAMPLING_KEY = 'aphris:sampling';
const CHARGE_KEY = 'aphris:charge';
const RELAY_ABNORMAL_KEY = 'aphris:relayAbnormal';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** A 中继器 of `unit`. */
const isRelayOf = (t, unit) => !!t && t.kind === 'token' && t.defId === RELAY && t.ownerUnit === unit;
const relaysOf = (battle, unit) => battle.allyUnits.filter((t) => isRelayOf(t, unit));
/** 连续映射 / 混沌的本质 running: a 中继器 taking the field now gets the no-withdraw mark (aphris_pc_t[with-draw]). */
const marksRelays = (unit) => !!(unit.skill && unit.skill.active && (unit.skill.id === S1 || unit.skill.id === S3));
/** Her own path length: the farthest forward tile of her data grid (5 on her E2 5-1). */
function baseReach(unit) {
  let n = 0;
  for (const p of unit.def?.rangeGrid ?? []) if (Array.isArray(p) && p[0] === 0 && p[1] > n) n = p[1];
  return n;
}
/** A 中继器's lifetime: the last `duration` of its talents (the BLA-Y stage-3 hidden talent after the base one). */
function relayLife(t) {
  let life = 0;
  for (const x of t.def?.talents ?? []) if (x && x.bb && x.bb.duration != null) life = num(x.bb.duration, life);
  return life;
}

/**
 * Her 延伸 path (header): absolute tiles in order from her own, with `index` (tile key → position) and `relays` (the
 * positions of the 中继器 tiles it passed). `beam` = S2: no length limit, every allied operator turns it too.
 */
function aphrisPath(battle, unit, beam = false) {
  const tiles = [[unit.tileR, unit.tileC]];
  const index = new Map([[unit.tileR * COLS + unit.tileC, 0]]);
  const relays = [];
  let [dr, dc] = dirVec(unit.dir);
  let reach = beam ? Infinity : baseReach(unit);
  let r = unit.tileR, c = unit.tileC, steps = 0;
  while (steps < reach) { // loop-cap: grid: breaks when the tile is off-board or already seen
    const nr = r + dr, nc = c + dc;
    const k = nr * COLS + nc;
    if (!battle.grid.inBounds(nr, nc) || index.has(k)) break;
    index.set(k, tiles.length);
    tiles.push([nr, nc]);
    r = nr; c = nc; steps++;
    const o = battle.unitAt(nr, nc);
    if (o && isRelayOf(o, unit)) {
      reach += RELAY_REACH;
      [dr, dc] = dirVec(o.dir);
      relays.push(tiles.length - 1);
    } else if (beam && o && o !== unit && o.kind === 'op' && o.side === 'ally') [dr, dc] = dirVec(o.dir);
  }
  return { tiles, index, relays };
}

/** Rebuild her range from the path when it changed (the relative grid of the path in her facing-RIGHT frame). */
function refreshPath(battle, unit) {
  if (!up(unit)) return;
  const beam = !!(unit.skill && unit.skill.active && unit.skill.id === S2);
  const p = aphrisPath(battle, unit, beam);
  const sig = p.tiles.map(([r, c]) => r * COLS + c).join(',');
  unit.mem.aphrisPath = p;
  if (unit.mem.aphrisSig !== sig) {
    unit.mem.aphrisSig = sig;
    unit.rangeGrid = p.tiles.map(([r, c]) => toLocal(r - unit.tileR, c - unit.tileC, unit.dir));
    battle.refreshRange(unit);
  }
  noteAphrisLine(battle, unit, beam, p, sig);
}

/**
 * The beam's tiles, when S2 is on and the path changed after the cast. The cast itself emits `beam` (onStart sets
 * aphrisFxSig first, so this skillStart does not emit a second line). Not a per-enemy beam. Display only.
 */
function noteAphrisLine(battle, unit, beam, p, sig) {
  if (!beam) {
    if (unit.mem.aphrisFxSig != null) unit.mem.aphrisFxSig = null;
    return;
  }
  if (unit.mem.aphrisFxSig === sig) return;
  unit.mem.aphrisFxSig = sig;
  const path = [];
  for (const [r, c] of p.tiles) { path.push(r); path.push(c); }
  // cosmetic fx (round 88)
  battle.fx('aphrisPath', { x: unit.x, y: unit.y, id: unit.id, skill: 'aphris:beam', path, relays: p.relays.slice() });
}

/** How many 中继器 her path passed before `e`'s tile (S3 aphris_sk3 "extendTimes"). */
function relaysBefore(unit, e) {
  const p = unit.mem.aphrisPath;
  if (!p || !p.relays.length) return 0;
  const i = p.index.get(Math.round(e.y) * COLS + Math.round(e.x));
  return i == null ? 0 : p.relays.filter((j) => j < i).length;
}

/** Withdraw every 中继器 of hers that stands; `clear` = their redeploy time cleared (ResetTokenRespawnTime). */
function withdrawRelays(battle, unit, clear) {
  for (const t of relaysOf(battle, unit)) {
    if (t.alive) {
      t.mem.relayCleared = clear;
      battle.retreat(t, { reason: 'expired', permanent: true });
    } else if (clear && !t.removed) t.mem.relayReadyAt = battle.time;
  }
}

/** A 中继器 of hers took the field: its abnormal flags and redeploy rule once, its lifetime and mark every time. */
function relayDeployed(battle, unit, t) {
  if (!t.mem.aphrisRelay) {
    t.mem.aphrisRelay = true;
    battle.addBuff(t, { key: RELAY_ABNORMAL_KEY, flags: { invulnerable: true, isolated: true, noHeal: true }, persist: true, allowDead: true });
    // back on its tile its respawnTime after it left (at once when its redeploy time was cleared), while she stands,
    // paying its DP — a token is otherwise removed for good: the piece is kept (`removed = false`) so its hooks survive
    // and `battle.redeploy` accepts it
    battle.on('death', (c) => {
      if (c.unit !== t || battle.finished) return;
      t.removed = false;
      t.mem.relayReadyAt = battle.time + (t.mem.relayCleared ? 0 : Math.max(0, num(t.base.respawnTime)));
      t.mem.relayCleared = false;
      if (t.mem.relayRetry) return;
      t.mem.relayRetry = battle.every(RELAY_RETRY, (b, sched) => {
        const stop = () => { sched.cancel(); t.mem.relayRetry = null; };
        if (t.alive || t.removed || b.finished) { stop(); return; }
        if (!up(unit) || b.time + 1e-9 < t.mem.relayReadyAt) return;
        if (b.redeploy(t, { free: false })) stop();
      }, { owner: t });
    }, { owner: t, priority: -10 });
  }
  t.mem.relayKept = marksRelays(unit);   // aphris_pc_t[with-draw] ON_BUFF_START: aphris_sk1_token
  const life = relayLife(t);
  if (!(life > 0)) return;
  const seq = t.deploySeq;
  battle.after(life, () => {
    if (!t.alive || t.deploySeq !== seq || t.mem.relayKept) return; // 连续映射's mark: "不再进行自动撤退"
    battle.retreat(t, { reason: 'expired', permanent: true });
  }, { owner: t });
}

export default {
  char_4229_aphris: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    return {
      // PRTS 链路协议 备注 "索敌与攻击始终采用格子判定": her searches take the tile of an enemy's position, never its 0.1
      // collider (Battle.enemiesInKeys / anyEnemyInKeys / unitsInGrid read `rangeTiles`)
      trait: { rangeTiles: true },
      skills: {
        [S1]: {
          kind: 'toggle', trigger: 'SP_FULL', mods: { atkPct: num(b1.atk) },
          onStart({ battle, unit }) { for (const t of relaysOf(battle, unit)) if (t.alive) t.mem.relayKept = true; }, // aphris_sk1 → aphris_sk1_token
        },
        [S2]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            unit.mem.beamAt = 0;
            unit.mem.beamNext = BEAM_FIRST;
            // skillStart's refreshPath runs after this and would emit a second line; remember the beam path first.
            const p = aphrisPath(battle, unit, true);
            const path = [];
            for (const [r, c] of p.tiles) { path.push(r); path.push(c); }
            unit.mem.aphrisFxSig = p.tiles.map(([r, c]) => r * COLS + c).join(',');
            // cosmetic fx (round 88): the tiles, so the client can draw the line. The procedural strike still uses this event.
            battle.fx('beam', { x: unit.x, y: unit.y, id: unit.id, skill: 'aphris:beam', path, relays: p.relays.slice() });
          },
          onTick({ battle, unit, skill, dt }) {
            const iv = stepOf('interval', num(b2.interval, 0.5), 0.5);
            if (!(iv > 0)) return;
            const t = (unit.mem.beamAt = (unit.mem.beamAt ?? 0) + dt);
            let guard = 0;
            while (t >= unit.mem.beamNext - 1e-6 && skill.active && unit.alive && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval
              unit.mem.beamNext += iv;
              for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile)) {
                const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale), type: 'arts', isSkill: true, tags: ['skill', 'aphris:beam'] });
                if (!(dealt > 0)) continue;
                // cosmetic fx (round 88): one channel hit per enemy this tick actually damaged.
                battle.fx('aphrisHit', { x: e.x, y: e.y, id: unit.id, target: e.id, skill: 'aphris:beam' });
              }
            }
          },
        },
        [S3]: {
          kind: 'ammo', ammo: num(b3['attack@trigger_time'], 20),
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            onEachHit({ battle, unit, target }) { // aphris_sk3 on every enemy the attack hits
              if (!target || target.side !== 'enemy' || !target.alive) return;
              const max = num(b3['attack@max_times'], 1);
              const n = max >= 0 ? Math.min(max, relaysBefore(unit, target)) : relaysBefore(unit, target);
              const slow = num(b3['attack@origin_sluggish']) + num(b3['attack@extra_sluggish']) * n;
              if (slow > 0) battle.applyStatus(target, 'sluggish', { duration: slow, source: unit });
              const ex = num(b3['attack@extra_atk_scale']);
              for (let i = 0; i < n && target.alive && ex > 0; i++) battle.dealDamage(unit, target, { amount: unit.s.atk * ex, type: 'arts', isSkill: true, tags: ['skill', 'aphris:relay'] });
            },
          },
          onStart({ battle, unit }) {
            const ct = num(b3.charge_time);
            if (ct > 0) battle.addBuff(unit, { key: CHARGE_KEY, duration: ct, flags: { disarm: true }, tags: ['skill'] }); // 强制缴械
            withdrawRelays(battle, unit, true);   // aphris_sk3[token-withdraw]
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, CHARGE_KEY);
            withdrawRelays(battle, unit, true);   // aphris_sk3[on_finish]
          },
        },
      },
      talents: [
        { install(battle, unit) { // 链路协议: ATK +atk while one of her 中继器 stands (one buff however many)
          const a = num(t0.atk);
          if (a) toggleBuff(battle, unit, LINK_KEY, () => relaysOf(battle, unit).some((t) => t.alive && t.deployed), { atkPct: a });
          // die_to_kill_token: her pieces leave with her; charge_token[born]: her (re)deployment makes a waiting one ready
          battle.on('death', (c) => { if (c.unit === unit) withdrawRelays(battle, unit, false); }, { owner: unit });
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            for (const t of relaysOf(battle, unit)) if (!t.alive && !t.removed) t.mem.relayReadyAt = battle.time;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 取样优化: 法术穿透 +v on the allied operators of her path
          const v = num(t1.magic_resist_penetrate_fixed);
          if (!(v > 0)) return;
          battle.every(AURA_IV, () => {
            if (!up(unit) || !unit.rangeKeySet) return;
            for (const a of battle.alliesFor(unit)) {
              if (a.kind !== 'op' || !unit.rangeKeySet.has(a.tileR * COLS + a.tileC)) continue;
              const cur = a.findBuff(SAMPLING_KEY);
              if (cur && cur.source !== unit && (cur.data?.v ?? 0) > v && cur.timeLeft > 0.05) continue;
              battle.addBuff(a, { key: SAMPLING_KEY, duration: AURA_DUR, mods: { resIgnoreFlat: v }, source: unit, data: { v }, tags: ['aura'] });
            }
          }, { owner: unit, immediate: true });
        } },
      ],
      install(battle, unit) {
        // the 延伸 path: rebuilt on any ally's arrival / departure (her 中继器, an operator S2 bends on), her skill's
        // start / end, and checked every tick
        battle.on('deploy', (c) => {
          const t = c.unit;
          if (t === unit) unit.mem.aphrisSig = null;
          else if (isRelayOf(t, unit)) relayDeployed(battle, unit, t);
          if (t && t.side === 'ally') refreshPath(battle, unit);
        }, { owner: unit });
        battle.on('death', (c) => { if (c.unit && c.unit.side === 'ally' && c.unit !== unit) refreshPath(battle, unit); }, { owner: unit });
        battle.on('skillStart', (c) => { if (c.unit === unit) refreshPath(battle, unit); }, { owner: unit });
        battle.on('skillEnd', (c) => { if (c.unit === unit) refreshPath(battle, unit); }, { owner: unit });
        battle.on('tick', () => refreshPath(battle, unit), { owner: unit });
        // S2: the beam's path is its trigger range too (the owner's larger-range rule, see the header)
        if (unit.skill?.id === S2) unit.skill.addTriggerRange(() => (up(unit) ? [aphrisPath(battle, unit, true).tiles.map(([r, c]) => r * COLS + c)] : []));
        // S3's 强制缴械 from the cast on: the attack loop goes on to the attack the cast was made for (ai.js updateAlly
        // checks `disarm` before the cast only) — no target, no attack, no bullet spent
        battle.on('beforeAttack', (c) => { if (c.attacker === unit && unit.findBuff(CHARGE_KEY)) c.targets = []; }, { owner: unit });
      },
    };
  },
};
