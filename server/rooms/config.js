export function roomProcessCount(value = process.env.SP_ROOM_PROCS ?? 1, warn = console.warn) {
  const n = Number(value);
  if (String(value).trim() === '' || !Number.isInteger(n) || n < 1 || n > 32) {
    warn('[rooms] SP_ROOM_PROCS must be an integer from 1 to 32; using 1');
    return 1;
  }
  return n;
}
