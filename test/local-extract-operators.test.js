// Original synthetic fixtures only; no game install, network or UnityPy is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { skel } from './helpers/pluginFixtures.js';

const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);

function py(code) {
  const source = `import sys,json\nsys.path.insert(0, ${JSON.stringify(path.resolve('tools/local-extract'))})\nimport operators as op, extract as ex\n${code}`;
  const r = spawnSync(PY ?? 'python3', ['-B', '-c', source], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('operator plan names only exact base/E2 sprites and default battle Front/Back groups', () => {
  const [job] = py(`print(json.dumps(op.plan(['char_9001_test', '../char_9002_bad', 'char_x_custom', 'char_9001_test'])))`);
  assert.equal(job.bundle, 'chararts/char_9001_test.ab');
  assert.equal(job.prefab, '/char_9001_test/defaultskin.prefab');
  assert.deepEqual(job.pictures.avatar, { bundles: 'spritepack/ui_char_avatar_*.ab', names: { avatar: 'char_9001_test', avatarE2: 'char_9001_test_2' } });
  assert.deepEqual(job.pictures.portrait, { bundles: 'spritepack/char_portrait_*.ab', names: { portrait: 'char_9001_test_1', portraitE2: 'char_9001_test_2' } });
  assert.deepEqual(job.spines, { front: 'spine/char/char_9001_test/front', back: 'spine/char/char_9001_test/back' });
  const selected = py(`print(json.dumps([ex.wants_sub([], op.SUB), ex.wants_sub(['fx'], op.SUB), ex.spine_ids(['plugin-art/char_9001_test'], op.SUB, ['char_9001_test','char_9002_test'])]))`);
  assert.deepEqual(selected, [true, false, ['char_9001_test']]);
});

test('operator planner independently caps distinct operators, rather than duplicate requests', () => {
  const got = py(`ids=[f'char_{10000+i}_test' for i in range(600)]
print(json.dumps([j['id'] for j in op.plan(list(reversed(ids))+ids)]))`);
  assert.deepEqual(got, Array.from({ length: 256 }, (_, i) => `char_${10000 + i}_test`));
});

test('full extraction needs --plugin-art; explicit --only plugin-art also authorizes the local art job', t => {
  const f = fxFixture(t);
  const got = py(`from pathlib import Path
import contextlib,io
root=Path(${JSON.stringify(f.root)})
(root/'ui'/'autochess').mkdir(parents=True)
ex.export_bundle=lambda *a: 0
ex.export_enemy_spines=lambda *a: 0
ex.export_token_spines=lambda *a: 0
ex.export_scenes=lambda *a: 0
ex.versions.export=lambda *a: 0
ex.fx.export_fx=lambda *a,**k: 0
calls=[]
op.references=lambda *a: ['char_9001_test']
def export(*a):
 calls.append(a[-1]); return {},1
op.export=export
results=[]
for i,flags in enumerate([[],['--plugin-art'],['--only','plugin-art'],['--only','fx']]):
 calls.clear()
 sys.argv=['extract.py','--game',str(root),'--out',str(root/f'out{i}'),'--manifest',str(root/f'manifest{i}.json'),*flags]
 with contextlib.redirect_stdout(io.StringIO()): ex.main()
 results.append(list(calls))
print(json.dumps(results))`);
  assert.deepEqual(got, [[], [['char_9001_test']], [['char_9001_test']], []]);
});

test('sprite read, decode and save failures do not skip later requested operators in a bundle', t => {
  const f = fxFixture(t);
  const got = py(`from pathlib import Path
from types import SimpleNamespace as NS
root=Path(${JSON.stringify(f.root)})
p=root/'spritepack/ui_char_avatar_0.ab'; p.parent.mkdir(parents=True); p.touch()
bad='char_9001_bad'; good='char_9002_good'
stage='read'
class Image:
 width=2; height=2
 def __init__(self,name): self.name=name
 def save(self,p):
  if self.name==bad and stage=='save': raise OSError('synthetic save failure')
  Path(p).write_bytes(b'synthetic')
class Sprite:
 def __init__(self,name): self.m_Name=name
 @property
 def image(self):
  if self.m_Name==bad and stage=='decode': raise ValueError('synthetic decode failure')
  return Image(self.m_Name)
class Obj:
 type=NS(name='Sprite')
 def __init__(self,name): self.name=name
 def read(self):
  if self.name==bad and stage=='read': raise ValueError('synthetic read failure')
  return Sprite(self.name)
order=[bad,good]
sys.modules['UnityPy']=NS(load=lambda *a:NS(objects=[Obj(n) for n in order]))
sys.modules['aklz4']=NS()
results=[]
for stage in ['read','decode','save']:
 for order in [[bad,good],[good,bad]]:
  logs=[]; groups={}
  chars,n=op.export(root,root/f'out-{stage}-{order[0]}',groups,logs.append,[bad,good])
  results.append({'files':n,'good':bool(chars.get(good,{}).get('avatar')),'bad':bad in chars,'warnings':sum('warn' in s for s in logs)})
print(json.dumps(results))`);
  assert.deepEqual(got, Array.from({ length: 6 }, () => ({ files: 1, good: true, bad: false, warnings: 1 })));
});

test('partial manifest merge preserves other operators, old pictures, and unextracted battle directions', () => {
  const got = py(`old={'char_9001_test': {'avatar':'old', 'portrait':'keep', 'spine': {'front': {'skel':'old'}, 'back': {'skel':'keep'}}}, 'char_9002_test': {'avatar':'keep'}}
new={'char_9001_test': {'avatar':'new', 'spine': {'front': {'skel':'new'}}}}
print(json.dumps({'merged':op.merge_chars(old,new),'old':old,'groups':ex.merge_manifest({'other':{'a':1},'char/avatar/char_9002_test':{'b':2}},{'char/avatar/char_9001_test':{'c':3}}, {'char/avatar/char_9001_test'})}))`);
  assert.equal(got.merged.char_9001_test.avatar, 'new');
  assert.equal(got.merged.char_9001_test.portrait, 'keep');
  assert.equal(got.merged.char_9001_test.spine.back.skel, 'keep');
  assert.equal(got.merged.char_9002_test.avatar, 'keep');
  assert.equal(got.old.char_9001_test.avatar, 'old');
  assert.equal(Object.keys(got.groups).length, 3);
});

test('exporter writes only requested sprites and passes both complete model groups through the existing exporter', t => {
  const f = fxFixture(t);
  const got = py(`from pathlib import Path
from types import SimpleNamespace as NS
root=Path(${JSON.stringify(f.root)})
for rel in ['spritepack/ui_char_avatar_0.ab','spritepack/char_portrait_0.ab','chararts/char_9001_test.ab']:
 p=root/rel; p.parent.mkdir(parents=True,exist_ok=True); p.touch()
class Image:
 width=4; height=8
 def save(self,p): Path(p).write_bytes(b'original synthetic image')
class Obj:
 def __init__(self,name,kind='Sprite',pid=0): self.name=name; self.type=NS(name=kind); self.path_id=pid
 def read(self): return NS(m_Name=self.name,image=Image())
 def read_typetree(self): return {'synthetic':self.name}
def load(p):
 if 'chararts/' in p.replace('\\\\','/'): return NS(objects=[Obj('front','MonoBehaviour',1),Obj('back','MonoBehaviour',2)],container={'dyn/char_9001_test/defaultskin.prefab':Obj('prefab')})
 suffix='' if 'avatar' in p else '_1'
 return NS(objects=[Obj('char_9001_test'+suffix),Obj('char_9001_test_2'),Obj('char_9001_test_skin#1'),Obj('char_9002_other')])
sys.modules['UnityPy']=NS(load=load); sys.modules['aklz4']=NS()
ex.prefab_spine_nodes=lambda *a: [('Front',True,{'m_PathID':1}),('Back',True,{'m_PathID':2}),('Build',True,{'m_PathID':3})]
calls=[]
def write(objects,sda,sub,name,out,groups,log):
 calls.append(sub); d=Path(out)/sub; d.mkdir(parents=True,exist_ok=True)
 groups[sub]={}
 for file in ['unit.skel','unit.atlas','page.png','page2.png']:
  (d/file).write_bytes(b'synthetic'); groups[sub][file]={'path':'/assets/local/'+sub+'/'+file}
 return 4
ex.write_spine=write
op.subprocess.check_output=lambda *a,**k: b'{"anims":{"idle":"Idle"}}'
groups={}; chars,n=op.export(root,root/'out',groups,lambda *a:None,['char_9001_test'])
print(json.dumps({'chars':chars,'count':n,'calls':calls,'files':sorted(str(p.relative_to(root/'out')) for p in (root/'out').rglob('*') if p.is_file())}))`);
  assert.equal(got.count, 12);
  assert.equal(got.files.length, 12);
  assert.equal(got.calls.length, 2);
  const art = got.chars.char_9001_test;
  assert.ok(art.avatarE2 && art.portraitE2);
  for (const face of ['front', 'back']) {
    assert.equal(art.spine[face].textures.length, 2);
    assert.equal(art.spine[face].anims.idle, 'Idle');
  }
  assert.ok(got.files.every(p => !p.includes('skin') && !p.includes('other')));
});

test('Spine metadata bridge parses original synthetic skeletons with existing animation roles', t => {
  const f = fxFixture(t);
  f.put('unit.skel', skel({ animations: { Idle: [], Attack: [['OnAttack', 0.5]] } }));
  const r = spawnSync(process.execPath, ['tools/local-extract/plugin-art.mjs', '--spine', path.join(f.root, 'unit.skel')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(r.stdout);
  assert.equal(meta.pma, true);
  assert.equal(meta.anims.idle, 'Idle');
  assert.equal(meta.anims.attack.loop, 'Attack');
});
