# A cosmetic plugin — template · 外观插件模板

Copy this folder to `plugins/<your-id>/` (the folder name is the plugin's id: 2–32 lower-case letters, digits and `-`)
and edit `plugin.json`. A folder whose name starts with `_`, like this one, is never loaded.

This template includes two original CC0 examples, created for this project: `media/sample.png` (32×32 teal/gold
checkerboard, 8-pixel cells) and `media/sample.ogg` (0.15-second 660 Hz sine tone, 24000 Hz mono Opus input, faded at both ends).
No game files are included. The avatar and select voice line use these real files; the portrait/model reference
installed art. Replace the examples with your own files, for example:

```json
"assets": {
  "chars": {
    "char_102_texas": {
      "avatar": "art/avatar.png",
      "spine": { "front": { "skel": "spine/front/texas.skel", "atlas": "spine/front/texas.atlas", "textures": ["spine/front/texas.png"] } }
    }
  },
  "audio": { "voice": { "char_102_texas": { "skill1": "voice/skill1.mp3" } } }
}
```

then run `node tools/plugin.mjs pack plugins/<your-id>` (it writes `plugin.lock.json`: the files' hashes and each Spine
model's clips — needed for a model) and `node tools/plugin.mjs check <your-id>`.

**Never put files of the official game in a plugin.** Draw your own, or refer to what the installation has.

The format: `docs/PLUGINS.md` §9 (the asset overlay, references, files, the lock, the room's and the player's switches).
