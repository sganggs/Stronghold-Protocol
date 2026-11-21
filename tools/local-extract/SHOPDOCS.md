# Shop/card documents of a theme (recovered 0.4.0 producer)

Scope: the producer that writes `themes/<id>/card.json` and `themes/<id>/shop.json` beside the theme pack
(`prefabs.json` / `theme.json` / `layout.json` / sprites / voice / spine), the `--only shopdocs` job in
[extract.py](extract.py) that runs it, and its provenance. The produced art is local setup data:
`public/assets/local/` and `data/local-assets.json` are git-ignored and must never be committed.

## Source

- The contributor's prototype branch `feat/autochess-card-webgl` (archived commits `0157ba29` / `b6d29a05`);
  these commits are not in this repository's history. The producer was recovered from `0157ba29`; `b6d29a05`
  is the one recorded as producing an exact `card.json`.
- The files are the producer's, unmodified except for the portability fixes and the shader-page removal listed
  under "Known non-reproducible points".

## Where the code lives

The producer modules sit flat in `tools/local-extract/`, beside the current extractor, and import each other
normally (`import autochess_themes`, `import ui_components`, `import aklz4`). There is one
`autochess_themes.py`; `--only theme` and `--only shopdocs` differ only by the `shopdocs` flag.

| Output | Code |
|---|---|
| `themes/<id>/prefabs.json` | `autochess_themes.py` (a `--only theme` run also writes it) |
| `themes/<id>/card.json` | `card_prefab.py`, `card_shader.py`, `unity_deps.py` |
| `themes/<id>/shop.json` | `shop_prefab.py` |
| added `pathId` / particle / mask fields | `path_ids.py`, `theme_particles.py` (through `theme_particles_impl.py`) |

`extract.py --only shopdocs [--only shopdocs/<id>]` calls
`autochess_themes.export_themes(..., shopdocs=True)` directly. That path also builds the CAB index
(`unity_deps.index_bundles`, cached under `.cache/`) that `card.json` needs for cross-file names, and it runs the
two enrichment steps after the base documents: shop base → `theme_particles` → `path_ids`. Each enrichment only
warns when it fails, so a produced `card.json` or `shop.json` can lack those fields. `--only theme` keeps
`shopdocs` off: no CAB index, no card / shop document, and its output is the theme pack only.

`card_shader.py` still builds the shader records `card.json` carries (`materials` → `shaders`), but its
`docs_markdown` porting page is no longer called: no `shaders/*.md` is written into the theme group or listed (a
stale copy from an older extraction is not registered either).

The audit-only `shop_compat.py` (pinned schema normalizer for an archived `shop.json`) and the isolated
`export_theme_data.py` runner were folded away with the old `legacy/` directory: no runtime code referenced them.
Their record and limits are kept here.

## Run (scratch output only)

```powershell
$py = '.venv-extract\Scripts\python.exe'
$game = '<install>\Arknights'
$data = "$game\Arknights_Data"
$out = '<scratch>\themes'

& $py tools/local-extract/extract.py --game $game --only shopdocs `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows" `
  --out '<scratch>\local' --manifest '<scratch>\local-assets.json'
