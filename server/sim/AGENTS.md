# Battle settlement

Call operations on `battle`; import helpers from [attack.js](attack.js), never `attack/` internals.

```js
battle.dealDamage({ source, target, amount: 100, type: 'arts' });
battle.dealElementDamage({ source, target, amount: 100, element: 'burn' });
battle.dealHPLose({ source, target, amount: 100 });
battle.heal({ source, target, amount: 100 });
battle.healElement({ target, amount: 100 }); // each gauge; add element to recover one
```

`source` is actual source; `credit` owns statistics/kills and defaults to it. Use `source: null, credit: owner` for attributed source-less damage.
True damage still passes injury effects; HP loss does not. `elemental` is HP damage, not gauge intake.
Choose hooks by calculation/output/injury/success/HP-change stage; `damaged` also includes zero damage and HP loss.
Use `forceAttack` for a complete attack. Parameters: [types](../../types/attack.js); mechanics: [SIM §4](../../docs/SIM.md#4-damage--heal-pipeline).
