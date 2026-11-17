// test/helpers/versionReplay.mjs — replay a test journal of an official version's match (DESIGN §35.23) in a process of
// its own, as server/match/testReplay.js asks: the version's data becomes this process's data singleton (server/data.js
// setData) and its official-bounds snapshot is installed — as in the version's match host (server/match/host/entry.js) —
// before the match code is imported.
//   node test/helpers/versionReplay.mjs <version id> <journal.json>   → stdout: { summary, version }
import fs from 'node:fs';

const [id, file] = process.argv.slice(2);
// a bare `node --test` also loads this helper as a test file, without arguments: nothing to replay
if (!id || !file) process.exit(0);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const { getVersionData, setData } = await import('../../server/data.js');
const data = setData(getVersionData(id, { log: quiet }));
const { installOfficialBounds, officialBoundsOf } = await import('../../shared/plugins/officialBounds.js');
installOfficialBounds(officialBoundsOf(data));
const { replayTestMatch } = await import('../../server/match/testReplay.js');
const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
let summary = null;
const m = replayTestMatch(data, entries, { onEnd: (s) => { summary = s; } });
process.stdout.write(JSON.stringify({ summary, version: m.version }));
m.dispose?.();
