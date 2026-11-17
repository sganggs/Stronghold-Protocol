// Healing, regeneration and overheal shields. Independent of the damage pipeline.

/**
 * Heal pipeline. Returns the HP actually restored. `noHeal` stops heals from others (`self` heals pass); `healFree` (禁疗,
 * PRTS 异常效果 HEAL_FREE "受到的治疗量变为0") stops the unit's own too — except an HP-regeneration attribute (`regen`:
 * "增减生命回复速度或生命回复速度（百分比）属性的效果不会被识别为治疗类能力") and a heal that ignores it (`ignoreHealFree`:
 * 史尔特尔 S3's start heal, PRTS "无视禁疗").
 * A `regen` tick (Battle status: the unit's own 生命回复速度, `s.hpRegen` — 吟游者 / 调香师 / 瑕光 S2 / 铃兰 S3 / 锡人 add to it
 * with an hpRegen buff, PRTS 备注 "不受治疗加成和禁疗影响") is no 治疗: no 治疗加成 scales it — neither the healing
 * multipliers nor a `heal` handler (handlers still see it, with `opts.regen`; a change they make to its amount is
 * ignored).
 * A healer whose profile names the target in `healThrough(healer, target)` heals it through its 禁疗 — the `noHeal` flag
 * a summon's 禁疗 sets and the flag `healFree` (not a profile's `noHeal`, 无法被友方治疗): 凯尔希 on her Mon3tr (PRTS
 * Mon3tr(凯尔希的召唤物) "持有禁疗（可被凯尔希…无视）"; her heal selection takes it too, Battle.injuredAlliesInKeys).
 */
export function heal(battle, source, target, amount, opts = {}) {
  if (!target || !target.alive || target.removed || !target.deployed || target.bossPool) return 0;
  const restore = opts.mode === 'restore';
  const self = source === target || !!opts.self;
  const through = !!(source && source.profile && typeof source.profile.healThrough === 'function' && source.profile.healThrough(source, target));
  if (!restore && !self && ((target.s.flags.noHeal && !through) || (target.profile && target.profile.noHeal))) return 0;
  const regen = !!opts.regen || opts.mode === 'regen';
  const bypassModifiers = regen || restore;
  if (target.s.flags.healFree && !bypassModifiers && !opts.ignoreHealFree && !through) return 0;
  let amt = bypassModifiers ? amount : amount * (source && source.s ? source.s.healingDealtMul : 1) * target.s.healingTakenMul;
  if (!(amt > 0) || !Number.isFinite(amt)) return 0;
  if (!restore && battle._hooks.heal) {
    const ctx = { source, target, amount: amt, opts };
    battle.emit('heal', ctx);
    if (!regen) amt = Number.isFinite(ctx.amount) ? Math.max(0, ctx.amount) : 0;
    // a handler may have killed / retreated the target: healing a dead unit would leave it "dead with hp > 0"
    if (!target.alive || !target.deployed) return 0;
  }
  const max = target.s.maxHp;
  const actual = Math.max(0, Math.min(amt, max - target.hp));
  target.hp = Math.min(max, target.hp + actual);
  if (!restore && opts.overheal && amt > actual) {
    // overheal becomes a shield (capped at max HP) so hp stays within [0, maxHp]
    const cur = target.findBuff('overheal');
    const val = Math.min(max, (cur ? cur.shield : 0) + (amt - actual));
    battle.addBuff(target, { key: 'overheal', shield: val, duration: opts.overhealDuration ?? Infinity });
  }
  if (source && !restore) {
    source.stats.heal += actual;
    if (source.side === 'ally' && source.ownerId != null) { const pp = battle._pp(source.ownerId); if (pp) pp.healingDone += actual; }
  }
  if (actual > 0 && battle._hooks.hpChanged) battle.emit('hpChanged', { source, credit: source, target, kind: restore ? 'restore' : regen ? 'regen' : 'heal', amount: actual, delta: actual });
  if (!bypassModifiers && amt > 0 && battle._hooks.modifierApplied) battle.emit('modifierApplied', {
    source, credit: source, target, kind: 'heal', amount: amt, hpRestored: actual, opts,
  });
  if (actual >= 0.5 && !opts.silent) battle._ev(['heal', target.id, Math.round(actual)]);
  return actual;
}
