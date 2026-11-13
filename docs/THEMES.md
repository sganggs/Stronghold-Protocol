# THEMES.md — interface themes (界面主题)

界面主题是玩家在自己的浏览器里导入的界面皮肤。它只装饰这一台设备上的画面：不上传，服务器不参与，换哪台服务器都生效，其他玩家看不到，也不改对局。格式在下面。

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
`character` is optional. It is either `{ "image" }` (a path or `{ "src", "slice" }`) or
`{ "spine": { "skel", "atlas", "textures" }, "anims": { "idle", "voice": { "cn_001": "Happy" } } }`, not both.
A bad character drops that key and keeps the pack. A bad `anims` drops only `anims`.

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
| `bondColor` | `--sp-c-bond` | bond names on a regulation card (`.scard--reg .scard__bond`) while that card's chess-frame slot is present. Covenant cards stay dark and do not use it |
| `bondIconColor` | `--sp-c-bond-icon` | bond glyph text. A glyph that is an image uses a filter, so this colour tints the text fallback |
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

A picture is a stretched background layered over the fill the element already has, unless the table says 9-slice
or icon. Chess frames with no `slice` use 8 px [ASSUMED] so the card centre stays empty. Level icons are a
`contain` overlay that replaces the chip (the octagon would show around a slanted icon).

| Slot | Official place | Our element | Draw |
|---|---|---|---|
| `hud_player_info` | player HUD | `.gtop__band` | stretch |
| `game_start` | game start | `.pboot__stage` | cover |
| `help_battle` | enemy intel | `.edrawer` | stretch |
| `round_start` | round plate | `.mpop--round .mpop__panel` | stretch over the fill |
| `round_result` | result frame | `.rdialog__box` | 9-slice when `slice` is set, otherwise stretch. Give it a slice when `battleEnd` is also set, or the banner covers the stretch |
| `effect_choose_self_select` | self pick | `.spov__inner` | stretch |
| `img_check_player` | check, self | `.gtop__iconbtn` | stretch |
| `img_check_enemy` | check, enemy | `.enemybtn` | stretch |
| `countdown` | countdown | `.gtop__right .countdown` | stretch |
| `countdown_effectchoose` | draft countdown | `.spov__turn .countdown` | stretch |
| `countdown_outer` | clock frame | `.gtop__clock` | stretch |
| `prep_ready` | ready | `.readybtn` | stretch, or 9-slice when `slice` is set |
| `shop_main` | shop row | `.shopbar__row` | stretch over the gradient. The official packs omit it: their named sprite is the ~200px end card, and none of the three shop prefabs has a plate at least 480×150 that is not a shadow or a deco strip [ASSUMED] |
| `boss_damage` | boss bar | `.bossbar` | stretch; the dark fill stays |
| `img_shop_sell_chess_normal` | sell | `.uframe__btn--sell .uframe__plate` | stretch |
| `img_shop_sell_chess_hover` | sell hover | the same plate on `:hover` | stretch |
| `chess_frame_normal` | frames 1–4 | `.scard--t1` … `.scard--t4` | 9-slice. On `.scard--reg` the same sprite is a full-bleed face (the centre shows) |
| `chess_frame_level_five` | frame 5 | `.scard--t5` | 9-slice; full-bleed on `.scard--reg` |
| `chess_frame_level_six` | frame 6 | `.scard--t6` | 9-slice; full-bleed on `.scard--reg` |
| `chess_level_icon_1` … `_6` | level icons | `.tier--1` … `.tier--6` | icon in place of the chip. On a 规程 card it has the official card's size: 64×64 for 可露希尔, 59×34 for 乌萨斯齐心团, 40×40 for ac_n_initial, .56rem square for another pack |
| `shop_level_1` … `_6` | (盟约) shop level box | `.lvcard.lvcard--1` … `.lvcard--6` `.lvcard__plate` | contained in the middle of the level card (1rem) (the sprite carries 「LEVEL」 and the numeral, so ours is hidden and 升级 moves to the bottom). The class follows `shop.level`. The official packs' sprites are their player detail level icon (`player_detail_shop_level_hub`); the 规程 升级 button does not use this slot, it draws the pack's own `group_upgrade` (below) |
| `char_spine_outer` | funds-card plate | `.funds__char--spine` | contained background behind a Spine. The host exists only when `character` is set. An image character does not also paint this plate. A pack that supplies a slice uses that 9-slice instead. The three official sprites have no Unity border [ASSUMED] |
| `shop_refresh` | (规程) refresh | `.shopbar--reg .toolbtn--amber` | stretch. Official packs omit it; the client uses `sprites/refresh_bg_normal.webp` from the active pack, else ac_n_initial |
| `shop_refresh_lock` | (规程) refresh locked | `.shopbar--reg .toolbtn--amber:disabled` | stretch. Fallback sprites: `bg_lock`, `refresh_bg_lock`, `refresh_bg_disable` |
| `shop_frozen` | (规程) freeze, the shop is not frozen (reads 冻结) | `.shopbar--reg .toolbtn--ice:not(.is-on)` | stretch. Sprite `frozen_bg_normal` |
| `shop_frozen_on` | (规程) freeze, the shop is frozen (reads 解冻) | `.shopbar--reg .toolbtn--ice.is-on` | stretch. Sprite `frozen_bg_unselect`, else `frozen_bg_unlock` |
| `shop_frozen_lock` | (规程) freeze unavailable | `.shopbar--reg .toolbtn--ice:disabled` | stretch. Sprite `bg_lock`, else `frozen_bg_disable` |
| `shop_money` | (规程) coin badge | `.shopbar--reg .funds__badge` | stretch. Sprite `bg_money` (ac_n_initial only; other packs use the CSS badge) |
| `shop_char_card` | (规程) character card | `.shopbar--reg .funds.funds--reg` | stretch. Plate: `bg_close` (default), `btn_big_close` (乌萨斯齐心团), `closure_back_active` (可露希尔). iron's `bg_close.webp` is a 32×25 tip, skipped [ASSUMED] |
| `shop_cost_free` | (规程) free plate | `.scard--reg .scard__cost--free`, `.shopbar--reg .toolbtn__free` | stretch. Sprite `cost_free` |
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
`themes/ac_s_closur` (`data/local-assets.json`). The card shows the thumbnail, the name below, an 「官方」 mark
and `skinDesc`. It is not deletable and it is not one of the 8 imported packs. A lite zip with no group shows
nothing extra. Choosing one fetches `theme.json` and the files it names, turns pictures and voice into blob
URLs, and plays a Spine from the served URL. The choice is still `settings.uiTheme`. A saved official id whose
group is missing returns to the built-in look with no “主题已损坏” notice. A fetch that fails does show that notice.

