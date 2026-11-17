// #657 screenshots: COST gains, red COST deductions and cyan SP gifts above the operator.
// [ASSUMED] Source scope follows the maintainer's issue comment; pioneer skills are extra in non-official mode.
export function resourceFloat(event, settings) {
  if (settings?.damageNumbers === false || !Array.isArray(event) || event[0] !== 'resource') return null;
  const [, id, resource, amount, reason] = event;
  if (!Number.isFinite(amount) || amount === 0) return null;
  if (resource === 'sp') {
    if (amount < 0 || !['bond', 'talent', 'skill'].includes(reason)) return null;
  } else if (resource === 'cost') {
    if (amount < 0 ? reason !== 'merchant' : !['agent', 'charger', 'pioneer'].includes(reason)) return null;
    if (reason === 'pioneer' && settings?.officialDamageNumbers) return null;
  } else return null;
  // [ASSUMED] Up to two decimals when the remaining cap is fractional; never turn a partial receipt into a whole point.
  const n = Number(Math.abs(amount).toFixed(2));
  if (!n) return null;
  return { id, text: `${resource === 'sp' ? 'SP' : 'COST'} ${amount < 0 ? '−' : ''}${n}`,
    type: resource === 'sp' ? 'sp' : amount < 0 ? 'costLoss' : 'cost' };
}
