// server/match/match/peek.js — Match 方法：同盟盟约速查浮窗的取值通道（peek）。
//
// 队伍面板的浮窗（public/js/ui/teamPanel.js BondsFlyout）在队友的战场不在屏上时拿不到对方的干员：
// m.public 是一条广播、永不携带名册（PR #922 批注），而 g.watch 一次只跟随一张战场。因此浮窗改为直接请求名册：
//
//   C→S  g.peek { open: true|false }   玩家展开 / 收起浮窗
//   S→C  m.peek { seq, ops: { [pid]: [{ id, golden? }] } }   展开时的快照：除自己外的所有座位
//        m.peek { seq, seat: pid, ops: [...] }                浮窗打开期间某一座位的名单发生变化
//
// 这是状态通道，与战场通道（g.watch → m.field / b.start / b.snap）分离：只传名册，不传战况，也不写
// MatchWatch.watchers。原版浮窗在任何时刻都能看到所有队友的干员，所以 `_peekVisible` 常开——除自己外的每个座位，
// 准备期、自己的战斗进行中、boss 轮跨组皆然（名册在这些窗口内是静态的，且准备期侦察本就看得到）。已淘汰的座位给
// `[]`（其 `_boardOps`）。观战席永远到不了本模块（MatchPlatform._handleSeatIntent 只放行 g.watch）。这里的内容不进
// m.public，也不落盘。载荷与 m.private 的 boardOps 完全同形（MatchViews._boardOps）：只含场上棋子，精简为
// `{ id, golden? }`，不含手牌 / 暂存 / 装备 / 召唤物 / 坐标。
//
// 订阅生命周期：`open: true` 订阅“当前回合 + 当前阶段”并回一次快照；`open: false`、离场、断线都会解除，回合 /
// 阶段变化也会在下一帧 flush 时解除（_flushPeek）——浮窗只是打开时那个准备 / 战斗窗口的一瞥，客户端在同一边界
// 主动收起（ui/teamPanel.js：阶段 key 与重连边沿）。服务端这半是冗余保险：客户端可能卡在打开状态（页面冻结、
// close 丢失）却仍然连着。每个订阅按座位记录“已发签名”，只有名单变化才推，座位退出可见集合时补一帧 `[]`。布局
// 变化每次 flush 只比一次（MatchMessaging.flush → _flushPeek），比较的是排序后的干员签名：挪动棋子不改变签名，
// 因此不推送。

import { OK } from './common.js';

/** 同一座位在该窗口内再次 open 视为重新渲染：只刷新订阅，不重发快照。 */
const PEEK_OPEN_DEBOUNCE_MS = 1000;

export class MatchPeek {
  /**
   * g.peek { open }（同盟盟约速查浮窗）。`open: true`：订阅当前回合 / 阶段，并单播一份可见座位的名册快照；
   * `open: false`：解除订阅。观战席到不了这里。回合或阶段变化会在下一帧 flush 时结束订阅（_flushPeek）。
   * @param {PlayerState} ps @param {boolean} open
   */
  peek(ps, open) {
    const now = this.sched.now();
    if (!this._peekSubs) this._peekSubs = new Map();
    if (!open) {
      this._peekSubs.delete(ps.playerId);
      this._peekOpenAt?.delete(ps.playerId);
      return OK;
    }
    const prev = this._peekSubs.get(ps.playerId);
    const same = prev && prev.round === this.round && prev.phase === this.phase;
    const sub = { round: this.round, phase: this.phase, known: same ? prev.known : new Map() };
    this._peekSubs.set(ps.playerId, sub);
    if (!this._peekOpenAt) this._peekOpenAt = new Map();
    const last = this._peekOpenAt.get(ps.playerId) || 0;
    this._peekOpenAt.set(ps.playerId, now);
    // 重新渲染会再 open 一次：第一个应答仍然有效。订阅已在上面刷新。
    if (now - last < PEEK_OPEN_DEBOUNCE_MS) return OK;
    this._sendPeek(ps.playerId, { ops: this._peekSnapshot(ps, sub) });
    return OK;
  }

