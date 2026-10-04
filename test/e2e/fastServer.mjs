// E2E helper: the real server (server/index.js startServer) with the real match engine, but with scaled phase timers
// and a faster combat clock so a browser run can reach the RESULT screen in a few minutes.
//   PORT=… SP_TIMER_SCALE=0.25 SP_COMBAT_SPEED=16 node test/e2e/fastServer.mjs
// Test hook (never used by the real server): SP_START_ROUND = 'boss' | 'hidden' | <round> makes the first round of
// every match that round instead of round 1, and hands every human a starter kit (SP_START_KIT operators: tier-1..3
// visible chess, melee and ranged alternating, into the hand; default 4) plus 20 funds — so a browser test reaches
// the Final Assault / Hidden Core prep at once (test/ui/bossPrep.e2e.test.js).
// SP_START_CHESS=<chessId,…>: the starter kit is exactly these chess (normal or elite ids) instead of the tier-1..3 picks
// (test/ui/loadout-battle.e2e.test.js: a known elite whose chosen skill / module the battle must use).
// SP_IDLE_BOTS=1: AI seats only ready up (no shop, no board) — test/ui/playtest2.real.e2e.test.js observes their battles.
// SP_START_ITEMS=<itemId,…>: the starter kit also puts these items into the hand (test/ui/leftovers.e2e.test.js: three
// distinct equipment items → the equip-replace dialog).
// SP_START_SHOP=<chessId,…>: the starter kit also stocks the first shop slots with these chess at their normal price
// (test/ui/playtest6-elite.e2e.test.js: the copy that completes a merge).
// SP_START_KITS=<JSON [[chessId,…], …]>: per-human starter kits in seat order, overriding SP_START_CHESS for the humans
// listed ([] = no operators: a leaker without a board — test/ui/watch-bonds.e2e.test.js, 联防).
// SP_BOT_CHESS=<chessId,…>: AI seats get these chess too (kept with SP_IDLE_BOTS). SP_AUTO_PLACE=1: the first prep after
// the jump puts every player's hand operators on the board (the bots' layout planner: tiles and facings; no drag & drop)
// — except a human whose SP_START_KITS entry is [] (operators a band hands out at that prep, e.g. 老鲤's two, stay in
// the hand: the seat keeps no board and leaks).
// SP_ELIMINATE=<humanIdx,…>: those humans (seat order) are eliminated at the jump, before the round's boss pairing — an
// eliminated spectator from the first round on (test/ui/watch-bonds.e2e.test.js, the Final Assault).
// SP_STAGE=<stageId>: every match is played on this stage instead of the drawn one (test/ui/feedback1-placement.e2e.test.js:
// 战场#08's pool).
// Not a test file (node --test runs it as a no-op module when NODE_TEST_CONTEXT is set).

import { startServer } from '../../server/index.js';
import { Match } from '../../server/match/Match.js';
import { legalTiles, placeClass, tileKey } from '../../server/match/board.js';
import { planLayout } from '../../server/match/bot.js';

