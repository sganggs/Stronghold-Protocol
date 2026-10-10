// server/match/match/views.js — Match methods: the state builders — m.public (publicView with statusOf / fieldOf, the
// fields' progress, the teammates' live pendingLp / uniteLeft, the SETTLE uniteResult), the nextEnemies preview of
// m.private and the prep scout's m.field (prepFieldMeta: board, hand and temp as units, the scouted player's effects and
// coming enemies; in a boss round's prep on the player's half of the boss field).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { boardOrder, pieceDir } from '../board.js';
import { bondList, offBondCounts } from '../bondsMeta.js';
import { cardView } from '../choices.js';
import { bountySpawns, previewOf } from '../waves.js';
import { timelineAt } from '../fields.js';
import { bossFieldPlacement } from '../finalAssault.js';
import { battleProgress } from '../../sim/spec.js';

/** A reported capsule numerator clamped to its denominator, else null (unknown — never a fabricated 0). */
const finiteOrNull = (v, cap = Infinity) => {
  if (v == null) return null;   // Number(null) === 0: an unreported value must not read as "0 resolved"
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(Number.isFinite(cap) ? cap : Infinity, Math.trunc(n)));
};

/**
 * A scouted operator's potential (below 6) and 练度 (0.2.2), like the sim's UnitInfo: PlayerState.loadoutFor's
 * `potential` / `cultivate` (null for a stand-in or a prototype 自选 pick: neither field).
 */
function cultivationInfo(lo) {
  const out = {};
  if (lo && Number.isInteger(lo.potential) && lo.potential < 6) out.potential = lo.potential;
  if (lo && Number.isInteger(lo.cultivate)) out.cultivate = lo.cultivate;
  return out;
}

export class MatchViews {
  statusOf(ps) {
    if (ps.left) return 'left';
    if (!ps.alive) return 'dead';
    switch (this.phase) {
      case PHASE.INFO_CHECK: return ps.infoReady ? 'ready' : 'deciding';
      case PHASE.BAND_DRAFT:
        if (this.draft && this.draft.picks[ps.playerId]) return 'ready';
        return this.draft && this.draftTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.SP_DRAFT:
        if (this.sp && this.sp.picks[ps.playerId] != null) return 'ready';
        return this.sp && this.spTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.PREP: return ps.ready ? 'ready' : 'acting';
      case PHASE.COMBAT: case PHASE.FINAL_ASSAULT: case PHASE.HIDDEN_CORE: {
        const f = this.fields.find((x) => x.players.includes(ps.playerId));
        return f && f.live ? 'combat' : 'done';
      }
      case PHASE.UNITE: return this.unitePlan && this.unitePlan.helpers.includes(ps) ? 'helping' : 'done';
      case PHASE.ROUND_START: return 'acting';
      default: return 'done';
    }
  }

  fieldOf(ps) {
    const f = this.fields.find((x) => x.players.includes(ps.playerId));
    return f ? f.fieldId : null;
  }

