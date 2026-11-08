// Offline presentation coverage, including records whose chess ids collide across official seasons.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionAssetData, presentationUnion, EFFECT_TOKENS, ONE_FACING_OPERATORS } from './versions.mjs';
import { EXPECTED_LOCAL_GROUPS } from '../local-extract/expected.mjs';
import { localFxIndexPath } from './cache.mjs';
import { avatarUrl, portraitUrl, spineEntry, unitPictureUrl } from '../../public/js/assets.js';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const optionalLocal = (root) => existsSync(join(root, 'data/local-assets.json')) ? read(join(root, 'data/local-assets.json')) : { groups: {} };

export function assetCoverage({ root, sets = versionAssetData(root), assets = read(join(root, 'data/assets.json')),
  local = optionalLocal(root), fx = null, files = false }) {
  const rows = [];
  const fileErrors = [];
  const present = (url) => typeof url === 'string' && !!url && (!files || existsSync(join(root, 'public', url)));
  if (files && fx) {
    const manifestPath = join(root, 'data/local-fx.json');
    if (!existsSync(manifestPath)) fileErrors.push('data/local-fx.json');
    else {
      const visit = (v) => {
        if (typeof v === 'string' && v.startsWith('/assets/') && !present(v)) fileErrors.push(v);
        else if (v && typeof v === 'object') for (const child of Object.values(v)) visit(child);
      };
      visit(read(manifestPath));
    }
  }
  const model = (sp) => !!sp && [sp.skel, sp.atlas, ...(sp.textures || [])].every(present)
    && !!sp.textures?.length && Object.hasOwn(sp.animations || {}, sp.anims?.idle);
  const clips = (sp) => {
    if (!sp) return false;
    const roles = [sp.anims?.attack, ...Object.values(sp.anims?.skills || {})];
    return roles.every((r) => !r || ['begin', 'loop', 'end', 'idle'].every((k) => !r[k] || Object.hasOwn(sp.animations || {}, r[k])));
  };
  const status = (ok) => ok ? 'ok' : 'MISSING';
  const spine = (id) => spineEntry(assets, id, { local }) || (!files && (assets.tokens?.[id]?.spineLocal || assets.enemies?.[id]?.spineLocal));
  for (const d of sets) {
    const add = (kind, id, name, checks, notes = '') => rows.push({ version: d.version.id, label: d.version.label,
      kind, id, name: name || '', checks, missing: Object.entries(checks).filter(([, v]) => v === 'MISSING').map(([k]) => k), notes });
    const all = presentationUnion([d]);
    const opChecks = (id, rec) => {
      const art = assets.chars?.[id], sp = spineEntry(assets, id);
      const checks = { avatar: status(present(avatarUrl(assets, id))), portrait: status(present(portraitUrl(assets, id))),
        front: status(model(sp)), clips: status(!!sp && clips(sp)),
        back: art?.spine?.back ? status(model(art.spine.back) && clips(art.spine.back))
          : rec.subProfessionId === 'bard' || ONE_FACING_OPERATORS.has(id) ? 'one-facing prefab' : 'MISSING',
        skills: status((rec.skills || []).every((s) => present(assets.skills?.[s.iconId]))),
        illustration: art?.illust ? status(present(art.illust)) : 'portrait fallback (same as default)',
        outfits: Object.keys(art?.skins || {}).length || 'cosmetic plugin (same as default)' };
      // Reserve operators and Amiya forms use their base picture as the golden picture in today's data.
      const records = [...Object.values(d.chess || {}), ...Object.values(d.backups?.units || {})].filter((c) => c.charId === id);
      if (records.some((c) => c.assets?.avatarGolden?.endsWith('_2') || c.isGolden && c.assets?.avatar?.endsWith('_2'))) {
        checks.avatarE2 = status(present(art?.avatarE2));
        checks.portraitE2 = status(present(art?.portraitE2));
      }
      if (fx) checks.fx = status(!!fx.units?.[id]);
      return checks;
    };
    for (const [id, rec] of Object.entries(all.operators)) add('operator', id, rec.name, opChecks(id, rec));
    for (const sk of new Map(Object.values(all.operators).flatMap((o) => o.skills).map((s) => [s.iconId, s])).values()) {
      add('skill', sk.iconId, '', { icon: status(present(assets.skills?.[sk.iconId])) });
    }
    for (const type of all.moduleTypes) add('module', type, '', { icon: status(present(assets.modules?.[type])) });
    for (const [id, rec] of Object.entries(d.chess)) {
      add('chess', id, rec.name, rec.charId ? opChecks(rec.charId, all.operators[rec.charId]) : {},
        rec.charId || 'selection placeholder; resolves after choosing an operator');
    }
    for (const [id, rec] of Object.entries(all.tokens)) {
      const checks = { picture: status(present(unitPictureUrl(assets, id))),
        model: EFFECT_TOKENS.has(id) ? 'effect/marker (same as default)' : status(model(spine(id))) };
      if (fx) checks.fx = status(!!fx.units?.[id]);
      add('token', id, rec.name, checks);
    }
    for (const [id, rec] of Object.entries(d.enemies)) {
      const sp = spine(id);
      const checks = { icon: status(present(assets.enemies?.[id]?.icon)), model: status(model(sp)), clips: status(clips(sp)) };
      if (id === 'enemy_9016_acstmr') Object.assign(checks, { model: 'icon diamond (same as default)', clips: 'no Spine (same as default)' });
      // The official enemy_9036_acweb prefab draws its cocoon through effects, with no Spine renderer.
      if (id === 'enemy_9036_acweb') Object.assign(checks, { model: 'effect-only prefab', clips: 'no Spine in client' });
      if (fx) checks.fx = status(!!fx.units?.[id]);
      add('enemy', id, rec.name, checks, assets.enemies?.[id]?.spineAliasOf ? `existing alias: ${assets.enemies[id].spineAliasOf}` : '');
    }
    for (const kind of ['items', 'bands', 'bonds']) for (const [id, rec] of Object.entries(d[kind])) {
      add(kind.slice(0, -1), id, rec.name, { icon: status(present(assets[kind]?.[kind === 'items' ? rec.iconId : id])) });
    }
    for (const [id, rec] of Object.entries(d.bosses)) {
      add('boss', id, rec.name, { icon: status(present(assets.enemies?.[rec.enemyKey]?.icon)),
        model: status(model(spine(rec.enemyKey))) }, rec.enemyKey);
    }
    for (const [id, rec] of Object.entries(d.stages)) {
      const scene = Object.values(local.groups?.[`scene/${id}`] || {}).find((r) => r.kind === 'Scene');
      add('stage', id, rec.name, { scene: /_escaped_/.test(id) ? 'shared board (same as default)'
        : status(files ? present(scene?.path) : EXPECTED_LOCAL_GROUPS.includes(`scene/${id}`)) });
    }
  }
  const missing = rows.filter((r) => r.missing.length);
  return { rows, missing, fileErrors, versions: sets.map((d) => ({ id: d.version.id, label: d.version.label,
    records: rows.filter((r) => r.version === d.version.id).length,
    missing: missing.filter((r) => r.version === d.version.id).length })) };
}

