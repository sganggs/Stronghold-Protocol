# Plugin API v1–v2

The frozen surface of plugin API v1. A plugin names the level it was written for in `api` (`plugin.json`). This build accepts a level from `PLUGIN_API.min` through `PLUGIN_API.current` (`shared/constants.js`). A plugin outside that range is refused and is not loaded.

## Version policy

**stable** — a name in the table below is not removed or renamed while `PLUGIN_API.min` still covers the release that published it. `since` is that release (`0.3.0`), not the dev build (`0.3.0-dev`). A dev build of the release counts as the release.

**experimental** — the name may change or disappear in a later release of the same major. The table says which names those are. `script` and `trusted` (their permissions and the `overrides` field) are experimental: code plugins are new in 0.3.0 (§13 of PLUGINS.md — trusted execution, P3a; the sandbox, P3b). `sp:sdk@1` is experimental: `SDK_MEMBERS` lists what `createSDK(plugin)` hands a plugin's `setup(sp)`, and the `sdk.export.*` rows are the module's own exports (`shared/plugins/sdk.js`).

**internal** — not for plugin authors. `sdk.SDK_MEMBERS` is internal: it is the list in `shared/plugins/sdk.js` the table reads, not something a plugin calls.

Deprecation is this prose, not a fourth stability. A stable name that has to go is named here, kept in the table for one minor release, and removed only when `PLUGIN_API.min` moves past the release that published it.

Studio routes are stable and **local-only**: this machine and the LAN, and the studio key (`X-SP-Studio`). Local-only is this paragraph, not a column of the table.

This project does not host plugins and does not run a market. A catalogue (`schemas/catalog.schema.json`, docs/PLUGINS.md §17) is a document someone else publishes. Installing still means this server downloads one https zip and checks its SHA-256. The rows of the table are produced from the closed sets in the code (`node tools/plugin.mjs surface --write`). A new member of one of those sets (a manifest field, a permission, a class, a patch operation, a compact-record field, an overlay leaf, a DSL word, a postMessage name, a slot, a studio route, an error code, a catalogue field, an SDK member) belongs in the table. Every export of `shared/plugins/sdk.js` belongs in the table too, anchored at that export (`uncoveredSdkExports`). A new function in another module that is not a new member of one of those sets is not a new row. `test/plugins/surface.test.js` reads the `api()` function and requires its method and path to equal `STUDIO_ROUTES` in both directions.

