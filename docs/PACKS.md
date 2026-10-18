# PACKS.md — content packs

> **Since 0.3.0 the general mechanism is the plugin system: [PLUGINS.md](PLUGINS.md)** (DESIGN §32). A content pack is
> its manifest 1, the language pack its class `lang`, and the planned types `assets` / `data` became the plugin classes
> `cosmetic` / `content` (`plugins/<id>/plugin.json`, manifest 2). Language packs work exactly as described below.

A **content pack** is add-on content a server picks up from a folder: a manifest plus its files. The owner's decision of
2026-10-07 made the language pack the first type of one general mechanism, so that later resource packs (art, audio,
fonts) and server-side data packs reuse the same manifest, registry and index instead of each inventing its own. In
0.2.0 one type loads, **`lang`** (a language: docs/I18N.md "Adding a language"); `assets` and `data` were planned and
are now plugin classes (PLUGINS.md).

| File | Role |
|---|---|
| `shared/packs.js` | the language-pack index (browser, server and tools); forwards the manifest helpers |
| `shared/plugins/manifest.js` | the format: manifest 1 (this file's) and 2, the pack types (`PACK_TYPES`) and plugin classes, app version ranges |
| `shared/i18nPacks.js` | the `lang` type: language codes, the language fields, the fallback chain, the script family |
| `server/plugins/registry.js` | the registry: discovery, validation, the index, which pack files may be served (`server/packs.js` re-exports it) |
| `server/http/static.js` | `GET /packs/index.json` (the live index) and `GET /packs/<id>/<file>` |
| `public/js/ui/lang.js` | the client of the `lang` entries: the language menu and the loader |
| `tools/packs.mjs` | `list`, `index` (the index file for a static host), `check` |
| `tools/package.mjs` | ships the committed packs and writes `packs/index.json` into the release zips |

## 1. Layouts

Two layouts, read by the same registry and listed alike:

```
packs/<id>/pack.json + its files      a folder pack — any type; the manifest names its files
public/i18n/<code>.json               a single-file language pack — its manifest is the file's `_meta` block
data/i18n/<code>.json                   (+ its game texts, when present)
```

The single file is the quickest way for a translator (one file, the format English has always had, and how English
ships); the folder is the layout every pack type shares — a pack distributed as one folder with its own readme and
licence. A language can come either way — or as a lang plugin, `plugins/<id>/plugin.json` with `"manifest": 2,
"class": "lang"` and the same fields (PLUGINS.md §7); the menu does not tell them apart.

The id of a folder pack is its folder name; the id of a single-file language pack is its language code. Ids are
letters, digits, `.`, `_` and `-` (at most 64), unique across types and without regard to case (Windows and macOS
would see one folder).

## 2. The manifest

`packs/<id>/pack.json`, or the `_meta` block of `public/i18n/<code>.json` (the same fields):

```json
{
  "type": "lang",
  "lang": "ja",
  "name": "日本語",
  "englishName": "Japanese",
  "version": "1.0.0",
  "app": ">=0.2.0",
  "authors": ["…"],
  "credits": "…",
  "license": "CC-BY-4.0",
  "fallback": ["en"],
  "files": { "ui": "ui.json", "data": "data.json" }
}
```

| Field | Meaning |
|---|---|
| `id` | optional: the folder or file name decides; a manifest that names another id gets a warning |
| `type` | `lang` (a single-file language pack may leave it out); planned: `assets`, `data` |
| `version` | the pack's own version |
| `app` | the app versions it is made for, a range: `>=0.2.0`, `>=0.2.0 <0.3.0`, `0.2.x`, `^0.2.0`, `~0.2.1`, `*`, alternatives with `||`. A pre-release (0.2.0-dev) counts as its release. Outside the range a language pack still loads — what it lacks falls back — and is flagged `compatible: false` (the server log, `tools/packs.mjs list`); a later type decides what an incompatible pack means for it |
| `name`, `englishName` | the name in its own language (a language pack: the language's own name, shown in the menu) and in English (the menu's tooltip) |
| `authors`, `credits`, `license` | who made it; free text (`license`: an SPDX id or text) |
| `files` | a folder pack: role → path inside the folder. Each type lists its roles and their extensions (`lang`: `ui` required, `data` optional, both `.json`) |
| the type's fields | `lang`: `lang`, `base`, `fallback`, `complete`, `machineTranslated`, `numberUnits` (docs/I18N.md) |
| `machineTranslated` | `lang`, optional: `true` when the pack's UI strings come from a machine (a translation, or a conversion such as the Traditional Chinese pack's). The index entry carries it (only when true, like `complete`) and the client shows a note under the language switch in 设置 while that language is in use (`public/js/ui/lang.js` `machineTranslationNote`). A value other than `true` / `false` is a warning and reads as false |

