// server/match/skillChange.js — the 指令 draft the 投机骰子 asks for (choice_event skill_change_1).
// The BANDS task owns the draft UI. Until that code replaces `openSkillChangeDraft`, the dice still resolves and the
// request is recorded on the player (`skillChange:<choice_event>`). [ASSUMED] consuming the dice without a draft is
// the stand-in; a later register of the real opener should replace this function, not the item handler.

/**
 * Open the 指令 draft named by the item's `choice_event`.
 * @param {object} ctx effect context
 * @param {string} choiceEvent official choice id (规程: skill_change_1)
 * @returns {boolean} true when a draft was actually opened
 */
export function openSkillChangeDraft(ctx, choiceEvent) {
  const name = typeof choiceEvent === 'string' && choiceEvent ? choiceEvent : 'skill_change_1';
  if (ctx && typeof ctx.setCounter === 'function') {
    const key = `skillChange:${name}`;
    const prev = typeof ctx.counter === 'function' ? ctx.counter(key) : 0;
    ctx.setCounter(key, (Number.isFinite(prev) ? prev : 0) + 1);
  }
  return false;
}
