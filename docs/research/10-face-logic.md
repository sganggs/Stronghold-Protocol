# 10 · 官方朝向判定的反编译结果（零误差复刻用）

> 本文是 `10-model-official.md`（资源层）与 `10-face-modes.md`（数据层）的**代码层**补完。
> 全部内容来自对官方 `global-metadata.dat`（未加密）+ `GameAssembly.dll` 的解析与反汇编，
> 可用 §7 的命令重跑。**标注 `[ASM]` 的结论直接读自机器码，`[INFER]` 为推断。**

---

## 0. 结论速查（照这个实现即可）

```
// 官方常量（名字与值都来自元数据，见 §6）
const float TOLERANCE_L_OR_R_DIRECTION     = 0.2f;   // ±0.2 迟滞死区
const float ADDON_TO_L_OR_R_DIRECTION      = 0.25f;  // 加在水平方向上的点积偏置

// 四方向解析：带偏置的点积取最大
int MapUtil.ParseDirection(Vector2 v, float addon)
{
    if (v.magnitude < 1e-05f) v = defaultDirection;   // 退化输入
    v = v.normalized;
    int best = 0; float bestDot = Dot(v, DIRS[0]) + ((0 & 1) * addon);
    for (int k = 1; k < 4; k++) {
        float d = Dot(v, DIRS[k]) + ((k & 1) * addon);   // ← 只有 k=1,3 吃 addon
        if (d > bestDot) { bestDot = d; best = k; }
    }
    return best;                                       // 0..3
}

// 左/右判定（prevSign = 上一次的 faceSign）
int CharacterAnimator._CalculateLOrRDirection(Vector2 v, int prevSign)
{
    int parsed = MapUtil.ParseDirection(v, 0f);        // ← 注意 addon 传 0
    if (parsed == 3 || parsed == 1) return parsed;     // 已是水平 → 直接采纳

    if (MathUtil.LT(v.x, -TOLERANCE_L_OR_R_DIRECTION)) return 3;   // LEFT
    if (MathUtil.GT(v.x, +TOLERANCE_L_OR_R_DIRECTION)) return 1;   // RIGHT
    return prevSign;                                   // ★ 死区：|v.x| <= 0.2 保持原朝向
}

// 应用四方向
void CharacterAnimator._SetFourDirection(int sign, bool uOrD)
{
    unitAnimator.SetLeftOrRight(sign, ...);            // 水平镜像
    if (uOrD) _SwapConfiguration(back /*+0x100*/,  front /*+0xf8*/);
    else      _SwapConfiguration(front /*+0xf8*/,  back  /*+0x100*/);
}
```

**朝向 = (左/右) × (正/背) 两个布尔轴，共 4 态。`_SetFourDirection` 里没有任何斜向分支。`[ASM]`**

---

## 1. 方法清单（全部定位到原生地址）`[ASM]`

| 方法 | 方法索引 | 原生 VA | 作用 |
|---|---|---|---|
| `CharacterAnimator.OnFaceChanged` | 63482 | `0x1805eae80` | 朝向变更后处理（用 `ADDON` 调 ParseDirection） |
| `CharacterAnimator.DoUpdateFaceSign` | 63488 | `0x1805ea370` | 定时机更新 faceSign |
| `CharacterAnimator._CalculateLOrRDirection` | 63491 | `0x1805ec3b0` | **左右判定 + 迟滞死区** |
| `CharacterAnimator._SetFourDirection` | 63492 | `0x1805ec8d0` | **应用朝向（换配置 + 镜像）** |
| `CharacterAnimator._SwapConfiguration` | 63493 | `0x1805ec9b0` | 交换 `_front` / `_back` |
| `MapUtil.ParseDirection` | 78308 | `0x180b01280` | **四方向点积解析** |
| `MapUtil.ParseDirectionStrict` | 78310 | `0x180b01110` | 严格版（朝向路径未使用） |
| `MapUtil.ParseDirectionByEightWays` | 78309 | `0x180b00e40` | **八方向**（朝向路径未使用） |
| `MathUtil.LT` / `MathUtil.GT` | — | `0x1866e5870` / `0x1866e4c50` | 浮点比较 |
| `UnitAnimator.SetLeftOrRight` | — | `0x180618be0` | 水平镜像 |

> **注意 `uOrD` 不是方法**，是 `bool`（`_SetFourDirection` 的第 3 个参数，寄存器 `r8d`）。

---

## 2. `MapUtil.ParseDirection` 逐行还原 `[ASM]`

