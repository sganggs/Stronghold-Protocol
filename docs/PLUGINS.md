# PLUGINS.md — plugins (插件)

A **plugin** is a folder a server owner puts into `plugins/`: a manifest, `plugins/<id>/plugin.json`, next to the files
it names. The interface calls them 「插件」, never 「模组」 (that word is the operators' modules). The design and its
phases are DESIGN §32 (`docs/history/0.3.0.md`); this file is the reference.

**Status — 0.3.1: content sets, scripts, sandbox execution and the Forge-pack additions (§34).** The server finds, checks and lists plugins and names its content
with a hash (P0); a room's host switches the server's cosmetic plugins on for the whole room, a player switches them on
for themself (§9) — art, models and audio only: the battles stay the original ones and a room's `cs` stays the vanilla
one. Language packs (`docs/PACKS.md`) are the plugin class `lang` and work as before. Data plugins (§10) build
validated content sets, and a room's host switches them on for the room (§11, P1c): the room plays a content set of its
own, named by its own `cs`, which every member's page downloads and checks and whose matches run in a match host of
their own — unofficial matches. P4 adds interface plugins (§14): a page in a sandboxed frame, switched on in this
browser, read-only, never a match intent, and not an input of `cs`. Script plugins (§13) share one SDK: sandbox
execution needs valid locked files, while native trusted execution also needs owner pins and individual consent.
Both modes are off by default; all gameplay plugin simulations run in browser Workers.
Authors make, preview, trial and pack cosmetic, data, DSL, script and interface plugins in the browser at `/studio/` — the plugin studio 插件工作台 — or with
`node tools/plugin.mjs new / check / pack`; findings come in plain words (the error catalogue), and the JSON Schemas
`schemas/plugin.schema.json` and `schemas/overlay.schema.json` help editors and AI agents (§15; a beginner's guide in
Chinese: [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md), an AI agent's: `plugins/AGENTS.md`). A Forge workshop pack, a folder or a
zip, can be imported as the plugins it can become (§16). Install local zips or hash-pinned HTTPS downloads, including entries in a community catalogue (§17); the frozen API table is [PLUGIN-API.md](PLUGIN-API.md).

| File | Role |
|---|---|
| `shared/plugins/manifest.js` | the format: manifest 2 (`plugin.json`), manifest 1 (`pack.json` / `_meta`), the classes, permissions, file rules, limits, the catalogue entries |
| `shared/plugins/identity.js` | the content hash `cs`: canonical JSON and its composition |
| `shared/plugins/visual.js` | a cosmetic plugin's asset overlay (§9): reading and checking it, references, resolution to served URLs, the merge with its override warnings, the visual hash `vs`, the browser's check of a visual set |
| `shared/plugins/order.js` | which plugins a set holds and in what order: requirements, conflicts, load-order hints, priority, id |
| `shared/plugins/ui.js` | the interface-plugin bridge (§14): the postMessage shapes, the rate and storage limits, the public and private subsets, the frame URL |
| `public/js/ui/uiPlugins.js` | this browser's interface-plugin switches and the host's recommendations (localStorage) |
| `public/js/ui/pluginFrame.js` | the sandboxed iframes, the slots, the read-only feed |
| `plugins/_template/ui/` | the interface-plugin template: a damage tally |
| `schemas/ui.schema.json` | the plugin→host messages (C7) |
| `shared/plugins/errors.js` | the error catalogue (§15): every `PLUGIN_*` code with its plain words in Chinese and English, what to do, its document; the coded `issues` every check returns beside its text; the symptom table |
| `shared/sha256.js` | SHA-256 in plain JavaScript (the same digest in Node and every browser, no `crypto.subtle`) |
| `server/plugins/registry.js` | the registry: the language folders, `packs/` and `plugins/` — discovery, validation (a cosmetic plugin's overlay too, its files hashed), `/packs/index.json`, `/plugins/index.json`, what may be served |
| `server/plugins/identity.js` | this server's vanilla content and its `cs`, the manifest at `/cs/<cs16>/index.json` |
| `shared/plugins/patch.js`, `records.js`, `validate.js` | pure patches, compact records and merged-data validation (§10) |
| `server/plugins/contentSet.js` | C1 content compositions, immutable byte files, modes and the gameplay hash (§10) |
| `server/plugins/visualSet.js` | the visual sets: a room's (or a player's) cosmetic plugins as one set named by `vs`, served at `/vs/<vs16>/overlay.json` (the composition and each plugin's writes, composed by the browser) |
| `server/plugins/pack.js`, `server/plugins/zip.js` | checking and packing a plugin folder: the folder's check, `plugin.lock.json` (Spine clip data parsed from the skeleton), a deterministic zip — for `tools/plugin.mjs` and the studio |
| `server/plugins/forgeImport.js` | Forge workshop packs (§16): read a folder or a zip and write the plugins it can become. It never runs a script from the pack |
| `server/plugins/forgeKits.js` | a Forge pack's `kits/<id>.js` → the one self-contained sim entry of its script plugin: parsed with acorn, imports rewritten to `sp:sdk@1`, the registry's script check; nothing is run (§16) |
| `server/studio/` | the plugin studio (§15): `index.js` the page and its API at `/studio/` (this machine and the local network only: `gate.js`), `files.js` (only inside `plugins/<id>/`), `templates/` (one module per template), `targets.js` (by official name), `edit.js` (fields, slots, one-click fixes), `preview.js` (the temporary composition), `watch.js` (hot reload) |
| `server/packs.js`, `shared/packs.js` | the content-pack API of 0.2.0, kept (compatibility export; the language-pack index) |
| `public/js/content.js` | the browser: the room's visual set and the player's personal plugins, fetched, checked and laid over the art manifest |
| `public/js/cosmetics.js` | the cosmetic layers every screen draws through (small: the title page carries it; `shared/plugins/visual.js` loads with the first set) |
| `public/js/ui/pluginTag.js` | the room's 插件 tag and the small facts the screens show (the panel loads when the tag is tapped) |
| `public/js/ui/pluginPanel.js` | the room's 插件 panel and the title screen's list of the server's plugins — loaded when one opens |
| `public/studio/` | the studio's page (§15): `index.html`, `studio.css`, `js/` (the shell, `editors/` one module per template, `preview/` — the game's own renderer and components) |
| `schemas/plugin.schema.json`, `schemas/overlay.schema.json` | JSON Schema (2020-12) of `plugin.json` and of the asset overlay, for editors and AI agents (§15) |
| `tools/plugin.mjs` | `list`, `check` (in plain words, `--json`), `pack` (`--zip`), `new`, `test`, `errors`, `surface`, `import-forge`, `install`, `catalog` |
| `server/plugins/roomSets.js`, `contentSets.js`, `policy.js`, `server/match/host/` | a room's content set, the match host of a content set and the server owner's `plugins/config.json` (§11) |
| `plugins/README.md`, `plugins/AGENTS.md`, `plugins/_template/` | the folder's readme, the guide for AI agents, the templates (`cosmetic/`, `content/`, `script/`, `ui/`) — the only tracked files of the folder |

## 1. Principles (the maintainer's decisions of 2026-10-12)

- **The original game is always the default.** A room plays the vanilla content unless its host chooses plugins (P1c);
  the golden results, DESIGN and the fidelity checks cover the original content only.
- **Plugins are marked unofficial** wherever they are shown — the catalogue (`unofficial: true` on every class but
  `lang`), the title screen (「本服务器安装了 N 个插件」), the room (「原版」 / 「插件 ×N」, the panel's 非官方 marks),
  the diagnostics (`content: … cosmetic vs=… plugins=…`, `MODDED …` for gameplay plugins), and with gameplay plugins
  the briefing, the HUD corner, the result and the statistics (such matches stay out of the overview by default; a match
  with cosmetic plugins only is still the original game — §9, §11).
- **No third-party code in a battle unless the server owner switches it on.** Art and data plugins carry no code, and
  the declarative DSL (§12) is data, not code. An interface plugin (P4, §14) runs only inside a sandboxed iframe: it sees
  a read-only feed and cannot send a match intent. Code plugins (`script`, `trusted`, §13) are off by default: trusted
  execution needs the owner's switch, a pinned lock and every player's consent (P3a); sandbox mode
  (`SP_PLUGIN_SCRIPTS=sandbox`) runs script code in SES compartments — a Worker in the page, a restricted child process
  on the server (P3b). Trusted-class code never enters the sandbox.
- **No plugin overrides arbitrary project files**; a plugin changes only what its class allows, through its manifest.
- **Gameplay plugins are installed on the server** (every player of a room plays the same content and the server can
  still check a battle). Players never install gameplay content of their own.
- **Never put official game files in a plugin**; a plugin refers to the art the installation already has.
- **Bug reports from a plugin room** go to the plugin's author first; please reproduce on the original content.

## 2. For server owners

Put the folder into `plugins/` (the id is the folder name). `node tools/plugin.mjs list` shows what the registry found,
by class, with what this version does with each, what was skipped and why. It reads `SP_PLUGIN_SCRIPTS` the way the
server does: `sandbox` with a valid lock lists a script plugin as loaded; unset, or `trusted` with no pin, leaves it
disabled. `node tools/plugin.mjs check` checks the
folders in depth and, across those folders, duplicate ids, a second language overlay and two ui plugins that ask for
the same slot (§8, §14). The server prints the same at start (`[plugins] …`) and notices a new or changed plugin on the next
page load — no restart. A server's own plugins are git-ignored (the folder's readme and templates are tracked and ship in the
release zips), never packed into a release and never touched by an update. One unreadable
folder is skipped with its reason; it never stops the server.

What this version does with each class:

| Class | Carries | This version |
|---|---|---|
| `lang` | a language: UI strings, optionally game texts | **loaded** — listed in `/packs/index.json`, files served at `/packs/<id>/<file>` |
| `cosmetic` | art, models (Spine 3.8), audio (fonts and theme colours later) | **loaded** (P1a, §9) — a room's host switches it on for the room, a player for themself; the files its overlay names served at `/p/<id>/<hash8>/<path>` |
| `content` | data patches and new records: numbers, economy, modes, waves, operators, enemies | **loaded** (P1b, §10; P1c, §11) — a room's host switches it on for the room: a content set of its own, unofficial matches; the set's files served at `/cs/<cs16>/…` |
| `script` | code the battle or the match runs | **off by default** — valid lock in sandbox mode; owner pin and player consent in trusted modes (§13) |
| `ui` | an interface widget: an html page in a sandboxed frame | **loaded** (P4, §14) — a player switches it on for this browser; its frame files served at `/p/<id>/<hash8>/<path>` with a frame CSP |
| `trusted` | page or server code with full trust | **off by default** — trusted/trusted-force only; pinning, address gates and room consent (§13) |

Nothing of a plugin folder is served except the files a `lang` manifest names, the files a loaded `cosmetic`
plugin's overlay names, and the frame files of a loaded `ui` plugin (`.html`, `.js`, `.css`, `.png` under its
`entry.client`, §14) — never `plugin.json`, the lock file, a document or any other file of the folder. A ui plugin's
`/p/` responses carry a frame Content-Security-Policy; cosmetic art does not. Content-set snapshots are separate:
`/cs/<cs16>/` serves checked data/descriptors and, for native trusted sets, only the retained sim/meta/client script
entry bytes (§13). It never serves arbitrary files from plugin folders.

What rooms may use is the server owner's choice: `plugins/config.json` (optional, git-ignored) lets every room's host
choose (the default), fixes one set for every room, or keeps rooms on the original game, and limits the plugins, the
classes and the content sets running at once — §11 and `docs/DEPLOY.md`.

## 3. The manifest (manifest 2)

```json
{
  "manifest": 2,
  "id": "marathon",
  "name": { "zh": "马拉松模式", "en": "Marathon" },
  "version": "0.1.0",
  "app": ">=0.3.0 <0.4.0",
  "api": 1,
  "class": "content",
  "scope": ["room"],
  "authors": ["…"],
  "license": "CC-BY-4.0",
  "settings": { "refresh": { "type": "integer", "min": 0, "max": 3, "default": 1, "label": { "zh": "刷新价格" } } },
  "permissions": ["data.patch", "data.add"],
  "data": ["data/economy.json"],
  "modes": ["modes/marathon.json"],
  "operators": ["operators/rosa.json"],
  "i18n": { "en": "i18n/en.json" }
}
```

| Field | Meaning |
|---|---|
| `manifest` | `2`, required (a `pack.json` without it is manifest 1, §7) |
| `id` | the folder name decides: `^[a-z0-9][a-z0-9-]{1,31}$` (it becomes part of record ids; lower case only); a different `id` in the file is a warning; script/trusted execution requires an explicit matching id in the verified manifest bytes |
| `name`, `description` | a text in `sourceLang` or `{ "<lang>": "…" }`; `englishName` a text |
| `version` | semver, required |
| `app` | the game versions it is made for — `>=0.3.0 <0.4.0`, `0.3.x`, `^0.3.0` … (a pre-release counts as its release); required but for `lang`. Outside it: `compatible: false` and a warning (P1 refuses a gameplay plugin by default) |
| `api` | the plugin API level, within `shared/constants.js` `PLUGIN_API` (`{ current: 2, min: 1 }`); required but for `lang`. A manifest that uses a part of level 2 (today `offers`, §10b) states `"api": 2` |
| `class` | §2; every part the manifest names must belong to it |
| `scope` | `room` (the host's choice for the whole room), `personal` (the player's own setting), `server` (trusted code only), as the class allows — `cosmetic`: room and/or personal; `content`, `script`: room; `ui`, `lang`: personal; `trusted`: server or room |
| `authors`, `credits`, `license`, `homepage` (http/https), `sourceLang` (default `zh`) | free text |
| `requires`, `optional`, `conflicts` | `{ "<plugin id>": "<version range>" }`; a missing or out-of-range requirement is a warning of the registry now, a refusal when rooms choose plugins |
| `loadAfter`, `loadBefore`, `priority` | ordering hints (lists of ids; an integer within ±1000, default 0) |
| `settings` | ≤ 32 settings: `boolean`, `integer` / `number` (`min` and `max` required, `step`), `enum` (`options`) — no free text; `default` (else `false`, `min`, the first option), `label` |
| `permissions` | what the plugin does (§4); every part needs one, every permission must fit the class |
| parts | `assets`, `theme` (cosmetic+) · `data`, `operators`, `enemies`, `modes`, `stages`, `dsl`, `offers` (content+) — a path, a list of paths or (`assets`, `theme`) the object inline · `i18n` `{ "<lang>": path }` (content+) |
| `entry` | `{ "sim", "meta" }` (script, `.js`) · `{ "client" }` (ui, `.html`) · `{ "server" }` (trusted, `.js`) |
| `lang`, `files` … | the `lang` class only: manifest 1's language fields and `files: { ui, data }` (§7) |

A **problem** keeps a plugin out (unlisted; the start log and `tools/plugin.mjs` say why); a **warning** does not.
Unknown fields are warnings. The asset overlay of a cosmetic plugin is §9; the inner formats of the data parts — data
patches, compact operator records, modes — are specified in §10.

## 4. Permissions

| Permission | Classes | Needed by |
|---|---|---|
| `assets.override`, `assets.add` | cosmetic, content, script, trusted | `assets` (either) |
| `theme` | cosmetic, trusted | `theme` |
| `data.patch`, `data.add` | content, script, trusted | `data` (either); `operators`, `enemies`, `modes`, `stages` (`data.add`) |
| `dsl` | content, script, trusted | `dsl` |
| `offers` | content, script, trusted | `offers` (§10b; the part is data, so no code permission is needed) |
| `sim.code`, `meta.code`, `mode.code` | script, trusted | `entry.sim`, `entry.meta` |
| `ui.frame` | ui | `entry.client` of a ui plugin |
| `trusted.page`, `trusted.server` | trusted | `entry.client`, `entry.server` of a trusted plugin |

A permission nothing in the manifest uses is a warning.

## 5. Files and limits

By class: images `.png .jpg .webp` (no SVG), Spine `.skel .atlas`, audio `.mp3 .ogg`, fonts `.woff2`, data `.json`;
code `.js` only in `script` / `trusted`; frames `.html .js .css .png` only in `ui`, under its client's folder; `lang`
carries `.json` only. Documents (`.md`, `.txt`, `README`, `LICENSE`, `NOTICE` …) may sit beside them and are never
served. Nothing else; no symbolic link inside the folder (a plugin folder that is itself a link is loaded — the owner's
choice — but the studio never opens it, §15); file names are plain (letters, digits, `. _ -`, spaces; no hidden or `..`
part). Every path the manifest names must exist inside the folder. A folder is read for at most 2000 folders, 12 levels
deep and 50 000 entries (`server/plugins/registry.js WALK_LIMITS`): a folder past them is refused (`PLUGIN_FILE_SIZE`),
also when it is a link to a large tree.

Limits [ASSUMED, all of them]: 8 MB per JSON file, nesting ≤ 64 levels, numbers finite within ±1e9; 200 MB and 5000
files per plugin. The registry checks the manifest, the files and the paths whenever it scans; `tools/plugin.mjs check`
also parses every JSON file against the limits.

## 6. Content identity (`cs`)

Every server names the content its rooms play with a hash, **`cs`** (`shared/plugins/identity.js`):

```
cs = sha256(canonical({ v: 1, app, sim, data, plugins, settings, i18n?, rules? }))
  sim       sha256(canonical([[path, sha256], …])) of every served /sim/**.js (not nodeData.js), /shared/**.js and /data.js
  data      { <name>: sha256 } of every data/<name>.json the match or the sim reads (not assets, local-assets, emotes, i18n/)
  plugins   [{ id, version, files }] in load order — [] for the vanilla content
  settings  { <id>: { <key>: value } } — {} for the vanilla content
  i18n      omitted for vanilla and cosmetic-only selections, so this P0 formula stays bit-identical. A content
            selection (§10) passes { <lang>: sha256 of the served i18n/<lang>.json }. index.json is not an input.
```

`canonical` is JSON with sorted keys and no white space; the bytes are the bytes served, so a browser hashes exactly
what it received (with `shared/sha256.js`, which also works where `crypto.subtle` does not — a LAN address is not a
secure context). Two machines with the same `cs` run the same battles bit for bit; any code or data change gives a new
one. The server computes it once at start (`[content] vanilla <16 hex>` in the log).

Where it shows (DESIGN §8.4): `welcome.content` `{ vanilla }`, `room.state.content` `{ cs, vanilla: true, plugins: [] }`
(the vanilla set — a room's cosmetic plugins add `vs`, `plugins`, `warnings` and `bytes` beside the same `cs`, §9),
`/healthz` `content: { vanilla, sets: 0 }`, every BattleSpec's `cs` (the sim never reads it), an optional `b.result.cs`,
and the second line of a diagnostic report (`content: vanilla cs=<64 hex>`, with ` cosmetic vs=… plugins=…` in a room
with cosmetic plugins; a room with gameplay plugins will read `MODDED cs=… plugins=id@version(hash)…`).

`GET /cs/<first 16 hex digits>/index.json` answers the content set's manifest — every code file's hash, every data
file's URL (`/data/<file>?v=<8 hex>`), hash and size — cached for good; any other `cs` is 404. `GET /plugins/index.json`
(never cached) is the catalogue: `{ version, app, api, content: { vanilla }, plugins: [entry …] }`, every plugin and
pack found by class and id, with its `status` (`loaded` / `disabled` / `planned` / `unsupported`), `unofficial`, its manifest's
public fields, size and file count — never a path on the server; a loaded cosmetic plugin that writes art adds `vs` (the visual set of
it alone, §9) and `artBytes` (the art it serves). [ASSUMED] A theme- or notices-bearing cosmetic with an empty overlay omits both, so the page does not fetch an empty document; pre-existing entries keep their shape. A loaded interface plugin adds `slots`, `entry` (a path inside the
plugin), `vs`, `frameBytes` and `frameFiles` (`{ path: sha256 }`, §14) — not `artBytes`. A plugin that declares theme variables adds `theme.vars`; a plugin that declares announcements adds `notices`. Both are omitted when absent, so a catalogue entry without them keeps its old shape. Notices are not a content-hash input (§9.2).

Cosmetic plugins and interface plugins never change `cs`: neither changes a battle, so a room whose plugins are only
of those classes plays the vanilla `cs`. Installing a ui plugin, or editing its page, does not change `cs`. Adding, editing or removing notices or personal theme values does not change `cs`, `vs` or room-facing plugin hashes. The manifest contribution is always canonical JSON with `notices` and `theme` removed, including when those keys are absent. Script descriptors always use that stripped source and identify the gameplay file snapshot instead of the notice-sensitive raw lock; owner admission still verifies the complete original bytes and lock [ASSUMED]. Visual sets use the same canonical manifest; a cosmetic lock contributes only its checked Spine metadata, since the actual shaping files are hashed separately [ASSUMED]. This normalization migrates old raw-manifest contributions even for plugins without either field; it does not preserve their pre-fix hashes. Editing a
served `/shared/**.js` does, because `cs` hashes every one of them — including `shared/plugins/ui.js`. The art a
cosmetic plugin draws, and the frame an interface plugin draws, are named by the visual hash `vs` (§9, §14).

## 7. Language packs

A language pack is the `lang` class: `public/i18n/<code>.json` (its `_meta`), `packs/<id>/pack.json` (manifest 1) or
`plugins/<id>/plugin.json` with `"manifest": 2, "class": "lang"` and the same language fields and `files`. All three
are listed in the live server's `/packs/index.json` exactly as before (docs/PACKS.md, docs/I18N.md). `tools/plugin.mjs`
lists a lang plugin with the rest; `tools/packs.mjs` (also its static `index`, whose host could not serve a plugin's
files at `/packs/<id>/`) and `tools/i18n.mjs` keep reading the language folders and `packs/` only, as in 0.2.0. A
manifest 1 of the old planned types `assets` / `data` is still reported as not loaded: its successor is a `cosmetic` /
`content` plugin.

## 8. Tools

```
node tools/plugin.mjs list [--json]                every plugin and language pack, by class, the skipped ones and why, the vanilla cs
node tools/plugin.mjs check [<dir|id> …] [--strict] the folders of plugins/ (or the ones named; a folder anywhere): manifest,
          [--json] [--lang zh|en]                  files, paths, JSON, a cosmetic plugin's overlay (its references against
                                                   this checkout's data/assets.json) — each finding with its plain words
                                                   (§15); --json for editors and agents — exit 1 on a problem, with
                                                   --strict on a warning too
node tools/plugin.mjs pack <dir|id> … [--zip]      write plugin.lock.json (every file's SHA-256 and size, each Spine model's
          [--out <file|dir>]                       clip data), then check the folder; --zip writes the folder as a zip
                                                   (default plugins/_dist/<id>-<version>.zip)
node tools/plugin.mjs new <template> <id>          a new plugin folder from a template (art, spine, voice, audio, numbers, operator, dsl, meta, mode, ui, script, theme, notices, fx, skins)
          [--target <名字|id>] [--name …] [--dir …] optional target found by its official name; --options <json-file> for wizard options
node tools/plugin.mjs errors [--markdown] [--write] the error catalogue; --write keeps the symptom tables of the documents
node tools/plugin.mjs import-forge <dir|zip>       a Forge workshop pack → the plugins it can become (§16);
          [--out <dir>] [--id <id>] [--dry-run]     --dry-run writes nothing; --json prints the report only;
          [--json] [--no-scripts]                   --no-scripts writes no script plugin for its kits/
```

Additional commands:

```
node tools/plugin.mjs test <id>                     run the installed plugin's author tests (§13; executes local code)
node tools/plugin.mjs install <zip|https URL>       install a zip; HTTPS requires --sha256 <hex>; --force backs up an existing id
node tools/plugin.mjs catalog <file|https URL>     inspect a community catalogue (--json available)
node tools/plugin.mjs surface [--write]            the frozen API table; --write regenerates docs/PLUGIN-API.md
```

`check` of every folder in `plugins/`, or of more than one named folder, also applies the registry's cross-plugin rules:
a duplicate id, a second overlay of one language (the message names the plugin folder that won; the first in sorted
order), and two ui plugins that ask for the same slot (`PLUGIN_UI_SLOT_SHARED`, a warning — the match shows tabs).
Named folders are sorted by folder name before those rules, the same order `readDirSorted` uses when the registry
reads `plugins/`. A folder that order keeps stays kept: a later scan does not add a second duplicate that names it
as the loser. Checking one named folder does not scan the others. A losing overlay's own folder line says
`(skipped)` and names the winner; JSON marks it `status: skipped`, `loadable: false` and supplies the reason in
`skipped`, without counting the cross-plugin problem twice. `list` and `check` call the same trust gate as the
server (`SP_PLUGIN_SCRIPTS`): sandbox with a valid lock says `(loaded)`; disabled execution or an invalid lock
says `(disabled)`.

`--root <dir>` points it at another checkout or an unpacked release. Full and lite releases ship this CLI, its
runtime dependencies, schemas, templates, author documentation and `test/helpers/battleHarness.js`. The harness
imports only shipped server/shared modules. SES and Acorn are production dependencies; packaging runs
`npm ci --omit=dev`, whose postinstall writes `public/vendor/ses.umd.js` and `public/vendor/acorn.mjs` before zipping.
Plugin-specific `golden` / `simcheck` commands and `--plugins` for the balance tools are not implemented.

## 9. Cosmetic plugins (P1a)

A cosmetic plugin changes what the game shows and plays — avatars, portraits, Spine models, icons, interface pictures,
voices, sound effects, music — and nothing a battle does: the simulation reads data, never art (an enemy's attack timing
is a number of `data/enemies.json`), so a room's `cs` is the vanilla one whatever its art.

**The overlay** — the manifest's `assets` part, inline in `plugin.json` or a `.json` file of the plugin
(`shared/plugins/visual.js`), written in the shape of `data/assets.json` (ASSETS.md "Manifest schema"):

```json
"assets": {
  "chars": {
    "char_102_texas": {
      "avatar": "art/avatar.png",
      "spine": { "front": { "skel": "spine/front/texas.skel", "atlas": "spine/front/texas.atlas", "textures": ["spine/front/texas.png"] } }
    },
    "char_112_siege": { "portrait": { "ref": "char_102_texas" } }
  },
  "ui": { "hudPanel/icon_hp": "art/hp.png" },
  "audio": { "voice": { "char_102_texas": { "skill1": "voice/s1.mp3", "select": ["voice/a.mp3", "voice/b.mp3"] } } }
}
```

| Container | A record |
|---|---|
| `chars[charId]` | `avatar`, `avatarE2`, `portrait`, `portraitE2`, `illust` (image), `spine.front`, `spine.back` (Spine), `skins` (one key per skin, below) |
| `enemies[key]` | `icon` (image), `spine` (Spine) |
| `tokens[id]` | `avatar` (image), `spine` (Spine) |
| `bonds`, `items`, `bands`, `skills`, `modules`, `ui`, `prof.icon` / `large` / `battlecard` / `sub` `[key]` | an image |
| `audio.bgm[lobby \| prep \| combat \| unite \| boss]`, `audio.bossBgm[bossId]` | a track `{ loop, intro? }` (audio), written whole — not `audio.bgm.combatAlts` (see below) |
| `audio.voice[charId]`, `audio.voiceJp[charId]`, `audio.voiceEn[charId]`, `audio.voiceKr[charId]`, `audio.voiceNative[charId]` (the operator's own-language dub) | `<slot>`: an audio file or a list of 1–16 |
| `audio.sfx.ui[key]`, `audio.sfx.battle[key]` | audio |
| `audio.sfx.units[id]` | `attack`, `hit`, `skill`, `die`, `born` (audio), `skills` / `attacks` / `hits` `{ <index>: audio }` |

A value is a **path** inside the plugin folder — an image `.png .jpg .webp`, audio `.mp3 .ogg` —, a **Spine model**
`{ skel, atlas, textures, pma }` (the `.skel` and the `.atlas` side by side with one name — pixi-spine looks for the atlas
there —, the pages inside the atlas's folder; `atlas` and `textures` default to `<name>.atlas` and `<name>.png`), or a
**reference** `{ "ref": "<key>" }` to an entry of the same container in the installation's own manifest:

- a whole record — `"char_102_texas": { "ref": "char_112_siege" }` — replaces the record as a whole; other keys beside
  the `ref` then change fields of it (`{ "ref": "char_112_siege", "avatar": "art/a.png" }`);
- one field — `"avatar": { "ref": "char_112_siege" }` — is that field of `char_112_siege`.

A reference always names the installation's entry, never another plugin's [ASSUMED], so the plugins' order never changes
what it means; one the installation's `data/assets.json` lacks is a problem. Anything else — another section (`fonts`,
`skillsById` …), a field a record has not — is a warning and left out; numbers, booleans and free text are never written
into the manifest; never an absolute URL (no other path of the server, no other host). A field a plugin does not write
keeps the installation's value (an `avatar` alone leaves `avatarE2`), but a track is written whole (a `loop` alone plays
without the installation's intro), and a model written for an enemy or a token — its `spine`, a model or a reference —
also takes away that entry's local-client model (`spineLocal`, which the client would draw first) [ASSUMED] — only with
that model: a model write the browser leaves out, or whose file fails to load, leaves the local model too. The split
battle music `audio.bgm.combatAlts` (the mode's own 开战 tracks, 骑士之日 / 无畏者, fixed per round) is not something a
plugin changes: the client plays it instead of `combat` in the rounds it covers, so a plugin's `combat` is heard only
where no such track plays. Writing an
entry the installation has needs the permission `assets.override`, a new entry `assets.add`. `theme` is the allowlisted variables of §9.1, applied on this player's page only.
entry the installation has needs the permission `assets.override`, a new entry `assets.add` — the decision the permission
is: a write to a path whose entry the installation's manifest already has is an override, whatever it writes there, so an
operator the manifest has counts as one even when the write only adds a skin under `chars[<charId>].skins` or a field the
record did not have (`illust`); a new operator is an `assets.add`. `theme` is not applied yet
(a warning).

**立绘 and the skins of one operator.** `illust` is the full illustration (立绘), the picture a detail view shows. The
committed `data/assets.json` of this version carries no `illust` and no `skins` yet, so a plugin that writes one adds that field to the
entry (as any other field of an entry the installation has, it takes `assets.override`). An operator's record may also
carry several appearances under `skins`, one per key — the key `chars[<charId>].skins` is written under, and it is this
installation's own skin id where its manifest has one (e.g. `char_003_kalts@boc#6`), else a name the plugin introduces;
whatever wears a skin and the plugin have to agree on that key. A skin is a record of the same kinds the
operator's own record has — `avatar`, `avatarE2`, `portrait`, `portraitE2`, `illust` and `spine.front` / `spine.back` —,
plus `name` (1–64 characters: the skin's own name) and `group` (0–64 characters: its series), as that file writes them.
An empty `group` is allowed because an entry a plugin adds may have no series — each of the 1388 operator skins of the
official `.cache/gamedata/excel/skin_table.json` carries a non-empty `displaySkin.skinGroupName` —, so this is
room for a plugin's own new entry, not the state of the manifest.
A skin key is wider than an entry key by `@` `#` `+`, narrower by `/`, and is at most 64 characters where an entry key
takes up to 128; a key shaped like an entry key (the stem form `char_102_texas_epoque_7`) is accepted too, for an
installation that has no skin id for it [ASSUMED]. A
key is data, never a path or a URL by itself: a plugin's files are named by paths inside its folder (letters, digits, `.`
`_` `-` and spaces), and every segment of a served plugin URL is percent-encoded (`pluginFileUrl`), so a `#` in one is
`%23` and never the start of a fragment. One record takes at most 64 skins. A key outside that character set, a field a
skin has not, a text that is not 1–64 characters (0–64 for `group`), and a file a skin names that the folder lacks are
reported as the same fault of the operator's own record would be; a skin's model goes into `plugin.lock.json` like any
other. What a skin *is* —
its name, its series, the picture a picker would show, the wearing of one — is this section's business; the key's shape is
the overlay's own rule: the reader resolves every key into a path of the installation's manifest, so a key of the wrong
shape is `PLUGIN_ASSET_KEY` (§15), as an entry key of the wrong shape is. The player picker
(`public/js/ui/skins.js availableSkins`, docs/SKINS.md) lists a skin once this overlay is composed onto the manifest,
and the player wears that id with `room.skins`. The studio still does not list skins (it finds an operator, an enemy,
an interface picture … by its official name, `server/studio/targets.js`, not a skin), so a skin key is copied from the
installation's own catalogue or written in the stem form.

```json
"chars": { "char_102_texas": {
  "illust": "art/texas_illust.png",
  "skins": {
    "char_102_texas@epoque#7": { "name": "意志", "group": "时代/VII", "illust": "art/texas_epoque.png" },
    "char_102_texas_epoque_7": { "name": "意志", "avatar": "art/texas_epoque_thumb.png" }
  }
} }
```

One level down, a reference keeps the rule above: `{ "ref": "<entry key>" }` inside a skin reads the same field of that
entry's own skin of the same key (`chars[<entry key>].skins[<that key>]`), and a whole-skin reference the skin itself.
As the opening of this section says, the committed `data/assets.json` has no `skins`, so a skin's reference addresses a
path the installation's manifest does not carry yet and is `PLUGIN_REF` — it means something only once the installation's
manifest has `skins` of its own; in this version only the fields of an operator's own record can be referenced.

**Wearing a skin — docs/SKINS.md.** The overlay above is what a *server's owner* installs and what a player switches on
for themself (`scope: ["personal"]`, 设置 → 外观插件); **no room and no host is involved**, and this version has no
server-side install route at all (upstream #652 closed the one that let any client make the server download files and
rewrite the shared `data/assets.json`). What a player then picks is a `{ [charId]: skinKey }` map, keyed by the
**operator** — the container the key is written under — sent as `room.skins` (accepted in any phase: an appearance
changes nothing a battle does, so it never enters `cs`) and published to teammates in `Match.publicView().players[]`,
which is how a co-op partner's piece draws your skin. `public/js/assets.js` resolves it (`spineEntry`, `avatarUrl`,
`portraitUrl`, `illustUrl` take `opts.skin`) and falls back to the operator's own model and pictures for a skin (or a
skin's layer) that is not there, so a plugin that replaces only a model still draws a face. 设置「显示其他玩家的皮肤」
(default on) is a pure client preference: off, this browser draws every OTHER seat's piece on the operator's own model
while keeping its own player's — their screen keeps showing their skin.

**Spine models and `plugin.lock.json`.** A model's clip roles, durations, events, hit times and bounds come from the
skeleton itself: `node tools/plugin.mjs pack <dir>` parses it the way `tools/fetch-assets.mjs` parses the game's
(`tools/assets/skel.mjs`, `anim-roles.mjs`: an operator's three skill slots, an enemy's numbered skills), checks the atlas
pages against `textures`, and writes them into `plugin.lock.json` with every file's SHA-256 and size (a problem of the
overlay — a reference the manifest lacks — leaves the lock unwritten). `"anims": "auto"` or nothing — never by hand; a
lock made from another skeleton (its SHA-256) is a problem until it is packed again. The server never parses a skeleton
[ASSUMED]: it rebuilds the lock's clip data in the shape the tool writes — the known roles, every clip they play an
animation of the skeleton, at most 256 animations and 64 events, names of at most 64 characters, durations and hit
times within 600 s, the four numbers of the bounds — so nothing a hand-made lock adds reaches a browser [ASSUMED limits].

**Checked when scanned.** The registry reads a cosmetic plugin's overlay when it scans the folders (at start, when they
change, and when `data/assets.json` changes): its shape, files, references — what they copy out of the installation's
manifest at most 2 MB [ASSUMED] — and permissions, the lock — a problem keeps it out like any other — and hashes the
files that shape it (SHA-256, kept by path while a file keeps its size, mtime, inode and ctime: a rescan reads only what
changed, and a file rewritten with its old size and mtime put back — `rsync -t`, `touch -r` — is read again, its ctime
gives it away; the folders' own check looks at the same four, so such a rewrite is noticed without a request for it)
[ASSUMED: at scan, a 200 MB plugin costs about a second once].

**The visual hash.** A set of cosmetic plugins in load order is named by
`vs = sha256(canonical({ v: 2, assets: <SHA-256 of data/assets.json>, overlays: [{ id, version, files, writes }] }))`,
`files` mapping every file that shapes a plugin's overlay — `plugin.json`, `plugin.lock.json`, the `assets` file, every
file the overlay serves [ASSUMED] — to its identity SHA-256: canonical manifest JSON without notices/theme, canonical checked `{ spine }` for a cosmetic lock, and raw bytes for the assets document and served files. Raw manifest and lock hashes remain separate for verification (§6). `writes` is the SHA-256 of the canonical JSON of the plugin's writes
as the server serves them (`writesHashOf`: the slots, the files of the plugin they name, its references, a Spine model's
clip data — never a URL): the same identity inputs and writes give the same `vs`; a changed shaping byte or a file moved to another slot gives another. Notices and personal theme values do not enter these inputs.

**Served:**

- `GET /p/<id>/<hash8>/<path>` — a file a loaded cosmetic plugin's overlay names, and nothing else of its folder: no
  `plugin.json`, lock, document or other file, no dot file, no `..`, and only the very file the scan hashed: a symbolic
  link is never served — one in the folder when it is scanned is no file of it, and one put in place of a served file
  later, or in place of a folder on its way, is refused (404) wherever it leads, another file of the folder included
  (the request `lstat`s the path and wants the real path the scan recorded — both read with the native realpath, so a
  plugins folder spelled in another case than on disk still works on macOS and Windows). `<hash8>` is the first 8 hex digits of the
  file's SHA-256 — for every file of a Spine model, of the SHA-256 of its files' SHA-256s, so the skeleton, its atlas and
  pages share one folder. At the hash of the file's bytes, while the file keeps the size, mtime, inode and ctime it was
  hashed with, the answer is `immutable` for a year; at any other hash, or for a file changed since the scan, the current
  file with `no-cache` (as for `/assets/~<hash>/…`, ASSETS.md; a changed file's ETag is its stat identity, never the
  old content hash, and the compressed-body cache keys on the inode and ctime too), and a changed file has the registry
  read the folders again. An audio file is also served **without its extension** — `/p/<id>/<hash8>/voice/s1` for `voice/s1.mp3` —, which
  is how the page fetches it (`public/js/media.js` mediaUrl: download managers such as IDM or 迅雷 pop up a dialog for
  every fetch that ends in `.mp3`, the reason 0.2.6's `/media/` route exists; with a `.mp3` and a `.ogg` of one name the
  one whose hash the URL names; a host without the route still works: the page falls back to the URL with the
  extension).
- `GET /vs/<vs16>/overlay.json` — a set: `{ visual: { v, vs, assets, overlays: [{ id, version, files, writes }] },
  writes: [{ id, ops }] }`, its composition (what `vs` hashes) and each plugin's writes in its own terms — paths of its
  folder, references, a Spine model's clip data from the lock —, never a URL and never a copy of the art manifest (a few
  KB). A browser refuses a document whose composition does not hash to the room's `vs` or whose writes do not hash to
  their part of it (`checkVisualDoc`: the room keeps the installation's art, one toast).
  `no-cache` with the body's hash as ETag [ASSUMED: a 304 costs next to nothing]; 404 for a set the server does not know
  (a set is known once a room resolved it, or the catalogue named a plugin's own; a room holds its set while it uses it,
  of the others the last 256 are kept [ASSUMED]; a document is built once however many ask).

**A room's plugins.** The room's top bar shows 「原版」 or 「插件 ×N」; it opens the 插件 panel (`public/js/ui/pluginPanel.js`):
the server's cosmetic plugins of scope `room`, with the host's switches (read-only for the other players and the
spectators, and during a match), versions, authors, sizes, 非官方 marks, 「自动」 on one switched on because another needs
it, a note for one made for other game versions (a cosmetic plugin is still usable) and the override warnings. A switch
sends `room.setPlugins { plugins: [{ id }] }` (host, before the match; like a difficulty change it un-readies the others —
not when only the 「自动」 marks change; the heavy rate-limit bucket): the server closes the set over the plugins'
`requires`, refuses conflicts, a cycle, a plugin of another class or scope, and a set over 300 MB of art or whose
references copy over 4 MB of the art manifest [ASSUMED] (`PLUGIN_UNKNOWN`, `PLUGIN_BLOCKED`, `PLUGIN_DEPENDENCY`,
`PLUGIN_CONFLICT`, `PLUGIN_LIMIT`), sorts it (`shared/plugins/order.js`: requires / optional / loadAfter / loadBefore, then priority, then
id) and the room's content becomes `{ cs, vanilla: true, vs, plugins: [{ id, version, class, hash, auto? }], warnings,
bytes }` — `cs` the vanilla one. Every member's page fetches `/vs/<vs16>/overlay.json`, checks that its composition
hashes to the room's `vs` (`checkVisualDoc`) and composes the art itself on the manifest it loaded (`/data/assets.json`,
its `/assets/~<hash>/…` URLs; `shared/plugins/visual.js` prepareVisualDoc / layVisualOps): every plugin URL is built
from the composition's file table — `/p/<id>/<the first 8 hex digits of the file's SHA-256, or of its model's>/<path>` —,
every reference copied out of the page's own manifest, the plugins in the composition's load order, so what it draws is
exactly what `vs` names; a write that does not fit (a file the table lacks, of another kind than its field, a path
outside the containers, a model out of its folder or of the lock's shape, a reference the page's manifest lacks) is left
out and its entry keeps the installation's art. Leaving the room takes the art away again. A document that fails the
check or will not download (an attempt is given up after 30 s [ASSUMED], two retries), or a write left out, leaves the
original art there (one toast per page). Whenever the art changes under a page — the room's set arriving after its
board was drawn (a reconnect, a spectator joining a match), a personal plugin switched during a match, a set taken away —
what is already on the board follows: a piece or unit whose picture or model the manifest no longer names loads the new
one, which replaces the old in place (`render/units.js` retryAssets) — and one whose picture or model came from a plugin
alone (the installation's slot is empty: a summon, an enemy without a web model) loses it with its layer, a load still in
flight dropped —, and the backdrop mountains and the shadow sprite
follow their `ui` entries, and the music plays the screen's track again when its URLs changed. A plugin file that will
not load — an image of the interface, a picture, a Spine model (any of its files, or one the renderer cannot build; not
while the tab is hidden) or the shadow sprite of the board, a sound — makes its entry fall back to the art
beneath it, the installation's (or the room's, under a personal plugin), for the rest of the page's life [ASSUMED]; a
sound plays the installation's entry instead at once (the BGM track, the voice line of the same slot, the same sound,
the bond cue).
When a plugin of a room's set changes on the server while the room uses it (the registry read the folders again — a
served file found changed, or the folders' own signature), the host is told once (a toast; during a match, once the
room is back in its lobby) to apply the plugins again:
the panel's 「重新应用」 sends the same choice, which makes the set of the files as they are now; until then the room
keeps its set — its changed files go out under the old URLs with `no-cache`, and what will not load falls back. A plugin the
server no longer offers stays in the panel by its id, and its switch only turns it off. With no plugin the room's
content is exactly the vanilla `{ cs, vanilla: true, plugins: [] }`. A server says how many unofficial plugins it has
in `/healthz` (which every page reads at once: the build guard) and in `welcome`, as `content.plugins` — only when there
are some; the title screen's 「本服务器安装了 N 个插件」 is that count, and the catalogue is fetched only then, when
something needs it (the title's list, the 插件 panel, 设置's 外观插件, a switched-on personal plugin). So a page of a server
without plugins makes no request more than 0.2.6's but for three small modules at start (`public/js/content.js`,
`public/js/cosmetics.js` — the layers —, `public/js/ui/pluginTag.js` — the room's tag); the panel
(`public/js/ui/pluginPanel.js`) loads when it opens, what checks and composes a set (`shared/plugins/visual.js`) with
the first set, the load-order function (`shared/plugins/order.js`) with the catalogue, and the asset store
(`public/js/assets.js`) with the first match, as in 0.2.6.

**A player's plugins.** 设置 → 外观插件 lists the server's cosmetic plugins of scope `personal`, each with a switch, kept in
this browser only (`localStorage` `sp.pref.cosmetics`), never sent, never part of a battle and seen by nobody else. The
switched-on ones form a set exactly like a room's (`shared/plugins/order.js`, over what the catalogue lists of each:
`requires`, `optional`, `conflicts`, `loadAfter`, `loadBefore`, `priority` — `public/js/content.js` personalSet): a plugin
another one needs is switched on too (「自动」, its switch locked), a switch that would make a conflict or needs a plugin
the server lacks is refused with the room's message, and a choice that went bad since (the server's plugins changed)
keeps what still fits, by id, the rest marked as not in effect [ASSUMED]. Each plugin of the set is fetched as
`/vs/<vs16>/overlay.json` of its catalogue `vs`, checked and composed the same way, and laid over whatever the page draws
(the room's art too), in the set's load order (fetched side by side); one the server no longer has is skipped and stays
switched on for when it is back.

**Statistics.** A match with cosmetic plugins only plays the vanilla content (`cs`), so it counts as the original game in
the statistics overview — the owner's decision of 2026-10-13: its gameplay and numbers are unchanged, and a player's
personal cosmetics never matter; matches with plugins that change gameplay are left out by default (§11). Every stats
record names the room's visual set (`vs`, null without cosmetic plugins — a player's personal plugins are not recorded:
`public/js/ui/stats.js`). The diagnostics name the art: `content: vanilla cs=… cosmetic vs=…
plugins=id@version(hash),… personal=id,…`. BattleSpecs may carry the room's `vs` for diagnostics (§11); the sim
never reads it. A standalone replay does not restore those cosmetic files automatically.

**Limits** [ASSUMED]: 300 MB of art per set, 20 000 writes per plugin, 16 files per voice slot, 64 skins per operator's
record, 64 characters for a skin key (an entry key takes 128, §9), 1–64 characters for a skin's `name` (0–64 for its
`group`), 32 override warnings per set, 2 MB copied by references per plugin and 4 MB per set, the lock's limits above; the
plugin limits of §5 apply too.

**Start from** `plugins/_template/cosmetic/` — two original CC0 files (a checkerboard PNG and a short synthesized OGG) plus installed-art references. Never put files
of the official game in a plugin.

### Operator effects (0.3.1)

An operator record can borrow official effects independently of its model:
`"fx": { "unit": "char_112_siege", "skills": { "0": "skchr_siege_3" } }`.
`unit` must be an exact extracted index unit key (no suffix stripping); `skills` maps our zero-based slot or exact skill id to an official skill id.
The slot wins [ASSUMED]. Explicit unit/skill mappings precede the existing fallback chain. Attacks, projectiles,
hits and skill start/loop/end use the existing official renderer (3D); no gameplay is inherited.
[ASSUMED] Borrowed talent visuals select only the borrower’s equipped talent indices, plus the trait; module
visuals still require that active module. A missing exact unit disables its entire skills map, including skills
present in the global table, and keeps the old resolution chain. Missing skills also fall through. A missing unit
produces one console note per view. Studio/check warn about locally absent units; malformed declarations refuse the plugin.

`setup --local` now also extracts used effects. Startup/update setup discovers official character references in
installed plugins' declared JSON (`fx.unit`, `origin.charId`, `art.ref`, `art.assets`, official-format charIds and asset
references), including characters absent from our roster. The Python extractor calls the same repository-owned JSON
reader: no plugin module is loaded. A new reference missing from `public/assets/local/fx/index.json` asks for a
re-extract, default **no**; typed yes, `--local` or `--yes` authorizes it. `--check`/`--no-local` never extract.
A declined reference set is remembered; a different set can ask again [ASSUMED]. Missing client bundles remain
unavailable; extracted files stay ignored. Discovery caps [ASSUMED]: 256 folders, 64 declared JSON files per plugin,
8 MiB per file, 24 levels and 100,000 values per document.

Since §34.28, that same discovery also drives optional **operator art** for official ids outside the shipped roster.
`setup --local` extracts base/E2 avatars and portraits and default Front/Back battle Spine models from the local game,
with no network. Startup/update asks again for missing operator art with the same opt-in rules above. Extracted art
is indexed in `data/local-assets.json` and merged into the served asset manifest before cosmetic layers: shop cards,
details, 自选 and the board can draw the imported official operator. A plugin's own art still wins. Without extraction
or matching local bundles, the plugin's own art works; otherwise missing pictures/generic board markers remain.
[ASSUMED] Existing installation slots win over extracted slots, partial extraction keeps earlier successes, and the
gap check requires base pictures/both directions plus E2 pictures when the cached official table declares E2.
Discovery requires membership in the cached official character table; a missing/unreadable table yields no ids.
[ASSUMED] Discovery and the Python planner cap each run at 256 distinct operators, sorted after deduplication and
roster exclusion. The default-yes vanilla extraction prompt does not grant art consent: setup resolves the art gate
before full extraction, and direct full `extract.py` runs require `--plugin-art` (or explicit `--only plugin-art`).
Registry checks and packing keep `assets.add`/`assets.override` classification against the original `data/assets.json`;
references use the merged manifest. One broken sprite is logged without skipping later sprites in its bundle.
This adds no plugin fields and changes no gameplay/content hashes. See [ASSETS.md](ASSETS.md#official-operator-art-referenced-by-plugins-031)
for paths, scratch-only extraction and limits (no extra skins, illustrations or voices).

A cosmetic plugin, or a content plugin's own assets, can put this inside its `assets` object/file:

```json
{"fx": {
  "flipbooks": {"flash": {"image":"fx/sheet.png", "frames":8, "cols":4, "fps":16,
    "anchor":[0.5,0.5], "scale":1, "blend":"add", "loop":false}},
  "bind": {"char_x_my_pack_guard": {"0": {"skillStart":"flash", "hit":"flash"}}}
}}
```

Bindings select unit → zero-based skill slot or exact id → `skillStart`, `skillLoop`, `skillEnd`, `attack`, `hit`,
`projectile`. Referenced effect IDs must exist in the bundle. Units must belong to this plugin or a declared
dependency [ASSUMED]; official units cannot be overwritten. Every runtime unit/skill/prefab/texture key is namespaced as
`plugin:<plugin-id>:<local-id>`. Files and declarations are pinned by the existing visual `files`/`writes` hashes.
The browser rechecks unit ownership and prefab bodies before preparation and merge; invalid bundles contribute
nothing. The loader pins the provider/dependency owner list with the payload; binding keys cannot grant ownership.

Flipbooks use Pixi sprites on **both boards**, obey 官方特效 (off hides them), and advance in battle seconds
[ASSUMED]. Frames read left-to-right, top-to-bottom, skipping unused cells; image dimensions must divide the grid.
Defaults [ASSUMED]: anchor `[0.5,0.5]`, scale `1` (one tile wide), blend `normal`, loop `false`. Skill loops stop on
skill end/death. Other looping books stop after one cycle unless a duration is supplied. Projectile bindings use
generic projectile speed and play hit on arrival [ASSUMED: events carry no authoritative arrival time]. Without a
custom projectile, ranged hit bindings use the same estimated arrival time. Melee hit bindings use the damage event.
[ASSUMED] Ranged damage has no source id, so an estimated arrival never suppresses a damage-event spark.
Only an identified source whose hit effect draws replaces that event’s spark; other attackers and husk hit-count
events retain their normal handling. Owner/target death cancels pending arrival hits, with or without a custom projectile.

Compiled effects add `"index":"fx/index.json"`. This version-3 `fx-index` fragment contains `units`, `skills`,
`prefabs` and `textures: {"sheet":{"file":"fx/sheet.png"}}`. Prefabs are version-1 `fx-prefab` JSON under `fx/`,
following [the extracted format](design/vfx-format.md), with this validated subset:

- Units: `kind:"char"`, skills, modes, optional startEffect/deadEffect. Skill copies match index.skills.
- Skills: uses (`keys`, role, from, optional ability/oneshot), optional mode/rootClass. Roles: start/loop/end/hit/cast.
  Mode attacks have cast/hit rows (`effects`, optional oneshot/startEvent/endEvent).
- Parent-first nodes, transforms, built-in Quad meshes or particle systems, renderer material indices, and optional
  ParticleEffect behaviour (`_isLoop`, `_maxLifetime`, `_spawnLocation`, `_delayToPlay`, `_delayToFinish`, `_rotateType`).
- Scalar InitialModule lifetime/speed/size/color/capacity and EmissionModule rate/bursts. Built-in additive/alpha
  particle materials only. No prewarm, scripts, shader source, URLs, custom meshes, clips, subemitters or effect chains.

Unsupported components fail validation. Compiled effects remain 3D-only. All author limits are **[ASSUMED]**:
256 files/32 MiB per bundle; 1 MiB per JSON/4 MiB JSON total; 64 units; 128 effects/textures; 64 nodes, 16 systems,
1,024 particles and 32 emitters per prefab; 256 particles/system, 16 bursts/system, rate ≤256/s, lifetime ≤30s,
speed/size/simulation-speed ≤8, delays ≤30s, burst repeats 1–16 with interval 0.01–30s, numeric values within ±10,000. Textures: 8-bit RGB/RGBA PNG, dimensions ≤2,048 (no SVG/JPEG/WebP).
Flipbooks: 1–256 frames, 0.1–60 fps, anchor 0–1, scale 0.01–8, normal/add blend; 128 live custom instances,
600-second held loops. Existing renderer tier/particle caps still apply. Removing/replacing a visual set clears its effects and destroys cached flipbook base textures; destroying the player does the same.

DSL: `{"fx":{"kind":"plugin","id":"flash","at":"self","dur":0.4}}` draws an effect in the same plugin's
assets. The loader compiles this into the existing plain fx event, kind `plugin`, effect address in `extra.skill`,
anchor unit id in `extra.id`. Absent effects are visual no-ops. Cross-plugin addresses are not accepted [ASSUMED];
use cosmetic bindings. Loader/client extensions live outside the hashed shared/sim source, preserving vanilla and
old plugin content hashes. Only sets using new fields gain new data/visual hashes.

Forge `fx.silentPhases` imports to `assets.fx.silentPhases`: union with built-in silent kinds, suppressing only the
procedural phase flash; model form changes remain. Empty lists produce nothing; unknown fields remain named skips.
At most 128 identifier-like names [ASSUMED].

Review saved files in `/studio/`: **试一场 → 单干员对木桩 → 优先使用插件的新干员 → 开始对照**. Effect replays carry
actual plugin render records and hashed preview assets. **画面** switches 3d/2d; **官方特效** switches off/lite/full
(switching restarts playback). Check skill start/loop/end, attacks, moving projectiles/hits, pause/replay and removal.
Official mappings need local extraction. `/studio/console.html` stays vanilla-only: use the borrowed official
operator there as a reference. API names are in [PLUGIN-API.md](PLUGIN-API.md).
### 9.1 Theme variables

A cosmetic plugin (and a trusted one) may set `theme.vars`, a map of custom properties to values. A flat map whose every key starts with `--` is the same declaration [ASSUMED]. A single relative JSON file may hold either shape, checked by the same validator when scanned. The permission is `theme`. The names are only the colour, time and easing tokens this installation defines on `:root` (`shared/plugins/theme.js`, from `public/css/theme.css`). A colour is `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or `rgb()` / `rgba()` / `hsl()` / `hsla()` with numbers and percentages. A time is `0–2000ms` or `0–2s`. An easing is `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `step-start`, `step-end`, or `cubic-bezier()` with x in 0–1. `url(`, `var(`, `calc(`, quotes, backslashes and `; { } < >` are refused. [ASSUMED] At most 64 variables; each raw value is at most 400 characters (UTF-16 code units), checked before trimming or parsing on both server and client. The schema declares the same value bound. One bad name or value refuses the whole theme on our manifests (`PLUGIN_THEME_NAME`, `PLUGIN_THEME_VALUE`, `PLUGIN_THEME_LIMIT`, `PLUGIN_THEME_SHAPE`, `PLUGIN_THEME_URL`). `check --strict`, the registry and the studio call the same function.

The page writes the variables of the player's switched-on personal cosmetic plugins with `documentElement.style.setProperty`, in plugin-id order. [ASSUMED] The later id wins a shared token, and the 外观插件 panel names that plugin. Switching one off removes the properties at once. A room's visual set does not apply them, and they are never sent. No stylesheet is injected. [ASSUMED] Fonts, z-index, `--t`, `--bk-l`, `--bk-w`, `--sa-*`, `--tap-min` and properties that are not on `:root` are not tokens. Functions/keywords are lowercase; numbers are decimal without exponents or an explicit plus, with CSS ASCII whitespace. Cubic-bezier y values may be any finite number.

### 9.2 Announcements (公告)

Any plugin may declare `notices`: a list of `{ id, title, body, date?, i18n? }`. `id` is `/^[a-z0-9][a-z0-9-]{0,31}$/` and unique in that plugin. `date`, when present, is a valid calendar date in `YYYY-MM-DD` [ASSUMED]. `i18n` maps a valid BCP 47 language code to `{ title, body }`. This is data, not a part and not a permission. [ASSUMED] Plain text: the page renders the strings as text, so `<` and `>` stay characters and a link is not an anchor. Newlines in the body are kept. A title has no newline. Empty text is refused. [ASSUMED] Caps: 20 notices, a title of 80 characters, a body of 2000 (`PLUGIN_NOTICE_SHAPE`, `PLUGIN_NOTICE_TEXT`, `PLUGIN_NOTICE_LIMIT`, `PLUGIN_NOTICE_LANG`). One problem refuses the whole list.

[ASSUMED] Every loaded plugin's notices are shown, whether or not a room selects that plugin. They ride on `GET /plugins/index.json` (no separate route). `content.notices: true` in `/healthz` and `welcome` tells the page to fetch the catalogue even for a language-only installation; the hint is absent when there are none and never enters room content. The catalogue keeps at most 100 notices and 48 KiB of serialized notice arrays (UTF-8, including escaping, ids, dates and translations), newest first, skipping any entry that would not fit and continuing to smaller entries from other plugins. A single otherwise valid notice larger than the byte budget is omitted without suppressing other plugins. The client independently applies the same count and byte caps. The title screen and the lobby show 公告 only when there is at least one. The popup lists them newest first (a dated notice before an undated one, then plugin id, then notice id) with the plugin's name, in the player's language when that notice has a translation. A dot marks unseen ids. Seen ids are `sp.pref.notices-seen` in this browser; every access is in try/catch. [ASSUMED] Opening the popup marks every notice then on screen as seen, and the list keeps at most 400 ids. Notices never enter a content hash, a room's composition or a match. Adding the first notice and removing the last one follow the same rule. Notice-only personal cosmetics stay available for dependency resolution even though they have no visible switch and no overlay to fetch.

## 10. Data plugins (P1b)

A `content` plugin is now `loaded`: the registry snapshots its declared JSON; `buildContentSet` applies the selected
plugins in dependency order and validates the **whole merged data**. No third-party code is imported or evaluated.
Room selection, worker isolation and HTTP/client switching are §11 (P1c). Start with `plugins/_template/content/`, copied
to `plugins/data-demo/`. Rename its record namespaces too when renaming that folder.

### Rule switches

Since 0.3.1, a content plugin can carry only `rules`, with no data files or permissions:

```json
{ "manifest": 2, "id": "prep-rules", "name": "Prep rules", "version": "1.0.0",
  "app": ">=0.3.1 <0.4.0", "api": 1, "class": "content", "scope": ["room"],
  "rules": { "prepLoadout": "prep", "unequip": "allow" } }
```

`shared/plugins/rules.js` owns the closed table (`RULE_SWITCHES`); the manifest validator, composition, match,
sim and client share its helpers. The editor schema mirrors that table and a test checks it. Only declared
switches enter `index.rules`, the room summary and the content hash, including an explicitly selected default.
An absent key adds nothing; [ASSUMED] an empty object is treated as absent. Unknown switches/options or a
non-gameplay class declaring rules fail with `PLUGIN_RULES`. [ASSUMED] script and trusted plugins may declare the
same rules as content plugins; their existing execution gates still apply. Conflicting declared options fail
composition with `PLUGIN_RULE_CONFLICT`, naming the switch and both plugins; repeating the same option is fine.
Rooms display active non-default rules in words in their plugin tag, panel and match HUD. A client cannot enable one.
The match host takes rules from the verified content set, overriding any per-match options.

| Switch | Default | Other option and effect |
| --- | --- | --- |
| `shopBias` | `official` | `bondBias`: shop item candidates prefer `giveBondId` in this player's active bonds, after the stock gate. The tier still follows chess-tier shares. No matching available item in that tier falls back to the official candidates of that tier. Rolling grants nothing. No core-bond priority, Knight discipline bias, or `giveBondBiasOnly` interpretation. |
| `prepLoadout` | `locked` | `prep`: existing `room.loadout { entries, ops? }` also works during PREP before this seat is ready. Each submission overlays only named operators. Named defaults reset them; omitted operators retain their choices. INFO_CHECK remains a full replacement independent of ready. The prep HUD opens 干员调配 and closes it on ready or phase exit. [ASSUMED] `ops` uses the same merge semantics. |
| `morphPairing` | `official` | `plus`: a morph (`canGiveBond`) is required; only the leftmost other item with a valid `giveBondId` grants a bond. The morph takes no equipment slot, at most one morph per operator; two ordinary slots remain. Replacing an item never destroys the morph. The same helper drives prep/effects, combat and client bond displays. |
| `unequip` | `official` | `allow`: `g.unequip { itemUid }` moves an equipped item into the rightmost free hand slot, else a free temporary slot. Both full: atomic `HAND_FULL`, retaining the original equipment order. Same uid and stock, no content hook; bots never unequip. |

The workshop defines both halves of morphPairing precisely, so the slot policy is implemented too. [ASSUMED]
requesting the morph as a replacement falls back to the leftmost occupying item; a second morph returns BAD_TARGET.
[ASSUMED] unequip follows the other prep intents' ready lock and considers only the five visible temporary slots;
hidden overflow is not free space. Ordinary recycling returns every equipped item and needs no slot-cap check here.
Official policy is a frozen singleton with the original slot arithmetic. BattleSpec includes `morphPairing: "plus"`
only for this option, for normal, shared, boss and rehearsal battles.

After a validated prep loadout change, affected owners' summon cards are reconciled against their selected
skill/module stock across board, hand and temp, then the player is recomputed (including owner-range checks).
[ASSUMED] Keep valid deployed cards in board reading order before hand/temp index order, remove obsolete/excess
copies, and grant missing stock through the ordinary hand/overflow queue. Removed temp cards lose their deadlines.
No-op submissions and unaffected owners do not replenish spent stock; invalid submissions change nothing.

Rule-less hash inputs, plugin file hashes and vanilla data bytes are unchanged, and no golden scenario moves.
The build's `cs` still hashes all served shared/sim source bytes (§6), so this engine update changes that code hash;
it does not freeze or exempt changed code from identity verification.

**Patches** (`shared/plugins/patch.js`): a manifest `data` file is `{ "patch": 1, "ops": [...] }`.
Each operation names `file` (without `.json`), optional record `id`, and `path` (array of keys/indexes):

| op | meaning |
|---|---|
| `set` | replace an existing field with `value` of the same type. `null` is its own type: it may be written only onto a field that is already `null`. Washing a number through `null` into an object is `PLUGIN_PATCH_TYPE` and returns the original data |
| `merge` | recursively merge an object into an existing object; arrays replace whole arrays |
| `add` | add a new namespaced record with `id` and object `value`; `config` uses `path: ["modes"]` |
| `append` | append the elements of array `value` to an existing array |
| `remove` | remove array values equal to `match`; it never deletes a record or an object field |

Unknown operations, absent paths, wrong types, unsafe keys (`__proto__`, `constructor`, `prototype`), missing settings,
record deletion and invalid new ids produce structured `{ code: 'PLUGIN_*', path, message }` problems. A failing patch
returns the original input, never a partial application. `applyPatches(data, ops, { pluginId?, settings? })` is pure.
`{ "$setting": "name" }` in patch values resolves against normalized manifest settings. Out-of-range settings use the
default; only declared settings enter `cs`. Repeated writes in different plugins are reported as warnings; later writes
win. To change another plugin's records, declare its id in `requires` (a load-order hint alone is insufficient).

Records sometimes keep a convenience copy of a blackboard: `bonds[id].bb` is used by presentation, while battle
handlers may read `bonds[id].buffs[n].bb`. Change both when changing that number; the template demonstrates it. Likewise,
changing a default skill requires keeping `skill` equal to its `skills[]` entry. Validation catches inconsistent skills.

**Compact operators** (`operators` manifest files; `schemas/records.schema.json`): one object or an array, with `op: 1`,
`charId`, `name`, `profession`, `subProfessionId`, `position`, `rarity`, `as`, `forms.normal`, `forms.elite` and `skills`.
Each form supplies `stats` and `rangeGrid`; optional form `skills`, `trait` and `talents` override the shared ones.
A MELEE form may set `placeOnRanged: true` [ASSUMED] (no official plugin source; the Simplified trait line still places when the flag is absent). The expander copies only that boolean onto the shop chess and the 自选 form. A RANGED form's flag, and any value other than `true`, is ignored.
`skills` has exactly one `default: true`, and each skill supplies `skillId`; the expander fills index, SP, trigger,
blackboards and display fields. `as: "chess"` needs `chess: { tier, bonds, price?, garrisonIds?, sellPrice?, identifier?,
shopSortId? }`: normal/elite ids, prices, sell values and merge counts come from that tier's economy, and statuses
from `economy.chessStatus`. `price` and `garrisonIds` are one value for both pieces or `{ normal, golden }` (an official
pair's garrisons are `garrison_N_a` / `garrison_N_b`); `sellPrice` is one value. `as: "diy"` creates
`backups.units`, every existing DIY slot status, `diy.ownedPool` and `diy.operators`; `"both"` does both. The expander
adds shop chess to their bonds' member lists. An existing record must be changed with patches.

Behavior is `kit: "generic"`, `{ "ref": "<official kit key or file stem>" }`,
`{ "spec": <JSON SkillSpec or JSON file path> }`, or `{ "dsl": <DSL spec> }`. Files are JSON, including transitive spec files. `art: { ref: charId }`
references an installed character id (`^[A-Za-z0-9_-]+$`, the same pattern as `art.assets`); a path or URL is
`PLUGIN_RECORD_ART`. It carries no art file. `talentMods` supplies permanent numeric mods with a
JSON SkillSpec. Per-skill `skillSpec` overrides the operator's spec for that selection.

`kitOf` resolves extensions → `raw.dsl` → `raw.skillSpec` → `raw.kitRef` → official kit → generic. When the record
carries `dsl`, `kitOf` calls `compileDsl`. The builder stamps `pluginId` on that record; the author's spec is not
rewritten, and a written `pluginId` must match the host (`PLUGIN_DSL_PLUGIN_ID`). Using DSL needs the `dsl`
permission. A bad spec refuses the whole content set. Explicit test kits still take precedence. `talentMods` go with
a JSON SkillSpec or with `kit.dsl`. A record that carries both
`kit.ref` / `kitRef` and `talentMods` is `PLUGIN_SKILL_SPEC` at expansion and again in `validateData`; the schema file
still allows the pair, and the runtime rejects it. File stems resolve only against the official registry, never an
import path. A referenced kit's numbers come from the new record. Keep official skill ids to use its named alternate
skills; a one-skill DIY clone can reuse a chess kit's default skill [ASSUMED]. A one-skill DSL kit uses the same
`bindDefaultSkill` helper, so a 自选 piece and a 补位 stand-in take that default spec as `skills[id]`
(`skillSource: 'skills'`). A shop chess keeps `kit.skill`. Multi-skill clones are not auto-bound. `extensions.js` stays empty for vanilla; P3a registers
scripts through it (§13); `dsl/compile.js` is P2's compiler (§12) and data plugins use it (§12, PLUGIN-DSL.md §9). A plugin operator whose id
starts with `char_x_` and whose chess and backup records have neither `potDown` nor a talent `potBelow` accepts only
the default potential 6. Official operators, including `char_616_pithst`, are unchanged. 调配 and 自选 omit its potential control; 练度 remains available. Sync drops a stored non-default potential
and the server rejects a raw client message.

The JSON SkillSpec allowlist is SIM §7.3 without callbacks: kind, deployment activation, duration/ammo/SP/charges,
trigger, heal, mods, flags, targeting and attack (including chain/heal/onHitStatus). Unknown fields, functions, wrong
types and unknown mod/flag names fail. Work bounds [ASSUMED]: attack/chain/target/ammo/charge counts ≤ 100, a range at
most 1024 integer offsets within ±64. No JavaScript string is executable.

**Other records**: a manifest `data` file may instead be `{ "records": 1, "entries": [...] }`. Each entry is
`{ file, id, base?, set? }` or `{ file, id, value }`; `base` clones an existing record before applying `set`.
Supported files: enemies, waves, stages, modes, items, bands, garrisons, effects, tokens, choices and bonds (0.3.1). The dedicated
`enemies`, `stages` and `modes` files use the same shape with `file` supplied by their manifest part.

- Enemies can use `special: "<official enemy key>"` to reuse that enemy's data and kit. It is a specific enemy, not an
  entire faction category: those categories contain many different behaviors. Changes still use the concrete record's
  stats/blackboards. Waves supply routes and spawns; the expander fills empty branches, overrides and device lists.
- Bands and inherited items require an official `base` or `value.effectRef`; the result retains `effectRef` and the concrete
  record's copied/overridden buffs. Battle item identity checks and prep dispatch recognize it. A compact item is a
  single non-merging record [ASSUMED]; paired equipment uses the complete records described below.
- Garrisons reuse an existing `effectKey`; effects reuse existing buff handlers. Choices use
  `{ file: "choices", id: "effect_x_data_demo_card", kind: "tactic" | "bounty", base: <card effectId>, set?, effect? }`:
  the new card and its cloned effect are added together. New bond behavior uses prep DSL, member DSL talents (§12), or a script plugin (§13).
- Bonds use `{ file: "bonds", id: "bond_x_<namespace>_<local>", value: { name, desc, thresholds,
  countMode, isCore?, identifier?, bondOrder?, iconId? } }`. `thresholds` is an ascending list of 1–16 positive
  integers, each at most 100 [ASSUMED]. `countMode` is `BOARD`, `BOARD_AND_DECK`, or `BOARD_ALL_CHESS`
  (elite pieces, including duplicates). Members come from chess `bonds`, including patches to official pieces;
  composition rebuilds `members` and `visibleMembers`. Defaults [ASSUMED]: extra/REGULAR, order and identifier 10000, icon by id; `isCore: true` defaults to SEASON. Layers use the existing persistent state and caps. Strip,
  popup, shop and bots read the same records. Icons use cosmetic `art.bonds[<bondId>]`.
  No behavior follows from a name or description [ASSUMED]: prep `dsl` files can guard funds/layers/gainItem with
  `if: { bondActive: "<id>" }`; members may use `kit.dsl.talents` with the same condition, or sandbox kits.
- Complete item records may omit a base when their `buffs` use existing item handler pairs (`key` and `bbStr.key`).
  They retain explicit `baseId`, `goldenId`, `isGolden`, `upgradeNum`, `upgradeChessId`, `mergeable`, tier, price and
  shop flags, so normal/advanced equipment can merge. Inherited compact items keep their earlier single-item rule.
  Effects and token references must resolve; unknown behavior keys are refused. Complete records are validated by
  `server/plugins/gameplayRecords.js` before ordinary content validation; the legacy shared schema is unchanged.
- Compact operator forms can also carry `tags` and `tokens` (at most 64 strings [ASSUMED], token ids must exist).
  DIY references receive a separate token id and per-status backups variants; a unique authored status variant wins,
  then, only when no status variant matches, the variant keyed by the form's chess id (normal/elite). An ambiguous
  status match or missing chess variant uses the complete token base with a skill source [ASSUMED]. Token records
  alone do not summon anything: the operator kit or placement mechanics must use them.
- A mode requires an official `base`; nested objects inherit field by field and arrays replace whole arrays.
  The base's choice schedule is copied. Changes to that schedule can then be patched explicitly. `GameData` overlays
  mode-level economy, DP, timers and other global configuration keys; omitted values retain the official defaults.
  Explicit mode chess purchase/sale prices override record prices. A room picks a mode with `room.setMode` (§11).
- New or changed stages get ground paths from the same `Grid` helper as build-data (`server/sim/groundPaths.js`), with and
  without active devices; deployment lists are derived too. The board stays 19×21. A base stage is the easiest start.
  A plugin that changes only a wave's `routes` or `extraRoutes` recomputes `groundPaths` for stages listed on modes
  whose round `template` or `bossTemplates` name those waves, from every current route, and keeps that stage's
  `deployTiles`. [ASSUMED] bots then read the new paths; deployment lists stay the stage's own.

**Boss centre column warning (#659 / #660).** Official stage levels
(`levels/activities/act1autochess/level_act1autochess_m01…m07.json` and
`act2autochess/level_act2autochess_m01…m04.json`, `mapData.tiles[].buildableType`) have `NONE` at boss-field
column 10, rows 1–5. Deployable halves occupy columns 3–9 and 11–17; the centre is the leader / teleport lane.
Both prep boards' column 10 maps to field column 10 (left: 10; right: 20 − 10). Making it deployable lets two
players place a unit on the same field tile; battle deploys only the first. Registry scans, `plugin.mjs check`, and
Studio validation report `PLUGIN_BOSS_CENTRE_DEPLOYABLE`, naming the stage and affected **field row indices**,
when a non-solo mode with Final Assault or Hidden Core uses such a stage. The complete content-set check also
catches stages supplied by dependencies. Folder checks use default settings; dependency-only paths need that
complete check. [ASSUMED] Warn for effective `buildable` ALL / MELEE / RANGED even under removable blockers,
and for active deployment platforms on the centre column. Set those tiles to `NONE` and move the platforms.
Per the maintainer's decision of 2026-10-17 this is only a warning: no placement, mirroring, or battle rule changes.
Ordinary `check` succeeds; `check --strict` fails on this warning as on any other warning. Official maps produce none.

New record ids are ≤64 ASCII letters/digits/`_`/`-`. The plugin id replaces `-` with `_` inside records. Prefixes:
`chess_x_<plugin>_<name>_a/_b`, `char_x_…`, `skx_…`, `enemy_x_…`, `mode_x_…`, `stage_x_…`, `wave_x_…`,
`item_x_…`, `band_x_…`, `garrison_x_…`, `effect_x_…`, `token_x_…` [ASSUMED prefix choices]. Two selected plugins whose
namespaces collide are refused at composition with `PLUGIN_RECORD_ID`: `data` cannot sit beside `data-demo` (both
prefix `data_`), and `ab-cd` collides with `ab_cd`. `ab` does not collide with `abc`. A plugin folder scanned alone is
not refused. Whole-map writes cannot bypass record namespaces or remove existing records. The shared validator checks
shapes, finite numbers, references, paired forms, the default skill, official kit/effect refs, wave routes and mode
references. One wave, and each phase of a branch, may have at most 64 spawn rows, each an integer count from 1 to 600,
summing to at most 600. Enemy `times` keys (and keys ending in `times`, including wave overrides) stay at or below 100.
`bb.count` of 列装 (`global_special_choice_gain_equip`) and bond-chess (`single_special_choice_gain_bond_chess`) stays
at or below 32. With the official tables as `vanilla`, every numeric blackboard value, and the loop fields enemy
`sp.maxSp` / `sp.initSp` / `sp.increment` and skill `spCost` / `initSp` / `maxChargeTime` / `increment`, must also
satisfy `|v| ≤ max(10 × official absolute maximum of that key, 64)` (`PLUGIN_DATA_BOUND`). A key official data never
has uses 64. Blackboard `ammo` and `charge` use that blackboard rule. The battle clamps the same spawn, enemy-times
and card-grant loops, and the loops fed by the systematic cap (operator `times` / `attack@times`, band and 维多利亚
`count`, 黑云 ammo, 狱警 pierce). [ASSUMED] the factor 10 and the floor 64 sit above the measured official maxima
(`times` 12, `attack@times` 5, `count` 20, enemy `sp.maxSp` 55) and far below ±1e9. Durations are not given an engine
loop cap; a blackboard `duration` is still subject to `PLUGIN_DATA_BOUND`. Some `count` reads are one addition
(`addLayers`, a single coin multiply) and bond layers still stop at 999; band grants and 维多利亚 hammers do iterate
`count` and use the systematic cap, not 32. `jsonProblems` still allows a number whose absolute value is 1e9.
Official counts, official trigger deviations and source-specific rules stay in
build-data; its original data is unchanged. `node tools/records-schema.mjs` rewrites `schemas/records.schema.json`
from the runtime schema (an optional output path overrides that file).

Counts read from skill, talent or trait text go through `textCount` (`shared/plugins/textNumber.js`). The result is
finite and at most `max(10 × the official maximum of that phrase, 64)`, or 64 when vanilla text never matches it.
A matched run that is not finite clamps to the cap. Official phrases do not change: every scanned maximum is at most
15, so the cold floor of 64 does not move them either. Percents and durations use `textFinite` and are not forced
down to a count cap (`持续120秒` stays 120). `parseN` and `textNum` are `textFinite`. The phrase table is DESIGN §32.5.

A subtract loop whose interval, period or per-step cost comes from plugin data uses `stepOf`. A positive value at or
above the official minimum of that key is unchanged, including official `interval` 0.03 and `atk_interval` 0.025,
both shorter than one tick. [ASSUMED] Raising those to one tick would change vanilla combat. `battle.every` already
clamps its scheduler to one tick. A smaller positive step is raised to `max(one tick, official minimum / 10)`.
Without the table, only a step below a tenth of a tick is raised. The same loop also stops after 8 iterations in
one call. A burst that is not one tick of time uses `burstLimit` (the systematic cap of the official iteration
count), not 8. 娜斯提's skill-end catch-up stops at 80 even when `duration` is 1e9. `duration` is not a skill field
cap. Validation rejects a positive step key below the official minimum / 10 with `PLUGIN_DATA_BOUND` (`低于最小步长`).
[ASSUMED] The step keys are names ending in `interval` or `period`, names ending in `cost`, and `coin_cnt`.

Every content set carries `bounds` (`v: 1`) computed from the vanilla tables. A selection with plugins also serves
`bounds/official.json`. That file is not part of `cs`. The page loads it with the set's data files, checked by its
bytes, and the battle runner installs it; the room's match host installs the same object — so a modded battle runs with
the same caps in the page and on the server. A set without the snapshot runs on the floor of 64 and never scans its own
data. [ASSUMED] Direct `new Battle` still skips validation. The numbers of `factions` the wave generator reads
(`generation`, each type's `count` and `weight`, each entry's `weight`) follow the same rule; the replaced-enemy counts
also stay within 50, the generator's own clamp. The round-type schedule stops at 256. The full loop list, the floors
that were left as they were, and the other residuals are DESIGN §32.5.

Author-facing `PLUGIN_DATA_BOUND` text stays Chinese and is not a player string. `officialBounds.js` is marked
`i18n-ignore-file`. The `联防` diagnostic in `validate.js` keeps its line ignore. The shared error catalogue
(`shared/plugins/errors.js`, §15) explains these codes and supplies fixes to the CLI and studio.

**Languages.** Manifest `sourceLang` describes the record texts (default `zh`). `i18n: { "en": "i18n/en.json" }` uses
the existing `{ version: 1, lang, files: { table: { id: overlay } } }` format. String leaves must target existing strings.
The builder computes `_h` against the final source text and retains valid unrelated base translations. Output lives in
`i18n/<code>.json` in the composition, separate from simulation data. A content selection's `cs` includes the sha256 of
each served `i18n/<lang>.json` body. Vanilla and cosmetic-only selections omit that field, so the P0 hash still
excludes `data/i18n/`. Declared plugin-file hashes alone do not name the served translation snapshot. `index.json` is
not a hash input. [ASSUMED] it cannot diverge while the hashed i18n bytes, data hashes, plugins and settings stay the
same.

**C1 for integrators** (`server/plugins/contentSet.js`):

```js
const set = buildContentSet({ registry, ids: ['data-demo'] }); // or [{id, settings}]
// success: {cs, vanilla, plugins:[{id,version,hash}], data, files:{rel:{sha256,bytes}}, modes, problems:[],
//           index, settings, warnings, kitted}
// refusal: {problems} only — no cs and no partial data
const files = contentSetFiles(set); // Map<rel, {body:Buffer, sha256, bytes}>, defensive copies
```

`data/<table>.json`, `i18n/<code>.json` and `index.json` are the route-relative keys. `index` uses the P0 composition
shape (`plugins` there carry file hashes). Unchanged gameplay files retain their disk bytes and `/data/…?v=` URLs;
changed files are the exact `JSON.stringify` bytes served from memory. The empty set's index and `cs` exactly equal P0
computed from the same checkout. Any served sim/shared-code change naturally changes that checkout's vanilla hash.
Cosmetic selections and dependencies can join the ordering pass; only content plugins enter this result’s gameplay plugin list and hash. Cache: by `cs`, 32 recent sets per registry [ASSUMED]; held set objects and their bytes remain valid after eviction or
plugin removal. Room lifetimes and worker limits are §11's. A content plugin's optional asset part also has a validated
`visual` snapshot; the room's visual set includes it (§11).

Before importing Match/creating its meta registry in a content host, inject the merged singleton data; initialize sim
data and reset `content/support`'s cached data too. The browser uses its `data.js` shim and `loadBrowserSim` to do the
same. Passing only `opts.data` to a Battle does not change content/support's singleton. P1b tests both the Node setup
and the actual browser loader with a patched bond; the match host's worker entry does the same (§11).

## 11. Room content sets (房间内容组合, P1c)

A room's host switches the server's `content` plugins on for the room in its 插件 panel, beside the cosmetic ones (§9).
The room then plays a **content set** of its own: the vanilla data with those plugins applied by §10's builder, named by
its own `cs`. Every member's page downloads that set and checks it byte by byte, and the room's matches run in a match
host of that set, a child process (or, when the server owner asks for it, a worker thread) of its own. Such a match is **unofficial**: marked in the room,
the briefing, the result and the HUD, and left out of the statistics overview unless a player counts it. A room with
cosmetic plugins only still plays the vanilla `cs` and counts as the original game (§9). DESIGN §32.6 keeps the
decisions, the measurements and the open points.

| File | Role |
|---|---|
| `server/plugins/roomSets.js` | what a room's plugin list makes: closed over requirements, ordered, split into the visual set and the content set, the policy's refusals |
| `server/plugins/contentSets.js` | the content sets rooms hold: built through C1 (§10), kept by `cs`, the concurrent limit, the files `/cs/<cs16>/…` serves, the bytes a match host checks |
| `server/plugins/policy.js` | the server owner's `plugins/config.json` |
| `server/match/host/` | the match hosts: `index.js` (one worker or child process per `cs`, the watchdog, the limits), `entry.js` (inside the worker: the bytes checked against `cs`, the data installed before the match code is imported), `proxy.js` (the lobby's room.match for a hosted match: Promise answers) |
| `public/js/content.js` | the page's copy of the room's content set: downloaded, checked, handed to `data.js` and the battle runner, `room.contentReady` |

**Switching** (`room.setPlugins { plugins: [{ id, settings? }] }`). The host chooses plugins by id. The server adds what
they require (shown as 「自动」), orders them (`shared/plugins/order.js`) and splits them by class: the cosmetic ones, and
a content plugin's own `assets`, form the room's visual set `vs`; the content ones form its content set. `settings` are
normalised by the manifest's declared settings (§3) and are part of `cs`. Refused, with the room unchanged:

| Code | When |
|---|---|
| `NOT_HOST` / `ROOM_STARTED` | another player asks, or a match is running |
| `PLUGIN_UNKNOWN` | the plugin is not installed |
| `PLUGIN_BLOCKED` | a class or scope rooms cannot take, the server owner's policy (rooms off or fixed, not in `allow`, the class off), or a set whose merged data does not validate (the builder's first problems are the detail) |
| `PLUGIN_DEPENDENCY` / `PLUGIN_CONFLICT` | a requirement is missing, or two plugins conflict |
| `PLUGIN_INCOMPATIBLE` | a gameplay plugin made for other game versions or another plugin API (a cosmetic one is only a warning, §9) |
| `PLUGIN_BUSY` | one content set more than the server runs at once (`limits.maxSets`, default 4 [ASSUMED]) |

A change of the content set (or of the mode) un-readies the other players, like a difficulty change. Switching
everything off brings back the vanilla shape of `room.state.content` exactly.

**The room's state.** With gameplay plugins `room.state.content` is `{ cs, vanilla: false, plugins: [{ id, version,
class, hash, auto? }], warnings, bytes, dataBytes, vs?, modes?, modeId?, kittedExtra? }`: `dataBytes` is what a member
downloads beyond the vanilla files, `modes` the modes its plugins add (`{ id, name, roomMode, difficulty }`), `modeId`
the one the host chose, `kittedExtra` the operators the set adds to a 自选 slot's list (`welcome.diyKitted` has the
server's own). A modded room passes that full list into the match as `kitted` (the local match, the match host, reconnect
and the test journal / replay). `setDiy` checks a human's 自选 picks against it, so an operator the lobby already
accepted is still there when the match starts. A vanilla match omits the key and stays on `KITTED_CHARS`, so its journal
stays byte-identical. [ASSUMED] Bots still send no 自选 picks; they read a human's composed piece once the pick is kept.
Each human seat and spectator carries `content: 'loading' | 'ready' | 'failed'`, only in such a room. The
protocol increments are listed in `docs/design/network.md` §8.

**Download and check** (`public/js/content.js`). `/cs/<cs16>/index.json` is the set's manifest (§10): enough to
recompute `cs`. The page fetches it and every file it lists: an unchanged one at its plain `/data/<file>?v=<8 hex>` URL
(cached for good), a patched one at `/cs/<cs16>/data/<table>.json`, the set's translations at their URLs. Every body is
read as bytes and checked before it is decoded: its size and SHA-256 against its manifest entry (a BOM is part of the
bytes). The manifest's composition (the data and translation hashes, the plugins and their settings) must hash to the
room's `cs`, and the manifest may name no address but this server's `/data/` and the set's own `/cs/<cs16>/`. Then
`data.js` shows the set (every screen reads its operators, modes and texts), the battle runner simulates on it, and the
page tells the room `room.contentReady { cs }`. A failed check is told too (`{ cs, ok: false }`), and a toast asks the
player to reload. `room.ready` waits for the player's own page and `room.start` for every player's (`CONTENT_NOT_READY`).
Leaving the room, or the room going back to the original content, gives `data.js` the server's files again without a
download. The panel shows the download's progress and the check's result.

**Modes** (`room.setMode { modeId }`). With gameplay plugins the panel shows the room's mode, chosen by the host before
the match and read-only for everyone else. An official mode of the room's type (solo or co-op) sets the difficulty; a
mode a plugin adds (`content.modes`, of the room's type) becomes `content.modeId`, the match's mode, until the host picks
a difficulty or the set no longer has that mode.

**The match host** (`server/match/host/`). A vanilla room's match runs in the server process exactly as before, and so
does a room with cosmetic plugins only. A content set's matches run in one match host per `cs` — a child process —,
shared by every room that plays that set. The host receives the set's data bytes and its hash input, checks them
against `cs`, installs the data (`server/data.js` `setData`) and only then imports the match code, so a plugin's data
never reaches another room. The lobby talks to it through a proxy whose answers are Promises; each such room handles
its messages one at a time on a queue of its own, and a vanilla room never queues. A host that stops answering (no heartbeat for 10 s), crashes or runs
out of memory ends that set's matches only: each room goes back to its lobby and its members read why. Each host has a
768 MB heap; at most `maxWorkers` (4) run at once, and an idle one stops after 10 minutes [ASSUMED, all three].
`SP_MATCH_HOST=worker` runs a worker thread instead of a child process — not on a public server: one large allocation
in a worker thread aborts the whole server process (measured, DESIGN §32.6; `docs/DEPLOY.md`).

**The battle's authority.** A page simulates its battle on the set it checked, and its `b.result` names that `cs`. A page
that holds another content set, or none, for a battle of the room's set is never the authority: it sends no result and
the server takes the field over at the deadline. The server refuses a result that names another `cs` and simulates that
battle itself. A BattleSpec may carry the room's `vs` as well (for the diagnostics; the sim never reads it).

**Unofficial marks.** The room's 插件 tag reads 非官方 with gameplay plugins; the briefing and the result say 非官方 with
the number of gameplay plugins; the HUD shows a small corner mark. Statistics records carry `content: { cs, plugins }`
(null for the original game) and the overview leaves such matches out by default (「含插件对局」 counts them). The
diagnostics line reads `MODDED cs=… plugins=…` and the bug template asks whether plugins were on.

**Server owner's policy** (`plugins/config.json`, git-ignored like the plugins): whether a room's host chooses its
plugins (`rooms: "host"`, the default), every room plays a fixed set (`"fixed"`) or rooms play the original game
(`"off"`); the plugins a new room starts with (`default`); the plugins rooms may use (`allow`); the classes rooms may
use (`classes`: overrides individual defaults — cosmetic/content on, script also on in sandbox/trusted modes, trusted also on in trusted modes; other classes denied); the concurrent content sets (`limits.maxSets`); whether gameplay plugins made for other versions may be
used (`allowIncompatible`). `SP_PLUGINS=off|host|fixed` overrides `rooms`. The file is read again when it changes;
a bad field keeps its default and is reported in the log. `docs/DEPLOY.md` has an example.

**HTTP.** `/cs/<cs16>/index.json`, `/cs/<cs16>/data/<table>.json` and `/cs/<cs16>/i18n/<lang>.json` of a gameplay set
are served from memory with `Cache-Control: immutable` while a room holds the set, and for the last 8 sets nobody holds
[ASSUMED]; the vanilla `/cs/<vanilla cs16>/index.json` is unchanged. `/healthz` counts the content sets in use
(`content.sets`).

**Remaining limitation**: `allowIncompatible` cannot override the builder's incompatible-plugin refusal (DESIGN §32.6). Settings controls and changed-file notices are implemented (§15); DSL in data plugins is §12.

## 10b. Offers — interaction windows

Plugin API 2 (`current: 2`, `min: 1`): PR #682 by **@DuolaCCCCat**, issue #681, completed for 0.3.1.
The `offers` manifest part names JSON files and requires permission `offers` (`content`, `script`, `trusted`).
No plugin scripts run to open, draw, refresh or apply a window. Old API 1 manifests without this part still load.
The manifest schema checks JSON paths, allowed classes, API 2, the required permission and its corresponding part;
the shipped example is validated against both the schema and the manifest reader.

A complete, art-free example is [offers-demo](examples/offers-demo/plugin.json), with
[its window](examples/offers-demo/offers.json) and [cards](examples/offers-demo/cards.json).
Copy that directory to `plugins/offers-demo`, check it, then enable it in the room's plugin panel.

```json
{ "offer": 1, "id": "supplies",
  "when": { "at": "prep", "rounds": [1, 3, 9] },
  "windowSec": 30, "quorum": "all", "onTimeout": "auto",
  "slots": 3, "refresh": { "perSlot": 1 },
  "options": { "source": "cards.json" } }
```

| Field | Rule |
|---|---|
| `offer`, `id` | Version `1`; unique local id, 1–32 lowercase letters/digits/hyphens |
| `when.at` | `battleCheck`, `prep`, or an array containing both |
| `when.rounds` | `[1,3,9]`, `"any"`, `{ "every": 2 }`, `{ "from": 3, "to": 9 }`; omitted means any; rounds 1–99, list at most 64, every 1–32 |
| `windowSec` | Integer 0–300, default 0. **Zero creates no window, sequence, timer or grant, and never blocks** |
| `slots` | 1–6 per seat, default 1; at most 32 window files per plugin |
| `refresh.perSlot` | 0–2 per seat **per slot**; default 0; no refresh after a pick |
| `quorum` | `all`, `majority` (strictly more than half), `none` (default; never holds a phase) |
| `onTimeout` | `auto`/`bot`: first grantable current slot; `skip`: no grant. Default `auto` |
| `defer` | Optional `[]` or `["prepSettle"]`; records intent, with no separate scheduler beyond the hook's gate |
| `options.source` | Required relative `.json` path inside this plugin; checked and hashed transitively |
| `apply` | Optional fallback primitive for cards without their own `apply` |

**Sources.** Only a JSON array or `{ "cards": [...] }` exists in this version; no dynamic tables, weights,
remote URLs or scripts. It contains `slots`–128 cards. Each card has a unique `id` (same syntax as window ids),
nonempty `name` (≤80 characters), `desc` (≤240), `icon` (`funds`, `layers`, `item`, `chess`, `refresh`), and one
`apply` primitive (or inherits the window's). Icons are native symbols; text is rendered as text, never HTML.

```json
[{ "id": "supplies", "name": "Supplies", "desc": "Gain 3 funds.",
   "icon": "funds", "apply": { "funds": 3 } }]
```

**Effects.** One key per primitive: `funds`/`pendingFunds` integer 0–1000; `freeRefresh` integer 1–6;
`layers: { "bond": "<id>", "count": 1 }` with count 1–999; `item: "<id>"` or `chess: "<id>"` grants one
through normal acquisition/stock rules. Ids must exist in official data or this plugin's own declared records in
the room content set. Discovery refuses unknown, foreign and undeclared ids with **`PLUGIN_OFFER_REFERENCE`**;
composition checks existence again. Unresolved DIY placeholders are refused too: a static id does not identify a
configured operator. Each seat's slot exposes `available`; current stock and that seat's resolved chess record are
checked again at acquisition. A failed grant returns `BAD_TARGET` without recording a pick, so the player can select
another card or refresh the unavailable slot. Invalid amounts/cards use `PLUGIN_OFFER_SHAPE`. Arbitrary persistent `effect`
and `shared` enemy/player pools are refused: their runtime semantics are not supported. `options.tiers` remains
an explicit ignored-field warning. There is no script callback or cross-plugin grant permission.

**Timing and choices.** `battleCheck` runs after the initial official check before R1 and before the start of
*every* later named round, including boss rounds. `prep` runs after round-start income/shop draw and the official
机变 draft, before entering prep. Vanilla takes its original path and draws at its original time. The engine builds
uniform, distinct initial slots with an independent seed derived from match seed, plugin/window, hook, round,
window sequence and seat. A refresh adds slot and refresh count to that seed: it really replaces the card and
leaves other seats untouched. It prefers unseen cards; if necessary it can duplicate another slot, but never the
slot's current card. A one-card pool cannot refresh and consumes no allowance.

Bots and autoplay seats resolve immediately with the timeout rule. A strict majority resolves unpicked seats with
the same rule; departed/eliminated seats leave the quorum. **[ASSUMED]** Auto/bot fallback tries slots in order,
skipping unavailable or failed grants; if none succeeds, it records a skipped pick and closes without a grant. `none` stays selectable until all seats answer, its
deadline, or the next round (then the fallback runs). Multiple windows coexist with independent timers; only
blocking windows delay their continuation. Test-console hidden-round jumps initialize team LP after that delayed
round-start continuation, so subsequent hidden-boss losses use the same pool as an immediate jump.
Unrenderable/empty payloads never hold a phase. These draw, fallback,
quorum, numeric/text limits and unsupported-source choices are **[ASSUMED]** remake API policy, not official rules.
The maintainer's #681 decisions bind declaration-only, API 2/min 1, `g.offer`, caps, zero-length behavior and native UI.

**Native UI and protocol.** The match screen supplies the popup; a UI plugin is not required. It shows each slot's
name/icon/description, two-tap or Enter confirmation, per-slot refresh count, countdown, and co-op waiting state.
Tab stays in the visible popup; Escape clears selection, or collapses a nonblocking popup when nothing is selected.
**[ASSUMED]** Nonblocking windows also have a Collapse button and reopen controls; a completed seat collapses
automatically. They never lock prep editing, and collapsed windows do not capture match shortcuts. Blocking windows
keep their phase gate. Unavailable cards are labelled and disabled for picking, while their remaining refreshes stay
usable. Cards scroll at enlarged text sizes and on touch screens.
Spectators see a read-only view (the first live seat's cards). Window tabs allow all concurrent windows to be answered.
The built-in interface strings use all five supported languages; plugin card text is literal author text.
`m.public.offers` is a full snapshot, including every seat's cards, current slot availability, picked status and remaining refreshes;
reconnect restores it. `g.offer` and `g.offerRefresh` send `{ offerId, pluginId, seq, idx, cardId? }` (the native UI sends cardId to reject a stale slot after refresh), rejecting stale
sequences and other plugins' same-named windows. `g.choice` remains the official draft/personal-choice intent.
Test input journals capture both intents and the declaration snapshot for replay; content process/worker hosts
receive the same options at construction. Offers-only plugins appear in room content summaries and change `cs`;
both declaration and source bytes are hashed. Plugins without offers gain no new file-hash input. Installing an
offer plugin never changes the vanilla composition. Shared engine/protocol code edits still change the build-wide
vanilla code identity, as required by §9's hash contract.

## 12. DSL

A plugin describes a skill, a talent or a small prep effect in JSON (P2). No plugin code runs. The vocabulary, the
per-battle action budget and the worked examples are [PLUGIN-DSL.md](PLUGIN-DSL.md). `compileDsl` in
`server/sim/content/dsl/compile.js` turns a spec into a Kit; `kitOf` calls it when the chess record carries `dsl`.
`server/match/dslMeta.js` turns the prep half into MetaRegistry hooks. The schema is `schemas/dsl.schema.json`.
A content plugin puts the battle spec on `kit.dsl` (permission `dsl`, and `data.add` for the operator) and prep
specs in the manifest `dsl` part. The builder validates them, writes the battle spec onto the record, stamps the
host `pluginId`, and stores prep specs as `data.dsl[<plugin id>]` (part of `cs`). A vanilla set has no `data.dsl`.
The match host registers each prep spec after `setData` and before importing Match, then grants every player an
EffectRef for that key. A bad spec refuses the whole set (`PLUGIN_DSL_*`, or `PLUGIN_DATA_BOUND` for a literal past
the official cap). [ASSUMED] `data.dsl` is reserved: a data patch cannot write it (`PLUGIN_DSL_PLUGIN_ID`), and the
builder attaches it only from its private prep list. Only the record owner may write that record's DSL; `potDown`
cannot write `dsl` or `pluginId`. The runtime validator rejects unknown fields the schema already rejects
(`additionalProperties: false`). `plugin check` is shape-only for the host id inside a prep key and for numeric caps;
`buildContentSet` is the gate. [ASSUMED] If compilation still throws, the battle ends immediately as `forced`
(`content:dsl` in `battle.errors`, `result.errors > 0`). It does not continue with an empty kit or the generic kit.
The player sees the ordinary 战斗结束 box. A hashed set that skipped the builder still fails host boot (`boot-error`,
room `plugin-start`, `PLUGIN_DSL_META`). The host supplies the plugin id (an author id cannot take another plugin's
budget; omitting the author's id is allowed). Prep keys are `effect:<that id>:<local>`. DESIGN §32.7. A vanilla
battle does not load the compiler. Direct literals use the official-bounds cap (`max(10 × official max, 64)`); an expression
result is clamped to that cap. `duration`, action amounts and `rangeExtend` are not in that table [ASSUMED].

<a id="13-scripts-p3a"></a>

## 13. Scripts (P3)

P3a is **trusted execution**, disabled by default; P3b sandbox mode is described below. The static `sandboxable: true` label says that a script uses the
portable API; it does not make that script safe. Native imports can fully control the page or execute server code.
Only enable code the server owner and every player trust. The adopted sources are the owner's 0.3.0 plan C2/C3 and
the plugin design §3.4, §3.6, §5 and §7.6; DESIGN §32.10 records the implementation choices.

A `script` manifest has `entry.sim` and/or `entry.meta` (one self-contained `.js` module each), their `sim.code` and
`meta.code` permissions, and optionally the same data and art parts as a content plugin. A shared entry runs once.
Copy `plugins/_template/script/` to `plugins/script-demo/`; its original training guard has a deployment ATK talent,
a duration skill and a harness test. Its art references the installed game; it contains no game files.

```js
import { kit } from 'sp:sdk@1'; // optional; sp.kit supplies the same helpers
export default function setup(sp) {
  sp.kits.register('char_x_example_guard', bb => ({
    skill: { kind: 'duration', duration: 10, mods: { atkPct: kit.num(bb.atk) } },
    talents: [{ install(battle, unit) {
      battle.on('deploy', ctx => {
        if (ctx.unit === unit) sp.kit.statBuff(battle, unit, 'example:atk', { atkFlat: 25 });
      }, { owner: unit });
    } }],
  }));
}
```

`setup(sp)` is synchronous, registrations close afterwards. Per-battle state belongs in `unit.mem` or a WeakMap keyed
by battle, never in a module variable. Child hosts and browsers run setup in the composition's
resolved load order. While composing a set, a disposable child probes each plugin's registrations (5 s default ceiling per
uncached plugin (`SP_SCRIPT_PROBE_MS`) [ASSUMED]). The parent combines the registration reports in load order and rejects conflicts.
The probe uses SIGKILL on timeout; spawnSync waits for the child to exit before composition returns a failure.
Results, including failures, are cached per registry by plugin id + lock hash + actual descriptor hash + normalized
settings (256 recent results [ASSUMED]); changing settings or executable bytes requires another probe. This also
prevents a stale or missing lock in an explicit CLI test from reusing another source's result.
C1 remains synchronous: **the lobby pauses during each uncached probe**, including rooms without plugins. Several
uncached plugins add their pauses together. Moving to async spawn requires coordinating the C1 builder, content/room
set resolvers, lobby and studio/CLI callers; this step preserves their synchronous contracts. The HTTP/lobby process
never imports author modules. Actual duplicate registrations, including computed ids and
normal/elite chess aliases, fail composition with `PLUGIN_SCRIPT_CONFLICT`. [ASSUMED] `overrides: [<official kit id>]`
allows replacing an official kit; it never allows overwriting another plugin's registration. Vanilla registries stay
empty. Only plugin `char_x_…` ids add a shop charId lookup; official dispatch stays the same.

| API | Contract |
|---|---|
| `sp.kits.register(id, builder)` | `(bb, chess, def) => Kit`, SIM §7; `sim.code` |
| `sp.enemies.register(id, builder)` | `(def) => { install(battle, enemy) }`; install on enemySpawn before ordinary enemy handlers; `sim.code` |
| `sp.content.register({ id?, install?, registerMeta? })` | One module id (defaults to plugin id); install per battle; registerMeta receives `{ register(key, handler) }` during setup; permissions for each half |
| `sp.meta.register(key, handler)` | META §2 keys and hook contracts; `meta.code` |
| `sp.kit` / imported `kit` | `num`, `talentBb`, `talentGrid`, `moduleBb`, `traitBb`, `moduleOn`, `up`, `cheb`, `isMainHit`, `byEnemyAttack`, `skillBusy`, `giveSp`, `onHitBy`, `onHitOn`, `onDamagedOn`, `enemiesInGrid`, `alliesInGridOf`, `enemyInRange`, `statBuff`, `toggleBuff`, `instantKind`, `skillRec`, `skillBbOf`, `batMod` — tier1 signatures |
| `sp.math` / imported `math` | The exports of `server/sim/detmath.js` |
| `sp.constants` / imported `constants` | Frozen simulation constants |
| `sp.dir` / imported `dir` | Frozen `dirVec(direction)`, `offsetTile(row, col, dr, dc, direction)`; frozen returned arrays |
| `sp.targeting` / imported `targeting` | Frozen `absoluteRangeKeys(grid, row, col, direction, extend = 0)`; frozen tile keys; at most 1024 input cells [ASSUMED] |
| `sp.settings` | A frozen copy of the manifest's normalized settings, included in cs |
| `sp.log(...values)` | At most 20 lines per setup, each value truncated to 500 characters [ASSUMED] |

The facade supplies no fetch, dynamic import, storage, clock or unseeded randomness. Hooks and engine helpers follow
SIM §5–7. Use `battle.rng`, `after` and `every`. `tools/plugin.mjs check` and the registry use the same lexical scan
(`shared/plugins/scriptCheck.js`): only `sp:sdk@1` imports, no dynamic import/re-export, eval, Function, require,
process/globalThis, fetch/XHR/WebSocket, Date, Math.random or localeCompare; common ambient browser APIs and
implementation-approximated Math functions are also refused. This is deliberately not a complete parser or a sandbox;
obfuscation can evade it, and conservative scans can refuse inert template/regex text. `trusted` page/server entries
are unrestricted and never labelled sandboxable; their sim/meta entries still use the SDK checks.

Geometry helpers read no battle state and incur no engine-action charge; their caller still uses the callback budget.
`sortEnemyTargets` remains unavailable: it mutates its candidate array, uses live Unit references and calls Battle.remainingDistance.

**Budget.** Script callbacks and engine actions use the same per-battle/per-plugin counter as DSL (default 8000).
Setup installs, hooks, timer callbacks and skill callbacks count. Engine actions (damage, buffs, spawning, DP, etc.)
count too; exhaustion unwinds that callback, cancels the plugin's timers and removes its tagged buffs, records one
`plugin:<id>` error and leaves other plugins running. Existing skill mods remain until their skill ends, and existing
statuses/summons are not recalled, as in DSL. [ASSUMED] Prep hooks share a separate 8000-call counter per match round
across seats; prep effects are server authoritative. Direct engine mutations remain part of kit duties in both modes. Worker/child watchdogs interrupt nonreturning
simulation code; native trusted page code can still block the page.

**Owner gates.** `SP_PLUGIN_SCRIPTS=trusted` plus `plugins/config.json`:

```json
{ "trusted": { "script-demo": "<SHA-256 of the exact plugin.lock.json bytes>" } }
```

Pack and review again after changing any plugin file. Every lock entry's SHA-256 and byte count must match; extra or
missing files refuse execution (`PLUGIN_TRUST_PIN`). Unset/unknown mode leaves
script/trusted plugins listed as `disabled` (`PLUGIN_SCRIPTS_DISABLED`). Public and wildcard listening addresses refuse
execution (`PLUGIN_TRUST_PUBLIC`), regardless of the request's address; `trusted-force` explicitly overrides this
[ASSUMED name]. `net.isIP` validates listening literals before numeric checks of IPv4 `0.0.0.0/8`, every all-zero IPv6 spelling
and IPv4-mapped IPv6; local mapped addresses use their IPv4 classification. `isLocalIp` supplies local-network
classification. After listen succeeds the server rechecks `server.address().address`, disables refused scripts across
future registry scans and waits for any started trusted service child to exit.
Script room classes default on in sandbox/trusted modes; trusted classes default on only in trusted modes; policy `classes`, `allow`, and `rooms` still apply.
Startup logs list accepted and refused plugins with plain-language reasons. The snapshot remains fixed for a running
set; stop a running match/server to revoke already executing code.

**Consent and bytes (native trusted execution).** A trusted room adds `content.trusted = { plugins: [{ id, version, hash, permissions, authors }],
consent: { <seat>: boolean } }`. `hash` identifies the canonical gameplay file snapshot (§6), excluding notices and personal themes; server-owner pins still use the full raw lock SHA-256. `room.consent { cs, accept }` affects only the sender's
seat; every active human must accept before `room.start` (`PLUGIN_CONSENT`). Bots need no page consent. Disconnects
keep the seat's consent, a new cs clears it. The browser remembers its own decision in `sp.plugin.consent.<cs>`;
server state alone never authorizes page execution. The risk dialog names authors, hashes and permissions and says
「它可以完全控制你的游戏页面」; seats show 「已同意」 and a red 「受信任插件」 banner stays through the match.

Scripts are immutable `scripts/<id>.json` descriptors containing the original manifest and entry source texts.
Their hashes enter each plugin's `files['@script']` in cs; `/cs/<cs16>/index.json` lists their routes. Each actual
manifest and source is checked against that hashed composition before native import. SDK imports are linked to the
runtime SDK, then Node imports the verified source natively. Browsers use the descriptor's `browserSources` snapshot (sim/meta
SDK alias linked to `/shared/plugins/sdk.js`; trusted page source unchanged), served verbatim at
`/cs/<cs16>/scripts/<id>/<entry>` with JavaScript MIME. The page verifies these exact response bytes before native
import at that same address; simulation Workers receive the checked snapshot and only perform module imports.
Execution mode and browser source bytes are covered by `@script`. Site CSP keeps script-src self plus importmap
hashes, without data:, blob: or unsafe-eval; only the simulation Worker permits SES eval. The browser fetches these descriptors only after
its own consent. An unconsenting spectator still loads data and reads server results/snapshots, but never receives a
script execution payload or becomes battle authority [ASSUMED]. Server bot fights, takeovers and SP_VERIFY use the
same registered extensions in the set's child; script sets always use a process even with SP_MATCH_HOST=worker.

**Experimental trusted class.** `entry.server` exports `activate(api)` (or a default function); enabled/pinned server
entries run at startup in one separate child, never the HTTP process. `api.http.route('/x/<id>/…', fn)` registers an
exact path whose handler receives a frozen `{ method, path, url }` and returns a JSON value. No live request/socket is
passed. `api.lobby.on(name, fn)` receives frozen copies for `roomCreated`, `playerJoined`, `playerLeft`, `matchStarted`,
`roomClosed`. `api.health.extend(value)` replaces that plugin's JSON under `/healthz.plugins[id]`. Routes never leave
`/x/<id>/`: both the child API and parent IPC receiver check the loaded plugin id, reject `..`, `%2e` in any
letter case and backslashes, and dispatch by the same raw path used by the HTTP handler (query excluded). A nonmatch
continues to the original health/static handler. `health.extend` accepts at most 16 KiB of serialized UTF-8 JSON per
plugin [ASSUMED]; the parent rechecks the limit and ignores invalid/unknown-id health updates. Activation and requests
time out after 5 s [ASSUMED]. Either timeout, startup failure or `close()` sends SIGKILL and waits for the process to
exit; pending requests fail and registered routes/health are cleared. All trusted server entries share this child,
so stopping it stops them all. The 128 MB limit is V8's old-space heap, not an RSS limit or a restriction on native
code spawning further processes. These restrictions describe the API, not the native
code's privileges. Standalone server entries need no browser consent; room/page entries must include room scope to
be selected. `entry.client` is a self-contained `.js` ES module with `trusted.page`; explicit acceptance reloads the
page with `?cs=<cs>&room=<room>` and the restored, consenting page imports the checked module. Reload to unload page
code; native imports cannot revoke side effects. Server entry changes take effect on restart.

**Author tests.** `node tools/plugin.mjs test <id>` explicitly executes that installed plugin's `test/*.test.js` with
its composition preloaded, SDK registrations installed and the official bounds set. Tests may import
`../../../test/helpers/battleHarness.js`; they are test code, not portability-scanned entry modules. Production trust
gates remain unchanged. This command is explicit authorization to execute local code: it does not require
`SP_PLUGIN_SCRIPTS` or a matching `plugins/config.json` trusted pin (a missing/stale pin does not stop it). Review the
files being tested; this is not validation that they are the production-pinned version. Test execution has a 120 s CLI timeout [ASSUMED].
The report is Node's spec reporter on every supported Node version, also when the output is not a terminal (an IDE
console, a redirect, CI), where Node 22 would otherwise print TAP.

### P3b sandbox execution

`SP_PLUGIN_SCRIPTS=sandbox` enables script-class plugins with a valid lock and matching bytes, without an owner
pin or per-player consent; public listeners are allowed (maintainer decision, 2026-10-14). The start scripts set it
with `--scripts sandbox` (`scripts/launch.mjs`; `--scripts off` drops an inherited value), and on Windows a double click
on `scripts/start-windows-sandbox.bat` is `start-windows.bat --scripts sandbox`. The room labels
these `脚本（沙箱）`; matches remain unofficial. Trusted-class plugins stay disabled in this mode. In trusted modes a
mixed script/trusted composition runs entirely natively and requires consent for every member [ASSUMED]. Execution
mode is pinned inside the hashed descriptors, so a mode change creates a new cs.

Both modes consume the same `scripts/<id>.json` descriptors and real `createSDK(plugin, { settings, log })` API above.
The sandbox validates descriptors, initializes SES before importing the engine, runs setup in one Compartment per
plugin, then seals the real extension registry. Preflight also uses a permission-limited SES child, with the same
5 s SIGKILL/cache and synchronous lobby-pause limitation described above. There is no native fallback.

Each script exports `default function setup(sp)`. A separate SES Compartment per plugin receives only the hardened
SDK capability and deterministic Math. Static imports can name `sp:sdk@1` (`sp` / default / `kit` / `math` / `constants`) or an own relative JS file.
Production manifests still allow only self-contained entries; relative imports here describe the low-level loader.
Exact source bytes are hashed before use; source length is checked before copying bytes. [ASSUMED] at most 64 files / 1 MiB per plugin. The initial module adapter
rejects cycles, export-star, mutable/destructuring export declarations, dynamic import, import.meta, async/generator
code and `**`; imported values are initialization-time bindings and module exports are hardened. Keep state inside
callbacks. `Math.pow` accepts integer exponents only, |base| ≤ 2^500; `Math.hypot` takes two finite numbers. No clocks,
random, fetch, timers, DOM, filesystem, worker creation, weak references or shared memory are exposed.

All gameplay rooms, including data and DSL, simulate in a browser Worker. A plugin installation, construction or step reply delayed beyond 2 seconds
[ASSUMED, host-configurable; trusted engine/data cold loading has a separate 15 s deadline] terminates it and requests server takeover, with a translated player notice. Script
server hosts are separate permission-limited Node processes with heap limits and a heartbeat watchdog; their rooms
return to the lobby when the host dies. Neither original nor data/DSL-only nor native trusted rooms call lockdown.
Guest globals shadow harden/lockdown; SDK-owned record results are frozen copies, target arrays are shallow-frozen,
and Battle/Unit/hook handles stay mutable. errorTaming=safe clears host stacks too.

Residual risks: SES/V8 bugs, deliberate desync, browser-process memory exhaustion, and same-origin IndexedDB after
a Worker escape. Node 22 permissions do not restrict network and are not a malicious-code security boundary; an
escape can probe the server's network or read its allowed install tree and targets of links inside it.
Do not put links pointing outside inside the installation root; use a network namespace/container to restrict network. Prefer a low-privilege account/container
with outbound-network and OS resource limits. Chrome regression coverage includes CSP and sandbox behavior;
Firefox and Safari have not had dedicated sandbox verification. See [DESIGN §32.11](history/0.3.0.md#3211-p3b--worker-simulation-ses-and-csp)
and [deployment](DEPLOY.md).


## 14. Interface plugins (P4)

A ui plugin is a page. The server lists it and serves its frame files; each player decides, in this browser, whether
to show it. It is unofficial. It is not a member of a room's `plugins[]` and a room cannot switch it on
(`PLUGIN_BLOCKED`). It adds nothing to `cs` and it does add its own `vs` (§6).

**Manifest.** `class: "ui"`, `scope` including `personal` (that is the only scope this class has), permission
`ui.frame`, `entry.client` an `.html` path, `slots` any of `hud.right`, `result.tab`, `stats.tab`, `room.panel`.
`description` is the 简介. The `.html`, `.js`, `.css` and `.png` files must sit in the directory of `entry.client`.
Start from `plugins/_template/ui/` (a damage tally). A folder whose name starts with `_` is a template: the registry
never loads it.

**The frame.** The page runs in `<iframe sandbox="allow-scripts">` — no `allow-same-origin`, so its origin is the
opaque string `"null"` and it cannot read this site's storage or credentials. The host iframe uses `color-scheme: dark`
and a transparent background. [ASSUMED] That clears the opaque white canvas; a background the plugin's own page paints
still shows. The generated Forge skeleton and `plugins/_template/ui/` set `color-scheme: dark` on `html` for the same
reason. The iframe points straight at that plugin's own
`/p/<id>/<hash8>/<entry>`. Its first load is the entry, and any later load destroys the frame: the host then clears
`ready` and posts nothing more. `postMessage` to `"null"` cannot tell those documents
apart. Files at `/p/` for a ui plugin, and not cosmetic art, are sent with
`Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`
(`UI_FRAME_CSP`), on 200, 206 and 304. The `sandbox` directive is what still applies when that URL is opened at the
top level; a `<meta>` sandbox does nothing. The header has no `allow-same-origin`. [ASSUMED] `'self'` may not match
the opaque origin, so an inline script runs and a separate script file may not; that is not repaired by granting the
iframe the page's origin. [ASSUMED] A snapshot or a private view already posted can leave in the URL of the
navigation that exits the entry. Later posts stop; that does not recall the copy. `navigate-to` was not measured and
is not the fix. The rest of the site uses the separate P3b policy (§13).

**The feed** is postMessage API v1 (`shared/plugins/ui.js`, `schemas/ui.schema.json`). The host sends the player's
visible `m.public` (a subset), the player's own `m.private` (a subset), throttled events and snapshots of the battle
on screen, and unit stats when the plugin asks. It also sends, still read-only: `result` (settle stats already on the
result screen; no lineup, diy or seed), `net` (connection status; latency is the field `rtt`, because the key `ping`
is a client intent) on change and then at most once a second, and `state.room` (seats, including empty holes, and the
room's plugin ids, never the join code). `welcome` may add `version` (`PROTOCOL_VERSION`), `lang`, `plugins` and the
scalar prefs already stored for that plugin. A plugin that only reads `t === 'welcome'` keeps working. The plugin may
ask for a slot, a height, a short notice, and a few namespaced storage keys (`sp.plugin.<id>.`, proxied by the host
page). It cannot send a match intent: a message whose type is `hello`, `ping`, `room.*`, `g.*` or `b.*`, or that
carries one, is rejected. The host never turns a plugin message into a client→server message. Nothing in these feeds
lets the frame reach the parent page.

**Limits [ASSUMED]:** 20 messages a second per plugin, burst 40; battle pushes at 4 Hz, ≤ 40 events a batch; a
snapshot whose JSON is over 48 KB is dropped with `truncated`, and `truncated` is also set when a string, array, object
or nesting depth was cut (the partial snapshot is kept when it still fits); a plugin message over 8 KB refused;
storage keys of 1–64 characters from `A–Z a–z 0–9 . _ -`, not `__proto__`, `prototype`, `constructor` or `..`, a JSON
value ≤ 4096 UTF-8 bytes, ≤ 32 keys and ≤ 32 KB UTF-8 per plugin; height 48–480 px; a notice ≤ 80 characters, and a
distinct notice at most once per 2 seconds (the same text is still delivered so toasts can merge); connection pushes
after the first at most once a second (`netHz`) [ASSUMED]; one slot per
plugin. The protocol table grants one plugin per slot at a time. When several ui plugins ask for the same slot, the
match shows the first by name and the player switches with tabs in the slot (`PLUGIN_UI_SLOT_SHARED` is a warning, not
a refusal). [ASSUMED] That name order is the initial tab, and a later sync does not override a tab the player already
chose. At most 8 mounted. `hud.right` (`.gm__ui-slot`) sits above the hand, inset from the effects column, and its
height stops under the ready button, so it does not cover the shop, the hand, the ready button or funds at 1280×720
or 1920×1080. [ASSUMED] Both viewports are 19.2×10.8rem; the hand's top is the dock clearance 4.76rem; the slot's
bottom is 4.88rem and its right inset is 0.92rem. Engine `dmg` / `heal` tuples expose the HP at `amount` (the unit id
is `unitId`). The private subset drops loadout, ops, diy, effects, nextEnemies, personalChoice, rewardOffer and
tokens. The exact allowlists are `subsetPublic` and `subsetPrivate`. Storing a snapshot does not trip
`PLUGIN_INTENT` just because the host had labelled it `b.snap`.

**Switches.** 设置 → 「界面插件」 is `localStorage` (`sp.pref.ui-plugins`). It does not affect other players. The host
may 「推荐」 (`sp.pref.ui-recommend`); the room shows 「房主推荐」 and each player still decides. [ASSUMED] the
recommendation is this browser's until a later phase copies it onto the existing `room.state` — no new protocol
message. The host may toggle it during a match because it changes no match.

**Errors.** `PLUGIN_SLOT`, `PLUGIN_RATE`, `PLUGIN_STORAGE`, `PLUGIN_INTENT`, `PLUGIN_SHAPE`, `PLUGIN_LIMIT` live in
`shared/plugins/ui.js` and are included in `shared/plugins/errors.js` (§15).

## 15. The studio and the tools

Someone who does not write code makes, previews and packs cosmetic and gameplay plugins in the browser; someone who does gets a
schema, findings in plain words and hot reload. The design is DESIGN §32.9; the beginner's guide (Chinese) is
[PLUGIN-GUIDE.md](PLUGIN-GUIDE.md), the guide for AI agents `plugins/AGENTS.md`.

**The studio 插件工作台** — `http://<server>/studio/` of a running server (`server/studio/`, its page `public/studio/`):

- **Who may open it**: this machine and the local network only (`server/studio/gate.js`). The socket's peer **and**
  every address a forwarding header names (X-Forwarded-For — every hop —, X-Real-IP, CF-Connecting-IP, True-Client-IP,
  X-Client-IP, X-Cluster-Client-IP, Fastly-Client-IP, Forwarded's `for=`) must be loopback or private-network addresses
  (`server/net.js isLocalIp`); an address that cannot be read refuses too. That is stricter than `clientAddress`, which
  picks one header for the limits: a proxy that sets one header passes the others a visitor sent, so a header can refuse
  a request but never admit one, whatever `TRUST_PROXY` says. Anyone else — also a public visitor a tunnel or proxy on
  this machine names — gets the 404 page of a page that does not exist, at the page and at every API route. The Host the
  browser asked for must be a local address or a local name (a loopback or private IP, localhost, `*.localhost`, a
  machine name without a dot, `*.local`, `*.lan`, `*.home.arpa`, `*.internal`, or a name `SP_STUDIO_HOSTS` lists), so a
  web page whose own name was made to point at the machine (DNS rebinding) cannot reach it, nor a browser that reaches it
  at a public address; a change (POST, PUT, DELETE) carries the header `X-SP-Studio: 1` and, when the browser names one,
  the studio's own origin — the studio never answers a cross-origin preflight. `SP_STUDIO=local` allows this machine only
  (the peer and every forwarded address loopback), `SP_STUDIO=off` switches the studio off [ASSUMED: on for the local
  network by default]. What no address check can see — a **raw TCP tunnel** on this machine (frp `tcp`, `ssh -R`, ngrok
  `tcp` …) hands a visitor's bytes over from this machine itself with no forwarding header, and a client that is not a
  browser writes any Host — is what **the studio's key** is for (`server/studio/key.js`): every change carries it in the
  header `X-SP-Studio`, a wrong or missing one is refused (`PLUGIN_STUDIO_KEY`), whatever the address. The server prints
  the studio's address with the key when it starts (the banner's `Studio:` line, `http://localhost:3000/studio/#key=…`);
  the page keeps it in its browser (localStorage, taken out of the address bar) and asks for it when it has none (paste
  the printed address into the bar at the top). The key is kept in `plugins/.studio-key` (128 random bits, the owner's
  only; the same across restarts — delete the file for a new one). Reads — the page, the list, a plugin's allowed data/art files — need no
  key (script source in the plugin state does require it), so a visitor through such a tunnel can see the plugins but change nothing; `SP_STUDIO=off` hides them too
  [ASSUMED: the key file, reads without the key]. The watch and the rooms' rule (below) start with the first request
  that carries the key, never with a mere visit.
- **新建插件**: a template — 换头像 / 立绘 / 图标 (`art`: an operator's avatar, E2 avatar, portrait, E2 portrait; a summon's
  avatar, an enemy's icon, an item's, a bond's, a strategy's icon, an interface picture), 换 Spine 模型 (`spine`: an
  operator's front and back model, a summon's or an enemy's), 换语音 (`voice`: every battle line of an operator, Chinese and
  Japanese dub), 换音乐 / 音效 (`audio`: a music track with its intro, a leader's music, an interface or battle sound, a
  unit's own sounds) —, what it changes found by its **official name** (`server/studio/targets.js`: operators, summons,
  enemies, items, bonds, strategies, interface pictures, music, sounds, each with its picture), a name; the id is made
  from it (a legal one nobody has, editable). The folder gets `plugin.json` and a README. Art/audio targets start with an original CC0 sample in the first slot; other cosmetic templates remain empty until filled. No game file is copied. More templates and targets join a plugin with
  「添加替换内容」 (an operator's avatar, model and voice in one plugin); the page keeps what it shows in the dot file
  `.studio.json` of the folder (never listed, served, checked or packed; a plugin made by hand gets its sections read
  off its overlay).
- **0.3.1 presentation templates**: `theme` (personal cosmetic, `theme` permission) edits every allowlisted
  colour/time/easing token with its default, a per-token reset, and reversible live styling of the studio root.
  `notices` (personal cosmetic) edits up to 20 announcements, title ≤80 and body ≤2000 Unicode characters, optional
  calendar date and complete translations; preview uses the popup's plain-text localization/fallback reader.
  `skins` (cosmetic, assets.add + assets.override) edits an operator's outfit list and existing image/Spine slots;
  `isSkinKey`, 64 outfits, 64-character name/group limits and picker fallbacks remain §9 / SKINS.md's rules.
  [ASSUMED] Skin metadata is saved before slot changes; the full UTF-8 hex skin key separates upload directories.
  Reused keys allocate a fresh numeric-suffix directory when another skin references the destination, including
  partial Spine uploads. Retired files are retained. FX images are staged with the form, then saved together.
  Slot uploads/clears hydrate the next form draft, so a subsequent save/rename retains present media and never
  resurrects a cleared asset. Other manifest metadata and unrelated art remain untouched.
  `fx` (content) creates an immediately playable carrier borrowing an official kit and an original CC0 sheet
  [ASSUMED], then edits official unit/skill mappings or flipbooks and phase bindings (§9 Operator effects).
  The existing target picker searches only units in the local effects index for the former; a missing index
  is explained. [ASSUMED] The local index reader caps its JSON at 16 MiB. Borrowed effects remain 3D-only;
  flipbooks play in both board modes through the existing trial replay, including unsaved form parameters.
  The controls use the runtime bounds (frames 1–256, cols 1–frames, fps 0.1–60, anchor 0–1, scale .01–8,
  normal/add, boolean loop); the loader also checks PNG dimensions and cell divisibility. [ASSUMED] At most
  128 books and 60 unique slot/phase rows (10 × 6); dangling effects are refused. Compiled particle files
  remain supported by the existing file interface. No new runtime plugin field, permission or studio route.
  All four templates use one editor module and the same theme/notices/overlay/effect validators as the checker;
  invalid values are not silently clamped. See the Chinese guide's four subsections for the complete workflow.
  Review save contract: all presentation forms hydrate current manifest/record declarations. Saves use the shared
  three-way delta merge, retaining extra declarations, hidden FX settings and unchanged JSON token bytes. FX/skin forms refuse
  string `assets` declarations with 409 (edit the referenced document directly). The complete merged folder, dependencies
  and staged media must pass the strict checker before a form save; invalid retained content and empty notice-only
  plugins are refused with contextual errors. Skin slot uploads and the files PUT route instead require **no new problems** (the 0.3.0 art, model, voice
  and audio slots, and a bond's icon, still write directly and show the check afterwards):
  candidate strict findings must already exist in the live folder, compared as a multiset of exact code,
  location (where/file) and finding text/reason. Each existing finding excuses at most one identical candidate finding.
  [ASSUMED] Changed numbers within a reason (for example a measured folder total) count as a new finding and refuse
  the upload. Content JSON is composed with `checkDataOnly` independently of asset problems; malformed documents
  produce findings without executing author code. This permits repairing several missing images one at a time;
  PNG/Spine bytes on these validated upload paths must independently validate each time.
  Cosmetic validation does not load gameplay tables. [ASSUMED] Candidates use dot-prefixed `.sp-studio-*` directories
  inside the real plugins directory (same volume); the registry excludes dot names. A complete initial walk refuses
  all links, including hidden ones, before staging any files. Unchanged regular files are hardlinked, with
  `COPYFILE_FICLONE` copy fallback; the three-way merge reads only JSON/HTML documents. [ASSUMED] Revision
  checks hash document bytes and use size/mtime/inode for other files, avoiding main-process media reads. Only requested writes face
  studio per-file limits, so an installed file over 64 MiB remains editable when untouched. Candidate totals retain
  the 200 MiB / 5000 file limits. Changed media precedes plugin.json in the rollback-protected atomic commit;
  all success/error/timeout paths remove the candidate. HTTP staging and complete checks run in disposable children
  [ASSUMED: at most two jobs, 20 seconds each, 512 MiB V8 heap]; cleanup is asynchronous.
  Skin-slot and files-PUT Spine uploads use the packer's skeleton/atlas readers and rebuild clip metadata.
  PNGs uploaded through skin slots, files PUT or staged FX forms check signature, raw ASCII-letter chunk types,
  legal IHDR colour/depth/interlace fields, chunk CRCs, palette and end ordering, and inflate zlib with an exact
  scanline-size bound (including Adam7 passes), then checks scanline filters. [ASSUMED] Decoded scanlines are capped
  at 256 MiB. Only declared effect sheets use non-interlaced 8-bit RGB/RGBA ≤2048 per side; inline and file-backed
  overlays both identify them. Upload decoding recognizes `.PNG` too; FX paths retain lowercase `.png` / `.json`.
  The 0.3.0 art/model/voice/audio slots and a bond's icon keep their direct writes, without this media validation gate.
  Other validated PNG art accepts all legal depth/colour combinations and Adam7. Pending FX FileReader completions merge into the latest draft; save stays disabled until
  all reads finish. Trials accept the same 160 MiB request body as authoring. [ASSUMED] Newly staged replay images
  are embedded as PNG data URLs, at most 8 MiB compressed image bytes total within the existing 16 MiB result cap;
  they remain available for the replay's lifetime after temporary files are removed. Saved images retain ordinary
  preview URLs. FX carriers retain supported damage/attack fields and bind their equipped default
  skill; sources requiring owner-specific summons or differing per-form top-level attack metadata are explicitly refused [ASSUMED: compact-format limitation].

- **Slots**: every place a template fills, the installation's art beside the plugin's. Files dropped on a slot (or
  picked) go into the plugin folder under the slot's name — `art/<key>/avatar.png`, `spine/<key>/front/<key>.skel` and
  `.atlas` under one name with the atlas's pages by their own names and `textures` read from the atlas,
  `voice/<key>/cn/<line>.mp3` (several: `_1`, `_2` …, played in turn), `music/<key>/loop.ogg` and `intro.ogg` — and the
  overlay names them; a file the slot named before and nothing names now is removed (also when a reference takes its
  place). A track keeps the part not sent (「放入前奏」 adds the intro to its loop; a new loop keeps the intro; two files at
  once: the one named `intro…` is the intro). A model's new skeleton comes with its atlas, unless the model already sits
  under the slot's own name; the atlas's page names must be plain names (they are the files' names). 「用已有的素材」
  borrows the installation's own art instead (`{ "ref": "<key>" }`, found by name); 「恢复原版」 empties the slot.
- **Findings**: the server's own checks (`server/plugins/pack.js checkPluginFolder` — exactly what the registry and
  `tools/plugin.mjs check` run), each in plain words beside the slot or field it is about (its `at` path), with what to
  do, the technical line folded under it and — where the error catalogue has one — 「一键修复」: the missing permission
  added, an unused one removed, `manifest` / `version` / `app` / `api` / `scope` set, an unknown field removed, a write
  the installation cannot resolve removed, the model's pages put into `textures`, the lock packed, a file of a type the
  plugin may not carry moved out to `plugins/_moved/<id>/` (never deleted).
- **Preview**, with the original beside the plugin, drawn by the game itself (`public/studio/js/preview/`): the
  battlefield view (`render/app.js`, the official board when installed) with the operator, summon or enemy on the board of
  the preparation phase or in a battle, playing the role picked — 待机, 移动, 攻击, 技能 (S1–S3), 眩晕, 倒下, 部署 — fed as a
  real battle feeds it (b.snap tuples and b.ev events), front or back model; the card picture of the shop and the bench
  (`ui/gameComponents.js UnitThumb`, also the E2 one) and the portrait in the detail card (`ui/detailPanel.js
  ChessDetail`); every voice line, track and sound with its play buttons. The plugin's art is the temporary composition
  of the plugin as it is now (`GET /studio/api/plugins/<id>/preview`, `server/studio/preview.js`) — also while it has
  problems and before it is packed (a model's clips are then read from the skeleton itself) — laid over the page's own
  manifest under keys of their own (`<key>~plugin`), so one renderer draws both; a new preview redraws in place.
- **信息 / 文件 / 清单**: the basic fields (name, description, version, authors, licence, credits — where the art comes
  from —, homepage, who may switch it on), every file of the folder (the ones nothing uses marked, each removable),
  `plugin.json` itself for those who prefer to write it.
- **打包并下载**: `plugin.lock.json` written (the packer of `tools/plugin.mjs pack`), the folder checked, and the zip
  downloaded — `<id>-<version>.zip` holding `<id>/…`, every file but dot files, deterministic (the same files give the
  same bytes: a zip can be pinned by its SHA-256). The packer does not screen for official game files (the owner's
  decision of 2026-10-13): what a plugin carries is its author's responsibility — and §1 still asks never to put them in.
- **删除所选** (removing several plugins at once, `public/studio/js/remove.js`): a checkbox beside each plugin of the
  list (disabled for a folder that is a symbolic link), 全选 / 清除选择, and 「删除所选（N）」, disabled with nothing
  checked. The confirmation names the plugins (name and id) and says where they go; confirmed, each folder moves to
  `plugins/_removed/<id>-<UTC YYYYMMDD-HHMMSS-mmm>/` (-2, -3 … when taken) — nothing is deleted: moving a folder back into
  `plugins/` under its id restores the plugin, and `plugins/_removed/` is never read (a `_` folder, like `_replaced/` of a
  forced install and `_moved/`; it grows until the owner empties it). A plugin **in use** stays where it is: one an open
  room's plugin set lists — the plugins its host switched on and the ones switched on for them (「自动」), which a running
  match plays too (`server/lobby.js` `room.content.plugins`: the place that knows it). A player's personal cosmetic or
  interface plugins live in that player's browser alone (localStorage), so the server sees no use of them: a removed one stops
  applying there (the catalogue no longer offers it) and applies again once restored. Nor do `plugins/config.json`'s
  `default` list or a trial of the bench count: a room created afterwards logs that a default plugin cannot be applied,
  as for any default that is missing, and a trial reading the folder fails like one whose folder changed [ASSUMED]. The
  list follows at once (the change event), the plugin open on the right closes, the note above the list says what went
  (and takes the keyboard focus), and every plugin left in place is shown with its reason — the error catalogue's words,
  the room's code for one in use — and stays checked.

**Gameplay templates.** `new <template> <id>` and the browser share one server module per template;
`--options <json-file>` supplies the same options as the wizard. `numbers` exposes existing numeric stats/blackboards
by official target name (operators, enemies, bonds and items), with original values and the C6 10×/64 cap on blackboards.
Default skill copies are patched together. The editor reads `officialBbRange` from the shared official bounds; saves reject values outside that range or below its positive step floor. Folder checks apply patches to available official records and run the same `appendOfficialBounds`; dependency-only paths still need the full C1 composition check. `operator` generates a compact normal/elite pair with namespaced IDs;
name, profession/branch, rarity/tier and both forms' stats are editable. Its kit source is an official kit picked by
name (the server resolves the actual registry key), JSON SkillSpec or DSL. `art.ref` borrows installed art.
`dsl` defaults to a compact caster (`kit.dsl`) and `dsl/income.json` prep example; it also offers the five PLUGIN-DSL §7 starting points and structured skill/talent/condition/action/target/value controls;
`meta` offers prep triggers and funds/layers/items. The page calls the real `validateDsl` and explains its codes.
`mode` inherits an official mode with economy, DP and timers/round preparation overrides. `ui` wraps `_template/ui`
with title/slot fields and the game's **same pluginFrame host**, opaque iframe origin, fake data and volatile storage.
`script` copies `_template/script`, rewrites namespaces, and includes the harness test; the page displays source read-only
and directs the author to an editor. The generated folder carries no official art.

Wizard state lives in `.studio.json` under `authoring`, independent of cosmetic sections. `GET …/plugins/<id>` adds
`authoring` (including a revision hash), a UI catalogue `frame`, and a script's text `source` only when the request carries the studio key. Unkeyed reads contain metadata only.
`POST …/plugins/<id>/authoring` saves `{template, target, options, revision}`; external changes invalidate the revision
(`PLUGIN_STUDIO_CHANGED`). Only generated templates may write `.html/.js/.css`; generic file PUT and studio file GET
still refuse executable sources. A UI preview loads the registry's sandboxed `/p/` route.
`GET /studio/api/authoring?template=&target=` returns official numeric fields/reference records/modes;
`GET …/dsl-example?name=&id=` returns a starting point; `POST …/validate-dsl {spec}` returns the real validator's result.
Generated DSL is checked again before new/save writes (including `kit.dsl` and prep host keys); rejected specs leave the saved files unchanged. The form reports failed validation requests, and save revalidates its current spec and checks `ok` before writing. All templates pass strict check/pack and data templates compose through C1; the DSL caster is tested in battle, and generated prep effects in a real match-host round. The original single-battle presets do not dispatch prep events; the five templates below add an explicit isolated exercise.

**0.3.1 gameplay forms (§34.29).** Each has a server template and a page editor, with official-name search,
bounded numeric inputs, selects and editable lists. No hand-written JSON or new HTTP route is required:

| Template | Fields and generated content |
|---|---|
| `bond` | Name, description, 1–16 ascending thresholds (1–100), count mode, core/extra, 1–64 distinct operator members, effect tier, prep DSL and member talents. Generates a bond record, membership patches, prep spec and additive operator traits, preserving official kits. Original CC0 icon in the existing art slot; save the form before uploading/borrowing an icon. |
| `item` | Official normal item, optional elite pair, name, description, prices (0–1e9), tiers (1–6), shop visibility/exclusion/order, and existing buffs' numeric blackboards with official caps. Generates complete records preserving supported handler/effect identity and normal/elite links. No new buff handler can be introduced. |
| `trait` | Official operator, explicit replacement checkbox, Chinese text and optional en/ja/ko/zh-TW texts, battle talents and all eight operator prep hooks. `elementBurst` exposes element/targetOnField/selfOnField; layer caps 1–1000000 and gainItem count 1–64 follow the trait validator. The common spec applies to both forms. |
| `offers` | Hook list, any/list/every/range rounds, 1–6 slots, 0–2 refreshes, window seconds, quorum, timeout, prep deferral, and 1–128 local cards with labels/icons and closed grants. The template owns `offers/cards.json`; cards supply their individual grants. |
| `rules` | Four selects from `RULE_SWITCHES`, with descriptions. Inherit omits a declaration; other choices explicitly declare it, including official defaults. |

`POST validate-dsl {draft:{id,template,target,options}}` checks a temporary plugin with the folder checker
and data-only composer. Existing drafts reopen current document fields and merge only form changes; extra fields,
records, declarations, needed permissions and assets survive. Unchanged JSON text retains its original bytes.
Validation, save and unsaved trial share the complete merged folder, including retained files and required
dependencies; errors occur before any installed file is written. Bond samples read binary SP_PLUGIN_RESOURCES
resources when configured. Item params are rebuilt from final buffs with the data builder’s first-key-wins semantics
(strings override numbers within one buff); inherited MAGIC and buff-less morph items are supported, with pairing
disabled when the base has no elite form.
`POST trial` accepts an optional `exercise:{round,at,hook,elite,actions}` for these templates. The existing child
bench returns `exercise` alongside the replay: before/after funds, pending funds, refreshes, layers, inventory,
rules, open windows and action outcomes. It executes actual Match offer grants, seeded refreshes, quorum and
virtual-clock timeout; the page's choose/refresh/timeout buttons replay at most 32 actions from the same seed.
No room or listening socket is created. Saved and unsaved forms both work.

[ASSUMED] Defaults are editable examples, not official balance: one active bond member, +25% ATK, one fund at
roundStart; the first official hammer pair; a +25% ATK trait; three small fund cards and a 30-second window;
four explicitly declared default rules. One effect tier guards every bond rule; a bond's layer action can select
the new bond directly. Empty prep/talent lists omit their part. Membership authoring is capped at 64; a rules-only
template needs at least one declaration [ASSUMED]. Trials inject the selected bond tier, equip the
selected item form on the first holder when it is equipment, and dispatch one selected prep hook with that
holder. Bond hooks include income/refresh; trait hooks include gain/deploy instead. Auto selects the first authored
prep hook, falling back to roundStart; income starts at zero and credits setIncome after dispatch [ASSUMED].
Rules trials compare real Match actions against vanilla: twelve free level-one refreshes with enough Victoria
members, disabling the first holder’s skill during prep, two bond items followed by a morph, and unequipping a
elite hammer on a separate holder [ASSUMED]. Replay uses actual equipment/loadout and the applicable morphPairing option.
They do not prove population counting for authored bonds, full economic flow or consumable targeting.
Item/chess grants remain visible in inventory. These exercises apply to dummy/wave/duel presets, not golden
scenarios; the independent vanilla console remains unchanged. Full match checks use the existing test room.
Item templates add `effectRef` to their own complete records in a second generated patch, after pair expansion;
this preserves official prep handlers and combination identity without compact inheritance flattening the pair.
[ASSUMED] Standalone bond/trait forms require members with playable official chess records in this installation;
backup-only operators need an operator plugin first, because a trait declaration does not create a chess pair.

**Try a battle.** `GET /studio/api/trial-options` lists official operators/waves and, in source checkouts, golden battle
scenarios (not whole-match cases). `POST /studio/api/trial` takes `{id, scenario, operator?, opponent?, wave?, seconds?,
seed?, settings?, draft?}`. `draft` is the current wizard `{template,target,options}`; an isolated temporary copy leaves
the installed folder untouched. All writes and runs require the existing LAN/Host/origin checks and studio key.
The response is `{ok:true, vanilla, plugin, comparison}` or `{ok:false, issues}`. A disposable child validates the folder,
builds its dependency-complete content set with C1, then simulates the original and plugin with the same scene/seed.
Scripts require the parent's enabled snapshot, its execution mode, and the same still-valid lock; native trusted scripts also retain the owner's pin gate. Sandbox scripts use the same permission-limited child options, SES initialization and `installSandboxScripts` adapter as formal match hosts. There is no fallback to native execution. Neither the HTTP process nor the studio page executes author code. A bad plugin produces C6 findings with no replay. The parent creates every draft temporary directory. Success, refusal, timeout, crash, IPC failure, shutdown and client disconnect all kill the detached process group (Windows: `taskkill /T /F`) and reap the writer before removing its directory. The child also removes it before sending any result. Probe and simulation children inherit the group. Probes retain the shared 5 s SIGKILL deadline (`SP_SCRIPT_PROBE_MS`). [ASSUMED] 2 comparisons concurrently, 20 seconds including checks/composition,
512 MB child heap, 16 MB IPC response and 6 MB recorded frames per side; ordinary preset durations 1–120 game seconds,
golden exercises capped at 240 seconds. API request payloads are at most 256 KB.

Presets are a stationary non-attacking dummy, a selected enemy wave, and a stationary two-operator attack exercise.
[ASSUMED] The latter uses engine `forceAttack` and ally targets, ends at the first knock-out and does not change official
allegiances; enemy-only skill selectors therefore do not hit that opponent. It is labelled accordingly, not a PvP mode.
New operators compare against their official reference (fallback Texas if no official reference resolves), named in the
comparison table. Replays carry BattleSpec, field metadata, actual snapshots/events at the game's 3-tick cadence,
results, event counts and per-unit damage/healing/taken stats. The studio feeds these to `render/app.js`, with pause,
replay and speed controls. It does not simulate in the page. The bench is a single battle; prep/mode economy still needs
an actual room or author harness test. See the three step-by-step sections in PLUGIN-GUIDE.md.

<a id="test-console"></a>

**Test console (0.3.1).** `/studio/console.html`, linked from the studio header, is an independent vanilla battle
sandbox. Both `POST /studio/api/console/options` and `POST /studio/api/console/build` require the existing studio key,
LAN/Host/origin gate; an unkeyed request is 404. Options supplies the initial scene and battle-supported tactic cards.
Build takes the scene below, validates shape, references, loadouts, placement and bounded work against official data,
and returns `{scenario, spec, cap, maps, tokens, scale}`. It never runs the battle on the server, changes a room,
installs a plugin, changes the sim singleton or records statistics. The page loads the real browser sim and field view.

The versioned JSON is `shared/studio/scenario.js`; unknown fields and unsafe object keys are rejected. Required fields:

| Field | Value |
|---|---|
| `v`, `name` | `1`, a title of at most 120 characters |
| `stageId`, `modeId`, `kind` | official IDs; `normal`, `boss`, `hidden` or `unite` |
| `round`, `seed`, `seconds` | 1–15; integer 1–4294967295; cap 1–1200 game seconds |
| `waveId`, `bossId` | official ID or `null` for automatic selection; incompatible field/template combinations are errors |
| `enemyMode`, `enemies` | `official` and an empty list, or `custom` with `{enemyKey,count,routeIndex,time,interval}` groups |
| `bounties` | effect IDs from the options' bounty cards, at most 16 |
| `players` | one owner (normal) or one/two owners (other fields), each as below |
| `flags` | optional `dpInit`, `dpPerSec`, `dpMax`, `layerGainsEnabled`, `startOpCooldown` inside an object |

Each player has `units`, `bonds`, `bandId` (or `null`), `choices` (battle-capable tactic effect IDs),
`deviceOverrides` (official aliases → booleans), `handUnits` (0–15). A chess unit is
`{uid,kind:'chess',chessId,row,col,dir,items}`; a token is `{uid,kind:'token',tokenId,ownerUid,row,col,dir}`.
UIDs are unique across both owners; coordinates are the owner's board rows 9–12, columns 2–10; directions are
`UP|RIGHT|DOWN|LEFT`. Boss R is mirrored by the spec; unite's second board is offset eight columns. Summons require a
deployed owner, its selected skill and the match's summon stock / owner-range rules. Equipment slots are at most two;
consumed-on-equip and acquisition/prep effects are not replayed. Population limits are deliberately absent in the sandbox.
Chess may add `skillIndex`, `moduleId` (`none` removes it), `potential` (1–6), `cultivate` (0–3), `diy`
(`{charId,skillIndex,uniEquipId}`), or `standIn:true` (without own skill/module/potential/cultivate).
Prototype DIY selections retain their locked skill/module and reject potential/cultivation; other-mode modules are refused.
`carryState:{hpPct,sp,down}` is optional (tokens only accept `sp`). Bonds are explicit `{tier,layers}` by bond ID;
they are not inferred from the roster. `facts` optionally carries `shopLevel`, `funds`, `handChess`, `roundStats`
(`refreshes,buys,sells,spent,gainedChess,arts`) and `extraBands` for conditions read by combat content; it does not run
prep events. Normal round wave selection/scaling, leader templates and pool HP, bounty scaling, terrain and devices
reuse the match builders. No arbitrary effect references or executable content can be imported.

[ASSUMED] Authoring limits: 512 KiB JSON; 36 units per owner; 100 custom groups / 500 enemies (before bounties);
1–100 enemies per group, spawn 0–1200 s and interval 0–120 s; 32 choices per owner. Any official template can be
exercised at another round's scaling. The default unite exercise treats the entire selected normal wave as leaked
enemies of owner one; use custom groups for the actual leaks. Bounties also belong to owner one. Leader pool HP uses
the number of boards in this isolated field. Other fields, team LP, real-time overtime, acquisition effects, economy,
cross-round state, arbitrary stat edits, movable devices, Arts items and plugin content sets are outside this console.
The UI names its unsupported parts and prep-only tactics. A full match is not this page: the host test room
(DESIGN §34.8, `SP_TEST_MODE` / `--test-mode`) is a separate lobby room. This sandbox does not create one.

The run starts paused. Editing recompiles and resets; one tick / one second means 1 / 30 fixed sim ticks, up to the
cap or the normal battle end. Empty custom waves stay open until the cap. Speed 0.25×–8× affects tick scheduling only;
an optional renderer `playbackTime` also holds animations while paused. A background tab pauses. Inspector and
damage/heal logs read the live battle; `official:<key>` records an actually loaded official instance, while
`procedural:*` records this view's procedural calls (particle entries require an accepted pool object). Totals survive
the 300-entry log cap. Effects depend on assets, renderer tier and load timing; they are diagnostics, not a sim digest.
3D / 2D and official FX off / lite / full use the normal renderer and report its actual state.
Download/import never include the studio key. The last validated scene is kept in browser localStorage
`sp.studio.console.v1`; malformed imports keep the current scene. JSON is a reproducible setup, not a mid-battle save.

**Room panel completion.** Declared settings now show boolean, integer, number and typed-enum controls with min/max/step.
The host applies the form via the existing `room.setPlugins`; values are normalized before composition and the resolved
`plugins[].settings` is broadcast only when nonempty. Other players and running matches are read-only. Switches and
reapply preserve current settings. Changing an automatic dependency's settings makes it an explicit choice.
Content sets listen to registry rescans and notify `onStale(cs, ids)` once while a changed set is held; the lobby tells
only its host (after the match if necessary). Visual and content notices have separate keys per held composition; while a match runs their plugin names are merged into the deferred host notice.
Gameplay sets never automatically change; reapply causes the existing content-ready and consent flow. The studio watch
includes content, script and UI hashes, including equal-size file edits. Empty selections keep the vanilla wire shape.

**Hot reload** (`server/studio/watch.js`): from the studio's first keyed request on, `plugins/` is watched (fs.watch over the
tree, the events of 300 ms gathered into one [ASSUMED]); then the registry reads the folders again
(`registry.rescan()`), the visual sets look at the sets rooms hold, and a room whose set changed — every studio write
rescans at once — applies the same plugins again by itself when its host is the author (a game session the studio's page
named: `POST /studio/api/authors` with the tokens of this browser's `sp.tokens`, kept 10 minutes after the page last named
them [ASSUMED]) or its host is its only player, **and the room uses cosmetic plugins only**: a new `vs` in
`room.state`, during a match too (art never changes a battle; nobody is un-readied: `server/lobby.js refreshPlugins`); any
other room's host is told as before (§9). Gameplay rooms always wait for host reapply; an active match keeps its snapshot.
Such a cosmetic room follows every rescan that changes one of its plugins, also after a
plugin was broken for a moment while its author saved it (the visual sets tell a held set once; the studio looks again
after each rescan). A server whose owner never opens the studio watches nothing and keeps §9's behaviour exactly. The studio's page hears the plugins whose state changed (`GET /studio/api/events`, server-sent events;
at most three streams from one address, and a page the browser keeps in its back / forward cache closes its own — a
browser keeps only about six connections to a server) and reloads its view — an author saving from Spine or an image
editor sees the preview follow. A player's personal
plugins follow on the next catalogue fetch (not pushed).

**The API** (for experienced authors and agents; the page uses nothing else; a change carries `X-SP-Studio: <the key in
plugins/.studio-key>` and answers with the plugin's state, an error `{ error: <code>, params, detail }`; HEAD answers as
GET without the body):

| Route | What |
|---|---|
| `GET /studio/api/info` · `targets?q=&kinds=` · `slots?template=&target=` · `suggest-id?name=&target=&template=` | the templates and limits; targets by official name; a template's slots for a target; a free id |
| `GET /studio/api/plugins` · `POST /studio/api/plugins` | every plugin folder (loaded or skipped, its codes); a new plugin `{ template, id, name, target, authors, license, credits }` |
| `POST /studio/api/plugins/remove` | remove plugins `{ ids: [<id>, …] }` (1–100 strings, `limits.removeMax` of `info`; one named twice counts once) → **200** `{ removed: [{ id, to }], refused: [{ id, error, params }] }` in the order asked, also when some or all are refused (like S3's multi-object delete: a well-formed request is answered per id). `to` is relative to `plugins/` (`_removed/<id>-<time>`). Refused alone: not a plugin id — a `_` or dot folder too — (`PLUGIN_ID`), no folder of exactly that name (`PLUGIN_UNKNOWN`), a symbolic link (`PLUGIN_STUDIO_PATH`), in use (`PLUGIN_STUDIO_IN_USE` `{ id, rooms, matches }`: the rooms' codes, how many run a match), a move that failed (`PLUGIN_STUDIO_REMOVE` `{ id, detail }`: a code such as `EACCES`, never a path). A request it cannot read (no list, an empty one, more than 100, a value that is no text, no JSON) is `400 PLUGIN_STUDIO_REQUEST`; a wrong key `403 PLUGIN_STUDIO_KEY` (no `X-SP-Studio` at all, or another origin: the 404 page). Then the registry reads the folders and the change event names the removed ids |
| `GET /studio/api/plugins/<id>` | its manifest and text, overlay, files, sections, findings (`check.issues`: coded), registry view (`loaded`, `vs`), lock |
| `PUT …/manifest` · `POST …/meta` · `POST …/sections` | plugin.json as a whole; the basic fields `{ fields, lang }`; the sections the page shows |
| `POST …/slot` · `…/ref` · `…/clear` · `…/fix` | files for a slot `{ at, files: [{ name, data (base64), role? }] }`; a reference `{ at, ref }`; a slot emptied `{ at }`; a one-click fix `{ code, at?, file?, params? }` |
| `POST …/pack` · `GET …/zip` · `GET …/preview` | the lock and the check; the zip (a download, packs nothing); the temporary composition |
| `GET …/f/<hash8>/<path>`, `…/files/<path>` · `PUT` / `DELETE …/files/<path>` | a file of the folder (a draft's too) — of the types the studio writes only, sandboxed (`Content-Security-Policy: default-src 'none'; sandbox`); write or remove one |
| `GET /studio/api/trial-options` · `POST /studio/api/trial` | scenarios; a checked child-process battle comparison (key required) |
| `POST /studio/api/console/options` · `POST /studio/api/console/build` | test console defaults / combat choice support; validate a scene and build its browser BattleSpec (both keyed; 512 KiB body limit) |
| `POST …/authoring` · `POST /studio/api/validate-dsl` | wizard save with revision; structural DSL validation |
| `POST /studio/api/authors` · `GET /studio/api/events` | name the page's game sessions; the change events |
| `POST /studio/api/forge/preview` · `POST /studio/api/forge/import` | a Forge pack as `{ zip?: base64, files?: [{ name, data: base64 }], id?, noScripts?, offline? }` — never a path on the server. Preview is a dry run; `noScripts` leaves the script plugin of `kits/` out. §16 |

**The files** (`server/studio/files.js`): everything the studio touches is inside `plugins/<id>/` — the id a plugin id
(never a `_` template or a dot folder), a path a plain relative path (no `..`, no `.` part, no hidden part, ≤ 200
characters) of a type a plugin carries (art, models, audio, fonts, JSON, documents; never the lock by hand); a plugin
folder that is itself a symbolic link is never opened (403 `PLUGIN_STUDIO_PATH` for every read and change, with the key or
without; the list shows it apart — an archive unpacked into `plugins/` can bring a link to anywhere; the game's registry
may still load it, and serves only the files its overlay names, at `/p/`); no link inside the folder is followed (every
folder on the way and the file are lstat'ed) — neither for the studio's reads (plugin.json, an overlay file, the lock, its own note
`.studio.json`; a folder holding links is checked for its links alone) nor for its writes (the lock and the note are
renamed over a link put in their place, `plugins/_moved/` must be a plain folder; 删除所选 renames a whole plugin folder —
lstat'ed, never a link — into `plugins/_removed/`, which must be a plain folder too: `server/plugins/install.js
movePluginAside`, the forced install's move), and the packer reads no file through
a link either (`server/plugins/pack.js plainPath`); every walk of a folder is bounded (§5: the zip and the lock refuse a
folder past the limits, and `plugins/` is watched as a tree only while it holds at most 100 000 entries); a write goes to a
dot-named temporary file renamed over the target; a body over the limit is refused before it is read and its connection
closed; a file system error answers with its code only (its message, with the absolute path, stays in the log); a file at most
64 MB, plugin.json at most 1 MB, a request at most 160 MB (a model's files in one go, base64), a plugin at most 200 MB
and 5000 files [ASSUMED: the studio's limits].

**The error catalogue** (`shared/plugins/errors.js`, the 0.3.0 plan's interface C6): every `PLUGIN_*` code — the
manifest and file rules, a cosmetic plugin's overlay and lock, the registry's scan, the packer, a room's refusals (the
ERR codes) and the studio's API — with `{ zh, en, fix: { zh, en }, doc }` (and the studio's one-click fix where there is
one). The checks return `issues` beside their unchanged `problems` / `warnings` text: `{ level, code, text, at?, file?,
params }`. The studio shows them beside their field, `tools/plugin.mjs check` prints the plain words under each technical
line (`--lang zh|en`, `--json` for editors and agents), the server's start log adds the plain words of a skipped plugin's
first problem. The interface shows the Chinese text in a Chinese interface (中文, 繁體中文) and the English text in the
others [ASSUMED]. A new code goes into the catalogue (`test/plugins/errors.test.js` fails on a code the code names that it
lacks). The table below is generated from it (`node tools/plugin.mjs errors --write`):

<!-- plugin-errors:start (generated by node tools/plugin.mjs errors --write) -->
| Symptom | Code | Cause | Fix |
|---|---|---|---|
| The studio refuses the action and says why | `PLUGIN_STUDIO_CHANGED` | The plugin changed in another editor | Reload the plugin before saving your changes. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TRIAL_BUSY` | The trial bench is busy | Wait for a running trial to finish. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TRIAL_TIMEOUT` | The trial exceeded its time limit | Shorten the scenario, reduce units or check the plugin effects. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TRIAL_FAILED` | The trial process could not finish | Check the plugin again; consult the server log if it still fails. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TRIAL_LIMIT` | The trial replay exceeded its size limit | Shorten the trial or reduce units and effects. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_CONSOLE_SCENARIO` | Invalid test scenario: {path} ({reason}) | Check scenario fields, legal tiles, summon owners and waves; unsupported fields cannot run. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TRIAL_SCENARIO` | This trial scenario cannot run | Select valid operators, a wave and 1–120 seconds; use the sandbox preview for UI plugins. |
| The room will not switch it on; the panel says why | `PLUGIN_CONSENT` | A player has not consented to trusted plugins | Every seated player must personally accept the risk for this content set. |
| The room will not switch it on; the panel says why | `PLUGIN_TRUST_PUBLIC` | Trusted plugins are refused on a public listening address | Bind to a local address, or explicitly opt into trusted-force after reviewing the risk. |
| The room will not switch it on; the panel says why | `PLUGIN_TRUST_PIN` | The lock is invalid, files changed, or the trusted pin does not match | Repack to verify files; in trusted mode also review and pin the lock SHA-256 in plugins/config.json trusted. |
| The room will not switch it on; the panel says why | `PLUGIN_SCRIPTS_DISABLED` | The server owner has not enabled script plugins | Set SP_PLUGIN_SCRIPTS=sandbox for isolated scripts; native trusted code requires trusted mode, review and a lock pin. |
| The room will not switch it on; the panel says why | `PLUGIN_SCRIPT_CHECK` | The script failed its portability check: {detail} | Import only sp:sdk@1; export synchronous setup(sp) and use deterministic helpers. |
| The room will not switch it on; the panel says why | `PLUGIN_SCRIPT_OVERRIDE` | The plugin did not declare the official kit it replaces | List the official kit id in manifest overrides. |
| The room will not switch it on; the panel says why | `PLUGIN_SCRIPT_CONFLICT` | Two plugins register the same effect | Disable one plugin or use distinct registration ids. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_WORKER_TIMEOUT` | Plugin simulation did not respond | Check plugin loops and reduce simulation work |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_WORKER_FAILED` | Plugin simulation failed | Inspect the log and fix the plugin |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_WORKER_STOPPED` | Plugin simulation stopped | Start a new simulation |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_UNAVAILABLE` | Script sandbox is unavailable | Install dependencies and check the SDK adapter |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_DISABLED` | Script sandbox is disabled | Ask the owner to set SP_PLUGIN_SCRIPTS=sandbox |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_CLASS` | This plugin class cannot enter the sandbox | Pass only script plugins to SES |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_HASH` | Script bytes do not match the content hash | Reapply the plugin and verify the files |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_IMPORT` | Script import is outside the sandbox | Import only sp:sdk@1 and own relative files; avoid cycles |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_SYNTAX` | Script uses unsupported module syntax | Use synchronous setup and static imports; see the script reference |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_LIMIT` | Script source exceeds sandbox limits | Reduce source size and file count |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SANDBOX_MATH` | Script math is outside the deterministic domain | Use finite numbers and integer exponents |
| The room will not switch it on; the panel says why | `PLUGIN_UNKNOWN` | This server has not installed that plugin | Put the plugin folder into the server's plugins/ folder (the folder name is the plugin id); if it is gone, switch it off in the 插件 panel. |
| The room will not switch it on; the panel says why | `PLUGIN_BLOCKED` | That plugin cannot be switched on here: this version does not apply its class, or its scope does not include this place | A cosmetic plugin has "class": "cosmetic"; its scope is ["room"] (the host switches it on for the room), ["personal"] (a player for themself) or both. |
| The room will not switch it on; the panel says why | `PLUGIN_DEPENDENCY` | A plugin it requires is missing or out of its version range, or the load-order hints of some plugins form a cycle | Install the plugins its "requires" names (within their ranges), or remove the loadAfter / loadBefore entries that point at each other. |
| The room will not switch it on; the panel says why | `PLUGIN_CONFLICT` | The chosen plugins conflict with each other | Switch one of them off; a plugin's "conflicts" says which ones it cannot be used with. |
| The room will not switch it on; the panel says why | `PLUGIN_RULE_CONFLICT` | Two plugins set the same rule switch to different options ({path}) | Keep only one of the plugins, or make them choose the same option. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RULES` | The manifest rules are wrong: an unknown switch or option, or this plugin class cannot declare rules | rules may name only shopBias, prepLoadout, morphPairing and unequip, each with its two options; only content, script and trusted plugins may declare them. |
| The room will not switch it on; the panel says why | `PLUGIN_LIMIT` | Over this server's limit: {detail} | Switch on fewer plugins, or make them smaller (compress pictures and sounds, remove unused files, fewer whole-record references). |
| The room will not switch it on; the panel says why | `PLUGIN_INCOMPATIBLE` | That gameplay plugin is not made for this server's game version (or its plugin API) | Use a version of the plugin made for this game version (its "app" says which), or ask its author for an update. |
| The room will not switch it on; the panel says why | `PLUGIN_BUSY` | This server already runs as many plugin sets at once as it allows | Try again later, or pick the same plugins as a room already using some; the server owner can raise maxSets in plugins/config.json. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_NO_MANIFEST` | The plugin folder has no plugin.json | Every plugin folder needs a plugin.json (its manifest). The studio's 新建插件 or node tools/plugin.mjs new writes one. The older pack.json belongs to a language pack in packs/. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_JSON` | {where} cannot be read: it is not valid JSON, or too large | Look for a missing or extra comma, quote or bracket (no comma after the last item); a JSON file may be 8 MB at most. Editing in the studio avoids typing mistakes. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_JSON_LIMIT` | {where} is beyond the JSON limits (nested too deep, or a number too large) | Nest at most 64 levels; numbers must be finite and within ±1,000,000,000. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_MANIFEST_SHAPE` | plugin.json is not a JSON object at the top | The whole file is one { } object of "name": value pairs. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_MANIFEST_VERSION` | "manifest": 2 is missing or another number | Write "manifest": 2 in plugin.json (the version of the manifest format; 2 is the only one). (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ID` | The folder name “{id}” is not a plugin id | The plugin id is the folder name: 2–32 lower-case letters, digits and -, not starting with - (e.g. texas-red). Rename the folder. |
| The plugin works, with a note in the check | `PLUGIN_ID_MISMATCH` | The "id" in the manifest is not the folder name “{id}”; the folder name decides | Remove "id" from the manifest (the folder name is the id) or make it the folder name. (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_FIELD_UNKNOWN` | “{where}” is not a field of the manifest and is ignored | Check its spelling (case matters) or remove it. (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CLASS` | "class" is missing or not a plugin class | A cosmetic plugin has "class": "cosmetic". The classes: lang, cosmetic, content, script, ui, trusted. |
| The plugin works, with a note in the check | `PLUGIN_TEXT` | “{where}” should be a text or { "<lang>": "text" }; it is ignored | Write "Name" or { "zh": "名字", "en": "Name" }. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_LANG_CODE` | “{where}” is not a language code | Use a language code such as zh, en, ja, ko or zh-TW. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_VERSION` | The plugin's "version" is missing or not a version number | Write three numbers such as "1.0.0"; raise it whenever the plugin changes (1.0.1, 1.1.0 …). (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_APP` | The game versions the plugin is made for, "app", are missing or not a range | Write a range such as ">=0.3.0 <0.4.0" (this game is {app}). (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_APP_MISMATCH` | The plugin is made for the game {range}; this server is {app} | A cosmetic plugin still works (a reminder only). Once it is checked with this version, widen "app" to include {app}. (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_API` | The plugin API level "api" is missing, not an integer, or not supported | Write "api": {current} (this game supports {min}–{current}). (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SCOPE` | "scope" is not one this class allows | A cosmetic plugin has ["room", "personal"]: room — the host switches it on for the whole room; personal — a player for themself in 设置. (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_HOMEPAGE` | "homepage" is not an http(s) address and is ignored | Write a full address such as https://example.com/my-plugin, or remove it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DEPS` | A dependency (requires / optional / conflicts) is not right: {where} | Write { "<plugin id>": "<version range>" }, e.g. { "base-skin": ">=1.0.0" }; never the plugin itself, never one both required and in conflict, at most 32. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ORDER_HINTS` | A load-order hint (loadAfter / loadBefore / priority) is not right: {where} | loadAfter and loadBefore are lists of plugin ids (never one in both, never the plugin itself); priority is an integer within ±1000, default 0. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SETTING` | A setting is not right: {where} | Each setting is { "type": … }: boolean, integer / number (with min and max), enum (with options); its default within them; at most 32, no free text. |
| The plugin works, with a note in the check | `PLUGIN_SETTING_FIELD` | A setting has a field it does not know, “{where}”; it is ignored | A setting knows type, default, min, max, step, options and label only. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PART_CLASS` | “{where}” is not something a {class} plugin carries | A cosmetic plugin carries "assets" and "theme" only, a ui plugin "entry.client" and "slots"; numbers and new operators belong to a content plugin. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PART_SHAPE` | “{where}” is not written the right way | Write the path of a .json file of the plugin folder (or a list of them); "assets" and "theme" may also be the { … } object itself. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ASSET_FILE` | The file of “{where}” is not right: not a path inside the plugin folder, or not the kind of file this place takes | Write a path inside the plugin folder such as art/avatar.png. Pictures are .png .jpg .webp, sounds .mp3 .ogg, models .skel with .atlas (pages .png). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_THEME_URL` | “{where}” names a URL | A theme variable is a colour, a time or an easing — never a URL, var() or another expression. |
| The plugin works, with a note in the check | `PLUGIN_THEME_UNUSED` | This note is from an older version: this version applies theme variables on the player's own screen | This version no longer raises this note. Write theme.vars, and only this installation's design tokens. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_THEME_NAME` | “{where}” is not a design token of this installation | Set only a colour, time or easing custom property of :root in public/css/theme.css, such as --text-hi, --t-fast or --ease-out. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_THEME_VALUE` | “{where}” is not a colour, a time or an easing this token allows | A colour is #rgb, #rgba, #rrggbb, #rrggbbaa or rgb()/rgba()/hsl()/hsla(). A time is 0–2000ms or 0–2s. An easing is a keyword or cubic-bezier(). No URL, quotes or expression. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_THEME_LIMIT` | There are more than 64 theme variables | One plugin sets at most 64 theme variables. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_THEME_SHAPE` | “{where}” is not a theme variable map | Write "theme": { "vars": { "--text-hi": "#f4faf7" } }. A flat object whose every key starts with -- is also accepted. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_NOTICE_SHAPE` | “{where}” is not a notice | notices is a list. Each item has id (lower-case letters, digits and -), title and body, and may have date (YYYY-MM-DD) and i18n. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_NOTICE_LIMIT` | A notice exceeds the count or the length limit | One plugin has at most 20 notices, a title of at most 80 characters and a body of at most 2000. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_NOTICE_TEXT` | “{where}” has a title or a body that is empty or not plain text | Title and body must both contain text. The body may contain newlines. No control characters. Write a link as text. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_NOTICE_LANG` | “{where}” names a language this game does not know | An i18n key is a language code this game knows, such as en, ja, ko or zh-TW. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ENTRY` | An entry point is not right, or this class has none: {where} | A cosmetic plugin needs no "entry": remove it. A ui plugin has "entry": { "client": "ui/index.html" } (an .html file of the plugin folder). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_LANG_ONLY` | “{where}” belongs to a language pack (class lang), not a {class} plugin | Remove it; for a language pack, make "class": "lang". (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PERMISSION` | A permission is not right: “{where}” is unknown or not one a {class} plugin may have | A cosmetic plugin's permissions: assets.override (replace art the installation has), assets.add (a new entry), theme; a ui plugin's: ui.frame. "permissions" is a list. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PERMISSION_MISSING` | “{where}” needs the permission {need}, which the manifest does not declare | Add "{need}" to "permissions". (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_PERMISSION_UNUSED` | The permission {permission} is declared but nothing in the plugin uses it | Remove "{permission}" from "permissions" (the fewer, the more trust). (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_EMPTY` | The plugin carries nothing | A cosmetic plugin lists the art it replaces in "assets". The studio's templates are the easiest start. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_LINK` | {where} is a symbolic link; a plugin holds plain files only | Copy the real file into the plugin folder and remove the link. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_NAME` | The file name “{where}” cannot be used | Names of files and folders use letters, digits, . _ - and spaces; none starts with . or is "..". |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_TYPE` | {where}: a {class} plugin may not carry this kind of file | Pictures are .png .jpg .webp (no SVG), sounds .mp3 .ogg, models .skel .atlas; documents (.md, .txt, README, LICENSE) may sit beside them. Move the file out of the plugin folder (the one-click fix moves it to plugins/_moved/, never deletes it) or convert it. (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_FRAME` | {where} is a frame file outside the folder of entry.client | Put a ui plugin's .html .js .css into the folder of entry.client. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_SIZE` | The plugin is too large: {where} | A plugin holds at most 200 MB in 5000 files (2000 folders, 12 levels deep), a JSON file at most 8 MB. Compress pictures and sounds, remove unused files, or split it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_MISSING` | The manifest names {file}, which the plugin folder does not hold | Put the file there (folders and case must match) or correct the path in the manifest. Dropping the file on its slot in the studio puts it in the right place. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FILE_OUTSIDE` | {where} leads out of the plugin folder or cannot be read inside it | A plugin uses plain files of its own folder only: copy the file in (no link) and check that it opens. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_LANG` | A language pack's language is not right: {where} | "lang" is a language code (en, ja, zh-TW …); zh is the source language and never a pack; machineTranslated is true or false. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_LANG_FILES` | A language pack's "files" are not right: {where} | "files" is { "ui": "ui.json" } (required) and optionally "data", both .json files of the pack. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PACK` | An older content pack (pack.json) is not right, or this version does not load its type: {where} | packs/ loads language packs ("type": "lang") only. Art and data are plugins of plugins/ (plugin.json, "manifest": 2). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ASSETS_SHAPE` | The asset overlay is not written the right way: {where} | Follow data/assets.json: chars → operator id → avatar / portrait / spine …, sounds under audio. The studio's templates write it for you. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_ASSET_KEY` | “{where}” is not a key this place takes | The place decides the shape of a key: a container key is an entry's internal id (letters, digits, _ . / -, e.g. char_102_texas); a key of the `skins` map also allows @ # + and is at most 64 characters (an entry key takes up to 128). Copy a name from this installation's manifest, or make a new one within that character set. |
| The plugin works, with a note in the check | `PLUGIN_ASSET_IGNORED` | “{where}” is not something a cosmetic plugin changes; it is ignored | Check the spelling; PLUGINS.md §9 lists what a cosmetic plugin changes (avatars, portraits, models, icons, interface pictures, voices, sounds, music). (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_REF` | The reference at “{where}” is not right: not written as one, or the installation has no such art | { "ref": "char_112_siege" } borrows an entry of the same kind the installation has. Pick it from the list with the studio's 用已有的素材, or remove the write. (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SPINE` | The Spine model at “{where}” is not right | The .skel and the .atlas sit side by side with one name (t.skel + t.atlas), the .png pages beside the atlas and in "textures"; clip data is never written by hand — 打包 makes it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SPINE_PAGES` | {file} uses a page that "textures" does not list | List every page of the atlas in "textures" (the one-click fix fills it from the atlas). (the studio fixes it in one click) |
| The plugin works, with a note in the check | `PLUGIN_SPINE_NOTE` | The model {file} has a small issue: {detail} | Usually "textures" names a picture the atlas does not use, or a part is missing from the atlas. The model usually still shows: look at it in the preview. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SPINE_PARSE` | The model {file} cannot be read: not a Spine 3.8 binary skeleton the game reads, or it has no animations | Export a binary .skel with Spine 3.8 (not a .json skeleton), with its animations (Idle, Attack, Die …). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_LOCK` | plugin.lock.json is broken or of another format | Make it again with the studio's 打包 or node tools/plugin.mjs pack; never edit it by hand. (the studio fixes it in one click) |
| The plugin is skipped: its model is not packed yet | `PLUGIN_LOCK_MISSING` | The model {file} has no clip data yet (plugin.lock.json lacks it) | Press 打包 (or run node tools/plugin.mjs pack <plugin>): it reads the model's clips into plugin.lock.json. (the studio fixes it in one click) |
| The plugin disappeared after a model file was replaced | `PLUGIN_LOCK_STALE` | The model {file} changed; plugin.lock.json still holds the old one's data | Press 打包 again (or run node tools/plugin.mjs pack): the lock follows the new model. (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DUPLICATE` | A plugin id or a language is taken twice: {where} | Rename the folder (the plugin id; on Windows and macOS another case is the same name) or remove the duplicate. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_UNREADABLE` | Reading the plugin failed: {detail} | Check the files' permissions; if a program is writing the folder, wait until it is done. |
| The plugin works, with a note in the check | `PLUGIN_REQUIRES_MISSING` | The plugin it requires, {dep}, is not installed or not within {range} | Install the required plugin within its range; otherwise a host switching it on is refused. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_PATH` | This path cannot be used: {detail} | Files stay inside the plugin's own folder: no .., no part starting with ., no special characters, no link leading out. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_SIZE` | The file is too large (at most {max}) | Compress the picture or sound first (a portrait within 1024 px as PNG / WebP is plenty). |
| The studio refuses the action and says why | `PLUGIN_STUDIO_EXISTS` | There is a plugin “{id}” already | Choose another id, or open that plugin from the list. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TEMPLATE` | No such template: {template} | Pick one of the studio's templates (node tools/plugin.mjs new without arguments lists them). |
| The studio refuses the action and says why | `PLUGIN_STUDIO_TARGET` | No target “{target}” to replace | Search by its official name (e.g. 德克萨斯) and pick one of the results. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_FILE_KIND` | This place takes {kind}; the dropped file is {ext} | A picture place takes .png .jpg .webp, a sound place .mp3 .ogg, a model place its .skel, .atlas and .png together. |
| The studio refuses the action and says why | `PLUGIN_STUDIO_REQUEST` | The studio's request is not right: {detail} | Reload the studio and try again; if it stays, ask on GitHub with this text. |
| The studio only shows plugins; it cannot make or change one | `PLUGIN_STUDIO_KEY` | Changing a plugin needs the studio's key, which this browser does not have (or it is not the right one) | Open the address on the "Studio" line of the server's window (it carries the key, which is also in plugins/.studio-key), or paste it into the box at the top of the studio. |
| A plugin chosen for removal stays: it is in use | `PLUGIN_STUDIO_IN_USE` | The plugin “{id}” is in use (room {rooms}) and was not removed | Wait until those rooms close, or until their host switches it off in the room's plugin panel (a room in a match can do so once the match is over), then remove it. |
| A plugin chosen for removal could not be moved | `PLUGIN_STUDIO_REMOVE` | The plugin “{id}” could not be moved to plugins/_removed/: {detail} | Close programs that hold files of this plugin open (an image editor, Spine …), make sure the server may write the plugins/ folder and try again — or move the folder out of plugins/ yourself. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CONTENT_FILE` | The data file “{where}” cannot be read: {detail} | "data" lists .json files inside the plugin folder; no symbolic links, nothing outside the folder. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CONTENT_FORMAT` | The data file “{where}” is not in the right format: {detail} | A patch file is { "patch": 1, "ops": [ … ] }, a records file { "records": 1, "entries": [ … ] }; plugins/_template/content/ has one of each. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CONTENT_PERMISSION` | The data file “{where}” needs a permission the manifest does not declare: {detail} | Changing existing values needs "data.patch", adding records (new operators, enemies …) "data.add": list them in "permissions". (the studio fixes it in one click) |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_LIMIT` | The data is too large or nested too deep ({where}): {detail} | One JSON file is at most 8 MB and 64 levels deep, a whole content set at most 300 MB: split large files, drop what is unused. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_NUMBER` | A number is not allowed ({where}): it must be finite and within ±1,000,000,000 | Make the number smaller; data never holds infinities or huge numbers. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_TYPE` | “{where}” is not a plain JSON value: {detail} | Write JSON values only: objects, lists, strings, numbers, true / false, null. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_PATH` | “{where}” uses a key that is not allowed | Keys such as __proto__, prototype and constructor cannot be used (they could corrupt the program's objects): rename it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_BOUND` | A value is outside what a plugin may set ({where}): {detail} | A value may be up to 10 × the official maximum of the same key (at least 64); a step — an interval, a period, a cost — no smaller than a tenth of the official minimum. Make it smaller: creative values within 3 × the official ones always pass. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_REQUIRED` | The merged data lacks something or is broken ({where}): {detail} | A patch must not remove a field or a table the game needs; the original line says which one. |
| The plugin works, with a note in the check | `PLUGIN_BOSS_CENTRE_DEPLOYABLE` | Stage {stage} allows deployment on boss centre column 10 (field rows {rows}); both players can overlap there and battle deploys only the first unit | Set these tiles' effective buildable to NONE and move deployment platforms off the centre column; this warning does not change plugin rules. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_REFERENCE` | “{where}” refers to something that does not exist: {detail} | Check the spelling: the bond, enemy, operator or effect ids it names must exist in the game or in this plugin (same case). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DATA_PAIR` | The normal and elite pieces of an operator do not match ({where}) | A new operator comes in pairs: …_a the normal piece, …_b the elite one (isGolden: true), with the same charId and tier; a compact record (a records file) makes the pair for you. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PATCH_OP` | An unknown patch operation ({where}) | "op" is one of set, merge, add, append, remove. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PATCH_PATH` | A patch points at the wrong place ({where}): {detail} | "file" names a data table (chess, bonds, enemies …), "id" a record, "path" a list of keys and array indexes such as ["bb", "atk"]. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PATCH_TYPE` | A patch value has the wrong type ({where}): {detail} | "set" keeps the old type (a number stays a number, a list a list); a new record is an object; "ops" is a list. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_PATCH_SETTING` | A patch uses a setting that does not exist ({where}) | The name in { "$setting": "<name>" } must be declared in the manifest's "settings". |
| The plugin works, with a note in the check | `PLUGIN_PATCH_OVERRIDE` | Two plugins change the same value ({where}); the one loaded later wins | Usually fine; to make one plugin's value win, order them with loadAfter / loadBefore, or switch one off. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_EXISTS` | The record to add exists already ({where}) | Change an existing record with a patch (set / merge); a new record needs a new id. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_DELETE` | A plugin cannot delete a record ({where}) | To keep an operator or an enemy out, change the pools, stages or waves that use it — never remove the record. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_ID` | A new record's id is outside this plugin's namespace ({where}): {detail} | A new record's id carries the plugin id: plugin my-mod's new operator is char_x_my_mod_<name> (its - becomes _), a skill skx_my_mod_…; with kitRef the official skill ids may stay. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_HIDDEN` | Hidden must be a boolean ({where}) | Set chess.hidden to true or false. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_PAIR` | Normal and elite ids are invalid ({where}) | Use distinct namespaced chess.ids.normal and elite; omit chess.id. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_ART` | Art references are invalid ({where}) | Use asset ids in art.ref or art.assets, never paths or URLs. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_ORIGIN` | Source records are missing or inconsistent ({where}) | Use installed official charId or chessId in origin; both must agree. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_TYPE` | A compact record is not written the right way ({where}): {detail} | An operator has a charId, a name, a profession, a position and a rarity (1–6); its kit has exactly one source: generic, ref (an official kit), dsl or a JSON SkillSpec. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_RECORD_SKILLS` | An operator's skills are not right ({where}): {detail} | The skills list has exactly one default (default: true), the same as "skill"; when a description's count changes, change both. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_KIT_REF` | The official kit that "kitRef" names does not exist ({where}) | kitRef names an official operator (char_102_texas for example), whose skill logic is reused; spell it as the game does. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_SKILL_SPEC` | A JSON SkillSpec is not right ({where}): {detail} | Follow the SkillSpec of docs/PLUGINS.md §10: kind and the known fields of mods; talentMods go with a JSON SkillSpec, never with kit.ref. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_EFFECT_REF` | An effect reference is not right ({where}): {detail} | effectRef names an official item or tactic record; garrison effects and buff keys must be ones the game has. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_I18N` | A translation file of the plugin is not right ({where}): {detail} | A translation file is { "version": 1, "lang": "en", "files": { … } } with lang matching its name; it replaces existing text only, never adds a field. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_UI_SLOTS` | The "slots" of a ui plugin are not right: {detail} | "slots" is a list of hud.right, result.tab, stats.tab and room.panel, each at most once. |
| The plugin works, with a note in the check | `PLUGIN_UI_NO_SLOT` | The ui plugin asks for no slot, so its page is never shown | List where it goes in "slots", for example ["hud.right"]. |
| The ui plugin's page gets a refusal (ok: false, a rejected or a limit message) | `PLUGIN_SLOT` | The slot a ui plugin asked for was not granted: its manifest's "slots" does not list it, or another plugin holds it | List the slot in "slots" of plugin.json (hud.right, result.tab, stats.tab, room.panel). The protocol table grants one plugin at a time; when several ask for one slot, the match shows tabs to switch. |
| The plugin works, with a note in the check | `PLUGIN_UI_SLOT_SHARED` | Several ui plugins ask for the same slot ({detail}). The match shows tabs and displays one at a time | This is not a failure: the player can switch within the slot. Give them different slots if each should be visible at once. |
| The ui plugin's page gets a refusal (ok: false, a rejected or a limit message) | `PLUGIN_RATE` | The ui plugin sends messages too fast and was throttled | A plugin sends at most 20 messages a second (bursts of 40). Batch them, or send only when something changed. |
| The ui plugin's page gets a refusal (ok: false, a rejected or a limit message) | `PLUGIN_STORAGE` | The ui plugin's storage request was refused: the key is not allowed or the space is used up | A key is 1–64 characters of letters, digits and . _ -; a value's JSON is at most 4096 bytes; a plugin keeps at most 32 keys and 32 KB. |
| The ui plugin's page gets a refusal (ok: false, a rejected or a limit message) | `PLUGIN_INTENT` | The ui plugin tried to send a match action, which is refused | A ui plugin watches and never plays (it cannot become a bot or a cheat): do not send hello, ping, room.*, g.* or b.* messages, nor carry one inside another message. |
| The ui plugin's page gets a refusal (ok: false, a rejected or a limit message) | `PLUGIN_SHAPE` | A message from the ui plugin is not shaped right and was dropped | Every message is { "v": 1, "t": <type>, … } with a type of ready, slot, resize, storage, notice or stats, at most 8 KB; schemas/ui.schema.json has the shapes. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_OFFER_REFERENCE` | An offer references an unavailable record: {detail} | Use official records or this plugin’s own items, chess and bonds declared in the room content set. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_OFFER_SHAPE` | This interaction window is not shaped right: {detail} | One offers/*.json is { "offer": 1, "id": "<name>", "when": { "at": ["battleCheck" or "prep"], "rounds": <rounds> }, "windowSec": <seconds>, "slots": 1–6, "options": { "source": "<a .json in the plugin>" } }; windowSec defaults to 0 (no window, nothing held back). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_OFFER_ROUNDS` | The round expression of this interaction window is not readable: {detail} | Write rounds as a list of 1–99 ([1, 3, 6, 11]), "any" (every round), { "every": N } or { "from": R, "to": R }; the window opens before that round begins, on any round — not only the ones the official schedule uses. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_SHAPE` | The DSL spec is not shaped right: {detail} | The whole spec is one object: { "dsl": 1, "pluginId": "<plugin id>", then "skill", "skills", "talents" or "meta" }. |
| The plugin is not listed (skipped); check names the DSL version | `PLUGIN_DSL_VERSION` | This version reads "dsl": 1 only | Put "dsl": 1 at the top of the spec. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_PLUGIN_ID` | The plugin id the DSL spec names is not the plugin that carries it: {detail} | Write the id of the plugin that carries the spec (its folder name) as "pluginId", or leave it out and the server fills it in. A plugin cannot spend another plugin's action budget. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_BUDGET` | "budget" is a whole number from 1 to 10,000,000 | Write a whole number, or remove "budget" for the default of 8000. A plugin whose actions run more often than that in one battle stops for that battle. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_LOOP` | The DSL names a loop or outside code, or nests too deep: {detail} | The DSL has no loops or code (loop, while, script …); "then" nests at most 4 deep and one value at most 64 levels and 64 nodes. Complex logic belongs to a script plugin. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_TRIGGER` | An unknown trigger ({where}): {detail} | In battle: always, deploy, battleStart, attack, hitDealt, hitTaken, kill, allyDeath, skillStart, skillEnd, every, hpBelow; in prep: roundStart, income, buy, sell, refresh, merge, levelUp, battleResult. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_CONDITION` | A condition is not right ({where}): {detail} | A condition is { "<name>": value } with chance, targetHas, selfHpBelow, enemiesInRange, bondActive or skillActive; prep takes round, chance and bondActive only. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_ACTION` | An action is not right ({where}): {detail} | "do" is a list of actions, each one of buff, status, damage, heal, sp, dp, push, pull, spawnToken, layers, shield, fx (prep: funds, layers, gainItem); docs/PLUGIN-DSL.md §4 has their fields. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_TARGET` | A target is not right ({where}): {detail} | A target is self, target, source, alliesInRange, enemiesInRange, enemiesInRadius, lowestHpAlly or allAllies; the "tile" of spawnToken is "around" or { "r": row, "c": column }. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_EVERY` | The interval of "every" is too short ({where}): {detail} | "seconds" is at least one tick (1/30 s). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_NUMBER` | A number is out of range ({where}): {detail} | Write finite numbers: the threshold of hpBelow is above 0 and at most 1, "times" a whole number from 1 to 8. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_DIV0` | A division by 0 ({where}) | The second term of "div" cannot be 0; to keep a value as it is, multiply it by 1. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_VALUE` | A value is not right ({where}): {detail} | A value is a number, { "bb": "<key>" }, { "talent": [index, "<key>"] }, or mul, add, sub, div, min, max of them; a list appears only inside those. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_SKILL` | A skill spec is not right ({where}): {detail} | "skill" is an object whose "kind" is instant, duration, ammo, charges, toggle or passive; several skills are "skills": { "<skill id>": { … } }. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_META` | The prep spec is not right ({where}): {detail} | Write "meta": { "on": [ { "when": <trigger>, "do": [ <actions> ] } ] }; "meta.key" is effect:<plugin id>:<name> with this plugin's own id. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_DSL_TALENT` | A talent is not right ({where}): {detail} | "talents" is a list of objects such as { "when": <trigger>, "if": <condition>, "do": [ <actions> ] }. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CATALOG_SHAPE` | The catalogue file is not in the right shape: {detail} | A catalogue is a JSON object with "catalog": 1, a "name" and a "plugins" list. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CATALOG_URL` | A catalogue or plugin address is not an https address this installer will fetch: {detail} | The address starts with https://, the host has a dot, and it has no user or password. A download uses a public address on port 443 only. Loopback, private, link-local and .local are refused unless the operator names the host in allowDownloadHosts. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CATALOG_HASH` | A catalogue entry has no sha256, or it is not 64 lowercase hex digits: {detail} | Each plugin names the SHA-256 of its zip (64 lowercase hex digits). |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CATALOG_ID` | A plugin id is not valid, or it is repeated: {detail} | An id is 2 to 32 lowercase letters, digits and hyphens, and it appears once in the catalogue. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_CATALOG_FIELD` | A catalogue field is not valid: {detail} | Follow docs/plugin-catalog.example.json: version is semver, class is a known class, and long text is shortened. |
| The studio refuses the action and says why | `PLUGIN_CATALOG_SIZE` | The catalogue file is too large: {detail} | The catalogue document itself is at most 1 MB. A plugin zip has its own 200 MB cap. |
| The studio refuses the action and says why | `PLUGIN_CATALOG_FETCH` | The catalogue could not be fetched: {detail} | Check that the address is public https on port 443, that the server can reach it, and that it is not redirected to a non-public address or off https. The one deadline covers the body, not each redirect on its own. A local catalogue file works too. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_URL` | The install address is not a public https address: {detail} | Install a public https zip on port 443 only. A private or loopback address is refused unless the operator allowlist names it. A file on this machine can be given as a path, including a Windows drive or a UNC path. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_HASH` | The zip SHA-256 does not match, or none was given: {detail} | An https install needs --sha256 (or the sha256 of a catalogue entry). Do not install when the hash differs. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_SIZE` | The zip is over the size cap, or it is not the byte length the catalogue names: {detail} | A plugin is at most 200 MB. When the catalogue gives bytes, it has to be the zip size. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_TIMEOUT` | The download timed out: {detail} | Check the network and try again. A zip waits up to 60 seconds, a catalogue up to 20. That one deadline covers the connection, the redirects and the body. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_FETCH` | The download failed: {detail} | Check that the address opens and answers with the zip (HTTP 200). |
| The studio refuses the action and says why | `PLUGIN_INSTALL_REDIRECT` | The download was redirected to a non-public address, off port 443, or too many times: {detail} | Only a public https redirect on port 443 is followed, at most 5. Use a direct https address. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_ZIP` | This zip cannot be installed: {detail} | The zip needs plugin.json (optionally inside one folder named with the plugin id). No path traversal, symbolic links, encryption or too many files. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_CHECK` | The plugin failed its check and was not placed in plugins/: {detail} | Fix the plugin as node tools/plugin.mjs check says, then install again. A failed check deletes only the temporary files. |
| The studio refuses the action and says why | `PLUGIN_INSTALL_EXISTS` | plugins/ already has this id: {detail} | Without --force nothing is overwritten. --force moves the old folder to plugins/_replaced/ and does not delete it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_INPUT` | This is not a Forge pack that can be read: {detail} | Choose a workshop folder that contains pack.json, or a zip of that folder. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_ZIP` | This pack's files are not safe to unpack: {detail} | Paths must stay inside the pack, with no symbolic links, at most 5000 files and 200 MB. Import another pack. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_JSON` | JSON in the pack cannot be read: {detail} | JSON must parse, stay within 8 MB and 64 levels. A Forge pack may contain finite numbers within ±1e9 and safe integers; non-finite numbers and values past the safe-integer range are still refused. A number written into a plugin or into game data must still stay within ±1e9. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_ID` | This pack's id cannot become a plugin id: {detail} | Pass --id with a plugin id: 2–32 lower-case letters, digits and -, for example rose-skin. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_EXISTS` | The destination folder already exists, so nothing was written: {detail} | Choose another --out or --id, or move the existing plugin folder aside and import again. |
| The plugin works, with a note in the check | `PLUGIN_FORGE_MOUNT` | Panel mount needs manual adaptation: {detail} | Rewrite for the suggested slot; it is not the original mount position. |
| The plugin works, with a note in the check | `PLUGIN_FORGE_PANEL_SCRIPT` | Panel script was not copied: {detail} | Rewrite the panel script with postMessage API v1; import never executed it. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_FORGE_SCRIPT` | A script in the pack was not imported and was not run: {detail} | A kits/<id>.js becomes the sandboxed script plugin when its id is an imported record (or an official id declared in overrides) and its imports map to sp:sdk@1 (@kit/tier1.js, @sim/constants.js, @sim/detmath.js, the safe subsets of @sim/dir.js and @sim/targeting.js, the pack's ./ files); otherwise rewrite the logic as a JSON SkillSpec, DSL or a script plugin. The importer never runs a .js from the pack. |
| The plugin is not listed (skipped); the start log and check say why | `PLUGIN_INVALID` | The plugin has a problem: {detail} | Read the original line; if it is unclear, ask on GitHub with it. |
<!-- plugin-errors:end -->

**Schemas** (the plan's interface C7): `schemas/plugin.schema.json` (manifest 2) and `schemas/overlay.schema.json` (the
asset overlay), JSON Schema 2020-12 — write `"$schema": "../../schemas/plugin.schema.json"` in a plugin.json (the studio
and `new` do) and an editor completes and checks it. A manifest or overlay is accepted exactly when the checks find
neither a problem nor a warning in it, on one shared set of fixtures (`test/plugins/schema.test.js`); what only the checks
see is named in the schemas' descriptions: the folder (the id is its name; the files exist, of the class's types), the
running game's version against `app`, a plugin both required and in conflict or both after and before, a setting's min ≤
max and default within them, a theme naming a URL, an atlas beside its skeleton with its name, references the
installation lacks, the limits. The schema is a little stricter than the checks where they silently ignore a value of
another type (`englishName`, `credits`, `license`, `authors`).

**Templates are modules**: a template is one file of `server/studio/templates/` (its class, its target kinds, its
slots for a target, the overlay of a new plugin) beside one of `public/studio/js/editors/` (its previews and what its
slots take). The `dsl` template is a content plugin (one operator and one prep spec) with a structured gameplay editor. All gameplay templates use the same `build` contract; cosmetic templates retain their slot editors.

## 16. Forge import

A Forge workshop pack — a folder or a zip with `pack.json` at its root, one wrapping folder stripped — can be read
into one or more of our plugins. The importer (`server/plugins/forgeImport.js`) is original code. It does not copy
Forge's source, and it does not screen for official art, the same rule as the packer: what a plugin carries is its
author's responsibility. A pack is untrusted. The importer reads bytes only. It never `import()`s, `eval()`s or
`require()`s a file from the pack. Compatible read-only panels become sandboxed ui plugins (below);
`kits/<id>.js` files become sandboxed script plugins (`server/plugins/forgeKits.js`): parsed with acorn and rewritten,
never run during the import. Kits run afterwards only where the server owner set `SP_PLUGIN_SCRIPTS` and a room
selects that plugin; panels run only in the player's iframe.

```
node tools/plugin.mjs import-forge <dir or zip> [--out plugins/<id>] [--id <id>] [--dry-run] [--json] [--no-scripts] [--offline] [--asset-source=direct|mirror] [--refresh-index]
```

`--out` names the primary product's folder; its basename becomes that product's id. `--id` overrides the pack id
before the suffixes below. `--dry-run` writes no plugin or `IMPORT-REPORT.md`; needed official tables may be cached
(use `--offline` to forbid downloads). `--json` prints the report
object only, keys sorted. Exit 0 when the pack was read, including when nothing could be imported; exit 1 when the
pack could not be read or a product failed `check`, `pack`, the visual set or the content set; exit 2 on a bad
command. A product that fails is not left in `plugins/`. `--no-scripts` writes no script plugin: each kit file is
named in the report with that reason, and its record keeps its own kit in the content plugin.

**On-demand official tables (0.3.1, §34.33).** The maintainer decided on 2026-10-17 that an explicit import needing
official operators outside the shipped chess/backups roster fetches the missing `character_table.json`,
`skill_table.json`, `range_table.json`, `uniequip_table.json`, `battle_equip_table.json` and `activity_table.json`.
Setup/startup/update gap preparation does the same when W5/P10's bounded installed-plugin JSON scan finds such
references (including disabled plugins). Without the character table, syntax outside the roster is the discovery
trigger [ASSUMED]; once that table rules out every candidate, no further tables are fetched. Art extraction still
requires an own official-table entry and its existing consent.
The source is the same official-data mirror as the voice tables: `RAW.gamedata` (Kengxxiao/ArknightsGameData,
zh_CN), via `cachedJson`, raw GitHub → jsDelivr and the shared `MirrorPolicy`. `--asset-source=direct|mirror`,
`SP_ASSET_SOURCE`, `SP_GITHUB_PROXY` and HTTP(S)_PROXY follow the asset downloader. CLI/setup restart once to enable
Node's env proxy when needed; start a studio server with `NODE_USE_ENV_PROXY=1` when using an HTTP(S) proxy on
supported Node versions. The guard refuses to bypass a configured proxy.

Console/report lines name the missing tables, approximate MB and reason (about 50 MB uncompressed for all six).
Cached tables are reused; only `--refresh-index` replaces existing files. `--offline` (alias `--no-network`) always
forbids downloads, including refresh; setup also honors `--check` / `--no-assets` and offers offline/no-network as
read-only checks. Invalid existing files stay untouched until refresh [ASSUMED]. Failed/refused downloads retain
the existing skip/fallback and name the reason. JSON parsing and table-specific shapes are checked before atomic
rename: record maps with phases/levels/grids, module equipDict/charEquip maps, and activity autoChessData.
[ASSUMED] Decoded caps are respectively 32/32/2/16/16/32 MiB; estimates are rounded from the local tables inspected
on 2026-10-17. Concurrent imports share a per-install queue. No table download happens in matches, lobbies or game
client paths, and no plugin field, API surface or derived-record semantics change.

The studio does the same thing. On `/studio/` the button 「从 Forge 包导入」 takes a zip or a folder. The browser
sends the bytes. While that read is in progress the preview and confirm buttons stay disabled, and the previous
report is cleared so a late read cannot confirm the pack that was on screen before. The server is never given a
path on its disk. `POST /studio/api/forge/preview` and
`POST /studio/api/forge/import` take `{ zip?: base64, files?: [{ name, data: base64 }], id?, noScripts?, offline? }` and use the
same gate as every other change (`X-SP-Studio`, this machine or the local network). A pack that is unsafe to unpack
is 400 with a `PLUGIN_FORGE_*` code. A pack that was read answers 200 `{ report, plugins: [{ id, class }] }`.
`report.ok` is false when a product failed the checks, and nothing was written. Preview is a dry run. Confirming
writes `plugins/<id>/` and rescans. The dialog's box 「不生成脚本插件」 sends `noScripts: true` (the CLI's
`--no-scripts`); toggling it clears the report, so confirm always writes what the last preview showed. When the
report has a script plugin the dialog says when it runs (below). The 「离线导入（不下载官方数据表）」 box sends
`offline: true` for both preview and confirm, and clears the old report when toggled. Online preview may populate
the official cache; confirming reuses it.

Each product is checked with `checkPluginFolder` and `packPlugin`. A cosmetic product is then resolved with
`createVisualSets({ registry }).resolve` (there is no `buildVisualSet`). A content product is built with
`buildContentSet`. A script product is not composed: composing it would run its setup in the preflight child, and
the importer runs nothing; its checks are `checkPluginFolder` (the registry's script scan) and `pack`. A problem or
a warning fails the import. After a successful write the primary folder holds `IMPORT-REPORT.md`: what was imported,
what was rewritten, what was not and why, and the [ASSUMED] lines. The lock `pack` wrote does not list that file; a
later `pack` rewrites the lock. A script product that is primary is packed again after the report is written, because
a script plugin runs only with a lock that lists every file.

**Ids.** Content keeps the pack id, or `--out`'s basename when that product is primary. Beside it, cosmetic is
`<id>-look`, each ui slot is `<id>-<slot>` with the dots written as hyphens, each language is `<id>-<lang>`, and the
script plugin is `kits-<id>` [ASSUMED]: a room composes it with the content plugin, and a `<id>-…` name would share
that plugin's record namespace, which composition refuses (`PLUGIN_RECORD_ID`, §10).
A name that is not a plugin id, or that collides, is fitted to 2–32 characters (`a-z`, `0-9`, `-`). A second import
into a folder that already exists is `PLUGIN_FORGE_EXISTS` and writes nothing.

**Safety.** The zip reader is this module's own (`readUntrustedZip`). It uses `crc32` from `server/plugins/zip.js`
and does not call `unzipFiles`. It rejects `..`, an absolute path, a backslash, NUL, a symbolic link (unix mode
`0120000`), ZIP64 (the EOCD sentinel, a ZIP64 extra field, or a ZIP64 locator in the 20 bytes immediately before a
real EOCD — not a `PK\\x06\\x06` that happens to sit inside an entry), encryption, a data descriptor, more than
`PLUGIN_LIMITS.files` entries (5000), and a declared or inflated size over `PLUGIN_LIMITS.pluginBytes` (200 MB). A
raw zip larger than that unpacked cap plus 64 KiB is refused before it is read [ASSUMED: the 64 KiB is header
room, so a zip only slightly over 200 MB is refused too]. JSON follows `checkJsonLimits` (8 MB, depth 64) and refuses
`__proto__`, `constructor` and `prototype` before mapping. A Forge file may contain a finite number within ±1e9 and a
safe integer past that window (a Unix timestamp on a field that is not imported). A non-finite number, and any magnitude
past `Number.MAX_SAFE_INTEGER`, still rejects that file (`PLUGIN_FORGE_JSON`). A number written into a plugin, or copied
into game data, stays within ±1e9 [ASSUMED]: skill `duration`, `spCost`, `initSp`, `maxChargeTime`, `increment`,
blackboard numbers, stats, `price`, `sellPrice`, and patch leaves. A larger one is named in the report and not written.
An array patch leaf (a `rangeGrid`, for example) that contains a finite number outside ±1e9 is omitted and named the same way, so the other fields of that record still import.
Written plugin JSON stays within ±1e9. Asset trees use a null-prototype object. A directory read uses `lstat`, does not follow a link, refuses a regular file with
`nlink > 1`, and reads through `O_NOFOLLOW` only after `fstat` matches. Empty directories count toward the 5000
cap. A dry run stages under the temporary directory and removes the stage. A real write stages in a dot directory
beside `plugins/` — the registry skips dot directories — and commits by rename. `EXDEV` fails the import; it is
not copied [ASSUMED]. A failed commit removes only the destinations that attempt created. The visual set and the
content set see plugins already installed, through a temporary symlink view. The source pack is not part of that
view. Two i18n entries that canonicalise to the same language are `PLUGIN_FORGE_INPUT` and write nothing.

### Compact metadata (0.3.1)

Optional operator fields preserve old plugins unchanged:

- `chess.hidden: true`: retain both records for grants; exclude shop/shared pools, handbook/loadout lists,
  bond visible members and DIY owned selection. [ASSUMED] For `as: "both"`, hiding also excludes the DIY pick.
- `chess.ids: { normal, elite }`: distinct `chess_x_<plugin_namespace>_…` IDs; do not also set legacy `chess.id`.
  Pair references and `upgradeChessId` use these IDs directly; suffixes are not required.
- `art.ref`: default installed character art and voice bank. The id matches `^[A-Za-z0-9_-]+$`, the same
  pattern as each `art.assets` id; a path or a URL is `PLUGIN_RECORD_ART`. `art.assets` overrides exact manifest IDs:
  `avatar`, `portrait`, `spine`, `voice`, `skillIcon`, `subProfIcon`, each optionally suffixed `Golden`.
  These are IDs, never file paths or URLs. Golden model/voice/icon defaults to the normal value
  (character entries have no E2 model or voice field). Avatar/portrait keep the `art.ref` id unless a Golden
  value is supplied; when that id is a character-manifest key, a golden piece uses `avatarE2` / `portraitE2`
  if the entry has one, and otherwise that entry's own URL.
  [ASSUMED] A borrowed voice bank shares that bank's browser voice preference.
- A hidden operator is appended to the bond's `members` only. The bond popup uses `visibleMembers` whenever
  that array is present, including when it is empty, so a bond with no visible members draws no catalogue row.
- `origin: { charId?, chessId? }`: installed official provenance; at least one is required, both must agree.
  [ASSUMED] This is metadata only: it never inherits stats, art or a kit. Art and kit selection are explicit.

Strict checks use `PLUGIN_RECORD_HIDDEN`, `PLUGIN_RECORD_PAIR`, `PLUGIN_RECORD_ART`, `PLUGIN_RECORD_ORIGIN`.
Forge `isHidden` / non-DIY `visible: false` maps to `chess.hidden` [ASSUMED: either hides both forms]; `baseId` is the
pair's normal ID, while an explicit official `base` or official `charId` supplies provenance. A matched skill kit
never supplies provenance. `assets` preserves each form's IDs; pack asset keys are rewritten with their records.
Modules (`statsBase`, `traitBase`, `talentsBase`), new garrisons and bonds remain outside this mapping.

### Mapping

Forge `behaviour: [{ switch, option? }]` maps to the four [rule switches](#rule-switches). Omitting `option`
declares that switch's default (WORKSHOP §1.22–§1.23); the declaration is retained in the content hash and conflicts
with a different option. Explicit null, non-string or unknown options remain invalid. A valid declaration
implies gameplay (`combat: true` is not required on input) and produces a content plugin even with no other data.
Unknown switches/options are skipped individually with a bilingual reason. [ASSUMED] repeated different options
keep the first and report the later one. This conversion does not import notices.

| Forge piece | Becomes | When it does not |
|---|---|---|
| `art.chars` avatar, avatarE2, portrait, portraitE2, illust | cosmetic `assets.chars` | any other portrait field has no overlay key |
| Spine on a character (`front` / `back`), an enemy or a token | the overlay's spine. The atlas sits next to the skel, same name; pages in that folder. `anims` is not copied. The import calls `skeletonClipData` — the same read as `node tools/plugin.mjs pack` — on the staged folder, for a dry run and for a write, and pack writes that clip data into `plugin.lock.json` before the strict check [ASSUMED] | skel or atlas missing, or a page outside that folder. Bone, slot, skin and vertex counts above the cap (4096; float arrays 8192; triangle indexes 16384) are rejected before the parser allocates [ASSUMED: above the measured maxima of 581 bones, 360 slots, 3 skins and 186 vertices, and below 2^24]. A skeleton that cannot be parsed is named and only that model is dropped |
| `art` of bonds, items, bands, skills, modules, ui, prof.sub; enemy `icon`; token `avatar` | the matching overlay container | `art.tokens.*.owner` is not an asset |
| `bondIcons`, `itemIcons` | `assets.bonds`, `assets.items` | a bond already named by `art.bonds` is not imported again from `bondIcons` |
| `voices` | `audio.voiceJp` [ASSUMED: Forge documents that table as the Japanese dub] | a slot outside `^[A-Za-z][A-Za-z0-9]{0,31}$`, or a file that is not `.mp3` / `.ogg` |
| `voiceLangs.cn` (and `zh`), `voiceLangs.ja` / `jp`, `voiceLangs.en`, `voiceLangs.ko` / `kr` | `audio.voice`, `audio.voiceJp`, `audio.voiceEn`, `audio.voiceKr` | any other dub: no table of that language (an own-language dub is per operator, `audio.voiceNative`, which Forge has no table for) |
| `skins[]` | that operator's own `skins` variants (§9): `assets.chars[charId].skins[<the outfit's id>]`, its pictures, its model and `name`. Once the cosmetic plugin is composed onto the manifest, `public/js/ui/skins.js availableSkins(charId)` lists that id (docs/SKINS.md); the player wears it with `room.skins` `{ [charId]: skinId }` from 干员调配 or the 自选 detail. An outfit added to an operator this installation already has is a change to that entry, so the cosmetic plugin's `permissions` carries `assets.override` (§9) | a skin without `charId`; an outfit whose `id` is not a skin key (or no `id`) — its art is folded onto that operator's one overlay and is not a picker row |
| `art.audio.bgm` of lobby, prep, combat, unite, boss; an unreferenced file whose basename is one of those | `audio.bgm` `{ loop }` | any other music key. `art.audio` is not a documented Forge table [ASSUMED] |
| `art.audio.bossBgm` | `audio.bossBgm` `{ loop, intro? }` | an id that is not an asset key, or a file that is not audio |
| `art.audio.sfx.ui`, `sfx.battle` | one audio file each | |
| `art.audio.sfx.units` | attack, hit, skill, die, born, and skills / attacks / hits by an index 0–99 | any other field or bucket (`ui`, `battle`, `units` only) |
| `overrides` of `"file:id"` plus a partial of an existing record | a content `data` patch. An array whose type already matches is one `set` of the whole array. `talents` and `talentsBase` are not replaced: Forge merges those by index, and this version says so. A chess override's `skill` and the `isDefault` entry of `skills[]` are one object (Forge DATA.md): when `skills[]` is present both are written from that entry; when it is absent the `skill` object is merged onto the official skill (plain objects merge, arrays replace) and written as `skill` and as the default `skills[]` entry [ASSUMED] | not listed in `overrides` (a silent replace is refused); a field whose type or path does not match. A chess record whose `skill` differs from that default entry is not imported; the rest of the pack is. A bond, garrison or bond-member id this installation does not have is named and left out of that list; a list that is then empty is not written. When the written chess `bonds` list drops an official bond, that chess id is removed from the bond's `members` and `visibleMembers`, and the report names those official ids; a bond that joins is added the same way. A garrison `bbStr.bond` or `bbStr.bond_id` token that is not a bond id is named and that field is not written (the list is not shortened); a string of known bond ids is still written. `backup`, `chessType` and `status` stay on the official record [ASSUMED] |
| `units.json`, a new operator | a compact record `char_x_<namespace>_…`, namespace taken from the content plugin id (`--out`'s basename when that product is primary). Skills come from the selected form when that form has a list, otherwise from the record. One default skill (`default` or `isDefault`). Each form's named talents and trait are copied (text, numbers, range) | no name, profession, branch, forms or skill; rarity outside 1–6; no bond that exists here. A 6★ declared in `operators` is `as: "diy"` (no shop piece; `chess.tier` is still the rarity, because the compact schema requires it). Below 6★ in that list, and a unit that is not declared there, is chess, unless a `chess.json` pair of the pack is its shop piece (then that pair is the record) [ASSUMED] |
| `chess.json`, a new `_a` / `_b` pair (`baseId`, `goldenId`, `isGolden`) | one compact record `char_x_<namespace>_<stem>` (the stem is the base id without `chess_` and `_a`): a shop piece, or `as: "diy"` when `isDiy` and 6★. The normal form is the `_a` record, the elite the `_b` record (stats, range, skills, trait, talents each). `tier`, `bonds`, `price` (normal/golden), `sellPrice` (when both are equal), `garrisonIds` (normal/golden, the `{ normal, golden }` form of §10), `identifier`, `shopSortId`, the identity and attack fields are kept. The unit is the `charId` when it is an official operator (`art.ref`) or a unit of the pack; with `charId` null, explicit `assets` IDs supply art without inferring a character. A pair with no bond at all gets the fallback bond 协防干员 (`economy.fallbackBondId`), as the studio's operator template does [ASSUMED] | no name, profession, branch, tier, skill or stats; a `chessId` that is not its key; two normal or two elite records; an unknown non-null `charId`, or no character and no explicit asset IDs; bonds that all do not exist here. `status`, the merge count, the chess type (always `PRESET`, its own stand-in), come from our economy, and a different value is named. Modules, potentials (`potDown`, `potMin` / `potBelow`), `statsBase` / `traitBase` / `talentsBase`, immunities, `rangeId` and module talents are named and dropped. Tags and existing/imported token references are retained; missing tokens are named. One record alone is copied into both forms [ASSUMED] |
| skill ids that are official skills of one operator (`data/chess.json` and `data/backups.json` skills → that operator) | the record keeps those ids and names the operator's kit, `kit: { ref }` (§10): its chess kit (`chess_char_…_a`) for a shop piece when the default skill is the same (the same tier first when there are two), its 自选 kit (`char_…`, `ops/op-*.js`, which authors every skill) for a 自选 record or when no chess kit fits. Talents and trait are copied, so the kit reads the record's numbers | a skill id that is not official (a partial match), skills of several operators or of one shared by several (`skcom_*`), a different default for a chess kit, or an operator with no kit of its own: the kit stays `"generic"`, and the report says which skills and why. 补位 stand-in kits are not bound [ASSUMED] |
| `enemies.json` with an official `base` or `special` that exists here | `enemy_x_<namespace>_…`, stats over that base | no such base: a kit is not invented |
| `kits/<id>.js` (top level, not `_…`), or the `.js` file a record's `kit` field names | one script plugin `kits-<id>` for the pack (`server/plugins/forgeKits.js`): its sim entry `sim/index.js` carries each kit and every `./` file of the pack it imports, one function scope per Forge file in dependency order, and calls `sp.kits.register(<the record's new charId>, <that kit>)` once per kit. Imports are rewritten by the table below. It requires the content plugin at its exact version. A kit for an official id the pack declares in `overrides` (`chess:<id>`, `units:<charId>`) registers that id, and the manifest lists it in `overrides` (§13). The record itself keeps `"generic"` (or its official kit) in the content plugin: without the script plugin it plays with that kit | the id is not an imported chess or operator record of this pack, nor a declared official override (token kits need a separate registration adapter even when their data imports); a second kit for the same record; `--no-scripts`. A file whose imports do not map, that fails `shared/plugins/scriptCheck.js` (the registry's own scan), that uses syntax the sandbox refuses (dynamic `import()`, `import.meta`, `async`, generators, `**`, `export *`, a `let` / `var` / destructuring export), that does not parse, whose default export is not a function, or whose graph is cyclic, over 64 files or over 1 MiB, is named with its reason and not written; so is every kit that imports it. `PLUGIN_FORGE_SCRIPT` |
| a skill script referenced any other way | kit `"generic"`. The file is named in the report and is not run | a JSON object that passes `validateSkillSpec` is kept as `kit.spec`. The importer does not translate scripts to DSL; authors can add DSL afterwards (§12) |
| new items, bonds, tokens, garrisons / traits, bands and effects | namespaced records described under “Forge gameplay records and local official operators” below | only supported behavior is mapped; all custom behavior gaps are named |
| new stages, waves, bosses, modes | — | no safe compact mapping. `variants` and `behaviour` are engine switches, not modes |
| a flat `{ msgid: string }` translation | a `lang` plugin, `files.ui` | `zh` is the source language and is not a language pack |
| `{ version: 1, lang, files }` | content i18n, only when every leaf replaces an existing string | a missing leaf would refuse the whole content set, so the file is skipped |
| notices (`announcement` or `announcements`, and `credits`) | `notices` on the primary product: the announcement's title is version, date and summary (80 characters) and its body is each section's name and items as lines (2000 characters); credits are their own notice, a url written as text [ASSUMED]. Text is kept out of hashed description/credits metadata. A pack whose only usable part is notices is one personal-scope cosmetic | unreadable or missing files. Both keys at once: only `announcement` is used. Extra notice keys are named and skipped |
| `license`, `authors` | copied when they are short strings | |
| `dependencies`, `conflicts` | `requires`, `conflicts` when the id is a plugin id. An omitted range is `*` [ASSUMED] | an id that cannot become a plugin id. A product does not require itself |
| `client.panels` `screen.game.hud` and `screen.game.aside` | a ui plugin, slot `hud.right`. A supported panel is the shim page; anything else is one HTML stub | a second stub for the same slot. A second supported panel is another ui plugin on that slot (the match already tabs them) |
| `client.theme.vars` | a cosmetic plugin's `theme.vars`. Allowlisted names are kept; every other name is listed as dropped (`PLUGIN_THEME_NAME`, `PLUGIN_THEME_VALUE`, `PLUGIN_THEME_URL`, past 64 `PLUGIN_THEME_LIMIT`). A pack whose only usable part is its theme is one personal-scope cosmetic. No stylesheet is injected | a name or a value the grammar refuses |
| `client.panels` `screen.game.hud` and `screen.game.aside` | a ui plugin, slot `hud.right`, one HTML stub | a second panel for the same slot |
| `client.panels` `screen.result.footer` | a ui plugin, slot `result.tab` | |
| a supported panel on `root.guide` that listens for `room.state` | a ui plugin, slot `room.panel` [ASSUMED: our room screen, not Forge's guide] | |
| any other supported panel whose suggested slot is one of the four | a ui plugin on that suggested slot [ASSUMED: not Forge's position] | |
| any other panel mount | manual adaptation report | `PLUGIN_FORGE_MOUNT`; panel name, Forge mount and suggested rewrite slot |
| a panel with `wraps`, or `readonly` / `readOnly: false` | — | it rewrites a component, so it is not read-only |
| the panel's script, when the static scan finds a mount and only the read-only surfaces the shim feeds, and the pack-relative `.js` / `.css` / `.json` closure stays within 256 KB a file, 1 MB and 64 files [ASSUMED] | copied. The entry page inlines the shim and a classic bundle. The original files sit in `ui/mod/` and are not loaded a second time. Import does not run the script | a bare or remote specifier, `fetch`, `net.send`, `pack.messages`, a host stylesheet with no panel surface, `documentElement` on the parent, an appearance provider. The stub stays, and the skip lists those surfaces (`PLUGIN_FORGE_PANEL_SCRIPT`) |
| `fx.silentPhases` | `assets.fx.silentPhases`: union with built-in phase names; only the generic phase flash is suppressed | invalid names or more than 128 entries; other `fx` fields are reported as skipped |
| `server`, `routes`, `assets` (`.spresources`), `forms`, other `fx`, `variants`, `behaviour`, `playtest`, `support`, `combat: true`, `layer` | — | engine replacement, protocol, server logic, or a switch this manifest has no field for. One reason each, in Chinese and in English |
| the panel's script | not copied. The stub answers welcome with ready, then slot and resize, and says the author must rewrite it to postMessage API v1 | `PLUGIN_FORGE_PANEL_SCRIPT` |
| `server`, `routes`, `assets` (`.spresources`), `forms`, `fx`, `variants`, `playtest`, `support`, standalone `combat: true`, `layer` | — | engine replacement, protocol, server logic, or a switch this manifest has no field for. One reason each, in Chinese and in English |
| any other `.js` `.mjs` `.cjs` `.ts` `.jsx` `.tsx` | not imported and not executed | `PLUGIN_FORGE_SCRIPT` |
| a file `pack.json` does not reference | — | named in the report, except a loose music file whose basename is a bgm track |

### Built-in language overlays

[ASSUMED] A manifest-2 `lang` plugin may overlay one shipped `public/i18n/<lang>.json`. Exactly one overlay is
accepted per built-in language, in sorted plugin-folder order. A later plugin overlay is `PLUGIN_DUPLICATE` and the
message names the plugin that won, not the built-in file. A collision with a pack folder, or with the built-in file
when no plugin overlay has won, still names that provider. Duplicate plugin ids keep their old refusal. `zh` remains the source language.
The index exposes one language choice with the built-in name/fallback metadata and an additional `files.uiOverlay`
URL. Supplied strings override; missing/empty strings and broken source placeholders retain built-in translations.
Optional game text uses `files.dataOverlay` and the existing per-record source checks over the built-in data.
Missing downloads fall back to built-in text [ASSUMED]; reload after installation changes, as before.

Scope is unchanged: `lang` plugins are installed globally, scope `personal`, and each browser chooses a language.
There is no room selection, gameplay hash input or simulation change. Forge flat UI i18n becomes this same lang plugin.
A language-only pack for an installed language no longer fails as a duplicate.

### Forge panel mounts and report codes

The three existing mappings remain. Suggested rewrites are [ASSUMED] author guidance, not automatic positional equivalence.

| Forge mount | Automatic slot | Suggested manual rewrite |
| --- | --- | --- |
| `root.overlays` | — | `hud.right` (in-game information; global overlay behavior must be redesigned) |
| `root.guide` | — | `stats.tab` (reference information) |
| `screen.game.aside` | `hud.right` | — |
| `screen.game.hud` | `hud.right` | — |
| `screen.game.overlay` | — | `hud.right` (move overlay information into the HUD) |
| `screen.game.shopCard` | — | `hud.right` (separate shop summary; no card wrapping) |
| `screen.game.bondStrip` | — | `hud.right` (separate bond summary) |
| `screen.result.footer` | `result.tab` | — |
| `screen.loadout.detail` | — | `room.panel` (separate pre-match information) |

`PLUGIN_FORGE_MOUNT` identifies unsupported mount adaptation. `PLUGIN_FORGE_PANEL_SCRIPT` independently identifies
an uncopied panel script, including when its mount failed, and may add `surfaces` (the names the scan found). A copied
panel does not raise that code. `PLUGIN_FORGE_SCRIPT` continues to describe other unmapped scripts/kits. No panel
script runs at import: a copied panel runs later, in the player's sandboxed iframe, where `connect-src` is `'none'`.
The shim (`shared/plugins/forgePanel.js`) answers `net.send`, `session.send`, `setPreload` and resource messages with
`{ available: false, reason: 'not available in this game' }`. It does not invent a content digest, a chess table or
an econ payload. `data.get` returns a clone only for `chess` or `assets` when the panel declared that table and the
page passed the data in; otherwise null. UI-only unsupported packs report **需要人工适配 / needs manual
adaptation**, with `needsManualAdaptation` and `manualPanels` in JSON, instead of “nothing importable.”

The receiver accepts a feed only when `event.source === parent`, before queuing or applying it. Opaque origins
still permit cross-window messaging ([HTML CrossOriginProperties](https://html.spec.whatwg.org/multipage/nav-history-apis.html#crossoriginproperties-(-o-)));
the static scan is a compatibility check, not the sender boundary. Repeated `ready` messages do nothing. Each entry
document gets one initial `net`; subsequent changed snapshots are deduplicated and throttled per frame at 1 Hz
[ASSUMED]. Initializing another frame cannot consume a pending update. Moving a frame starts a new document.

`welcome.cs` and `state.room.cs` carry only the real room `content.cs` (64 lower-case hex digits). The shim exposes
its first eight digits as `net.welcome().mods.digest` [ASSUMED], replacing or clearing it when the room changes;
unknown identity stays absent. Static `/shared/i18n.js` imports bind `t` (aliases and namespaces supported), as do
literal dynamic imports. Other static exports are rejected by name. Every unique JS, CSS and JSON file counts
toward the 64-file closure limit before traversal, including assets reached only through `styles`; `styles` must
name `.css` files. Duplicate paths count once [ASSUMED].

Missing activation inputs stay manual [ASSUMED conservative scan]: host URL access (`host-location`), desktop /
Android bridges (`desktop`), and controllers assigned on a frame global for the host to call (`host-controller`).
Thus demo `guest-strip`, `lan-panel` and `match-overlay` are not compatible copies. Expanded-room fields
`playerCapacity` / `seatCap` are `room.capacity`: this server has four fixed seats and no capacity setting.
`capacity-panel` therefore stays manual; its 8/12/16/20 choices and room-setting claim are not presented to players.

The iframe's own document gets `screen` and `result` on the document element and on `body` only for a `result.tab`
panel while a result payload is present, and `room-screen` only for a `room.panel` panel while seats are known.
It never gets `st`. [ASSUMED] Those classes are how a Forge panel decides it is on screen; they are not the game page.

When whole gameplay records are not written, the report is still `ok` if nothing else failed, and it says so up front.
The markdown heading `## 没有导入的玩法` comes before `## 导入了什么`. JSON adds `partial: true` and `dropped` counts for
operators (chess and units), bonds, bands, items, tokens, traits (a garrison table and a traits table), kits and panels,
and only when a count is above zero. A skeleton counts once as a dropped panel; a copied panel never counts.
Dropped server modules, host stylesheets, messages and other client declarations also set `partial: true` and
`needsManualAdaptation: true`, with bilingual `manualReasons` (`path`, `zh`, `en`, optional `surfaces`) in JSON.
Markdown starts with **部分导入 / Partial import** and **需要人工适配 / Needs manual adaptation**, with those reasons
before products. `ok` still means validation succeeded, including when a skeleton validates [ASSUMED].
A field-level note, a unit already covered by its chess pair and `--no-scripts` do not set `partial` on their own.
[ASSUMED] Effects are not a counted kind. A cosmetic
whose asked art, bond or item targets were all dropped says, in Chinese and in English, that it has nothing to apply to
(`cosmeticBare`); the files are still copied. Targets use the art namespace: dropped chess records map to `charId`,
items to their trap/icon keys, bonds to their own ids. A retained record sharing the art key keeps that target usable
[ASSUMED]. Dropped kits and panel titles are never art targets, so a panel named like a kept portrait leaves the
imported art list in place. A product that keeps a target, or that only carries audio, does not say that.

### Import and display polish (0.3.1, §34.27)

An unsupported `pack.json.assets` engine resource container (`.spresources`) sets both `partial` and
`needsManualAdaptation`, with a bilingual `manualReasons` entry, including when no plugin is produced. `ok` still
means the import/check completed successfully; it does not mean the engine container was converted.

[ASSUMED] When one import produces content and a cosmetic companion, the content manifest records the cosmetic id
and exact version in the existing `optional` map. This is a hint and load-order metadata; it never enables a personal
cosmetic. The room's plugin panel names installed, version-matching personal cosmetic companions of active gameplay
plugins while they are off in both the room and this player's personal selection (including automatic dependencies):
「外观在『…』（设置 → 外观插件）」. Missing or incompatible companion versions produce no hint.

Folder/CLI checks and the registry count embedded record `kit.dsl` as a `dsl` permission use, alongside operator
trait DSL and its official-record `data.patch` use (§34.26). Studio refuses a stale autofix that would remove one
of these consumed permissions. Manifest-only diagnostics are reconciled after the declared record JSON is read.
Rule-conflict toasts name both plugins and the rule switch in the player's language, falling back to plugin ids.
[ASSUMED] Imported `result.tab` pages scroll horizontally inside their frame when content is wider than the slot;
narrow panels retain their existing width. No slot or message API is added.

**Kit imports.** Production script plugins allow only self-contained entries (§13), so a Forge kit's imports are
rewritten to `sp:sdk@1` where the SDK exports the same helpers, and every other one refuses the file:

| Forge import | Becomes |
|---|---|
| `@kit/tier1.js` `{ name }`, a name of the SDK's `kit` (`num`, `talentBb`, `talentGrid`, `moduleBb`, `traitBb`, `moduleOn`, `up`, `cheb`, `isMainHit`, `byEnemyAttack`, `skillBusy`, `giveSp`, `onHitBy`, `onHitOn`, `onDamagedOn`, `enemiesInGrid`, `alliesInGridOf`, `enemyInRange`, `statBuff`, `toggleBuff`, `instantKind`, `skillRec`, `skillBbOf`, `batMod`) | `kit.<name>` of `sp:sdk@1` |
| `@sim/constants.js` `{ name }` | `constants.<name>` |
| `@sim/detmath.js` `{ name }` | `math.<name>` |
| `./x.js`, a file of the pack (`.js`, no `..`, `%`, query or `\`, resolved from the importing file) | that file's scope in the same entry; its exports are read once, after it ran (initialization-time bindings, as in the sandbox) |
| `@sim/dir.js`: `dirVec`, `offsetTile` | `dir` SDK geometry helpers; frozen arrays |
| `@sim/targeting.js`: `absoluteRangeKeys` | `targeting` SDK geometry helper; bounded grid, frozen keys |
| `@sim/targeting.js`: `sortEnemyTargets` | refused by name: mutates candidates and reads live battle/units; no pure SDK equivalent |
| `@kit/tier1.js` names outside that list, `@kit/tier2.js` … `tier6.js`, `@kit/summoner.js`, `@ops/…`, a bare name, an absolute path, `..`, a default or namespace import of an SDK module | refused: the file is named, and nothing of it is written |

**When the script plugin runs.** Only where the server owner set `SP_PLUGIN_SCRIPTS=sandbox` (SES compartments, §13
P3b), or a trusted mode with the lock pinned in `plugins/config.json` and every player's consent, and a room selects
it (the content plugin joins automatically). In sandbox mode its lock is valid as written, so rooms can select it at
once. The import report (`IMPORT-REPORT.md`), the plugin's README and the studio dialog say so. A kit that adds a buff in a
talent's `install` must pass `allowDead: true` (and `persist: true` for a permanent one): a unit is set up before it is
alive, and `addBuff` refuses a unit that is not alive unless the buff allows it — Forge's engine has the same rule.
The report names a kit that calls `addBuff` without `allowDead` (a text search, advice only); Forge's own
`kit-demo` example is one, so its +25% talent does not change ATK here.

**Profession aliases** [ASSUMED]: DEFENDER, HEAVY and GUARDIAN become TANK; VANGUARD becomes PIONEER; GUARD becomes
WARRIOR. A missing position is MELEE for tank, warrior and pioneer, and RANGED otherwise. A Forge form rank is
`phase/level/skillLevel/equipLevel`, compared as integers, or a single integer. The lowest becomes normal and the
highest becomes elite, and a single rank is copied into both. `"2/60/…"` is a higher rank than `"2/9/…"`. A
missing range grid becomes `[[0, 0]]`. Shop tier follows rarity when the operator is emitted as chess. A skill keeps
name, duration, spCost, initSp, maxChargeTime, increment, bb (numbers), bbStr, desc, descRaw, skillType, spType,
durationType, trigger and its range when their types match our data's values; `index` and `level` are derived; other
non-null fields (`rangeId`, `prefabId`, `overrideTokenKey`, an `iconId` that is not the skill id …) are named in the
report and dropped. Voice containers and skill icons are renamed with the
new char id and skill id. An imported file always gains one `files/` prefix, so `a.png` and `files/a.png` do not
collapse. A case-only name clash, or a file path that is a directory prefix of another, is `PLUGIN_FORGE_ZIP`.

**Errors** (`PLUGIN_FORGE_*`, this section's anchor): `PLUGIN_FORGE_INPUT` (not a pack), `PLUGIN_FORGE_ZIP` (unsafe
to unpack), `PLUGIN_FORGE_JSON` (parse, size, depth, a non-finite number or a number past the safe-integer range), `PLUGIN_FORGE_ID` (the id cannot become a plugin id),
`PLUGIN_FORGE_EXISTS` (the destination exists), `PLUGIN_FORGE_SCRIPT` (a script was not imported and was not run).

The version written into a product is the pack's version when it is a restricted semver with no build metadata,
otherwise `0.1.0` [ASSUMED]. `app` is `>=0.3.0 <0.4.0` and `api` is 1. A language-pack manifest omits `$schema`,
`app`, `api` and `permissions`.

## 17. The catalogue and installing by address (目录与安装)

A catalogue is a document someone else publishes. This project does not host the zips and does not run a market. The
format is `schemas/catalog.schema.json` and `shared/plugins/catalog.js`: `{ "catalog": 1, "name", "plugins": [ { "id",
"name", "version", "class", "description", "url", "sha256", "bytes", "homepage", "license", "authors", "app" } ] }`.
`url` is an https address of a zip. `sha256` is the SHA-256 of that zip. `docs/plugin-catalog.example.json` is an
example whose addresses do not exist.

`node tools/plugin.mjs install <zip path | https URL> [--sha256 <hex>] [--force]` installs into `plugins/<id>/`. A file
on this machine installs as it is, including a Windows drive (`C:/…`, `C:\…`) and a UNC path (`\\server\…`, `//server/…`).
An https address is accepted only with `--sha256`. The hash is checked on the bytes. The download stops at 200 MB
(`PLUGIN_LIMITS.pluginBytes`). One deadline covers the connection, every redirect and the body. A redirect is followed
only when the next address is still public https on port 443. A literal private, loopback, link-local or `.local`
address is refused before the request, and so is an address that resolves to one of those. The zip is extracted with
the same protections as any plugin zip (no path traversal, no symbolic link, no file-count or size bomb, no two paths
that differ only by case, no ZIP64 extra on the local header) into a temporary folder. `check` must pass (a warning
does not stop it) before the folder is renamed into `plugins/<id>/`. The same id is left untouched unless `--force`,
which moves the old folder to `plugins/_replaced/<id>-<time>/` and does not delete it. No file in the package is
imported or run.

`node tools/plugin.mjs catalog <file | https URL> [--json]` lists the entries and marks each one installed, updatable
or incompatible with this build (`app`, every class). A missing `app` is compatible. An empty `app` is not a valid
catalogue, and a present `app` this build cannot read is incompatible. Fetching the catalogue document does not
require a hash of the document. It is still public https on port 443 only, capped, and it does not follow a redirect
to a non-public address or off https. The same id twice is refused by `readCatalog` and by this repository's schema
validator (`uniqueItemProperties`). A stock JSON Schema editor that ignores that keyword will not see the duplicate.

The studio page 「从目录安装」 (`/studio/`) takes a catalogue address or a catalogue file the browser already has. The
browser posts the text. It does not download the zip and upload it. The server downloads, on this machine and the LAN,
with the studio key. The browser cannot name a path on the server's disk.

An operator may name extra download hosts in `plugins/config.json` `allowDownloadHosts` (a string array in the same
file as the room policy; `policy.js` ignores the key) or in `SP_PLUGIN_DOWNLOAD_ALLOW` (comma-separated). An entry is
an exact host, `host:port`, or `[ipv6]` / `[ipv6]:port`. There are no wildcards. The default is empty. A catalogue
document cannot add a host. A missing or broken list does not block a public download.

[ASSUMED] a zip download waits 60 seconds and a catalogue document 20 seconds. That one deadline covers the body, and
there are at most 5 redirects. Only port 443 unless the allowlist names the host. The allowlist names above are the
operator's. A leading `//` is a file path, not a protocol-relative URL. `2001::/32` and the whole `2002::/16` are
refused, as is every IPv4-mapped IPv6 address. The download does not pin a certificate beyond Node's default TLS
check. A catalogue document is at most 1 MB. Field limits are in `CATALOG_LIMITS`. A missing `app` is compatible; an
empty one is not. Whether an installed copy is older ignores a pre-release suffix. Case folding of a zip path is
Unicode `toLowerCase` of each segment. A class this build does not load may still be stored when the check passes;
it is not executed. `uniqueItemProperties` is a keyword of this repository's validator, not of stock JSON Schema.

## 18. Remaining limits

Implemented features are documented in §9–§17: cosmetics, data, room content sets, DSL, scripts, interface widgets,
the studio and trial bench, Forge import, and catalogue/address installs. The following remain unavailable:

- Plugin fonts are not applied. Theme variables of the allowlist are applied on this player's page only (§9.1).
- `allowIncompatible` does not bypass the content builder (§11).
- Additional mode-code hooks and plugin-specific `golden` / `simcheck` / balance-tool switches have not been added.
  A plugin declares interaction windows at the host's existing moments instead (`offers`, §10b); a window with a phase
  of its own, and a window whose pick carries plugin code, are not part of that part.
- Personal plugins refresh on the next catalogue fetch; file changes are not pushed to every player's preferences.
  UI recommendations are local to the host's browser until a shared room recommendation protocol exists (§14).
- The trial bench simulates a single battle, not prep economy or a complete PvP mode (§15). Forge import carries
  `kits/` only when their imports map to `sp:sdk@1`, and does not convert other scripts, server logic, summons or
  every record kind (§16). Sandbox/SDK restrictions are in §13 and PLUGIN-API.md.

## Tests

`test/plugins/manifest.test.js` (manifest 2 and 1, the problems and warnings, settings, permissions, files and limits,
the catalogue), `test/plugins/registry.test.js` (the scan by class, skipped folders, duplicate ids and languages,
links, the pack view and `/packs/index.json` unchanged, `/plugins/index.json`, a plugin dropped in, the tool, git and
the release zips), `test/plugins/identity.test.js` (SHA-256 vectors, Node and a bare realm agreeing, the composition,
the same input → the same `cs`, one changed byte → another, the served bytes, the wire fields), and still
`test/i18n-packs.test.js`. P1a: `test/plugins/visual.test.js` (the overlay, references — a missing one refused —,
permissions, the lock, the browser's composition — every plugin URL from the file table, references from its own
manifest, what does not fit dropped, a failed file left out —, the merge order and its warnings, `vs`, the browser's
check), `test/plugins/order.test.js`, `test/plugins/visualSet.test.js` (sets refused or resolved, `/vs/`, `/p/` — its
whitelist, traversal, dot files, links out of the folder and into it, a folder replaced by a link, immutable or not, a
rewrite with its old mtime, audio without its extension —, one changed byte → another `vs`, `/data/assets.json`
unchanged), `test/plugins/tool.test.js` (`pack`, `check`, the template), `test/lobby-plugins.test.js` (`room.setPlugins`:
the host, before the match, un-readying, the vanilla `cs`, refusals, the result replay, the count in `/healthz` and
`welcome`, the host told when a plugin changes on disk), `test/ui/plugins-client.test.js` (the cosmetic layers, the data
view, content.js — the catalogue only on a server with plugins, an interface image falling back, the personal set —,
the panel), `test/ui/plugins-audio.test.js` (a plugin sound without its extension, falling back),
`test/render/cosmetic-refresh.test.js` (views already drawn follow a changed manifest; a failed model or picture falls back),
`test/ui/stats.test.js` (the records' `vs`), `test/media-url.test.js`, `test/ui/buildGuard.test.js` (onHealth),
`test/diag.test.js` (the content line) and the browser test `test/ui/plugins.e2e.test.js` (`SP_E2E=1`: the host's plugin
shows on another player's page, a personal plugin on its own page only; a server without plugins is never asked for its
catalogue; a personal plugin switched during a match changes the piece already on the board). P4:
`test/plugins/ui.test.js` (message shape and rate, storage quota, slots, a ui manifest accepted or refused, the `/p/`
CSP, a ui plugin leaving `cs` alone) and `test/ui/ui-plugins.e2e.test.js` (`SP_E2E=1`: the example widget in its slot,
a battle event, a match intent rejected). P1c: `test/lobby-plugins.test.js` (a content plugin's set: served, checked,
played in its match host; requirements switched on, conflicts, incompatible plugins, another player, a running match,
un-readying, `room.setMode`, the `room.contentReady` gate, loadouts checked against the room's data, the policy file,
the concurrent limit), `test/match/plugin-host.test.js` (a whole match of AI seats in a worker, `SP_VERIFY=all` in a
worker, the watchdog, extreme test data in a child process, the worker limit), `test/ui/plugins-content.test.js` (the
bytes checked before decoding, a manifest refused, `data.js` switching, the runner's `cs` check, the 自选 list, the
statistics), `test/plugins/contentSets.test.js` (a set not built twice, the limit, what `/cs/` serves) and the browser
test `test/ui/plugins-content.e2e.test.js` (`SP_E2E=1`: two pages load and check a data
plugin's set, a battle on it, the result accepted; a page claiming another `cs` is no authority). The studio and the tools
(§15): `test/plugins/errors.test.js` (every code in the catalogue, both languages, the documents' anchors, the one-click
fixes, every finding of a set of broken plugins coded with its placeholders filled, the generated tables),
`test/plugins/schema.test.js` (the schemas and the checks agree on one fixture set; the templates are accepted),
`test/plugins/tool.test.js` (`new` for every template passes `check --strict` and `pack`, the plain words, `--json`,
`pack --zip`, `errors`), `test/studio/studio.test.js` (the gate, the confined files and limits, the API, the zip),
`test/studio/hotreload.test.js` (the watch; a single-player room and an author's room apply a change by themselves, during
a match too, any other host is told, the studio not opened keeps §9; the events) and the browser test
`test/ui/studio.e2e.test.js` (`SP_E2E=1`: a new plugin, an operator by its name, a PNG dropped and previewed in the game's
card, packed into a zip; a public address refused). The catalogue and install-by-address (§17): `test/plugins/catalog.test.js`
(the schema and `readCatalog` agree on one fixture set; duplicate ids that are not the same object, and an `app` that is
not a version range, are check-only), `test/plugins/install.test.js` (a local zip, a hash, a download cap, traversal, a
symbolic link, a file-count bomb, no overwrite, `--force` moves the old folder, a decoy script is not run),
`test/studio/catalog.test.js` (the studio gate, the list, the install) and `test/ui/studio-catalog.e2e.test.js`
(`SP_E2E=1`). The frozen API v1 table: `docs/PLUGIN-API.md`, `shared/plugins/surface.js`, `test/plugins/surface.test.js`. Forge import (§16): `test/plugins/forgeImport.test.js` (the
fixtures under `test/fixtures/forge/` — a skin, a numbers pack, a mixed pack — plus boss music and a ui sound:
`check --strict`, `pack`, a cosmetic resolve with no warnings, a content set with no problems, refused pieces named,
`--dry-run`, stable `--json`, a second import, a zip that slips, a symlink, an oversized entry, JSON nested past the
limit, a script that is not run, `Object.prototype` unchanged on the preview route and on `--dry-run`, a language
alias, a failed rename, form skills, `--out` as the record namespace, distinct `files/` paths, an array `set`,
renamed voices and skill icons, an installed dependency, a 6★ 自选 operator, a hard link, a raw zip over the cap,
and a stored entry that contains the ZIP64 bytes; and, written inline because `node --test` runs every `.js` under
`test/`: chess pairs as a shop piece and a 自选 piece with per-quality garrisons and the dropped fields named, a pack
unit covered by its pair, official kits bound for a 自选 unit and a shop pair and checked in a battle, partial and
ambiguous matches, the script plugin of `kits/` with its rewritten imports and carried `./` file, refused kits
(unmapped imports, the script check, sandbox syntax), `--no-scripts`, an official override kit, the bundler's own
refusals, and the imported kit's +25% ATK talent in a real battle through the SES preflight child and an SES Worker —
which needs a real `node_modules` inside the checkout, as every sandbox test), `test/studio/forge.test.js` (the gate,
a server path refused, preview writes nothing, import writes, a kit pack's script plugin and `noScripts`, a file list,
a path-escape name) and the browser test `test/ui/forge-import.e2e.test.js` (`SP_E2E=1`, including a read that starts
while a report is on screen and the no-scripts box; a sandbox that cannot open a browser leaves that file unrun).

### Forge gameplay records and local official operators (0.3.1)

New bonds, supported items, garrisons, effects and complete tokens become namespaced records. `traits.json` accepts
only a garrison-compatible record with an existing `effectKey`; the bounded custom acquire/sell-item actions map
to `SERVER_GAIN_EQUIP` while retaining `eventType`; custom trait keys are named and skipped. Bands still
need an official `base`/`effectRef`. Missing item effect records are built from the item's supported buffs [ASSUMED].
Exact data references, comma-separated blackboard ids, and exact string literals in carried kits follow the new ids.
The importer parses scripts only. The pure `@kit/tier2.js` `onDefaultSkill` predicate is inlined using our existing
loadout contract [ASSUMED]; other unsupported imports remain explicit refusals. Custom bond blackboards are metadata,
not executable behavior; the report names every unmapped key. For new operators' skill blackboards, a key absent
from the official tables that is not an interval, period or cost step retains any finite value within
`±PLUGIN_LIMITS.number` (±1e9) [ASSUMED], including `heal: 65` / `80`. Official keys, including keys whose official
maximum is zero, retain the 10×/64 cap; steps retain their caps and positive minimum. Trait/talent blackboards keep
the existing bounds. Out-of-bound values are omitted and named [ASSUMED], never silently clamped. Server composition
applies the same skill exception; shared validators and vanilla code bytes remain unchanged.

An official `char_<number>_<name>` absent from this installation's chess/backups requires local
`.cache/gamedata/excel/{character,skill,range}_table.json`. The importer calls `server/plugins/officialUnitBuilder.js`
`deriveOfficialUnit`, which shares the builder's interpolation, full-potential, skill, talent, range and combat
classification functions. It uses the economy's normal/elite training statuses; a pack's explicit overrides win
[ASSUMED]. No selected module is invented. Optional local activity/module tables provide trigger/subprofession data;
without them the builder's ordinary fallback applies [ASSUMED]. The report identifies the local source by a SHA-256
fingerprint of every table read. The explicit import first fetches missing tables as described in §16 above;
the synchronous planner/loader stays local-only. Still-missing tables or missing character/stats/range/skills skip that
operator with a reason. Derived fields are saved in the plugin; the receiving installation needs no official cache.
Scripts can then bind to the newly imported chess. Without an accepted kit, generic behavior is reported [ASSUMED].

Compatibility limits are per field, not an assurance that imported descriptions are implemented: Kazdel/Rhodes and
Ave Mujica's custom bond engines and unknown garrison keys require author-supplied DSL or sandbox adapters; Makoto's
pack does not contain its original battle kit; Duel's read-only rule documents do not define a playable mode here.


### Declarative operator traits (0.3.1, #671)

Content operator records may supply `trait: { desc, dsl, translations? }`, where `desc` is Chinese text and `dsl`
is an inline DSL object or a plugin-local JSON path. `text: { zh }` is also accepted. Translations map en/ja/ko/zh-TW
to text and use the existing checked garrison overlays. Normal/elite forms may override `trait` independently.
Alternatively `kit.dsl.trait: { desc, on, meta? }` separates mode traits from skill talents and global prep effects.
See [PLUGIN-DSL §10](PLUGIN-DSL.md#10-干员特质031671) for both #671 examples and exact bounds.

An existing official operator accepts a minimal `{ op: 1, charId, trait, forms?, overrides? }` record with
`data.add`, `data.patch`, `dsl` permissions. [ASSUMED] Traits add by default; record-level
`overrides: ["trait:<charId>"]` disables its official mode garrisons only. Other plugins' traits, combat talents,
class/module traits and skills remain. Removing the plugin rebuilds the original data and behavior.
`elementBurst` uses the existing sim event; element names are only neural (SANITY/1), erosion (WATER/2), burn
(FIRE/3), apoptosis (DARK/4), necrosis (legacy sim vocabulary). [ASSUMED] Boolean targetOnField/selfOnField
conditions require alive, visible, unremoved targets and deployed allies; these three conditions belong to elementBurst.
Omitting them imposes no field filter. `layers.bond` is required; `selfActive` means the holder's active own bonds, including equipment-granted bonds.
[ASSUMED] `maxPerBattle` and capped/selfActive amounts are literal integers 1–1000000; caps are per holder/action/bond,
survive redeploy and reset each battle. They are battle-only and do not extend other actions.
[ASSUMED] Fields with participating layer-granting traits and enabled gains run authoritatively on the server, even
with `SP_VERIFY=off`; client results cannot settle them. Normal/unite fields use sliced headless simulation; bosses
use the existing shared-pool server path. Cost: one full server simulation per affected field, alongside browser
playback. Fields without these traits or with gains disabled retain their existing path. Caps never prove earned layers
and no longer increase client allowances. Trait layers carry garrison provenance and their holder as source, enabling
the official front-tile amplification. [ASSUMED] Node caps bound base grants; amplification is extra, with the final
999-layer clamp unchanged. Burst cooldowns use the existing `1e-9` trigger tolerance. Stand-in battle traits follow the fighting body's charId [ASSUMED].

Operator prep events: gain, deploy, roundStart, buy, sell, merge, levelUp, battleResult. [ASSUMED] Gain runs once
for the acquired copy (including the normal copy completing a merge), never for the merge output or promotion;
DIY selection alone acquires nothing. Deploy is a successful hand/temp-to-board placement. Other hooks run once
per owned character, elite preferred; bench/temp count, and levelUp is shop level. [ASSUMED] Self-sale runs once
from the removed piece in its sold form, including its final copy; remaining copies of that character do not run again. Only that player's state is affected. `gainItem.count` defaults to 1, integer 1–64, with ordinary pool/storage/merge rules.
Acquisition still runs custom gain once [ASSUMED]. Separately, SERVER_GAIN discovery and forced dispatch expose
custom gain to Suzuran, her band and copied traits, with the existing forced-dispatch investor multiplier and no new
acquisition accounting. There is no author registry key or JavaScript.
Strict checking recognizes trait-consumed dsl/data.patch permissions; a stale unused-permission autofix cannot remove
them. Checking validates item and bond references (including conditions) against composed data. [ASSUMED] Required
dependencies resolve from sibling folders; missing dependencies fail checking. This data-only check never runs scripts
or their preflight.
Compiled trait metadata is host-owned: ordinary data patches cannot rewrite or erase it, even with a dependency.

Admission and runtime are app-owned extensions outside the vanilla hashed sim/shared tree; only participating data
sets pin the runtime bytes. Match hosts, bot rehearsals, studio trials and the browser loader install the same adapter.
Workers still cannot fetch: the page verifies the runtime bytes before sending content. The standalone battle console
does not replay preparation; use room test grants for gain effects. Forge's existing custom JavaScript handlers are
not inferred from effect names or prose: this API does not automatically translate those handlers.
