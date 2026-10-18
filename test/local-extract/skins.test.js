// test/local-extract/skins.test.js — tools/local-extract/skins.py 的纯逻辑（不读客户端）：
// skinId → stem、骨架名、落盘目录名，以及 skin_jobs 只保留"本机有 skinpack 且不是默认服装"的条目。
// 这些函数决定提取什么、写到哪里，和 extract.py 的 job 表同样是数据契约。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = process.env.PY || process.env.PYTHON || 'python';
const has = (() => {
  const r = spawnSync(PY, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
  return r.status === 0;
})();

const SCRIPT = `
import json, sys
sys.path.insert(0, r'${path.join(ROOT, 'tools', 'local-extract').replace(/\\/g, '\\\\')}')
import skins
table = {'charSkins': {
  'char_003_kalts@boc#6': {'charId': 'char_003_kalts', 'displaySkin': {'skinName': '残余', 'skinGroupName': '斗争血脉/VI'}},
  'char_003_kalts#1': {'charId': 'char_003_kalts', 'displaySkin': {'skinName': '', 'skinGroupName': '默认服装'}},
  'char_102_texas@epoque#7': {'charId': 'char_102_texas', 'displaySkin': {'skinName': '意志', 'skinGroupName': '时代/VII'}},
}}
jobs = skins.skin_jobs(table, {'char_003_kalts'})   # 只有 kalts 有 skinpack
print(json.dumps({
  'stem': skins.stem_of('char_003_kalts@boc#6'),
  'stem_none': skins.stem_of('char_003_kalts#1'),
  'skel': skins.skeleton_name('char_003_kalts', 'boc#6'),
  'dir': skins.dir_name('char_003_kalts', 'boc#6'),
  'jobs': jobs,
}, ensure_ascii=False))
`;

describe('skins.py 的提取契约（不读客户端）', { skip: !has && 'no python' }, () => {
  const out = spawnSync(PY, ['-c', SCRIPT], { encoding: 'utf8' });
  const r = out.status === 0 ? JSON.parse(out.stdout) : null;

  test('python 能导入 skins.py', () => {
    assert.equal(out.status, 0, out.stderr);
    assert.ok(r);
  });

  test('skinId → stem；骨架名与落盘目录名按官方命名', () => {
    assert.equal(r.stem, 'boc#6');
    assert.equal(r.stem_none, null, '没有 @ 的不是时装 id');
    assert.equal(r.skel, 'char_003_kalts_boc#6_SkeletonData');
    assert.equal(r.dir, 'char_003_kalts_boc_6', '文件名去掉 #');
  });

  test('只保留"本机有 skinpack"且不是默认服装的时装', () => {
    assert.equal(r.jobs.length, 1, JSON.stringify(r.jobs));
    assert.equal(r.jobs[0].skinId, 'char_003_kalts@boc#6');
    assert.equal(r.jobs[0].name, '残余');
    assert.equal(r.jobs[0].group, '斗争血脉/VI');
  });
});
