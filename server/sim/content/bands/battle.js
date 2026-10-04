// server/sim/content/bands/battle.js — battle side of the strategies (bands, data/bands.json; research 01 §11).
//
// Each player of a battle installs the IN_BATTLE parts of its own band, dispatched on the band buff's bbStr.key
// (numbers from the blackboard, never hard-coded). Band buffs apply in every battle kind (normal / 联防 / boss /
// hidden); IN_BATTLE layer gains are no-ops where the match disables them (support.gainLayers).
//
//   act1autochess_band2_buff  阿米娅 众志合一   ≥ value_i active bonds (highest i) ⇒ every operator ATK +atk_i,
//                                               HP +max_hp_i (直接乘算 — support directMods —, bonds snapshot at combat start)
//   act1autochess_band28_buff 埃芒加德 命结之秘 the first max_respawn_cnt operator knock-downs of the battle revive at
//                                               once at full HP (runs after every other death saver, items included;
//                                               a new deployment for 坚固维式重锤's lock — items revivedInPlace)
//   act1autochess_band13_buff 克莱门莎 崇高牺牲 a <bond_id> operator knocked down ⇒ +its tier (等阶) <bond_id> layers
//                                               (bond_add_type by_charlevel; no "已激活" in the text ⇒ requireActive false)
//   act1autochess_band16_buff 大帝 加急调派     "每次部署后再部署时间减少50%": every deployment of an operator stacks one
//                                               redeploy ×(1 + respawn_time) for the rest of the battle [ASSUMED cumulative:
//                                               "每次" — the first redeploy is −50 % under either reading]
//   act1autochess_band17_buff 桑葚 药枚实验     at combat start the player's units on the front-most (最右边) column: each
//                                               attack has `prob` to gain 1 shield layer (max 1)
//   act1autochess_band18_buff 休谟斯 回收利用   a ground (地面) operator's skill ends ⇒ a random operator on its 4
//                                               neighbouring tiles gains `sp` SP
//   act1autochess_band15_buff 卡莱莎 食腐之蝶   an operator knocked down ⇒ every other unit of the player on the field
//                                               ATK +atk × n, n ≤ max_stack_cnt (+20 % … +200 %, additive stacks),
//                                               until that unit is knocked down itself or the battle ends
//   act1autochess_band19_buff 陈 以己之长       the player's operators' physical / arts damage becomes 弱点伤害
//   act2autochess_band12_buff 夕 墨色真颜       at combat start operators of which ≥ 2 of the same name (same base chess,
//                                               elite or not) stand on the field get ATK +atk
//   act2autochess_band3_buff  伊奥莱塔 统御号令 at combat start n = elite operators on the field ⇒ every elite operator
//                                               ATK +atk_per_cnt × n, HP +max_hp_per_cnt × n (all 直接乘算)
//   auto_chess_change_map     Touch 外勤医疗    "所有玩家场地上出现一名<预备干员-医疗>": while any alive player of the match
//                                               holds band_amedic, every player's field gets the map character of the
//                                               variant whose common_condition holds for that player's elites on the field
//                                               (condition_golden_chess_le cnt → 预备干员-医疗, _ge cnt → Touch), spawned at
//                                               combat start on its stage slot (tokens.spawnMapChar)
// Prep-only bands (economy / shop / grants / layers at prep end or round start) live in bands/meta.js.

import {
  num, buffsOf, bandRecord, isOp, onField, isElite, tierOf, unitBonds, activeBondIds, playerOps, passiveBuff, fxOn,
  matchBands, gainLayers, alliesAround, N4, baseChessId, isGroundOp, directMods,
} from '../support/index.js';
import { weaknessRetype, addShieldLayer, PRIO_REVIVE, revivedInPlace } from '../items/battle.js';
import { spawnMapChar } from '../tokens.js';

export const AMEDIC_BAND = 'band_amedic';
/** 'fatal' priority of 埃芒加德: after the operators' own items (PRIO_REVIVE / PRIO_RESPAWN) and every talent / skill saver. */
export const PRIO_BAND_REVIVE = PRIO_REVIVE - 10;

const keyOf = (bandId, part = '') => `band:${bandId}${part ? `:${part}` : ''}`;
const deployedOps = (battle, pid) => playerOps(battle, pid, { fieldOnly: true });

// ---------------------------------------------------------------------------------------------------------------
// band buff behaviours: (battle, ps, params, bandId)

