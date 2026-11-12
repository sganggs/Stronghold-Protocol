# THEMES.md — interface themes (界面主题)

界面主题是玩家在自己的浏览器里导入的界面皮肤。它只装饰这一台设备上的画面：不上传，服务器不参与，换哪台服务器都生效，其他玩家看不到，也不改对局。格式在下面。

An **interface theme** is a pack this browser imported. It is not a plugin. A plugin is installed by the server's
owner in `plugins/` ([PLUGINS.md](PLUGINS.md)): a cosmetic plugin can be room-wide or personal and may replace
operator art, models and voices. A theme cannot change gameplay, the battle record, `cs` / `vs`, or operator /
enemy art. It restyles panels, colours, phase plates and a few voice lines on this screen only.

The built-in look is 「卫戍协议终端」 (`ac_n_initial` in the official activity table). Choosing it clears the pack.
Nothing in a pack is read as CSS, HTML or script. A path is never fetched: no `http`, no `..`, no absolute path.
Images and audio become `blob:` URLs. The page's CSP already allows `blob:` for images and media.

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
  "banners": { "gameStart": "fx/start.webp" },
  "voice": { "AUTOCHESS_GAME_START": ["v/start1.ogg", "v/start2.ogg"] }
}
```

`id` matches `^[a-z0-9][a-z0-9_-]{0,39}$`. `terminal` is reserved for the built-in look. `name` is required.
`author`, `version` and `description` are optional. A bad value of those four refuses the whole pack. A bad colour,
token, image or voice line drops that key and keeps the rest.

Images: `.png` `.jpg` `.jpeg` `.webp` (animated WebP and APNG play in the browser). Audio: `.ogg` `.mp3`.
`slice` is four integers, CSS pixels, top / right / bottom / left, drawn as `border-image` with no `fill` so the
centre stays the element's own fill.

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
| `bondColor` | `--sp-c-bond` | bond name on a shop card and on the bond strip |
| `bondIconColor` | `--sp-c-bond-icon` | bond glyph text. A glyph that is an image uses a filter, so this colour tints the text fallback |
| `chessNameColor` | `--sp-c-chess-name` | shop card name |
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
`contain` overlay; the official chip stays underneath.

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
| `shop_main` | shop | `.shopbar__row` | stretch over the gradient |
| `boss_damage` | boss bar | `.bossbar` | stretch; the dark fill stays |
| `img_shop_sell_chess_normal` | sell | `.uframe__btn--sell .uframe__plate` | stretch |
| `img_shop_sell_chess_hover` | sell hover | the same plate on `:hover` | stretch |
| `chess_frame_normal` | frames 1–4 | `.scard--t1` … `.scard--t4` | 9-slice |
| `chess_frame_level_five` | frame 5 | `.scard--t5` | 9-slice |
| `chess_frame_level_six` | frame 6 | `.scard--t6` | 9-slice |
| `chess_level_icon_1` … `_6` | level icons | `.tier--1` … `.tier--6` | icon overlay |
| `bond_strip` | (ours) bond strip | `.bstrip` | stretch |
| `detail_panel` | (ours) detail | `.dpanel` | stretch |

Accepted and reported unused, because this client has no element for them: `img_check_buff_back`,
`img_check_buff_normal`, `img_check_buff_count`, `char_spine_outer`, `win_streak`, `effect_choose_group_tip`,
`img_shop_sell_equip_normal`, `img_shop_sell_equip_hover`.

## Banners

`skinEffectPreviewDict`: 9 模拟开始, 4 休整, 5 完美作战, 1 联防, 2 机变, 3 作战结束, 7 完美连胜, 6 最终攻势,
8 领袖伤害. The picture replaces the plate's art. The words stay ours. `perfectStreak` is accepted and unused.

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
