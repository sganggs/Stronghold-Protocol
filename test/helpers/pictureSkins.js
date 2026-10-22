// Original synthetic fixture: URLs name test media, never official art or tables.
export const CHAR = 'char_x_picture';
export const BODY = 'char_x_backup';
const model = (name) => ({ skel: `/${name}.skel`, atlas: `/${name}.atlas`, textures: [`/${name}.png`], anims: { idle: 'Idle' } });
export const manifest = { chars: {
  [CHAR]: { avatar: '/base-a.png', avatarE2: '/base-a2.png', portrait: '/base-p.png', portraitE2: '/base-p2.png',
    spine: { front: model('base-front'), back: model('base-back') }, skins: {
      picture: { name: 'Picture', avatar: '/skin-a.png', portrait: '/skin-p.png' },
      avatar: { name: 'Avatar', avatar: '/skin-a.png' },
      portrait: { name: 'Portrait', portrait: '/skin-p.png' },
      illustration: { name: 'Illustration', illust: '/skin-i.png' },
      elite: { name: 'Elite', avatarE2: '/skin-a2.png', portraitE2: '/skin-p2.png' },
      incomplete: { name: 'Incomplete', avatar: '/skin-a.png', spine: { back: model('unfinished-back') } },
      empty: { name: 'Metadata' },
      model: { name: 'Model', spine: { front: model('skin-front'), back: model('skin-back') } },
    } },
  [BODY]: { avatar: '/backup.png', portrait: '/backup-p.png', skins: { picture: { name: 'Backup', avatar: '/backup-skin.png' } } },
} };
export const chess = { chessId: 'chess_x_picture_a', charId: CHAR, name: 'Fixture', tier: 1,
  assets: { avatar: CHAR, portrait: `${CHAR}_1` }, bonds: [] };
