// #746, maintainer decision 2026-10-18. [ASSUMED] Optional numeric HUD, default off: the official game has no
// countdown readout. Sources: activity_table.activity.AUTOCHESS_SEASON.act2autochess.bondInfoDict and
// server/sim/content/bonds/core.js. Sargon stacks expire independently; Siracusa's deploy ASPD, stealth and
// post-stealth proc window are separate effects. Add a declaration here to expose another mapped timed effect.
import { N_ } from './i18n.js';

export const BOND_TIMERS = Object.freeze([
  { id: 'sargon', label: N_('萨尔贡·技能增益'), buffKey: 'bond:sargon', stacked: true },
  { id: 'siracusaAspd', label: N_('叙拉古·部署攻速'), buffKey: 'bond:siracusa' },
  { id: 'siracusaStealth', label: N_('叙拉古·部署隐匿'), buffKey: 'bond:siracusa:stealth' },
  { id: 'siracusaAfter', label: N_('叙拉古·脱隐后触发窗口'),
    window: { start: 'siraStealthEnd', bondId: 'siracusaShip', effect: 'act2autochess_bond_eff_siracusa', duration: 'end_duration' } },
].map(Object.freeze));