A **problem** keeps a pack from loading (unknown type, no `lang`, a file missing or outside the folder, broken JSON, an
id or a language already taken (except one manifest-2 plugin overlay per built-in language; [PLUGINS §16](PLUGINS.md#16-forge-import)) — the language folders' files come first, then the folders by id); a **warning** does
not (an id that differs, an app range this version is outside of, an unknown file role). Both are printed when the
server starts or notices a change, and by `node tools/packs.mjs list`.

## 3. Discovery and the index

The server's registry (`server/plugins/registry.js`) scans `public/i18n/`, `data/i18n/`, `packs/` (and `plugins/`) when it starts and again
whenever something there changes: on a request for the index or a pack file it compares the names, sizes and times of
the files it reads (at most once a second, a few `stat` calls) and scans again if they differ. A pack dropped into a
folder shows on the next page load — no restart, no build step; a removed one leaves (a player whose stored language is
gone gets Chinese).

`GET /packs/index.json` (never cached) answers the packs of supported types:

```json
{ "version": 1, "app": "0.2.0", "packs": [
  { "id": "en", "type": "lang", "name": "English", "englishName": "English", "version": "0.2.0", "app": ">=0.2.0",
    "compatible": true, "authors": ["…"], "lang": "en", "fallback": [], "complete": true, "strings": 1017,
    "files": { "ui": "/i18n/en.json", "data": "/data/i18n/en.json" } } ] }
```

`files` holds URLs on this server, so a client never builds a path itself. A client reads the entries of its type
(`readPackIndex(json, 'lang')`: an entry of another type, with a bad id or a URL that is not a path on this server is
dropped).

**A static host** cannot list folders: `node tools/packs.mjs index` writes the same body to `packs/index.json`
(git-ignored), and `tools/package.mjs` writes it into the release zips. The live server answers `/packs/index.json`
itself and ignores that file. Serving the game from plain files needs the server's URL layout: `public/` at `/`,
`data/` at `/data/`, `shared/` at `/shared/`, `server/sim/` at `/sim/` and `packs/` at `/packs/` (the game itself still
needs the Node server for its rooms; DEPLOY.md).

**What is served.** `GET /packs/<id>/<file>` answers only a file that the manifest of a loaded folder pack names under a
role of its type, with that role's extension, inside the folder once links are resolved — `pack.json`, a readme, an
HTML or script file in the folder are never served; a pack of a planned type serves nothing. A single-file language
pack's files are the language folders' own (`/i18n/<code>.json`, `/data/i18n/<code>.json`).

## 4. The types

| Type | Status | Where it applies | Loader |
|---|---|---|---|
| `lang` | supported (0.2.0) | the client: UI strings, game texts | `public/js/ui/lang.js` (the menu, the strings: `shared/i18n.js`; the game texts: `public/js/data.js`) |
| `assets` | planned → the plugin class `cosmetic` (PLUGINS.md §9, loaded since 0.3.0) | the client: art, audio, font replacements | — |
| `data` | planned → the plugin class `content` (PLUGINS.md) | the server: data patches | — |

A pack of a planned type is parsed and listed as not supported ("type "assets" is planned …, not loaded by this
version — its successor is a cosmetic plugin"); it is never served and never changes anything.

### Adding a pack type

Since 0.3.0 a new kind of add-on is a plugin class (`shared/plugins/manifest.js` `PLUGIN_CLASSES`, PLUGINS.md), not a
pack type. The steps below are how 0.2.0 planned it; the principles after them still hold.

1. **The type** — its entry in `PACK_TYPES` (`shared/plugins/manifest.js`, re-exported by `shared/packs.js`): `status`, `summary`, `live` (whether a running server
   may take changes without a restart) and `files` (the roles a folder pack names, with the extensions that may be
   served for each). Its own manifest fields get a normalizer beside `langFields` and a branch in `normalizeManifest`;
   its index fields a branch in `packIndexEntry`.
2. **The loader** — reads the registry by type: `createPackRegistry(…).list('assets')` on the server, or the index
   entries of the type in the browser (`readPackIndex(json, 'assets')`), the way `ui/lang.js` reads `lang`. A
   server-side type (`data`) loads once at start (`live: false`): the simulation's code and data are fixed for the life
   of the process, and a battle must run the same data on the server and in every browser.
3. **The checks** — what `tools/packs.mjs check` and the tests verify for the type (a data pack: the same validation
   the data builder applies; a resource pack: the files exist and are of the allowed kinds), and its documentation
   here.

Things later types must keep (the maintainers' study of mods, 2026-10-07):

- **Server-side only for gameplay.** A data pack is installed on the server, so every player of a room uses the same
  content and the server can still check or recompute a battle. A player never installs gameplay content of their own.
- **A content hash in the handshake** before data packs ship (`welcome`, `/healthz`, the BattleSpec), so a client and
  a server can tell they run the same content, and a "modded" mark in the UI and in bug reports. Done in 0.3.0's first
  step: the content hash `cs` (PLUGINS.md §6, DESIGN §8.4).
- **No third-party code.** The manifest and its files are data (JSON, images, audio, fonts); a pack type that runs code
  is a separate decision of the owner's.
- **The golden results stay on the original content**; a pack never changes them.

## 5. Tools

```
node tools/packs.mjs list [--json]          the packs by type, what was skipped and why, the warnings
node tools/packs.mjs index [--out <file>]   write packs/index.json (the static index)
node tools/packs.mjs check [--strict]       list; --strict exits 1 when a pack is skipped or warned about
node tools/i18n.mjs template <code>         a new language pack (docs/I18N.md)
node tools/i18n.mjs check <code> | --all    a language pack's strings: coverage, placeholders
```

`--root <dir>` points `tools/packs.mjs` at another checkout or an unpacked release. The plugins have their own tool,
`node tools/plugin.mjs list | check` (PLUGINS.md §8).

## 6. Shipping

`tools/package.mjs` ships the committed packs (`public/i18n/`, `data/i18n/`, `packs/` — tracked files only: a pack
installed on this machine and not committed stays out) and writes `packs/index.json` into the stage from the packs
that ship. `test/package.test.js` checks both layouts and that a local pack stays out.

## Tests

`test/i18n-packs.test.js` (discovery of both layouts, broken / planned / duplicate packs, a pack dropped in or removed
while the server runs, the file allowlist, the manifest and app ranges, the `machineTranslated` mark from the manifest
to the 设置 note, the fallback chain, placeholders, plurals,
the per-text game-text fallback, the client loader and menu, the tools, build-i18n `--lang` / `--dict`),
`test/package.test.js`, `test/ui/i18n.e2e.test.js`
(`SP_E2E=1`: a pack file and a pack folder dropped in while the server runs show in the menu and switch; the shipped
packs with their UI strings and the 设置 note of a machine-translated one).
