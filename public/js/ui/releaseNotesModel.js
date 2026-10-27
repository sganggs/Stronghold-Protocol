// #603: the shipped CHANGELOG is the source; unreleased/future sections are never shown for an older binary.
export const RELEASE_SEEN_PREFIX = 'sp.pref.release-seen.';

export function releaseSections(markdown, version) {
  const sections = [];
  let current;
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^## (\d+\.\d+\.\d+)(?:-dev)? — (.+)$/);
    if (heading) {
      current = { version: heading[1], title: line.slice(3), body: '' };
      sections.push(current);
    } else if (current) current.body += `${line}\n`;
  }
  const index = sections.findIndex((s) => s.version === version.replace(/-dev$/, ''));
  return index < 0 ? [] : sections.slice(index);
}

// Only links to http(s), or repository documents resolved against GitHub; no raw HTML is ever rendered.
export function releaseLink(raw) {
  if (/^(?:https?:\/\/|(?:docs\/|README\.md|CHANGELOG\.md|NOTICE\.md))/.test(raw)) {
    try { return new URL(raw, 'https://github.com/sganggs/Stronghold-Protocol/blob/master/').href; } catch { /* text only */ }
  }
  return null;
}
