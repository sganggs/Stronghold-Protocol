// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no shared/randomMode.js, and copy it to
// public/shared/randomMode.js as well (the browser's /shared/ is that mirror in some setups).
// 无限火力 (a random mode of the original deployment) needs server support (room.setRandom). Without it the hub hides
// the 无限火力 entry by itself (lobby.js CAN_FIREPOWER); these values only let the module load — they are never shown.
export const RANDOM_MODE = Object.freeze({
  totalRounds: 0,
  endurance: Object.freeze({ totalRounds: 0, leaders: [] }),
  marathon: Object.freeze({ totalRounds: 0, leaders: [] }),
  rounds: Object.freeze({ leaders: [] }),
  unsupported: true,
});
export const RANDOM_MODE_NAME = '无限火力';
