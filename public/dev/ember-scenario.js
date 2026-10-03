// A fixed BattleSpec using the same full-content sim as normal matches.
export const EMBER_ENEMIES = Object.freeze({
  enemy_1288_duskls: '深池逐火战士',
  enemy_1288_duskls_2: '深池逐火精锐战士',
  enemy_1292_duskld: '深池逐火护卫',
});

export function createEmberScenario(sim, ds, { enemyKey = 'enemy_1288_duskls', blocker = true } = {}) {
  if (!Object.hasOwn(EMBER_ENEMIES, enemyKey)) throw new Error('Unknown ember enemy');
  const spec = sim.buildBattleSpec({
    battleId: 'dev.ember', fieldId: 'n:dev', seed: 7, stageId: 'act2autochess_m02', timeLimit: 300,
    players: [{ playerId: 'dev', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [],
      units: blocker ? [{ uid: 1, kind: 'chess', chessId: 'chess_char_1_02_a', row: 9, col: 8, dir: 'RIGHT' }] : [],
    }],
    spawns: [{ time: 0, enemyKey, routeIndex: 0, count: 1 }],
    routes: [{ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }],
  });
  const battle = sim.createBattleFromSpec(spec, ds, { quiet: true });
  battle.autoFinish = false;
  battle.step();
  // Suppress automatic attacks so each hit can be inspected separately; blocking remains active.
  const ally = battle.allies().find((u) => u.uid === 1);
  if (ally) battle.addBuff(ally, { key: 'dev:manual-hits', flags: { disarm: true, invulnerable: true } });
  return { battle, spec, enemy: battle.enemies[0], blocker: ally ?? null };
}
