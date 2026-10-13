// mediaUrl(): audio is fetched through an extension-less /media/… path so download managers (IDM / 迅雷 / FDM)
// stop hijacking BGM playback with a "下载文件信息" dialog. See public/js/media.js for the full rationale.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mediaUrl } from '../public/js/media.js';
// 前缀与扩展名列表只有一份（客户端和服务端都从这里取），所以断言也直接盯住这一份。
import { MEDIA_PREFIX, AUDIO_EXTS } from '../shared/media.js';

const ORIGIN = 'http://127.0.0.1:3000';

describe('mediaUrl: 音频地址去掉扩展名（躲开下载器嗅探）', () => {
  test('把 /assets/audio/**.mp3 改写成 /media/**', () => {
    assert.equal(mediaUrl('/assets/audio/bgm/m_sys_act1autochess_loop.mp3', ORIGIN), '/media/bgm/m_sys_act1autochess_loop');
    assert.equal(mediaUrl('/assets/audio/sfx/player/p_imp/hit.mp3', ORIGIN), '/media/sfx/player/p_imp/hit');
    // 绝对同源地址同样改写
    assert.equal(mediaUrl(`${ORIGIN}/assets/audio/bgm/a.mp3`, ORIGIN), '/media/bgm/a');
    // 查询串保留（?v=… 会拿到 immutable 缓存）
    assert.equal(mediaUrl('/assets/audio/bgm/a.mp3?v=2', ORIGIN), '/media/bgm/a?v=2');
    // 各音频扩展名
    for (const ext of AUDIO_EXTS) {
      assert.equal(mediaUrl(`/assets/audio/x/a${ext}`, ORIGIN), '/media/x/a', ext);
    }
    assert.equal(mediaUrl('/assets/audio/x/A.MP3', ORIGIN), '/media/x/A', '大小写不敏感');
  });

  test('服务器下发的清单带内容哈希段（/assets/~<hash>/audio/…）：改写后保留这一段', () => {
    const H = '0123456789abcdef';
    assert.equal(mediaUrl(`/assets/~${H}/audio/bgm/m_sys_act1autochess_loop.mp3`, ORIGIN), `/media/~${H}/bgm/m_sys_act1autochess_loop`);
    assert.equal(mediaUrl(`${ORIGIN}/assets/~${H}/audio/sfx/a.mp3`, ORIGIN), `/media/~${H}/sfx/a`);
    assert.doesNotMatch(mediaUrl(`/assets/~${H}/audio/bgm/a.mp3`, ORIGIN), /\.(mp3|m4a|aac|ogg|oga|opus|wav)(\?|$)/i);
    // 不是合法的哈希段（大写、长度不对）就不是我们的音频地址，原样返回
    assert.equal(mediaUrl(`/assets/~${H.toUpperCase()}/audio/a.mp3`, ORIGIN), `/assets/~${H.toUpperCase()}/audio/a.mp3`);
    assert.equal(mediaUrl(`/assets/~${H}/char/a.png`, ORIGIN), `/assets/~${H}/char/a.png`, '图片不改写');
  });

  test('改写后的地址里不再有任何媒体扩展名（下载器就是按这个嗅探的）', () => {
    const out = mediaUrl('/assets/audio/bgm/m_bat_vtlionk_loop.mp3', ORIGIN);
    assert.equal(out.startsWith(MEDIA_PREFIX), true);
    assert.doesNotMatch(out, /\.(mp3|m4a|aac|ogg|oga|opus|wav)(\?|$)/i);
  });

  test('不是我们的音频、或不是同源时不改写', () => {
    assert.equal(mediaUrl('/assets/img/a.png', ORIGIN), '/assets/img/a.png');
    assert.equal(mediaUrl('/assets/audio/bgm.m4a.bak', ORIGIN), '/assets/audio/bgm.m4a.bak', '扩展名不认识就原样返回');
    assert.equal(mediaUrl('https://cdn.example.com/assets/audio/a.mp3', ORIGIN), 'https://cdn.example.com/assets/audio/a.mp3', '别的源自己负责');
    assert.equal(mediaUrl('/data/assets.json', ORIGIN), '/data/assets.json');
    assert.equal(mediaUrl('', ORIGIN), '');
    assert.equal(mediaUrl(null, ORIGIN), null);
    assert.equal(mediaUrl(undefined, ORIGIN), undefined);
    assert.equal(mediaUrl('/assets/audio/', ORIGIN), '/assets/audio/', '空路径不改写（服务端只会 404）');
  });

  test('会产生非法路径的输入不碰（点目录 / 空段）', () => {
    assert.equal(mediaUrl('/assets/audio/.hidden.mp3', ORIGIN), '/assets/audio/.hidden.mp3');
    // URL 解析本来就会把 .. 归一化，改写跟着归一化后的路径走（服务端仍是同一道校验）
    assert.equal(mediaUrl('/assets/audio/bgm/../x.mp3', ORIGIN), '/media/x');
  });

  test('没有 location 时（测试环境）用传入的 origin 判断同源', () => {
    assert.equal(mediaUrl('/assets/audio/bgm/a.mp3'), '/media/bgm/a', '相对地址本来就同源');
    assert.equal(mediaUrl('https://other.example/assets/audio/a.mp3'), 'https://other.example/assets/audio/a.mp3');
  });
});
