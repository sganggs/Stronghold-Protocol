import { attackRangeGrid } from '../../../../shared/loadoutRecord.js';
import { chessLoadout, standInLoadout } from '../../ui/gameLogic.js';
import { tokenVariantFor } from '../../ui/gameLogic/loadout.js';
import { normDir } from '../../ui/facing.js';

/** Resolve the inspected field unit without granting placement or sale actions. */
export function inspectRange({ target, detail, pieces, showPrep = false, field, snapshot, live, loadout, getChess, backups }) {
  if (!detail || (detail.type !== 'chess' && detail.type !== 'token')) return null;
  let row, col, dir;
  if (target?.kind === 'piece' && showPrep) {
    const e = pieces?.get(target.uid);
    if (!e || e.area !== 'board') return null;
    row = e.row; col = e.col; dir = normDir(e.piece.dir);
  } else if (target?.kind === 'unit' && !showPrep) {
    const unit = target.unit;
    if (!unit || unit.side !== 'ally' || (unit.kind !== 'op' && unit.kind !== 'token')) return null;
    if (unit.area != null && unit.area !== 'board') return null;
    // Snapshots exclude undeployed, hidden and removed units. Dead units remain briefly for their death animation.
    if (!field?.prep && (!snapshot || snapshot[3] <= 0)) return null;
    row = Math.round(snapshot ? snapshot[2] : unit.y);
    col = Math.round(snapshot ? snapshot[1] : unit.x);
    dir = normDir(live?.dir, null) || normDir(unit.dir, null) || (unit.facing === -1 ? 'LEFT' : 'RIGHT');
  } else return null;
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  const record = detail.type === 'token' ? { ...detail.token, ...tokenVariantFor(detail.token, detail.ownerId) }
    : detail.standIn ? standInLoadout(detail.standIn, getChess, backups)?.record || detail.standIn
    : chessLoadout(detail.chess, detail.diy ? null : loadout, getChess)?.record || detail.chess;
  const grid = Array.isArray(live?.range) ? live.range : attackRangeGrid(record);
  return grid?.length ? { grid, row, col, dir } : null;
}
