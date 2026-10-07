# 开发用发牌 / 改资金端点（本地）

`server/dev-grant.js` 提供的一个**默认关闭**的调试通道：给玩家发干员、改资金。它存在的原因是
房间只存在于这个进程的内存里，而协议（`shared/protocol.js`）没有任何发放/调试/管理消息，所以
没有正规办法在对局中途给玩家发牌。

0.2.0 把服务器入口拆开了：路由挂在 `server/http/routes.js`（`GET /dev/grant` 与 `/healthz` 并列），
开关与接线在 `server/index.js`（`SP_DEV_GRANT=1` 才 `createDevGrantHandler`）。

## 启动

必须带 `SP_DEV_GRANT=1`，否则路由根本不注册（`/dev/grant` 就是普通静态 404）。

```powershell
cd <仓库根目录>
$env:SP_DEV_GRANT=1
node server/index.js
```

启动后日志会有一条显眼的警告：

```
[dev-grant] ENABLED (SP_DEV_GRANT=1): GET /dev/grant from this machine can hand operators to a player
```

## 用法

```powershell
# 先看有哪些房间和对局（不带任何动作参数就是发现模式）
curl.exe "http://127.0.0.1:3000/dev/grant"

# 发干员
curl.exe "http://127.0.0.1:3000/dev/grant?chess=chess_char_5_01_b"
curl.exe "http://127.0.0.1:3000/dev/grant?chess=chess_char_5_02_a&count=3"   # 3 张自动合成精锐

# 改资金
curl.exe "http://127.0.0.1:3000/dev/grant?funds=99"        # 设成确切的 99
curl.exe "http://127.0.0.1:3000/dev/grant?fundsAdd=50"     # 加 50（可负数）

# 多人 / 多房间时定位
curl.exe "http://127.0.0.1:3000/dev/grant?chess=...&room=DLVF&player=p_xxxx"
```

| 参数 | 说明 |
|---|---|
| `chess=<id>[,<id>…]` | 要发的干员 id（可多个，逗号分隔） |
| `count=N` | 每个 id 连发 N 张（1–50，默认 1）。N=3 会自动合成精锐 |
| `funds=N` | 资金设成确切的 N |
| `fundsAdd=N` | 资金加 N（负数为减） |
| `room=CODE` | 多房间时指定房间码（大小写不敏感） |
| `player=ID` | 多人局指定玩家（单人局可省略） |
| `toTemp=1` | 强制进暂存区而不是手牌 |

## 四道安全锁

1. **默认关闭** —— 没有 `SP_DEV_GRANT=1` 就不注册路由（`server/index.js` 只在开关打开时才
   `createDevGrantHandler`，`server/http/routes.js` 也只在这个 handler 存在时接 `/dev/grant`）
2. **仅本机** —— 非回环来源一律 403（即使开了开关）。LAN 和公网都进不来
3. **走正规门** —— 干员走 `PlayerState.acquireChess`（`server/match/player/acquire.js`），资金走
   `PlayerState.addFunds`（`server/match/player/economy.js`），和购买 / 奖励 / 效果同一条路径：
   扣共享池份数、处理整备区溢出、合成照常出精锐、`gainedChess` / `fundsGained` 统计照常更新。
   **不直接写棋盘状态**，所以 `server/match/invariants.js` 与 `server/match/audit.js` 依然成立
4. **对局中拒绝** —— 只放行 `PREP` / `SETTLE`。原因很具体：`acquireChess` 唯一无法保证
   安全的情况是**发牌正好凑齐合成**，此时 `_mergeChess` 会把精锐强行推上棋盘，而客户端
   正在跑这一回合，审计（`server/match/audit.js`）会记成异常。其他阶段返回 409 并告知当前阶段

## 已知陷阱

- **`funds=+50` 会被拒绝**（409，资金不变）。URL 查询串里的 `+` 会解码成空格，`Number(' 50')`
  恰好等于 50，所以它会静默变成「设成 50」。加法必须用 `fundsAdd=`。校验针对**原始值**，
  带 `+`、带空格、带符号一律拒绝且不写入任何东西。
- **资金只在这一回合有效。** `economy.leftoverFundsLost: true` —— 休整期结束时没花完的资金会
  被清零（只有 `band_cannot` 策略保留）。这是官方规则，端点没有绕开它。
- **精锐干员会扣 `goldenCopies`=3 份池子**（普通扣 1 份）。这是正规合成路径的记账方式，
  不是凭空造牌，所以商店剩余概率保持正确。5 阶角色每局池子 8 份。

## 常用干员 id

| 干员 | id | 阶 | 备注 |
|---|---|---|---|
| 缇缇 | `chess_char_5_02_a` | 5 | 精锐 `_b`；带 `garrison_125_a` |
| 圣约送葬人 | `chess_char_5_01_a` | 5 | 精锐 `chess_char_5_01_b` |
| 风丸 | `chess_char_2_11_a` | 2 | **只需 2 张合成**（全干员唯一例外） |
| 跃跃 | `chess_char_1_09_a` | 1 | |

完整 id 表在 `data/chess.json`。精锐形态的 id 一律是普通 id 把结尾 `_a` 换成 `_b`。

## 测试

`node --test test/dev-grant.test.js` —— 10 条：开关解析、四种非回环地址全被拒、发现模式、
正规门参数、立即 flush、各阶段放行/拒绝、未知 id / 手牌满 / 无对局 / 多房间歧义 / 玩家不存在、
资金三个参数形态与三种畸形输入。

---

## 实测补充：共享池份数**不是**这条端点的约束（2026-10-07）

文档上面写着"精锐干员会扣 `goldenCopies`=3 份池子 / 一局最多一只精锐"——那是**商店与合成**那条路的记账规则。
**实测 `/dev/grant` 本身不校验、也不受共享池上限约束**：

```
GET /dev/grant?chess=chess_char_6_21_b&count=8&room=XADF
  → {"ok":true,"granted":[{"id":"chess_char_6_21_b","count":8}]}
```

6 阶干员在共享池里只有 **5 份**（`economy.poolCopies[6] = 5`），一只精锐按商店路径要占 **3 份**，
所以商店/合成路径下**一局最多 1 只精锐**（买/合成会正确地 `SOLD_OUT`）；而这条开发端点一次发了 8 只（= 24 份）。

**含义**：
- 开发端点发放**不代表**该数量在正常玩法里可得；用它做"发放几只"的沙盒没问题，但**不要用它推断商店概率**。
- 被这样发放过的房间，其**池子账目不真实**（她那一项可能已空或为负），该局的商店刷新概率随之失真；
  `matchrun` 的引擎不变量**不**检查这一项，所以不会报错。
- 若希望端点也守池子上限，或反过来把"绕过池子"变成**显式**行为（例如加 `free=1`），改一处即可——目前是默认绕过。
