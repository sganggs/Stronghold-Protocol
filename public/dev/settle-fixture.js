// Hand-authored settlement rows in server/match/results.js's wire shape; ids only, no official files/art.
// One operator with two items, one with one, and one with none exercise every equipment-slot state (#745).
export function equippedLineup() {
  return [
    { id: 'chess_char_1_01_b', golden: true, tier: 1, row: 9, col: 2, items: ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'] },
    { id: 'chess_char_1_02_a', golden: false, tier: 1, row: 10, col: 3, items: ['chess_item_1_01_e_b'] },
    { id: 'chess_char_1_01_a', golden: false, tier: 1, row: 11, col: 4, items: [] },
  ];
}
