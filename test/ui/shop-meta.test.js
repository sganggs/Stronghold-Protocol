// test/ui/shop-meta.test.js — the host's Stage B prefab-meta contract (ui/shop/meta.js).
// The adapter (ui/shop/adapter/prefabMeta.js) derives tintTargets/pathIdMap from the enriched shop/card
// documents; the host only validates and normalises that object. The last case drives the production
// buildShopMeta against a minimal fixture; the others pin the host contract without needing the data.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseShopMeta, resolveShopMeta } from '../../public/js/ui/shop/meta.js';
import { buildShopMeta } from '../../public/js/ui/shop/adapter/prefabMeta.js';

test('no metadata: Stage A behaviour, both tables null', async () => {
  const meta = await resolveShopMeta({});
  assert.equal(meta.source, 'none');
  assert.equal(meta.tintTargets, null);
  assert.equal(meta.pathIdMap, null);
  assert.deepEqual(meta.stats, { tintCard: 0, tintPanel: 0, pathIds: 0, dropped: 0 });
});

test('prefabMeta override: root prefixes are stripped, duplicates and junk dropped', async () => {
  const meta = await resolveShopMeta({
    options: {
      prefabMeta: {
        tintTargets: {
          card: [
            'root/panel_main/btn_card/group_frame/frame',
            'autochess_shop_card_item/root/panel_main/btn_card/group_frame/frame',
            'root/panel_main/btn_card/group_frame/frame',
            '',
            null,
            42,
          ],
          panel: [
            'panel_shop_main/state_unfold/panel_unfold/root_layout/group_upgrade/group_normal/root_bg/deco_top/add',
            'state_unfold/panel_unfold/root_layout/group_upgrade/group_normal/root_bg/deco_top/add',
          ],
        },
        pathIdMap: {
          statusEntries: [
            {
              prefab: 'autochess_shop_card_item',
              statusName: 'fx_triple_on',
              descriptionType: 1,
              active: 1,
              targets: { gameObject: { resolved: true, path: 'autochess_shop_card_item/root/panel_main/btn_card/state_fx_triple' } },
            },
            // dropped: no target path
            { prefab: 'autochess_shop_card_item', statusName: 'fx_triple_off', descriptionType: 1, targets: { gameObject: { path: '' } } },
            // dropped: no status name
            { prefab: 'autochess_shop_card_item', descriptionType: 1, targets: { gameObject: { path: 'x' } } },
          ],
        },
      },
    },
  });
  assert.equal(meta.source, 'options.prefabMeta');
  assert.deepEqual(meta.tintTargets.card, ['root/panel_main/btn_card/group_frame/frame']);
  assert.deepEqual(meta.tintTargets.panel, ['state_unfold/panel_unfold/root_layout/group_upgrade/group_normal/root_bg/deco_top/add']);
  assert.equal(meta.pathIdMap.statusEntries.length, 1);
  assert.deepEqual(meta.pathIdMap.statusEntries[0].targets.gameObject, {
    resolved: true,
    path: 'autochess_shop_card_item/root/panel_main/btn_card/state_fx_triple',
  });
  assert.equal(meta.pathIdMap.statusEntries[0].descriptionType, 1);
  assert.equal(meta.stats.tintCard, 1);
  assert.equal(meta.stats.tintPanel, 1);
  assert.equal(meta.stats.pathIds, 1);
  assert.equal(meta.stats.dropped, 5, 'junk tint entries (empty/null/42) plus two incomplete status entries');
});

test('explicit tintTargets/pathIdMap override wins over a loader', async () => {
  let loaded = false;
  const meta = await resolveShopMeta({
    options: {
      tintTargets: { card: ['root/a'], panel: [] },
      loadPrefabMeta: async () => { loaded = true; return null; },
    },
  });
  assert.equal(meta.source, 'options');
  assert.equal(loaded, false, 'the explicit override must not call the loader');
  assert.deepEqual(meta.tintTargets, { card: ['root/a'], panel: [] });
  assert.equal(meta.pathIdMap, null);
});

test('loader injection fills the tables (W62 adapter shape)', async () => {
  const meta = await resolveShopMeta({
    options: {
      loadPrefabMeta: async () => ({
        tintTargets: { card: ['root/a', 'root/b'], panel: ['state_unfold/x'] },
        pathIdMap: {
          statusEntries: [{
            prefab: 'autochess_shop_card_item',
            statusName: 'fx_frozen_on',
            descriptionType: 1,
            active: 1,
            targets: { gameObject: { resolved: true, path: 'autochess_shop_card_item/root/panel_main/btn_card/state_fx_frozen' } },
          }],
        },
      }),
    },
  });
  assert.equal(meta.source, 'loader');
  assert.deepEqual(meta.tintTargets, { card: ['root/a', 'root/b'], panel: ['state_unfold/x'] });
  assert.equal(meta.pathIdMap.statusEntries[0].statusName, 'fx_frozen_on');
  assert.equal(meta.stats.tintCard, 2);
  assert.equal(meta.stats.pathIds, 1);
});

test('a throwing loader never fails the mount', async () => {
  const meta = await resolveShopMeta({ options: { loadPrefabMeta: async () => { throw new Error('no module'); } } });
  assert.equal(meta.source, 'loader-failed');
  assert.equal(meta.tintTargets, null);
  assert.equal(meta.pathIdMap, null);
});

