# THEMES.md — interface themes (界面主题)

从零做一个主题包的中文教程（颜色和图位一览、九宫格、横幅、语音、动图和 Spine 动态角色、自测和分享，附示例包）见 [THEME-GUIDE.md](THEME-GUIDE.md)；这一页是格式规格。

界面主题是玩家在自己的浏览器里导入的界面皮肤。它只装饰这一台设备上的画面：不上传，服务器不参与，其他玩家看不到，也不改对局。它按网址保存在浏览器里：同一个地址的服务器换了版本也还在，换了地址或端口要重新导入。格式在下面。

An **interface theme** is a pack this browser imported. It is not a plugin. A plugin is installed by the server's
owner in `plugins/` ([PLUGINS.md](PLUGINS.md)): a cosmetic plugin can be room-wide or personal and may replace
operator art, models and voices. A theme cannot change gameplay, the battle record, `cs` / `vs`, or operator /
enemy art. It restyles panels, colours, phase plates and a few voice lines on this screen only.

The built-in look is 「卫戍协议终端」. Choosing it clears the pack. [ASSUMED] That card stays today's look, even
though the official default skin `ac_n_initial` has the same name. The official art is a separate card,
「卫戍协议终端（官方贴图）」, and only when that pack is installed.

Nothing in a pack is read as CSS, HTML or script. An imported path is never fetched: no `http`, no `..`, no
absolute path. Images and audio become `blob:` URLs. `cssUrl` still accepts `blob:` only. The page's CSP
already allows `blob:` for images and media. An installed official pack is the exception: its files are read
from `/assets/local/themes/<id>/` on this origin. The skeleton stays that URL, because pixi-spine finds the
atlas beside it. [ASSUMED]

## Pack

A `.zip` or a folder. `theme.json` sits at the root, or inside exactly one top-level folder (that folder's prefix
is stripped). Other files that the manifest does not name are ignored and listed. `spTheme` is the number `1`.

```json
{
  "spTheme": 1,
  "id": "iron-fan",
  "name": "主题名",
  "author": "作者",
  "version": "1.0.0",
  "description": "一句话",
  "thumbnail": "thumb.png",
  "preview": "preview.png",
  "colors": { "skinLightColor": "#00FFC4" },
  "tokens": { "--mint-400": "#9fd0c4" },
  "images": { "shop_main": "ui/shop.png", "prep_ready": { "src": "ui/ready.png", "slice": [12, 24, 12, 24] } },
  "banners": { "gameStart": "fx/start.webp", "rest": { "src": "fx/rest.webp", "slice": [8, 9, 10, 11] } },
  "voice": { "AUTOCHESS_GAME_START": ["v/start1.ogg", "v/start2.ogg"] },
  "character": { "image": "ui/char.webp" }
}
```

`id` matches `^[a-z0-9][a-z0-9_-]{0,39}$`. `terminal` is reserved for the built-in look. `name` is required.
`author`, `version` and `description` are optional. A bad value of those four refuses the whole pack. A bad colour,
token, image or voice line drops that key and keeps the rest.

Images: `.png` `.jpg` `.jpeg` `.webp` (animated WebP and APNG play in the browser). Audio: `.ogg` `.mp3`.
`slice` is four integers, CSS pixels, top / right / bottom / left, drawn as `border-image` with no `fill` so the
centre stays the element's own fill. A banner may be a path or the same `{ "src", "slice" }` object as an image.
The official 卫戍协议终端 pack (`ac_n_initial`) is the exception on the ready button, the 联防 plate and the result box:
there its sliced sprites are drawn as the game draws them, whole (`fill`), with none of our fill or shadow under or
round them, so ready_bg's glow and round_bg's / bg_all's soft shadow lie over the field (GitHub #963).
`character` is optional. It is either `{ "image" }` (a path or `{ "src", "slice" }`) or
`{ "spine": { "skel", "atlas", "textures" }, "anims": { "idle", "voice": { "cn_001": "Happy" } } }`, not both.
A bad character drops that key and keeps the pack. A bad `anims` drops only `anims`.
An imported pack's Spine is built in the browser from its bytes (`public/js/themeSpine.js`, §37.232): the skeleton (`.skel` or a skeleton `.json`) and the `.atlas` are kept as they are, each atlas page is the `textures` file of the same name (one page and one picture of another name are paired anyway), and pixi-spine reads the version (3.7, 3.8, 4.x). A skeleton or atlas over 8 MB is refused.

