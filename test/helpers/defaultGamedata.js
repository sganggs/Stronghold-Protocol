// test/helpers/defaultGamedata.js — where the default build reads an official file: the commit its profile pins the
// file's group to (tools/versions/act2autochess.mjs, tools/versions/profiles.mjs pinnedShaOf), cached in
// .cache/gamedata@<sha>/, or .cache/gamedata/ (master) for a profile without pins. The tests that re-derive data/*.json
// from the raw tables read the same files the build read (DESIGN §37.91).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import profile from '../../tools/versions/act2autochess.mjs';
import { pinnedShaOf } from '../../tools/versions/profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The cached copy of an official file (path relative to zh_CN/gamedata/) the default build reads. */
export function defaultGamedataPath(rel) {
  const sha = pinnedShaOf(profile, rel);
  return join(ROOT, '.cache', sha ? `gamedata@${sha}` : 'gamedata', rel);
}

/** Whether every one of these official files is cached. */
export const hasDefaultGamedata = (...rels) => rels.every((rel) => existsSync(defaultGamedataPath(rel)));

/** Read and parse a cached official file. */
export const readDefaultGamedata = (rel) => JSON.parse(readFileSync(defaultGamedataPath(rel), 'utf8'));
