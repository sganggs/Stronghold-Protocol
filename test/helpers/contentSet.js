// test/helpers/contentSet.js — run a case with the client's content set holding the given data files, then give the
// server's files back (data.setContent(null) restores the replaced entries and their language overlays).
//
// Shared by the shop card-model tests that install `chess` / `backups` / `assets` / `items` / `local` fixtures:
// the three copies this replaces drifted only in their ids.
import { data } from '../../public/js/data.js';

/**
 * @param {Record<string, any>} values data file name → the JSON the content set provides
 * @param {() => any} fn the case
 * @param {string} [id] a label for the set (debug only)
 * @returns {any} fn's result
 */
export function withContent(values, fn, id = 'test-content-set') {
  data.setContent({ id, values });
  try {
    return fn();
  } finally {
    data.setContent(null);
  }
}
