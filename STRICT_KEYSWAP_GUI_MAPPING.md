# 严格 KeySwap 到 GUI 映射规则

本文档定义 `index.html` 后续改造时应遵守的“严格一致”规则。这里的一致，是指 GUI 点击一次必须等价于原始 INI 中按下同一个 `key` 一次，而不是按形态、变量名或界面面板做额外推断。

## 目标

把原始 INI 的 `[Key*]` 行为映射到 GUI，要求：

1. 原始 `KeySwap` 中同一个 `key` 下所有满足 `condition` 的节都要执行
2. GUI 点击和键盘按键共用同一份循环逻辑
3. GUI 和键盘交替使用时，循环步进不能错位
4. 重复档位必须保留，不能根据变量当前值反推下一档
5. 不引入原始 INI 没有的形态选择逻辑
6. 不用 GUI 全局设置覆盖原始 Key section 的 `type`、`condition` 或命令顺序

## 原始 KeySwap 语义

原始 INI 中每个 `[Key*]` 节是独立按键处理单元。

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

## 旧实现中需要避免的问题

严格模式下这些做法都不应该再出现：

1. `parseSwaps()` 把 `key + condition` 相同的简单 cycle 自动合并，导致原始 Key section 边界丢失
2. 每个 GUI slot 自己生成 `$gui_stepN`，键盘和 GUI 使用不同计数器
3. 按 active 面板分流点击，导致同一个 key 下多个满足条件的 handler 只能执行其中一个
4. 把 `$active` 和 `$black_active` 拆成不同 GUI 面板。严格 KeySwap 映射需要的是“按 key 分组”，不是“按 active 分组”
5. 保留原始 `type = cycle` 赋值表，同时另建 GUI 循环逻辑。严格同步时必须把键盘也改成 `run = CommandListCycle...`，和 GUI 共用同一计数器

## 推荐数据模型

解析阶段保留两个层级：

```text
keySlot
├─ key: 原始 key 文本，例如 5 / ctrl up / ;
└─ handlers: 同 key 下所有原始 Key section
   ├─ section: 原 section 名
   ├─ condition: 原 condition 文本
   ├─ type: cycle / toggle / hold / action 等
   ├─ entries: 原赋值、run、raw 行，保持原顺序
   └─ steps: cycle 的最大档位数
```

GUI 的一个 slot 对应一个 `keySlot`，不是对应一个 active 变量，也不是对应单个 condition。

同 key 的多个 handler 保留独立 step。例如 `KeySwap4` 和 `KeySwap8` 都改 `$headacc`，但 key 分别是 `ctrl up` 和 `]`，它们必须是两个 slot、两个 step。

每个 handler 的 `type` 必须来自原始 section。GUI 的全局 `cycle/toggle` 下拉只能作为原始 section 缺失 `type` 时的兜底，不能覆盖已经声明的 `type = cycle`、`type = toggle`、`type = hold` 等。

`entries` 必须保留原 Key body 中除 `key`、`condition`、`type` 外的命令顺序。至少包含：

1. `assign`：形如 `$var = 0,1,2` 的赋值表
2. `run`：形如 `run = CommandListFoo` 的命令调用
3. `raw`：解析器暂时不理解但属于 Key body 的行

不能因为一个 Key section 内出现 `run = ...` 就把整个 section 当成纯 action，也不能丢弃同 section 内的变量赋值。

## 生成策略

### 1. 重写原 Key section

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

### 2. 为每个原 Key section 生成一个共享循环 CommandList

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

不能生成成只执行 `run = CommandListFoo`，也不能把 `run` 移到原始顺序之外。

### 3. GUI 点击按 key 分组执行

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

### 4. Present 只控制 GUI 是否渲染

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

### 5. 合并策略

严格模式默认不合并原始 Key section。

如果为了 GUI 展示把相同 `key` 合成一个 slot，只能合并 slot，不能合并 handler 本身：

