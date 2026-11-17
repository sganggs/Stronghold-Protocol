// Maintainer decision 2026-10-23 (§35.66): until LLM-played seats clear 终极 near 100%, the external-AI /
// LLM integration stays on dev. Release zips (full, lite, update) and the Docker image omit the files below
// and carry server/release-without-llm. The #673 strategy framework and the built-in bots are not in this list.
// [ASSUMED] server/match/aiPlan.js and server/match/aiEconomy.js stay. The built-in bot calls them on the
// ordinary path (a missing plan is the no-plan result; ownsElite and the same helpers run without a host).
// Leaving them out would fork that bot. No host ships with them, so a release never attaches an external plan.
// tools/package.mjs re-exports the list and is the packager's copy of the decision.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Written into a release tree. A dev checkout does not have it. */
export const LLM_RELEASE_MARKER = 'server/release-without-llm';

/** The marker's bytes. The packager and omitLlmFromRelease write the same text. */
export const LLM_RELEASE_MARKER_TEXT = 'external AI is development-only (maintainer 2026-10-23, §35.66)\n';

/**
 * Files, and directory prefixes ending in `/`, that a release must not contain.
 * Exact paths are one file. A prefix drops the whole directory.
 */
export const LLM_RELEASE_EXCLUDE = Object.freeze([
  // server-side external AI host, transports, observations and the advisor knowledge
  'server/match/externalAI.js',
  'server/match/externalConfig.js',
  'server/match/aiDigest.js',
  'server/ai/transport.js',
  'server/ai/knowledge.js',
  'server/ai/playbook.js',
  'server/ai/strategy.js',
  'server/ai/strategy-community.js',
  'server/ai/community-candidates.js',
  'server/ai/cycle-candidates.js',
  'server/ai/cycles.js',
  // strategy docs (not player docs today; listed so a later allowlist cannot ship them)
  'docs/AI-STRATEGY.md',
  'docs/EXTERNAL_AI.md',
  'docs/EXTERNAL_AI_ZH.md',
  // example LLM agent and its knowledge / context / plan / playbook tools
  'tools/ai/',
  // committed example LLM fixture (test/ is already refused; listed with the rest of the integration)
  'test/fixtures/llm-advisor.json',
]);

/** @param {string} rel repository-relative path */
export function isLlmReleasePath(rel) {
  const p = String(rel).split('\\').join('/');
  return LLM_RELEASE_EXCLUDE.some((item) => (item.endsWith('/') ? p.startsWith(item) || p === item.slice(0, -1) : p === item));
}

/**
 * Delete the excluded files under `root` and write the release marker.
 * The packager and the Docker build call this on a copy. Never point it at a dev checkout.
 * @param {string} root
 */
export function omitLlmFromRelease(root) {
  for (const rel of LLM_RELEASE_EXCLUDE) rmSync(path.join(root, rel), { recursive: true, force: true });
  const marker = path.join(root, LLM_RELEASE_MARKER);
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, LLM_RELEASE_MARKER_TEXT);
}