test('normaliseShopMeta tolerates empty or wrong-shaped input', () => {
  assert.deepEqual(normaliseShopMeta(null), {
    tintTargets: null,
    pathIdMap: null,
    stats: { tintCard: 0, tintPanel: 0, pathIds: 0, dropped: 0 },
  });
  const empty = normaliseShopMeta({ tintTargets: { card: [], panel: [] }, pathIdMap: { statusEntries: [] } });
  assert.deepEqual(empty.tintTargets, { card: [], panel: [] });
  assert.equal(empty.pathIdMap, null, 'an empty map is no map');
  const bad = normaliseShopMeta({ tintTargets: 'nope', pathIdMap: [1, 2] });
  assert.equal(bad.tintTargets, null);
  assert.equal(bad.pathIdMap, null);
});

const PANEL_ROOT = 'panel_shop_main';
const CARD_ROOT = 'autochess_shop_card_item';

/**
 * The document shape the extractor writes: prefab nodes with id/path/pathID, `colorGroup.nodes` naming the nodes a
 * UIColorGraphic tints, and one UIViewStatusDriver per root whose descriptions name a pid instead of a path.
 */
const SHOP_DOC = {
  prefabs: {
    [PANEL_ROOT]: {
      root: {
        id: 1,
        path: PANEL_ROOT,
        name: 'root',
        children: [
          {
            id: 2,
            path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal/btn_upgrade`,
            name: 'hotspot_normal',
            colorGroup: { nodes: [3, 4, 4] },
          },
          { id: 3, path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal/img_normal` },
          { id: 4, path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal/img_hover` },
          {
            id: 5,
            path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal`,
            components: [{
              class: 'UIViewStatusDriver',
              fields: {
                _statusEntries: [{
                  statusName: 'fx_upgrade_on',
                  descriptions: [{ descriptionType: 2, active: 1, gameObject: { pid: 6 } }],
                }],
              },
            }],
          },
          { id: 6, pathID: 6, path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal/deco_on` },
        ],
      },
    },
  },
};

const CARD_DOC = {
  root: {
    id: 10,
    path: CARD_ROOT,
    name: 'root',
    children: [
      {
        id: 11,
        path: `${CARD_ROOT}/root/panel_main/btn_card/group_frame`,
        name: 'hot_spot',
        colorGroup: { nodes: [12] },
      },
      { id: 12, path: `${CARD_ROOT}/root/panel_main/btn_card/group_frame/frame` },
      {
        id: 13,
        path: `${CARD_ROOT}/root/panel_main/btn_card`,
        components: [{
          class: 'UIViewStatusDriver',
          fields: {
            _statusEntries: [{
              statusName: 'fx_frozen_on',
              descriptions: [
                { descriptionType: 1, active: 1, gameObject: { pid: 14 } },
                // no node carries pathID 99: skipped, never guessed
                { descriptionType: 1, active: 0, gameObject: { pid: 99 } },
              ],
            }],
          },
        }],
      },
      { id: 14, pathID: 14, path: `${CARD_ROOT}/root/panel_main/btn_card/state_fx_frozen_on` },
    ],
  },
};

test('buildShopMeta derives the tint tables and the status paths from the documents', () => {
  const before = JSON.stringify({ shop: SHOP_DOC, card: CARD_DOC });
  const meta = buildShopMeta({ shop: SHOP_DOC, card: CARD_DOC });
  assert.equal(JSON.stringify({ shop: SHOP_DOC, card: CARD_DOC }), before, 'the adapter must not mutate the documents');

  // only the hotspot_normal / hot_spot groups tint; paths stay root-relative and duplicates are dropped
  assert.deepEqual(meta.tintTargets, {
    panel: [
      'state_unfold/panel_unfold/group_upgrade/group_normal/img_normal',
      'state_unfold/panel_unfold/group_upgrade/group_normal/img_hover',
    ],
    card: ['root/panel_main/btn_card/group_frame/frame'],
  });
  assert.deepEqual(meta.pathIdMap.statusEntries, [
    {
      prefab: PANEL_ROOT,
      statusName: 'fx_upgrade_on',
      descriptionType: 2,
      active: 1,
      targets: { gameObject: { resolved: true, path: `${PANEL_ROOT}/state_unfold/panel_unfold/group_upgrade/group_normal/deco_on` } },
    },
    {
      prefab: CARD_ROOT,
      statusName: 'fx_frozen_on',
      descriptionType: 1,
      active: 1,
      targets: { gameObject: { resolved: true, path: `${CARD_ROOT}/root/panel_main/btn_card/state_fx_frozen_on` } },
    },
  ]);

  const normal = normaliseShopMeta(meta);
  assert.deepEqual(normal.stats, { tintCard: 1, tintPanel: 2, pathIds: 2, dropped: 0 });
  assert.deepEqual(normal.tintTargets, meta.tintTargets);
  assert.equal(normal.pathIdMap.statusEntries.length, 2);
});

test('buildShopMeta tolerates missing documents: empty tables, no throw', () => {
  const meta = buildShopMeta();
  assert.deepEqual(meta, { tintTargets: { panel: [], card: [] }, pathIdMap: { statusEntries: [] } });
  const normal = normaliseShopMeta(meta);
  assert.equal(normal.pathIdMap, null, 'an empty map is no map');
  assert.deepEqual(normal.stats, { tintCard: 0, tintPanel: 0, pathIds: 0, dropped: 0 });
});
