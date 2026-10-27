// Release gate for the external-AI / LLM integration (maintainer 2026-10-23, §35.66).
// A dev checkout has no marker and still has server/match/externalAI.js, so this module loads that
// implementation and the server behaves as before. A release package has the marker (and the
// implementation files are not in the package): external-AI configuration is ignored, one log line,
// and the built-in bot plays. The implementation URL is built at run time so the shipped source has
// no import specifier that names an excluded file (tools/package.mjs importProblems).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LLM_RELEASE_MARKER } from './llmRelease.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} [root] */
export function llmIntegrationEnabled(root = ROOT) {
  if (existsSync(path.join(root, LLM_RELEASE_MARKER))) return false;
  return existsSync(path.join(root, 'server/match/externalAI.js'));
}

/** Fixed for this process: the files next to this module, not a later cwd change. */
export const llmIntegrationEnabledNow = llmIntegrationEnabled();

/** One line. No URLs, commands or tokens. */
export const LLM_IGNORED_LOG = '[llm] external AI is development-only and is not in this release; ignoring the external-AI configuration and using the built-in bot';

let noted = false;

/** Log the ignore line once. `log.info` when the server has a logger; otherwise the console. */
export function noteLlmIgnored(log) {
  if (noted) return;
  noted = true;
  if (log && typeof log.info === 'function') log.info(LLM_IGNORED_LOG);
  else console.log(LLM_IGNORED_LOG);
}

/** True when a release package was given external-AI / LLM settings that must not take effect. */
export function releaseIgnoresExternalAi(env = process.env) {
  if (llmIntegrationEnabledNow) return false;
  // SP_BOT_STRATEGY_SEATS entries are seat:id (botStrategies.js getBotStrategySeats)
  const seatIds = String(env.SP_BOT_STRATEGY_SEATS || '').split(',').map((part) => part.slice(part.indexOf(':') + 1).trim());
  if (env.SP_BOT_STRATEGY === 'external' || seatIds.includes('external')) return true;
  return Object.keys(env).some((key) => (key.startsWith('SP_EXTERNAL_AI_') || key.startsWith('SP_LLM_')) && env[key]);
}

/** Load the host only when its file is present. A missing file is never imported. */
async function loadLlmImpl() {
  const host = await import(pathToFileURL(path.join(here, 'externalAI.js')).href);
  const config = await import(pathToFileURL(path.join(here, 'externalConfig.js')).href);
  return { ExternalAI: host.ExternalAI, EXTERNAL_BOT: host.EXTERNAL_BOT, externalConfig: config.externalConfig };
}

const llmImpl = llmIntegrationEnabledNow ? await loadLlmImpl() : null;

/** The registered external strategy, or null in a release package. */
export const EXTERNAL_BOT = llmImpl?.EXTERNAL_BOT ?? null;

/** Dev: validate SP_EXTERNAL_AI_* before listen. A release never calls this. */
export function validateExternalConfig() {
  if (!llmImpl) throw new Error('External AI is not in this build');
  return llmImpl.externalConfig();
}

/**
 * Attach the external host when this match selected it, as its strategy or for any seat (#816 P1: one host,
 * one SP_EXTERNAL_AI_* configuration, shared by every external seat). A release has no host, so this is null
 * (getBotStrategy has already mapped the id back to the built-in bot).
 * @param {{ bot?: { id?: string }, seatBots?: Record<string, { id?: string }> }} match
 * @param {{ externalAI?: object, externalReplay?: boolean }} [opts]
 */
export function createExternalAI(match, opts) {
  if (!llmImpl || ![match.bot, ...Object.values(match.seatBots ?? {})].some((s) => s?.id === 'external')) return null;
  return new llmImpl.ExternalAI(match, opts?.externalAI, opts?.externalReplay === true);
}
