// Tools import this before the match/sim modules: one official data set per process/worker, like version hosts.
import { isMainThread, workerData } from 'node:worker_threads';
import { getVersionData, setData } from '../../server/data.js';
import { DEFAULT_VERSION, versionById } from '../../shared/versions.js';
import { rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';

const args = !isMainThread && workerData?.argv ? workerData.argv : process.argv.slice(2);
const index = args.indexOf('--version');
export const toolVersion = workerData?.version ?? (index < 0 ? DEFAULT_VERSION : args[index + 1]);
if (!versionById(toolVersion)) throw new RangeError(`Unknown --version: ${toolVersion}`);
if (toolVersion !== DEFAULT_VERSION) {
  const data = getVersionData(toolVersion);
  if (data.config?.version?.id !== toolVersion) throw new Error(`Missing built data for ${toolVersion}`);
  setData(data);
  rememberOfficialBounds(data);
}