`node tools/theme-template.mjs [dir]` writes a starter `theme.json` (every slot, banner and trigger, empty, and the
default colours). `node tools/theme-template.mjs --zip out.zip` wraps that file. The committed starter is
[examples/ui-theme/theme.json](examples/ui-theme/theme.json). It contains no official art. Importing it applies the
default hex colours, because those keys are present.

## Limits

[ASSUMED] `theme.json` ≤ 64 KB. `name` and `author` ≤ 40 characters. `description` ≤ 300. `version` is non-empty
printable text ≤ 32 characters (not strict semver). ≤ 400 files. ≤ 8 MB and ≤ 4096 px a side per image, decoded.
≤ 4 MB per audio file. ≤ 64 MB per pack. ≤ 8 imported packs. ≤ 8 voice lines per trigger. A same `id` replaces
that pack and does not count as a new one.

## Where it is kept

Packs live in this browser's IndexedDB (`sp-ui-themes`). The choice is the setting `uiTheme` (empty means the
built-in look). Every storage call is caught. When storage is blocked, the import still works for this visit and
the page says so. Switching applies at once. A missing file falls back to the built-in look for that slot only.

Design tokens (`tokens`) use the same allowlist and grammar as a cosmetic plugin (`shared/plugins/theme.js`,
`THEME_TOKENS` / `acceptThemeValue`). They are written on `<html>` and recolor every screen this player sees,
including the lobby. They do not recolor anyone else's screen.

## Colours

Official names from `skinColorDataDict`. A key with no element is accepted and reported unused
(`garrisonIconColor2`, `garrisonIconColor3`). A colour is painted only while that key is present, and only inside
the match (`.gm`).

| Key | Custom property | Where |
|---|---|---|
| `skinLightColor` | `--sp-c-skin-light` | shop funds accent, check button border, prep capsule, countdown (not the warning), shop level card, free refresh, ready button border, mint phase plate |
| `skinDarkColor` | `--sp-c-skin-dark` | shop bar top border, shop level card border |
| `bondColor` | `--sp-c-bond` | bond names and their icons on a regulation card (`.scard--reg .scard__bond`, the icon a mask in the text colour) while that card's chess-frame slot is present. Covenant cards stay dark and do not use it |
| `bondIconColor` | `--sp-c-bond-icon` | the glyph of the HUD bond discs (`.bond__glyph`). A 规程 shop card draws each bond's icon in its name's colour (`bondColor`), as the official cards of the three themes do |
| `chessNameColor` | `--sp-c-chess-name` | the operator name on a regulation card (`.scard--reg .scard__name`) while that card's chess-frame slot is present. The frame sprite's centre is the face, so 可露希尔's black words sit on it. Covenant cards do not use it |
| `saleColor1` | `--sp-c-sale-1` | sell label and the detail-panel price |
| `saleColor2` | `--sp-c-sale-2` | sell plate ink |
| `destroyColor1` | `--sp-c-destroy-1` | destroy label |
| `destroyColor2` | `--sp-c-destroy-2` | destroy plate ink |
| `countdownHintColor` | `--sp-c-countdown-hint` | countdown in the warning state |
| `obIconColor` | `--sp-c-ob` | spectator icon |
| `garrisonIconColor1` | `--sp-c-garrison-1` | garrison type chip |

The starter pack's colours are `ac_n_initial` (`skinLightColor` / `skinDarkColor` / `obIconColor` `#00FFC4`,
`bondColor` `#B7B7B7`, `bondIconColor` `#031712`, `chessNameColor` `#FFFFFF`, sale `#FFBA00` / `#3A2D0A`,
destroy `#DC3B3B` / `#290808`, countdown `#FF0000`, garrison `#FFFFFF33`).

## Images

A picture is a stretched background layered over the fill the element already has, unless the table says 9-slice,
frame, contain or icon. Chess frames with no `slice` use 8 px [ASSUMED] so the card centre stays empty. Level icons are a
`contain` overlay that replaces the chip (the octagon would show around a slanted icon). A *frame* is the whole picture
as a 9-slice on the element's `::before`, centre included, behind the content and over the element's fill, at the
official size: one prefab unit is .0144rem (`--sp-slice-rem-<slot>`; the client draws the official ~1334-unit canvas
1.44×). The element keeps its layout. Stretched whole, a sliced picture bent (可露希尔's window frame over the
本局信息 drawer, history §37.204).