```asm
0x180b01280  push rsi / sub rsp,0x80
0x180b012c6  call 0x180535480              ; magnitude(v)
0x180b012ce  comiss xmm2, [0x186e3fd88]    ; 1e-05
0x180b012d5  ja   0x180b01323              ; |v| > 1e-05 → 走归一化
             ; 否则取 static.b8 里的默认方向 (x=[rcx], y=[rcx+4])
0x180b01323  movss xmm0,[rsp+0x24]         ; y
0x180b01330  divss xmm0, xmm2              ; y / |v|
0x180b01334  divss xmm8, xmm2              ; x / |v|
             ; ── 第 0 个方向：未展开的乘法 ──
0x180b0139b  mulss xmm6, [rcx+0x24]        ; norm.y * dir0.y
0x180b013aa  mulss xmm0, [rcx+0x20]        ; norm.x * dir0.x
0x180b013af  addss xmm6, xmm0              ; bestDot = dot0
0x180b013b3  movaps xmm9, xmm6             ; xmm9 = dot0（初始最大）
0x180b013a0  mov ebx, 1 / mov edi, 0x28    ; k=1，表内偏移 0x28
0x180b013b3  <loop>
0x180b013f3  mulss xmm0, [rdi+rcx]         ; norm.x * DIRS[k].x
0x180b013fd  mulss xmm1, [rdi+rcx+4]       ; norm.y * DIRS[k].y
0x180b01403  addss xmm1, xmm0              ; dot_k
0x180b013fa  and eax, 1                    ; ← k & 1
0x180b0140b  cvtdq2ps xmm0, xmm0
0x180b0140e  mulss xmm0, xmm10             ; × addon
0x180b01413  addss xmm1, xmm0              ; dot_k += (k&1) * addon
0x180b01417  comiss xmm1, xmm6             ; 与当前最大比较
0x180b0141f  cmovbe ecx, esi               ; 记录最优索引
0x180b01430  cmp ebx, 4 / jl loop
0x180b0143f  mov eax, ecx / ret            ; 返回 0..3
```

**要点：**

1. **输入先归一化**；`|v| < 1e-05` 时用**默认方向**回退（不是返回 0）。
2. **`addon` 只加在奇数索引上**（`and eax,1` → `cvtdq2ps` → `mulss addon`），即 **1 和 3**。
3. 返回的是**方向索引 0..3**，不是符号。
4. 方向表在 `[static.b8 + 0x50]`，每个方向是 `Vector2`，表项间距 8 字节，第 0 项在 `+0x20`。
5. 世界坐标的 `y` 与 `x` 分别乘表里的 `[+0x24]` / `[+0x20]`（可含纵横比修正）。

**这解释了 `ADDON_TO_L_OR_R_DIRECTION = 0.25` 的真实语义：给水平方向一个 +0.25 的点积偏置。**
（点积 ∈ [-1, 1]，所以 0.25 是显著偏向：只有目标明显偏上下时垂直才赢。）

---

## 3. `_CalculateLOrRDirection` 逐行还原 `[ASM]`

```asm
0x1805ec3b0  mov [rsp+8],rbx / push rdi / sub rsp,0x50
0x1805ec3c1  mov edi, r8d                 ; edi = prevSign（第 3 参数）
0x1805ec3cc  movq xmm6, rdx               ; xmm6 = Vector2 v
0x1805ec3fd  (静态初始化)
0x1805ec40b  mov rcx,[rax+0xb8] / [...+0x140] / test rcx,rcx
0x1805ec41c  jne 0x1805ec4e4              ; 有 manager → 走 DelegateBridge（热更）
0x1805ec43a  xorps xmm1,xmm1              ; ★ addon 参数 = 0.0f
0x1805ec442  call MapUtil.ParseDirection
0x1805ec447  cmp eax,3 / je ret_eax       ; parsed==3 → 直接返回
0x1805ec450  cmp eax,1 / je ret_eax       ; parsed==1 → 直接返回
0x1805ec477  movss xmm1,[0x186e40b7c]     ; −0.2f
0x1805ec482  call MathUtil.LT
0x1805ec489  jne 0x1805ec4cf              ; LT 真 → return 3
0x1805ec4a0  movss xmm1,[0x186e40b18]     ; +0.2f
0x1805ec4ae  call MathUtil.GT
0x1805ec4b5  mov ecx,1 / cmove ecx,edi    ; GT 假 → ecx = prevSign
0x1805ec4bd  mov eax,ecx / ret            ; return
0x1805ec4cf  mov eax,3 / ret              ; LT 真的返回路径
```

**语义：**

| 条件 | 返回 |
|---|---|
| `ParseDirection(v, 0)` == 1 或 3 | 直接返回（水平已确定） |
| `v.x < -0.2` | **3（LEFT）** |
| `v.x > +0.2` | **1（RIGHT）** |
| 否则 | **`prevSign`（保持原朝向）** ← 死区 |

**符号编码：`1 = RIGHT`，`3 = LEFT`。**

---

## 4. `_SetFourDirection` 逐行还原 `[ASM]`

```asm
0x1805ec8e6  mov edi, r8d                 ; uOrD（第 3 参数 bool）
0x1805ec8e9  mov esi, edx                 ; sign
0x1805ec925  call UnitAnimator.SetLeftOrRight    ; rcx=this, edx=sign
0x1805ec93e  test edi,edi
0x1805ec940  je  0x1805ec965              ; uOrD == false
0x1805ec942  mov r8,[rbx+0x100]  ; back
0x1805ec949  mov rdx,[rbx+0xf8]  ; front
0x1805ec950  call _SwapConfiguration      ; up → Swap(back, front)
0x1805ec965  mov r8,[rbx+0xf8]   ; front
0x1805ec96c  mov rdx,[rbx+0x100] ; back
0x1805ec973  call _SwapConfiguration      ; !up → Swap(front, back)
```

