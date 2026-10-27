// Static, server-owned equipment progress. Keep zero visible; a catalog item has no live counter.
export function progressLabel(progress) {
  return Number.isInteger(progress?.current) && progress.current >= 0 && Number.isInteger(progress.total) && progress.total > 0
    ? `${progress.current} / ${progress.total}` : '';
}

export function pieceItemProgress(piece) {
  return (piece?.items || []).flatMap(it => progressLabel(it.progress) ? [{ uid: it.uid, id: it.id, ...it.progress }] : []);
}