  publicView() {
    const v = {
      t: 'm.public',
      phase: this.phase,
      round: this.round,
      lastRound: this.gd.lastRound,
      deadline: this.deadline,
      serverNow: this.sched.now(),
      modeId: this.modeId,
      difficulty: this.difficulty,
      stageId: this.stageId,
      setupRevision: this.setupRevision,
      rerollVote: this.setupVote ? {
        id: this.setupVote.id,
        proposerId: this.setupVote.proposerId,
        voters: this.setupVote.voters.slice(),
        agreed: [...this.setupVote.agreed],
      } : null,
      factions: this.factions.slice(),
      disabledBonds: [...new Set([...this.disabledBonds, ...this.staticInactiveBonds])].sort(),
      drawnDisabledBonds: this.disabledBonds.slice(),
      bannedChess: this.bannedChess.slice(),
      bossId: this.bossId,
      hiddenBossId: this.hiddenBossId,
      bossRound: this.gd.bossRound,
      hiddenRound: this.gd.hiddenRound,
      spRound: this.gd.spRounds().includes(this.round),
      // DESIGN §14: 'client' = battles are simulated by the browsers (b.start specs), 'server' = legacy streaming
      combatMode: this.clientCombat ? 'client' : 'server',
      // solo pause (g.pause, DESIGN §14): the battle, its field clock and every deadline are frozen while true
      paused: !!this.paused,
      players: this.order.map((ps) => ({
        playerId: ps.playerId,
        seat: ps.seat,
        name: ps.name,
        isBot: ps.isBot,
        connected: ps.isBot || (ps.connected && !ps.left),
        alive: ps.alive,
        lp: Math.max(0, ps.lp),
        bandId: ps.bandId,
        shopLevel: ps.shop.level,
        boardCount: ps.deployCount,
        ready: this.phase === PHASE.INFO_CHECK ? ps.infoReady : ps.ready,
        // the strip of a teammate watching this player (DESIGN §20.15): every bond with members, layers or an active tier
        // (= the player's own m.private list without thresholds / countsHand — the client reads those from bonds.json),
        // this round's in-battle gains included once the COMBAT phase ended (PlayerState.bondsView); [] once eliminated —
        // nobody can watch an eliminated player (g.watch refuses them, they have no field) and the result screen reads
        // m.result's own bonds, so their layers would only cost every m.public bytes for the rest of the match
        // (the mode-off bonds with members included, `off: true`, as in m.private — bondsMeta.offBondCounts)
        bonds: ps.alive ? bondList(this.gd, ps.bondsView(), { off: offBondCounts(ps.gd || this.gd, ps) }) : [],
        fieldId: this.fieldOf(ps),
        status: this.statusOf(ps),
        autoplay: ps.autoplay,
        // the LP this round's own battle will cost at settlement so far (COMBAT / 联防 only, omitted when 0)
        ...this._pendingLpView(ps),
      })),
      fields: this.fields.map((f) => {
        const v = { fieldId: f.fieldId, kind: f.kind, players: f.players.slice(), live: !!f.live };
        const pr = this._fieldProgress(f);
        if (pr) v.progress = pr;
        return v;
      }),
    };
    if (this.teamLp != null) v.teamLp = Math.max(0, Math.round(this.teamLp));
    // 最终攻势 / 隐秘核心: when the overtime drain starts (ms epoch; `deadline` is the level's 120 s countdown)
    if ((this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.overtimeAt) v.overtimeAt = this.overtimeAt;
    if (this.bossPool) v.bossHp = { hp: Math.max(0, Math.round(this.bossPool.hp)), max: Math.round(this.bossPool.maxHp) };
    if (this.phase === PHASE.BAND_DRAFT && this.draft) {
      const d = this.draft;
      // turnSeconds: the length of a turn (the countdown gauge's total; 0 when untimed) — deadline = turnDeadline
      v.draft = {
        order: d.order.slice(), turn: this.draftTurn(), picks: { ...d.picks }, skipsLeft: { ...d.skipsLeft }, turnDeadline: d.turnDeadline || 0,
        turnSeconds: d.untimed ? 0 : this.bandTurnMs() / 1000, untimed: !!d.untimed,
      };
    }
    if (this.phase === PHASE.SP_DRAFT && this.sp) {
      const s = this.sp;
      v.sp = {
        family: s.family, name: s.name, desc: s.desc, eventId: s.eventId, cards: s.cards.map(cardView), order: s.order.slice(),
        turn: this.spTurn(), picks: { ...s.picks }, taken: { ...s.taken }, untimed: !!s.untimed,
      };
    }
    if (this.phase === PHASE.UNITE && this.unitePlan) v.unite = { helpers: this.unitePlan.helpers.map((p) => p.playerId), leakers: this.unitePlan.leakers.map((p) => p.playerId) };
    // SETTLE after a 联防: its outcome as data (settle.js uniteResultView; GitHub #235, PR #112) — { through, helpers,
    // leakers, losses: { playerId: the LP settlement charged this round } } — the client's result box reads the viewer's
    // own charge from it; absent when no 联防 resolved (the client then shows the round's own battle result)
    if (this.phase === PHASE.SETTLE && this.uniteResultView) {
      const ur = this.uniteResultView;
      v.uniteResult = { through: ur.through, helpers: ur.helpers.slice(), leakers: ur.leakers.slice(), losses: { ...ur.losses } };
    }
    return v;
  }

  /**
   * m.public.fields[].progress: { killed, resolved, total, done } (teammates' waiting UI). `resolved` is the HUD
   * capsule's numerator — the field's own scheduled enemies knocked out or leaked (Battle.resolved / the reported
   * b.progress `resolved`); it is `null` (never 0) while unknown, so the client's `resolved ?? killed` fallback holds.
   * `total` is the capsule's denominator: only the enemies the round scheduled (runtime splits / summons — boss summons
   * included — are in neither part).
   */
  _fieldProgress(f) {
    if (!f) return null;
    if (!f.cc) {
      const b = f.battle;
      if (!b) return null;
      const total = Number(b.total) || 0;
      return { killed: Number(b.killed) || 0, resolved: finiteOrNull(b.resolved, total), total, done: !f.live };
    }
    if (f.done && f.result) {
      let killed = 0, total = 0, own = 0, ownKnown = true;
      for (const pp of Object.values(f.result.perPlayer || {})) {
        killed += Number(pp && pp.killed) || 0;
        total += Number(pp && pp.total) || 0;
        if (Number.isFinite(pp && pp.resolved)) own += Number(pp.resolved); else ownKnown = false;
      }
      // the FIELD's numerator (the validated client result / Battle.result(): what the capsule showed) — not the sum of the
      // players' own: an enemy that spawns on one half and leaks on the other (a 联防 lane, the boss pair's crossing routes)
      // is billed to one player's `total` and to the other's leak, so their own min(total, …) clamp it to 0
      let resolved = finiteOrNull(f.result.resolved, total);
      if (resolved == null && ownKnown) resolved = Math.min(total, own);
      if (f.result.synthetic) { killed = f.progress.killed; total = f.progress.total; resolved = finiteOrNull(f.progress.resolved, total); }
      return { killed, resolved, total, done: true };
    }
    if (f.mode === 'server' && f.timeline) {
      // a server-run / bot field: no authority ever sends a b.progress, so the capsule reads the battle's own counters —
      // the timeline sample carries `resolved` (Battle.resolved: knocked out + leaked among the field's own enemies),
      // never the report-driven `progress.leaks`, which would leave such a field at 0 forever
      const [, killed, total, resolved] = timelineAt(f.timeline, this._fieldElapsed(f));
      return { killed, resolved: finiteOrNull(resolved, total), total, done: false };
    }
    const total = f.progress.total;
    return { killed: f.progress.killed, resolved: finiteOrNull(f.progress.resolved, total), total, done: false };
  }

  /**
   * LP a player's own battle of this normal round will cost at settlement so far — settle()'s min(lpCapPerRound,
   * counted leaks) — for the teammates' live LP (m.public players[].pendingLp, user playtest #3 item 2; the own client
   * counts its local battle itself). COMBAT: the recorded result once every field is done, else the field's result, else
   * the authority's b.progress leaks (a server-run field reports none before its result is released); 联防: a leaker's
   * enemies still standing on the 联防 field (_uniteLeft, uncapped in `uniteLeft`, user playtest #6 item 7), anyone
   * else's own battle count (0: they were perfect). Omitted when 0 and in every other phase (boss rounds charge the
   * merged team LP live).
   * @returns {{ pendingLp?: number, uniteLeft?: number }}
   */
  _pendingLpView(ps) {
    if (!ps || !ps.alive || (this.phase !== PHASE.COMBAT && this.phase !== PHASE.UNITE)) return {};
    const counted = (r) => (r && Array.isArray(r.leaked) ? r.leaked.filter((l) => l && l.counted !== false).length : 0);
    // 联防: a leaker's enemies still standing on the 联防 field (uncapped), the loss capped like settle()
    const left = this._uniteLeft(ps);
    if (left != null) {
      const loss = Math.min(this.gd.lpCapPerRound, left);
      return loss > 0 ? { uniteLeft: left, pendingLp: loss } : { uniteLeft: left };
    }
    let n = 0;
    if (this.lastResults.has(ps.playerId)) n = counted(this.lastResults.get(ps.playerId));
    else if (this.phase === PHASE.COMBAT) {
      const f = this.fields.find((x) => x && x.kind === 'normal' && Array.isArray(x.players) && x.players.includes(ps.playerId));
      if (f && f.cc) n = f.done && f.result ? counted(f.result.perPlayer && f.result.perPlayer[ps.playerId]) : Number(f.progress && f.progress.leaks) || 0;
      else if (f && f.battle) { try { n = battleProgress(f.battle).leaks; } catch { n = 0; } }
    }
    const loss = Math.min(this.gd.lpCapPerRound, Math.max(0, Math.trunc(Number(n) || 0)));
    return loss > 0 ? { pendingLp: loss } : {};
  }

  /** nextEnemies preview for m.private. */
  nextEnemiesFor(ps) {
    if (!ps.alive) return [];
    if (this.bossWaves) {
      const g = this.bossGroupOf(ps);
      if (!g) return [];
      return previewOf([...g.wave.spawns, ...bountySpawns(this.gd, this.round, g.wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: g.side })]);
    }
    if (!this.wave) return [];
    const bounty = bountySpawns(this.gd, this.round, this.wave, ps.bounties, ps.playerId, { solo: this.isSolo });
    return previewOf([...this.wave.spawns, ...bounty]);
  }

