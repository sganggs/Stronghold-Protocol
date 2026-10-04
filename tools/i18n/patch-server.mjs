// OBSOLETE — do not run. Superseded by the language switch: the server sends Chinese templates + args (shared/i18n.js
// textMsg) and every client formats them in its own language (formatMsg); server/i18n.js is gone.
// One-off: translate the texts the server composes itself (toasts, ticker lines, bot names).
import fs from 'node:fs';

function patch(f, R, imp) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of R) {
    if (!s.includes(a)) { console.log('MISS', f, a.slice(0, 60)); continue; }
    s = s.split(a).join(b);
  }
  if (imp && !s.includes(imp)) {
    const i = s.indexOf('\nimport ');
    const j = s.indexOf('\n', i + 1);
    s = s.slice(0, j + 1) + imp + '\n' + s.slice(j + 1);
  }
  fs.writeFileSync(f, s);
}

patch('server/match/Match.js', [
  ['`${ps.name}博士中途退出了模拟`', '`Dr. ${ps.name} left the simulation`'],
  ["fail(ERR.BAD_TARGET, '队友已选')", "fail(ERR.BAD_TARGET, 'Already picked by a teammate')"],
  ["name: card.name ?? '悬赏'", "name: card.name ?? 'Bounty'"],
  ["`联防阶段：${plan.helpers.map((p) => p.name).join('、')} 迎战突破防线的敌人`", "`Unite Phase: ${plan.helpers.map((p) => p.name).join(', ')} take on the enemies that broke through`"],
  ["'你的目标生命值耗尽，已被淘汰'", "'Your LP ran out. You have been eliminated'"],
  ['`${ps.name}博士的目标生命值已耗尽`', '`Dr. ${ps.name} has run out of LP`'],
  ["this.tickerText('隐秘核心已解锁'", "this.tickerText('Hidden Core unlocked'"],
  ["this.sendTo(ps.playerId, { t: 'm.toast', kind, text });", "this.sendTo(ps.playerId, { t: 'm.toast', kind, text: tr(text) });"],
  ["const text = tpl.replace(/\\{(\\d)\\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));",
    "const text = tr(tpl).replace(/\\{(\\d)\\}/g, (_, i) => (args[Number(i)] != null ? String(tr(args[Number(i)])) : ''));"],
], "import { tr } from '../i18n.js';");

patch('server/match/PlayerState.js', [
  ["`地形变化：${names.join('、')}无法停留在原位置，已撤回整备区`", "`Terrain changed: ${names.map(tr).join(', ')} can no longer stay in place and returned to the Bench`"],
  ["'整备区已满，获得的干员已返还'", "'Bench is full. The obtained Operator was returned'"],
  ["'整备区已满，晋升的精锐干员无法放入'", "'Bench is full. The promoted Elite Operator cannot be placed'"],
  ["'整备区已满，获得的装备已销毁'", "'Bench is full. The obtained Equipment was destroyed'"],
  ["'整备区已满，合成的装备已销毁'", "'Bench is full. The combined Equipment was destroyed'"],
  ["`${back.join('、')}只能部署在召唤者攻击范围内，已退回整备区`", "`${back.map(tr).join(', ')} can only be deployed within the summoner's attack range; returned to the Bench`"],
  ["`${gone.join('、')}只能部署在召唤者攻击范围内，整备区已满，下回合返还`", "`${gone.map(tr).join(', ')} can only be deployed within the summoner's attack range; Bench is full, returned next round`"],
  ["name: b.card.name || '悬赏'", "name: b.card.name || 'Bounty'"],
  ["counterText: left == null ? '之后的每场作战' : `还剩 ${left} 场作战`", "counterText: left == null ? 'Every following battle' : `${left} battle${left === 1 ? '' : 's'} left`"],
], "import { tr } from '../i18n.js';");

patch('server/sim/content/bonds/addon/meta.js', [
  ['`【${label}】层数达成，下回合开始时获得${gain}资金`', '`[${label}] Stacks reached: gain ${gain} Funds at the start of next round`'],
  ['`【${label}】层数达成，获得${gain}资金`', '`[${label}] Stacks reached: gained ${gain} Funds`'],
  ["'【远见】所有干员购买价格永久降低' : '【远见】远见干员购买价格永久降低'", "'[Foresight] All Operators permanently cost less' : '[Foresight] Foresight Operators permanently cost less'"],
  ["C_VISI_PAID, '远见')", "C_VISI_PAID, 'Foresight')"],
  ["C_MIRA_PAID, '奇迹')", "C_MIRA_PAID, 'Marvel')"],
  ["'【奇迹】下次刷新不消耗资金'", "'[Marvel] Next refresh costs no Funds'"],
]);
patch('server/sim/content/bonds/core.js', [
  ['`【维多利亚】获得${granted}件维式重锤`', "`[Victoria] Gained ${granted} Victorian Hammer${granted === 1 ? '' : 's'}`"],
]);
patch('server/lobby.js', [
  ["['AI·华法琳', 'AI·阿米娅', 'AI·惊蛰', 'AI·杜宾', 'AI·凯尔希', 'AI·可露希尔']", "['AI·Warfarin', 'AI·Amiya', 'AI·Leizi', 'AI·Dobermann', \"AI·Kal'tsit\", 'AI·Closure']"],
]);
patch('server/match/choices.js', [
  ["{ bounty: '悬赏决策', supply: '道具补给', shop: '机密商店', tactic: '战术决策' }", "{ bounty: 'Bounty Decision', supply: 'Item Supply', shop: 'Secret Shop', tactic: 'Tactical Decision' }"],
]);
patch('server/match/StubMatch.js', [
  ["'对局核心尚未实现（平台占位 STUB）：全员确认本局信息或倒计时结束后将直接结算。'", "'Match core not implemented (STUB): the match settles once everyone confirms or the countdown ends.'"],
]);
patch('server/index.js', [
  ['<title>${status} · 卫戍协议：盟约</title>', '<title>${status} · Stronghold Protocol: Alliance</title>'],
  ['返回首页 · Back to home', 'Back to home'],
  ["'请求地址无效 · Bad request'", "'Bad request'"],
  ["'禁止访问 · Forbidden'", "'Forbidden'"],
  ["'页面不存在 · Not found'", "'Not found'"],
  ["'服务器内部错误 · Internal error'", "'Internal error'"],
  ["'请求地址过长 · URI too long'", "'URI too long'"],
  ["'不支持的请求方法 · Method not allowed'", "'Method not allowed'"],
  ['端口已被占用 / port in use:', 'Port in use:'],
  ['卫戍协议：盟约 · Stronghold Protocol: Covenant', 'Stronghold Protocol: Alliance'],
]);
