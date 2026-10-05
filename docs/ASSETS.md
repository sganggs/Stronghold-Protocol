# Assets: sources, layout, manifest, credits

Owner: `tools/fetch-assets.mjs` and `tools/assets/*`. Research background: `docs/research/07-assets.md`.

All art, Spine models and audio are **downloaded at install time**. They are never committed; `public/assets/` is git-ignored.
Everything the client needs is listed in **`data/assets.json`**. The client should only request URLs that appear in that manifest.

## Running

```bash
npm install          # also vendors pixi / pixi-spine / preact / three (tools/vendor.mjs; three.js is fetched by
                     # browsers only when data/local-assets.json lists the board atlas — the 3D board, DESIGN §15)
npm run assets       # = node tools/vendor.mjs && node tools/fetch-assets.mjs
```

| Option | Effect |
|---|---|
| `--concurrency=N` | Parallel downloads (default 16). |
| `--force` | Re-download everything. |
| `--offline` | No network. Re-runs post-processing (atlas fixes, skeleton parsing, WOFF2) on what is already on disk, then rebuilds `data/assets.json`. |
| `--dry-run` | Print the plan (file and model counts, alias notes) and exit. |
| `--refresh-index` | Re-download the two upstream indexes: `audio_data.json` and `models_data.json`. |
| `--prune` | Delete files under `public/assets/` that the manifest no longer references, for example after a mapping change. Without this flag they are only listed in the report. `public/assets/local/` (written by `tools/local-extract`) is never pruned. Implies `--allow-shrink`. |
| `--allow-shrink` | Write `data/assets.json` even when it loses entries the current one has (see "The manifest never shrinks by accident" below). |
| `--local-spines` | Rewrite `tools/assets/local-enemy-spines.json` (the metadata of the enemy models only the local client has, see "Enemy aliases") from the models `tools/local-extract/extract.py` extracted to `public/assets/local/spine/enemy/`. Run it after a game update changed them; without it the committed file is used and a differing extraction only gets a warning. |