  /** A 自选 piece's pick (like the sim's UnitInfo.diy): a scout's card composes the operator from it (shared/diy.js). */
  _diyInfo(ps, piece) {
    const p = piece.kind === 'chess' && typeof ps.diyPickOf === 'function' ? ps.diyPickOf(piece.id) : null;
    return p ? { charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId } : undefined;
  }

  /** UnitInfo of a player's board pieces on their (board) tiles — a prep scout's board, the boss partner's (bossMateView).
   *  `area: 'board'` (a bench unit says 'hand' / 'temp': prepFieldMeta). */
  _prepBoardUnits(ps) {
    const units = [];
    // the player's own view of the data (0.2.0 自选编队: its slotted DIY slots are its operators — player/diy.js)
    const gd = ps.gd || this.gd;
    for (const { r, c, piece } of boardOrder(ps.board)) {
      const chess = piece.kind === 'token' ? null : gd.chess(piece.id);
      // 0.2.0 补位: a chess this player fields as its stand-in is deployed with the stand-in's body — name, art, max HP,
      // skill, like the sim's UnitInfo (`standInFor` = the replaced operator's charId)
      const rec = piece.kind === 'token' ? gd.token(piece.id) : ps.fieldRecord(chess);
      const assets = (rec && rec.assets) || {};
      // DESIGN §16: the skill / module THIS player's operator fights with (the scout's detail card shows it, like the
      // sim's UnitInfo in a shared field); moduleId only for an elite; 0.2.2 its potential (below 6) and 练度
      const lo = piece.kind === 'chess' && chess ? ps.loadoutFor(chess) : null;
      units.push({
        id: piece.uid, uid: piece.uid, kind: piece.kind === 'token' ? 'token' : 'op', side: 'ally', ownerId: ps.playerId, defId: piece.id,
        area: 'board',
        name: rec ? rec.name : piece.id, tier: rec && Number.isInteger(rec.tier) ? rec.tier : 1, golden: !!(rec && rec.isGolden),
        spine: assets.spine || (rec && rec.charId) || piece.id, avatar: assets.avatar || (rec && rec.charId) || piece.id,
        x: c, y: r, dir: pieceDir(piece), facing: pieceDir(piece) === 'LEFT' ? -1 : 1, maxHp: rec && rec.stats && Number.isFinite(rec.stats.maxHp) ? rec.stats.maxHp : 1,
        skillIndex: lo && Number.isInteger(lo.skillIndex) ? lo.skillIndex : undefined,
        moduleId: lo && typeof lo.moduleId === 'string' ? lo.moduleId : undefined,
        // the equipped items (like the sim's UnitInfo): a 变形同构体 wearer shows as a member of the bond it grants
        items: piece.kind === 'chess' && Array.isArray(piece.items) && piece.items.length ? piece.items.map((it) => it.id) : undefined,
        standInFor: rec && rec.standInFor ? rec.standInFor : undefined,
        diy: this._diyInfo(ps, piece),
        ...cultivationInfo(lo),
      });
    }
    return units;
  }

