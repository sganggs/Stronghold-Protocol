const RUNTIME_ID = /^diy_(char_[A-Za-z0-9_]+)_([56])_([12])_([0-3])_([ab])$/;
const SLOT_ID = /^chess_char_([56])_diy([12])_([ab])$/;

export function attachCustomSlots(chess, catalog) {
  if (!chess || !catalog || !Object.keys(catalog).length) return chess;
  const out = { ...chess };
  for (const [id, rec] of Object.entries(chess)) {
    if (rec?.isDiy && SLOT_ID.test(id)) out[id] = { ...rec, customCandidates: catalog };
  }
  return out;
}

/** A loadout preview keeps the official slot id; the battle uses a seat-specific id. */
export function customChoiceRecord(slot, entry) {
  if (!slot?.isDiy || !entry?.charId || !slot.customCandidates) return slot;
  const match = SLOT_ID.exec(slot.chessId);
  const candidate = Object.hasOwn(slot.customCandidates, entry.charId) ? slot.customCandidates[entry.charId] : null;
  const rec = match && candidate?.variants?.[`${match[1]}_${match[3]}`];
  if (!rec) return slot;
  return { ...rec, chessId: slot.chessId, baseId: slot.baseId, goldenId: slot.goldenId,
    upgradeChessId: slot.upgradeChessId, identifier: slot.identifier, shopSortId: slot.shopSortId,
    customCandidates: slot.customCandidates, customSlot: slot.baseId || slot.chessId,
    isDiy: true, visible: true };
}

export function customRuntimeId(slotId, charId, seat, golden = false) {
  const match = SLOT_ID.exec(slotId);
  if (!match || !Number.isInteger(seat) || seat < 0 || seat > 3) return null;
  return `diy_${charId}_${match[1]}_${match[2]}_${seat}_${golden ? 'b' : 'a'}`;
}

export function resolveCustomRecord(id, chess, catalog) {
  const match = typeof id === 'string' && RUNTIME_ID.exec(id);
  if (!match || !catalog || !Object.hasOwn(catalog, match[1])) return null;
  const [, charId, tier, number, seat, suffix] = match;
  const slotId = `chess_char_${tier}_diy${number}_a`;
  const slot = chess?.[`chess_char_${tier}_diy${number}_${suffix}`];
  const rec = catalog[charId]?.variants?.[`${tier}_${suffix}`];
  if (!slot?.isDiy || !rec) return null;
  const baseId = customRuntimeId(slotId, charId, Number(seat));
  const goldenId = customRuntimeId(slotId, charId, Number(seat), true);
  return { ...rec, chessId: id, baseId, goldenId, upgradeChessId: suffix === 'a' ? goldenId : null,
    identifier: slot.identifier, shopSortId: slot.shopSortId, customSlot: slotId, customSeat: Number(seat),
    isDiy: true, visible: true };
}

export function matchCustomRecords(data, seats) {
  const catalog = data?.['custom-operators'];
  const chess = data?.chess;
  if (!catalog || !chess) return data;
  const out = attachCustomSlots(chess, catalog);
  let changed = false;
  for (const seat of seats || []) {
    if (seat.isBot) continue;
    for (const [slotId, entry] of Object.entries(seat.loadout || {})) {
      if (!chess[slotId]?.isDiy || !entry?.charId) continue;
      for (const golden of [false, true]) {
        const id = customRuntimeId(slotId, entry.charId, seat.seat, golden);
        const rec = resolveCustomRecord(id, chess, catalog);
        if (!rec) continue;
        out[id] = { ...rec, customOwner: seat.playerId };
        changed = true;
      }
    }
  }
  return changed ? { ...data, chess: out } : data;
}

export function ownsCustomRecord(rec, playerId) {
  return !rec?.isDiy || rec.customOwner === playerId;
}
