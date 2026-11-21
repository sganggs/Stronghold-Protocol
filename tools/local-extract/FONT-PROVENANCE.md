# FONT-PROVENANCE — autochess local font bytes (internal only)

> Scope: `tools/local-extract/fonts.py`, the font job of `extract.py` (an optional local-extract group that a full
> extraction attempts since §37.240, and `--only font` on its own), and the `fonts` group it writes into
> `data/local-assets.json`. This page is provenance, not a licence declaration for redistribution.

## What ships and what does not

- **Git: never.** The files land under `public/assets/local/fonts/` (ignored by `/public/assets` in `.gitignore`);
  `data/local-assets.json` is ignored too. No font binary and no other extracted game file is committed.
- **Release packages: never (the current approach, below).** `tools/package.mjs` holds the folder back:
  - the full zip's `artPlan` collects every other file under `public/assets/local/` but never a file under
    `public/assets/local/fonts/` (`FONT_ART_PREFIX`; the summary's `held back:` line counts them as `fontHeld`), and the
    listed-file check reads the local manifest through `withoutHeldFonts`, so a face is neither shipped nor reported
    missing;
  - the update zip is the full stage's diff (`buildUpdate`), so it carries no face either, and it never lists a face in
    `UPDATE.json.removed` (`p.fontHeld` plus the `FONT_ART_PREFIX` check): a base that shipped one, or a host that ran
    `--only font`, keeps its copy;
  - the asset pack's plan (`assetPackPlan` → `withoutHeldFonts` → `public/js/assetPack.js planFromManifests`) drops the
    `fonts` group before the importer's plan is taken: the pack holds neither the files nor that group;
  - the stage's copy of `data/local-assets.json` drops `groups.fonts` outright (`dropStagedFonts`, the same
    group-dropping rule as `holdBackStagedThemes`): `fonts` is an optional local-extract group (§37.240), so its absence
    is not a stale extraction, and a host built from a package serves no local `@font-face`, the canvas shop draws
    with the system font stack, and setup does not report the extraction as incomplete.
- Local extraction: a full extract (`extract.py` without `--only`) **attempts** these faces — it runs the font job, but
  a missing install's `Arknights_Data`, a face whose bytes fail the pinned SHA-256 or no listed face at all only logs a
  skip / warning and the run still exits 0 once it extracted anything else (§37.240: `fonts` is optional like
  `ui/cursor`). `--only font` (also `--only fonts`, `--only font/<face>`) runs that job alone and exits non-zero only
  when it neither wrote nor kept any face. Both paths still write `public/assets/local/fonts/` and this machine's
  `data/local-assets.json` `fonts` group, and the runtime on that machine still reads it (`themeFonts`). Only the
  package copies are trimmed; the client runtime did not change.
- The other local-client extractions under `public/assets/local/` (themes, scenes, meshes) are different: they DO ship
  when the packaging machine extracted them (可露希尔 is held to its own importable pack). This page only records the
  font part; see [DEPLOY.md](../../docs/DEPLOY.md) and [ASSETS.md](../../docs/ASSETS.md).

**Consequence.** "No font binaries in git" and "the fonts are not distributed" still agree: a release zip built from a
checkout that ran the extraction carries no font binary and no `fonts` group, and a host of such a package falls
back to the system faces.

## Current approach

**Fonts are not published.** No package — full, update, asset or theme — carries `public/assets/local/fonts/` or the
`fonts` group of the shipped `data/local-assets.json`, and `THIRD-PARTY-NOTICES.md` gets no entry for these faces: a
package that does not ship them is not a redistribution. The faces are extracted only on the machine that runs the game
client (a full extraction attempts them, §37.240; `--only font` does it alone), and a host without them falls back to
the system fonts, as [THEMES.md](../../docs/THEMES.md) and [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) record. The
pinned bytes and the licence note below remain the provenance of that extraction; they are no longer inputs to a
packaging decision.

This document does not edit `THIRD-PARTY-NOTICES.md`. That file lists the downloaded `public/fonts/` faces and the
Google-Fonts-loaded ones; no locally extracted face is a package input.

## Pinned bytes

| Font | Source file | Font object | Bytes | SHA-256 | Local index |
|---|---|---|---:|---|---|
| `NotoSansHans-Medium` | `Arknights_Data/sharedassets1.assets` | path_id `360`, `m_Name=NotoSansHans-Medium` | 8,389,940 | `25033438cfa41f1873d4902b8555956557b765117756bcef96406e023e49578c` | `/assets/local/fonts/NotoSansHans-Medium.ttf` |
| `SourceHanSansCN-Heavy` | `Arknights_Data/sharedassets3.assets` | path_id `94`, `m_Name=SourceHanSansCN-Heavy` | 2,566,652 | `47e67e10ae78bf377b3791a3cde21af237069f263113c8376f5c410cea044288` | `/assets/local/fonts/SourceHanSansCN-Heavy.otf` |
| `SourceHanSansCN-Bold` | `Arknights_Data/StreamingAssets/AB/Windows/anon/efde504013a78a96671e2f4bb736ac48.bin` → internal `premain/arts/ui/common/fonts/sourcehansanscn-bold.ab` | path_id `-4708693146538353618`, `m_Name=SourceHanSansCN-Bold` | 8,608,184 | `97e5eff6dd208ccb814726458c8c7ab4b59327c62b9ee8df3440e7e835209ab9` | `/assets/local/fonts/SourceHanSansCN-Bold.otf` |

The Bold carrier is an **anon `.bin`**, not a `.ab`: `AbFontConfig` registers
`SourceHanSansCN-Bold → Arts/UI/Common/Fonts/SourceHanSansCN-Bold.otf`, whose runtime AssetBundle name is
`premain/arts/ui/common/fonts/sourcehansanscn-bold.ab`. `fonts.py` reads it from that registered carrier instead of a
blind Font-name scan run over every bundle.

