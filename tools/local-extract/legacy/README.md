# Archived theme producer (shop/card data)

These files are the 0.4.0-era theme producer recovered from the maintainer's pre-squash history backup
(branch `feat/autochess-card-webgl`; that backup is not in this repository).

`tools/local-extract/extract.py --only shopdocs` imports `autochess_themes.py` from this directory by file
path and calls its `export_themes`, so `prefabs.json`, `card.json` and `shop.json` are produced and listed
in the manifest under the same `themes/<id>` group as `--only theme`. The modules that producer imports for
those documents (card_prefab, shop_prefab, theme_particles, path_ids, unity_deps) are taken from this
directory too; the current extractor itself imports nothing else from here, and `--only theme` keeps using the
current `autochess_themes.py` one directory up.

- `autochess_themes.py` — producer base and the `--only shopdocs` entry point
- `card_prefab.py`, `card_shader.py`, `unity_deps.py` — `card.json`
- `shop_prefab.py` — `shop.json`
- `theme_particles.py`, `theme_particles_impl.py` — particle enrichment (`pathId`, emission/bursts, materials)
- `path_ids.py` — real prefab `pathID` enrichment
- `shop_compat.py` — pinned compatibility normalizer for an archived `shop.json` (audit only)
- `export_theme_data.py` — isolated `card.json` runner

`ui_components.py` and `aklz4.py` are not kept here: they were byte-identical to the copies one directory
up, which these modules import instead.

The output of `--only shopdocs` is the base producer's documents. Its particle / `pathId` / mask fields come
from the enrichment steps, which only warn when they fail, so a produced `card.json` or `shop.json` can lack
them. The job prints which documents it wrote; it does not claim they are byte-identical to any earlier
product file. The recovery record is [DATA-REPRO.md](DATA-REPRO.md).

## Run (scratch output only)

```powershell
$py = '.venv-extract\Scripts\python.exe'
$game = '<install>\Arknights'
$data = "$game\Arknights_Data"
$out = '<scratch>\themes'

& $py tools/local-extract/extract.py --game $game --only shopdocs `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows" `
  --out '<scratch>\local' --manifest '<scratch>\local-assets.json'

# the isolated card.json runner, without the current extractor
& $py tools/local-extract/legacy/export_theme_data.py `
  --game $game --repo-root . --out $out --theme ac_s_closur `
  --themes "$data\PersistentData\Bundles" --themes "$data\StreamingAssets\AB\Windows"
```

`public/assets` and `data/local-assets.json` are gitignored; never commit the generated theme files.
