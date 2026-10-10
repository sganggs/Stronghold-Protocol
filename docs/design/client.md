# DESIGN §9, §10, §13, §15 — Rendering, UI, local-client art, the 3D board

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 9. Client rendering contract (public/js/render)

`import { createFieldView } from './render/app.js'`

```js
const view = await createFieldView(canvasHost /* HTMLElement */, { data, assets, audio })
view.setStage(stage)                         // draw tiles (procedural), devices
view.setCamera(kind /* 'prep'|'normal'|'unite'|'boss' */, { rect, side, shop })  // animates camera; shop: false = the
                                             //   folded shop's prep camera (official shop-collapsed framing, §21.27)
view.setPrep(privateState, { editable })     // render hand/temp/board pieces as chibis (spine or fallback); editable enables drag;
                                             //   a merge's new elite on the board plays fx.promote instead of fx.deploy (render/promote.js, §20.11),
                                             //   also after a battle (a merge between two preps: the last prep state is kept, §20.14)
view.enterBattle(fieldMeta)                  // switch to battle rendering for m.field
view.pushSnapshot(snap) ; view.pushEvents(ev)   // interpolated rendering (100 ms buffer)
view.highlightTiles(tiles, style)            // legal/illegal placement, range preview
view.on('pieceDragStart'|'pieceDrop'|'pieceDragEnd'|'pieceClick'|'pieceHover'|'tileHover', fn)
   // pieceDrop: { uid, target: {area:'board',row,col}|{area:'hand',idx}|{area:'outside', clientX, clientY} }
   // area 'outside' lets the DOM UI decide: released off the grid or over DOM covering the canvas (the shop bar), mouse
   //   and touch alike — there is no drag-to-sell, the piece goes back
   // the drop target, its highlight and tileHover while dragging = the tile under the POINTER; an item dropped on a
   //   tile equips the unit standing on it (§18.1); a dragged unit is drawn standing on that tile while it is a legal
   //   target — a board tile or a bench slot (render/drag.js dragStandTile), the official deploy drag — and held under
   //   the pointer elsewhere (DRAG_HOLD_TILES), an item plate on the pointer (§27.62)
view.pieceScreenRect(uid)                    // the drawn body's rect { left, top, right, bottom, width, height, x, y } (tooltips / overlays)
view.tileScreen(row, col)                    // { x, y, s, poly } client px of a tile top (direction wheel geometry)
view.holdPiece(uid, {row,col}|null)          // keep a dropped piece on a tile while its direction is chosen
view.setPieceDir(uid, dir)                   // show a prep piece facing UP|RIGHT|DOWN|LEFT (wheel preview / stored dir)
view.resize() ; view.destroy()
```