  /**
   * A boss round's prep (最终攻势 / 隐秘核心: the pairing planned, no field up yet): the other player of `ps`'s pair as
   * { mate: PlayerState, side: its half 'L' | 'R' }, else null (a lone player, any other phase).
   */
  _bossMateOf(ps) {
    if (!ps || !this.bossWaves || this.fields.length) return null;
    const g = this.bossGroupOf(ps);
    const pid = g && g.players.length > 1 ? g.players.find((x) => x !== ps.playerId) : null;
    const mate = pid ? this.players.get(pid) : null;
    return mate ? { mate, side: g.side === 'R' ? 'L' : 'R' } : null;
  }

  /**
   * m.private `bossMate` (community report of 2026-10-06, item 51): in a boss round's prep the partner's board on its
   * half of the boss field, as the battle will place it (bossFieldPlacement: the right half mirrored, RIGHT ↔ LEFT) — the
   * own prep view draws it beside the own half, read-only, as the official prep shows both players of a pair together
   * (the official client knows every board: ChangePositionDn { boardStatus }, research 09). Null otherwise.
   * @returns {{ playerId: string, side: 'L'|'R', units: object[] } | null}
   */
  bossMateView(ps) {
    const m = ps && ps.alive ? this._bossMateOf(ps) : null;
    if (!m) return null;
    return { playerId: m.mate.playerId, side: m.side, units: this._prepBoardUnits(m.mate).map((u) => this._onBossHalf(u, m.side)) };
  }