**结论：四方向不是 4 个分支，而是 2 个轴：**

| 轴 | 实现 |
|---|---|
| 水平 | `UnitAnimator.SetLeftOrRight(sign)` → 镜像 |
| 垂直 | `_SwapConfiguration(front, back)` 的**参数顺序**由 `uOrD` 决定 |

`_front` 在对象偏移 **`+0xf8`**、`_back` 在 **`+0x100`** —— 与资源包里 `DefaultSkin._front` / `_back` 两个 `FaceConfiguration` 结构体一致。

**没有斜向分支。** 这也与素材层"只有 Front / Back 两套骨架"互相印证。

---

## 5. 完整调用链 `[ASM]` + 少量 `[INFER]`

```
战斗/动画事件
   ↓
CharacterAnimator.DoUpdateFaceSign()            ; 定时更新
   ↓ 计算「到目标的方向向量」v（世界坐标）
   ↓
MapUtil.ParseDirection(v, ADDON=0.25)           ; 带水平偏置的 4 向 argmax
CharacterAnimator._CalculateLOrRDirection(v, prevSign)
   ↓ 得到 sign（1=右 3=左）或沿用 prevSign（死区）
   ↓ uOrD = (该方向是上/下)
CharacterAnimator._SetFourDirection(sign, uOrD)
   ↓
UnitAnimator.SetLeftOrRight(sign) + _SwapConfiguration(front, back)
   ↓
CharacterAnimator.OnFaceChanged()
   ↓
FaceSwitcher._switchTime = 0.15s 的过渡；播对应 clip
```

**[INFER] 的部分**：`DoUpdateFaceSign` 的完整函数体未逐行读，所以"何时调用"（每帧 / 事件驱动）仍待确认；
`OnFaceChanged` 只读了 `ADDON` 附近，未读完整。

---

## 6. 常量总表（名字与值都来自元数据）`[ASM]`

| 官方常量 | 值 | 用在哪 |
|---|---|---|
| `TOLERANCE_L_OR_R_DIRECTION` | **0.2** | `_CalculateLOrRDirection` 的 `±0.2` 迟滞死区 |
| `ADDON_TO_L_OR_R_DIRECTION` | **0.25** | 传给 `ParseDirection` 的水平点积偏置 |
| `DIRECTION_ZERO_TOLERANCE` | **0.01** | 方向向量判零 |
| `TOO_CLOSE_TOLERANCE_SQR` | **0.0625**（=0.25²） | 距离平方小于它 → 太近，不判方向 |
| `FaceSwitcher._switchTime` | **0.15** | 换面过渡时长（465/465 恒同） |
| `FaceSwitcher._defaultLOrR` | **3** | 默认左右（465/465 恒同） |
| `ParseDirection` 零判据 | **1e-05** | 归一化前的长度阈值（代码内联常量） |

---

## 7. 复现

工具：`tools/local-extract/il2cpp-disasm.py`（依赖 `capstone`；`capstone` 已解压到 `_pylibs`）

```bash
# 列出候选方法
python.exe tools/local-extract/il2cpp-disasm.py --list ParseDirection

# 反汇编单个方法（call 目标与浮点常量会就地标注）
python.exe tools/local-extract/il2cpp-disasm.py --method MapUtil.ParseDirection
python.exe tools/local-extract/il2cpp-disasm.py --method CharacterAnimator._CalculateLOrRDirection
python.exe tools/local-extract/il2cpp-disasm.py --method CharacterAnimator._SetFourDirection

# 资源/数据层
python.exe tools/local-extract/inspect-char-model.py --char char_102_texas
python.exe tools/local-extract/inspect-char-model.py --tally face
```

工具做的事：解析元数据（v29）→ 解析 PE 段 → 用模块名字符串定位 `Il2CppCodeGenModule`
→ 按镜像顺序累计得到 320,511 个方法槽 → 元数据方法索引直接对应原生函数指针
→ 建 `VA → 方法名` 反查表 → capstone 反汇编并标注 `call` 目标与 RIP 相对浮点常量。

---

## 8. 尚未闭合的部分

| 缺口 | 影响 |
|---|---|
| `DoUpdateFaceSign` 完整函数体 | "何时"更新朝向（每帧？攻击事件？）未定 |
| `OnFaceChanged` 完整函数体 | 变更后是否重置动画/重播 clip 未定 |
| `ParseDirectionStrict` / `ByEightWays` | 两者都存在，但朝向路径未调用；**若某些干员/模式用到八方向，则会出现斜向朝向** |
| 方向表 `[static.b8+0x50]` 的实际 4 个向量 | 目前按"上右下左"假设，未读表内容 |
| `[rcx+0x20]` / `[rcx+0x24]` 缩放 | 可能是纵横比修正，未确认 |