| id | Card | Character on `.funds` (目前资金) |
|---|---|---|
| `ac_n_initial` | 卫戍协议终端（官方贴图） | UI Spine `trap_1096_acshopup`, idle `Idle` |
| `ac_n_iron` | 乌萨斯齐心团 | unfolded `group_bg/char` portrait, file `sprites/char_2.webp` (127×157). `sprites/char.webp` is a different texture that shares the name |
| `ac_s_closur` | “全能的”可露希尔 | UI Spine `ac_s_closur_spine`. A voice line plays the `skinVoiceAnimDict` clip, then idle. The board trap `trap_2000_acclsr` is not this portrait |

No `character` leaves the 盟约 funds box as it is today. On a 规程 match with no selected character, the card uses ac_n_initial's shop-up spine `trap_1096_acshopup` (idle `Idle`) when that group is installed. The portrait does not take taps (收起 stays the button). 规程 bond discs sit under the middle of the top bar (`.gm--reg .gm__bonds`).

## Banners

`skinEffectPreviewDict`: 9 模拟开始, 4 休整, 5 完美作战, 1 联防, 2 机变, 3 作战结束, 7 完美连胜, 6 最终攻势,
8 领袖伤害. The picture replaces the plate's art. The words stay ours. `perfectStreak` is accepted and unused.
A `{ "src", "slice" }` banner is a 9-slice on that same plate (no `fill`). A plain path still stretches.

| Key | Plate |
|---|---|
| `gameStart` | `.pboot` during 协议启动, and the phase banner when that screen has no boot art |
| `rest` | the 休整期 phase banner |
| `effectChoose` | the 机变 phase banner |
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
