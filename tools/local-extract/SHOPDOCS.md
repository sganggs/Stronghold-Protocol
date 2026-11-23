# Shop/card documents of a theme (recovered 0.4.0 producer)

Scope: the producer that writes `themes/<id>/card.json` and `themes/<id>/shop.json` beside the theme pack
(`prefabs.json` / `theme.json` / `layout.json` / sprites / voice / spine), the `--only shopdocs` job in
[extract.py](extract.py) that runs it, and its provenance. The produced art is local setup data:
`public/assets/local/` and `data/local-assets.json` are git-ignored and must never be committed.

## Source

- The contributor's prototype branch `feat/autochess-card-webgl` (archived commits `0157ba29` / `b6d29a05`);
  these commits are not in this repository's history. The producer was recovered from `0157ba29`; `b6d29a05`
  is the one recorded as producing an exact `card.json`.
- The files are the producer's; they carry the portability fixes, the shader-page removal and the review fixes
  listed under "Known non-reproducible points".

## Where the code lives

The producer modules sit flat in `tools/local-extract/`, beside the current extractor, and import each other
normally (`import autochess_themes`, `import ui_components`, `import aklz4`). There is one
`autochess_themes.py`; `--only theme` and `--only shopdocs` differ only by the `shopdocs` flag. The final tree has
no `legacy/` directory; this branch's earlier commits carried one (see "Fold equivalence").

| Output | Code |
|---|---|
| `themes/<id>/prefabs.json` | `autochess_themes.py` (a `--only theme` run also writes it) |
| `themes/<id>/card.json` | `card_prefab.py`, `card_shader.py`, `unity_deps.py` |
| `themes/<id>/shop.json` | `shop_prefab.py` |
| added `pathID` / particle / emission / renderer fields | `path_ids.py`, `theme_particles.py` (through `theme_particles_impl.py`) |
| the `mask` records and the other fields of the base documents | `autochess_themes.py`, `card_prefab.py` / `ui_components.py` (neither enrichment step writes `mask`) |
| group entries the producer leaves unlisted | `extract.py` `list_theme_files` (skips `.md`, dot-named path segments and `_particles.json`) |

`extract.py --only shopdocs [--only shopdocs/<id>]` calls
`autochess_themes.export_themes(..., shopdocs=True)` directly. That path builds the CAB index
(`unity_deps.index_bundles`, cached under `.cache/`) that `card.json` needs for cross-file names, writes the base
documents, and then runs the two content enrichments in order: shop base → `theme_particles` → `path_ids`. Each
enrichment only warns when it fails, so a produced `card.json` or `shop.json` can lack its fields and the base
document is still written. `theme_particles` writes `_particles.json` and `.particle-backup/` while it works and
removes both on success, on an exception and on `SystemExit`, so a failed step leaves no intermediate for the
listing below. After the producer, `extract.py` runs `list_theme_files(..., shopdocs=True)`: it registers the files
the producer wrote without listing them (the external plates `sprites/ext_cost_free.webp`, the material textures
`sprites/tex_*.webp`), never a `shaders/*.md`, a dot-named path or `_particles.json`, and it then names every theme
whose three documents are not all registered:
`shopdocs: themes/<id> lacks card.json, shop.json (the canvas shop needs prefabs.json + card.json + shop.json; the
theme pack alone is not enough)`. That is a document set the canvas shop cannot mount, but still a successful
extraction: the exit code stays warn-only.

`--only theme` keeps `shopdocs` off: no CAB index, no card / shop document, and its group is the theme pack only
(`themes/summary.json` is a sibling dump, not part of the group). Its `list_theme_files(..., shopdocs=False)` also
leaves a `card.json` / `shop.json` that an earlier `--only shopdocs` run left in the same directory out of the group,
so a theme pack written by a theme-only run does not carry a stale pair.

