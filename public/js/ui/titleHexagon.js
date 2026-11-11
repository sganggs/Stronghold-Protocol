// Order and rotations from the official statistics template.
export const TITLE_HEX_SECTORS = [
  ['comment_4', 180], ['comment_5', 240], ['comment_6', 300],
  ['comment_1', 0], ['comment_2', 60], ['comment_3', 120],
];

/** Clipped fill in each wedge's local coordinates; zero has no active area. */
export function titleSectorClip(count, limit = 20) {
  const scale = Math.min(1, Math.max(0, count) / limit);
  if (!(scale > 0)) return null;
  const points = [
    [47, 0], [47 * (1 - scale), 93 * scale], [47 - 43 * scale, 100 * scale],
    [53 + 43 * scale, 100 * scale], [53 + 47 * scale, 93 * scale], [53, 0],
  ];
  return `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
}