const BY_KEY = {
  // 阿米娅 众志合一
  act1autochess_band2_buff(battle, ps, p, bandId) {
    const n = activeBondIds(battle, ps.playerId).length;
    let atk = 0, hp = 0;
    for (let i = 1; i <= 9 && p[`value_${i}`] != null; i++) {
      if (n >= num(p[`value_${i}`], Infinity)) { atk = num(p[`atk_${i}`]); hp = num(p[`max_hp_${i}`]); }
    }
    if (!(atk > 0 || hp > 0)) return;
    const mods = directMods({ atk, hp });
    for (const u of playerOps(battle, ps.playerId)) passiveBuff(battle, u, keyOf(bandId), mods);
  },

  // 埃芒加德 命结之秘
  act1autochess_band28_buff(battle, ps, p, bandId) {
    const max = Math.floor(num(p.max_respawn_cnt, 3));
    if (!(max > 0)) return;
    let used = 0;
    battle.on('fatal', (c) => {
      const u = c.unit;
      if (c.prevented || used >= max || !isOp(u) || u.ownerId !== ps.playerId || !u.alive) return;
      used++;
      c.prevented = true;
      u.hp = u.s.maxHp;
      revivedInPlace(u); // in place for PRTS's 0-time / 0-cost redeploy: a new deployment for 坚固维式重锤's lock (items)
      fxOn(battle, 'revive', u, keyOf(bandId), bandId, { left: max - used });
    }, { priority: PRIO_BAND_REVIVE });
  },

  // 克莱门莎 崇高牺牲
  act1autochess_band13_buff(battle, ps, p, bandId) {
    const bond = typeof p.bond_id === 'string' && p.bond_id ? p.bond_id : null;
    if (!bond) return;
    const byLevel = p.bond_add_type == null || p.bond_add_type === 'by_charlevel';
    battle.on('death', (c) => {
      const u = c.unit;
      if (c.reason !== 'killed' || !isOp(u) || u.ownerId !== ps.playerId || !unitBonds(u).includes(bond)) return;
      const n = byLevel ? tierOf(u) : Math.max(1, Math.floor(num(p.value, 1)));
      if (gainLayers(battle, { playerId: ps.playerId, bonds: bond, n, requireActive: false, source: u, reason: 'band' }) > 0) {
        fxOn(battle, 'layer', u, keyOf(bandId), bandId, { bond, n });
      }
    });
  },

  // 大帝 加急调派
  act1autochess_band16_buff(battle, ps, p, bandId) {
    const mul = Math.max(0, 1 + num(p.respawn_time, 0));
    if (mul === 1) return;
    const key = keyOf(bandId);
    battle.on('deploy', (c) => {
      const u = c.unit;
      if (!isOp(u) || u.ownerId !== ps.playerId) return;
      battle.addBuff(u, { key, mods: { redeployMul: mul }, refresh: 'stack', stacks: 1, maxStacks: 20, persist: true, allowDead: true });
    });
  },

  // 桑葚 药枚实验
  act1autochess_band17_buff(battle, ps, p, bandId) {
    const pr = num(p.prob);
    if (!(pr > 0)) return;
    const key = keyOf(bandId, 'shield');
    const chosen = new Set();
    battle.on('battleStart', () => {
      const units = battle.allies(ps.playerId);
      // "最右边的所有我方单位": the rightmost column of the player's own board (a board position, whatever the units'
      // directions; the mirrored Final Assault right side counts from the field's left)
      const boardCol = (u) => (ps.mirror ? -u.tileC : u.tileC);
      let front = -Infinity;
      for (const u of units) front = Math.max(front, boardCol(u));
      for (const u of units) if (boardCol(u) === front) chosen.add(u);
    });
    battle.on('attack', (c) => {
      const u = c.attacker;
      if (!chosen.has(u) || !u.alive) return;
      if (!(pr >= 1 || battle.rng() < pr)) return;
      if (addShieldLayer(battle, u, key, 1)) fxOn(battle, 'shield', u, keyOf(bandId), bandId);
    });
  },

  // 休谟斯 回收利用 ("地面干员技能结束时…": a melee-position operator on any tile — support isGroundOp)
  act1autochess_band18_buff(battle, ps, p, bandId) {
    const sp = num(p.sp);
    if (!(sp > 0)) return;
    battle.on('skillEnd', (c) => {
      const u = c.unit;
      if (!isOp(u) || u.ownerId !== ps.playerId || c.reason === 'death' || !onField(u) || !isGroundOp(u)) return;
      const cands = alliesAround(battle, u, N4).filter((a) => a.kind === 'op' && a.skill && !a.skill.noSkill && a.skill.kind !== 'passive');
      const t = cands.length ? battle.rng.pick(cands) : null;
      if (!t) return;
      t.skill.gainSp(sp, 'band');
      fxOn(battle, 'spGain', t, keyOf(bandId), bandId, { n: sp, from: u.id });
    });
  },

  // 卡莱莎 食腐之蝶
  act1autochess_band15_buff(battle, ps, p, bandId) {
    const step = num(p.atk);
    const cap = Math.max(1, Math.floor(num(p.max_stack_cnt, 10)));
    if (!(step > 0)) return;
    const key = keyOf(bandId);
    battle.on('death', (c) => {
      const d = c.unit;
      if (c.reason !== 'killed' || !isOp(d) || d.ownerId !== ps.playerId) return;
      for (const a of battle.allies(ps.playerId)) {
        if (a === d) continue;
        const cur = a.findBuff(key);
        const n = Math.min(cap, (cur && cur.data ? cur.data.n : 0) + 1);
        battle.addBuff(a, { key, mods: directMods({ atk: step * n }), refresh: 'replace', data: { n }, visible: true });
      }
    });
  },

  // 陈 以己之长
  act1autochess_band19_buff(battle, ps) {
    battle.on('hit', (c) => {
      const s = c.source;
      if (!isOp(s) || s.ownerId !== ps.playerId || !c.target || c.target.side !== 'enemy') return;
      weaknessRetype(c.dmg, s, c.target);
    }, { priority: 5 });
  },

  // 夕 墨色真颜
  act2autochess_band12_buff(battle, ps, p, bandId) {
    const atk = num(p.atk);
    if (!atk) return;
    battle.on('battleStart', () => {
      const groups = new Map();
      for (const u of deployedOps(battle, ps.playerId)) {
        const b = baseChessId(u);
        if (!groups.has(b)) groups.set(b, []);
        groups.get(b).push(u);
      }
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        for (const u of list) passiveBuff(battle, u, keyOf(bandId), directMods({ atk }));
      }
    });
  },

  // 伊奥莱塔 统御号令
  act2autochess_band3_buff(battle, ps, p, bandId) {
    const a = num(p.atk_per_cnt), h = num(p.max_hp_per_cnt);
    if (!(a > 0 || h > 0)) return;
    battle.on('battleStart', () => {
      const elites = deployedOps(battle, ps.playerId).filter(isElite);
      const n = elites.length;
      if (!n) return;
      const mods = directMods({ atk: a * n, hp: h * n });
      for (const u of elites) passiveBuff(battle, u, keyOf(bandId), mods);
    });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Touch 外勤医疗 (auto_chess_change_map, every player's field)

/** Map-character variants of band_amedic: [{ cond, cnt, chars: [tokenId…] }]. */
export function amedicVariants() {
  const out = [];
  for (const b of buffsOf(bandRecord(AMEDIC_BAND))) {
    if (b.key !== 'auto_chess_change_map') continue;
    const chars = new Set();
    for (const [k, v] of Object.entries(b.p)) if (k.includes('#') && num(v) > 0) chars.add(k.split('#')[0]);
    out.push({ cond: String(b.p.common_condition || ''), cnt: num(b.p.cnt, 0), chars: [...chars] });
  }
  return out;
}

/** Map characters for a player with `elites` elite operators on the field. */
export function amedicCharsFor(elites, variants = amedicVariants()) {
  for (const v of variants) {
    const ok = /_ge$/.test(v.cond) ? elites >= v.cnt : /_le$/.test(v.cond) ? elites <= v.cnt : false;
    if (ok) return v.chars;
  }
  return [];
}

function installMapChars(battle) {
  const variants = amedicVariants();
  if (!variants.length) return;
  const holders = battle.players.filter((ps) => matchBands(battle, ps.playerId).includes(AMEDIC_BAND));
  if (!holders.length) return;
  battle.on('battleStart', () => {
    for (const ps of holders) {
      const elites = deployedOps(battle, ps.playerId).filter(isElite).length;
      for (const id of amedicCharsFor(elites, variants)) {
        const u = spawnMapChar(battle, ps.playerId, id);
        if (u) fxOn(battle, 'summon', u, keyOf(AMEDIC_BAND), AMEDIC_BAND);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------

/** Band buff keys with a battle part (tests / tooling). */
export const BATTLE_BUFF_KEYS = Object.freeze([...Object.keys(BY_KEY), 'auto_chess_change_map']);

/** Does this band have a battle part? */
export function hasBattlePart(bandId) {
  return buffsOf(bandRecord(bandId)).some((b) => (b.bbKey && BY_KEY[b.bbKey]) || b.key === 'auto_chess_change_map');
}

export function install(battle) {
  for (const ps of battle.players) {
    const band = ps.bandId ? bandRecord(ps.bandId) : null;
    if (!band) continue;
    for (const b of buffsOf(band)) {
      const f = b.bbKey ? BY_KEY[b.bbKey] : null;
      if (!f) continue;
      try { f(battle, ps, b.p, ps.bandId); } catch (e) { battle._handlerError?.(`band:${ps.bandId}`, null, e); }
    }
  }
  installMapChars(battle);
}