  /** 除自己外的每个座位的精简名单，并写入订阅的 known 集合。 */
  _peekSnapshot(viewer, sub) {
    const ops = {};
    for (const ps of this.order) {
      if (!this._peekVisible(viewer, ps)) continue;
      const list = this._peekOps(ps);
      ops[ps.playerId] = list;
      sub.known.set(ps.playerId, this._peekSigOf(list));
    }
    return ops;
  }

  /**
   * 状态通道的策略：该观众能否看到这个座位的名册？原版浮窗在任何时刻都显示所有队友的干员，所以答案是
   * “除自己外的每个座位”——准备期、自己的战斗进行中、boss 轮跨组都一样（名册在这些窗口内是静态的，
   * 且准备期侦察本就看得到）。自己的座位永不入表，它走 m.private 的 boardOps。
   */
  _peekVisible(viewer, ps) {
    return !!ps && ps.playerId !== viewer.playerId;
  }

  /** 该座位的浮窗名单：取 `_boardOps`（只含场上棋子，字段记录的 char id + 精英位），
   *  并保持稳定顺序，使“同一个棋子挪到别的格子”仍是同一份名单。 */
  _peekOps(ps) {
    const list = this._boardOps(ps).map((u) => (u.golden ? { id: u.id, golden: 1 } : { id: u.id }));
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : (a.golden ? 1 : 0) - (b.golden ? 1 : 0)));
    return list;
  }

  /** 一个座位布局的身份：排序后的干员 id 与精英位（位置不参与）。 */
  _peekSigOf(list) { return list.map((u) => (u.golden ? `${u.id}*` : u.id)).join(','); }

  /** 解除某座位的订阅（离场、断线）：不再向它推送，并遗忘它的 known 集合。 */
  _peekForget(playerId) {
    this._peekSubs?.delete(playerId);
    this._peekOpenAt?.delete(playerId);
  }

  /**
   * 一次 flush 的布局差分（MatchMessaging.flush）：对每个订阅者，把它可见且签名变化的座位单播出去；
   * 已不可见的座位补一帧 `[]` 后从 known 删除。上一回合 / 阶段打开的订阅在此丢弃（浮窗的窗口已结束）。
   */
  _flushPeek() {
    const subs = this._peekSubs;
    if (!subs || subs.size === 0 || this.disposed) return;
    const stale = [];
    for (const [pid, sub] of subs) if (sub.round !== this.round || sub.phase !== this.phase) stale.push(pid);
    for (const pid of stale) { subs.delete(pid); this._peekOpenAt?.delete(pid); }
    if (subs.size === 0) return;

    const lists = new Map();
    const sigs = new Map();
    const listOf = (ps) => {
      if (!lists.has(ps.playerId)) {
        const list = this._peekOps(ps);
        lists.set(ps.playerId, list);
        sigs.set(ps.playerId, this._peekSigOf(list));
      }
      return lists.get(ps.playerId);
    };
    for (const [pid, sub] of subs) {
      const viewer = this.players.get(pid);
      if (!viewer || viewer.left || !viewer.connected) continue;
      const seen = sub.known;
      const live = new Set();
      for (const ps of this.order) {
        if (!this._peekVisible(viewer, ps)) continue;
        live.add(ps.playerId);
        const list = listOf(ps);
        const sig = sigs.get(ps.playerId);
        if (seen.get(ps.playerId) === sig) continue;
        seen.set(ps.playerId, sig);
        this._sendPeek(pid, { seat: ps.playerId, ops: list });
      }
      for (const known of [...seen.keys()]) {
        if (live.has(known)) continue;
        seen.delete(known);
        this._sendPeek(pid, { seat: known, ops: [] });
      }
    }
  }

  /** 单播一帧 m.peek；`seq` 是整局递增的计数器（新帧的序号一定更大）。 */
  _sendPeek(playerId, body) {
    this._peekSeq = (this._peekSeq || 0) + 1;
    this.sendTo(playerId, { t: 'm.peek', seq: this._peekSeq, ...body });
  }
}