The 0.3.1 effects surfaces (`record.operator.fx`, `overlay.fx.*`, `dsl.fx.plugin`) are presentation extensions
compiled by the plugin loader. See [PLUGINS.md §9](PLUGINS.md#operator-effects-031) for their schemas, limits and
fallbacks. They do not change the sim event protocol or the identity of content which does not use them.
Since 0.3.1, stable `manifest.field.rules` and `rule.*` rows expose the four closed rule switches in
`RULE_SWITCHES` (shared/plugins/rules.js). Only gameplay classes may declare them. Declared options enter the
content identity; conflicting options return `PLUGIN_RULE_CONFLICT`. The full semantics, defaults, and assumptions
are in [PLUGINS.md](PLUGINS.md#rule-switches). `g.unequip { itemUid }` is a server-checked game intent, available only
under unequip=allow; interface plugins still cannot send game intents.

The 0.3.1 import polish (§34.27) reuses stable `manifest.field.optional` for companion cosmetics (id → exact
version); it adds no manifest field, slot or wire message. Optional personal cosmetics remain the player's choice.
See [PLUGINS.md](PLUGINS.md#import-and-display-polish-031-3427) for hint visibility and record-permission checks.

## The table

Optional local extraction for official plugin operators outside the roster (§34.28) fills the installation's existing
`chars` asset slots before cosmetic composition. It adds no author-facing field or stable surface name; existing
`overlay.chars.*` files/references and their precedence are unchanged. See [ASSETS.md](ASSETS.md#official-operator-art-referenced-by-plugins-031).

Theme values and announcements are specified in [PLUGINS §9.1–§9.2](PLUGINS.md#91-theme-variables). `shared/plugins/theme.js` exports the single `THEME_TOKENS` allowlist used by validation and application. Announcements use `notices: [{ id, title, body, date?, i18n? }]` on any class; they are catalogue data and excluded from gameplay descriptors. Adding/editing/removing notices and changing personal theme values preserve `cs`, `vs` and room-facing plugin hashes: manifests always use the same canonical representation without `notices`/`theme`, while raw lock verification remains intact. Theme values have a 400-character raw limit (before trimming/parsing); notice catalogues skip entries that do not fit the 100-entry/48 KiB caps. Server and client both enforce these bounds. Notice-only personal cosmetics remain available as dependencies. [ASSUMED] Cosmetic lock identity includes checked Spine metadata, with actual shaping files hashed separately. Canonicalization migrates pre-fix raw-manifest identities even for plugins without the new fields.
Offers (0.3.1, API 2) are declarative JSON. The stable manifest/permission/error rows below are dated 0.3.1;
API 1 manifests remain supported without this part. Native match intents are `g.offer` / `g.offerRefresh`
`{offerId, pluginId, seq, idx, cardId?}`; `m.public.offers` restores full window state, including per-seat
`slots[].available` (current grant availability). An unavailable or failed grant returns `BAD_TARGET` and leaves the
seat unpicked; refresh remains possible. This is native match state, not a script SDK callback. Sources, effect bounds and examples:
[PLUGINS §10b](PLUGINS.md#10b-offers--interaction-windows). No new script SDK permission is implied.

Studio authoring follow-up (0.3.1, §34.29): `bond`, `item`, `trait`, `offers` and `rules` are template IDs for the
existing new/authoring/trial routes. `POST validate-dsl` additionally accepts `{draft:{id,template,target,options}}`
and returns the same `{ok,problems}` result shape after folder/data-only composition checks. Trial requests may add
`exercise:{round,at,hook,elite,actions}` and receive `exercise:{before,after,windows,blocking,outcomes,round,at,hook}`.
Rules exercises also return `ruleChecks` and vanilla `reference` action results. Bond hooks are roundStart/income/
buy/sell/refresh/merge/levelUp/battleResult; trait hooks substitute gain/deploy for income/refresh. Omitted or empty
hook selects the first authored prep rule, else roundStart [ASSUMED]. Merged validation includes retained content
and required dependencies before writing. Actions are pick/refresh with window/plugin/slot/card identity, or timeout, capped at 32 [ASSUMED]. These are local
Studio helpers using existing stable record, trait, offer and rule vocabularies; no new frozen plugin surface row or
route is introduced. The stable baseline remains unchanged. See PLUGINS §15 for form and exercise limits.

Studio presentation follow-up (§34.30): existing authoring and validate-dsl draft payloads may carry
`uploads:[{path,data}]` for FX flipbook PNGs (`data` is base64). Paths must be distinct, safe and declared by the
merged flipbook configuration; at most 128 uploads, 64 MiB per file and the existing 160 MiB request cap [ASSUMED].
Validation stages these bytes with the complete folder. Save commits them only after strict validation; errors
include the checker's path and message. Slot uploads isolate shared skin media and validate PNG/Spine before
replacement. No route or frozen plugin grammar member is added; the stable surface baseline remains unchanged.

<!-- plugin-surface:start (generated by node tools/plugin.mjs surface --write) -->
| name | stability | since | anchor |
| --- | --- | --- | --- |
| `manifest.field.$schema` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.api` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.app` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.assets` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.authors` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.base` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.class` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.complete` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.conflicts` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.credits` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.data` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.description` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.dsl` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.enemies` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.englishName` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.entry` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.fallback` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.files` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.homepage` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.i18n` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.id` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.lang` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.license` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.loadAfter` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.loadBefore` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.machineTranslated` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.manifest` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.modes` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.name` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.notices` | stable | 0.3.1 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.numberUnits` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.offers` | stable | 0.3.1 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.operators` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.optional` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.overrides` | experimental | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.permissions` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.priority` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.requires` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.rules` | stable | 0.3.1 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.scope` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.settings` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.slots` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.sourceLang` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.stages` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.theme` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `manifest.field.version` | stable | 0.3.0 | `shared/plugins/manifest.js#MANIFEST_FIELDS` |
| `rule.shopBias` | stable | 0.3.1 | `shared/plugins/rules.js#RULE_SWITCHES` |
| `rule.prepLoadout` | stable | 0.3.1 | `shared/plugins/rules.js#RULE_SWITCHES` |
| `rule.morphPairing` | stable | 0.3.1 | `shared/plugins/rules.js#RULE_SWITCHES` |
| `rule.unequip` | stable | 0.3.1 | `shared/plugins/rules.js#RULE_SWITCHES` |
| `permission.assets.override` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.assets.add` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.theme` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.data.patch` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.data.add` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.dsl` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.offers` | stable | 0.3.1 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.sim.code` | experimental | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.meta.code` | experimental | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.mode.code` | experimental | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.ui.frame` | stable | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.trusted.page` | experimental | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `permission.trusted.server` | experimental | 0.3.0 | `shared/plugins/manifest.js#PERMISSIONS` |
| `class.lang` | stable | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `class.cosmetic` | stable | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `class.content` | stable | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `class.script` | experimental | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `class.ui` | stable | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `class.trusted` | experimental | 0.3.0 | `shared/plugins/manifest.js#PLUGIN_CLASSES` |
| `patch.op.set` | stable | 0.3.0 | `shared/plugins/patch.js#PATCH_OPS` |
| `patch.op.merge` | stable | 0.3.0 | `shared/plugins/patch.js#PATCH_OPS` |
| `patch.op.add` | stable | 0.3.0 | `shared/plugins/patch.js#PATCH_OPS` |
| `patch.op.append` | stable | 0.3.0 | `shared/plugins/patch.js#PATCH_OPS` |
| `patch.op.remove` | stable | 0.3.0 | `shared/plugins/patch.js#PATCH_OPS` |
| `record.operator.op` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.charId` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.name` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.appellation` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.profession` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.subProfessionId` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.subProfessionName` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.position` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.rarity` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.as` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.forms` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.skills` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.chess` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.kit` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.talentMods` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.talents` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.trait` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.origin` | stable | 0.3.1 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.art` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.nationId` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.powers` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.dmgType` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.attackKind` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.projectile` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.canHitFly` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.operator.targetPriority` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.file` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.id` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.base` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.set` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.value` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.special` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.kind` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `record.generic.effect` | stable | 0.3.0 | `shared/plugins/recordsSchema.js#RECORD_SCHEMA` |
| `overlay.chars.avatar` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.avatarE2` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.portrait` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.portraitE2` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.illust` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.spine.front` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.spine.back` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.chars.skins.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.enemies.icon` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.enemies.spine` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.tokens.avatar` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.tokens.spine` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.bonds.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.items.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.bands.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.skills.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.modules.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.ui.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.prof.icon.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.prof.large.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.prof.battlecard.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.prof.sub.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bgm.lobby` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bgm.prep` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bgm.combat` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bgm.unite` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bgm.boss` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.bossBgm.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.voice.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.voiceJp.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.voiceEn.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.voiceKr.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.voiceNative.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.ui.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.battle.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.attack` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.hit` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.skill` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.die` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.born` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.skills.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.attacks.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `overlay.audio.sfx.units.hits.*` | stable | 0.3.0 | `shared/plugins/visual.js#ASSET_CONTAINERS` |
| `dsl.trigger.always` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.deploy` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.battleStart` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.attack` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.hitDealt` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.hitTaken` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.kill` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.allyDeath` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.skillStart` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.skillEnd` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.every` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.trigger.hpBelow` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TRIGGERS` |
| `dsl.condition.chance` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.condition.targetHas` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.condition.selfHpBelow` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.condition.enemiesInRange` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.condition.bondActive` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.condition.skillActive` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#CONDITIONS` |
| `dsl.action.buff` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.status` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.damage` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.heal` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.sp` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.dp` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.push` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.pull` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.spawnToken` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.layers` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.shield` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.action.fx` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#ACTIONS` |
| `dsl.target.self` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.target` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.source` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.alliesInRange` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.enemiesInRange` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.enemiesInRadius` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.lowestHpAlly` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.target.allAllies` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#TARGETS` |
| `dsl.metaTrigger.roundStart` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.income` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.buy` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.sell` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.refresh` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.merge` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.levelUp` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaTrigger.battleResult` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_TRIGGERS` |
| `dsl.metaAction.funds` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_ACTIONS` |
| `dsl.metaAction.layers` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_ACTIONS` |
| `dsl.metaAction.gainItem` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#META_ACTIONS` |
| `dsl.value.bb` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.talent` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.trait` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.stat` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.batMod` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.mul` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.add` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.sub` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.div` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.min` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.value.max` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#VALUE_OPS` |
| `dsl.skillKind.instant` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.skillKind.duration` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.skillKind.ammo` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.skillKind.charges` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.skillKind.toggle` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.skillKind.passive` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#SKILL_KINDS` |
| `dsl.stat.atk` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#STAT_NAMES` |
| `dsl.stat.maxHp` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#STAT_NAMES` |
| `dsl.stat.hp` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#STAT_NAMES` |
| `dsl.stat.def` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#STAT_NAMES` |
| `dsl.stat.res` | stable | 0.3.0 | `server/sim/content/dsl/vocab.js#STAT_NAMES` |
| `ui.message.plugin.ready` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.plugin.slot` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.plugin.resize` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.plugin.storage` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.plugin.notice` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.plugin.stats` | stable | 0.3.0 | `shared/plugins/ui.js#UI_PLUGIN_MESSAGES` |
| `ui.message.host.welcome` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.state` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.battle` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.stats` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.storage` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.limit` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.slot` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.rejected` | stable | 0.3.0 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.result` | stable | 0.3.1 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.message.host.net` | stable | 0.3.1 | `shared/plugins/ui.js#UI_HOST_MESSAGES` |
| `ui.slot.hud.right` | stable | 0.3.0 | `shared/plugins/manifest.js#UI_SLOT_IDS` |
| `ui.slot.result.tab` | stable | 0.3.0 | `shared/plugins/manifest.js#UI_SLOT_IDS` |
| `ui.slot.stats.tab` | stable | 0.3.0 | `shared/plugins/manifest.js#UI_SLOT_IDS` |
| `ui.slot.room.panel` | stable | 0.3.0 | `shared/plugins/manifest.js#UI_SLOT_IDS` |
| `studio.route.GET /studio/api/info` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/trial-options` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/trial` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/console/options` | stable | 0.3.1 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/console/build` | stable | 0.3.1 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/authoring` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/dsl-example` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/validate-dsl` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/authoring` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/targets` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/slots` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/suggest-id` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/authors` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/events` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/remove` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins/:id` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins/:id/preview` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins/:id/zip` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins/:id/f/:hash8/*` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.GET /studio/api/plugins/:id/files/*` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.PUT /studio/api/plugins/:id/manifest` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.PUT /studio/api/plugins/:id/files/*` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.DELETE /studio/api/plugins/:id/files/*` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/slot` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/meta` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/sections` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/ref` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/clear` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/fix` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/plugins/:id/pack` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/catalog` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/catalog/install` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/forge/preview` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `studio.route.POST /studio/api/forge/import` | stable | 0.3.0 | `server/studio/index.js#STUDIO_ROUTES` |
| `error.PLUGIN_STUDIO_CHANGED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TRIAL_BUSY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TRIAL_TIMEOUT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TRIAL_FAILED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TRIAL_LIMIT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_CONSOLE_SCENARIO` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TRIAL_SCENARIO` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CONSENT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_TRUST_PUBLIC` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_TRUST_PIN` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SCRIPTS_DISABLED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SCRIPT_CHECK` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SCRIPT_OVERRIDE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SCRIPT_CONFLICT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_WORKER_TIMEOUT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_WORKER_FAILED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_WORKER_STOPPED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_UNAVAILABLE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_DISABLED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_CLASS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_HASH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_IMPORT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_SYNTAX` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_LIMIT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SANDBOX_MATH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_UNKNOWN` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_BLOCKED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DEPENDENCY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CONFLICT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RULE_CONFLICT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RULES` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LIMIT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INCOMPATIBLE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_BUSY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_NO_MANIFEST` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_JSON` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_JSON_LIMIT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_MANIFEST_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_MANIFEST_VERSION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ID_MISMATCH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FIELD_UNKNOWN` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CLASS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_TEXT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LANG_CODE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_VERSION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_APP` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_APP_MISMATCH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_API` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SCOPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_HOMEPAGE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DEPS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ORDER_HINTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SETTING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SETTING_FIELD` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PART_CLASS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PART_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ASSET_FILE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_URL` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_UNUSED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_NAME` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_VALUE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_LIMIT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_THEME_SHAPE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_NOTICE_SHAPE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_NOTICE_LIMIT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_NOTICE_TEXT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_NOTICE_LANG` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ENTRY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LANG_ONLY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PERMISSION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PERMISSION_MISSING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PERMISSION_UNUSED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_EMPTY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_LINK` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_NAME` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_TYPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_FRAME` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_SIZE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_MISSING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FILE_OUTSIDE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LANG` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LANG_FILES` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PACK` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ASSETS_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ASSET_KEY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_ASSET_IGNORED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_REF` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SPINE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SPINE_PAGES` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SPINE_NOTE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SPINE_PARSE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LOCK` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LOCK_MISSING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_LOCK_STALE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DUPLICATE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_UNREADABLE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_REQUIRES_MISSING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_PATH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_SIZE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_EXISTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TEMPLATE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_TARGET` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_FILE_KIND` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_REQUEST` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_KEY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_IN_USE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STUDIO_REMOVE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CONTENT_FILE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CONTENT_FORMAT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CONTENT_PERMISSION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_LIMIT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_NUMBER` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_TYPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_PATH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_BOUND` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_REQUIRED` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_BOSS_CENTRE_DEPLOYABLE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_REFERENCE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DATA_PAIR` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PATCH_OP` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PATCH_PATH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PATCH_TYPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PATCH_SETTING` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_PATCH_OVERRIDE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_EXISTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_DELETE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_ID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_HIDDEN` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_PAIR` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_ART` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_ORIGIN` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_TYPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RECORD_SKILLS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_KIT_REF` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SKILL_SPEC` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_EFFECT_REF` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_I18N` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_UI_SLOTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_UI_NO_SLOT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SLOT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_UI_SLOT_SHARED` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_RATE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_STORAGE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INTENT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_OFFER_REFERENCE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_OFFER_SHAPE` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_OFFER_ROUNDS` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_VERSION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_PLUGIN_ID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_BUDGET` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_LOOP` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_TRIGGER` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_CONDITION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_ACTION` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_TARGET` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_EVERY` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_NUMBER` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_DIV0` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_VALUE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_SKILL` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_META` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_DSL_TALENT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_SHAPE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_URL` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_HASH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_ID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_FIELD` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_SIZE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_CATALOG_FETCH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_URL` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_HASH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_SIZE` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_TIMEOUT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_FETCH` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_REDIRECT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_ZIP` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_CHECK` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INSTALL_EXISTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_INPUT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_ZIP` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_JSON` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_ID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_EXISTS` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_MOUNT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_PANEL_SCRIPT` | stable | 0.3.1 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_FORGE_SCRIPT` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `error.PLUGIN_INVALID` | stable | 0.3.0 | `shared/plugins/errors.js#PLUGIN_ERRORS` |
| `catalog.field.$schema` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_FIELDS` |
| `catalog.field.catalog` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_FIELDS` |
| `catalog.field.name` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_FIELDS` |
| `catalog.field.plugins` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_FIELDS` |
| `catalog.entry.id` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.name` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.version` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.class` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.description` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.url` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.sha256` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.bytes` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.homepage` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.license` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.authors` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `catalog.entry.app` | stable | 0.3.0 | `shared/plugins/catalog.js#CATALOG_ENTRY_FIELDS` |
| `sdk.sp:sdk@1` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_ID` |
| `sdk.SDK_MEMBERS` | internal | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.constants` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.content.register` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.dir` | experimental | 0.3.1 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.enemies.register` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.kit` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.kits.register` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.log` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.math` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.meta.register` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.settings` | experimental | 0.3.0 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.sp:sdk@1.targeting` | experimental | 0.3.1 | `shared/plugins/sdk.js#SDK_MEMBERS` |
| `sdk.export.constants` | experimental | 0.3.0 | `shared/plugins/sdk.js#constants` |
| `sdk.export.createSDK` | experimental | 0.3.0 | `shared/plugins/sdk.js#createSDK` |
| `sdk.export.dir` | experimental | 0.3.1 | `shared/plugins/sdk.js#dir` |
| `sdk.export.kit` | experimental | 0.3.0 | `shared/plugins/sdk.js#kit` |
| `sdk.export.math` | experimental | 0.3.0 | `shared/plugins/sdk.js#math` |
| `sdk.export.targeting` | experimental | 0.3.1 | `shared/plugins/sdk.js#targeting` |
| `api.PLUGIN_API.min` | stable | 0.3.0 | `shared/constants.js#PLUGIN_API` |
| `api.PLUGIN_API.current` | stable | 0.3.0 | `shared/constants.js#PLUGIN_API` |
| `record.file.bonds` | stable | 0.3.1 | `server/plugins/gameplayRecords.js#GAMEPLAY_RECORDS` |
| `record.file.items` | stable | 0.3.1 | `server/plugins/gameplayRecords.js#GAMEPLAY_RECORDS` |
| `record.operator.forms.tags` | stable | 0.3.1 | `server/plugins/gameplayRecords.js#expandGameplayRecords` |
| `record.operator.forms.tokens` | stable | 0.3.1 | `server/plugins/gameplayRecords.js#expandGameplayRecords` |
| `record.operator.fx` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `overlay.fx.index` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `overlay.fx.flipbooks` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `overlay.fx.bind` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `overlay.fx.silentPhases` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `dsl.fx.plugin` | stable | 0.3.1 | `public/js/render/vfx/pluginFormat.js#pluginFxProblems` |
| `record.operator.trait.dsl` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `record.operator.overrides.trait` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.on` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trigger.elementBurst` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.condition.element` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.condition.targetOnField` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.condition.selfOnField` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.layers.maxPerBattle` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.layers.selfActive` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.gainItem.count` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.gain` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.deploy` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.roundStart` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.buy` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.sell` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.merge` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.levelUp` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
| `dsl.trait.meta.battleResult` | stable | 0.3.1 | `server/plugins/operatorTraits.js#TRAIT_SURFACE` |
<!-- plugin-surface:end -->

## Host feeds for a read-only panel (0.3.1)

`ui.message.host.result` and `ui.message.host.net` are host-to-frame snapshots. `welcome` may also carry `version`, `lang`, `plugins`, `cs` and `prefs`. `state` may also carry `room`. A frame still posts only the plugin message names. `validateHostMessage` refuses a payload whose tree contains a match intent (`g.*`, `b.*`, `room.*`, `hello`, `ping`). These feeds do not become a client-to-server intent. The Forge receiver checks `event.source === parent` before queuing or applying any message. These are optional fields of existing stable welcome/state messages; no message name is added.

**`result`.** `{ v: 1, t: 'result', result }`. `result` is the settle object the result screen already shows, or `null`. Kept player stats: `dmgDealt`, `bossDamage`, `kills`, `leaks`, `lpLost`, `merges`, `itemsEquipped`, `activatedLayers`, `refreshes`, `perfectRounds`, `gold` (exact finite numbers). Kept player fields: `playerId`, `seat`, `name`, `isBot`, `left`, `alive`, `victory`, `roundsPassed`, `creditedKills`, `eliminatedRound`, `lp`, `bandId`, `stats`, and `title`, `trophies`, `reward` when present. Kept match fields: `victory`, `roundsPassed`, `hiddenReached`, `hiddenCleared`, `reason`, `teamLp`, `modeId`, `difficulty`, `stageId`, `bossId`, `durationMs`. At most 8 players. Lineup, diy, seed and the hidden-boss id stay off this message. The host posts it when a live frame is ready and again when the result changes. The studio preview does not receive it.

**`net`.** `{ v: 1, t: 'net', status, attempt, retryAt, rtt, lastError }`. `status` is the connection state. `attempt` is the reconnect count. `retryAt` is a timestamp or `null`. `rtt` is the latency in milliseconds, or `null`. [ASSUMED] The wire field is `rtt` because the key `ping` is a client intent. `lastError` is `{ code, text }` or `null`. The player id is not included. The host posts one snapshot per entry document before welcome, then a later change at most once a second per frame (`UI_LIMITS.netHz` is 1) [ASSUMED]. Duplicate `ready` is ignored; initialization of a sibling cannot alter another frame's pending delivery or deduplication. A host move resets that document's delivery state. The studio preview does not receive it.

**`state.room`.** Present when the room has a `seats` array or a plugin list. `seats` keeps empty holes, so a room of `MAX_SEATS` (4) reports length 4, and each occupied seat is `{ seat, playerId, name, isBot, ready, connected }` (at most 8). `plugins` is up to 32 plugin ids from `content.plugins`. Optional `cs` is the real `content.cs`, accepted only as 64 lower-case hex digits. An explicit null room sends `room: null` to clear the previous room; omitting the third argument keeps the old shape. The join code, host id, spectators, consent and loadouts are omitted. `hostState(pub, priv)` with no third argument keeps the previous `{ v, t, public, private }` shape.

**`welcome`.** With info: `version` is the integer `PROTOCOL_VERSION`, `lang` is the player's language (at most 16 characters), `plugins` is the room's plugin ids, optional `cs` is the same sanitized room identity as in `state.room.cs`, and `prefs` is the scalar values already stored for this plugin (string, finite number or boolean; at most 32 keys matching `^[A-Za-z0-9._-]{1,64}$`). Without info the message stays `{ v, t, id, slots }`. The studio preview sends that shorter welcome.

The Forge shim exposes the first eight digits of the actual room `cs` as `net.welcome().mods.digest` [ASSUMED]. Room changes replace it; leaving a room or an unavailable identity clears it. It is never invented. Its `/shared/i18n.js` compatibility module supplies only `t`: static named aliases and namespaces bind it, unsupported static exports are refused; literal dynamic imports also supply `t`.

Operator trait declarations are content-only additions in 0.3.1 (#671): see PLUGIN-DSL §10 and
`schemas/operator-trait.schema.json`. The loader validates this extension before delegating the legacy grammar;
legacy `validateDsl`/`compileDsl` remain unchanged. The app-owned setup adapter is internal, not an author scripting API.

Trait gain is discoverable through SERVER_GAIN and supports forced dispatch separately from acquisition. Self-sale
uses the sold form, including the last copy [ASSUMED]. Layer actions preserve garrison attribution and the existing
cooldown tolerance; affected fields require server authority [ASSUMED]. No new author API names are introduced.


Studio authoring note (0.3.1, §34.30): `theme`, `notices`, `fx` and `skins` are templates using existing studio
routes and the stable theme/notices/operator.fx/overlay.fx/overlay.chars.skins contracts above. Form draft options
are studio metadata, excluded from packed plugins. This adds no stable API member or route; surface.stable.json
therefore remains unchanged. See PLUGIN-GUIDE.md for the fields, bounds, previews and trial workflow.