export function coverageMarkdown(result) {
  const lines = ['# Official-version presentation inventory', '',
    'Every chess, operator (including backups/DIY), token, enemy, item, band, bond, boss and stage is listed.',
    'Pictures are base/E2 avatars and half-body portraits. Full illustrations and outfits are optional cosmetic-plugin art in today’s manifest too.',
    'Model checks cover the skeleton, atlas, pages, idle and declared attack/skill clips. FX means an indexed official unit, including skill/talent mappings; browser playback is reported separately.', '',
    '| Version | Records | Records with gaps |', '|---|---:|---:|',
    ...result.versions.map((v) => `| ${v.label} | ${v.records} | ${v.missing} |`)];
  for (const v of result.versions) {
    lines.push('', `## ${v.label}`, '', '| Kind | Record | Name | Presentation | Identity / notes |', '|---|---|---|---|---|');
    for (const r of result.rows.filter((r) => r.version === v.id)) {
      lines.push(`| ${r.kind} | ${r.id} | ${r.name.replaceAll('|', '/')} | ${Object.entries(r.checks).map(([k, s]) => `${k}: ${s}`).join('; ')} | ${r.notes} |`);
    }
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const value = (key) => args.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const root = resolve(value('root') || fileURLToPath(new URL('../..', import.meta.url)));
  const baseline = value('baseline');
  const files = args.includes('--files');
  const result = assetCoverage({ root, files,
    ...(baseline ? { assets: read(join(baseline, 'assets.json')), local: read(join(baseline, 'local-assets.json')) } : {}),
    fx: args.includes('--fx') ? read(baseline ? join(baseline, 'index.json') : localFxIndexPath(root)) : null });
  if (value('json')) writeFileSync(value('json'), JSON.stringify(result, null, 2) + '\n');
  if (value('markdown')) writeFileSync(value('markdown'), coverageMarkdown(result));
  for (const v of result.versions) console.log(`${v.label}: ${v.records} records, ${v.missing} with missing assets`);
  for (const r of result.missing.slice(0, 30)) console.error(`${r.label} ${r.kind} ${r.id}: ${r.missing.join(', ')}`);
  for (const file of result.fileErrors.slice(0, 30)) console.error(`missing FX file: ${file}`);
  process.exitCode = result.missing.length || result.fileErrors.length ? 1 : 0;
}
