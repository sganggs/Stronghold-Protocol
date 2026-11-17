// Deterministic render fixtures complement version-assets.e2e's randomized real matches.
// Exercise every earlier-only body and all earlier-version summon bodies through the real field renderer,
// then every extracted earlier-only operator skill through the official effect wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { versionAssetData, presentationUnion, NO_SPINE_ENEMIES } from '../../tools/assets/versions.mjs';
import { spineEntry } from '../../public/js/assets.js';
import { Client, hasChrome, problemsOf, sleep } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const root = path.resolve(import.meta.dirname, '../..');
const sets = versionAssetData(root), current = presentationUnion([sets[0]]), earlier = presentationUnion(sets.slice(1));
const ops = Object.keys(earlier.operators).filter((id) => !current.operators[id]);
// (an enemy whose official prefab has no Spine — 淤困之茧 draws through effects — has no body to measure)
const enemies = Object.keys(earlier.enemies).filter((id) => !current.enemies[id] && !NO_SPINE_ENEMIES.has(id));
const assets = JSON.parse(readFileSync(path.join(root, 'data/assets.json'), 'utf8'));
const out = process.env.SP_VERSION_ASSET_SHOTS;
const shot = async (c, name) => { if (out) { mkdirSync(out, { recursive: true }); await c.page.screenshot({ path: path.join(out, name + '.png') }); } };

