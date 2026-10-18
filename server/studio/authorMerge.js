// A form edits the delta between two generated views, never replaces a document.
import { parseExpressionAt } from 'acorn';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const identity = (x, i) => object(x) && (x.id || x.charId)
  ? JSON.stringify([x.file, x.id, x.charId, x.op, x.path]) : x === null || typeof x !== 'object' ? JSON.stringify(x) : String(i);

// Removing an authored entry must not remove additional hand-authored content in that entry/file.
// Keep the enclosing identity/version keys; if the remainder cannot stand alone, full validation refuses the save.
export function removeAuthorOwned(current, before) {
  if (equal(current, before)) return undefined;
  if (Array.isArray(current) && Array.isArray(before)) {
    const old = new Map(before.map((x, i) => [identity(x, i), x]));
    const out = current.map((x, i) => old.has(identity(x, i)) ? removeAuthorOwned(x, old.get(identity(x, i))) : x).filter(x => x !== undefined);
    return out.length ? out : undefined;
  }
  if (object(current) && object(before)) {
    const out = {};
    for (const [key, value] of Object.entries(current)) {
      const remaining = Object.hasOwn(before, key) ? removeAuthorOwned(value, before[key]) : value;
      if (remaining !== undefined) out[key] = remaining;
    }
    if (!Object.keys(out).length) return undefined;
    for (const key of ['op', 'file', 'id', 'charId', 'path', 'records', 'patch', 'dsl', 'pluginId'])
      if (Object.hasOwn(current, key)) out[key] = current[key];
    return out;
  }
  return current;
}

export function mergeAuthorValue(current, before, after) {
  if (equal(before, after)) return current;
  // An untouched value can take the new value directly, including ordered tuples such as rangeGrid.
  if (equal(current, before)) return after;
  if (object(before) && object(after) && object(current)) {
    const out = { ...current };
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (equal(before[key], after[key])) continue;
      if (!Object.hasOwn(after, key)) {
        const remaining = removeAuthorOwned(current[key], before[key]);
        if (remaining === undefined) delete out[key]; else out[key] = remaining;
      }
      else out[key] = mergeAuthorValue(current[key], before[key], after[key]);
    }
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after) && Array.isArray(current)) {
    const old = new Map(before.map((x, i) => [identity(x, i), x]));
    const next = new Map(after.map((x, i) => [identity(x, i), x]));
    const seen = new Set(), out = [];
    current.forEach((x, i) => {
      const key = identity(x, i); seen.add(key);
      if (!old.has(key)) out.push(x);
      else if (next.has(key)) out.push(mergeAuthorValue(x, old.get(key), next.get(key)));
      else {
        const remaining = removeAuthorOwned(x, old.get(key));
        if (remaining !== undefined) out.push(remaining);
      }
    });
    after.forEach((x, i) => { if (!seen.has(identity(x, i))) out.push(x); });
    return out;
  }
  return after;
}

/** JSON.parse is the admission gate; Acorn supplies source ranges only, never executes input.
 * Unchanged values, keys, escapes, numeric spellings and whitespace keep their original bytes.
 * [ASSUMED] New members use compact JSON and the neighbouring indentation.
 */
export function reviseJson(text, value) {
  const current = JSON.parse(text), tree = parseExpressionAt(text, 0, { ecmaVersion: 'latest' });
  const render = (node, old, next) => {
    if (equal(old, next)) return text.slice(node.start, node.end);
    const array = Array.isArray(old) && Array.isArray(next);
    if (!(object(old) && object(next)) && !array) return JSON.stringify(next);
    const children = array ? node.elements : node.properties;
    const keys = array ? old.map(identity) : children.map(p => p.key.value);
    const entries = array ? next.map((x, i) => [identity(x, i), x]) : Object.entries(next);
    const fragments = entries.map(([key, v]) => {
      const i = keys.indexOf(key), child = children[i];
      const lead = i < 0 ? '' : text.slice(i ? children[i - 1].end : node.start + 1, child.start).replace(',', '');
      if (!child) return `${lead}${array ? '' : JSON.stringify(key) + ':'}${JSON.stringify(v)}`;
      return lead + (array ? render(child, old[i], v)
        : text.slice(child.start, child.value.start) + render(child.value, old[key], v));
    });
    const tail = text.slice(children.at(-1)?.end ?? node.start + 1, node.end - 1);
    return (array ? '[' : '{') + fragments.join(',') + tail + (array ? ']' : '}');
  };
  return text.slice(0, tree.start) + render(tree, current, value) + text.slice(tree.end);
}

export function mergeAuthorText(text, before, after) {
  return reviseJson(text, mergeAuthorValue(JSON.parse(text), before, after));
}

// The existing widget form owns these three spans; custom markup around them survives.
export function mergeWidgetText(text, before, after) {
  for (const pattern of [/<title>[\s\S]*?<\/title>/, /<div id="label">[\s\S]*?<\/div>/, /slot: '[^']*'/]) {
    const old = before.match(pattern)?.[0], next = after.match(pattern)?.[0];
    if (old !== next && next) text = text.replace(pattern, () => next);
  }
  return text;
}