**Licence.** The three faces' `name` tables carry the Apache License 2.0 text in nameID 13 and the
`http://www.apache.org/licenses/LICENSE-2.0.html` URL in nameID 14 (not an OFL notice). The licence claim therefore
comes from the extracted bytes themselves; re-read it before relying on it for anything beyond this local extraction.

**Naming.** All three files are CFF-flavoured sfnt (`OTTO` magic), including the one named `.ttf`; the names are the
client's Font asset names, kept for the manifest. `public/js/ui/prefab/shopDocs.js` derives the `@font-face` `format()`
hint from the extension (`.ttf` → `truetype`, otherwise `opentype`), so `NotoSansHans-Medium` is declared `truetype`
although its bytes are CFF. [ASSUMED] Every target browser parses the face by its bytes and not by that hint; this was
not re-checked in a browser for this page.

The old `SourceHanSansCN-Bold.ttf` in the same directory has the same bytes and SHA-256 as the `.otf` (`OTTO`); it is the
legacy name of the same extraction, is left in place, is never overwritten or deleted, and the manifest lists the
`.otf` only.

### Other font files in the same directory

`public/assets/local/fonts/` also holds `Novecentowide-Normal.otf`, `Novecentowide-Medium.otf` and
`Novecentowide-Bold.otf`. `fonts.py` does not write or pin them, and no tool in `tools/local-extract/` writes them now;
this checkout's `data/local-assets.json` lists Normal and Medium (Bold is unlisted). [ASSUMED] Their origin is therefore
not established by this repository. Their `name` tables refer to an EULA (nameID 13) rather than Apache-2.0. They are
covered by the current approach above: `public/assets/local/fonts/` is in no package, so no package distributes them either.

## Output / what is not done

- Output: `public/assets/local/fonts/<name>.<ttf|otf>` and, when `--manifest` is given, the `fonts` group of
  `data/local-assets.json` with `path`, `bytes`, `sha256`, `family`, `weight` and `kind: Font`.
- Not touched: `public/fonts/`, `public/fonts/fonts.css`, `THIRD-PARTY-NOTICES.md`, and the Bender / Novecento faces
  `tools/fetch-assets.mjs` downloads into `public/fonts/`.
- A source whose bytes differ from the pinned size / SHA-256 is reported and not written; a local target that differs
  from the pinned value is reported and **not overwritten**; a missing source is `skip font …` for that face only, and the
  consumer falls back. In a full extract such a skip never fails the run; `--only font` alone exits non-zero when it
  neither wrote nor kept any face.
- `--only font` writes only this group. A full extract keeps an earlier `fonts` group (`extract.py previous_groups`), so
  running the extractor again does not drop the faces. `--only font` accepts the `fonts` prefix as well — `--only font`,
  `--only fonts` and `--only font/<face>` select the same job.

## Command

```powershell
.venv-extract\Scripts\python.exe tools\local-extract\extract.py `
  --game "<install>" --only font `
  --out public\assets\local --manifest data\local-assets.json
```

`--game` must point at (or resolve to) the installation's `Arknights_Data` for the job to read the Font assets: the Font
assets are not in the temporary hot-update AssetBundle root `extract.py` uses for the other jobs, so `main()` resolves
the install before entering it. Without an `Arknights_Data` directory the run logs `skip fonts: no Arknights_Data
directory …` and the local fallback stays active; a full extract still exits 0, while `--only font` alone exits 1 when
nothing was written or kept.

## Consumer contract

- The canvas shop (`public/js/ui/prefab/shopDocs.js`) installs one `@font-face` sheet from the manifest's `fonts` group
  and waits only for the families the theme documents actually draw (`loadDocumentFonts`), with `font-display: swap`.
  A family or URL that could end the CSS declaration (quote, backslash, semicolon, braces, control character) or a
  non-same-origin URL is refused; the page's `font-src` is `'self' https://fonts.gstatic.com`.
- A missing or failed face must fall back to the existing font stack. `document.fonts.load` rejections are caught; they
  never throw, never gate the shop and never block the theme. The sheet is removed when the shop host is disposed
  (`uninstallThemeFontFaces`).
- The family keys are the official Font asset names: `SourceHanSansCN-Bold`, `SourceHanSansCN-Heavy`,
  `NotoSansHans-Medium`.
- A host built from a release package serves no `fonts` group at all (`dropStagedFonts`), so `themeFonts` installs no
  sheet and the shop draws with the existing stack; nothing else in the consumer changes.

## Verification (this checkout)

- The three files under `public/assets/local/fonts/` hash to the pinned size and SHA-256 above (`Get-FileHash`, SHA-256).
- All three are sfnt with `OTTO` magic; the legacy `.ttf` of Bold has the same SHA-256 as its `.otf`.
- The pinned values are enforced by code, not only recorded: `fonts.export_fonts` compares size and SHA-256 before
  writing and never overwrites a conflict, and `test/tools/local-extract-fonts.test.js` covers write / keep / conflict /
  missing-source / full-extract retention / the optional-group exit 0 / `--only font`'s exit code / the `Arknights_Data`
  lookup.
- The consumer side is `test/ui/shop-fonts.test.js` (escaping, one sheet, per-family loading, removal) and
  `test/ui/shop-docs.test.js` (`themeFonts` reads the manifest, no hard-coded font path).
- The package side is `test/package.test.js`: the full plan plans no file under `public/assets/local/fonts/` and lists
  it as held, the staged `data/local-assets.json` loses `groups.fonts` while its other groups stay, and the asset pack's
  plan holds no face.
