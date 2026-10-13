// Extension-less audio route (/media/…) — the one place that defines it.
//
// The game plays audio with fetch() + Web Audio, never <audio src> / <a download>. Download managers (IDM / 迅雷 /
// FDM …) do not care: their browser integration hooks XHR/fetch whose URL ends in a media extension and pops up
// "下载文件信息" for every BGM track. So the browser asks for audio through a same-origin, extension-less path —
//
//     /assets/audio/bgm/act1.mp3   →   /media/bgm/act1
//
// — and `server/http/media.js` resolves it back to the real file under public/assets/audio, still answering with
// `Content-Type: audio/mpeg`, Range support and the ETag of the file it resolved. The content-hash segment of a served
// manifest's URL (shared/assetPaths.js) comes along: `/assets/~<hash>/audio/bgm/act1.mp3` → `/media/~<hash>/bgm/act1`,
// cached by the browser for a year while the hash names the file.
//
// Both sides import this module: the browser to decide which URLs to rewrite (`public/js/media.js`), the server to
// decide which extensions a `/media/…` request may resolve to. A second copy of the list on one side would let them
// drift apart silently — the client would rewrite to a path the server no longer accepts.

/** Prefix of the extension-less audio route served by `server/http/media.js`. */
export const MEDIA_PREFIX = '/media/';

/** Extensions a `/media/…` request may resolve to, in the order the server tries them. */
export const AUDIO_EXTS = Object.freeze(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav']);