`card_shader.py` still builds the shader records `card.json` carries (`materials` → `shaders`), but the porting page
is gone: `card_shader.docs_markdown` was deleted with the page writer, and no `shaders/*.md` is written into the theme
group or listed (a stale copy from an older extraction is not registered either). The records stay in `card.json` as
provenance / diagnostic data: the client reads each material record (`public/js/ui/shop/prefab.js`
`documentMaterials`), and no code reads `card.shaders`.

The audit-only `shop_compat.py` (pinned schema normalizer for an archived `shop.json`) and the standalone
`export_theme_data.py` runner were deleted with the `legacy/` folder: neither has a caller in the final tree. Their
record and limits are kept here.

## Run

The command works on a scratch root (nothing of the repository is written):

```powershell
$py = '.venv-extract\Scripts\python.exe'
$game = '<install>\Arknights'
$data = "$game\Arknights_Data"

& $py tools/local-extract/extract.py --game $game --only shopdocs `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows" `
  --out '<scratch>\local' --manifest '<scratch>\local-assets.json'
```

The run prints the documents it registered, for example (the two themes that carry only `prefabs.json` /
`card.json` name the missing `shop.json`):

```
shopdocs: themes/ac_s_closur/prefabs.json
shopdocs: themes/ac_s_closur/card.json
shopdocs: themes/ac_s_closur/shop.json
shopdocs: themes/ac_n_iron lacks shop.json (the canvas shop needs prefabs.json + card.json + shop.json; the theme pack alone is not enough)
```

`--only shopdocs` is opt-in: a plain extraction writes no theme group at all. To put the documents into a real
local extraction, run the same command into `--out public/assets/local --manifest data/local-assets.json`, then
rebuild a theme pack with `node tools/package.mjs --theme-packs` ([docs/THEMES.md](../../docs/THEMES.md)). A theme
group extracted before this job — and a 可露希尔 pack built from it — has no `card.json` / `shop.json`, so the canvas
shop does not mount.

## Recorded extraction (not a product target)

The local extract this working tree holds (git-ignored), measured at HEAD `20474712` (2026-11-23) under
`public/assets/local/themes/ac_s_closur/`:

| File | Bytes | SHA-256 |
|---|---:|---|
| `card.json` | 178,169 | `e2d09a7725d38aeaad3f931b1a14e810f8770d4c37a3b8f6b985cd17b673d903` |
| `shop.json` | 363,223 | `416be570dd2b7fbe6aef4fe4ea8f0ef421d33f02ee126271752f9ec7378edf50` |
| `prefabs.json` | 674,305 | `1bfed1f3c5e7d3d3f10efcef02c60d22b5f56eb928cb6253290dab879da5b472` |
| `layout.json` | 1,408,171 | `5049d3a4a4c7a878a5b83dd2f30f8c620415a0e6aa681f45ca80d25828fc115a` |
| `theme.json` | 6,250 | `a964c0207ef562b6fa373964b5226f3821a97fdc7f2948d44af47c9856704f27` |

These are one extraction's bytes on one machine, not the product's and not a target for a future run: the producer
kept changing after the S13 comparison below (commit `1f040cb5` added the sampler fields `wrapU` / `wrapV` /
`filter` / `texW` / `texH` to the sprite and texture records, and the review fixes in this working tree change more
records), so a run at another commit can produce different bytes even from the same client. They are listed so a
later run can be compared, not to be copied. The only pinned byte table in `tools/local-extract/` re-verified against
a real client in this round is the font table in [fonts.py](fonts.py) (`FONT_SPECS`, recorded in
[FONT-PROVENANCE.md](FONT-PROVENANCE.md)); there is no pinned target byte value for `card.json` or `shop.json`.

## Fold equivalence (S13)

In the S13 round the recovered producer sat in a `legacy/` directory that `extract.py` loaded by file path and
placed on `sys.path`; this branch's earlier commits carried it, `origin/dev` never did, and the final tree has no
such folder — the modules live flat beside the extractor and share one `autochess_themes.py`. Both trees were run on
the same client bundles and fresh output roots (`--only shopdocs`, the two `--themes` roots, the same
`--game <install>`): the complete 852-file output trees (the count in the comparison logs) are byte-identical, and so
are `card.json` (`c38d27e6…`, 173,543 B), `shop.json`
(`0481775abb0657fa6bc10766c3add1dfe2a1744c9941a7068d3716c4d6e38dd7` on a fresh output root, 357,218 B),
`prefabs.json` (`35c58a37…`), `layout.json` (`1b3b82f7…`) and `theme.json` (`a964c020…`). Those are the S13 round's
values, recorded before `1f040cb5` added the sampler fields, so they are not the bytes a current run produces
(`theme.json` still hashes to the same value). `--only theme` keeps writing `prefabs.json` and no `card.json` /
`shop.json`, as before. A root that already held `sprites/tex_fx_mask_1.webp` when the producer resolved the money
icon records that `image.file` where a fresh root does not, so two roots can differ on the same client; that
directory-state dependency is not a fold difference. The checkout's `shop.json` is 363,223 B (table above), so it
cannot be compared byte-for-byte with the S13 fresh-root value: it was written by a later producer (the sampler
fields and the review fixes change the records) from a root that held `sprites/tex_fx_mask_1.webp`, whose
`image.file` the money icon's record names (`prefabs/autochess_main_money_item`).
`card.json` also lost the three `shaders/*.md` assets and the `doc` / `shaderDoc` links between the pre-S13 checkout
copy and either producer (the S7 change). The comparison logs (not committed) are line-identical; the old loader's
hash manifest was not retained, so the tree identity rests on those logs plus the document hashes above.

## Known non-reproducible points

- **`card.json`:** only archived commit `b6d29a05` is recorded as byte-exact against the product. That commit
  and the product file are on the contributor's prototype branch and are not in this repository's history, so the
  claim is not re-verified here. The commit the producer was recovered from (`0157ba29`) recorded a different
  `card.json` (a few prefab path IDs differ), so a run of these files is not expected to match it.
- **`shop.json`:** no tested archived commit produced a byte-exact product `shop.json`. The recorded route was
  the base producer plus the pinned normalizer plus the enrichment steps, so a run is not expected to be
  byte-equal.
- **Enrichment fields:** `pathID` (`path_ids.py`) and particles / emission / renderer (`theme_particles.py`) come
  from the two enrichment steps; the `mask` records come from the base producer (`card_prefab.py`,
  `autochess_themes.py`), and the `fx_mask_1` image record was the deleted normalizer's pinned value (the current
  steps do not write it). When the current client bundles are missing the enrichments are skipped with a warning and
  the base document is still written. A step rewrites the JSON compactly, so a document with and without enrichment
  differs in bytes even when the tree is otherwise identical.
- **Client version:** the bundles are hot-updated. The hardcoded prefab path IDs in `path_ids.py` (`ROOTS`) and
  `theme_particles_impl.py` (`PREFABS`) come from the archived client version, so a different client version can
  produce a different tree or a warning.
- **Changes since recovery (portability + content):** the archived copy's absolute client/lab paths were removed
  (`theme_particles_impl.py` now requires the caller to set its paths; `shop_prefab.py` derives the repository root
  two directories above its own file's directory in both `REPO_ROOT` and its standalone `main()`, like the
  extractor's modules), and the byte-identical
  `ui_components.py` / `aklz4.py` copies were dropped in favour of the extractor's own. Content changes:
  `card_prefab._shaders` no longer writes the shader porting pages (`shaders/*.md`) nor the `doc` / `shaderDoc`
  links they left in `card.json` (the page writer is deleted); a two-curves MinMaxCurve now keeps both curves
  (`mode: "twoCurves"`, `minKeys`); an external sprite or texture that repeats another's name under a different path
  id gets a numbered `_2` file instead of the first one's; `theme_particles` reports each document's counts
  separately.