1. 每个 handler 仍保留自己的 `condition`
2. 每个 handler 仍保留自己的 step 变量
3. 每个 handler 仍生成自己的 `CommandListCycle...`
4. 点击 slot 时依次判断并调用该 key 下所有 handler

自动把多个 Key section 的赋值表合成一个新 cycle 表，不属于严格映射。

## 对测试 INI 的严格映射

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

## 对 index.html 的改造点

推荐最小改造顺序：

1. 在 `parseSwaps()` 后新增严格分组函数，例如 `buildKeySlots(swaps)`，按原始 `key` 分组，保留每个原 section handler
2. 调整 `parseSwaps()` 或新增 `parseKeyHandlers()`，让每个原始 `[Key*]` 都有独立 handler id，不被简单合并吞掉
3. 新增 `emitKeyHandlerCommandList(handler)`，为每个 handler 生成 `CommandListCycle...`
4. 修改 `buildSingleIni()`：slot 从 `keySlots` 来，而不是直接从 `state.swaps` 来
5. 修改 `buildSingleIni()`：GUI click 中一个 slot 遍历该 key 的所有 handler，handler 内部用原 `condition` 包裹 `run = CommandListCycle...`
6. 修改 `buildSingleIni()`：如果不删除 Key 节，则把原 Key 节重写为 `run = CommandListCycle...`
7. 不保留按 active 面板分发点击的逻辑。严格模式下多个 active 条件不应按 panel 生成互斥点击逻辑，而应复用同一套 keySlot 点击逻辑
8. 修改资源生成和预览：按钮数量来自 `keySlots`，按钮名可以用同 key 下 handler 的变量名合集或首个 section 名生成
9. 保留原始 `type`，全局行为下拉只作为缺失 `type` 的 fallback
10. 保留 `entries` 原顺序，支持 `run`、变量赋值、raw 行混用
11. 生成时原样输出 `condition`，禁止 `$x != 0` 到 `$x > 0` 这类改写

## 不能做的事

严格模式下不要做这些：

1. 不要用 `$gui_target` 人工选择普通/黑形态
2. 不要在 `$active` 和 `$black_active` 同时为 1 时只执行其中一个
3. 不要把同 key 的不同 condition 用 `elif` 互斥
4. 不要根据当前变量值推断下一档
5. 不要合并重复状态，例如 `(0,0,0)` 出现两次也必须保留两个 step
6. 不要给没有原始 KeySwap 的形态补 GUI 行为
7. 不要用 GUI 全局 `toggle/cycle` 设置覆盖原 Key section 的 `type`
8. 不要因为 Key 内有 `run` 就丢弃同 Key 内的 `$var = ...`
9. 不要静默丢弃解析器暂时不理解的 Key body 行
10. 不要改写原始 `condition`

## 验收标准

用 Skirk 测试 INI 验证时，应满足：

1. GUI 生成 10 个 slot，对应 10 个不同原始 key
2. 点击 slot 1 和按键 `5` 的效果完全一致
3. `$active == 1 && $black_active == 1` 时，点击 slot 1 会同时推进 `KeySwap0` 和 `KeySwap00`
4. 点击 slot 8 时，只会执行普通 `KeySwap7`，黑形态不变
5. 键盘和 GUI 交替使用不会改变循环顺序
6. `KeySwap2` 和 `KeySwap6` 中重复的空状态不会被合并
7. `KeySwap4` 与 `KeySwap8` 虽然都控制 `$headacc`，但 step 相互独立
8. `type = cycle` 和 `type = toggle` 混用时，每个 Key section 按自己的原始 `type` 生成，不受全局行为下拉覆盖
9. 同一个 Key section 内 `run = ...` 和 `$var = ...` 混用时，GUI 点击不会丢弃任何一类命令，并保持原顺序
10. `condition = $active != 0` 生成后仍是 `$active != 0`，不会被改写为 `$active > 0`
11. 含未知 Key body 行的 section，未知行会以 raw entry 形式进入共享 CommandList，不会静默消失
