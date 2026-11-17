// screens/game/range.js — the attack range the open detail card's unit draws on the field (GitHub PR #281 by
// @IceCodeNew; the field-detail range idea after @BBleae's fork): see game.js cardRange.
import { attackRangeGrid } from '../../../../shared/loadoutRecord.js';
import { chessLoadout, standInLoadout } from '../../ui/gameLogic.js';
import { tokenVariantFor } from '../../ui/gameLogic/loadout.js';
import { isHealingRange } from '../../ui/rangeStyle.js';
import { normDir } from '../../ui/facing.js';

/** Resolve the inspected field unit without granting placement or sale actions. */
export function inspectRange({ target, detail, pieces, showPrep = false, field, snapshot, live, loadout, getChess, backups }) {
  if (!detail || (detail.type !== 'chess' && detail.type !== 'token')) return null;
  let row, col, dir;
  if (target?.kind === 'piece' && showPrep) {
    const e = pieces?.get(target.uid);
    if (!e || e.area !== 'board') return null;
    row = e.row; col = e.col; dir = normDir(e.piece.dir);
  } else if (target?.kind === 'unit' && (!showPrep || target.prepMapChar === true)) {
    const unit = target.unit;
    if (!unit || unit.side !== 'ally' || (unit.kind !== 'op' && unit.kind !== 'token')) return null;
    if (unit.area != null && unit.area !== 'board') return null;
    // A prepared map character is a read-only view, not a simulated unit yet. Its board-space coordinates come from
    // m.private.prepMapChars and must not be read from a previous battle's snapshot or transformed twice on boss R.
    if (showPrep && (unit.kind !== 'token' || detail.type !== 'token' || detail.token?.kind !== 'mapChar')) return null;
    // Snapshots exclude undeployed, hidden and removed units. Dead units remain briefly for their death animation.
    if (!showPrep && !field?.prep && (!snapshot || snapshot[3] <= 0)) return null;
    row = Math.round(!showPrep && snapshot ? snapshot[2] : unit.y);
    col = Math.round(!showPrep && snapshot ? snapshot[1] : unit.x);
    dir = (!showPrep && normDir(live?.dir, null)) || normDir(unit.dir, null) || (unit.facing === -1 ? 'LEFT' : 'RIGHT');
  } else return null;
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  const record = detail.type === 'token' ? { ...detail.token, ...tokenVariantFor(detail.token, detail.ownerId) }
    : detail.standIn ? standInLoadout(detail.standIn, getChess, backups)?.record || detail.standIn
    : chessLoadout(detail.chess, detail.diy ? null : loadout, getChess)?.record || detail.chess;
  const grid = Array.isArray(live?.range) ? live.range : attackRangeGrid(record);
  return grid?.length ? { grid, row, col, dir, healing: isHealingRange(record) } : null;
}