  /** UnitInfo list of a player's board and hand (prep scouting): board pieces on their tiles, held pieces on the
   *   hand row (row 7) — the scout renders like the own prep bench. */
  prepFieldMeta(ps) {
    const units = this._prepBoardUnits(ps);
    const gd = ps.gd || this.gd;
    // the hand (整备区) and the 临时整备区 scout exactly like the own prep bench renders them: pieces as units on
    // their rows (hand row 7, col = hand slot; temp row 8, cols 4..8 = temp slots; no dir — bench pieces face right),
    // items included (the client draws their floating plates). PRTS 帮助 counts the temp area with the hand (review of
    // PR #129). Part of the meta for every watcher alike — the spectator seat's copy equals a teammate's
    // (test/match/spectator.test.js). User playtest #2 item 1 (GitHub #44).
    // (a held chess the player fields as its stand-in is the stand-in there too — name, art, max HP — and carries
    // `standInFor`, like a board piece: the owner's recall of the official mode, 2026-10-06, the hand shows the stand-in)
    // Each unit says where it waits (`area` 'hand' | 'temp'; a board unit 'board'): the bond popup of a watched player
    // counts it like the player's own (ui/watchBonds.js ownerBoard — a hand operator is owned and counts for 投资人 远见
    // 奇迹, a temp one counts for nothing; GitHub #385, PR #387). The tag survives the boss-half remap (_onBossHalf), the
    // row does not.
    const benchUnit = (piece, i, y, area) => {
      const rec = piece.kind === 'item' ? gd.item(piece.id) : piece.kind === 'token' ? gd.token(piece.id) : gd.chess(piece.id);
      const standIn = piece.kind === 'chess' && rec && ps.fieldsStandIn(rec) ? this.gd.standIn(rec.chessId) : null;
      const body = standIn || rec;
      const assets = (body && body.assets) || {};
      const lo = piece.kind === 'chess' && rec ? ps.loadoutFor(rec) : null;
      units.push({
        id: piece.uid, uid: piece.uid, kind: piece.kind === 'token' ? 'token' : piece.kind === 'item' ? 'item' : 'op',
        side: 'ally', ownerId: ps.playerId, defId: piece.id, area,
        name: body ? body.name : piece.id, tier: rec && Number.isInteger(rec.tier) ? rec.tier : 1, golden: !!(rec && rec.isGolden),
        spine: assets.spine || (body && body.charId) || piece.id, avatar: assets.avatar || (body && body.charId) || piece.id,
        x: i, y, maxHp: body && body.stats && Number.isFinite(body.stats.maxHp) ? body.stats.maxHp : 1,
        skillIndex: lo && Number.isInteger(lo.skillIndex) ? lo.skillIndex : undefined,
        moduleId: lo && typeof lo.moduleId === 'string' ? lo.moduleId : undefined,
        items: piece.kind === 'chess' && Array.isArray(piece.items) && piece.items.length ? piece.items.map((it) => it.id) : undefined,
        standInFor: standIn && standIn.standInFor ? standIn.standInFor : undefined,
        diy: this._diyInfo(ps, piece),
        ...cultivationInfo(lo),
      });
    };
    for (let i = 0; i < ps.hand.length; i++) {
      if (ps.hand[i]) benchUnit(ps.hand[i], i, GEO.HAND_ROW, 'hand');
    }
    for (let i = 0; i < ps.temp.length; i++) {
      if (ps.temp[i]) benchUnit(ps.temp[i], GEO.TEMP_C0 + i, GEO.TEMP_ROW, 'temp');
    }
    // `nextEnemies`: the scouted player's coming enemies — their preview pen shows on the scouting board too (research 09
    // §2.2 "Teammates"; render/app.js enterBattle({ prep: true, nextEnemies }))
    let nextEnemies = [];
    try { nextEnemies = this.nextEnemiesFor(ps); } catch (e) { this.reportError('nextEnemies', e); }
    // the scouted player's effects column (策略 / 机变 / 悬赏 …), display-ready (user playtest #2: while scouting, the
    // right column shows the watched player's effects, not one's own)
    const meta = { t: 'm.field', fieldId: `n:${ps.playerId}`, kind: 'normal', rect: { ...GEO.NORMAL_RECT }, stageId: this.stageId, units, effects: ps.effectsView(), prep: true, nextEnemies };
    // 最终攻势 / 隐秘核心 prep: the pieces stand on the player's half of the boss field — the scout shows them there (rows
    // − 7, the right half mirrored with RIGHT ↔ LEFT: finalAssault.js bossFieldPlacement, as the own prep view), with the
    // round's leader at its spawn tile (nextEnemies `start`), framed by the boss-field prep camera of the player's side
    // (`side`). Until 0.2.0 an eliminated player or a spectator seat scouting a player then saw the normal board and no
    // leader at all (community report of 2026-10-06, item 55).
    // The pair's other player stands on the other half (item 51: both players of a pair together, as in the battle).
    const g = this.fields.length ? null : this.bossGroupOf(ps);
    if (!g) return meta;
    const mate = this.bossMateView(ps);
    const own = units.map((u) => this._onBossHalf(u, g.side));
    return { ...meta, kind: 'boss', rect: { ...GEO.BOSS_RECT }, side: g.side, units: mate ? [...own, ...mate.units] : own, ...(mate ? { mate: { playerId: mate.playerId, side: mate.side } } : {}) };
  }

  /** A prep UnitInfo (board, bench or temp row) placed on side 'L' | 'R' of the boss field (bossFieldPlacement). */
  _onBossHalf(u, side) {
    const p = bossFieldPlacement(side, u.y, u.x, u.dir || 'RIGHT');
    const v = { ...u, x: p.col, y: p.row };
    // a board piece keeps facing the same way relative to the leader (mirrored on the right half); a bench piece has no
    // stored facing (it faces right, as the own prep bench draws it)
    if (u.dir) { v.dir = p.dir; v.facing = p.dir === 'LEFT' ? -1 : 1; }
    return v;
  }
}
