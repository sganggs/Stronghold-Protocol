import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { data } from '../../public/js/data.js';
import { availableSkins, chosenSkin, hasAnySkinChoices, ownerSkin } from '../../public/js/ui/skins.js';
import { chessAvatarUrl, chessPortraitUrl } from '../../public/js/ui/assetUrls.js';
import { avatarUrl, portraitUrl, spineEntry, hasBackSpine } from '../../public/js/assets.js';
import { unitArt } from '../../public/js/ui/fallbackField.js';
import { ChessCard } from '../../public/js/ui/shopBar.js';
import { resolveDetail, ChessDetail } from '../../public/js/ui/detailPanel.js';
import { OperatorImage, UnitThumb } from '../../public/js/ui/gameComponents.js';
import { OpCard } from '../../public/js/screens/settle.js';
import { LineupThumb } from '../../public/js/screens/result.js';
import { CHAR, BODY, manifest, chess } from '../helpers/pictureSkins.js';

data.setContent({ id: 'b'.repeat(64), values: { assets: manifest, chess: { [chess.chessId]: chess } } });
after(() => data.setContent(null));
const players = [{ playerId: 'one', skins: { [CHAR]: 'picture', [BODY]: 'picture' } },
  { playerId: 'two', skins: { [CHAR]: 'avatar' } }, { playerId: 'clear' }];
const options = { myId: 'one', players, localSkins: { [CHAR]: 'portrait' } };
const selected = (ownerId, extra = {}) => ({ skin: ownerSkin(CHAR, { ...options, ownerId, ...extra }) });

test('B6 picker offers every picture family and model, hides metadata, retains the stored choice', () => {
  const rows = availableSkins(CHAR);
  assert.deepEqual(rows.filter((r) => r.playable).map((r) => r.id), ['', 'picture', 'avatar', 'portrait', 'illustration', 'elite', 'incomplete', 'model']);
  for (const id of ['picture', 'avatar', 'portrait', 'illustration', 'elite', 'incomplete']) {
    assert.equal(rows.find((r) => r.id === id).pictureOnly, true);
    assert.equal(chosenSkin(CHAR, { [CHAR]: id }), id);
  }
  assert.equal(rows.find((r) => r.id === 'model').pictureOnly, false);
  assert.equal(chosenSkin(CHAR, { [CHAR]: 'empty' }), null);
  assert.equal(hasAnySkinChoices(), true);
  assert.equal(rows.find((r) => r.id === 'elite').avatar, '/skin-a2.png');
});

test('two owners, spectator, otherSkins and public clears never use the viewer choice', () => {
  assert.equal(chessPortraitUrl(manifest, chess, selected('one')), '/skin-p.png');
  assert.equal(chessPortraitUrl(manifest, chess, selected('two')), '/base-p.png');
  assert.equal(chessAvatarUrl(manifest, chess, selected('two')), '/skin-a.png');
  assert.equal(selected('one', { myId: 'spectator' }).skin, 'picture');
  assert.equal(selected('two', { otherSkins: false }).skin, null);
  assert.equal(selected('one', { otherSkins: false }).skin, 'picture');
  assert.equal(selected('clear', { skin: 'picture' }).skin, null, 'clear beats stale unit metadata');
  assert.equal(selected('unknown').skin, null);
  assert.equal(selected('unknown', { skin: 'picture' }).skin, 'picture');
  assert.equal(selected(undefined).skin, 'portrait', 'local picker');
  assert.equal(selected(null).skin, null, 'unowned catalogue');
});

