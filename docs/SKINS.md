# 干员皮肤 (Operator skins)

An operator's Spine model and its pictures can be replaced by one of its official alternative outfits (时装). This
document is the normative reference for that feature; the art itself is **never** downloaded or written by the server —
it comes from a **cosmetic plugin's overlay** (docs/PLUGINS.md §9), which the server's owner installs in `plugins/` and
each player switches on for themself.

> 上游 #652 被关闭的原因写在这里，因为它是这个设计的出发点：**服务器不提供安装通道**。当时的 `room.skin.install`
> 让任何已连接的客户端都能让服务器去网上下载文件并改写所有客户端共读的 `data/assets.json`，而随包发布的
> `data/skins-installed.json` 又会让更新校验对不上。本实现没有安装报文、不写 `data/` 下的任何文件、不随包发布任何
> 安装状态：皮肤属于插件，插件怎么落地是 `plugins/` 目录（安装、studio、ZIP）本来就有的问题。

A server's owner who has the official client can make that plugin from it: `tools/local-extract/extract.py --only skins`
writes the alternative outfits of the installation's operators (avatar, portrait, 立绘 and Front / Back battle models,
picture-only where the official `battleSkin` keeps the operator's model) as cosmetic plugin folders by the official
`skin_table.json`, under `out/local-extract/skins/` by default (docs/ASSETS.md "Official outfits and the picture
gallery", DESIGN §37.331). They are official art on that machine only: never committed, never shipped, copied into
`plugins/` by the owner.

## The data: one overlay, no catalogue file

```
plugins/<id>/plugin.json
  └── assets (or a .json file):  chars[<charId>].illust ……     the operator's own 立绘 (one picture)
                                 chars[<charId>].skins[<skinKey>] = { name, group, avatar, avatarE2,
                                                                      portrait, portraitE2, illust,
                                                                      spine: { front, back? },
                                                                      voice?, voiceJp?, voiceEn?,
                                                                      voiceKr?, voiceNative? }
        │
        ├── the server checks the overlay (shared/plugins/visual.js, docs/PLUGINS.md §9) and serves it as a document:
        │   /vs/<vs16>/overlay.json — composed on the INSTALLATION's manifest, never on a copy of it
        │
        └── the browser composes it (public/js/cosmetics.js cosmetics.apply) on the manifest it already loaded
                 │
                 └── data.get('assets') — what every screen reads (public/js/data.js setView)
                          │
                          ├── chars[<charId>].skins[<skinKey>]  →  the picker's rows (public/js/ui/skins.js availableSkins)
                          ├── chars[<charId>].skins[<skinKey>].spine  →  the model (public/js/assets.js spineEntry { skin })
                          └── chars[<charId>].skins[<skinKey>].voice…  →  the outfit's lines (public/js/audio.js voiceLine,
                                                                          wornOutfit; "Outfit voices" below)
```

Three properties are load-bearing:

- **A skin key is the KEY, and it is data.** It carries `@` `#` `+` `.` (`char_002_amiya@winter#1`), so it is **not** an
  `isId` (shared/protocol.js `isSkinId`). A plugin that has no official id for a skin may write the stem form
  (`char_102_texas_epoque_7`) [ASSUMED: docs/PLUGINS.md §9]. Whatever writes a skin and whatever wears it must agree on
  that exact string.
- **The choice is keyed by OPERATOR (charId), not by chess.** `chars[<charId>].skins` is the manifest's own grouping, so
  one entry covers an operator's normal piece, its elite (the merge) and a 自选 slot fielding it. The renderer agrees:
  a unit's skin resolves through `d.spine ?? d.charId ?? u.defId` (server/sim/snapshot.js), i.e. the charId.
  Every owner/scout board, hand, temp and battle input resolves the **effective body** with `PlayerState.fieldRecord`:
  a stand-in uses `backup.charId`, a 自选 slot its pick. Official source:
  `activity_table.activity.AUTOCHESS_SEASON.act2autochess.charShopChessDatas` `backupCharId` (for example
  `chess_char_3_01_a`: `char_103_angel` → `char_603_csnipe`). [ASSUMED] Skin choices follow that body too, so an original
  operator's selected outfit never dresses its stand-in; the official table specifies bodies, not this cosmetic UI.
- **A missing piece falls back; nothing is ever a placeholder.** `spineEntry(m, id, { skin })` draws the operator's own
  model when the skin (or its model) is not in the manifest; `avatarUrl` / `portraitUrl` / `illustUrl` fall back to the
  operator's own pictures. The picker shows the operator's portrait on a skin that ships none.

## Summons follow their owner's outfit (token skins)

The official skin table's `charSkins[<skinId>].tokenSkinMap` maps a summon to an appearance per owner outfit (e.g.
`char_250_phatom@sale#4` → `token_10007_phatom_twin_sale#4`). The remake carries it as the same cosmetic layer as an
operator's outfits, not as a second choice:

- **The plugin writes the summon's appearances under the owner's skin key**: `tokens[<tokenId>].skins[<skinId>]`, a skin
  record (docs/PLUGINS.md §9). The key is the operator skin the player wears, so one token serves two owners' outfits.