```

The run prints the documents it registered, for example:

```
shopdocs: themes/ac_s_closur/prefabs.json
shopdocs: themes/ac_s_closur/card.json
shopdocs: themes/ac_s_closur/shop.json
shopdocs: base documents only — pathId / particle / mask fields need the producer's enrichment steps, which only warn on failure
```

`--only shopdocs` is opt-in: a plain extraction writes no theme group at all. To put the documents into a real
local extraction, run it into `--out public/assets/local --manifest data/local-assets.json`, then rebuild a
theme pack with `node tools/package.mjs --theme-packs` ([docs/THEMES.md](../../docs/THEMES.md)). A theme group
extracted before this job — and a 可露希尔 pack built from it — has no `card.json` / `shop.json`, so the canvas
shop does not mount.

## Current checkout state (not a product target)

The local extract in this checkout (git-ignored) holds, under `public/assets/local/themes/ac_s_closur/`:

| File | Bytes | SHA-256 |
|---|---:|---|
| `card.json` | 173,543 | `c38d27e68ced979930fa7cf6857754c71b11203ce141fdc9761388f70a43e644` |
| `shop.json` | 357,254 | `57bf1445117d879cb0b59555879cf4cd62c9024b190afed266a652296f90b9ee` |
| `prefabs.json` | 649,972 | `35c58a37d0324bd7e6296e8b0e72f31e6f24f967f65fe0b7796fca25c1db49ec` |

These are the bytes one local extraction currently has, not the product's or a future extract's. They are listed
so a later run can be compared, not to be copied. The only pinned byte table in `tools/local-extract/`
re-verified against a real client in this round is the font table in [fonts.py](fonts.py) (`FONT_SPECS`, recorded
in [FONT-PROVENANCE.md](FONT-PROVENANCE.md)); there is no pinned target byte value for `card.json` or `shop.json`.

## Fold equivalence (S13)

The 0.4.0 producer used to sit in a `legacy/` directory that `extract.py` loaded by file path and placed on
`sys.path`; it now lives flat beside the extractor and shares one `autochess_themes.py`. Both trees were run on
the same client bundles and fresh output roots (`--only shopdocs`, the two `--themes` roots, the same
`--game <install>`): the complete 852-file output trees (the count in the comparison logs) are byte-identical, and so are
`card.json` (`c38d27e6…`, 173,543 B), `shop.json` (`0481775abb0657fa6bc10766c3add1dfe2a1744c9941a7068d3716c4d6e38dd7`
on a fresh output root, 357,218 B), `prefabs.json` (`35c58a37…`), `layout.json` (`1b3b82f7…`) and
`theme.json` (`a964c020…`). `--only theme` keeps writing `prefabs.json` and no `card.json` / `shop.json`, as
before. The newest `shop.json` in this checkout is 36 bytes larger than a fresh run because the output root
already held `sprites/tex_fx_mask_1.webp` when the producer resolved the money icon, so it records that
`image.file`; a fresh root reproduces the smaller document with either producer, so this is an existing
directory-state dependency, not a fold difference. `card.json` also lost the three `shaders/*.md` assets and the
`doc` / `shaderDoc` links between the pre-S13 checkout copy and either producer (the S7 change). The comparison logs
(not committed) are line-identical; the old loader's hash manifest was not retained, so the tree identity rests on
those logs plus the document hashes above.

## Known non-reproducible points

- **`card.json`:** only archived commit `b6d29a05` is recorded as byte-exact against the product. That commit
  and the product file are on the contributor's prototype branch and are not in this repository's history, so the
  claim is not re-verified here. The commit the producer was recovered from (`0157ba29`) recorded a different
  `card.json` (a few prefab path IDs differ), so a run of these files is not expected to match it.
- **`shop.json`:** no tested archived commit produced a byte-exact product `shop.json`. The recorded route was
  the base producer plus the pinned normalizer plus the enrichment steps, so a run is not expected to be
  byte-equal.
- **Enrichment fields:** `pathId` (`path_ids.py`), particles/emission/renderer (`theme_particles.py`) and the
  `fx_mask_1` image record (the deleted normalizer copied the pinned value) come from separate steps. When the
  current client bundles are missing they are skipped with a warning and the base document is still written. The
  enrichment rewrites the JSON compactly, so a document with and without enrichment differs in bytes even when
  the tree is otherwise identical.
- **Client version:** the bundles are hot-updated. The hardcoded prefab path IDs in `path_ids.py` (`ROOTS`) and
  `theme_particles_impl.py` (`PREFABS`) come from the archived client version, so a different client version can
  produce a different tree or a warning.
- **Changes since recovery (portability + content):** the archived copy's absolute client/lab paths were removed
  (`theme_particles_impl.py` now requires the caller to set its paths; `shop_prefab.py` derives the repository root
  two directories above its own file's directory in both `REPO_ROOT` and its standalone `main()`, like the
  extractor's modules), and the byte-identical
  `ui_components.py` / `aklz4.py` copies were dropped in favour of the extractor's own. One content change:
  `card_prefab._shaders` no longer writes the shader porting pages (`shaders/*.md`) nor the `doc` / `shaderDoc`
  links they left in `card.json`, so `card_shader.docs_markdown` has no caller — the shader records themselves
  stay in `card.json`, where the renderer reads them.