test('earlier-only bodies, attack/skill clips, summons and official skill/talent effects', { skip: !enabled, timeout: 5 * 60 * 1000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.url, 'version-models', { w: 1600, h: 900 });
  const results = { models: [], effects: [] };
  try {
    await c.open();
    await c.page.goto(`${srv.url}/dev/render-demo.html?scene=prep&paused=1&panel=0&board=2d`);
    await c.page.waitForFunction(() => globalThis.__demo?.ready, { timeout: 60000 });
    const local = await c.page.evaluate(async () => (await import('/js/assets.js')).assets.local());
    const tokens = Object.keys(earlier.tokens).filter((id) => spineEntry(assets, id, { local }));
    const ids = [...ops, ...enemies, ...tokens];
    for (let offset = 0; offset < ids.length; offset += 10) {
      const batch = ids.slice(offset, offset + 10);
      await c.page.evaluate((batch) => {
        const view = globalThis.__demo.view;
        const units = batch.map((id, i) => ({ id: i + 1, kind: id.startsWith('enemy_') ? 'enemy' : 'op',
          side: id.startsWith('enemy_') ? 'enemy' : 'ally', defId: id, name: id, spine: id, avatar: id,
          x: 1 + (i % 5) * 2, y: i < 5 ? 12 : 10, facing: 1, maxHp: 5000, tier: 3, skillIndex: 0 }));
        const rect = { r0: 9, r1: 12, c0: 0, c1: 10 };
        view.enterBattle({ fieldId: 'asset-coverage', kind: 'normal', rect, stageId: 'act1autochess_m01', units });
        view.setCamera('normal', { rect, instant: true });
        view.pushSnapshot({ t: 'b.snap', fieldId: 'asset-coverage', gt: 0,
          units: units.map((u) => [u.id, u.x, u.y, 5000, 5000, 0, 20, 0, 0]), dp: 10, killed: 0, total: units.length });
        view.debug.interp.snapToNewest();
      }, batch);
      await c.page.waitForFunction((n) => {
        const views = [...globalThis.__demo.view.debug.views.values()];
        return views.length === n && views.every((v) => v.spineReady && v.actor?.spine);
      }, { timeout: 30000 }, batch.length);
      await sleep(300);
      const observed = await c.page.evaluate(() => {
        const R = globalThis.__demo.view.debug, renderer = R.app.renderer;
        const all = [...R.views.values()];
        return all.map((v) => {
          // each body measured alone: a giant neighbour drawn over it (规程's enemy_9024_acsgnt over 一个小节 beside it)
          // would leave nothing of it to change (`renderable`: the others keep updating, only their drawing pauses)
          for (const o of all) if (o !== v) o.root.renderable = false;
          const a = v.actor, played = [];
          const textures = a.spine.skeleton.slots.map((s) => s.currentSprite || s.currentMesh).filter((s) => s?.texture);
          const b = v.bounds(), gl = renderer.gl, res = renderer.resolution;
          const x = Math.max(0, Math.floor(b.x * res)), y = Math.max(0, Math.floor(b.y * res));
          const w = Math.max(1, Math.min(Math.floor(b.width * res), renderer.view.width - x));
          const h = Math.max(1, Math.min(Math.floor(b.height * res), renderer.view.height - y));
          const pixels = () => { R.ctx.impostors?.flush?.(); renderer.render(R.app.stage); const p = new Uint8Array(w * h * 4);
            gl.readPixels(x, renderer.view.height - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
          const before = pixels(); v.root.visible = false; const after = pixels(); v.root.visible = true;
          for (const o of all) o.root.renderable = true;
          let changed = 0;
          for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 30) changed++;
          a.attack(1, true); a.update(0.1);
          played.push(a.spine.state.tracks[0]?.animation.name);
          for (const index of Object.keys(a.entry.anims.skills || {})) {
            a.setSkill(false); a.setSkillIndex(Number(index)); a.setSkill(true); a.attack(1, true); a.update(0.2);
            played.push(a.spine.state.tracks[0]?.animation.name);
          }
          return { id: v.info.defId, skel: a.entry.skel, played, drawn: changed / (w * h),
            textures: textures.length, valid: textures.every((s) => !s.texture.destroyed && s.texture.baseTexture?.valid),
            clips: played.every((name) => Object.hasOwn(a.entry.animations, name)) };
        });
      });
      results.models.push(...observed);
      for (const m of observed) assert.ok(m.valid && m.textures > 0 && m.clips && m.drawn > 0.005, JSON.stringify(m));
      await shot(c, `models-${offset / 10 + 1}`);
    }
    await c.page.goto(`${srv.url}/dev/fx-viewer.html?panel=0&grid=0&bg=%23404040&key=common_hit_01`);
    await c.page.waitForFunction(() => globalThis.__fx?.ready, { timeout: 60000 });
    for (const id of ops) for (const s of earlier.operators[id].skills) {
      const result = await c.page.evaluate(async (id, sk) => {
        const fx = globalThis.__fx;
        fx.clear(); fx.stopDemo(); fx.stopTicker(); fx.setLoop(false); fx.setTier('full');
        const plan = fx.skillDemo(id, { s: sk.index, sid: sk.prefabId, manual: true });
        fx.skillCmd('deploy'); fx.skillCmd('on'); fx.skillCmd('attack');
        const keys = new Set();
        for (let i = 0; i < 25; i++) {
          fx.render(); await new Promise((r) => setTimeout(r, 20));
          fx.step(1, 1 / 60);
          for (const key of fx.liveKeys()) keys.add(key);
        }
        return { id, skill: sk.skillId, plan: !!plan.plan, keys: [...keys], stats: fx.stats() };
      }, id, s);
      results.effects.push(result);
      assert.ok(result.plan, JSON.stringify(result));
      if (['char_198_blackd', 'char_215_mantic', 'char_355_ethan'].includes(id)) await shot(c, `effects-${id}-s${s.index + 1}`);
    }
    assert.ok(results.effects.filter((r) => r.keys.some((k) => !k.startsWith('common_'))).length >= 20,
      'operator effects play in addition to shared birth/hit effects; shared stat buffs may have no unique effect');
    if (out) writeFileSync(path.join(out, 'models-effects.json'), JSON.stringify(results, null, 2) + '\n');
    assert.deepEqual(problemsOf([c]), []);
  } catch (e) { await shot(c, 'models-effects-failure').catch(() => {}); throw e;
  } finally { await c.close(); await srv.close(); }
});
