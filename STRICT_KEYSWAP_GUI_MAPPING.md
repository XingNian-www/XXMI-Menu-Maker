# 严格 KeySwap 到 GUI 映射规则

本文档定义 `index.html` 后续改造时应遵守的"严格一致"规则。

**"严格一致"的含义**：GUI 点击一次等价于原始 INI 中同一个 `key` 被按下一次。不按形态（`$active`/`$black_active`）、变量名或界面面板做额外推断。

---

## 目录

- [1. 目标](#1-目标)
- [2. 原始 KeySwap 语义](#2-原始-keyswap-语义)
- [3. 旧实现中需要避免的问题](#3-旧实现中需要避免的问题)
- [4. 推荐数据模型](#4-推荐数据模型)
- [5. 生成策略](#5-生成策略)
  - [5.1 重写原 Key section](#51-重写原-key-section)
  - [5.2 为 cycle 类型生成共享 CommandList](#52-为-cycle-类型生成共享-commandlist)
  - [5.3 toggle 和 hold 类型的 GUI 映射](#53-toggle-和-hold-类型的-gui-映射)
  - [5.4 GUI 点击按 key 分组执行](#54-gui-点击按-key-分组执行)
  - [5.5 Present 只控制 GUI 是否渲染](#55-present-只控制-gui-是否渲染)
  - [5.6 合并策略](#56-合并策略)
- [6. 对测试 INI 的严格映射](#6-对测试-ini-的严格映射)
- [7. 对 index.html 的改造点](#7-对-indexhtml-的改造点)
- [8. 不能做的事](#8-不能做的事)
- [9. 验收标准](#9-验收标准)

---

## 1. 目标

把原始 INI 的 `[Key*]` 行为映射到 GUI，要求：

1. 原始 `KeySwap` 中同一个 `key` 下所有满足 `condition` 的节都要执行
2. GUI 点击和键盘按键共用同一份循环逻辑
3. GUI 和键盘交替使用时，循环步进不能错位
4. 重复档位必须保留，不能根据变量当前值反推下一档
5. 不引入原始 INI 没有的形态选择逻辑
6. 不用 GUI 全局设置覆盖原始 Key section 的 `type`、`condition` 或命令顺序

## 2. 原始 KeySwap 语义

原始 INI 中每个 `[Key*]` 节是**独立按键处理单元**。所有 Key section 执行频率由 `[Hunting] repeat_rate` 控制。

同一个 key 物理按键触发时，引擎遍历所有 `[Key*]` 节，各自独立判断 condition 并执行。

例如：

```ini
[KeySwap0]
key = 5
condition = $active == 1
type = cycle
$piercing1 = 0,1,0,1
$piercing2 = 0,0,1,1

[KeySwap00]
key = 5
condition = $black_active == 1
type = cycle
$black_piercing1 = 0,1,0,1
$black_piercing2 = 0,0,1,1
```

严格等价含义：按下 `5` 时，两个 section 都会各自判断自己的 `condition`。如果 `$active == 1` 和 `$black_active == 1` 同时成立，两个 KeySwap 都会执行。

因此 GUI slot 如果代表 `key = 5`，点击时也必须分别判断两段原始 `condition`：

```ini
if $active == 1
  run = CommandListCycleKeySwap0
endif
if $black_active == 1
  run = CommandListCycleKeySwap00
endif
```

不能写成：

```ini
if $active == 1
  run = CommandListCycleKeySwap0
elif $black_active == 1
  run = CommandListCycleKeySwap00
endif
```

也不能增加 `$gui_target` 之类的形态选择，因为原始 INI 没有这种选择。

## 3. 旧实现中需要避免的问题

严格模式下这些做法都不应该再出现：

1. `parseSwaps()` 把 `key + condition` 相同的简单 cycle 自动合并，导致原始 Key section 边界丢失
2. 每个 GUI slot 自己生成 `$gui_stepN`，键盘和 GUI 使用不同计数器
3. 按 active 面板分流点击，导致同一个 key 下多个满足条件的 handler 只能执行其中一个
4. 把 `$active` 和 `$black_active` 拆成不同 GUI 面板。严格 KeySwap 映射需要的是“按 key 分组”，不是“按 active 分组”
5. 保留原始 `type = cycle` 赋值表，同时另建 GUI 循环逻辑。严格同步时必须把键盘也改成 `run = CommandListCycle...`，和 GUI 共用同一计数器

## 4. 推荐数据模型

解析阶段保留两个层级：

```text
keySlot
├─ key: 原始 key 文本，例如 5 / ctrl up / ;
└─ handlers: 同 key 下所有原始 Key section
   ├─ section: 原 section 名
   ├─ condition: 原 condition 文本
   ├─ type: cycle / toggle / hold / activate 等
   ├─ wrap: true (默认) — 仅 cycle 有效, 控制是否循环回绕
   ├─ entries: 原赋值、run、raw 行，保持原顺序
   └─ steps: cycle/toggle 的最大档位数 (toggle 固定 = 2)
```

GUI 的一个 slot 对应一个 `keySlot`，不是对应一个 active 变量，也不是对应单个 condition。

**多 Key 行的 section 归属**：原始 INI 中一个 `[Key*]` 节可以有多个 `Key` 行（例如同时绑定键盘和手柄）：
```ini
[KeyHoldExample]
Key = RBUTTON
Key = XB_LEFT_TRIGGER
type = hold
$var1 = 1
```
此类 section 应出现在**所有匹配 key 的 keySlot** 中——即同时属于 `key = RBUTTON` 和 `key = XB_LEFT_TRIGGER` 两个 slot。每个 slot 独立 dispatch 时会包含同一 handler (同一步计数器, 同名 CommandList)。不能因为 section 已在第一个 key 的 slot 中出现就跳过后续 key。

同 key 的多个 handler 保留独立 step。例如 `KeySwap4` 和 `KeySwap8` 都改 `$headacc`，但 key 分别是 `ctrl up` 和 `]`，它们必须是两个 slot、两个 step。

每个 handler 的 `type` 必须来自原始 section。如果原始 Key section 没有声明 `type`，XXMI 严格默认是 `activate`。GUI 的全局 `cycle/toggle/hold/activate` 下拉只能作为原始 section 缺失 `type` 时的兜底，不能覆盖已经声明的 `type = cycle`、`type = toggle`、`type = hold` 等。

**工具默认的非严格兜底**：为了兼容大量未声明 `type` 但实际希望循环切换的 MOD，本工具默认把缺失 `type` 当作 `cycle` 处理。这不是 XXMI 严格默认值，而是可用性优先的非严格兜底。生成 INI 必须注释输出实际兜底值，例如 `; Missing Key type fallback: cycle`。

`entries` 必须保留原 Key body 中除 `key`、`condition`、`type` 外的命令顺序。至少包含：

1. `assign`：形如 `$var = 0,1,2` 的赋值表
2. `run`：形如 `run = CommandListFoo` 的命令调用
3. `raw`：解析器暂时不理解但属于 Key body 的行

不能因为一个 Key section 内出现 `run = ...` 就把整个 section 当成纯 action，也不能丢弃同 section 内的变量赋值。

## 5. 生成策略

### 5.1 重写原 Key section

严格同步时，不应保留原始 `type = cycle` 赋值表。应把每个原始 Key section 改成调用共享 CommandList。

原始：

```ini
[KeySwap0]
key = 5
condition = $active == 1
type = cycle
$piercing1 = 0,1,0,1
$piercing2 = 0,0,1,1
```

改成：

```ini
[KeySwap0]
key = 5
condition = $active == 1
run = CommandListCycleKeySwap0
```

如果用户选择“删除 Key 节”，可以删除原 Key section，但 GUI 仍要生成同一批 `CommandListCycleKeySwap*`。

如果用户不删除 Key 节，必须重写 Key section，不能保留原 `type = cycle`，否则键盘和 GUI 使用不同计数器。

删除 Key 节时，不存在键盘与 GUI 的运行期同步问题。此时“严格一致”指：GUI 点击一次的效果等价于原始 INI 中同一个 key 被按下一次后触发的所有 Key section 的效果。

### 5.2 为 cycle 类型生成共享 CommandList

```ini
[Constants]
global $ks_step_KeySwap0 = 0

[CommandListCycleKeySwap0]
$ks_step_KeySwap0 = $ks_step_KeySwap0 + 1
if $ks_step_KeySwap0 >= 4
  $ks_step_KeySwap0 = 0
endif
if $ks_step_KeySwap0 == 0
  $piercing1 = 0
  $piercing2 = 0
elif $ks_step_KeySwap0 == 1
  $piercing1 = 1
  $piercing2 = 0
elif $ks_step_KeySwap0 == 2
  $piercing1 = 0
  $piercing2 = 1
elif $ks_step_KeySwap0 == 3
  $piercing1 = 1
  $piercing2 = 1
endif
```

step 初始为 0，因为 `[Constants]` 中变量的初始值已经对应 step 0。第一次点击 step 0→1 就推进到下一档，与 3DMigoto `type = cycle` 首次按键就改变值的行为一致。若初始为 -1，第一次点击 step -1→0 会将变量设回 `[Constants]` 已存在的值，表现为点击无效。

step 建议使用非 `persist`，更接近原始 `type = cycle` 的运行期计数。若后续确认 3DMigoto/XXMI 的 `type = cycle` 会跨重载持久化，再单独改成 `persist`。

**`wrap = false` 的生成**：

原始 Key section 如果有 `wrap = false`，正向循环不应 wrap 回 0，而是停在最后一档：

```ini
[CommandListCycleKeySwapX]
$ks_step_KeySwapX = $ks_step_KeySwapX + 1
; wrap=true (默认):  if $ks_step >= N → $ks_step = 0
; wrap=false:          if $ks_step >= N → $ks_step = N-1  (停在最后一档)
```

Back 键同理：wrap=false 时后退停在 0 而不是 wrap 到 N-1。向后生成的 `if $ks_step < 0` 分支始终有效 (下限永远是 0)。

**单档 cycle (steps = 1)**：

如果赋值表中没有逗号（如 `$var = 0`），steps = 1。CommandList 仍正常生成但每次点击 step 在 0→1→0 之间跳，赋值不变——虽无空 payload 但行为正确。生成器可以检测 steps==1 并跳过 CommandList 生成，也可以保留（无副作用）。

**`smart` 模式的忽略**：

原始 XXMI 的 `smart = true` cycle 会对比当前变量值与各档预设值, 自动对齐到最近的匹配项。但在转换为共享 CommandList 后, step 计数器本身就是真值来源, 变量值只是 step 计数的投影——因此 `smart` 模式在生成方案中**不适用**, 生成器可以忽略原始 `smart` 标记, 始终使用基于 step 计数的简单循环。

如果原 Key section 内存在 `run`、raw 行和赋值混用，生成时必须按原 `entries` 顺序放入每个 step 分支。

原始：

```ini
[KeySwapMixed]
key = 5
condition = $active == 1
type = cycle
$var1 = 0,1
run = CommandListFoo
$var2 = 1,0
```

应生成：

```ini
[CommandListCycleKeySwapMixed]
$ks_step_KeySwapMixed = $ks_step_KeySwapMixed + 1
if $ks_step_KeySwapMixed >= 2
  $ks_step_KeySwapMixed = 0
endif
if $ks_step_KeySwapMixed == 0
  $var1 = 0
  run = CommandListFoo
  $var2 = 1
elif $ks_step_KeySwapMixed == 1
  $var1 = 1
  run = CommandListFoo
  $var2 = 0
endif
```

不能生成只执行 `run = CommandListFoo`，也不能把 `run` 移到原始顺序之外。

**cycle 的 Back 键映射到 GUI**：

原始 Key section 中如果有 `Back = Q` 之类的反向键, 在 GUI 中可以通过**右键点击**来触发后退 (step -1 或 wrap 回末尾)。因此要为每个 cycle handler 额外生成一个反向 CommandList：

```ini
[CommandListCycleKeySwap0Back]
$ks_step_KeySwap0 = $ks_step_KeySwap0 - 1
if $ks_step_KeySwap0 < 0
  $ks_step_KeySwap0 = 3    ; 如果有 wrap; 否则 if $ks_step_KeySwap0 < 0 → $ks_step_KeySwap0 = 0
endif
; … step 分支内容与正向 CommandList 相同 …
```

如果原始 `wrap = false`, 后退时不要 wrap 回末尾, step 停在 0。

### 5.3 其他 type 的映射

`cycle`、`toggle`、`hold` 三种 type 统一转换为 cycle-style CommandList，因为 GUI 交互模式天然是点击切换——三者的差异仅体现在 step 数不同（cycle 按原始档数，toggle 和 hold 固定 2 档）。需要特殊处理的只有 `activate`。

**转换中可接受的语义偏差**：以下原始 XXMI 行为在 CommandList 方案中会丢失，属于设计取舍而非 bug：

| 原始行为 | 丢失原因 | 影响范围 |
|---------|---------|---------|
| `transition` / `transition_type` 平滑插值 | CommandList 赋值是瞬时跳变, 无法做逐帧插值 | cycle / toggle / hold 全部受影响 |
| `delay` / `release_delay` 延迟 | hold 改为点击切换后无按住/松手概念 | 仅 hold |
| hold 的松手自恢复 | hold 改 2 档 cycle, 需第二次点击恢复 | 仅 hold |
| toggle 的运行时值恢复 (push/pop) | 2 档 cycle 用硬编码值, 不推栈 | 仅 toggle |
| IniParam 无 `[Constants]` 默认值时的恢复值 | 生成器无法推断 step 0 的恢复值 | toggle / hold 转换后

#### `type = toggle` — 等效于 2 档 cycle

原始 toggle 有保存/恢复机制: Activate 时把当前值推栈再设新值, Deactivate 时弹栈恢复。但在生成的共享 CommandList 方案中, 转换为 2 档 cycle 等效——都是点击一次切到激活值, 再点一次回到初始值。

```ini
; toggle 的 $var1 = 0 是初始值 (来自 Constants), $var1 = 1 是激活值
; steps = 2, 生成方式与 cycle 完全一致:

[Constants]
global $ks_step_KeySwapToggleX = 0

[CommandListCycleKeySwapToggleX]
$ks_step_KeySwapToggleX = $ks_step_KeySwapToggleX + 1
if $ks_step_KeySwapToggleX >= 2
  $ks_step_KeySwapToggleX = 0
endif
if $ks_step_KeySwapToggleX == 0
  $var1 = 0
elif $ks_step_KeySwapToggleX == 1
  $var1 = 1
endif
```

注意: 原始 toggle 在"外部改变了变量值"时能恢复到运行时值, 但转换后的 2 档 cycle 恢复到硬编码的 step 0 值。对于 mod 测试 INI 的典型场景 (变量只由这个 toggle/cycle 控制), 两者行为等同, step 0 就是初始值, 不需要运行时恢复能力。如果确实有需要, 后续可以单独为 toggle 保留专用分支。

#### `type = hold` — 等效于 2 档 cycle (与 toggle 相同)

原始 hold 是"按下激活/松开恢复"，但在 GUI 中鼠标不能一直按住（游戏需要响应键盘鼠标）。因此 hold 同样转换为 2 档 cycle：点击一次切到激活档，再点一次回到初始档。

```ini
; hold 的赋值表取第一组值作为激活值, 第二组来自 Constants 初始值或 section 的 assign 反值
; steps = 2, 生成方式与 cycle/toggle 完全一致:

[Constants]
global $ks_step_KeySwapHoldX = 0

[CommandListCycleKeySwapHoldX]
$ks_step_KeySwapHoldX = $ks_step_KeySwapHoldX + 1
if $ks_step_KeySwapHoldX >= 2
  $ks_step_KeySwapHoldX = 0
endif
if $ks_step_KeySwapHoldX == 0
  $var1 = 0     ; 初始值 (= Constants 中的值)
elif $ks_step_KeySwapHoldX == 1
  $var1 = 1     ; 激活值 (= hold section 中的赋值)
endif
```

与原始 hold 的行为差异：原始 hold 有 `delay` 和 `release_delay` 的延迟机制，转换为点击切换后丢失延迟语义。但对于 mod 测试 INI 的典型场景，hold 主要用于临时切换视觉效果，点击切换足以满足需求。如果需要保留延迟，后续可单独在 CommandList 中插入 `delay` 变量逻辑。

此方案下 hold 不再需要保留原始 Key section——与 cycle/toggle 一样，可以重写为 `run = CommandListCycle...` 或删除。

#### `type = activate`

- 原始行为：点击一次 → `Activate()` 并保持在激活态直到下一帧
- **严格等效限制**：activate 不能完全严格映射到 GUI 点击。原始 activate 是按键触发的短生命周期状态，GUI 点击只能模拟，无法保证与键盘释放/帧时序 100% 一致
- 默认严格模式下，activate 可以不转换为 CommandList，也不出现在 `CommandListGuiClick` 的 dispatch 中。用户只能通过键盘按原 key 来触发
- 如果用户删除 activate handler 的 Key section，行为永久丢失
- 通常 activate 用于一次性操作 (如 reload_config)，在 GUI 中可通过专门的独立按钮或菜单项替代

**可选扩展：GUI pulse 映射 (非完全严格等效)**

如果希望 GUI 也能触发 activate handler，可以把 activate 转成一次短脉冲：

1. 为每个 activate handler 生成独立 `CommandListActivate...`
2. GUI 点击时运行该 CommandList
3. `run = CommandListFoo` 这类一次性命令直接执行一次
4. 赋值类 entry 先设置为激活值，并设置一个 `$gui_activate_pulse_* = 1`
5. 在 `[Present] post` 或专用后置 CommandList 中检测 pulse，把赋值变量恢复到 `[Constants]` 初始值，再清 pulse

示例：

```ini
[CommandListActivateKeyFoo]
$x = 1
run = CommandListReload
$gui_activate_pulse_KeyFoo = 1

[Present]
post run = CommandListGuiActivateReset

[CommandListGuiActivateReset]
if $gui_activate_pulse_KeyFoo == 1
  $x = 0
  $gui_activate_pulse_KeyFoo = 0
endif
```

这个方案适合 `reload_config`、一次性 `run`、简单变量激活等场景，但它不是严格等价：恢复时机取决于 Present/post 调度，而不是原始按键释放语义。若 `[Constants]` 找不到变量初始值，只能使用 `0` 兜底或提示用户手动处理。

**工具默认启用的非严格行为**：本工具默认启用 GUI pulse 映射，因此 activate 会出现在 GUI dispatch 中并生成 `CommandListActivate...`。不勾选“删 Key 节”时，原始 activate Key section 保留，键盘原生行为仍可用；勾选“删 Key 节”时，activate 原 Key section 也会删除，以避免原生 Key 与 GUI pulse 同时存在造成冲突，此时只剩 GUI pulse 模拟行为。

生成 INI 必须显式注释该行为，例如：`; Activate GUI pulse: enabled (non-strict, not fully equivalent to native activate)`。activate 赋值如果出现多值表，pulse 激活值取第一组值；raw entry 会进入 `CommandListActivate...`，不能静默丢弃。

**重写 Key section 时 raw 的处理**：如果 cycle/toggle/hold 的原 Key section 被重写为 `run = CommandListCycle...`，原 section 中的 raw 行不能继续保留在原 Key body 中，否则键盘触发会在原 Key 和共享 CommandList 中重复执行。raw 行应只进入共享 CommandList；原 Key section 只保留注释、key、condition 和 run。

**toggle/hold 多值赋值**：toggle/hold 固定 2 档，step 0 来自 `[Constants]` 初始值，step 1 始终取 Key section 赋值表的第一组值作为激活值。即使原赋值写成 `$x = 1,2`，GUI 转换后激活档也取 `1`，不是 `2`。

**Back 键与键盘同步**：如果原 cycle 有 `Back = ...` 且不删除 Key section，生成器除了把原 Key section 重写为正向 `run = CommandListCycle...`，还应额外生成一个反向 Key section（例如 `[KeySwap0Back]`）调用 `CommandListCycle...Back`，确保键盘 Back 与 GUI 右键共用同一套 step 计数。

### 5.4 GUI 点击按 key 分组执行

一个 GUI slot 代表一个原始 `key`。点击后要遍历该 key 下所有 handler，分别判断原 condition。

```ini
[CommandListGuiClick]
$gui_clicked = $gui_hovered
if $gui_clicked == 1
  ; key = 5
  if $active == 1
    run = CommandListCycleKeySwap0
  endif
  if $black_active == 1
    run = CommandListCycleKeySwap00
  endif
elif $gui_clicked == 2
  ; key = 6
  if $active == 1
    run = CommandListCycleKeySwap1
  endif
  if $black_active == 1
    run = CommandListCycleKeySwap01
  endif
endif
```

同一个 slot 内多个 handler 的 condition 必须用多个独立 `if`，不能用 `elif`。

不同 slot 之间可以继续用 `if/elif`，因为一次点击只命中一个 `$gui_clicked`。

`commandlistguiclick` 只负责 dispatch `run = CommandListCycle...`——因为所有需要 GUI 交互的 handler (cycle/toggle/hold) 都统一转换为 cycle-style CommandList, dispatch 逻辑不需要按 type 分流。


**点击检测与防重入**：

`$gui_clicked = $gui_hovered` 意味着：鼠标悬停的 slot 位置本身就是"点击"信号——需要 GUI 渲染 CommandList 在鼠标按下时把 `$gui_hovered` 设为对应 slot ID, 鼠标松开时清为 0。每帧 Present 时 `CommandListGuiClick` 执行一次。这意味着：
- 点击频率上限 = 帧率，短于一帧间隔的连续点击会合并为一次
- `$gui_hovered` 需要由外围 GUI 逻辑在一个独立的 CommandList 中设置 (通常放在 `CommandListGuiMenu` 里)
- 右键点击需要另一套变量 (如 `$gui_right_clicked`)，用于调度 Back 方向的 `CommandListCycle...Back`

### 5.5 Present 只控制 GUI 是否渲染

`[Present]` 只负责在当前角色或形态出现时渲染 GUI，不负责决定点击执行哪套 KeySwap。

对于多个 active 条件，可以用所有相关 active 条件的并集作为渲染条件：

```ini
[Present]
if $gui_menu && ($active == 1 || $black_active == 1)
  run = CommandListGuiMenu
endif
post $black_active = 0
post $active = 0
```

点击时仍由每个 handler 的原始 `condition` 判断。

`condition` 必须原样保留，不能做语义改写。例如：

```ini
condition = $active != 0
```

不能改成：

```ini
condition = $active > 0
```

因为变量可能为负数，这两者不等价。

**condition 为空或缺失**：如果原始 Key section 没有 `condition` 行, 视为 `condition` 恒成立 (等价于 `condition = 1`)。生成时在此 handler 的 dispatch 中不加 `if` 包裹, 直接调用 `run = ...`。

### 5.6 合并策略

严格模式默认不合并原始 Key section。

如果为了 GUI 展示把相同 `key` 合成一个 slot，只能合并 slot，不能合并 handler 本身：

1. 每个 handler 仍保留自己的 `condition`
2. 每个 handler 仍保留自己的 step 变量
3. 每个 handler 仍生成自己的 `CommandListCycle...`
4. 点击 slot 时依次判断并调用该 key 下所有 handler

自动把多个 Key section 的赋值表合成一个新 cycle 表，不属于严格映射。

## 6. 对测试 INI 的严格映射

Skirk 这个测试 INI 应生成 10 个 GUI slot，按原始 key 分组：

| slot | key | 执行逻辑 |
|---|---|---|
| 1 | `5` | `$active` 时 `KeySwap0`，`$black_active` 时 `KeySwap00` |
| 2 | `6` | `$active` 时 `KeySwap1`，`$black_active` 时 `KeySwap01` |
| 3 | `7` | `$active` 时 `KeySwap2`，`$black_active` 时 `KeySwap02` |
| 4 | `8` | `$active` 时 `KeySwap3`，`$black_active` 时 `KeySwap03` |
| 5 | `ctrl up` | `$active` 时 `KeySwap4`，`$black_active` 时 `KeySwap04` |
| 6 | `ctrl down` | `$active` 时 `KeySwap5`，`$black_active` 时 `KeySwap05` |
| 7 | `9` | `$active` 时 `KeySwap6`，`$black_active` 时 `KeySwap06` |
| 8 | `[` | `$active` 时 `KeySwap7`，黑形态无动作 |
| 9 | `]` | `$active` 时 `KeySwap8`，黑形态无动作 |
| 10 | `;` | `$active` 时 `KeySwap9`，`$black_active` 时 `KeySwap09` |

这里 slot 8 和 slot 9 不能给黑形态补行为，因为原始 INI 没有对应 KeySwap。

## 7. 对 index.html 的改造点

推荐最小改造顺序：

1. 在 `parseSwaps()` 后新增严格分组函数，例如 `buildKeySlots(swaps)`，按原始 `key` 分组，保留每个原 section handler。一个 section 有多个 `Key` 行时需重复归属到所有匹配 key 的 slot
2. 调整 `parseSwaps()` 或新增 `parseKeyHandlers()`，让每个原始 `[Key*]` 都有独立 handler id，不被简单合并吞掉
3. 新增 `emitKeyHandlerCommandList(handler)`，根据 `type` 分别处理：
   - `cycle` / `toggle` / `hold` → 生成 `CommandListCycle...` (hold/toggle 按 2 档 cycle 生成; 有 `Back` 键时额外生成 `...Back`)
   - `activate` → 保留原始 Key 节, 不转换为 CommandList
4. 修改 `buildSingleIni()`：slot 从 `keySlots` 来，而不是直接从 `state.swaps` 来
5. 修改 `buildSingleIni()`：GUI click (`CommandListGuiClick`) 中一个 slot 遍历该 key 的所有 cycle/toggle/hold handler，用原 `condition` 包裹 `run = CommandListCycle...`；activate handler 默认严格模式下不出现在 GuiClick 中。若启用非严格 GUI pulse 扩展，activate handler 可改为 dispatch `CommandListActivate...`。本工具默认启用该扩展，必须在注释或文档中标明非完全严格等效
6. 修改 `buildSingleIni()`：cycle/toggle/hold 类型的 Key 节需重写为 `run = CommandListCycle...` 或删除；重写时 raw 行只进入共享 CommandList，不能在原 Key section 重复保留。activate 类型不勾选“删 Key 节”时保留原始 Key 节不重写；勾选“删 Key 节”时删除原 Key，并由 GUI pulse 扩展额外生成 `CommandListActivate...`
7. 不保留按 active 面板分发点击的逻辑。严格模式下多个 active 条件不应按 panel 生成互斥点击逻辑，而应复用同一套 keySlot 点击逻辑
8. 修改资源生成和预览：按钮数量来自 `keySlots`，按钮名可以用同 key 下 handler 的变量名合集或首个 section 名生成
9. 保留原始 `type`，全局行为下拉只作为缺失 `type` 的 fallback
10. 保留 `entries` 原顺序，支持 `run`、变量赋值、raw 行混用
11. 生成时原样输出 `condition`，禁止 `$x != 0` 到 `$x > 0` 这类改写
12. 为有 `Back` 键的 cycle slot 绑定右键后退

## 8. 不能做的事

| # | 类别 | 禁止行为 | 原因 |
|---|------|---------|------|
| 1 | 形态选择 | 用 `$gui_target` 人工选择普通/黑形态 | 原始 INI 只有一个 key, 没有形态分发变量 |
| 2 | 条件互斥 | 在 `$active` 和 `$black_active` 同时为 1 时只执行其中一个 | 原始 KeySwap 按键时两者都会执行 |
| 3 | 条件互斥 | 把同 key 的不同 condition 用 `elif` 互斥 | 原始 INI 中按键是独立 if 判断 |
| 4 | 状态推断 | 根据当前变量值反推下一档 | 有重复档位时无法正确反推 |
| 5 | 状态合并 | 合并重复状态, 例如 `(0,0,0)` 出现两次也只保留一个 step | 会破坏循环总步数和顺序 |
| 6 | 补行为 | 给没有原始 KeySwap 的形态补 GUI 行为 | 实质是新增按键, 违反严格映射 |
| 7 | 覆盖 type | 用 GUI 全局 `toggle/cycle` 设置覆盖原 Key section 的 `type` | 全局设置只作为缺失 type 的兜底 |
| 8 | 丢弃命令 | 因为 Key 内有 `run` 就丢弃同 Key 内的 `$var = ...` | 原始 INI 中两者都会执行 |
| 9 | 丢弃命令 | 静默丢弃解析器暂时不理解的 Key body 行 | 应标记为 raw entry 保留 |
| 10 | 改写条件 | 改写原始 `condition`（如 `$x != 0` → `$x > 0`) | 变量可能为负, 不等价 |
| 11 | 无视 wrap | 对 `wrap = false` 的 cycle 仍然 wrap 回到 step 0 | wrap=false 应停在最后一档或 step 0 |
| 12 | 忽略 type | 把 `hold` 按 mousedown/mouseup 方式处理而不是转为 2 档 cycle | GUI 无法真正保持按住, 点击切换才是可行的替代方案 |
| 13 | 忽略过渡 | 试图在 CommandList 中模拟 `transition` 逐帧插值 | CommandList 没有逐帧回调能力, 过渡只能放弃 |
| 14 | 多 Key 遗漏 | section 有多个 `Key` 行时只归入第一个 key 的 slot | 必须重复归属到所有匹配 key 的 slot |

## 9. 验收标准

用 Skirk 测试 INI 验证时，应满足：

1. GUI 生成 10 个 slot，对应 10 个不同原始 key
2. 点击 slot 1 和按键 `5` 的效果完全一致
3. `$active == 1 && $black_active == 1` 时，点击 slot 1 会同时推进 `KeySwap0` 和 `KeySwap00`
4. 点击 slot 8 时，只会执行普通 `KeySwap7`，黑形态不变
5. 键盘和 GUI 交替使用不会改变循环顺序
6. `KeySwap2` 和 `KeySwap6` 中重复的空状态不会被合并
7. `KeySwap4` 与 `KeySwap8` 虽然都控制 `$headacc`，但 step 相互独立
8. `type = cycle` 和 `type = toggle` 混用时，每个 Key section 按自己的原始 `type` 生成 (toggle 等效为 2 档 cycle)，不受全局行为下拉覆盖
9. 同一个 Key section 内 `run = ...` 和 `$var = ...` 混用时，GUI 点击不会丢弃任何一类命令，并保持原顺序
10. `condition = $active != 0` 生成后仍是 `$active != 0`，不会被改写为 `$active > 0`
11. 含未知 Key body 行的 section，未知行会以 raw entry 形式进入共享 CommandList，不会静默消失
12. `type = hold` 的 section 转换为 2 档 cycle CommandList，点击一次切换激活/初始状态
13. `type = cycle` 且有 `Back` 键的 section, GUI slot 同时支持左键(正向)和右键(反向)步进
14. `wrap = false` 的 cycle 正向不 wrap 回 0, 反向不 wrap 回末尾
15. 有多个 `Key` 行的 section 会出现在所有匹配 key 的 slot 中, 不会只出现在第一个
16. `transition` / `delay` 等原始 KeyOverride 的时间相关语义被接受为丢弃, 不在生成中尝试模拟
17. 默认严格模式下, `type = activate` 的 section 不出现在 `CommandListGuiClick` 中, 不可通过 GUI 按钮触发。若启用 GUI pulse 扩展, 必须明确标注为非完全严格等效；本工具默认启用该扩展
18. 缺失 `type` 时，XXMI 严格默认是 `activate`；如果工具默认按 `cycle` 兜底，必须在 UI 和生成 INI 中明确标注这是非严格可用性兜底
