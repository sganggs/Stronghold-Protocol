# Regulation Sarkaz death summons (2026-11-13)

## Cause

The pinned table already contains the child ids and delays. However, `REGULATION_KITS` had no entries for child
soldiers / mechanics (both forms), bombardiers (both forms) or the bone defender. Their death events therefore had
no handler. Existing chain casters and hatred collectors did have death handlers, but `replaceLater` scheduled an
ordinary callback: with no living enemy or pending wave, `_checkEnd` cleared the field before the timer could run.
This second bug also affected the two rock spiders sharing the helper. It was not a missing art asset.

## Fix and sources

- Child soldiers and mechanics: `deathrattle.enemy_key`, `deathrattle.delay` (one child after one second).
- Bombardiers: `Attack.enemy_key`, `Attack.delay` (one child after one second), confirmed against PRTS's death talent;
  this does not implement their separate delayed-bomb attack.
- Bone defender: `Summon.enemy_key`, `Summon.cnt` (two Blood Ambers), using the existing bone torturer's stationary
  Blood Amber path. This does not implement its separate attack-speed debuff or anti-witchcraft bomb interactions.
- Punishers: PRTS describes replacement on death, with no one-second delay. Remove the old explicitly assumed delay.
- Delayed replacements use `after(..., { holdsBattle:true })`; zero delay spawns immediately. The hold exists only
  until the callback fires and does not extend the normal time limit. Existing children still have to be cleared.
- Only `reason:'killed'` triggers a summon. Leaks do not, and the death talent is not silenceable. The current helper
  preserves remaining routes, parent player attribution and stat modifiers, without copying bounty rewards or
  changing the wave capsule denominator. Exact native nearest-passable-tile placement / random scatter remains
  the pre-existing approximation; no new random draw or pathing rule is introduced here.

The [field receipt](sarkaz-death-spawns-20261113.json) contains the relevant pinned `6f63c14e` talent fields and
source URLs. Representative sources: [soldier](https://prts.wiki/w/萨卡兹子裔战士),
[mechanic](https://prts.wiki/w/萨卡兹子裔工匠), [bombardier](https://prts.wiki/w/萨卡兹子裔毁击者),
[punisher](https://prts.wiki/w/萨卡兹子裔责罚者), [bone defender](https://prts.wiki/w/萨卡兹骸骨卫士长).
The seven newly mapped ids occur only in the Regulation table among the installed official version datasets.
No generated JSON, old-season kit, global death dispatcher, other delayed FX or bounty pool is changed.

## Verification

The focused regression covers all twelve child-replacement variants, the bone defender's two stationary Blood
Ambers, silence, leaks, last-enemy completion, remaining routes, owner/source attribution, inherited stats and
non-duplicated bounty rewards, plus the shared four-child spider callback. Existing Regulation enemy tests also pass.
Full simulation/golden and browser verification remain deferred; expected golden files are not edited speculatively.
The upstream PR is limited to this death-summon lifecycle fix; deployment is outside its scope.
