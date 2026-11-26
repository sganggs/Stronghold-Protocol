# Shop/card documents of a theme (recovered 0.4.0 producer)

Scope: the producer that writes `themes/<id>/card.json` and `themes/<id>/shop.json` beside the theme pack
(`prefabs.json` / `theme.json` / `layout.json` / sprites / voice / spine), the `--only shopdocs` job in
[extract.py](extract.py) that runs it, and its provenance. The produced art is local setup data:
`public/assets/local/` and `data/local-assets.json` are git-ignored and must never be committed.

## Source

- The contributor's prototype branch `feat/autochess-card-webgl` (archived commits `0157ba29` / `b6d29a05`);
  these commits are not in this repository's history. The producer was recovered from `0157ba29`; `b6d29a05`
  is the one recorded as producing an exact `card.json`.
- The files are the producer's; the differences from the archived copy (portability and content) are listed under
  "Known non-reproducible points".

## Where the code lives

The producer modules sit flat in `tools/local-extract/`, beside the current extractor, and import each other
normally (`import autochess_themes`, `import ui_components`, `import aklz4`). There is one
`autochess_themes.py`; `--only theme` and `--only shopdocs` differ only by the `shopdocs` flag. There is no `legacy/`
directory and each producer module exists once.

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

`card_shader.py` builds the shader records `card.json` carries (`materials` → `shaders`) and writes no page:
`card_shader.docs_markdown` is not part of the tree, and no `shaders/*.md` is written into the theme group or listed
(a stale copy from an older extraction is not registered either). The records stay in `card.json` as provenance /
diagnostic data: the client reads each material record (`public/js/ui/shop/prefab.js` `documentMaterials`), and no
code reads `card.shaders`.

`shop_compat.py` (a pinned schema normalizer for an archived `shop.json`) and the standalone `export_theme_data.py`
runner are not part of the tree: neither has a caller. Their record and limits are kept here.

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

The run prints the documents it registered, for example (the run names the missing `shop.json` for each theme that
carries only `prefabs.json` / `card.json`; one of those two lines is shown):

```
shopdocs: themes/ac_s_closur/prefabs.json
shopdocs: themes/ac_s_closur/card.json
shopdocs: themes/ac_s_closur/shop.json
shopdocs: themes/ac_n_iron lacks shop.json (the canvas shop needs prefabs.json + card.json + shop.json; the theme pack alone is not enough)
```

`--only shopdocs` is opt-in: a plain extraction writes no theme group at all. To put the documents into a real
local extraction, run the same command into `--out public/assets/local --manifest data/local-assets.json`, then
rebuild a theme pack with `node tools/package.mjs --theme-packs` ([docs/THEMES.md](../../docs/THEMES.md)). A theme
group extracted without the shop-documents job — and a 可露希尔 pack built from it — has no `card.json` / `shop.json`,
so the canvas shop does not mount.

## Recorded extraction (not a product target)

Recorded on 2026-11-23, while the working tree was at commit `20474712`, under
`public/assets/local/themes/ac_s_closur/` (git-ignored local setup data, not part of the repository):

| File | Bytes | SHA-256 |
|---|---:|---|
| `card.json` | 178,169 | `e2d09a7725d38aeaad3f931b1a14e810f8770d4c37a3b8f6b985cd17b673d903` |
| `shop.json` | 363,223 | `416be570dd2b7fbe6aef4fe4ea8f0ef421d33f02ee126271752f9ec7378edf50` |
| `prefabs.json` | 674,305 | `1bfed1f3c5e7d3d3f10efcef02c60d22b5f56eb928cb6253290dab879da5b472` |
| `layout.json` | 1,408,171 | `5049d3a4a4c7a878a5b83dd2f30f8c620415a0e6aa681f45ca80d25828fc115a` |
| `theme.json` | 6,250 | `a964c0207ef562b6fa373964b5226f3821a97fdc7f2948d44af47c9856704f27` |

These are one extraction's bytes on one machine, not the product's and not a target for a future run: the producer
changed after they were recorded (commit `1f040cb5` added the sampler fields `wrapU` / `wrapV` / `filter` / `texW` /
`texH` to the sprite and texture records, and later content fixes change more records), so a run at another commit
can produce different bytes even from the same client. They are listed so a later run can be compared, not to be
copied. The only pinned byte table in `tools/local-extract/` verified against a real client is the font table in
[fonts.py](fonts.py) (`FONT_SPECS`, recorded in [FONT-PROVENANCE.md](FONT-PROVENANCE.md)); there is no pinned target
byte value for `card.json` or `shop.json`.

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
  `autochess_themes.py`), and the `fx_mask_1` image record was the pinned value of the normalizer that is not in the
  tree (neither enrichment step writes it). When the client bundles are missing the enrichments are skipped with a
  warning and the base document is still written. A step rewrites the JSON compactly, so a document with and without
  enrichment differs in bytes even when the tree is otherwise identical.
- **Client version:** the bundles are hot-updated. The hardcoded prefab path IDs in `path_ids.py` (`ROOTS`) and
  `theme_particles_impl.py` (`PREFABS`) come from the archived client version, so a different client version can
  produce a different tree or a warning.
- **Output root state:** a root that already held `sprites/tex_fx_mask_1.webp` when the producer resolved the money
  icon lists that `image.file` where a fresh root does not, so two roots can differ on the same client. The recorded
  `shop.json` above comes from such a root: the money icon's record names `sprites/tex_fx_mask_1.webp`
  (`prefabs/autochess_main_money_item`).
- **Differences from the archived copy (portability + content):** the archived copy's absolute client/lab paths are
  not carried over (`theme_particles_impl.py` requires the caller to set its paths, as
  `theme_particles.enrich_theme` does; `shop_prefab.py` derives the repository root two directories above its own
  file in both `REPO_ROOT` and its standalone `main()`, like the extractor's modules), and `ui_components.py` /
  `aklz4.py` are the extractor's own copies rather than duplicates. Content: `card_prefab._shaders` writes no shader
  porting pages (`shaders/*.md`) and no `doc` / `shaderDoc` links; a two-curves MinMaxCurve keeps both curves
  (`mode: "twoCurves"`, `minKeys`); an external sprite whose name repeats gets a numbered `_2` file instead of
  sharing the first one's; `theme_particles` reports each document's counts separately.