if (!process.env.NODE_TEST_CONTEXT) {
  const timerScale = Number(process.env.SP_TIMER_SCALE) || 1;
  const combatSpeed = Number(process.env.SP_COMBAT_SPEED) || 2;
  const startAt = String(process.env.SP_START_ROUND || '').trim();
  const kitSize = Math.max(0, Math.min(8, Number(process.env.SP_START_KIT ?? 4) || 0));
  // test hook: AI seats buy and place nothing (they only ready up) — their battles are pure leaks, i.e. they last the
  // enemies' whole walk, so a human's quick battle ends first and the human can observe a still running AI field
  const idleBots = process.env.SP_IDLE_BOTS === '1';
  const kitIds = String(process.env.SP_START_CHESS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const kitItems = String(process.env.SP_START_ITEMS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const kitShop = String(process.env.SP_START_SHOP || '').split(',').map((x) => x.trim()).filter(Boolean);
  let humanKits = [];
  try { humanKits = JSON.parse(process.env.SP_START_KITS || '[]'); } catch { humanKits = []; }
  const botChess = String(process.env.SP_BOT_CHESS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const autoPlace = process.env.SP_AUTO_PLACE === '1';
  const eliminate = String(process.env.SP_ELIMINATE || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  const forcedStage = String(process.env.SP_STAGE || '').trim();

  class FastMatch extends Match {
    constructor(opts) {
      super({ ...opts, timerScale, combatSpeed });
      this._jumped = !startAt;
      this._placeRound = null;
      if (forcedStage && this.gd.stage(forcedStage)) {
        this.stageId = forcedStage;
        this.stage = this.gd.stage(forcedStage);
        for (const ps of this.players.values()) ps.invalidateDeployMap();
      }
    }

    startRound(r) {
      if (this._jumped) { super.startRound(r); return; }
      this._jumped = true;
      const target = startAt === 'boss' ? this.gd.bossRound : startAt === 'hidden' ? (this.gd.hiddenRound || this.gd.bossRound) : Number(startAt);
      const humans = this.order.filter((ps) => !ps.isBot);
      for (const i of eliminate) {
        const ps = humans[i];
        if (ps && ps.alive) { ps.lp = 0; ps.eliminate(r); ps.dirty(); }
      }
      super.startRound(Number.isInteger(target) && target > r ? target : r);
      humans.forEach((ps, i) => { if (ps.alive) this._starterKit(ps, Array.isArray(humanKits[i]) ? humanKits[i] : null); });
      if (botChess.length) for (const ps of this.alivePlayers()) if (ps.isBot) { this._give(ps, botChess); ps.recompute(); }
      if (autoPlace) this._placeRound = this.round;
    }

    /** Chess ids into the hand's free slots (copies taken from the pool when it has them). */
    _give(ps, ids) {
      for (const id of ids) {
        const rec = this.data.chess?.[id];
        const slot = ps.hand.findIndex((x) => x == null);
        if (!rec || slot < 0) continue;
        try { ps.hand[slot] = ps.newPiece('chess', id, { poolCopies: this.pool.take(this.gd.baseIdOf(id), rec.isGolden ? this.gd.goldenCopies : 1) }); } catch { /* best effort */ }
      }
    }

    enterPrep() {
      super.enterPrep();
      if (this._placeRound == null || this.round !== this._placeRound) return;
      this._placeRound = null;
      // every player's hand operators onto the field they deploy on: the bots' layout planner (bot.js planLayout —
      // tiles and facings), any piece it leaves out on the first free legal tile
      const humans = this.order.filter((x) => !x.isBot);
      for (const ps of this.alivePlayers()) {
        const kit = ps.isBot ? null : humanKits[humans.indexOf(ps)];
        if (Array.isArray(kit) && kit.length === 0) continue; // "no operators": a band's gift stays in the hand
        const pieces = ps.hand.filter((p) => p && p.kind === 'chess');
        let plan = null;
        try { plan = planLayout(this, ps, pieces); } catch { plan = null; }
        for (const piece of pieces) {
          const key = plan && plan.get(piece.uid);
          if (key) {
            const [row, col] = key.split(',').map(Number);
            const res = ps.move(piece.uid, { area: 'board', row, col }, plan.dirs.get(piece.uid) || 'RIGHT');
            if (!res || !res.error) continue;
          }
          for (const [row, col] of legalTiles(ps.deployMap(), placeClass(ps, this.gd.chess(piece.id)))) {
            if (ps.board.has(tileKey(row, col))) continue;
            const res = ps.move(piece.uid, { area: 'board', row, col }, 'RIGHT');
            if (!res || !res.error) break;
          }
        }
        ps.recompute();
        ps.dirty();
      }
      this.markPublic();
    }

    scheduleBotPrep(ps, i = 0) {
      if (!idleBots) { super.scheduleBotPrep(ps, i); return; }
      const round = this.round;
      this.later(this.scaled(400 + i * 100), () => {
        if (this.phase !== 'PREP' || this.round !== round || !ps.alive || ps.ready || !ps.botControlled) return;
        ps.resolveTemp();
        ps.setReady(true);
      });
    }

    /** A few cheap operators in the hand + funds (a test hook: the rounds before were skipped). `own`: this human's kit. */
    _starterKit(ps, own = null) {
      const ids = own || kitIds;
      const all = Object.values(this.data.chess || {}).filter((c) => c && c.visible && !c.isGolden && c.tier <= 3)
        .sort((a, b) => (a.tier - b.tier) || String(a.chessId).localeCompare(String(b.chessId)));
      const melee = all.filter((c) => c.position === 'MELEE');
      const ranged = all.filter((c) => c.position !== 'MELEE');
      const picks = ids.map((id) => this.data.chess?.[id]).filter(Boolean);
      for (let i = 0; !own && !kitIds.length && picks.length < kitSize && (melee[i] || ranged[i]); i++) {
        if (melee[i]) picks.push(melee[i]);
        if (ranged[i] && picks.length < kitSize) picks.push(ranged[i]);
      }
      for (const rec of picks) {
        const slot = ps.hand.findIndex((x) => x == null);
        if (slot < 0) break;
        try {
          const taken = this.pool.take(this.gd.baseIdOf(rec.chessId), rec.isGolden ? this.gd.goldenCopies : 1);
          if (!taken && !ids.length) continue; // an explicit SP_START_CHESS piece is handed out even when this match bans it
          ps.hand[slot] = ps.newPiece('chess', rec.chessId, { poolCopies: taken });
        } catch { /* keep going: the kit is best effort */ }
      }
      for (const itemId of kitItems) {
        const slot = ps.hand.findIndex((x) => x == null);
        if (slot < 0 || !this.gd.item(itemId)) continue;
        try { ps.hand[slot] = ps.newPiece('item', itemId); } catch { /* best effort */ }
      }
      kitShop.forEach((id, i) => {
        if (i < ps.shop.slots.length && this.gd.chess(id)) ps.shop.slots[i] = { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false };
      });
      ps.addFunds(20, { reason: 'income' });
      ps.recompute();
    }
  }

  const srv = await startServer({ port: Number(process.env.PORT) || 0, host: process.env.HOST || '127.0.0.1', quiet: true, MatchClass: FastMatch });
  console.log(`fast server on ${srv.url} (timers ×${timerScale}, combat ${combatSpeed}×${startAt ? `, first round ${startAt}` : ''})`);
  const stop = () => { srv.close().finally(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
