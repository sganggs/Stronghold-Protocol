// Continuous injury-effect coverage. A held buff keeps its acquisition order until coverage actually ends.
export function installInjuryAura(battle, source, { key, covers, effect, targets = () => battle.allyUnits }) {
  const sync = target => {
    const held = target.findBuff(key);
    if (covers(target)) {
      if (!held) battle.addBuff(target, { ...effect, key, source });
    } else if (held) battle.removeBuff(target, held);
  };
  const syncAll = () => { for (const target of targets()) sync(target); };
  for (const event of ['deploy', 'death', 'tick']) battle.on(event, syncAll, { owner: source });
  for (const event of ['skillStart', 'skillEnd']) battle.on(event, c => { if (c.unit === source) syncAll(); }, { owner: source });
  // Movement or another hook can change coverage within the same tick.
  battle.on('hit', c => { if (c.target) sync(c.target); }, { owner: source });
  syncAll();
}