`createFieldView(host, { …, signal })` takes an `AbortSignal` (0.2.2, GitHub PR #302 by @siruimei07): an abort during the build — the Pixi load, the manifest, the fonts, the board art and the 3D board waits — destroys what the attempt made (the canvas, the ticker, the listeners, the observers) and rejects, a failure while it is built releases the same partial resources, and `view.destroy()` is idempotent. `ui/fieldHost.js mountFieldView(host, { signal })` aborts that signal when the engine fails, times out (12 s) or the owner unmounts, disposes a view a factory returns after that, and never clears the other children of `host` — the simplified view and a newer mount share it.

Visuals: oblique perspective board (tilted ~30°, trapezoid tiles), raised highland blocks with side faces, road/floor/forbidden styles per research 07 §7, pulsing red gates, blue objective, dashed hand pads. Units: Spine (Front/Back rule, feet anchored — flying units hover `FLY_HOVER` 1.3 tiles up, the client's 0.35 in character space, research 12, §25.13.5 — an enemy flyer from the road whatever tile it crosses (GitHub #277) —, shadow sprite on the ground), elite gold outline glow, tier chip, HP bar (green ally / red enemy), SP bar (skill ready glow; while an ammo skill runs it is the magazine instead — a yellow cell per round, emptying from the right, `b.snap ammo`, and the skill draws no standing aura, UnitInfo `ammoSkill`), 斩业星熊's 我执 pool as a red bar over her drained HP bar (`b.snap neg`), 伺夜's 狼群 count as a row of diamonds under the bars, the lit ones the 狼影 left (`b.snap wolves`; 0.2.2, GitHub PR #303 / #378 / #383), status icons, the element gauge row under the bars — icon + white bar of the remaining 元素值, element-coloured refill during a 爆发冷却 (§18.3, §20.8); enemies drawn × their official prefab factor (enemies.json `modelScale`, §20.4); an enemy's mode — the `form` of a sim fx (`shared/protocol.js fxForm`), or UnitInfo `form` for a view built later through `render/app/info.js renderInfo` — switches clip sets (`render/units.js FORMS`: 掠海漂移体 crawl, 暴鸰 bombed, 转译基底's forms, the 逐火 embers, the leaders' 重生, 守墓石像, the 孤岛风云 prisoners' warning and 解放; closing clips timed from the fx `dur`), a one-off cast (`PROJ[kind].once`) plays once, and a local-only model's web alias is tinted (`ALIAS_TINT`: 灼热 / 炽焰源石虫, §21.14); damage numbers (phys orange-white, arts purple, true white, heal green); projectiles drawn per kind, hit sparks and melee slashes, skill activation bursts and auras (§17.3); death fade for enemies, summons and devices — a knocked-out operator stays on its tile in its held Die pose under a redeploy ring (§18.3); leak flash at the objective. Fallback when Spine missing/failed: avatar in a rarity-coloured diamond with bob/lunge tweens — a failed or timed-out model is loaded again (bounded), and a view re-resolves its model and avatar when the asset manifest arrives late or the tab is shown again (§21.27). 60 fps target with ≤ 120 units (a crowd draws its Spine units through the cached atlas, `render/impostor.js`, each refreshed every k-th frame: the refresh turns follow this frame's update order — `ctx.impostorSlot()`, a counter reset at the start of every frame — so a frame refreshes ⌊n/k⌋ or ⌈n/k⌉ of n units instead of whatever random per-unit phases gave, and a unit not refreshed for 2k frames is refreshed regardless; GitHub PR #334 by @Cloudnyco, issue #327 step 1 — its step 2, a time budget by priority, is not done; a model whose pose cannot change — `SpineActor.poseHeld()`: a knocked-out operator in the held end of its Die clip, a frozen model — is neither re-posed nor redrawn, only its clock runs, until a new clip, a revive, a wind-up, a form's closing clip, a clipping switch or a zoom past the impostor's rescale threshold; the redeploy rings draw one shared rasterised label per number, `render/textures.js downLabel`, the same pixels as a Text of their own). Picking (which unit a press / hover / dropped item is on) and the drag target follow one rule, `render/pick.js` — the tile under the pointer (§18.1); the Spine store never hands out a skeleton whose unload is in flight (§17.1).

---

## 10. Client UI (screens & components)

Look & feel: research 06 §11–§12 (near-black green-grey panels, mint `#4ed8af` accents, gold prices, bracket frames, hexagon badges, bond discs, 7-segment countdown). Fonts: Noto Sans SC (Google Fonts with local fallback), Bender/Novecento self-hosted for numerals and Latin micro-labels.

Screens: **Title** (season art backdrop, 开始 → nickname), **Lobby** (独立模拟 / 同盟模拟 → create or join; recent rooms; a 设置 button left of 玩法说明 opens the title screen's settings dialog, GitHub #238), **Room** (4 seats, invite code + copy link, difficulty picker (host), the co-op 「AI 队友最后选择」 switch (host, off by default; read-only for the others), add/remove AI, ready, start; the same 设置 button), **Briefing** (INFO_CHECK: stage, factions, disabled bonds, banned chess, boss silhouette, ready x/4), **Band draft** (grid of 40 bands with icon/name/LP/effect; turn order list; skip; 查看禁用盟约与干员 under the order list opens the briefing's bond rows, legend and banned operators again in a read-only dialog — one component, `ui/matchInfo.js`, §21.28), **Game** (Pixi field + DOM HUD: top bar with round/phase capsule (the kill counter reads 已解决 / the round's own enemies: a leak counts, a split child or summon is in neither number, §14)/LP (live during the own battle, §17.5)/timer/ready, and beside the latency a 观战席 capsule (eye + count, a roster with the host's ✕) while the room has spectators (GitHub #120); bond strip + popups; left team panel with LP/status/emote bubbles, click to watch (a boss round frames the viewer's pair in green, §15); bottom shop bar (level card, 3–5 chess cards — a slot the upgrade just opened is a bare frame until the next refresh, GitHub #332 —, item card, funds, refresh, freeze, collapse; 准备就绪 folds it and cancelling unfolds it, GitHub #138); detail panel on click/hover (header with bonds, then 特质 — the operator's own effect — right under it, 特性, stats (live: the battle's own numbers / the start-of-battle ones in prep, §18.5), skill, module, equipped items, talents: §17.5); enemy preview drawer (next round enemies with counts, factions; its 本局信息 tab lists the briefing's disabled bonds and banned operators, §21.28); 机变 overlay (the official card: framed icon + name, the effect text — data `descRaw` — under it, the taker's round avatar at the top-right; two taps, §18.2, §20.7); merge reward overlay (the promotion reward, or a special offer — 凯瑟琳's 定向投放 … — as item / chess cards under its source's label, with the count of offers queued behind it, §21.2); phase banners; the round's result box at SETTLE (the official 「作战结束」 + 「全员无伤！」 / 「生命值减少 −N」 for the viewer's own LP — after a 联防 the server's charge, `m.public.uniteResult.losses` — with the matching BATTLEOVER sound; none in the boss rounds or for a viewer not in the round; GitHub #235, PR #112); ticker (by broadcast priority, highest first; a leader-damage line plays only in its round and a player's newer one replaces the older, §21.10); toasts; emote wheel; settings (volume, quality, show damage numbers)), **Result** (victory/defeat, rounds, per-player lineup, stats, titles, back to room).

盟约栏支持「收起／展开盟约」（GitHub #142）：收起时隐藏完整列表并关闭由列表打开的浮层，让原图标区域的指针事件到达棋盘，只保留至少 44×44 CSS px 的恢复按钮。折叠状态在本局阶段变化、观看队友时保留；展开后仍按当前观看对象显示最新盟约。按钮支持 Enter / Space，聚焦按钮时 Space 不触发准备或暂停。

A bond the mode never activates (标准: official `inactiveBondIdList`) reads 本局禁用 on shop / reward cards (struck through), detail chips and the popup — no 在场 count, no 当前效果 (§21.7); a strategy built around one carries a 本局禁用 tag and note in the strategy draft and stays selectable (bands.json `bondIds`, §21.26).

Interactions (research 09 §1.2 / §5, which supersede the first draft): shop card, upgrade and 机变 card are two-tap (select → confirm, §18.2) — a tap anywhere on the card, its confirm strip included, is the card's tap (shop cards have no ⓘ corner; the armed bar sits above the detail card; a shop card that cannot be bought right now opens its detail on tap, §20.7); a press / drop goes by the tile under the pointer (§18.1); drag bench↔board — over a legal tile the dragged unit stands on it, as in the official deploy drag, held under the pointer elsewhere (§27.62); a legal board drop (also onto the piece's own tile) opens the 4-direction deploy wheel (swipe UP/RIGHT/DOWN/LEFT with the rotated range striped orange; release in the centre, ✕ 点击取消 or Esc cancels); tap a unit's tile ⇒ underframe with **出售 +N** (and **撤退** on the board; items/Arts in the hand / temp: **销毁** — equipped items are locked, §6.2) plus its rotated range — the range follows the open detail card (`screens/game/range.js inspectRange`, GitHub PR #281): an own board piece in prep, and in battle or on a scouted board any ally operator / summon on the field with its current range (the live stats' `range` and `dir`, the snapshot's tile), never an enemy or a bench unit (UnitInfo `area` hand / temp); drag, the wheel and the pen hide it; no drag-to-sell; drag an item onto a unit's tile ⇒ equip that unit (both slots used ⇒ the replace dialog `ui/equipReplace.js` shows the incoming and the two equipped items; the player picks the one to replace — it is destroyed — `g.equip replaceUid`; cancel changes nothing); Arts are dropped on a tile and get the direction step; right-click or long-press ⇒ detail (or a tap on a shop card while the bar is locked); keyboard shortcuts — the defaults, which each player rebinds in 设置 → 快捷键 (`ui/gameLogic/shortcuts.js`, saved with the settings; §25.15) — `R` refresh, `F` freeze, `D` level-up, `Q` retreat / `X` sell the selected operator, `Space` ready (in a solo battle: pause / resume, §14 Solo pause); `Esc` closes (fixed); none acts while a text field has the focus or a dialog is open. All actions optimistic-free: UI waits for server state (latency is small).

Audio: autochess BGM per phase, UI SFX (buy/sell/refresh/level/merge/ready/timer), per-unit attack/hit SFX (throttled; an impact plays for a hostile attack's phys / arts / true damage only, never an operator's skill-mode file for a normal attack, ≤ 2 copies of one battle sound — §18.4; a skill cue that reaches the client before its unit — the sim emits a deploy-tick cast ahead of the unit's `['spawn']` — is held and sounds once when the unit is tracked, `AudioManager.pendingSkill`, GitHub PR #292 by @LimitlessHPPK; entering a field late hands the sound the buffered `spawn` tuples only, `screens/game/early.js audioEarly`, so no old death, deploy or cast replays), boss music in R14/15.

---

## 13. Local-client art (optional, host-side)

`tools/local-extract/extract.py` (Python: UnityPy + lz4 + Pillow; decodes Arknights' custom **LZ4AK** bundle compression via `aklz4.py`) extracts the art the web download does not include (some of it, most official HUD sprites among it, is on the public mirror too — §22.5) from a locally installed client (CrossOver Windows build or PlayCover iOS build) into `public/assets/local/**` and writes `data/local-assets.json` (`{ groups: { '<subdir>': { name: { path, w, h, kind } } } }`). Everything here is **optional**: clients must render correctly when the file or any entry is missing (fall back to the web assets / procedural art). The emotes and the guide pages below are on the public mirror too (§22.5): fetch-assets downloads them (data/assets.json `ui['emoticon/<dir>/<picId>']`, `ui['guide/<key>']`) and the client shows the local copy first, then that one (`data.js artUrls`); docs/DEPLOY.md §6 lists what still needs the client.
- `map/autochess/TX_autochessi_*` — the real autochess board atlas (`_D` diffuse 2048² with floor tiles, gold-framed high-ground plates, REINFORCEMENTS bench pads, EQUIPMENTS pads, crates, gates; `_N/_M/_E` normal/mask/emission; `common_D` device icons; `BG` backdrop). `map/autochesssand/*` — the sand-theme variant.
- `ui/{common,battle,outer}/*` — every sprite of the three official autochess UI bundles (tier chips I–VI, bond disc rings, frames, banners, HUD pieces, badges, backgrounds, mode art).
- `emoticon/<dir>/<picId>.png` — the 36 official battle emotes, 6 themes (`shared/constants.js → EMOTE_THEMES / EMOTES`, `emoteArtPath`; data/emotes.json); also downloaded from the mirror (§22.5).
- `guide/autochess_{home,shop,handbook}_N.png` — the 19 official tutorial pages; stored squashed to 1024² — **display at 16:9** (the mirror copies too, §22.5).
- `projectiles/*` — battle projectile sprites.
- `spine/enemy/<id>/` — enemy models no web dump carries (灼热 / 炽焰源石虫, `extract.py ENEMY_SPINES`): manifest `enemies[id].spineLocal` (metadata from the committed `tools/assets/local-enemy-spines.json`); drawn instead of the tinted web alias when every file is listed (§21.14).
- `spine/token/<id>/` — token (summon) models no web dump carries (39: most 自选 summons, 凯瑟琳's 爬行号·防护单元, 凛御银灰's 风雪之眼; `extract.py TOKEN_SPINES`, the Front renderer's skeleton of each battle token prefab): manifest `tokens[id].spineLocal` (metadata from the committed `tools/assets/local-token-spines.json`); drawn instead of the avatar diamond when every file is listed (docs/ASSETS.md "Token models from the local client").
- `module/<TYPE>` — the official module (uniequip) TYPE icons (white glyphs; keys are the client's mixed-case file names, e.g. `PRI-X`, `mar-x`, `isw-a`), matched **case-insensitively** against a ModuleRecord's `typeName` by `assetUrls.moduleTypeIconUrl(local, typeName)` (Greek type letters map to the file's Latin letter: `ISW-α` → `isw-a`) — shown on the 干员调配 module cards / module info, the detail panel's 模组 row and the shop card's module tag; lettered tiles / type text without them.

---

## 15. Official 3D board scene (v2 visual target)

Findings (2026-09-28): 卫戍协议 levels have no scene bundle (`mapId` null; the official hot-update list contains none). The client **builds the board at runtime** from the stage grid using the map theme `arts/maps/map_autochess` (materials `MT_autochess` (albedo `TX_autochessi_D` 2048², normal `_N`, metallic/gloss `_M`, emission `_E`), `MT_autochess_common` (`common_D/_E`: device/gate icons), `MT_autochess_Transparent` (`Transparent_D/N/M/E`), `MT_autochessi_BG` (`TX_autochessi_BG`)), the background meshes `arts/maps/map_autochess/bkg_mesh.ab` (`S_Background_common`, `S_Background_shadow`) and `arts/maps/common/meshes/s_background_common.ab`, device meshes (`s_common_box_01` crate, `s_wind_device` blower, …), plus the standard gate/objective effects. The level's `options.configBlackBoard` carries the official camera framing (`default_pos_x/y`, `default_size`, `enemy_pos_x/y`, …).

Target: a **real 3D board layer** rendered with three.js (vendored ESM, no CDN) underneath the existing Pixi layer:
- Geometry generated from `data/stages.json` like the official builder: LOW tiles = top quads; HIGH tiles = raised blocks with side walls; forbidden/void, fences, gates (red), objective (blue), hand/temp pads, special terrain; UVs mapped onto the official atlas regions (reuse/extend `public/assets/local/map/autochess/tiles.json`); normal + emission + metallic maps; lighting tuned to match official screenshots (key directional light, ambient/hemisphere, soft contact shadows); official background meshes & texture; device meshes (OBJ exported by `tools/local-extract`) with their textures; animated gate/objective effects.
- One camera model drives both layers: `public/js/render/projection.js` keeps its public API (`worldToScreen`, `screenToWorld`/tile picking, presets, transitions) but derives it from a three.js `PerspectiveCamera` initialised from the official configBlackBoard framing, so Spine units, FX, drag/drop and hit-testing stay aligned with the 3D board.
- Must degrade gracefully: when local-client art or WebGL2 features are missing, fall back to the current 2D atlas board; keep 60 fps (static geometry merged into few draw calls; textures mipmapped; DPR-aware).
- Implemented (`public/js/render/board3d/*`, `render/app.js`): three.js is downloaded only when the local-art manifest lists the board atlas; the built 3D area, the drawn 2D rows and the lit rect follow `viewKind(kind, {rect})` (the field the camera actually shows: a 'prep' camera on rows ≤ 6 = `bossPrep`); the background plane is extended with mirrored copies and the clear colour matches the fog (no visible edge at any aspect); battle crates live in their own group (survive scene rebuilds) and follow the board mode (`switchableBox`: 3D mesh ⇄ 2D box on a mode switch or a lost WebGL context); quality 'low' drops shadows; `?board=2d|3d` overrides. The direction wheel's range stripes sit between the board canvas and the unit canvas.
- Done: Final Assault / Hidden Core prep takes place on your own half of the boss field (research 09 §1.2): pieces shown at boss-field positions (row − 7; right-hand player mirrored col → 20 − col, RIGHT ↔ LEFT), drop targets and wheel directions mapped back to board coordinates (`prepCamera` → `bossPrep` in public/js/ui/gameLogic.js; covered by the playtest2 browser tests). A scout of such a board (`m.field` prep of a boss round) comes in boss-field coordinates with the player's `side` and is framed the same way, the leader standing at its spawn (0.2.0, community report item 55). Both players of a pair are shown together, as in the battle (0.2.0, community report item 51): the partner's board stands on the other half (`m.private.bossMate` units, already in boss-field coordinates: mirrored on the right half, RIGHT ↔ LEFT; read-only `m:<uid>` views of `render/app.js syncMates`), the whole boss field is lit, a scout carries both halves (`mate`), and the team panel frames the pair's avatars in the official green (`ui/battle bg_team_border` tinted, a plain ring without the local art; `gameLogic teamFrameIds`) from the round's start through the fight.

---

Clipboard exports (`ui/clipboard.js`, §28.3) first use the secure Clipboard API. The textarea fallback for LAN
play stays inside the active modal/guide focus boundary; it copies only after focus and the complete selection
are verified, and cleans up / restores focus on both success and failure. Failure exposes the existing manual-copy UI.


Push/pull slides preserve the target's pre-hit facing through the waiting and moving phases (`keepFacing`, §28.9).
Explicit false and unmarked raw displacements face the travel direction. Normal snapshot facing resumes on landing.
[ASSUMED] unrecorded push sources and reverse-facing hook pulls use the same display rule as the cited examples.

### Local preferences and recovery (§28.14, §28.18–20)

Settings persist `textSize` (sm/md/lg/xl; default sm) and `voiceOverrides` (charId → cn/jp; default empty) alongside the
existing global `voiceLang`. CSS text uses `--t`; the layout rem, camera and board geometry stay unchanged. Larger text
and translated controls wrap within the settings modal. The normal roster detail and chosen DIY cards expose each
operator's voice preference, shared across that charId's forms. An absent override follows the global preference;
missing Japanese lines retain the existing Chinese fallback. Overrides are local listening preferences, absent from
room loadouts and their exports.

The title and lobby offer explicit recovery of a previously saved local match seat. `sp.matches` stores bounded name /
room-code metadata indexed by token hash; the existing four-entry `sp.tokens` ring remains the authority. Recovery
rechecks BroadcastChannel claims before selecting the token in memory and reconnecting in the same document.
Only the server's `welcome` (`saveToken`) persists that selection and its first-welcome stamp (`sp.tokenWelcome`,
bound to the token hash). Refreshing or reconnecting the same token preserves that stamp. A tab with a session token
initializes with that token or null, never another recent token, and answers ownership queries during initialization.
An earlier welcome takes precedence; equal stamps prefer an already welcomed live document over a copied session,
then tab id breaks ties. A session token without a stamp still outranks a tentative shared-token selection. A pending
recovery yields when the original owner returns; a later welcomed holder also gives up its local claim and pending
reconnect. `hello.noReplace` prevents tentative recovery from evicting a connected session even if its hello is already
in flight; `hello.claimAt` preserves the earlier-welcome priority for established holders' in-flight reconnects. A stale
welcome never reaches the store or flushes queued game actions. Nickname persistence also waits for welcome, so a
refused recovery can return to the previous identity and nickname. It does not identify players by name or IP.
Without BroadcastChannel it refuses shared recovery. Server restart / expiry clears
obsolete metadata on the next welcome. A spectator never registers a recoverable player seat.

`manifest.json` enables browser installation. The maintainer's revised decision of 2026-10-10 is to
**沿用 0.2.x 的薄荷绿城堡并精修**: `public/icons/app.svg` keeps the existing three-battlement rook, inset tower
and splayed base in mint `#4ed8af` on dark `#0c0f0e`. Refinement B narrows the tower, balances the battlements,
thins the base and increases breathing room. It has no lettering, gradients or gloss and uses no official art,
logos, icons or fonts.
`tools/export-app-icons.py` exports 192/512 px PNGs for `any` and separate opaque `maskable` icons: the latter scale
only the mark to 87.5%, keeping every foreground pixel inside the central circle of radius 40% of the canvas.
The same master supplies 16/32/48 px PNG / ICO favicons and the 180 px Apple touch icon linked from `index.html`.
These project-owned assets live in `public/icons/` and ship in full and lite packages; ASSETS.md records their provenance.
The install button appears only for a live browser install offer and hides
in standalone/fullscreen windows or after installation. Every offer is consumed before awaiting the prompt, including
cancellation or failure. No service worker, offline cache or persistent server is introduced; HTTPS or localhost and
browser support still govern installation.

### Skill-mode sound and delayed models (§28.17, §28.22)

The audio manifest can carry `attacks` / `hits` plus independent `attackMix` / `hitMix` by skill index. Only an active
skill uses a mode bank. Impacts remember the mode at the time of the attack; an end event cancels a queued start for
an unknown unit, and a late-join snapshot restores the current mode. A mode without a bank falls back to its normal
sound. A selected mode with no mix uses its own default volume/probability, not the ordinary bank's mix.

A model that arrives after an actual deployment continues Start at the elapsed game time; after the clip's duration it
shows the current base pose. A subsequent attack/death supersedes that pending entrance. No extra deployment sound
or per-phase animation schedule is added by this change.

The simplified-view notice describes a renderer load failure, rather than declaring the device incapable of 3D.
The same fallback covers import failure, timeout and WebGL initialization errors; a reload can retry.
It does not diagnose a particular user's GPU or persist a disabled renderer preference (§28.25).
