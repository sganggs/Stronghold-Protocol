# Cocoon client field receipt (2026-11-12)

[Field-only JSON](cocoon-client-fields-20261112.json) records the official root colliders, selector flags and bundle hashes.
Client version: `26-11-06-12-42-25-70182449`; the main bundle is `battle/enm_pfb_37.ab`.
The old 胄 prefab from `enm_pfb_28.ab` calibrates the same size / offset convention against the existing engine body.
No game text, images or client binary is distributed here.

To reproduce with a legally installed client and this repository's local-extract environment:

1. Read the active `hot_update_list.json` with `tools/local-extract/bundles.py resource_index`.
2. Resolve `battle/enm_pfb_37.ab` against `persistent_res_list.json`; only use a hot-update file whose hash matches the
   active resource index, or a packaged file with a matching packaged index. Check SHA-256 against the JSON receipt.
3. Import the repository's `aklz4` shim before `UnityPy.load(bundlePath)`.
4. In `env.container`, dereference `enemy_9035_acspider.prefab` and `enemy_9035_acspider_2.prefab`.
   Read the root GameObject's Transform and BoxCollider2D components with `read_typetree()`; record `m_LocalScale`,
   `m_Enabled`, `m_Size`, `m_Offset`. Do not substitute a graphical child collider or model renderer size.
5. Recursively walk Transform children using `m_Children` and `m_GameObject`, reading MonoBehaviour typetrees.
   At the Attack and Net selector paths, inspect `_ignoreTargetFree` and `_forceIgnoreCamouflage`; at AcidRain inspect
   its separate damage / debuff option `ignoreTargetFree`. Component path IDs in the receipt disambiguate duplicate paths.
6. Repeat root-collider extraction for `enemy_9013_acstmk` from `battle/enm_pfb_28.ab`; its existing 4.95×2.95/up-one
   body agrees with the same conversion. No claim is made about other unexamined bosses or already-applied poison.
