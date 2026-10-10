// Pure in-match UI logic (no DOM, no Preact) — unit-tested in Node (test/ui/*.test.js).
//
// Placement legality (`canPlace`) mirrors the server rules of DESIGN §3/§6.2 so the render view can
// light legal tiles while dragging; the server stays authoritative and may still refuse a move.
//
//   Board = own normal field (GEO.FIELD rows 9–12, cols 2–10). Melee chess stand on `melee` deploy tiles
//   (LOW, buildable ALL/MELEE) — a melee chess whose trait reads 「可以放置于远程位」 (shared/highGround.js: 歌蕾蒂娅, 崖心,
//   见行者, any module) on any deploy tile, the 高台 included (piecePosition 'ALL'); ranged chess on `melee ∪ rangedOnly` (stages.json → deployTiles.normal,
//   derived from the tile legend when missing — the legend's `buildable` is the effective type: 深水区 tile_deepsea
//   refuses deployment, PRTS 深水区 地形信息 "拒绝部署（待补充）", player report #3 after 0.1.0). Tokens follow their
//   own `position`; a summon whose text reads "只能部署在召唤者攻击范围内" (tokens.json `ownerRange`: 伺夜's 狼群,
//   缪尔赛思's 流形) also needs a tile of its owner's attack range (`summonRange`, player report #9). In the prep of a
//   boss round (最终攻势 / 隐秘核心) the tiles are the player's half of the boss field (`deployFieldOf`: 'bossL' /
//   mirrored 'bossR', board (r, c) = stage tile (r − 7, c) / (r − 7, 20 − c)) like the server's deploy map
//   (server/match/board.js field; user playtest #5 item 7) — board coordinates stay the same.
//   Hand = 10 slots (index = col). Temp slots are server-filled only (no move target).
//   Dropping onto an occupied tile/slot swaps (both pieces must be legal at their new spots);
//   an EQUIP item dropped onto a chess piece equips it (tokens can't carry items); an Arts (MAGIC) item
//   dropped on a field tile is used there (g.art). Deploy cap counts chess pieces on the board only
//   (summons don't use a slot, research 00 §8 #11). Only PREP, alive and not-ready players may edit.
//   A board piece dropped on its own tile is legal ('orient'): the direction wheel re-orients it in place
//   (research 09 §1.2); board drops of units go through the wheel before g.move {uid, to, dir} (ui/facing.js).
//
// The bodies live in public/js/ui/gameLogic/*.js. Every name this file exported before the split is
// re-exported below, so existing imports keep working.

export { clamp, tileKey } from './gameLogic/shared.js';
export { phaseMode, isCombatPhase, showDeadPill, isBossPhase } from './gameLogic/phases.js';
export { prepCamera, prepCameraFor, foldCamera, deployFieldOf, fieldTile, boardTileOf, ownerBandId, teamFrameIds } from './gameLogic/camera.js';
export { phaseBanner, prepCapsuleLabel, countdownState, phaseTotalSeconds } from './gameLogic/phases.js';
export { RESULT_BOX_MS, ownRoundLoss, battleOverSfx, roundResultBox, uniteResultBox, battleResultBox } from './gameLogic/phases.js';
export { STATUS_META } from './gameLogic/format.js';
export { sortedPlayers } from './gameLogic/shared.js';
export { ownFieldId, homeFieldId, cycleField, watchTarget, switcherLabel, fieldLabel, activeBubbles } from './gameLogic/watch.js';
export { sortBonds, bondTier, nextThreshold, grantedBonds, pieceBondIds, morphPairings, HARMONY_BOND, harmonyMembers, bondMembers, memberHeadCount, bannedPerBond, disabledBondSets, briefingBondTip, modeOffBonds, bandOffBonds, bandOffLine } from './gameLogic/bonds.js';
export { priceTone, mergeProgress, mergeTarget, handFull, completesMerge, offerHeader, shopBlockReason, readyFundsPrompt, readyShopFold } from './gameLogic/shop.js';
export { deploySets, stageOverrides, deployMap, effectiveStage, indexPieces, placementContext, piecePosition, tileAllows, summonRange, summonExcluded, canPlace, equipReplaces, equipMerges, boardTargets, dropIntent, dropFailureReason } from './gameLogic/placement.js';
export { terrainInfo, deviceInfo, deviceTipAt, noteDeviceUnits } from './gameLogic/terrain.js';
export { normalizeDraft, normalizeSp, normalizePersonalChoice } from './gameLogic/draft.js';
export { groupEnemies, PEN, penZoneTiles, penPlacement, previewEnemyKey, factionTypes } from './gameLogic/enemies.js';
export { snapHud, bossFrac, bossPctText, hasFlag, UF, attackInterval, fmtNum, rangeGridBox } from './gameLogic/format.js';
export { shortcutFor, closesOnFieldPress, shortcutBlocked, HOTKEY_ACTIONS, DEFAULT_HOTKEYS, isBindableCode, hotkeyLabel, sanitizeHotkeys, rebindHotkey, isDefaultHotkeys, hotkeyOf, actionForKey, captureHotkey, facingSwallows, facingEnter } from './gameLogic/shortcuts.js';
export { DEFAULT_SETTINGS, VOICE_LANGS, TEXT_SIZES, sanitizeSettings } from './gameLogic/settings.js';
export { normalizeResult } from './gameLogic/result.js';
export { chessLoadout, unitLoadout, unitCultivation } from './gameLogic/loadout.js';
export { standInIds, fieldsStandIn, standInOf, ownStandIn, cardStandIn, memberStandIn, standInGetter, standInLoadout, deployedRecord, deployedModuleId, standInLabel, standInForText, standInTip } from './gameLogic/standIn.js';
export { diyPicks, ownDiyPick, diyRecordFor, ownDiyRecord, cardDiy, unitPick, diyGetter, pickGetter, isDiyRecord, diyBannedPieces } from './gameLogic/diy.js';
export { panelSide, panelSlots, PANEL_RIGHT_GAP, PANEL_RIGHT_BOTTOM, PANEL_RIGHT_BOTTOM_SHOP, BPOP, bondPopupPlace } from './gameLogic/panel.js';
