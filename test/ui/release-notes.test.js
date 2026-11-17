import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../../shared/constants.js';
import { releaseSections, releaseLink } from '../../public/js/ui/releaseNotesModel.js';

test('release sections start at the running version, excluding future notes and code headings', () => {
  const log = '## 0.3.4 — 未发布\nFuture\n## 0.3.3 — today\n### Fixes\n- a\n```\n## 1.0.0 — example\n```\n## 0.3.2 — yesterday\nOld';
  const sections = releaseSections(log, '0.3.3');
  assert.deepEqual(sections.map((s) => s.version), ['0.3.3', '0.3.2']);
  assert.match(sections[0].body, /## 1.0.0/);
  assert.deepEqual(releaseSections(log, '9.0.0'), []);
  assert.equal(releaseSections(readFileSync('CHANGELOG.md', 'utf8'), APP_VERSION)[0].version, APP_VERSION);
});

test('release links reject active content and resolve repository docs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '#anchor']) assert.equal(releaseLink(url), null);
  assert.equal(releaseLink('https://prts.wiki/w/机制'), 'https://prts.wiki/w/%E6%9C%BA%E5%88%B6');
  assert.equal(releaseLink('docs/PLAYING.md'), 'https://github.com/sganggs/Stronghold-Protocol/blob/master/docs/PLAYING.md');
});
