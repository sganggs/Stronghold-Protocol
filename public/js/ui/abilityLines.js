// Enemy-card ability lines (detailPanel EnemyDetail). A line whose data format is SILENCE
// (折射: `<$ba.refraction>折射</>`, format "SILENCE") is off while the enemy is silenced: the card greys it.
// The sim already drops the RES bonus; this is only the line.

/**
 * @param {any[]|null} abilities enemies.json abilities
 * @param {boolean} silenced live unit (`unitStatsEntry.silenced`)
 * @returns {Array<{ text: string, off: boolean }>}
 */
export function abilityRows(abilities, silenced) {
  const list = Array.isArray(abilities) ? abilities : [];
  return list.map((a) => {
    const text = typeof a === 'string' ? a : (a && (a.textRaw || a.text)) || '';
    const off = !!(silenced && a && typeof a === 'object' && a.format === 'SILENCE');
    return { text, off };
  });
}
