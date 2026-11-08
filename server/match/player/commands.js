import { makeCtx } from '../effectsMeta.js';
import { useCommand, pickCommandDraft } from '../bandCommands.js';

export class PlayerCommands {
  useCommand(effectId, target) {
    const ctx = makeCtx(this.m, this, { kind: 'band', key: 'band:command', bandId: this.bandId }, 'onCommand');
    return useCommand(this, effectId, target, ctx);
  }

  pickCommand(id, idx) { return pickCommandDraft(this, id, idx); }

  autoPickCommands() {
    while (this.commandDrafts?.length) {
      const draft = this.commandDrafts[0];
      if (!this.pickCommand(draft.id, this.m.rngMeta.int(draft.cards.length)).ok) break;
    }
  }
}
