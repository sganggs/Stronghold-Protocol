# Shop/card data — recovery record

Scope: the archived 0.4.0 theme producer in this directory and the `--only shopdocs` job in
`tools/local-extract/extract.py` that runs it. The produced art is local setup data: `public/assets/local/` and
`data/local-assets.json` are git-ignored and must never be committed.

## Source

- Maintainer's pre-squash history backup, branch `feat/autochess-card-webgl` (that backup is not in this
  repository). The producer was recovered from the archived commit `0157ba29`; an earlier archived commit
  `b6d29a05` is the one the backup recorded as producing an exact `card.json`.
- The files are the producer's, unmodified except for the portability fixes listed at the end.

## What produces what

| Output | Code |
|---|---|
| `themes/<id>/prefabs.json` | `autochess_themes.py` (the current `--only theme` also writes this file) |
| `themes/<id>/card.json` | `card_prefab.py`, `card_shader.py`, `unity_deps.py` |
| `themes/<id>/shop.json` | `shop_prefab.py` |
| added `pathId` / particle / mask fields | `path_ids.py`, `theme_particles.py` (through `theme_particles_impl.py`) |
| pinned schema normalizer (audit only) | `shop_compat.py` |

`--only shopdocs` loads `autochess_themes.py` from this directory by file path; `export_theme_data.py` is the
isolated `card.json` runner. The enrichments add fields to documents the base producer already wrote and only
warn when the current bundles are unavailable.

## Reproduce

```powershell
$py = '.venv-extract\Scripts\python.exe'
$game = '<install>\Arknights'
$data = "$game\Arknights_Data"

# base documents through the current extractor (--themes is required; --out/--manifest must be scratch)
& $py tools/local-extract/extract.py --game $game --only shopdocs `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows" `
  --out '<scratch>\local' --manifest '<scratch>\local-assets.json'

# one theme, isolated from the current extractor
& $py tools/local-extract/legacy/export_theme_data.py `
  --game $game --repo-root . --out '<scratch>\themes' --theme ac_s_closur `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows"

# pinned compatibility audit: writes nothing unless the result hashes to the pinned product file
& $py tools/local-extract/legacy/shop_compat.py `
  --input '<scratch>\themes\ac_s_closur\shop.json' --pinned '<product>\shop.json' --out '<scratch>\shop.json'
```

The `shopdocs` run prints the documents it registered, for example:

```
shopdocs: themes/ac_s_closur/prefabs.json
shopdocs: themes/ac_s_closur/card.json
shopdocs: themes/ac_s_closur/shop.json
shopdocs: base documents only — pathId / particle / mask fields need the producer's enrichment steps, which only warn on failure
```

## Current checkout state (not a product target)

The local extract in this checkout (git-ignored) holds, under `public/assets/local/themes/ac_s_closur/`:

| File | Bytes | SHA-256 |
|---|---:|---|
| `card.json` | 174,834 | `1c554409564e2501da554a9d8a7c69aa3b0ba60f9c7b7557982a91cf1a978e40` |
| `shop.json` | 357,218 | `0481775abb0657fa6bc10766c3add1dfe2a1744c9941a7068d3716c4d6e38dd7` |
| `prefabs.json` | 649,670 | `cdb9782c906cfdafb3880b701d63f8df8c87871bcdf6e62d9e0052781b5ea8c2` |

These are the bytes one local extraction currently has, not the product's or a future extract's. They are
listed so a later run can be compared, not to be copied.

The only pinned byte table in `tools/local-extract/` re-verified against a real client in this round is the
font table in `fonts.py` (`FONT_SPECS`, recorded in `FONT-PROVENANCE.md`). There is no pinned target byte
value for `card.json` or `shop.json` in this repository.

## Known non-reproducible points

- **`card.json`:** only archived commit `b6d29a05` is recorded as byte-exact against the product. That commit
  and the product file are in the maintainer's pre-squash history backup, not in this repository, so the claim
  is not re-verified here. The archived commit the producer was recovered from (`0157ba29`) recorded a
  different `card.json` (a few prefab path IDs differ), so a run of these files is not expected to match it.
- **`shop.json`:** no tested archived commit produced a byte-exact product `shop.json`. The recorded route was
  the base producer plus `shop_compat.py` (a pinned schema normalizer) plus the enrichment steps, so a run is
  not expected to be byte-equal.
- **Enrichment fields:** `pathId` (`path_ids.py`), particles/emission/renderer (`theme_particles.py`) and the
  `fx_mask_1` image record (`shop_compat.py` copies the pinned value) come from separate steps. When the
  current client bundles are missing they are skipped with a warning and the base document is still written.
  The enrichment rewrites the JSON compactly, so a document with and without enrichment differs in bytes even
  when the tree is otherwise identical.
- **Client version:** the bundles are hot-updated. The hardcoded prefab path IDs in `path_ids.py` (`ROOTS`) and
  `theme_particles_impl.py` (`PREFABS`) come from the archived client version, so a different client version
  can produce a different tree or a warning.
- **Portability fixes since recovery:** the archived copy's absolute client/lab paths were removed
  (`theme_particles_impl.py` now requires the caller to set its paths; `export_theme_data.py` resolves its
  imports relative to the repository; `shop_prefab.py` reads the repository root three directories above its
  own), and the byte-identical `ui_components.py` / `aklz4.py` copies were dropped in favour of the current
  extractor's.