**The manifest never shrinks by accident.** An entry whose files are missing on this machine is left out of a rebuilt
manifest, so a run where some downloads failed (or whose upstream audio / model index lost them) would drop entries that
every other install still has from the committed `data/assets.json` (a pull request once carried such a manifest, 42
audio entries short — all 42 still resolve upstream; PR #7). When the rebuilt manifest lacks an entry of the current
one, the run keeps the current file, prints the entries it would drop (also in the report: `droppedEntries`,
`manifestWritten: false`) and exits 1. Re-run to retry the downloads, or pass `--allow-shrink` (or `--prune`) when the
smaller manifest is intended, for example after a mapping change. Build fields (`version`, `hash`, `generator`,
`stats`), new entries and a changed value are never a drop (`tools/assets/manifest.mjs droppedEntries`).

The script is **idempotent**. A file on disk is kept, not re-downloaded, when any one of these holds:
- its size matches the ledger entry from a previous download (`.cache/assets-ledger.json`);
- its size matches the byte count recorded in research;
- no size is known, but the file passes format validation. Validation checks the PNG signature and `IEND`, the MP3 header, the sfnt header, the atlas page line, and that a skel is not an HTML error page.

Every download is written to a temp file, then renamed into place. A partial download therefore never reaches its final path.

How downloads are fetched:
- 16 connections at a time.
- Each source gets 3 attempts with exponential backoff.
- If `raw.githubusercontent.com` fails, the jsDelivr mirror (`cdn.jsdelivr.net/gh/…`) is tried.
- There is no mirror for the ArknightsAssets2 `voice` branch, because jsDelivr returns 404 for it.
- A manifest entry with fallbacks (for example an enemy icon that falls back to its base enemy's icon) only moves on to the next alternative after a **definitive 404**. When the primary fails transiently (network error, 5xx or an invalid payload after all retries), no fallback is fetched. The path is listed under `downloadErrors` in the report, and the next run retries the primary.
- A skeleton that fails to parse is deleted and removed from the ledger, so the next online run downloads it again.

The first run downloads about **269 MiB in about 4,000 files** (it took 134 s on a ~3 MB/s link before the 55 emote and 玩法说明 files, 21.3 MiB, were added). A re-run takes about 1 s.

Outputs:
- `data/assets.json`: the manifest (committed).
- `public/assets/**`: art and audio (git-ignored).
- `public/fonts/*`: fonts and `fonts.css`.
- `.cache/assets-report.json`: misses, fallbacks and notes from the last run.
- `.cache/spine-info.json`: skeleton parse cache.

The run exits with code 1 if any pool operator is missing its avatar, its portrait or its Front Spine.

Upstream indexes are cached under `.cache/`. They are downloaded when missing:
- `.cache/gamedata/excel/audio_data.json`, from `Kengxxiao/ArknightsGameData` (zh_CN).
- `.cache/ark-models/models_data.json`, from `isHarryh/Ark-Models`.

The research JSONs in `docs/research/` (03, 05, 07) define **which** ids are needed.

## What is downloaded

| Class | Source | Local path (under `public/assets/`) |
|---|---|---|
| Operator avatars, 180×180. Base, plus E2 when it exists. | yuanyan3060/ArknightsGameResource `avatar/` | `char/avatar/{charId}.png`, `char/avatar/{charId}_2.png` |
| Operator half-body portraits, 180×360 | yuanyan `portrait/` | `char/portrait/{charId}_1.png`, `_2.png` |
| Default-skill icons, including backup operators' skills | yuanyan `skill/` | `skill/{iconId sanitized}.png` |
| Enemy icons | yuanyan `enemy/`. Fallbacks: the handbook id, then the base id. | `enemy/icon/{enemyId}.png` |
| Token avatars | yuanyan `avatar/` | `token/avatar/{tokenId}.png` |
| Bond icons (the real autochess glyphs) | ArknightsAssets2 `cn` `ui/autochess/[uc]autochesscommon/arts/bondicon/`. Fallback: the camp logo. | `bond/{bondId}.png` |
| Shop item icons | AA2 `…/arts/shopitemicon/` | `item/{trapId}.png` |
| Band (strategy) icons | AA2 `…/arts/bandicon/` | `band/{bandId}.png` |
| Profession, sub-profession and battle-card icons | AA2 `arts/profession_hub`, `arts/ui/subprofessionicon`, `ui_battle_new/battlecard` | `prof/icon_{p}.png`, `prof/large_{p}.png`, `prof/battlecard_{p}.png`, `prof/sub/{subProfessionId}.png` |
| UI sprites (see below) | AA2 `ui/autochess/**`, `arts/**`, `activity/[uc]act2autochess/**`, `battle/[pack]common/sprites` | `ui/{group}/{key}.png` |
| The 36 battle emotes and the 19 玩法说明 (tutorial) pages, which `tools/local-extract` also extracts (GitHub issue #42: without the local client a server showed default emote icons) | AA2 `cn` `ui/emoticon/theme/[uc]{themeId}/icon/{picId}.png` (`shared/constants.js EMOTE_CATALOG`) and `arts/guidebookpages/[pack]autochess/{key}.png` (1024², shown at 16:9 like the local copies) | `ui/emoticon/{dir}/{picId}.png`, `ui/guide/{key}.png` |
| Operator battle Spine (Front, Back) | fexli/ArknightsResource `spine/{id}/{id}/{Front,Back}/` | `spine/op/{charId}/{front,back}/{stem}.{skel,atlas,png}` |
| Token Spine | fexli: the default model, or else the first skin variant (`spine/{tokenId}/{variant}/Spine/`) | `spine/token/{tokenId}/{stem}.*` |
| Enemy Spine (PC build, premultiplied alpha) | isHarryh/Ark-Models `models_enemies/{key}/`, file names from `models_data.json` | `spine/enemy/{enemyId}/{stem}.*` |
| Enemy Spine that no dump carries (灼热源石虫 / 炽焰源石虫) | the local client only (`tools/local-extract/extract.py ENEMY_SPINES`, optional); never downloaded and never required: an overlay of the web alias (`enemies[id].spineLocal`) | `local/spine/enemy/{enemyId}/{stem}.*` (listed in `data/local-assets.json`) |
| BGM | AA2 `voice` branch `audio/sound_beta_2/music/**` | `audio/bgm/{file}.mp3` |
| SFX (UI, battle, per unit) | AA2 `voice` `audio/sound_beta_2/**`, mapped from `audio_data.json` banks | `audio/sfx/{same sub-path}.mp3` |
| Fonts: Bender Regular and Light, Novecento Wide | TimWangZi/The-font-of-Arknights | `public/fonts/*.{otf,ttf,woff2}`, `public/fonts/fonts.css` |

The `stem` of a Spine model is the upstream file name. Two examples: `char_107_liskam` has the stem `char_107_liskarm`, and `enemy_9032_aclionk` uses `enemy_1559_vtlionk`. The skel and atlas of a model always share one stem. pixi-spine locates the atlas by swapping the extension, so this matters.

### Id scope

- **Operators:** all 138 pool charIds from `activity_table` (`charShopChessDatas[*].charId ∪ backupCharId`), including hidden chess and backup operators.
- **Tokens:** the 20 pool tokens.
- **Enemies:** 253 ids planned, 252 in the manifest (心烛 has no assets). The set is the union of:
  - the 07 enemy list;
  - every enemy in the `act1autochess_*` wave, boss and 联防 levels that act2 modes use (from `05-maps.json`; the tutorial is excluded);
  - the bosses (`boss_1..10`);
  - the closure of their summons (`randomEnemyAttribute` spawns and blackboard `enemy_key` references);
  - every key of `data/enemies.json` (built by `tools/build-data.mjs`, when present), which adds for example the enemies swapped in by 机变 effects;
  - the bosses' handbook/model ids, such as `enemy_1559_vtlionk`;
  - enemy units spawned by operator kits (research 03 skills/talents). For example, 隐德来希's default S3 summons 心烛 `enemy_5601_entlec` through the talent key `take_extra_enemy_key`. 心烛 has no icon and no Spine in any dump, so it has no manifest entry: it is reported as a miss, and the client must draw a glyph.
- **Extra tokens:** any `token_*` key of `data/tokens.json` that research does not list gets the default avatar and Spine locations.
  - The non-token summons in that file (`enemy_9012_acloon` 炎佑, `char_605_cmedic`, `char_613_acmedc`) are found under `enemies` and `chars`.
- **Skill icons:** the default skill of every chess (`defaultSkillIndex`), plus each backup operator's `skillIndex`. That makes 144 icons.
- **UI:**
  - every group from `07-assets.json → autochessUi`: rarity, elite and chess-level sprites, the shop panel and cards, HUD, bond board, equip slot, round dialog, band choose, settlement, prepare backdrop;
  - `arts` (rarity stars, elite icons, the camp logos of pool nations, the loading illustrations used by the act2 modes, battle common sprites, act2 entry backdrops and season logo, item rarity frames);
  - extras (`tools/assets/plan.mjs UI_EXTRAS`): mode choice art, battle-ready backdrops, battle UI (speed, pause, HP slider, attack range, boss avatar frame, skill ready), `empty_skill`, the 机变 panel and cards, the equip-replace dialog, the bond detail dialog, the prep-ready panel, stage-info titles, the 36 battle emotes (`emoticon/{dir}/{picId}`) and the 19 玩法说明 pages (`guide/{key}`) — these two keyed by the group and name of `data/local-assets.json`.

## Post-processing

- **Atlases** (research 07 §5.3):
  - Insert `size: W,H` right after each page name. fexli atlases omit it; the value is read from the PNG header. An existing size that disagrees with the PNG is corrected.
  - Ark-Models enemy atlases get `pma: true`, because their textures are premultiplied. pixi-spine reads this and sets `ALPHA_MODES.PMA`.
  - Page names are sanitized to safe file names.
  - All of this is idempotent.
- **Skeletons:** every `.skel` (Spine 3.8.99 binary) is parsed in Node with `@pixi-spine/runtime-3.8`, the parser the client ships.
  - The parse extracts animation names and durations, event names, `OnAttack` times per animation, and bounds.
  - Attachment paths are checked against the atlas regions.
  - Then the animation-role resolver runs. See `tools/assets/anim-roles.mjs` and research 07 §5.4.
- **Fonts:** OTF/TTF files are converted to WOFF2 by a built-in encoder (`tools/assets/woff2.mjs`: Brotli with null transforms).
  - Its output was verified lossless against Google's reference `woff2` decoder.
  - `fonts.css` lists WOFF2 first and falls back to the original file.
- Images stay PNG. WebP conversion is not done: it would need a native dependency.

## Manifest schema (`data/assets.json`)

All paths are URL paths relative to the site root, for example `/assets/char/avatar/char_002_amiya.png`. **Only entries whose files exist on disk are emitted.** When a key is missing, the client should use its fallback (research 07 §5.6).

```js
{
  version: 1,                       // schema version
  hash: 'a1b2c3d4e5f6',             // content hash (cache busting)
  generator: 'tools/fetch-assets.mjs',
  stats: { files, bytes, chars, charsWithBack, enemies, enemiesWithSpine, tokens, tokensWithSpine,
           spineModels, bonds, items, bands, skills, ui, sfxUnits },
  chars:   { [charId]: { avatar, avatarE2?, portrait, portraitE2?, spine: { front: Spine, back?: Spine } } },
  enemies: { [enemyId]: { icon, spine?: Spine, spineAliasOf?: enemyId,
                          spineLocal?: { group, skel, atlas, textures, …Spine } } },
                          // spineLocal: an optional local-client model; file names in a data/local-assets.json group,
                          // not URLs, and always emitted (independent of the disk) — "Enemy aliases" below
  tokens:  { [tokenId]: { owner: charId|null, avatar?, spine?: Spine, spineVariant?: string } },
  bonds:   { [bondId]: url },       // white glyphs; tint in CSS/canvas
  items:   { [trapId]: url },
  bands:   { [bandId]: url },
  skills:  { [iconId]: url },       // iconId = skill_table iconId ?? skillId
  skillsById: { [skillId]: iconId },
  ui:      { ['group/key']: url },  // e.g. 'hudPanel/icon_hp', 'shopCard/frame_lv1', 'loading/loading_ac_core';
                                    // 'emoticon/basic/pic_happy_battle', 'guide/autochess_home_1': the data/local-assets.json
                                    // group + name of the same picture (the client takes the local one first)
  prof:    { icon: {caster…warrior}, large: {…}, battlecard: {…, token}, sub: {[subProfessionId]: url} },
  audio: {
    bgm:     { lobby, prep, combat, unite?: { intro?, loop }, boss: { intro?, loop } },
             // intro then crossfade to loop (1 s); `unite` = 联防's own track — the official
             // escaped_single / escaped_multi levels declare `bgmEvent = corrosion` (卡西米尔 act13d5d0),
             // so the rescue phase does not reuse the 作战's track (audio.js bgmKeyFor 'unite', falling
             // back to `bgm.combat` for a manifest that lacks it)
    bossBgm: { [bossId]: { intro?, loop } },                   // per-boss track of its R14/R15 level
    sfx: {
      ui:     { click, back, confirm, tab, pick, drop, error, buy, sell, income, refresh, freeze, levelup,
                merge, equip, itemMerge, bondUp, artPlace, ready, timer, draft, yourTurn, yourTurnCircle,
                target, broadcast, danger, emote, roundStart, rest, battleStart, battleStartBoss,
                bossRoundTeam, bossRoundSingle, bossRoundSecret, killBoss, killBossAll, killBossNormal,
                defenceStart, defenceUnite, battleOverReduce, battleOverNoReduce, battleOverNormal, goFirst,
                disconnect, settlementSucceed, settlementFail, settlementTeam, settlementBossSign,
                goodEvaluation, load, start, matchSucceed, matchFail, matchCancel, joinRoom },
      battle: { deploy, tokenDeploy, charDie, enemyDie, enemyDieHeavy, enemyHit, heal, win, lose, killCoin },
      units:  { [charId|tokenId|enemyId]: { attack?, hit?, skill?, skills?: {[skillIndex]: url}, die?, born?,
                mix?: { [attack|hit|die|born]: { p?, vol? } } } }
    }
  },
  // units' mix (tools/assets/audio.mjs bankMix; community report #30): the official bank of a role's sound — `p` = the weight
  // of its sounds that have a file over all weights (an empty asset is a chance of silence: 猎狗pro / 深池侦察犬 0.2), `vol` =
  // the played file's volume (妖怪 0.7); only values other than 1. public/js/audio.js plays the role with chance p at its
  // base gain × min(1, vol)
  // units' attack / hit (tools/assets/audio.mjs pickUnitSfx): operators get normal-mode banks only — the plain
  // `attack` / `combat` ability first, never a bank holding a skill-mode file (`_d` / `_h` / `_s`; the normal attack's end
  // in `_n`) — with their own projectile banks (ON_PROJECTILE_BORN / _HIT.projectile_chr_<name>) as fallbacks
  // (DESIGN §18.4: 纯烬艾雅法拉's S3 impact used to be her `hit`); enemies and tokens take the first attack-like bank
  fonts: { css: '/fonts/fonts.css', faces: { [name]: { family, weight, woff2?, original } } }
}
```

### The `Spine` object

```js
{
  skel, atlas, textures: [url],       // load with PIXI.Assets.load(skel); atlas/png sit next to it
  pma: boolean,                       // true for enemies (atlas already carries `pma: true`)
  anims: Roles,                       // resolved roles, below
  animations: { [name]: seconds },    // every animation with its duration
  events: [name],                     // e.g. ['OnAttack', 'OnStart']
  hits: { [animName]: [seconds] },    // OnAttack event times (apply damage / spawn projectile)
  bounds: { x, y, width, height } | null  // skeleton AABB (setup pose, skeleton units)
}
```

The enemies' attack clip lengths are also a data input: `tools/build-data.mjs` copies each enemy model's
`anims.attack.loop` length and first `hits` time into data/enemies.json `attackAnim` (the sim stands an unblocked
ranged enemy for that clip, GitHub #58; docs/DATA.md §9) — rebuild the data after a manifest change that touches them.

### The `Roles` object

```js
Clip      = { begin: string|null, loop: string, end: string|null, via?: 'combat'|'attackAny'|'skill'|'idle'|'attack' }
SkillClip = Clip & { index: number /* 0-based skill index */, idle: string|null /* Skill_n_Idle */ }
Roles = {
  idle: string, deploy: string,
  attack: Clip,            // play begin once, loop per attack, end when stopping; `via:'idle'` ⇒ add a flash
  attackDown: Clip|null,   // _Down variants (target below the unit)
  skill: SkillClip|null,   // for the chess's default skill (primary index)
  skills?: { [index]: SkillClip },   // when the char is used with several default skills (backups)
  die: string|null,        // null ⇒ a Back model gives way to the Front model's Die (DESIGN §22.1); any other
                           //   skeleton holds its idle's first frame while it fades out
  move: Clip|null,         // enemies: Move_Begin|Move_Start + Move_Loop|Move + Move_End → Run_*
  stun: Clip|null          // null ⇒ freeze the track (timeScale 0)
}
```

`via` marks a fallback:

| `via` | The attack is actually… |
|---|---|
| `combat` | `Combat` |
| `attackAny` | a numbered attack such as `Attack_01`, possibly framed by `Attack_Begin`/`Attack_End` (`char_1045_svash2`) |
| `skill` | `Skill_1_Loop` (pure supporters) |
| `idle` | `Idle` (no attack animation at all) |

On a skill clip, `via: 'attack'` means the model has no skill animation, so the attack clip is reused.
A skill clip may also come from directional-only animations when a model has no undirected ones: for example `Skill_Right_Loop` (`char_279_excu`) or `Skill_Loop_Up` (the Back model of `char_431_ashlok`).

The resolver's full precedence list is in the header of `tools/assets/anim-roles.mjs`.

The manifest roles describe a unit's first form. Units whose skeleton holds another form's clip set get it from
`public/js/render/units.js FORMS` (keyed by Spine id, switched by the `form` of the sim's 'phase' / 'ember' / 'revive'
/ 'telegraph' / 'stone' / 'substitute' / 'swap' / 'dollEnd' fx — `shared/protocol.js fxForm`; no client stage drops these fx: the runner keeps them through
catch-up frames and hidden tabs (`keepsState`), the game screen's pre-entry buffer (`keepEarly`) and the render engine's
event queue (`render/interp.js isCosmeticEvent`) too — or, for a view built mid-battle, UnitInfo `form`, which `render/app.js renderInfo` passes to the view; a
`change` clip plays once first, an `end` clip is timed from the fx's `dur` to finish as that state ends, keeping the
current form's death clip until the next form's fx). A blocked or revealed 隐匿 enemy is drawn solid: the sim sends the
stealth bit only while its 隐匿 is on:
- 掠海漂移体's crawl (`Change`, then `*_02`);
- 转译基底·α's three forms (`A_Die_B` / `_C` / `_D`, 2 s each, then `B_*` 寻仇者, `C_*` 幽灵, `D_*` 特战术师);
- the 深池逐火 embers (`Die`, then `Idle_2` / `Move_2` / `Die_2`; `Revive` ends as it stands up) and 假想敌：再生's puppet
  (`A_Die`, then `B_*`; `B_Revive`);
- the leaders' 重生: 锏 (`Revive1`, `Revive2` held, `Revive3`, then `B_*`), 扎罗 (`A_revive_1` / `_2` / `_3`, then `B_*`),
  “复仇者” (`Revive_Begin` / `_Loop` / `_End`), 杰斯顿 (`C1_Die`, then `C2_*`);
- 守墓石像 (the statue on `Sleep` [ASSUMED by name], then the flyer's `*_2`).
- the 傀儡师 operators' <替身> (form `doll` of the sim's 'substitute' / 'swap' / 'dollEnd' fx, DESIGN §22.11; the `*_B`
  clips draw the 替身's own slots and hide the 本体's): 归溟幽灵鲨 `Start_B` (it fades in), `Idle_B`, `Die_B` over its last
  second (it breaks apart and fades), `Die_B_2` when it is knocked out (it collapses), and the 本体 back on `Start_2` (a
  form's `leave` clip); 风丸 `Start_B`, `Idle_B` / `Attack_B` / `Die_B`, the 本体 back on `Start`. Facing up, 归溟幽灵鲨's
  Back skeleton has only `Idle_B` and `Start_2`, 风丸's `Start_B`, `Idle_B` and `Attack_B`: the missing clips are skipped.
  Neither Back skeleton has the 替身's death clip, so a 替身 knocked out lies on the Front model (like every knocked-out
  operator facing up, DESIGN §22.1) with its `Die_B_2` / `Die_B`: the view keeps the form it died in for that model and
  for one rebuilt while it lies down, although the sim resets the form right after the knock-out.

Not mapped (clip names ambiguous): “自在”, “巨大的丑东西”, 主角阵营角色 and “余音” (`*_A` / `*_B`: which of its two forms is A
is not known) keep their manifest clips.

Other renderer rules from research 07 §5.4–5.5:
- **Choosing the model:** Front when the unit faces right or down; Front mirrored when facing left; Back when facing up — while it stands: a dead or knocked-out operator falls and lies with the Front model unless its Back skeleton has a Die clip of its own (131 of the 135 have none; DESIGN §22.1, GitHub issue #25).
- **Attack speed:** set the attack `timeScale` to `duration / attackInterval`.
- **Model size:** every skeleton is drawn at one `UNIT.modelScale` (render/style.js, 320 skeleton units per tile), which stands for the official standard. The official client also scales each enemy model in its battle prefab: the Graphic / FaceSwitcher / Spine transforms multiply to 0.27 for most enemies and for the operators' battle skins, but not for all of them. For example, 威龙 is 0.16, 妖怪 0.20 and 青铜镜 0.6. The skeletons themselves carry no such scale, because every enemy SkeletonDataAsset uses 0.01. So an enemy is drawn × data/enemies.json `modelScale` (its prefab's product ÷ 0.27, see docs/DATA.md; user playtest #6: 威龙 used to be drawn 1.35× a 妖怪 instead of 1.08×), and its HP bar sits on that model: at its setup-pose bounds' height × the same factors, or, for a skeleton without bounds, at the chibi headroom × `modelScale` (bosses 2.2 tiles). `tools/local-extract/enemy_scales.py` reads the products from a local client, and `tools/build-data.mjs MODEL_SCALES` keeps them.
- **Enemy aliases:** `enemies[id].spineAliasOf` means the model belongs to another enemy. Two cases:
  - `_2` variants whose official prefab is the base one (鸭爵, 高普尼克, 流泪小子, 圆仔, 假想敌：胄, 假想敌：铳): the base model, as in the game.
  - an enemy whose own model no dump carries: 灼热源石虫 / 炽焰源石虫 (`enemy_1305_mhslim` / `_2`) use the plain 源石虫 on
    the web (`plan.mjs ENEMY_SPINE_ALIAS`). Their official skeletons only exist in the client's enemy art bundles
    (`refs/arts/enm_art_*.ab`), so they are an optional **overlay**, `enemies[id].spineLocal` = `{ group, skel, atlas,
    textures, pma, anims, animations, events, hits, bounds }` (file names in the `data/local-assets.json` group
    `spine/enemy/{enemyId}`; the rest as a `spine` entry):
    - `tools/local-extract/extract.py` writes the model to `public/assets/local/spine/enemy/{enemyId}/` (page textures
      with their `[alpha]` texture merged in: premultiplied RGB + A like Ark-Models; the atlas gets `size:` and
      `pma: true`) and lists its files in `data/local-assets.json`.
    - The metadata comes from the committed `tools/assets/local-enemy-spines.json` (`fetch-assets --local-spines`
      parses the extracted models into it), never from the disk: `data/assets.json` is byte-identical with or without
      the extraction, it has no `/assets/local/` URL, and setup / doctor / the manifest tests never miss these files.
    - The client (`assets.js spineEntry`, with `assets.local()`, which `createFieldView` awaits with the manifest) draws
      the official model when the local manifest lists every file of it; otherwise, or when it fails to load
      (`UnitView`: the entry's `fallback`), the web alias, tinted toward the slug's own lava colours
      (`render/units.js ALIAS_TINT`: 灼热 orange, 炽焰 red-orange; research 07 §5.6 "a hue shift", [ASSUMED] look) so a
      source install without the extraction still tells them from the plain 源石虫. A release bundle carries the
      models only when it is zipped from a checkout where the extraction ran with the `spine/enemy` job (an extraction
      made with 0.1.0 lacks it: `node tools/setup.mjs --local` again, then check that `data/local-assets.json` lists
      `spine/enemy/enemy_1305_mhslim` and `spine/enemy/enemy_1305_mhslim_2`).
    User feedback after 0.1.0 (D3: "所有特殊源石虫的模型全表现为普通源石虫"): the ELEMENT faction spawns up to ten of them a
    round. A 2026-10-03 audit of every enemy of `data/enemies.json` (249) against the client's battle prefabs (the
    skeleton each prefab's Spine renderer draws) found no other enemy drawn with another enemy's model; 伊利昂的木驮兽
    (`enemy_10159_mntrjn`) starts on its `Full` skin (five passengers) in the game and is drawn with the `default` one.

### Other fallbacks

- **Emotes and 玩法说明 pages** (`public/js/data.js artUrls / nextArtUrl`, `ui/guide.js guideStage`): the local-client picture (`data/local-assets.json`) first, then the mirror copy (`ui['emoticon/…']`, `ui['guide/…']`), each tried in turn when one fails to load; when none is left — none listed, or every copy failed (for example data/assets.json lists the downloaded pages but the files are not on disk yet: a `git pull` and restart without setup) — the neutral emote glyph, and for a page the official tips text (`config.tips`). The rest of the local-client art (the 3D board, the official HUD sprites, module type icons, the two enemy models above) is not downloaded: the client looks it up in `data/local-assets.json` only (most of the HUD sprites are on the mirror too, DESIGN §22.5); docs/DEPLOY.md §6 lists what falls back without it.
- **Tokens:**
  - Without an avatar, use `chars[owner].avatar` with a 召唤物 badge, or `prof.battlecard.token` — except 圣聆初雪's 保护目标（冻结状态） (PRTS 无头像; the frozen gate), drawn as a procedural ice diamond (`render/units.js ICE_TOKENS`).
  - Without a Spine, draw the avatar sprite with a bob tween.
  - `spineVariant` names the skin-variant model that stands in for the missing default model.
- **Enemies without a spine** (for example `enemy_9016_acstmr`): draw `icon` in a diamond. Enemies with no manifest entry at all (`enemy_5601_entlec` 心烛): draw a procedural glyph.
- **Battle effects** (projectiles per kind, hit sparks and slashes, skill bursts and auras, 蕾缪安's lock reticles and shells, 回环射手 boomerangs — DESIGN §17.3) are procedural: the FX atlas is drawn at run time (`public/js/render/textures.js`), so they need no downloaded or local art. The local client does have battle effect art — `battle/[pack]common.ab` holds per-weapon projectile sprites (`projectile_arrow(_new)`, `projectile_crossbow(_new)`, `projectile_yuki`, `img_fx_light_01/02`, `trail_11`), and the per-character `battle/prefabs/effects/*.ab` are particle systems whose textures live in other bundles — but none of it is extracted: the sim's `arrow` also covers gun snipers, and friends joining a game may not have the local art.
- **Spine memory** (`public/js/assets.js`): skeletons are refcounted in an LRU with an idle budget (`SPINE_IDLE_BYTES`, 48 MB) and a 15 s grace; eviction runs `SPINE_EVICT_DELAY_MS` (1 s) after a release, the "no scene on screen" budget (0 bytes) applies after `SPINE_QUIET_DELAY_MS` (3 s) with nothing referenced, and a skeleton whose unload is still in flight is never handed out again — a new load waits for the unload (DESIGN §17.1; it used to leave operators invisible after a battle → prep switch).

### Looking up `data/chess.json` asset ids

`data/chess.json` stores asset **ids** in `chess[*].assets` (docs/DATA.md). They map onto this manifest as follows (checked for all 258 chess):

| `assets` field | Example id | Manifest URL |
|---|---|---|
| `avatar` | `char_498_inside` / `char_498_inside_2` | `chars[id].avatar` / `chars[id minus "_2"].avatarE2` |
| `portrait` | `char_498_inside_1` / `char_498_inside_2` | `chars[id minus "_1"].portrait` / `chars[id minus "_2"].portraitE2` |
| `spine` | `char_498_inside` | `chars[id].spine.front` (and `.back`) |
| `skillIcon` | `skchr_inside_2` | `skills[id]` (the id is the skill's `iconId`) |
| `subProfIcon` | `sub_fastshot_icon` | `prof.sub[id minus "sub_" and "_icon"]` |
- **Missing unit SFX:** use `audio.sfx.battle.enemyHit` or a WebAudio blip (research 07 §6.4).
- **Bond icons:** if the real glyph ever fails, the stored file is the nation camp logo.

## Verification

`node --test test/assets.test.js` covers the pure helpers: the resolver, the atlas normalizer, the format sniffers, WOFF2, audio banks, the plan id sets, the downloader against a fake network, and the self-heal of corrupt skeletons.
When `public/assets` exists, the same file also checks the generated output:
- Every manifest path exists on disk.
- Every pool operator has an avatar, a portrait and a Front model.
- Every atlas has `size:` lines, plus `pma: true` for enemies.
- Every Spine model loads the way the client loads it. That means pixi-spine's atlas reader with real page sizes, where a region outside its page throws, then `SkeletonBinary` with `AtlasAttachmentLoader`, where a missing region throws. Every resolved role is then posed.

The 2026-09-27 verification pass also checked:
- **PNG:** all 2,211 PNGs pass a full CRC and inflate check.
- **Audio:** all 467 MP3s decode with ffmpeg without errors.
- **Browser:** headless Chrome loads and animates all 529 Spine models with the vendored PixiJS 7.4.2 and pixi-spine 4.0.6, with no console errors. Chrome's font sanitizer also accepts the three WOFF2 files.
- **Official data:** 771 provenance checks against the official data (`activity_table`, `skill_table`, `models_data.json`) all match: avatars, portraits, E2 art, bond, band and item icons, and enemy skeleton files.

## Licensing and credits

The project's code is GPL-3.0-or-later (`LICENSE`); none of the items below is covered by it. Details: `NOTICE.md` (scope, non-commercial terms) and `THIRD-PARTY-NOTICES.md` (libraries, fonts, licence texts).

- **Game assets.** All images, Spine models, audio and game data are © **Hypergryph (上海鹰角网络)**. The overseas publisher is **Yostar**.
  - This is an **unofficial, non-commercial fan project**: no ads, donations or paywall.
  - Assets are fetched from public community dumps at install time and are not redistributed in this repository. The plug-and-play bundle attached to a GitHub release does carry them (with the local-client art) under the same non-commercial terms, with `NOTICE.md` inside.
  - Assets will be removed on request from the rights holders.
  - The client must show a credits screen: "Arknights © Hypergryph / Yostar. This is an unofficial fan project; all game assets belong to their owners."
- **Asset dumps and tools.** Credit to:
  - [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)
  - [fexli/ArknightsResource](https://github.com/fexli/ArknightsResource) (ArkResourceAutoUpdateBot)
  - [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) (ArkUnpacker). Not for commercial use.
  - [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2) (ArknightsStudio)
  - [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)
- **Spine runtime.** pixi-spine is MIT-licensed. It embeds Spine Runtime code under the [Spine Runtimes License](http://esotericsoftware.com/spine-runtimes-license), which formally expects a Spine Editor licence. This is commonly tolerated for non-commercial fan tools, and the Spine Runtimes License must be credited (`THIRD-PARTY-NOTICES.md`). The project's GPL carries an additional permission (section 7) to combine it with the Spine Runtimes (`NOTICE.md`).
- **Fonts.**
  - **Bender:** © Jovanny Lemonad (Oleg Zhuravlev, Ivan Gladkikh). Free for personal and commercial use.
  - **Novecento Wide:** © Jan Tonellato / Synthview. Free licence.
  - Both are mirrored from TimWangZi/The-font-of-Arknights.
  - Noto Sans SC and Noto Serif SC (SIL OFL) are loaded from Google Fonts, not self-hosted.
