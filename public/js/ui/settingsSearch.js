// Search the currently available, localized settings. Treat input literally; words narrow a result together.
export function settingsSearchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function matchesSetting(text, query) {
  const haystack = settingsSearchText(text);
  return settingsSearchText(query).split(' ').filter(Boolean).every(word => haystack.includes(word));
}