- **Every surface publishes the summon's `skin` as its owner's choice**: prep board, hand and 临时整备区
  (`pieceView` / `_prepBoardUnits`) resolve it through the owner piece, passing a 自选 owner's picked `charId` to
  `skinFor` just as `battleInput` does; the sim copies the owner unit's `skin` at
  creation (including the late owner link), and `UnitInfo.ownerCharId` lets a running battle re-read the public choice
  like an operator body.
- **A missing skin or model falls back**: `spineEntry` / `tokenAvatarUrl` / `unitPictureUrl` use the summon's own
  entry, then its own avatar and the owner's.
- **The picker does not change**: a summon has no row and no stored key; it wears what its owner wears, and clearing the
  outfit returns it to its own model. 设置「显示其他玩家的皮肤」 applies as for the owning operator.

[ASSUMED] The official autochess mode's own use of outfits is not established; this remake's cosmetic layer is the
maintainer's decision, and the data model above is the official skin table's. Display only: `Unit.skin` is never read by
a rule and `Battle.result()` is unchanged (`test/skins.test.js`).

## Picture-only outfits (0.3.2, B6)

The maintainer's 2026-10-18 **option A** makes a `skins` record with pictures but no Spine wearable.
The picker labels it 「仅更换头像与立绘」. Its owner's avatars and portraits change, including loadout (the list
and the 卡片视图) / DIY, shop / reward cards (the DOM card and the canvas shop's card, §37.240), detail panels, bond members, thumbnails, settlement / result rows, combat metrics and the DOM fallback field.
Battle Spine keeps the effective operator's default Front / Back. Missing image fields independently use the
operator's existing normal / elite fallbacks; removing the plugin restores defaults without erasing the saved choice.
Model outfits retain their model resolution and picture fallbacks. A replacement directly on `chars[charId]`
without a `skins` entry still does not enable the picker.

Source: the official [skin_table.json](https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/skin_table.json)
`charSkins` associates `skinId`, `charId`, `avatarId`, `portraitId`, `illustId` and `battleSkin` separately.
That table does not prescribe missing-plugin behavior; wearability and the note above are the maintainer's decision.
[ASSUMED] Any of `avatar`, `avatarE2`, `portrait`, `portraitE2`, `illust` counts as a picture; metadata alone does not.
An unfinished Spine map without Front uses both default views.
An E2-only picture is offered in the picker but only replaces elite art during play; the normal image falls back.
The existing portrait → illustration preference is retained; an illustration never substitutes for an in-game avatar.

[ASSUMED] Card images follow the same latest-public-choice rule as the renderer, including clears and the
「显示其他玩家的皮肤」 switch. A local picker reads the browser's choice; an explicit owner reads that seat's public
map, or its unit's skin when the seat is unavailable, never the viewer's map. Unowned catalogue/statistics art stays
unowned. `OperatorImage` subscribes to choices, visibility and the composed manifest, so open cards refresh on changes.
Effective stand-in / DIY bodies are resolved before that lookup, preserving §34.23 and #686.
The strategy draft's name cards (`screens/bandDraft.js` artOf: each doctor's 名片干员 art, as on the room's seat cards)
follow the seat cards' rule below (`seatCardSkin`), reading for the others the match's `m.public.players[].skins` and,
for the operators the match's data lacks, the room's `room.state.seats[].skins` (`ui/seatArt.js cardSkinPlayers`, DESIGN
§37.325): the match keeps only the outfits of the operators its data has, so a card of another period wears the one the
room's seats carry. An operator of the match's data wears the match's choice alone: a `room.skins` during a match
re-broadcasts no `room.state`, so the room's seats still hold the map from before the start, and an outfit taken off in
the match would come back from them.

## Outfit voices (时装语音, #733; PR #734 by @xcdoge, DESIGN §37.330)

An operator's skin record may carry that outfit's own lines, one tree per dub, named and slotted like the manifest's:
`voice` (中文), `voiceJp`, `voiceEn`, `voiceKr`, `voiceNative`, each `{ <slot>: file | [1–16 files] }` with the slots of
`audio.voice[<charId>]` (`start`, `faceEnemy`, `select`, `place`, `skill1`–`skill4`, `resultFour` …). The runtime check
(`shared/plugins/visual.js` `OPERATOR_SKIN_RECORD`) and `schemas/overlay.schema.json` (`$defs.operatorSkinRecord`, each
tree a `voiceRecord`) accept the same fields; the files are listed in `plugin.lock.json`, served under `/p/` and composed
like any other sound. A summon's skin (`tokens[<tokenId>].skins`) carries none: none of the 172 official summon outfits
has a `voiceId`. [ASSUMED] A summon that talks (a `char_` token) speaks with its own lines whatever its owner wears
(`wornSkinKey` gives no outfit to anything but an operator body).

- **Per slot.** While the outfit is worn, a slot it has lines for plays those; a slot it lacks — no key, an empty list,
  or a write the browser left out because a file failed to load — plays the operator's own line
  (`public/js/audio.js voiceLine`, its 7th parameter `outfit`; the 6th stays `allowChinese`). An outfit without lines (a
  picture-only one) changes nothing.
- **The dub stays the player's.** 设置「语音语言」, the per-operator choice and 本土语言 pick the dub exactly as before,
  from the operator's trees (`voiceLangFor`); wearing an outfit never changes it. Inside that dub the outfit's tree comes
  first, then the operator's, then the existing Chinese fallback — the outfit's Chinese line first there too — which
  still needs Chinese selected for download (§37.109; [ASSUMED] the operator's download choice gates the outfit's
  Chinese lines too, although they come with the plugin, not with the download). So an outfit that carries only Chinese
  lines is heard by a player of 中文; a player of 日本語 hears the operator's Japanese line in that slot, and the outfit's
  Chinese one only where the operator has no Japanese line at all.
- **A dub this server lacks for the operator.** [ASSUMED] The dub is chosen from the operator's trees alone, so all of
  an operator's slots speak one language: where this server has no English / Korean / own-language tree for the
  operator, a player of that dub gets 中文 for it as before (`voiceLangFor`), and the outfit's `voiceEn` / `voiceKr` /
  `voiceNative` lines are never played — its Chinese line (or the operator's) is. The committed `data/assets.json` has
  English and Korean trees for 238 of its 245 voiced operators and own-language ones for 51; an operator a plugin adds
  without those trees is the other case.
- **Whose outfit.** The one the speaking unit's model wears in this view, never the viewer's own choice for another
  seat: `audio.js wornSkinKey` is `render/app.js skinOf`'s rule (a test runs both over the same cases) — the owner's
  latest public choice for the body's operator (`m.public.players[].skins`, an omitted map a clear) over the
  `UnitInfo.skin` the unit arrived with, another seat's only with 显示其他玩家的皮肤 on. `installAudio` hands the audio
  the seats and `me.playerId` from the store, `ui/settings.js` the switch.
  - 开场 / 部署 / 技能 / 接敌: the battle unit's own seat (`_track` keeps `ownerId`, `skin` and the body: a 自选 piece's
    pick, else the model id). Two seats fielding the same operator speak in their own outfits.
  - 补位: the stand-in speaks with its own voice in the outfit its seat chose for the stand-in's operator; the replaced
    operator's outfit never dresses it (the rule of the model above).
  - A reconnect replays the field's `UnitInfo` (with `skin`), and the seats arrive with `m.public`; until then each unit's
    own `skin` decides.
  - 选中干员: the outfit the card draws (`ui/detailPanel.js selectVoiceOutfit`, `OperatorImage`'s `ownerSkin` rule, the
    card's body: a stand-in or a 自选 pick).
  - 结算: this seat's public choice for the operator the speaking piece shows (`resultSpeakerOf`, `screens/game.js`).
  - [ASSUMED] 试听 (the voice library's preview) plays the operator's own lines: it previews a dub, not an outfit.
- **An outfit this page does not have** (a teammate's appearance plugin it lacks, or switched off) speaks with the
  operator's own lines, as it is drawn on the operator's own model.

**Official data.** `skin_table.json` `charSkins[*].voiceId` / `voiceType` and `charword_table.json` `voiceLangDict` /
`charWords`, CN data version 79.2.0 (`excel/data_version.txt`: Change 127796 on 2026/11/05), the files of
Kengxxiao/ArknightsGameData `6f63c14e` (the 规程 profile's default pin, docs/DATA.md; read 2026-11-21): 23 of the 2477
outfits carry a `voiceId` (#733 counted 22 on an older table) — 21 `voiceType: ALL`, 2 `ILLUST` —, 19 of the outfits
with CN / JP / EN / KR dubs and 4 with CN / JP. They name 20 distinct voice ids, as `char_311_mudrok#1` serves four
outfits (`#2`, `@summer#6`, `@wild#10`, `@ambienceSynesthesia#2`): 16 ids with four dubs, 4 with two. An outfit voice's `charWords` use the operator's `placeType`s and
`CN_0NN` numbering, so its slots map as the operator's tree does (`tools/assets/audio.mjs VOICE_SLOTS`).

| skinId | name | voiceId | voiceType | dubs |
|---|---|---|---|---|
| `char_4067_lolxh#2` | — | `char_4067_lolxh#1` | ILLUST | CN JP |
| `char_512_aprot#1` | — | `char_4025_aprot2` | ALL | CN JP EN KR |
| `char_311_mudrok#2` | — | `char_311_mudrok#1` | ILLUST | CN JP EN KR |
| `char_245_cello@sale#12` | 无我唯识 | `char_245_cello_sale#12` | ALL | CN JP EN KR |
| `char_1032_excu2@sale#12` | 众志归一 | `char_1032_excu2_sale#12` | ALL | CN JP EN KR |
| `char_1035_wisdel@sale#14` | 超新星 | `char_1035_wisdel_sale#14` | ALL | CN JP EN KR |
| `char_1038_whitw2@sale#15` | 无序的谦卑 | `char_1038_whitw2_sale#15` | ALL | CN JP EN KR |
| `char_1045_svash2@sale#20` | 雪覆伦城 | `char_1045_svash2_sale#20` | ALL | CN JP |
| `char_113_cqbw@epoque#7` | 恍惚 | `char_113_cqbw_epoque#7` | ALL | CN JP EN KR |
| `char_472_pasngr@epoque#17` | 今昔须臾之梦 | `char_472_pasngr_epoque#17` | ALL | CN JP EN KR |
| `char_4064_mlynar@epoque#28` | 远路 | `char_4064_mlynar_epoque#28` | ALL | CN JP EN KR |
| `char_1016_agoat2@epoque#34` | 远行前的野餐 | `char_1016_agoat2_epoque#34` | ALL | CN JP EN KR |
| `char_4134_cetsyr@epoque#50` | 追悼 | `char_4134_cetsyr_epoque#50` | ALL | CN JP EN KR |
| `char_1016_agoat2@epoque#57` | 后来的故事 | `char_1016_agoat2_epoque#57` | ALL | CN JP |
| `char_2023_ling@nian#12` | 方遒卷 | `char_2023_ling_nian#12` | ALL | CN JP EN KR |
| `char_311_mudrok@summer#6` | 静谧午夜 DN06 | `char_311_mudrok#1` | ALL | CN JP EN KR |
| `char_311_mudrok@wild#10` | 砾瓦 | `char_311_mudrok#1` | ALL | CN JP EN KR |
| `char_003_kalts@boc#6` | 残余 | `char_003_kalts_boc#6` | ALL | CN JP EN KR |
| `char_249_mlyss@boc#8` | 新枝 | `char_249_mlyss_boc#8` | ALL | CN JP EN KR |
| `char_311_mudrok@ambienceSynesthesia#2` | 黑曜石 | `char_311_mudrok#1` | ALL | CN JP EN KR |
| `char_1012_skadi2@iteration#2` | 红女爵 | `char_1012_skadi2_iteration#2` | ALL | CN JP EN KR |
| `char_1041_angel2@iteration#6` | 寻翼之歌 | `char_1041_angel2_iteration#6` | ALL | CN JP |
| `char_2024_chyue@cfa#1` | 全能演员 | `char_2024_chyue_cfa#1` | ALL | CN JP EN KR |

[ASSUMED] `voiceType: ILLUST` reads as "this voice goes with the illustration only" (the two are elite-art outfits), so
a source of battle lines would write them for the `ALL` outfits only; the table does not say more. Nothing produces
outfit lines yet — neither `tools/fetch-assets.mjs` nor the local extraction, and the studio's skin form does not
edit them (the extractor is GitHub #776) —, so until a plugin carries them by hand every operator keeps its own lines.

## The waiting room's seat cards (0.3.2, the maintainer's decision 4 of 2026-10-21)

The 名片干员 portrait on a room seat card (`public/js/screens/room.js`, `public/js/ui/seatArt.js`) and on the strategy
draft's name cards (`public/js/screens/bandDraft.js`) wears the player's outfit for the operator it shows:

- **one's own card** wears this browser's choice (`skinsStore`) at once, before the server has it;
- **another doctor's card** wears the map that seat published. The lobby carries it as `room.state.seats[].skins`
  (`server/lobby.js Room.toState`; human seats with a non-empty map only, so a room without skins sends what it sent
  before) — the same public map a match publishes as `Match.publicView().players[].skins`, which the draft's name cards
  read (over the room's map, for a card of another period: above). A changed map re-broadcasts `room.state` while the room waits (`Lobby.skins`; a resend of the same map does not);
  during a match the match carries it, and the `room.state` at its end;
- with **「显示其他玩家的皮肤」 off** the others' cards draw the default and one's own keeps its outfit;
- an outfit **this page does not have** (a teammate's appearance plugin this browser lacks, or switched off) draws the
  operator's own art — `chessPortraitUrl(m, chess, { skin })` falls back — never a placeholder; an outfit picture that
  **fails to load** falls back to the operator's default one on both (`seatArtSrc`; the draft's name cards since §35.51).

`ui/seatArt.js seatCardSkin` is that rule, on top of `ownerSkin`. The 名片干员 picker is one's own picker: its tiles wear
this browser's outfits, as 干员调配's roster does. [ASSUMED] The whole map rides in `room.state`, not one skinId per card:
a seat without a pick shows an operator its clients choose by player id (`seatOperator`), which the server does not
compute; the map is bounded like `m.public`'s (`SKIN_LIMITS.entries`). `room.skins` keeps the room's operators and the
whole 名片干员 roster (`data/card-roster.json`, every official period's card candidates — DESIGN §37.325), so a seat card
of another period wears its outfit; a match start keeps only the room's (`server/lobby.js seatSettings`, then
`PlayerState.setSkins`), and the client's whitelist is the same union (`ui/loadoutSync.js skinOperatorIds`).

## The switch model: the owner installs, each player switches on

| Who | What they do | Where it is stored |
|---|---|---|
| The server's owner | Drops the plugin folder into `plugins/` (the studio, a ZIP, or by hand), and switches it on for the **room** if they want a set everyone in that room sees | `plugins/`, a room's `vs` |
| A player | Switches a `scope: ["personal"]` cosmetic plugin on for **themself** — a skin of their own choosing | `sp.pref.cosmetics` (this browser only, never sent) |

A room's **host is not part of it**: an appearance a player wears comes from *their* browser's layers, so a plugin with
`scope: ["personal"]` never appears in the room's 插件 panel and no room setting can force a skin on anyone. Two players
of the same co-op match may therefore see different models for the same piece — see the switch below.

## 设置「显示其他玩家的皮肤」 (default on)

A pure client preference (`settings.otherSkins`, `sp.pref.settings`; **never sent**):

- **on** (the default) — a piece draws the appearance its owner chose, which the match published
  (`Match.publicView().players[].skins`, and `UnitInfo.skin` of every unit) — and a waiting room's seat card the one its
  player published there (`room.state.seats[].skins`, above);
- **off** — every other seat's piece draws the operator's own model and pictures; **this player's own pieces keep their skin**.

The asymmetry is deliberate and is what the setting is for: what you draw is your own choice, what others draw is theirs.
Turning it off hides *their* look from *you* and changes nothing on their screen (public/js/render/app.js `skinOf`). The
renderer decides who is "other" from `UnitInfo.ownerId` and the local `me.playerId`
(public/js/ui/fieldHost.js `setMe`) — never from the seat whose camera happens to be on screen.

[ASSUMED] Switching off retains the received skin ID separately (`sourceSkin`) and derives only the displayed `skin`.
Switching back on restores already loaded units immediately, including a boss partner's read-only prep pieces and
units received while hidden. `room.skins` remains valid in every phase: `Match.setSkins` marks the owner's private
view, which also refreshes existing prep scouts and the boss partner. `fieldHost` forwards public seat choices to
`view.setSkins(players)` on mount and when they change. The current battle's operators use that latest selection
(an omitted `skins` map clears it), even if later spawn metadata carries an older choice. This rebuilds appearance
only: it neither changes the running sim / BattleSpec nor restarts playback. Live refresh timing is a remake UI
choice, not a rule established by the official tables.

## The picker: two display rules

In 干员调配 (`screens/loadout.js Detail`) and in the 自选编队 picker's detail (`screens/diy.js DiyPickerView`), the 皮肤
section sits under the operator's name. 潜能与练度 immediately follows 皮肤 wherever cultivation is offered.
The order is 皮肤 → 潜能与练度 → 特质 → 技能 → 局内数值 → 模组 in 干员调配, and 皮肤 → 潜能与练度 → 技能 →
局内数值 → 模组 in 自选编队: the picker draws the roster's own sections in the roster's order (a prototype pick omits
cultivation, so 皮肤 is followed by its locked 技能 and 模组).
[ASSUMED] This is the existing remake panel order; official tables do not prescribe a skin picker layout.

1. **The section is GLOBAL: every operator shows it, or none does.** The one question `SkinSection` asks is
   `public/js/ui/skins.js hasAnySkinChoices()` — **at least one** operator of the composed manifest has one **wear-able**
   skin (`chars[<charId>].skins[<skinKey>]` with a model or at least one picture). While that is false — no plugin at all,
   a plugin that writes no skins records, or only metadata-only skins — nothing is drawn anywhere, header
   included: an installation without a cosmetic layer looks exactly as it did before this feature.
   While it is true, **every** operator shows the section, including one the plugins wrote no skin for. That operator
   gets the 默认 tile alone, a real picture on it and no empty art box, and the header's note reads `0 套外观`: the count
   is kept at zero on purpose, because the whole point of the global rule is that this box **means something** — "the
   plugin is on, this operator has no 时装". A section hidden per operator said nothing, and left the player unable to
   tell an operator without skins from a plugin that failed to load. This is the **reverse** of the rule this feature
   first shipped with (a per-operator `hasSkinChoices`: 默认 plus a wear-able skin of *that* operator, else no section),
   and it must not be turned back. `hasSkinChoices` remains the single-operator criterion — no production code calls it
   — and is what `hasAnySkinChoices` is counted from, so the two can never disagree about "wear-able".
   The gate counts **wear-able skin records**, including picture-only outfits: a plugin that writes only 立绘 (`chars[<charId>].illust`) and
   no skin turns the section on nowhere, and this picker then shows none of its pictures. That is deliberate — the
   section exists to choose a 时装 and its note counts 套外观, so one replaced 立绘 must not put a `0 套外观` box on every
   operator of the installation. A plugin whose 立绘 has to be seen has to give some operator a wear-able skin (then every
   operator's 默认 tile draws the 立绘 it has, per the rule below), or needs a surface of its own. Should the gate ever be
   meant to count a 立绘 as well, the one line that changes is the body of `hasAnySkinChoices`.
2. **A missing layer falls back to the operator's own art** — a skin with no `portrait` shows the operator's portrait
   (its `illust`, then the portrait), never a slash or a placeholder; the tile is dimmed (`.lo-skin--fallback`) so the
   replacement is legible. The enlarged preview (`.lo-skin-preview`, a `Modal`) shows the skin's 立绘.

The 默认 tile is the operator's **real** appearance, not an empty slot: it draws the operator's own 立绘
(`chars[<charId>].illust` — the picture an appearance plugin may write for an operator it gives no skin at all, and this
tile is the only place that picture is seen), else `chars[<charId>].portrait`, else its avatar. The 立绘 wins over the
portrait on purpose, for the same reason the section is global: what a plugin wrote for the operator has to be visible,
and the 1:2 tile crops to the top exactly as it already does for a skin that ships only an illust. It is never empty
while the record has any of the three; an operator the composed manifest does not hold at all (not even a 默认 tile
exists) gets no section rather than an empty grid.

## New files

| Path | What |
|---|---|
| `public/js/ui/skins.js` | The client store (`sp.pref.skins`, `{ [charId]: skinId }`, at most `SKIN_LIMITS.entries` pairs: `parseStoredSkins` is the one parse of a stored selection — the store's initial state, every edit and what the sync sends — so the wire's own limit is applied where the selection is read), `availableSkins` (the composed manifest's rows, with `playable` and with art already resolved and fallen back; the 默认 row exists for every operator the manifest holds, also one with no `skins`), `hasAnySkinChoices` (the section's global rule), `hasSkinChoices` (the single-operator criterion, kept for tests and future rules), `chosenSkin` (a stored entry that is not one of this operator's wear-able skins counts as 默认), `setSkin` / `clearSkin` |
| `public/js/ui/skinPicker.js` | The 皮肤 section itself: `SkinSection` (nothing while `hasAnySkinChoices` is false — for every operator alike; the 默认 tile alone for an operator without a skin), `SkinPreview` (the enlarged 立绘), the five-tile grid's markup |
| `test/skins.test.js` | The wire shape (`isSkinId` / `isSkinSelection`), the lobby → Match → PlayerState chain, the public view, reconnect, the sim's UnitInfo, the client's fallbacks, and the absence of the install channel |
| `test/lobby-skins.test.js` | `room.skins` over WebSocket: validation, session and seat storage, the seats handed to the Match, bots, the change made mid-match, `room.state.seats[].skins` (broadcast on a change while the room waits, not on a resend) |
| `test/ui/seat-art.test.js`, `test/ui/room-cards.e2e.test.js` | the seat cards' outfits: `seatCardSkin` (own / published / the switch / fallback) and, in the browser, both screens of a co-op room |
| `test/ui/skin-picker.test.js` | The picker's rules against a composed manifest: the rows, `playable`, the art fallbacks, the global `hasAnySkinChoices` and the per-operator `hasSkinChoices`, `chosenSkin`, and that the section's gate is the global one |
| `test/ui/skin-voice.test.js` | Outfit voices (DESIGN §37.330): `voiceLine`'s per-slot / per-dub rule and its fallbacks, `wornOutfit`, `wornSkinKey` against `render/app.js skinOf`, the battle lines of teammates of one operator / the switch / a mid-match change / a reconnect / a stand-in / a 自选 pick, a failed outfit file, 选中 (`selectVoiceOutfit`) and 结算 (`resultSpeakerOf`) |
| `docs/SKINS.md` | This document |

## Edits to existing files

| File | Where | What |
|---|---|---|
| `shared/protocol.js` | before `isNotOwnedList` | `SKIN_LIMITS` (256 [ASSUMED]), `isSkinId` (**not** `isId`; the same character class as `isSkinKey`), `isCharId`, `isSkinSelection`, `operatorCharIds`, `checkSkinSelection` |
| `shared/plugins/visual.js` | `ASSET_CONTAINERS` `tokens` | `tokens[id].skins[<skinId>]` — the same skin record under a summon, keyed by the owner's outfit (the official `tokenSkinMap`) |
| `schemas/overlay.schema.json` | `$defs.tokenRecord` | `skins` (up to 64, `skinKey` → `skinRecord`) |
| `shared/plugins/visual.js`, `schemas/overlay.schema.json` | `OPERATOR_SKIN_RECORD` / `VOICE_TREE`, `$defs.operatorSkinRecord` | an operator's skin adds the outfit's lines: `voice` / `voiceJp` / `voiceEn` / `voiceKr` / `voiceNative` by slot (DESIGN §37.330); a summon's `skinRecord` has none |
| `public/js/audio.js` | `voiceLine` (7th parameter `outfit`), `wornOutfit`, `wornSkinKey`, `resultSpeakerOf`, `setSkinPlayers` / `setMe` / `setOtherSkins`, `_track`, `voice({ skinKey, skinCharId })`, `installAudio` | outfit voices: the speaking unit's own seat, per slot and per dub (above) |
| `public/js/ui/detailPanel.js`, `public/js/screens/game.js`, `public/js/ui/settings.js` | `selectVoiceOutfit`, `onResult`, the settings subscription | 选中 in the card's outfit, 结算 in this seat's, 显示其他玩家的皮肤 handed to the audio |
| `server/match/player/views.js`, `server/match/match/views.js` | `pieceView`, `_prepBoardUnits`, the bench | `tokenSkin(piece)`: a summon's skin is its owner piece's operator outfit |
| `server/sim/battle/players.js`, `server/sim/battle/summons.js`, `server/sim/snapshot.js` | token creation, `unitInfo` | the summon copies its owner unit's `skin`; `UnitInfo.ownerCharId` names the operator the client re-reads it from |
| `public/js/assets.js`, `public/js/ui/assetUrls.js`, `public/js/ui/fallbackField.js` | `spineEntry` tokens branch, `tokenAvatarUrl`, `unitPictureUrl`, `pieceArt` | read `tokens[id].skins[skin]`, fall back to the summon's own model/avatar |
| `public/js/render/app.js` | `pieceInfo` token branch, `skinOf` | carry the piece's `skin`; a token re-reads its owner's current outfit like an operator body |
| `shared/protocol.js` | `C2S` | `'room.skins'` — and **no** `'room.skin.install'` |
| `server/net.js` | `HEAVY_TYPES`, `Session` ctor | `'room.skins'`; `session.skins` |
| `server/lobby.js` | after `freezeDiy`, `onMessage`, after `diy()`, `humanSeat`, `seatSettings`, `startMatch`, `Room.toState` | `freezeSkins` (charId + skinId, drop operators neither the room nor the 名片干员 roster has — `skins()` reads the room's data only for an id the roster lacks; a bad map is BAD_MSG and does not clear), `case 'room.skins'`, `seats[].skins` in `room.state` (0.3.2 decision 4, broadcast by `skins()` when a waiting room's map changed), `skins()` — **no phase gate**, unlike the loadout — and the selection riding into the match |
| `server/match/PlayerState.js` | ctor | `this.skins = Object.freeze({})` + `setSkins(seat.skins)` |
| `server/match/player/basics.js` | after `setLoadout` | `skinCharIdOf` / `skinFor` / `setSkins` (bots refused; a bad map refused whole, unknown operators dropped) |
| `server/match/match/platform.js` | after `setLoadout` | `setSkins(playerId, skins)` — any phase, `markPrivate()` (owner, prep scouts, boss partner) and `markPublic()` |
| `server/match/match/views.js` | `publicView().players[]`, `_prepBoardUnits`, the scouted bench | `skins` (omitted when empty), and `skin` on every unit the player owns |
| `server/match/player/round.js` | `battleInput` | the unit's `skin`, from the player's own selection and the piece's operator (a 自选 slot follows its pick) |
| `server/match/player/views.js` | `pieceView` | `skin` on the prep board / hand / temp views |
| `server/sim/units.js`, `server/sim/battle/players.js`, `server/sim/snapshot.js` | `Unit`, `_createAllyFromInput` / `_makeAlly`, `unitInfo` | carried to the client; `skin: u.skin ?? undefined`, so a piece without one adds no key to the wire |
| `public/js/assets.js` | `portraitUrl` / `illustUrl` (new) / `spineEntry` / `hasBackSpine` / `unitPictureUrl` / `skinsOf` / `skinHasModel` | every helper takes `opts.skin` (the skinId) and falls back to the operator's own art |
| `public/js/render/units.js` | `_pictureUrl`, `_modelEntry`, `_wantsBack`, `_loadPicture` | `info.skin` reaches the Spine entry, the diamond and the Front/Back question; the picture's cache key carries the skinId |
| `public/js/render/app.js` | `otherSkins` setting, `ctx.myPlayerId`, `applyInfo`, `refreshSkins`, `setSettings`, `setMe`, `setSkins`, `pieceInfo` | received `sourceSkin` is retained while displayed `skin` follows the switch and latest public selection; a changed appearance drops the view; read-only prep pieces refresh too |
| `public/js/render/app/info.js` | `renderInfo` | `skin` |
| `public/js/ui/loadoutSync.js` | header, `installSkinsSync`, `skinOperatorIds` | the fourth `installPrefSync` setting (`room.skins { skins }`); the operators it keeps: the room's and the 名片干员 roster's (DESIGN §37.325) |
| `public/js/ui/seatArt.js`, `public/js/screens/room.js`, `public/js/screens/bandDraft.js` | `seatCardSkin`, `cardSkinPlayers`, the seat cards and the 名片干员 picker, the draft's name cards | the 名片干员 portrait wears its player's outfit (0.3.2 decision 4, above), a card of another period too (DESIGN §37.325) |
| `public/js/main.js` | boot | `installSkinsSync({ net })` |
| `public/js/ui/settings.js` | `CosmeticSection` | the 显示其他玩家的皮肤 switch — with or without a cosmetic plugin |
| `public/js/ui/gameLogic/settings.js` | `DEFAULT_SETTINGS`, `sanitizeSettings` | `otherSkins: true` |
| `public/js/ui/fieldHost.js` | mount, store subscription, `OPTIONAL` | `view.setMe` and `view.setSkins` adopt and follow local identity / public seat choices; unmount removes the subscription |
| `public/css/screens/loadout.css` | end | `.lo-skins` / `.lo-skin*` tiles, `.lo-skin-preview` |
| `public/i18n/*.json` | — | the strings above, in every pack (`node tools/i18n.mjs check --all --strict`) |

## Invariants

- **No `cs`.** An appearance is never part of a room's content set: it changes nothing a battle does, so no battle
  identity moves for it (docs/PLUGINS.md §6).
- **No `server/sim/` rule.** The sim carries `skin` as opaque data (`Unit.skin` → `unitInfo().skin`); no rule reads it
  (`server/sim/units.js` stores it, `battle/players.js` copies it onto the ally, `snapshot.js` publishes it). The same
  seeded battle run with and without a skin returns the same `Battle.result()` (`test/skins.test.js`), and
  `test/golden/*.json` is unchanged. `skin` is listed with the sim fields in `docs/design/engine.md` §5.2 and
  `docs/SIM.md` §2 as display-only.
- **No `data/` write.** Nothing in this feature writes a data file; a plugin's own files are served from
  `plugins/<id>/` under `/p/<id>/<hash>/…` (docs/PLUGINS.md §9).
- **No game art in git.** As ever: skin art belongs to a plugin (or to a locally extracted client), never to this
  repository.
- **A bad map is refused whole.** `isSkinSelection` / `validateC2S` (`room.skins`), the lobby (`freezeSkins` / `skins()`)
  and `PlayerState.setSkins` all require a plain object, a charId key (`isCharId`: official `char_<digits>_<token>` or
  a plugin `char_x_…`, never a chess id) and a skinId value (`isSkinId`). An array, a null-prototype object, one bad
  key or value, or more than 256 entries [ASSUMED] is BAD_MSG and does **not** clear a choice already stored. A charId
  the room's content does not have (`operatorCharIds`: chess records, `backups.units`, `diy.ownedPool`,
  `diy.operators`) and the 名片干员 roster does not list either (DESIGN §37.325) is dropped and the rest kept, so the
  stored map is at most those operators (and 256); a match keeps only the room's (`PlayerState.setSkins`). An unknown
  skinId of an operator the room does have still draws the default model (`spineEntry`).
- **The client never sends more than the wire accepts.** `SKIN_LIMITS.entries` (256 [ASSUMED]) is applied in
  `public/js/ui/skins.js parseStoredSkins`, the one place a stored selection is read — the store's initial state, every
  edit and the `room.skins` payload the sync prepares. The limit has to be honoured there because an over-long map is not
  trimmed entry by entry on the server: `isSkinSelection` refuses the WHOLE message (BAD_MSG), so nothing would be stored
  and the sync would sit in `error` (public/js/ui/loadoutSync.js `installPrefSync`) instead of saving the rest.
- **A tile never outgrows the panel it sits in.** `.lo-skins` is `repeat(5, minmax(0, 1fr))` (three columns below 900 px,
  where the detail panel is a whole phone width — or a narrow window — and tall enough for the 1:2 box), so a tile is a
  share of the detail panel and its size never moves with how many skins an operator has. The tile draws the appearance's
  1:2 portrait, and on a panel too short for that box it draws the same appearance's 1:1 `avatar` instead —
  `@media (max-width: 1000px) and (max-height: 520px)` at the end of the picker's block in
  `public/css/screens/loadout.css`. That query is a phone in landscape: its detail panel is 193–263 px tall (measured
  740×360 … 932×430) while the 1:2 tile is 264–379 px there, which made 皮肤 the ONE section of that panel a phone could
  not see whole (潜能与练度 / 技能 / 局内数值 / 模组 are 135–163 px in the same panel). Both images of a tile are in the DOM
  (`public/js/ui/skinPicker.js`, `availableSkins().avatar`) and CSS alone decides, so no resize listener and no re-render;
  273/273 of the installed skins ship an `avatar` of their own (measured), and a row whose manifest has none keeps its
  portrait on every screen. A 1:2 box is still what every wider panel draws, with `min-height: max(1.5rem, 130px)` as
  the floor of a narrow one. Portrait is not a case to solve: a portrait phone is covered by 「请将设备横屏」
  (`public/index.html .rotate-hint`, shown by `public/css/theme.css`
  `@media (orientation: portrait) and (max-width: 1024px) { .sp-rotatable .rotate-hint { display: grid } }` for the
  `sp-rotatable` that `public/js/ui/device.js` sets on a coarse pointer whose screen is not landscape).

## Known limitations

- **Bots always wear the default model** (`PlayerState.setSkins` refuses a bot, as `setLoadout` does).
- **The studio does not list skins.** It finds an operator, an enemy or an interface picture by its official name
  (`server/studio/targets.js`), so a skin key is copied from the installation's manifest or written in the stem form.
- **No skin effects** (a separate piece of work; docs/ASSETS.md). An outfit's own lines are part of the record ("Outfit
  voices" above), but nothing produces them yet: no build step or extraction writes them, and the studio's skin form does
  not edit them — a plugin carries them by hand until the extractor (GitHub #776) exists.
- **A 自选 slot's own record has `charId: null`**, so it wears its **pick's** operator's skin — the slot has no body of
  its own. The picker offers the appearance while picking that operator, and the choice is kept per operator, so
  changing the slot's operator changes the appearance with it.
