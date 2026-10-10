# Operator kits

A kit is the battle behaviour of one chess (棋子): its skills, talents, trait specifics and module effects, on top of
the profession defaults of `server/sim/professions.js`. Kits run inside the deterministic battle simulation that the
server and every browser share, so the same seed and inputs give the same battle everywhere. New kits — the stand-in
operators, the self-select 6★ operators, contributions from GitHub issue #136 — go here, one file each.

## Layout

| path | what |
|---|---|
| `index.js` | the registry: `KIT_FILES` lists every kit file, grouped by tier, `STANDIN_KIT_FILES` the 补位 stand-in kits and `OPERATOR_KIT_FILES` the 自选 operator kits; `KITS` (base chess id → kit builder, then stand-in charId → kit builder, then operator charId → kit builder), `TIER_KITS` (one registry per tier group), `STANDIN_KITS`, `OPERATOR_KITS` and `KITTED_CHARS` (who a 自选 slot may field) are built from them |
| `ops/<chessId>-<codename>.js` | one kit per file, with the helpers and constants only that kit uses |
| `ops/standin-<codename>.js` | one 补位 stand-in kit per file (below: "Stand-in kits") |
| `ops/op-<codename>.js` | one 自选 operator kit per file (below: "How to add an operator (自选)") |
| `shared/tier1.js` | the general kit helpers (blackboard readers, unit predicates, hit hooks, area queries, buffs, zones, free tiles, skill records) and the notes of the tier-1 kits |
| `shared/tier2.js` … `tier6.js` | helpers two or more kits of that tier use, and that tier's notes (conventions, simplifications, fx kinds) |
| `shared/summoner.js` | the 召唤师 summon deck the 自选 kits of 麦哲伦 / 令 / 电弧 share (`summonDeck`: the holding, a placed piece's return, recalls, the summons leaving with their owner; `holdBuff`, `tokenStat`) |

`content/index.js` takes `KITS` from `index.js`: a unit's kit is `KITS[def.baseId]` (also the exact or the suffix-less
id), else the generic kit built from the skill blackboard (`content/generic.js`, docs/SIM.md §7.4). A 补位 stand-in's
and a 自选 piece's kit is `KITS[def.charId]` and nothing else (`content/index.js kitOf`): it keeps the chess's (the DIY
slot's) ids, which name the replaced operator's kit (a slot has none).

## Naming

`ops/<base chess id without _a>-<codename>.js`, where the code name is the operator's official `charId` without its
`char_<n>_` prefix (`data/chess.json` `charId`): `chess_char_3_04_a` (琳琅诗怀雅, `char_1033_swire2`) →
`ops/chess_char_3_04-swire2.js`.

- The chess id is the registry key and the one unique name: one operator can be two chess (锡人 `chess_char_1_16` and
  `chess_char_2_19`, 耶拉 3_20 / 4_03, 华法琳 4_26 / 5_04 …), so a code name alone collides. One file ⇔ one registry
  entry, and a directory listing sorts like the data: by tier, then shop order.
- The code name finds the operator by name; the docs and the code already call kits by it (`lemuen`, `whitw2`,
  `sbell2`, `pithst`). It is ASCII and stable across languages — no Unicode file names (the macOS NFD / Windows / URL
  encoding differences of `/sim/` in the browser) — and the Chinese name is in the file's first line, so
  `grep -l 玛恩纳 ops/` works too.
- `-` separates the two parts, which both contain `_`.

## A kit file

```js
// server/sim/content/kits/ops/chess_char_6_21-codename.js — 名字 (char_xxxx_codename) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { num, talentBb, statBuff } from '../shared/tier1.js';     // shared helpers, engine modules (relative paths)

/** 名字 S2 "…": the radius exists only in the PRTS 备注 (no blackboard key). */
const SOME_RADIUS = 1.5;                                          // helpers / constants of this kit only

export default {
  // 6_21 名字 — S3 …: what each skill / talent / module does, which blackboard key gives each number, [ASSUMED] where
  // no source says.
  chess_char_6_21_a: (bb, chess, def) => ({ skill: { … }, skills: { … }, talents: [ … ], trait: { … }, install() {} }),
};
```

- **The default export** is `{ [baseChessId]: (bb, chess, def) => Kit }` with exactly one key, the `_a` id; the same kit
  serves the elite `_b` record. `bb` = the SELECTED skill's blackboard at the chess's level (normal Lv4, elite Lv7),
  `chess` = the record as the unit's loadout makes it (talents, `trait.bb`, `module`), `def` = the normalised def. The
  Kit fields (`skill`, `skills: { [skillId]: SkillSpec }`, `talents`, `trait`, `install`) and how the loader picks the
  selected skill's spec: docs/SIM.md §7.2; the SkillSpec schema: §7.3; worked examples with real operators: §7.5.
- Small real files to start from: `ops/chess_char_1_11-skgoat.js`, `ops/chess_char_1_02-yak.js`; one with every
  selectable skill: `ops/chess_char_3_04-swire2.js`; a large one with its own helpers: `ops/chess_char_6_18-whitw2.js`.
- The tier-4 files wrap their entry in `withDefaults(…)` (`shared/tier4.js`: it rebuilds `def` for callers that pass
  `(bb, chess)` only); `content/index.js` always passes all three, so a new kit needs no wrapper.

## What a kit may use

- **Helpers**: `../shared/tier1.js` first — `num` / `talentBb` / `talentGrid` / `moduleBb` / `traitBb` / `moduleOn`,
  `skillRec` / `skillBbOf` (another selectable skill's record and blackboard), `instantKind`, `batMod`, `up` / `cheb`,
  `onHitBy` / `onHitOn` / `onDamagedOn`, `enemiesInGrid` / `alliesInGridOf` / `enemyInRange`, `statBuff` / `toggleBuff`
  / `installAura` / `spTimeBonus` / `installReveal`, `makeZone`, `freeTileAround`, `giveSp`, `once`. The other
  `../shared/tierN.js` are usable too, but same-named helpers are not interchangeable: `num` of tier 1 / 4 also reads
  numeric strings, those of tiers 3 / 5 / 6 do not; `toggleBuff`, `talentBb`, `moduleBb`, `instantKind` take different
  arguments per tier. Read the helper before using it.
- **Not in a kit**: a module's trait line 「攻击范围内存在N名及以上敌人时攻击速度+X」 (REA-Y: 圣约送葬人, 隐德来希) is applied
  to every operator by the engine (`../traitMods.js`, called from `battle/players.js` `_setupUnit` after `kit.install`);
  a kit adding it too would count it twice. The other conditional attack-speed lines of modules stay in their kits —
  traitMods.js lists them and refuses them, and `test/sim/trait_attack_speed.test.js` scans every chess, 补位 and 自选
  loadout so a new record with an unknown shape is noticed.
- **The battle API** documented in docs/SIM.md: units (§2), buffs / mods / statuses (§3), the damage & heal pipeline
  (§4), the hook bus and its re-entrancy rule (§5), the engine helpers content must use (§6), the skill runtime (§7.1);
  engine modules by relative path (`../../../constants.js`, `targeting.js`, `body.js` for huge enemies, `dir.js` for
  facing, `damage.js` `hasHp` / `isHpLoss` / `mitigate`, `buffs.js`, `simdata.js` `normalizeChess`); content modules
  (`../../tokens.js` summons, `../../items/battle.js`).
- **Never**: Node-only modules (`node:*`, `server/sim/nodeData.js`) or anything of `server/match`, `server/net`,
  `public/` — the sim is served to browsers as-is (`/sim/`, no bundler); `Math.random`, `Date.now`, timers — use
  `battle.rng()` (`rng.int / range / chance / pick / shuffle / weighted`), `battle.after` / `battle.every`; state kept
  across battles in module variables — key it by battle (`WeakMap`) or keep it in `unit.mem`; mutating `bb`, `def`,
  `chess` or range grids (deep-frozen, shared by every battle: copy them). Register hooks with `{ owner: unit }` and
  check `unit.alive` in handlers. `test/content/kits_layout.test.js` enforces the import / clock rules.
- Order matters: hooks run by priority, then registration order, and every random draw comes from one stream — the
  golden corpus (`test/golden/`) notices any change in either.

## Registering a kit

1. The chess needs its data record first: `data/chess.json` is generated from the official tables by
   `tools/build-data.mjs` (docs/DATA.md) — skills, talents, trait, modules, ranges, tokens and the resolved auto-cast
   trigger of every skill.
2. Add the kit file to `ops/`, named as above.
3. Append its file name to its tier's group in `index.js` `KIT_FILES` (never reorder the existing entries). Each file
   is loaded with a guarded dynamic import: a file that fails to load is logged and its chess falls back to the
   generic kit, so check the server log when a kit seems to do nothing.
4. `node --test test/content/kits_layout.test.js` checks the name, the registry entry and the imports;
   `node tools/kit-coverage.mjs --missing` lists selectable skills that still fall back to the generic spec.

## Stand-in kits (补位)

A NORMAL chess whose operator the player does not own fights as its official stand-in (原型干员, data/backups.json,
docs/DATA.md §18): the chess's ids, bonds, 特质, tier and price, the stand-in's body — stats, range, trait, talents, the
skill `backup.skillIndex` and the module `backup.uniEquipId` the chess names. The sim gets that def from
`battle.data.getChess(chessId, { standIn: true })` (a PlayerBattleInput entry with `standIn: true` — in a match, the
player's chess marked 未持有 on the 干员持有 tab, `PlayerState.battleInput`); `def.charId` is the stand-in's,
`def.standInFor` the replaced operator's charId. The golden `standins` family (tools/golden.mjs) fields every NORMAL
chess record as its stand-in, so a kit change that alters a battle shows there (test/golden-standins.test.js checks that
every active backup skill is cast).

- **File and key**: `ops/standin-<codename>.js`, the code name being the stand-in's charId without `char_<n>_`
  (`standin-acguad.js` = Sharp, `char_609_acguad`); the default export has exactly one key, that charId:
  `export default { char_609_acguad: (bb, chess, def) => Kit }`. Append the file name to `STANDIN_KIT_FILES` in
  `index.js`. Never register a stand-in under a chess id: that is the replaced operator's kit, which the stand-in must
  not run.
- **Arguments**: `bb` = the blackboard of the skill the chess names, at the chess's level (normal Lv4, elite Lv7);
  `chess` = the composed record (shared/standIn.js `standInRecord`: talents, `trait.bb`, `module` of the stand-in);
  `def.tier` / `def.golden` tell which chess it stands in for.
- **No default skill**: one stand-in takes S2 on one chess and S3 on another (Sharp: S2 for 银灰, S3 for 隐德来希), so the
  kit authors every skill it supports in `skills: { [skillId]: SkillSpec }`; `skill` is ignored for a stand-in (a skill
  missing from `skills` gets the generic spec). `talents`, `trait` and `install` apply as for any kit.
- **Without a file** the stand-in fights with the generic kit plus the talents it can apply exactly
  (`generic.js genericTalents`: unconditional stat lines like "攻击力+8%"). The eight 预备干员 need no file: their skills
  (攻击力 / 防御力 / 治疗强化, 战术咏唱, 冲锋号令, 一击即退) are covered by the generic spec
  (`test/content/standin.test.js`).
- **Auto-cast**: the trigger comes from the data like any chess's (checklist item 5). The 重装 exception for the
  stand-ins is `tools/build-data.mjs STANDIN_TRIGGER_DEVIATIONS` (预备干员-重装, Mechanist: every skill `DEFAULT`,
  `rawRule` `TAKE_DAMAGE`).
- **Summons**: no stand-in has one (DATA.md §18).
- **One character, one implementation**: a stand-in the mode also fields elsewhere reuses that code through a named
  export, never through another registry: Touch (`standin-acmedc.js`) runs the 外勤医疗 strategy's Touch S3 and talents,
  `content/tokens.js` `touchGospel` / `mapCharTalents`.
- `node --test test/content/kits_layout.test.js` checks the file name, the key (a charId of data/backups.json `units`)
  and the registry entry.

## How to add an operator (自选)

The 自选 (self-select) slots — two at tier 5, two at tier 6 — field a 6★ the player owns that is not in the chess pool,
or a prototype (DATA.md §18, `shared/diy.js`). The prototypes run their stand-in kits, the 4★ 预备干员 the generic kit;
an owned 6★ can be picked only once it has a kit of its own: one file per operator, the same rules as every kit above.
Contributions are welcome — one operator per pull request is easiest to review.

**Who.** The owned-6★ picks are `data/backups.json diy.ownedPool` (72 operators; the collab operators are not included,
the owner's decision of 2026-10-05). The ones still without a kit:

```sh
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { KITTED_CHARS } from './server/sim/content/kits/index.js';
const b = JSON.parse(readFileSync('data/backups.json', 'utf8')); for (const id of b.diy.ownedPool) if (!KITTED_CHARS.includes(id)) console.log(id, b.units[id].name);"
```

**The data is already built** — `data/backups.json units[charId]` (no chess record exists for these operators):
- `forms['2/1/4/0']` = the normal form (E2 Lv1, skills at rank 4, no module), `forms['2/60/7/1']` = the tier-5 elite (E2
  Lv60, rank 7, modules at stage 1), `forms['2/60/7/3']` = the tier-6 elite (modules at stage 3). Each holds `stats`,
  `rangeGrid`, `trait`, `talents` (no module), all three `skills` (blackboard `bb`, SP data, `rangeGrid`, the resolved
  auto-cast `trigger`) and on the elites `modules[]` (`attr`, `traitOverride`, `talentChanges` — the official module
  parts at that stage).
- `tokens[tokenId]` = its summons, per owner form (`variants['<charId>@<statusKey>']`, with `bySkill` / `byModule`).
- Verify the numbers against the official tables (`.cache/gamedata/excel`) and PRTS like any kit. If the data itself is
  wrong or lacks something — a trigger deviation, a summon's abnormal effect — fix `tools/build-data.mjs`
  (`STANDIN_TRIGGER_DEVIATIONS` is keyed by charId and applies to these units too; `TOKEN_ABNORMAL`), rebuild with
  `node tools/build-data.mjs --offline` and check with a JSON compare that only the intended data changed.

**File and registration.**
1. `ops/op-<codename>.js`, the code name being the charId without `char_<n>_` (`op-siege.js` = 推进之王,
   `char_112_siege`); the Chinese name in the first line.
2. The default export has exactly one key, the charId: `export default { char_112_siege: (bb, chess, def) => Kit }`.
3. Append the file name to `OPERATOR_KIT_FILES` in `index.js`. The operator becomes a legal pick (`KITTED_CHARS`;
   `shared/diy.js diyPool` / `validateDiyPicks` with `kitted`) — never register it under a chess or slot id.
4. `node --test test/content/kits_layout.test.js` checks the name, the key (an owned pick), the registry and that every
   skill of every form is authored under `skills`.

**The kit contract** (as for a stand-in): `bb` = the blackboard of the picked skill at the slot's rank; `chess` = the
composed record (`shared/diy.js diyRecordOf`): `skills` (all three at that rank), `talents` with the picked module's
changes, `trait` (the module's override), `module` (`{ id, level: 1 | 3, active }` — active on the elite only), and on an
elite with a module stage `statsBase` / `traitBase` / `talentsBase` / `modules[]` (a module talent that adds to a base
talent: read the base from `talentsBase` and the module's own part from the module's `talentChanges`, as `op-siege.js`
万兽之王); `def.tier` (5 / 6), `def.golden`, `def.charId`, `def.diyFor` (the slot). There is **no default skill**: the
pick chooses any of the three, so write every skill under `skills: { [skillId]: SkillSpec }` (`skill` is ignored);
`talents`, `trait` and `install` apply under every skill. Read every number from `chess` / `bb` — the same file serves
both tiers, both forms and both module stages. A 自选 piece has no 特质 and its bonds come from its factions: neither is
the kit's business. Summons: `battle.tokenDef(tokenId, unit)` / `battle.spawnToken(unit, …)` resolve the variant of the
pick. A **placeable** summon (data/backups.json `tokens[id].placeable`, made by the pick's skill or a talent — the
variant's `sources` — and shown by its owner: a skill's own object such as 予愿安洁莉娜's “一会儿见！” is not) is a hand piece like any operator's: when the 自选 piece is deployed in prep its player gets one
stack of the variant's `deployLimit` — the picked module's own when its variant has one (望's TRP-X: 7 棋子); it holds
the token's own talent additions (max_deploy_count / max_deck_stack_cnt, tools/build-data.mjs `tokenTalentDeckBonus`:
麦哲伦 / 令 3, SUM-Y stage 2+ 4, 白铁 2, 夜莺 3), so a deck reads `deployLimit` / `deckStack` as they are —
(server/match/player/diy.js `placeableTokens`, PlayerState `grantTokensFor`), places
it on a legal tile (the token's position / `ownerRange`), loses it with its owner (sold, merged, moved back), and the
match hands every placed piece to the battle as a PlayerBattleInput token unit `{ kind: 'token', tokenId, ownerUid }` —
so a kit finds its pieces before the battle starts as `battle.allyUnits` with `kind === 'token'`, its `defId` and
`ownerUnit === unit`, still undeployed (e.g. `op-bgsnow.js` gives its 打字机 pieces their kit in a talent's `install`
with `battle._setupUnit(t, kit)`; `op-cgbird.js` counts its 幻影). A **skill's** summon piece (the variant's `sources` has
'skill', not 'talent') is docked by content/tokens.js before the units are set up — it deploys once, free, at the battle
start, then takes the field when the kit calls `releaseSkillSummon(battle, unit, tokenId)` — and the dock hooks are owned
by the piece: give it its kit with `battle._setupUnit(t, kit)` and **no** `offOwner` (the generic token kit registers no
hook), and clear the owner's `mem.summonStock[tokenId]` when the skill takes the summon back (`op-slent2.js` 夜灯,
`op-phatm2.js` 本能的召唤). A kit test fields a piece the same way:
`units: [op, { uid, kind: 'token', tokenId, ownerUid, row, col }]` (`test/content/op_bgsnow.test.js`); the match side is
covered by `test/match/diy-shop.test.js` (a DIY 鸿雪's 打字机 from prep to battle). A 召唤师 whose talent holds a deck of
summons ("可以使用5个召唤物（最多同时部署3个）") takes `shared/summoner.js summonDeck` — the holding, a placed piece's return
on its tile, recalls, its pieces' kits (`op-mgllan.js`, `op-ling.js`, `op-radian.js`). Every owned pick fights at its player's potential and 练度, as every chess (default 潜能 6 and 精英2 Lv.60 — the owner's decision of 2026-10-08; data/backups.json forms are built at full potential and carry the lower ranks, DATA.md §2.3); a prototype pick has neither. A new kit makes the operator a legal pick at once:
the server's `welcome.diyKitted` lists `KITTED_CHARS`, so the 自选编队 picker offers it and `room.diy` keeps it.

**The fidelity rule and the checklist** above apply item by item: every skill at rank 4 and 7, every talent, every
module at stages 1 and 3 (trait override, talent changes, stats), the range while a skill runs, the auto-cast trigger
(the data's; the owner's rules of checklist item 5 — an AUTO skill acting on nobody fires at full SP), anti-air and
targetability, damage typing, summons, statuses. Mark what no source settles `[ASSUMED]` in the comment and the pull
request.

**Tests** — `test/content/op_<codename>.test.js`, the pattern of `test/content/op_siege.test.js`:
- field the operator the production way: `makeBattle({ units: [{ diy: { slot: 5, charId: 'char_112_siege',
  skillIndex: 2, uniEquipId: 'uniequip_002_siege' }, elite: true, row: 10, col: 5 }] })` — `slot` = a DIY slot id or its
  tier (5 / 6 ⇒ that tier's first slot), `elite` = the `_b` form, `uniEquipId` null / omitted = no module;
- loop over every form (`[5, false]`, `[6, false]`, and both tiers' elites with no module and with each module) and every
  skill; assert that the unit is yours (`u.def.charId`, `!u.kit.generic`, `u.kit.skillSource === 'skills'`), then the
  checklist; read the expected numbers from `data/backups.json` forms, never from memory;
- seed everything, use synthetic `enemyRec` targets for exact numbers, end with `checkInvariants(h.b)`.

**Golden** — the `diy` family of `tools/golden.mjs` fields every operator of `OPERATOR_KIT_FILES` in every form × module ×
skill: a new kit adds its scenarios. Run `npm run golden:update`, check that only `test/golden/diy.json` changed (new
scenarios; no other family moves), and commit it with the kit (`test/golden/README.md`).

**Art** comes with the data: `tools/fetch-assets.mjs` plans every unit of `data/backups.json` (ASSETS.md) — nothing to do.

## Testing a kit

- The harness is `test/helpers/battleHarness.js` (`makeBattle`, `runUntil`, `hooksOf`, `eventsOf`, `checkInvariants`;
  docs/SIM.md §10 has an example and every option). Seed everything, use synthetic `enemyRec` targets for exact
  numbers, assert on ids, end with `checkInvariants(h.b)`.
- Patterns: `test/content/kits_t1t2.test.js` … `kits_t6.test.js` (the default skill and the talents of every chess),
  `test/content/kits_alt_t1.test.js` … `kits_alt_t6.test.js` (every selectable non-default skill and every module;
  `kits_alt_t4.test.js` also runs every chess × skill × module against a mixed wave),
  `test/content/feedback1b_kits.test.js` (real-match checks).
  A new kit gets its own test file (for example `test/content/kits_<codename>.test.js`).
- Golden results: a new or changed kit moves the digests of the scenarios that field its chess. Run
  `npm run golden:update` and commit `test/golden/*.json` in the same change, saying which scenarios moved and why
  (`test/golden/README.md`). A refactor never changes them.
- Run `node --test test/content/kits_layout.test.js test/golden.test.js <your test file>`, then
  `GOLDEN_FULL=1 node --test test/golden.test.js` before the pull request.

### How to test a stand-in kit

- Field the chess as its stand-in: `makeBattle({ units: [{ chessId: 'chess_char_5_13_b', row: 10, col: 4, standIn: true
  }] })` — the production path (data/backups.json through `getChess(id, { standIn: true })`): `_a` = the normal form
  (Lv4), `_b` = the elite (Lv7, its module), with the chess's backup skill. Pick one chess per skill the stand-in
  fields (data/chess.json `backup`; `backups.json units[charId].standsIn` lists them).
- Another skill or module of the stand-in (a skill no chess names, a 自选 prototype): `standIn: { skillIndex: 0 }` or
  `standIn: { skillIndex: 2, moduleId: 'none' }` — the harness composes that record (`standInRec`) and puts it under the
  chess id for the whole battle, so do not field the real operator of that chess in the same battle.
- Inject a kit for a quick experiment with `kits: { char_609_acguad: (bb, chess, def) => Kit }` (keyed by the charId).
- Assert that the unit is the stand-in (`u.def.charId`, `u.def.standInFor`, `u.skill.id`) and that its kit is yours, not
  the generic one (`!u.kit.generic`); then the checklist below as for any operator. Examples:
  `test/content/standin.test.js` (the plumbing and the eight 预备干员).
- A stand-in kit is gameplay for stand-ins only: of the golden corpus only the `standins` family (and the 补位 match
  `coop2-NORMAL-14-standins`) fields stand-ins, so a kit change moves those digests and no other — `npm run
  golden:update`, then review that the change is confined to the battles that field the stand-in.

## The fidelity rule

Every official skill, talent and module is implemented exactly as the game has it — no approximation.

- Sources: the official tables (`.cache/gamedata/excel/*.json`, which `tools/build-data.mjs` downloads: character_table,
  skill_table, battle_equip_table / uniequip_table, activity_table → act2autochess) as built into `data/chess.json`;
  PRTS (prts.wiki: the operator page, its 备注, 卫戍协议 pages) for mechanics the data does not carry — cite it.
- Numbers come from the blackboards whenever a key exists; a number that only exists in the text is parsed from it
  (with a fallback) or a named constant with its source in the comment.
- When the text and the blackboard seem to disagree, find out what the game does and say so in the comment (DESIGN
  §19.9: 至简's text says 购买价格为1 while `bb.price` is 2 — the blackboard is the discount off the tier price 3).
- If the engine cannot express a mechanic, extend the engine in a reviewed change of its own instead of faking it.
- Anything no source backs is marked `[ASSUMED]` in the comment and in the pull request; a decision of the owner is
  cited as "owner's decision YYYY-MM-DD".

## Fidelity checklist (one per operator)

Each item is a mistake this project already made once. Tick every one for every operator in the pull request.

- [ ] **1. Skills** — every effect of each skill at the level the chess uses (normal Lv4, elite Lv7: the skill_table
  blackboard and the text, reconciled), durations, charges, ammo, SP type (time / attack / hit) and initial SP (the
  data's `spType`, `initSp`; SkillSpec overrides need a reason). Examples: ammo — 隐现 `ops/chess_char_1_01-inside.js`,
  `kits_t1t2.test.js` "1_01 隐现: ammo skill"; charges — 松果 S1, `kits_alt_t3.test.js` "3_10 松果 S1 RMA长钉 (charges)";
  hit SP — `feedback1d-solvent.test.js` (the drain feeds 受击回复 SP).
- [ ] **2. Talents** — every talent at the chess's level and full potential (the talent blackboards), conditional ones too.
  Example: `kits_t1t2.test.js` "1_01 隐现 elite: +self_ammo after `duration` s on field; a random other 【拉特兰】 ammo
  operator +ally_ammo".
- [ ] **3. Modules** — for every module the chess offers (loadout, DESIGN §16): the trait override
  (battle_equip_table `overrideTraitDataBundle`, the trait text), the talent changes (`addOrOverrideTalentDataBundle`)
  and the stat bonuses (`attributeBlackboard`); `chess` is already the loadout-resolved record. Examples:
  `kits_alt_t4.test.js` "信仰搅拌机 modules: SPT-Y 老朋友 = range +1 …" and "莫斯提马 SPC-X: the range becomes the module
  grid …", and its "every chess × selectable skill × module" run.
- [ ] **4. Attack range** — the base range, the range while a skill that changes it is on, and back when it ends; a
  skill's own 技能范围. Examples: 烛煌 S3, `test/sim/feedback1e-skillrange.test.js`; DESIGN §21.16 (the live range on the
  card); 见行者 / 松果, `kits_t3.test.js` ("fires on an enemy inside the skill range only").
- [ ] **5. Auto-cast trigger** — the data resolves it (`tools/build-data.mjs resolveTrigger`, `data/chess.json`
  `skills[].trigger`); check it, and change the data rule rather than hand-coding a trigger in the kit. The owner's
  rules (0.2.0): a skill whose attack range is larger than the normal one casts as soon as an enemy is inside the
  SKILL range (a deliberate deviation from the official 技能策略, like the 重装 exception: data `ACTIVE_RANGE` for a
  MANUAL skill on the basic strategy — 深巡 S2's DEFAULT deviation included — or on the SEARCH row (薄绿 S1, 玛恩纳 S2,
  安洁莉娜 S3 …) whose running range strictly contains the operator's own,
  `test/sim/feedback5-active-range.test.js`; 烛煌 S3 in `feedback1e-skillrange.test.js` keeps DEFAULT — its 4-11 does
  not contain her 3-1); an AUTO skill that acts on
  allies or itself fires at full SP (引星棘刺 S1, `kits_alt_t5.test.js` "… fires as soon as its SP is full, no enemy
  needed (GitHub #124)"); the 重装 exception list (`TRIGGER_DEVIATIONS`: 深巡 S2, 雷蛇 S2, 号角 S2 / S3, 灰毫 S1 / S2,
  余 S2; the 预备干员-重装 / Mechanist stand-ins: `STANDIN_TRIGGER_DEVIATIONS`, every skill), DESIGN §21.29 / §22.10,
  `test/sim/feedback1-tank-triggers.test.js`.
- [ ] **6. Targeting** — can it hit air units (`canHitFly`), ground-only attacks, block count, target priority; can
  ground enemies hit it (起飞 / 对地规避, stealth, camouflage flags). Examples: `test/sim/professions.test.js` "fortress
  (号角 / 灰毫) is ground-only and never fires at FLY enemies" (DESIGN §22.13); `feedback1b_kits.test.js` "B4 玛恩纳 S3 …
  hits the air units" vs "S1 / S2 … stay ground-only"; 蒂比 `ops/chess_char_2_13-tippi.js` (`LIFTOFF_FLAGS`, DESIGN
  §21.22); `kits_t3.test.js` "忍冬 迷彩: … ranged enemies stop targeting her".
- [ ] **7. Damage typing** — physical / arts / true / element (元素损伤 vs 元素伤害: docs/SIM.md §7.2), splash vs
  normal (普通伤害), dodgeable or not, `isSkill`, and what triggers on-hit effects (a trait that heals on any damage
  dealt, e.g. 咒愈师). Examples: `enemies_bosses.test.js` "its attack splash (法术普通伤害) can be dodged; its death blast
  (法术溅射伤害) cannot"; DESIGN §23.29 (叙拉古 rolls on every 普通伤害 hit); `test/sim/professions.test.js` "incantation
  medics heal an ally for 50 % of damage dealt"; the re-entrancy rule of docs/SIM.md §5.
- [ ] **8. Summons / tokens** — placement rules (the owner's range, deployable tiles), redeploy, what they inherit from
  the owner's skill / module (`data/tokens.json` variants, `battle.tokenDef`). Examples:
  `test/match/feedback1-placement.test.js` "#9 data: 狼群 and 流形 are owner-range summons" (DESIGN §20.1, §21.3);
  `test/content/playtest6_summons.test.js`, `tokens_summons.test.js`; `feedback1b_kits.test.js` "B3 维娜·维多利亚 S3".
- [ ] **9. Status effects** — every status applied, with its official duration and stacking (寒冷 on 寒冷 ⇒ 冻结 for the
  longer cold, 沉默 removes abilities, 恐惧, 睡眠, 浮空 …; "同名效果取最高" = `applyStrongest`; 庇护 = the shared
  `PROTECT` key, `holdProtect` in `shared/tier1.js`). Examples:
  `test/sim/combat.test.js` "cold on cold ⇒ freeze for the longer cold …", "sleep: target is untargetable and
  inactive; fear stops enemy attacks", "statuses: sleep = invulnerable except `hitSleep` attackers; levitate …";
  `enemies_bosses.test.js` "沉默: exactly the abilities whose handbook line is SILENCE-flagged can be silenced".
- [ ] **10. Tests** — at least one per skill and per talent, plus the trigger rule, the range toggle, anti-air and
  every module; the golden files updated in the same pull request (an intended change).
- [ ] **11. 治疗 or 生命回复速度** — an effect PRTS describes as raising the target's 「生命回复速度」 (a 备注 「增加目标的
  “生命回复速度”属性，不受治疗加成和禁疗影响」; 分支特性信息 吟游者) is an hpRegen / hpRegenRatio buff on the target, never
  `battle.heal`: 禁疗 and 无法被友方治疗 (`noHeal`) do not stop it and no 治疗加成 scales it (damage.js heal `regen`).
  Examples: 安洁莉娜 兼职工作, the 吟游者 trait (professions.js `bardRegen`), 调香师, 瑕光 S2, 铃兰 S3, 锡人;
  `test/content/feedback5-regen.test.js` (GitHub #96 / #137). A per-second 「恢复…生命」 without such a note stays a heal.

## Old references

DESIGN, the changelog and issues cite kits as `kits/tierN.js <name>` (before 0.2.0). That kit is now
`ops/<chess id>-<codename>.js` — search `ops/` for the chess id, the code name or the Chinese name — and the helpers of
that file are in `shared/tierN.js`.