| Slot | Official place | Our element | Draw |
|---|---|---|---|
| `hud_player_info` | player HUD | `.gtop__band` | stretch, or a frame when `slice` is set |
| `game_start` | game start | `.pboot__stage` | cover |
| `help_battle` | enemy intel | `.edrawer` | a frame when `slice` is set, otherwise contain. With 可露希尔's window frame the rows start under its title bar and the close button lies on its ✕ |
| `round_start` | round plate | `.mpop--round .mpop__panel` | stretch over the fill |
| `round_result` | result frame | `.rdialog__box` | 9-slice when `slice` is set, otherwise stretch. Give it a slice when `battleEnd` is also set, or the banner covers the stretch |
| `effect_choose_self_select` | self pick | `.spov__inner` | stretch |
| `img_check_player` | check, self | `.gtop__iconbtn` | stretch |
| `img_check_enemy` | check, enemy | `.enemybtn` | stretch |
| `countdown` | countdown | `.gtop__right .countdown` | contain |
| `countdown_effectchoose` | draft countdown | `.spov__turn .countdown` | contain |
| `countdown_outer` | clock frame | `.gtop__clock` | contain |
| `prep_ready` | ready | `.readybtn` | stretch, or 9-slice when `slice` is set |
| `shop_main` | shop row | `.shopbar__row` | stretch over the gradient. The official packs omit it: their named sprite is the ~200px end card, and none of the three shop prefabs has a plate at least 480×150 that is not a shadow or a deco strip [ASSUMED] |
| `boss_damage` | boss bar | `.bossbar` | stretch, or a frame when `slice` is set; the dark fill stays |
| `img_shop_sell_chess_normal` | sell | `.uframe__btn--sell .uframe__plate` | stretch |
| `img_shop_sell_chess_hover` | sell hover | the same plate on `:hover` | stretch |
| `chess_frame_normal` | frames 1–4 | `.scard--t1` … `.scard--t4` | 9-slice. On `.scard--reg` the same sprite is a full-bleed face (the centre shows); so on 盟约 cards for 乌萨斯齐心团 / 可露希尔, whose sprites are faces (§37.205) |
| `chess_frame_level_five` | frame 5 | `.scard--t5` | 9-slice; full-bleed on `.scard--reg` and on the face packs' 盟约 cards |
| `chess_frame_level_six` | frame 6 | `.scard--t6` | 9-slice; full-bleed on `.scard--reg` and on the face packs' 盟约 cards |
| `chess_level_icon_1` … `_6` | level icons | `.tier--1` … `.tier--6` | icon in place of the chip. On a 规程 card it has the official card's size: 64×64 for 可露希尔, 59×34 for 乌萨斯齐心团, 40×40 for ac_n_initial, .56rem square for another pack |
| `shop_level_1` … `_6` | (盟约) shop level box | `.lvcard.lvcard--1` … `.lvcard--6` `.lvcard__plate` | contained in the middle of the level card (1rem) (the sprite carries 「LEVEL」 and the numeral, so ours is hidden and 升级 moves to the bottom). The class follows `shop.level`. The official packs' sprites are their player detail level icon (`player_detail_shop_level_hub`); the 规程 升级 button does not use this slot, it draws the pack's own `group_upgrade` (below) |
| `char_spine_outer` | funds-card plate | `.funds__char--spine` | contained background behind a Spine. The host exists only when `character` is set. An image character does not also paint this plate. A pack that supplies a slice uses that 9-slice instead. The three official sprites have no Unity border [ASSUMED] |
| `shop_refresh` | (规程) refresh | `.shopbar--reg .toolbtn--amber` | stretch. Official packs omit it; the client uses `sprites/refresh_bg_normal.webp` from the active pack, else ac_n_initial |
| `shop_refresh_lock` | (规程) refresh locked | `.shopbar--reg .toolbtn--amber:disabled` | stretch. Fallback sprites: `bg_lock`, `refresh_bg_lock`, `refresh_bg_disable` |
| `shop_frozen` | (规程) freeze, the shop is not frozen (reads 冻结) | `.shopbar--reg .toolbtn--ice:not(.is-on)` | stretch. Sprite `frozen_bg_normal` |
| `shop_frozen_on` | (规程) freeze, the shop is frozen (reads 解冻) | `.shopbar--reg .toolbtn--ice.is-on` | stretch. Sprite `frozen_bg_unselect`, else `frozen_bg_unlock` |
| `shop_frozen_lock` | (规程) freeze unavailable | `.shopbar--reg .toolbtn--ice:disabled` | stretch. Sprite `bg_lock`, else `frozen_bg_disable` |
| `shop_money` | (规程) coin badge | `.shopbar--reg .funds__badge` | stretch. Sprite `bg_money` (ac_n_initial only; other packs use the CSS badge) |
| `shop_char_card` | (规程) character card | `.shopbar--reg .funds.funds--reg` | stretch. Plate: `bg_close` (default), `btn_big_close` (乌萨斯齐心团), `closure_back_active` (可露希尔), which is a cut-out: its prefab's `bg_open` (the navy CLOSURE screens) lies under it, 272/211 × 236/178 of the plate's box, right edges aligned, 8/178 up (`--reg-char-back*`, §37.235), instead of our dark green. iron's `bg_close.webp` is a 32×25 tip, skipped [ASSUMED] |
| `shop_cost_free` | (规程) free plate | `.scard--reg .scard__cost--free`, `.shopbar--reg .toolbtn__free` | stretch. Sprite `cost_free` |
| `shop_card_empty` | (both shops) a slot without a card: bought, or opened by an upgrade and not filled yet (not the reward row's 已选择) | `.shopbar .scard--vacant` (`SoldCard`, `EmptyCard`) | stretch over the card, or with `slice` a 9-slice on its `::before` whose centre shows too (`fill`; the card keeps its box). It hides our SOLD OUT text and the official empty card (§37.236). Official packs omit it: both shops draw the face pack's card prefab `state_empty` (below; a 盟约 card, about 130×187 against 154×186 at 1600×900, keeps the official card's proportions, §37.238) |
| `shop_shadow` | (both shops) the shop background's shadow | `.gm__hud > .shopbg::before` | stretched across the screen's bottom edge, 237 units high (ac_n_initial's `bg_shadow`, about 284 px at 1600×900); the official shadow layer steps aside (§37.238). Official packs omit it: the background is their `panel_shop_main` group (below) |
| `bond_strip` | (ours) bond strip | `.bstrip` | stretch |
| `detail_panel` | (ours) detail | `.dpanel` | stretch |

Accepted and reported unused, because this client has no element for them: `img_check_buff_back`,
`img_check_buff_normal`, `img_check_buff_count`, `win_streak`, `effect_choose_group_tip`,
`img_shop_sell_equip_normal`, `img_shop_sell_equip_hover`. `chess_level_icon_0` is not a slot (tiers here are
1–6). `shop_level_text_hub` (`lv_1`, `upgrade_lv_*`) is not a slot: the 规程 升级 button reads `upgrade_lv_N` from the pack.

The 规程 升级 button is each official pack's `panel_shop_main` `group_upgrade`, drawn layer by layer from the
prefab (normal, double-check after the first tap, disable, max; `ui/regHud.js` `regUpgradeModel`). A non-official theme
shows the ac_n_initial one when that pack is installed, else the same layout in CSS colours; no slot replaces it.

## Official packs

设置 → 界面主题 lists a card for each installed group `themes/ac_n_initial`, `themes/ac_n_iron`,
`themes/ac_s_closur` (`data/local-assets.json`), and for each official pack this browser imported (below). The card shows the thumbnail, the name below, an 「官方」 mark
and `skinDesc`. It is not deletable and it is not one of the 8 imported packs. A lite zip with no group shows
nothing extra. Choosing one fetches `theme.json` and the files it names, turns pictures and voice into blob
URLs, and plays a Spine from the served URL. The choice is still `settings.uiTheme`. A saved official id whose
group is missing returns to the built-in look with no “主题已损坏” notice. A fetch that fails does show that notice.

| id | Card | Character on `.funds` (目前资金) |
|---|---|---|
| `ac_n_initial` | 卫戍协议终端（官方贴图） | UI Spine `trap_1096_acshopup`, idle `Idle` |
| `ac_n_iron` | 乌萨斯齐心团 | unfolded `group_bg/char` portrait, file `sprites/char_2.webp` (127×157). `sprites/char.webp` is a different texture that shares the name |
| `ac_s_closur` | “全能的”可露希尔 | UI Spine `ac_s_closur_spine`. A voice line plays the `skinVoiceAnimDict` clip, then idle. The board trap `trap_2000_acclsr` is not this portrait |

### 可露希尔 is imported, not built in (§37.232)

The maintainer's decision of 2026-11-15 (「可露希尔主题可以支持单独导入吗，不想直接内置」): the full, update and asset zips leave out `themes/ac_s_closur` and its sprites in `ui/outer` (the skin preview, its background, the card thumbnail and nine stickers, which the client never draws), with their entries in the shipped `data/local-assets.json` (`tools/package.mjs` `HELD_THEME_GROUPS` / `HELD_THEME_ENTRIES`). A server of the packages therefore lists no 可露希尔 card. `node tools/package.mjs --theme-packs` writes the extracted group as `Stronghold-Protocol-v<version>-theme-ac_s_closur.zip` (every file the importer keeps, `layout.json` left out, and a Chinese / English `README.txt`); the maintainer offers it for download beside the asset pack, not as a release asset. A server that extracted the group from its own client still serves it as before.

设置 → 界面主题 → 导入主题包 (or 导入文件夹) takes that zip. A `theme.json` whose `id` is an official one is an official pack: `theme.json` is checked as an installed pack's is (only the files it names); every other file of type png, jpg, webp, ogg, mp3, json, atlas or skel is kept as well, because the prefabs name their sprites; anything else (the README) is listed as ignored. [ASSUMED] Limits: 1000 files, 64 MB, 8 MB for one JSON / atlas / skeleton, images and audio as above (`OFFICIAL_PACK_LIMITS`). A `prefabs.json` that is not `spPrefabs` 1 is refused and the pack keeps the hand-made HUD. The import is refused (「这台服务器已经带有这个官方主题」) when this server lists the group itself.

The pack is stored like any imported pack (IndexedDB `sp-ui-themes`) and does not count toward the 8. Its card is the official one (title, 「官方」 mark and line of the row above) with a 删除 button. Every stored file becomes a blob URL and the group is laid over the local manifest the screens read (`data.get('local')`, `ui/settings.js`; a group the server serves wins), so the prefab HUD, the 规程 card faces, the banners and the shop chrome find their sprites as they do for an installed pack. `shared/uiTheme.js` `officialAssetUrl` accepts a `blob:` URL for such a group only, and `ui/prefab/view.js` reads its `prefabs.json` already parsed (the page's connect-src is 'self': a blob is not fetched). The funds-card character and the window of the 联防 / result banners are its Spine, built from the bytes. A replaced or deleted pack's blob URLs are revoked two seconds later, once the page has moved on.

No `character` leaves the 盟约 funds box as it is today. With one, the 盟约 funds column keeps the cards' height: `contain: size` keeps its content from sizing the shop row, and the portrait shrinks into the room the money and 收起 leave (about 102×50 at 1600×900; §37.233 — the row used to grow and leave an empty band under the cards). On a 规程 match with no selected character, the card uses ac_n_initial's shop-up spine `trap_1096_acshopup` (idle `Idle`) when that group is installed. The portrait does not take taps (收起 stays the button). 规程 bond discs sit under the middle of the top bar (`.gm--reg .gm__bonds`).

## 规程 HUD from the official prefabs

With 乌萨斯齐心团 or 可露希尔 selected and installed, the top bar, the countdown and the ready button are that pack's own
prefabs (`group_hud`, `panel_countdown`, `panel_prep_ready`), drawn layer by layer from `themes/<id>/prefabs.json`
(`ui/prefab/`) — in every version: since §37.206 a 盟约 match wears the 规程 look in full with such a theme (the owner's
decision of 2026-11-14), `ui/regHud.js regLook`: the 规程 shop (its chrome, card faces, character plate), the top bar, the
round, result, 联防 and 轮到你选 banners, the bond rings and avatar badges, and the 规程 layout (`.gm--reg`: the bond row
under the top bar, the detail panel above the shop). What follows the rules stays with the version (`regulationFamily`):
the 规程 commands, the core groups and their briefing, the sweep's fourth tab. ac_n_initial, a custom theme and a pack
without `prefabs.json` (an asset pack extracted before 0.4.0) keep today's top bar (PR #643 / #827), countdown, ready
button. Shop cards use `autochess_shop_card_item` from `prefabs.json` when available, including ac_n_initial; a custom
theme or an older local pack without that prefab keeps the CSS card fallback.

## 规程 shop card faces

`ui/regHud.js regShopCardFaceModel` composes each card from its theme's `autochess_shop_card_item` and optional
`frame_lv1_obj`, `frame_lv2_obj`, `frame_lv3_obj` and `chess_level_5/6_obj`. RectTransform values go through
`ui/prefab/layout.js`; the card size, price anchor, tier box, name, profession mark, bonds, item watermark and item icon
follow the prefab coordinates for that theme. The operator card shows the profession mark and name, then vertical bonds;
it does not show the sub-profession. An item card shows its watermark, icon and name; its effect stays in the detail panel.
可露希尔's card has a `bkg` Image under the frame (155×187 centred on the 157×207 card) whose sprite the game sets at run time; [ASSUMED] it is drawn as its colour, white (`--scard-under*`, `cardBacking`, §37.235), so the frame's cut corner and side margins are light as in the official preview, not our dark green card fill. ac_n_initial's `bkg` is the sprite `bg_black` (155×187, the official dark card with fine lines), drawn as it is under its
hollow frame (§37.237; §37.235 took only its white colour and painted the 卫戍协议终端 cards white). 乌萨斯齐心团 has no `bkg`
and keeps the dark face. The backing belongs to the official theme's own look: it is drawn only while that theme is the
selected one (`backing: ownFace`), so a non-official theme, which borrows ac_n_initial's card prefab, keeps our dark face under
its frame.
A slot without a card (bought, or opened by an upgrade and not filled yet) shows the card prefab's one other state,
`state_empty` (§37.236, `regShopEmptyCardModel`): ac_n_initial `bg_empty` (158×187, 「[ NO INFO ]」), 乌萨斯齐心团
`card_empty` (173×200, 4 below the centre: its poster reaches past the card), 可露希尔 `bg_empty` (156×188, 「NO INFO」),
laid out on the card's prefab box like the face's layers; our hatching, frame and SOLD OUT text step aside (the
「已售出」 label stays for screen readers). The face pack is regChromeTheme's, so the default look and non-official themes
show ac_n_initial's; the lite package has no pack and keeps SOLD OUT. [ASSUMED] A bought slot shows it too: the prefab has
no other state for a slot without a card. On a 盟约 card (narrower) the official card's box keeps its proportions, as
wide as the card and centred (`.scard__emptybox`, §37.238); the lite package keeps SOLD OUT there too.
A 盟约 card under the selected official theme (卫戍协议终端, the only one that keeps the 盟约 shop) gets the same backing
under the whole card, its frame ring included (`has-backing`, `--scard-under*`; our gradient face steps aside, §37.238).

The shop background (§37.238, `regShopBackdropModel`, `ShopBackdrop`): the face pack's `panel_shop_main`
`state_unfold/group_bg` — the full-width bottom shadow `bg_shadow` (`shadow_total`, 237 units high, in ac_n_initial and
乌萨斯齐心团; `bg_shadow`, 351 high, in 可露希尔), 乌萨斯齐心团's `deco_left` (`back_left` 863×112) and 可露希尔's
`bg_deco` (1024×125), both bottom left — and 可露希尔's `matte_back` (414×372 bottom right, tinted #090909, under the whole
panel). group_bg's character-card layers are drawn on the character card. The nodes and their parents sit on the bottom
edge (the parents full width), so each is placed from the screen's bottom-left or bottom-right corner or stretched across,
at the top bar's scale (one unit = .0144rem). It is a sibling before the shop in the HUD (`.gm__hud > .shopbg`, z-index -1:
behind every HUD control, over the field, never taking a tap, out to the screen edges past the safe-area insets), shown with
the open shop of either kind (盟约 too: the default look and other themes get ac_n_initial's shadow), not with the
collapsed tab; the deploy fold's scale on the shop leaves it whole. The empty cards are translucent and sit on it as in the
official shop.

The three themes keep their own card dimensions and name colours. ac_n_initial has a hollow frame and no level-frame
prefabs; 乌萨斯齐心团's name sits at Unity y=32 with `#EFEBDF`; 可露希尔's name sits at y=42.5 with black ink. 可露希尔's
level-five/six frame pictures carry a static colour band but no TV and no footer text: the card draws frame_lv2_obj /
frame_lv3_obj's own layers (the scrolling bottom ramp, the TV, its front and 「CLOSURE × RHODES ISLAND」), as the official card does.
Level-five stars use `#FF9B0D`, level-six stars use `#00F6FF`; their Unity rotations are converted for CSS's y-down
coordinates. The 可露希尔 VI uses its `mask_text_vi` material at the prefab's `speed` and `tile` values on shop and detail
cards. Other small tier chips keep the shared Roman numeral.

- Layout: Unity's RectTransform (anchors, pivot, sizeDelta, anchoredPosition), Horizontal / Vertical layout groups,
  ContentSizeFitter, LayoutElement, RectMask2D (with softness), slider fills, CanvasGroup alpha, local scale and z
  rotation (`ui/prefab/layout.js`). One prefab unit is 0.01rem × 1.44, the official size at 16:9.
- Values go where the client's controllers put them, found by field name: `_roundText`, `_playerHpText`, `_loseHpGrp` /
  `_lostHpText` (the −N tag of the own battle's pending loss), `_enemyCurCountText` / `_enemyTotalCountText`,
  `_lostEnemyGrp` / `_lostEnemyText` (联防), `_bossHpSlider`, `_textCountDown`, `_progressBar` / `_progressImgsFill`.
  Words without a controller (回合, the stage words, 准备就绪 / 取消准备, the n/m splitter) are ours.
- States are the prefabs' status driver entries: `hud_rest_settled`, `hud_battle_settled`, `hud_coop`,
  `hud_boss_settled`; `countdown` / `ready_continue`, `cd_color_normal` / `cd_color_last` (≤ 10 s), `content_timer` /
  `content_single_plain` (the untimed solo rest; another untimed phase shows no countdown, as before). An entry's active switches apply, then each of its legacy AnimationClips is
  drawn at its end (a switch clip shown backwards at its start). The ready button is `btn_ready_switch` at its end
  (取消准备) or start (准备就绪).
- Images: simple, sliced (borders, `fillCenter`), tiled, filled; a coloured Image is tinted through its sprite's alpha
  (multiply); a sprite-less Image is a flat colour; same-name sprites use the node's own file (`image.file`). Texts:
  TextAnchor 0–8, best fit, the official fonts on Novecento Wide / Bender / the CJK faces, and each pack's bitmap
  number font glyph by glyph (`auto_chess_num_font`, `font_ac_s_iron_1`, `font_ac_s_closur_1`).
- Looping tween components (alpha, rotation, anchored position, size) play as CSS animations on opacity / translate /
  rotate / scale, only on layers that are not under a hidden (alpha 0) group. 设置「主题动画」 off
  (`sp.pref.settings.themeMotion`, default on; only `false` turns it off), or the system's reduce-motion, draws them still.
- The ready button sits on the countdown where both roots meet ([ASSUMED] one holder point: 可露希尔's button over the
  lower TV, 乌萨斯齐心团's under the tubes, as both previews show).
- Not drawn: particle systems (UIParticle), sprite-less Images with a shader material of their own (wireline glows,
  dissolves, flows), external sprites. [ASSUMED] `ready_continue` is the countdown once the own seat is ready;
  `root_sp`'s hand (a pointer under the TV) stays hidden, as in the previews; tween ease ids are DOTween's; the 1 % of
  weighted clip keys are read as plain Hermite ones.
- Clips play (`ui/prefab/player.js`): each legacy AnimationClip is sampled at 30 fps into Web Animations keyframes per
  node (opacity, visibility, transform, the graphic's opacity / colour), keeping only the frames the browser's linear
  interpolation cannot reproduce (`keptFrames`, `KEYFRAME_TOLERANCE`: opacity 1/1000, colour 1/500, 0.1 layout units,
  scale 1/2000, 0.02°; both frames around a visibility switch), so a 35 s loop is not a thousand keyframes a node
  (Firefox slowed to a few frames a second on 可露希尔's countdown, PR #973's measurement). A status that enters plays its clips (the top
  bar's `trans_*` when the mid screen switches, the countdown's switches); each node's PlayAutomatically clip loops
  while the node shows (wireline lights, wings, emoji). Effect-shader Images (sprite-less, a material of their own) are
  drawn as their base texture × colour × tint through the base and `_Mask_Tex` alpha, with the base's UV scroll; the
  textures that are not sprites are exported as `sprites/tex_<name>.webp` (prefabs.json `textures`).
- Banners (`ui/prefab/banners.js`): the round start (`banner/round_start`: the round rolls over, 获得 N, the 剩余 N 回合
  tag; its out clip is fitted into the plate's 0.28 s fold so it still leaves inside 回合开始), the round result
  (`banner/round_result`: 全员无伤！ / 生命值减少 −N / 作战结束), the 联防 plate (`banner/help_battle`) and 轮到你选
  (`banner/effect_choose_self_select`, when the team 机变 pick reaches the seat). Each is laid out at its show clip's
  peak and plays its clips; 可露希尔's window shows the theme's UI Spine (idle). 乌萨斯齐心团's 机变 countdown is its
  `panel_countdown_effect_choose`. The 规程 bond discs wear the pack's `bg_active` / `bg_inactive` rings.
- Not drawn yet: `game_start` (the 协议启动！ screen stays), `playeravatar/panel_win_streak` and `panel_boss_damage`
  (完美连胜 and the leader-damage ranking are not tracked by this server), particle systems.
- `/dev/prefab-lab.html?theme=ac_s_closur&sample=1` draws every prefab of a pack with a status picker.

## Banners

`skinEffectPreviewDict`: 9 模拟开始, 4 休整, 5 完美作战, 1 联防, 2 机变, 3 作战结束, 7 完美连胜, 6 最终攻势,
8 领袖伤害. The picture replaces the plate's art. The words stay ours. `perfectStreak` is accepted and unused.
A `{ "src", "slice" }` banner is a 9-slice on that same plate (no `fill`). A plain path still stretches.

| Key | Plate |
|---|---|
| `gameStart` | `.pboot` during 协议启动, and the phase banner when that screen has no boot art |
| `rest` | accepted but not drawn: since PR #946 the 休整期 has no central phase banner (round start plays `RoundPopup`) |
| `effectChoose` | accepted but not drawn: the 机变 has no central phase banner (the turn cue is 「轮到你选」) |
| `coop` | the 联防 plate |
| `battleEnd` | the round result box |
| `perfect` | the same box when the tone is mint (全员无伤). If the pack has no `perfect`, `battleEnd` stays |
| `finalAssault` | the 最终攻势 plate |
| `bossDamage` | the boss capsule |

## Voice

Rows copied from `skinVoiceTriggerDataDict` (activity table, `autoChessData`, 规程, season-independent).
[ASSUMED] `cd` is seconds. [ASSUMED] the smaller priority number wins, and one line plays at a time. A line on
cooldown does not roll. Volume follows the voice slider (`voice²`, silent when muted or the slider is 0).
[ASSUMED] a buy of a copy you already own speaks `AUTOCHESS_SAME_OPERATOR` only. Otherwise tier ≥ 4 is the high
line and anything else, including a missing tier, is the low line. One buy, one trigger.

| Trigger | p | cd | pri | When |
|---|---|---|---|---|
| `AUTOCHESS_GAME_START` | 1 | 0 | 1 | 协议启动, or the first round's 回合开始 when the page opened before that |
| `AUTOCHESS_REST_BOSS` | 1 | 0 | 2 | 休整期 of the boss round, before the fight |
| `AUTOCHESS_ALLIANCE_LEVEL` | 1 | 0 | 3 | a bond's `layers` increased |
| `AUTOCHESS_SHOP_UPGRADE` | 1 | 10 | 4 | shop level increased |
| `AUTOCHESS_REST_NO_HP_LOSS` | 0.8 | 200 | 5 | first 休整期 after a fight whose LP did not fall |
| `AUTOCHESS_REST_HIDDEN_BOSS` | 1 | 0 | 6 | 休整期 of the hidden round. A round that is both boss and hidden uses the boss line |
| `AUTOCHESS_COUNTDOWN` | 0.5 | 0 | 7 | the countdown warning, once per deadline |
| `AUTOCHESS_REST_HP_LOSS` | 0.8 | 200 | 8 | first 休整期 after a fight whose LP fell |
| `AUTOCHESS_MERGE_TRIPLE` | 0.4 | 5 | 9 | a new triple-merge reward |
| `AUTOCHESS_SAME_OPERATOR` | 0.3 | 10 | 10 | bought a copy of an operator you already had |
| `AUTOCHESS_BUY_OPERATOR_HIGH` | 0.3 | 10 | 11 | bought a new operator of tier 4–6 |
| `AUTOCHESS_BUY_OPERATOR_LOW` | 0.2 | 10 | 12 | bought a new operator of a lower tier |
| `AUTOCHESS_FREEZE` | 0.5 | 15 | 13 | the shop froze (the rising edge) |

[ASSUMED] Opening the page already in 休整期 does not speak (a reconnect, or the dev mock). The first 休整期 of
the run, before any fight, is silent. LP is compared with the value from when the fight phase opened, because the
loss is applied at settlement, between that phase and the next prep.

## Match cue ownership

The shared multiplayer draft's `轮到你选` popup and sound have one owner in `screens/game.js`. It chooses the loaded
theme's `banner/effect_choose_self_select`, or the existing default disc when the theme has no such banner. The
choice overlay's persistent `当前轮到你决策` status and themed countdown remain separate from that transient popup.
Solo simulation and personal 教鞭 choices have no your-turn popup or sound. Rest, ordinary combat and entering a
draft do not create central phase banners; the phase stays visible in the HUD. Round, result, 联防 and boss banners
keep their existing roles. These display rules apply in every rules version and do not change theme pack formats.