test('normal / elite image layers fall back independently; removed or foreign skins use default pictures', () => {
  for (const [skin, a, p] of [['picture', '/skin-a.png', '/skin-p.png'], ['avatar', '/skin-a.png', '/base-p.png'],
    ['portrait', '/base-a.png', '/skin-p.png'], ['illustration', '/base-a.png', '/skin-i.png'],
    ['gone', '/base-a.png', '/base-p.png'], ['elite', '/base-a.png', '/base-p.png']]) {
    assert.equal(chessAvatarUrl(manifest, chess, { skin }), a);
    assert.equal(chessPortraitUrl(manifest, chess, { skin }), p);
    assert.equal(avatarUrl(manifest, CHAR, { skin }), a);
    assert.equal(portraitUrl(manifest, CHAR, { skin }), p);
  }
  const elite = { ...chess, isGolden: true, assets: { avatar: `${CHAR}_2`, portrait: `${CHAR}_2` } };
  assert.equal(chessAvatarUrl(manifest, elite, { skin: 'elite' }), '/skin-a2.png');
  assert.equal(chessPortraitUrl(manifest, elite, { skin: 'elite' }), '/skin-p2.png');
  assert.equal(chessPortraitUrl(manifest, elite, { skin: 'avatar' }), '/base-p2.png');
  assert.equal(chessAvatarUrl(manifest, elite, { skin: 'portrait' }), '/base-a2.png');
  assert.equal(chessAvatarUrl({ chars: {} }, chess, { skin: 'picture' }), null);
  assert.equal(chessPortraitUrl(manifest, { charId: BODY }, { skin: 'portrait' }), '/backup-p.png');
});

test('picture-only outfits keep default Front / Back; model outfits retain their own pair', () => {
  for (const skin of ['picture', 'avatar', 'portrait', 'illustration', 'elite', 'incomplete', 'gone']) {
    for (const back of [false, true]) assert.deepEqual(spineEntry(manifest, CHAR, { skin, back }), spineEntry(manifest, CHAR, { back }));
    assert.equal(hasBackSpine(manifest, CHAR, skin), true);
  }
  assert.equal(spineEntry(manifest, CHAR, { skin: 'model' }).skel, '/skin-front.skel');
  assert.equal(spineEntry(manifest, CHAR, { skin: 'model', back: true }).skel, '/skin-back.skel');
});

test('fallback battle pictures resolve the stand-in / DIY body and owner, including toggles', () => {
  const standIn = { ownerId: 'one', avatar: BODY, spine: BODY, standInFor: CHAR, skin: 'gone' };
  assert.equal(unitArt(manifest, standIn, options), '/backup-skin.png');
  const diy = { ownerId: 'two', avatar: CHAR, spine: CHAR, diy: { charId: CHAR }, skin: 'gone' };
  assert.equal(unitArt(manifest, diy, options), '/skin-a.png');
  assert.equal(unitArt(manifest, diy, { ...options, otherSkins: false }), '/base-a.png');
  assert.equal(unitArt(manifest, diy, options), '/skin-a.png');
});

function* walk(v) {
  if (Array.isArray(v)) { for (const n of v) yield* walk(n); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const imageOf = (v) => [...walk(v)].find((n) => n.type === OperatorImage);

test('shop, details, thumbnails and both result layouts carry the owning seat into picture resolution', () => {
  const card = ChessCard({ slot: { id: chess.chessId, price: 1 }, idx: 0, priv: { playerId: 'two' } });
  assert.equal(imageOf(card).props.ownerId, 'two');
  const detail = resolveDetail({ kind: 'unit', unit: { defId: chess.chessId, ownerId: 'two', skin: 'picture' } }, new Map());
  assert.equal(detail.ownerId, 'two');
  assert.equal(detail.skin, 'picture');
  assert.equal(imageOf(ChessDetail({ ...detail, bonds: [] })).props.ownerId, 'two');
  const member = resolveDetail({ kind: 'chess', id: chess.chessId, owner: 'two' }, new Map(), { priv: { playerId: 'one' } });
  assert.equal(member.ownerId, 'two');
  assert.equal(imageOf(UnitThumb({ id: chess.chessId, ownerId: 'two' })).props.ownerId, 'two');
  const u = { id: chess.chessId, kind: 'chess', skin: 'picture' }, gd = { m: manifest, chess: () => chess };
  assert.equal(imageOf(OpCard({ u, gd, i: 0, ownerId: 'two' })).props.ownerId, 'two');
  const row = LineupThumb({ u, gd, ownerId: 'two' });
  assert.equal(imageOf(UnitThumb(row.props)).props.ownerId, 'two');
});
