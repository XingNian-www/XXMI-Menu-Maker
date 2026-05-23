# XXMI Mod 制作者常用命令指南

> 从 XXMI-Libs-Package 源码提取, 聚焦 mod 制作中真正高频使用的命令及其使用条件和边界情况

---

## 目录

1. [ShaderOverride — 着色器替换/跳过](#1-shaderoverride--着色器替换跳过)
2. [draw 命令 — 自定义绘制](#2-draw-命令--自定义绘制)
3. [TextureOverride — 纹理/缓冲区替换](#3-textureoverride--纹理缓冲区替换)
4. [资源复制 — 管线间搬运数据](#4-资源复制--管线间搬运数据)
5. [CustomShader — 注入自定义 HLSL 着色器](#5-customshader--注入自定义-hlsl-着色器)
6. [常量与变量系统](#6-常量与变量系统)
7. [流程控制](#7-流程控制)
8. [Hunting — 着色器狩猎工作流](#8-hunting--着色器狩猎工作流)
9. [Key 绑定 & Preset 预设](#9-key-绑定--preset-预设)
10. [Vertex Limit Raise](#10-vertex-limit-raise)
11. [ShaderRegex — 运行时汇编补丁](#11-shaderregex--运行时汇编补丁)
12. [Present — 帧级操作](#12-present--帧级操作)

---

## 1. ShaderOverride — 着色器替换/跳过

### 匹配机制

```
[ShaderOverride*]
Hash = <64位十六进制着色器哈希>
```

**如何获取 Hash**:
1. 开启 Hunting 模式 → 按 `Numpad2/5` 循环着色器 → 按 `Numpad3/6` 标记
2. 标记后 Hash 会复制到剪贴板, 着色器反编译到 `ShaderFixes/` 目录

**匹配时机**: 每个 draw call 的 5 个管线阶段 (VS/HS/DS/GS/PS) 各查一次。O(1) 哈希表查找, 找到则执行对应段的命令列表。

### 常用命令及其行为

#### `handling = skip` — 跳过绘制

```ini
[ShaderOverrideHide]
Hash = 69732c4f23cb6c48
handling = skip
```

**行为**: 设置 `call_info->skip = true`, 该 draw call 不提交。**在 pre 命令列表阶段执行, 只对 pre 有意义**。

**边界情况**:
- post 命令列表**仍然会运行** (call_info 还在)
- 如果同时在 pre 中用 `draw = from_caller` 手动重发, 原始 draw 被跳过但手动 draw 照常执行
- 被 hunting_marking_mode = skip 覆盖时, 同时会设 `hunting_skip = true`, 防止双重隐藏

#### `run = CustomShaderXxx` — 运行自定义着色器

```ini
[ShaderOverrideReplace]
Hash = aabbccdd11223344
handling = skip
run = CustomShaderMyReplacement
```

**执行流程**:
1. 保存当前管线状态 (Shader/Blend/Depth/Rasterizer/Sampler/Viewport/Topology)
2. 替换为 CustomShader 段定义的着色器和状态
3. 运行该 CustomShader 的 pre 命令列表
4. 运行该 CustomShader 的 **post** 命令列表 (这里是 `draw = from_caller`)
5. 恢复原始管线状态

**边界情况**:
- `max_executions_per_frame = N` 限制每帧执行次数, 超出则跳过
- 着色器文件设为 `null` 则该阶段解绑 (如 `ps = null`)
- 如果没有指定着色器文件, 保留原始着色器不修改
- 递归深度上限 `MAX_COMMAND_LIST_RECURSION`, 防止循环引用

#### `run = CommandListXxx` — 运行动态命令列表

```ini
[ShaderOverrideComplex]
Hash = aabbccdd11223344
run = CommandListMyWorkflow
```

**行为**: 运行另一个 `[CommandList*]` 段中的命令序列。该命令列表中的每条命令按序执行。

**`run` 的三种目标类型**:
| 写法 | 匹配目标 | 特点 |
|------|---------|------|
| `run = CommandListFoo` | `[CommandListFoo]` | 纯命令执行, 不修改管线 |
| `run = CustomShaderFoo` | `[CustomShaderFoo]` | 替换着色器+管线状态, 再执行命令列表 |
| `run = BuiltInCustomShaderFoo` | `[BuiltInCustomShader*]` | 内置预定义着色器替换 |

#### `checktextureoverride = <target>` — 触发纹理替换

```ini
[ShaderOverrideTriggerTO]
Hash = ...
checktextureoverride = ps-t0      ; 对 PS 纹理槽 0 的资源执行所有匹配的 TextureOverride 命令列表
checktextureoverride = ib         ; 对当前索引缓冲区
```

**行为**: 查找所有匹配 `<target>` 的 `[TextureOverride*]` 段, 依次运行它们的命令列表。

**使用条件**:
- `<target>` 必须在当前管线中是有效且已绑定的资源
- 默认情况下, 不加 `pre`/`post` 前缀时会同时加入 pre 和 post, 意味着纹理替换命令在 draw 前后各执行一次
- **关键**: 如果全局所有 TextureOverride 的 pre/post 命令列表都为空, XXMI 优化器会自动把隐式的 `checktextureoverride` 优化掉 (可节省 ~0.2fps CPU 时间)

**配合 `this` 资源目标**:
```ini
[TextureOverrideMyTex]
Hash = c3e55ebd
; 在 checktextureoverride 触发的命令列表中, 'this' 指向当前资源
; 例: 把当前纹理的大小写入 IniParams
x0 = rt_width     ; (注意 rt_width 是 RTV 的宽度, 不是 this 的宽度)
```

#### `preset = PresetName` / `exclude_preset = PresetName`

**激活预设**:
```ini
[ShaderOverrideWithPreset]
Hash = ...
preset = PresetMyEffect     ; 当这个 ShaderOverride 激活时, 自动激活预设
```

**排除预设**:
```ini
[ShaderOverrideDisablePreset]
Hash = ...
exclude_preset = PresetMyEffect  ; 阻止预设激活
```

**Preset 生命周期** (每帧评估):
1. `preset = Xxx` 将预设标记为 `triggered = true`
2. `exclude_preset = Xxx` 将预设标记为 `excluded = true` (覆盖 triggered)
3. 帧末 `Update()`: triggered && !excluded → `Activate()`; !triggered || excluded → `Deactivate()`

**边界情况**:
- `unique_triggers_required = N` — 同一帧内需要 N 个**不同的**命令列表调用 `preset = Xxx` 才激活 (AND 逻辑)
- 预设的过渡效果 (transition) 在 activate/deactivate 时平滑变化

#### 表达式中的着色器过滤

```ini
x0 = ps-t0              ; PS 的纹理槽 0 有无匹配的 TextureOverride
                        ; 0 = 无匹配, 1 = 有匹配(无filter_index), 负零 = 未绑定
local $partner = vs     ; VS 阶段有无匹配的 ShaderOverride/ShaderRegex
                        ; 有 filter_index 时返回 filter_index 值, 否则 1
```

**使用场景**: 在 ShaderOverride 的命令列表中检测纹理状态, 然后条件分支:
```ini
[ShaderOverrideAdaptive]
Hash = ...
if ps-t0 == 1 && cursor_showing
    handling = skip
endif
```

---

## 2. draw 命令 — 自定义绘制

### 命令速查

| 命令 | 参数 | 对应 API |
|------|------|---------|
| `draw = VertexCount, StartVertex` | 2 个表达式 | `Draw()` |
| `draw = from_caller` | 无 | 用原始参数重发 (支持所有 draw 类型) |
| `draw = auto` | 无 | 从 vb0 自动推算顶点数 |
| `drawauto` | 无 | `DrawAuto()` |
| `drawindexed = IndexCount, StartIndex, BaseVertex` | 3 个表达式 | `DrawIndexed()` |
| `drawindexed = auto` | 无 | 从 ib 推算索引数 |
| `drawindexedinstanced = IdxCnt, InstCnt, StartIdx, BaseVtx, StartInst` | 5 个表达式 | `DrawIndexedInstanced()` |
| `drawindexedinstanced = auto` | 无 | 从 ib 推算 + 原始 InstanceCount |
| `drawinstanced = VtxCnt, InstCnt, StartVtx, StartInst` | 4 个表达式 | `DrawInstanced()` |
| `dispatch = X, Y, Z` | 3 个表达式 | `Dispatch()` |
| `drawindexedinstancedindirect = buffer, offset` | 资源目标 + 表达式 | `DrawIndexedInstancedIndirect()` |
| `drawinstancedindirect = buffer, offset` | 资源目标 + 表达式 | `DrawInstancedIndirect()` |
| `dispatchindirect = buffer, offset` | 资源目标 + 表达式 | `DispatchIndirect()` |

### `draw = from_caller` 详解

**最常用的模式**:
```ini
[CustomShaderMyEffect]
vs = ShaderFixes/my_vs.hlsl
ps = ShaderFixes/my_ps.hlsl
draw = from_caller          ; 在 CustomShader 的 post 命令列表中, 用原始参数重发
handling = skip             ; 挂到 ShaderOverride 上跳过原始 draw

[ShaderOverrideUseEffect]
Hash = ...
handling = skip
run = CustomShaderMyEffect
```

**它如何工作** (CommandList.cpp:1278-1335):
```
读取 state->call_info->type →
  DrawCall::DrawIndexedInstanced → DrawIndexedInstanced(IndexCount, InstanceCount, FirstIndex, FirstVertex, FirstInstance)
  DrawCall::DrawInstanced        → DrawInstanced(VertexCount, InstanceCount, FirstVertex, FirstInstance)
  DrawCall::DrawIndexed          → DrawIndexed(IndexCount, FirstIndex, FirstVertex)
  DrawCall::Draw                 → Draw(VertexCount, FirstVertex)
  DrawCall::DrawInstancedIndirect    → DrawInstancedIndirect(buffer, args_offset)
  DrawCall::DrawIndexedInstancedIndirect → DrawIndexedInstancedIndirect(buffer, args_offset)
  DrawCall::DispatchIndirect     → DispatchIndirect(buffer, args_offset)
  DrawCall::Dispatch             → Dispatch(X, Y, Z)
  DrawCall::DrawAuto             → DrawAuto()
```

**关键边界情况**:
- ⚠️ `from_caller` 只能在**有 active draw call 的上下文**中使用 (即 ShaderOverride/CustomShader 触发时)
- ⚠️ 在 `[Present]` 段中使用 `draw = from_caller` → `NO ACTIVE DRAW CALL` 警告, 不会发出 draw
- ⚠️ `handling = skip` **只在 pre 中生效**, 但 `draw = from_caller` 通常在 CustomShader 的 **post** 命令列表中运行 (因为在 pre 中替换着色器, post 中发 draw)
- Hunting 模式下如果当前对象被标记为 skip, from_caller 也会被跳过

### `draw = auto` / `drawindexed = auto`

```
draw = auto           → 检查 vb0: vertex_count = (ByteWidth - offset) / stride → Draw(count, 0)
drawindexed = auto    → 检查 ib: index_count = (ByteWidth - offset) / (2 或 4) → DrawIndexed(count, 0, 0)
```

**限制**:
- 只能看 slot 0 的 vb/ib
- 假设 vb0 存的是每顶点数据 (不检查 input layout, 不区分 per-vertex/per-instance)
- 无法获取 offset → 从 offset=0 开始

---

## 3. TextureOverride — 纹理/缓冲区替换

### 匹配方式

#### 方式 1: Hash 精确匹配 (最常用)

```ini
[TextureOverrideReplaceTex]
Hash = c3e55ebd          ; 32 位十六进制哈希
```

Hash 由 CRC32C 硬件指令在资源首次绑定时计算。适用场景: **替换特定纹理/缓冲区**。

#### 方式 2: 模糊匹配 (无需 Hash)

```ini
[TextureOverrideFuzzyMatch]
match_type = Texture2D
match_width = height * 16 / 9     ; 16:9 宽高比
match_height = !res_height         ; 高度不等于分辨率
match_bind_flags = +unordered_access -render_target
match_priority = -1                ; 低优先级, 精确 Hash 优先
```

**表达式语法**:
```
match_width = [op] value | field [* multiplier | field2] [/ divider]
```
运算符: `=`, `!=`, `<`, `>`, `<=`, `>=` (默认 `=`)

**限制**: 模糊匹配只在**没有 Hash 精确匹配时才尝试**。Hash 和模糊匹配键不能共存于同一段。

#### 方式 3: Draw Context 匹配 (可与 Hash 或模糊匹配叠加)

```ini
[TextureOverrideSpecificDraw]
Hash = c3e55ebd
match_vertex_count = >1000              ; 仅在顶点数 > 1000 时匹配
match_index_count = =2880               ; 仅在索引数恰好 = 2880 时匹配
match_first_instance = >0               ; 仅在 instanced draw 时匹配
```

**支持**: `match_first_vertex`, `match_first_index`, `match_first_instance`, `match_vertex_count`, `match_index_count`, `match_instance_count`

### filter_index 工作方式

```ini
[TextureOverrideFoo]
Hash = c3e55ebd
filter_index = 42       ; 自定义编号

[ShaderOverrideBar]
Hash = ...
x3 = ps-t0              ; 匹配到 filter_index=42 → 返回 42
                        ; 匹配到但无 filter_index → 返回 1
                        ; 无匹配 → 返回 0
                        ; 未绑定 → 返回 -0.0 (用 asint 检测)
```

**返回值优先级**: 多个 TextureOverride 匹配同一资源时, `match_priority` 高的优先, 同 priority 按段名字典序排列。命令列表都会执行, 但 `filter_index` 只取优先级最高的那个。

### 常用 TextureOverride 命令

```ini
[TextureOverrideDenyCPU]
Hash = e27b9d07
deny_cpu_read = 1           ; 阻止 CPU 读取, 返回空 buffer

[TextureOverrideExpandCopy]
Hash = e27b9d07
expand_region_copy = 1      ; 扩展 CopySubresourceRegion 复制区域

[TextureOverrideResize]
Hash = c3e55ebd
width = 2048                ; 覆盖纹理尺寸
height = 1024
format = R8G8B8A8_UNORM     ; 覆盖格式

[TextureOverrideRescale]
Hash = c3e55ebd
width_multiply = 0.5        ; 缩放纹理 (0.5 = 缩小一半)
height_multiply = 2.0       ; 高度放大 2 倍
```

**条件**: `width/height/format` 覆盖在 **资源创建时**生效, 不是在 draw call 时。

### 同名 Hash 多段处理

多个 `[TextureOverride*]` 有相同 Hash 时:
- 所有段的命令列表**都会执行** (不像 ShaderOverride 只执行第一个)
- `allow_duplicate_hash = overrule` 可抑制重复 Hash 警告
- `match_priority` 决定执行顺序

---

## 4. 资源复制 — 管线间搬运数据

### 语法

```
<destination_slot> = [option1 option2...] <source_slot>
```

### 常用模式

#### 把渲染目标当纹理用

```ini
[ShaderOverrideReadRT]
Hash = ...
ps-t0 = ref o0          ; 引用 RTV0 作为 PS 的纹理输入 (不复制, 直接用指针)
```

#### 保存缓冲区到自定义资源

```ini
[ResourceSavedVB]
type = Buffer

[ShaderOverrideSave]
Hash = ...
ResourceSavedVB = copy vb0     ; 完整复制顶点缓冲区到自定义资源
```

#### 把自定义资源绑到管线

```ini
ps-t0 = ref ResourceSavedVB    ; 把之前保存的自定义资源绑到 PS t0
vb0 = copy ResourceNewVB       ; 用新顶点缓冲区替换
```

#### 解绑资源

```ini
o0 = null               ; 解绑渲染目标 0
ps-u0 = null            ; 解绑 UAV
```

### 复制选项详解

| 选项 | 行为 | 何时用 |
|------|------|--------|
| (无) | 自动判断: 自定义资源 → copy; RTV → ref; 同类型 → ref; 跨类型 → copy | 大多数情况 |
| `copy` | 创建新资源 + CopyResource/CopySubresourceRegion | 需要独立副本时 |
| `ref` / `reference` | 直接共享同一资源指针 | 只读引用, 省内存 |
| `copy_desc` | 只复制资源描述 (尺寸/格式), 不复制数据 | 需要同尺寸空资源 |
| `unless_null` | 源为 NULL 时什么都不做 | 可选绑定 |
| `mono` | 用单通道视图 (立体相关) | 立体渲染 |
| `raw` | 用原始视图 (Raw UAV/SRV) | 字节级访问 |
| `resolve_msaa` | 用 ResolveSubresource 解析 MSAA | MSAA 资源 |
| `set_viewport` | 复制后自动设置视口匹配资源尺寸 | 渲染到纹理 |
| `no_view_cache` | 每次重新创建视图 | 动态变化场景 |

### 边界情况

- **VB 复制到 SRV**: 自动转为 Structured Buffer, 保留 stride/offset 信息
- **CB 复制**: 常量缓冲区总是 copy (不能 ref), 自动处理尺寸不匹配 (CopySubresourceRegion)
- **跨类型复制**: 源和目标类型不同时, 默认走 `copy` 路径
- **深度缓冲区特殊处理**: 深度/模板格式解析自动选择合适的 view 格式
- **`this` 只在 checktextureoverride 上下文中有效**, 其他场景返回 NULL
- 复制命令在**运行时**执行, 每次 draw call 触发都会执行 (除非被条件分支隔离)

---

## 5. CustomShader — 注入自定义 HLSL 着色器

### 完整示例

```ini
[CustomShaderMyEffect]
; 着色器入口 (null = 不解绑, 不指定 = 保留原始)
vs = ShaderFixes/my_vs.hlsl
ps = ShaderFixes/my_ps.hlsl
gs = null                   ; 明确解绑几何着色器

; 编译选项
flags = skip_optimization debug

; 管线状态 (可选, 未指定时使用当前游戏状态)
cull = none
depth_enable = false
blend = add src_alpha inv_src_alpha
topology = triangle_list
sampler = linear_filter

; 每帧最大执行次数
max_executions_per_frame = 1

; 命令列表 (post 中通常放 draw = from_caller)
draw = from_caller
```

### 着色器编译

- HLSL 源文件相对于 `d3d11.dll` 所在目录查找
- 通过 `D3DCompile()` 编译, 编译选项由 `flags` 指定
- 默认 `optimization_level3`
- 编译错误会输出到日志

### 管线状态覆盖

CustomShader 可以覆盖**全部**管线状态, 不指定的部分保留游戏当前状态:

| 类别 | 键 | 说明 |
|------|-----|------|
| **着色器** | `vs`, `hs`, `ds`, `gs`, `ps`, `cs` | HLSL 文件路径 |
| **混合** | `blend`, `alpha`, `mask`, `alpha_to_coverage`, `sample_mask`, `blend_factor` | 支持 per-RT (blend[0]~blend[7]) |
| **深度** | `depth_enable`, `depth_write_mask`, `depth_func`, `stencil_enable`, `stencil_front/back`, `stencil_ref` | |
| **光栅化** | `fill`, `cull`, `front`, `depth_bias`, `scissor_enable`, `multisample_enable` | |
| **拓扑** | `topology` | 支持 1~32 控制点补丁列表 |
| **采样器** | `sampler` | `point_filter` / `linear_filter` / `anisotropic_filter` |

State Merge 选项: `blend_state_merge`, `depth_stencil_state_merge`, `rasterizer_state_merge` 设为 `true` 会合并而非替换——即把 CustomShader 的状态覆盖到原始状态上, 只改指定的字段。

### 执行流程

```
Original Draw Call
  → ShaderOverride pre command list (handling=skip)
  → [原始 draw 被跳过]
  → CustomShader::Run()
      1. 保存当前管线状态
      2. 替换着色器 + 用户指定的状态
      3. 运行 pre command list
      4. 运行 post command list (draw=from_caller 在这里)
      5. 恢复原始管线状态
  → ShaderOverride post command list
```

### 边界情况

- 使用 `rasterizer_state_merge = true` 时, 只需指定要修改的字段, 其余继承原始状态
- `draw = from_caller` 必须在 post 中运行 (因为在 pre 执行时着色器还没替换完)
- `handling = skip` 必须挂在 ShaderOverride 上, 不能直接挂在 CustomShader 上
- 着色器文件找不到 → 编译失败 → 该阶段保留原始着色器

---

## 6. 常量与变量系统

### IniParams (t120 传入着色器)

```ini
[Constants]
x = 0.8           ; IniParams[0].x = 0.8
y = 1.0           ; IniParams[0].y = 1.0
z = 1.2           ; IniParams[0].z = 1.2
w = 2.0           ; IniParams[0].w = 2.0
; 等价写法:
x0 = 0.8
y0 = 1.0
; 支持更高索引:
x7 = rt_width / 2
y15 = $my_var * 3.14
```

**寄存器**: 默认 `t120` (可通过 `[Rendering] ini_params = N` 修改, -1 禁用)

**边界**: IniParams 更新通过 `Map/Unmap` 写入 GPU buffer, `CommandListFlushState` 做去重——只在实际有变化时才写入。

### 全局变量

```ini
[Constants]
global $my_counter = 0
global persist $hud_enabled = 1    ; 自动保存到 d3dx_user.ini
```

- `$` 前缀标识变量
- 全局变量在所有命名空间中可用 (通过命名空间限定)
- `persist` 变量每 60 秒 (默认) 自动保存, F10 重载时保存, 退出时保存
- Ctrl+Alt+F10 (`wipe_user_config`) 清除持久变量

### 局部变量

```ini
local $temp = rt_width * 0.5     ; 声明并赋值
local $scoped_var                ; 仅声明 (默认 0.0)
```

- 作用域: 当前 `{...}` 块 (if/elif/else)
- 可以遮蔽外层同名局部变量 (但会警告)
- 不能遮蔽全局变量 (会警告)

### 变量赋值

```ini
$my_var = 42
$my_var = $other_var + 1.0
x = $my_var * 2.0
```

### 表达式关键字 (可在任何数值位置使用)

| 关键字 | 值 |
|--------|-----|
| `rt_width`, `rt_height` | 当前渲染目标尺寸 |
| `res_width`, `res_height` | 屏幕分辨率 |
| `window_width`, `window_height` | 窗口尺寸 (需 `allow_windowcommands`) |
| `time` | 游戏运行时间 (秒) |
| `hunting` | Hunting 是否激活 (0/1) |
| `frame_analysis` | 帧分析是否激活 (0/1) |
| `vertex_count`, `index_count`, `instance_count` | 当前 draw call 的计数 |
| `first_vertex`, `first_index`, `first_instance` | 当前 draw call 起始偏移 |
| `cursor_showing` | 光标可见 (0/1) |
| `cursor_x`, `cursor_y` | 光标位置 (0~1 归一化) |
| `cursor_screen_x`, `cursor_screen_y` | 光标屏幕坐标 |
| `cursor_window_x`, `cursor_window_y` | 光标窗口客户区坐标 |
| `scissor_left`, `scissor_top`, `scissor_right`, `scissor_bottom` | 当前裁剪矩形 |

---

## 7. 流程控制

```ini
if $condition == 1
    x = 1.0
elif $condition == 2    ; 也支持 else if
    x = 2.0
else
    x = 0.0
endif
```

**支持的运算符** (优先级从高到低):
`!` `+` `-` (一元) → `**` → `*` `/` `//` `%` → `+` `-` → `<` `<=` `>` `>=` → `==` `!=` `===` `!==` → `&&` → `||`

**`===` vs `==`**: `===` 在位级别比较 (区分 -0 和 +0), `==` 是数值比较

**可用的条件值**:
```ini
if $my_var == 5                ; 变量比较
if ps-t0 != 0                  ; 纹理绑定/匹配检测
if cursor_showing && $var > 0  ; 组合条件
if rt_width > 1920             ; 分辨率检测
```

**边界**: if/elif/else/endif 必须配对, 不平衡会发警告。嵌套深度无硬限制但过多嵌套影响可读性。

---

## 8. Hunting — 着色器狩猎工作流

### 基础配置

```ini
[Hunting]
hunting = 1                       ; 1=开启, 2=软禁用
marking_mode = skip               ; 选中的着色器变黑 (方便视觉定位)
marking_actions = clipboard hlsl asm regex  ; 标记行为

; 着色器导航
next_pixelshader = no_modifiers VK_NUMPAD2
previous_pixelshader = no_modifiers VK_NUMPAD1
mark_pixelshader = no_modifiers VK_NUMPAD3     ; 标记 → dump 到 ShaderFixes/

; 顶点着色器
next_vertexshader = no_modifiers VK_NUMPAD5
previous_vertexshader = no_modifiers VK_NUMPAD4
mark_vertexshader = no_modifiers VK_NUMPAD6

; 其他着色器类型
next_geometryshader / mark_geometryshader (Numpad 5/6 + VK_DECIMAL)
next_domainshader   / mark_domainshader   (Numpad 8/9 + VK_DECIMAL)
next_hullshader     / mark_hullshader     (Divide/Multiply + VK_DECIMAL)
next_computeshader  / mark_computeshader  (Numpad 2/3 + VK_DECIMAL)

; 缓冲区
next_vertexbuffer / mark_vertexbuffer
next_indexbuffer  / mark_indexbuffer

; 全局
done_hunting = no_modifiers VK_ADD          ; 恢复所有着色器
toggle_hunting = no_modifiers VK_NUMPAD0    ; 开关狩猎
reload_config = no_modifiers VK_F10         ; 重载配置
wipe_user_config = ctrl alt VK_F10          ; 清除用户配置
take_screenshot = no_modifiers VK_SNAPSHOT  ; 截图
show_original = VK_F9                       ; 按住暂时禁用 mod
analyse_frame = VK_F8                        ; Dump 下一帧全部资源
```

### marking_actions 各选项

| 选项 | 行为 |
|------|------|
| `clipboard` | 复制 Hash 到剪贴板 |
| `hlsl` | 反编译着色器到 HLSL, 写入 `ShaderFixes/` |
| `asm` | 反汇编着色器, 写入 `ShaderFixes/` |
| `regex` | 输出 ShaderRegex 补丁后的着色器 |
| `mono_snapshot` | 单通道截图 |
| `snapshot_if_pink` | 仅在 `marking_mode = pink` 时截图 |

### marking_mode 各选项

| 选项 | 效果 |
|------|------|
| `skip` | 不渲染该着色器的对象 (视觉上消失) |
| `original` | 回退到原始着色器 (忽略 ShaderFixes 中的替换) |
| `pink` | 输出为粉红色高亮 |
| `mono` | 单通道渲染 (调试用) |

### 典型工作流

```
1. 修改 d3dx.ini: hunting = 1
2. 启动游戏 → 按 Numpad0 开关 hunting 覆盖层
3. 按 Numpad2/5 循环着色器 → 目标变黑/粉红时停下
4. 按 Numpad3/6 标记 → Hash 复制到剪贴板 + 着色器 dump 到 ShaderFixes/
5. 在 ShaderFixes/ 中找到刚生成的 .hlsl/.txt 文件
6. 创建 [ShaderOverride] 段开始修
```

---

## 9. Key 绑定 & Preset 预设

### Key 段

#### 类型

| type | 行为 |
|------|------|
| `activate` | 按下时应用设置, 释放后恢复 (默认) |
| `hold` | 按住时应用, 释放时恢复 |
| `toggle` | 按一次激活, 再按一次恢复 |
| `cycle` | 每次按下循环到下一个值 |

#### 完整示例

```ini
[KeyHoldExample]
Key = RBUTTON
Key = XB_LEFT_TRIGGER          ; 同时支持鼠标右键和手柄
type = hold
y = 0.25
delay = 100                    ; 按下后延迟 100ms 再生效
transition = 100               ; 100ms 线性过渡
transition_type = linear

[KeyCycleExample]
Key = E
Back = Q                       ; 后退键
type = cycle
wrap = false                   ; 不循环回绕
smart = true                   ; 智能同步 (如果当前值匹配某预设, 自动对齐)
z = 0.25, 0.5, 0.75           ; 3 个预设值
transition = 100
transition_type = cosine

[KeyToggleExample]
Key = F11
type = toggle
x = 0.0  ; 奇数次按下 → x=0.0, 偶数次 → 恢复之前的值

[KeyRunCommandListExample]
Key = F
run = CommandListSomeWorkflow  ; 按下时运行命令列表
```

**过渡类型**: `linear` (线性) / `cosine` (余弦, 更平滑的 ease-in-out)

**按键名**: A-Z, 0-9 直接用字符; 其他用 `VK_` 前缀 (如 `VK_F1`, `VK_RETURN`); Xbox 手柄用 `XB_A`, `XB_LEFT_TRIGGER` 等; `NO_MODIFIERS` 排除 Ctrl/Alt/Shift/Win

### Preset 段

```ini
[PresetDepthOfField]
unique_triggers_required = 0
w = 0.01                         ; 景深参数
transition = 500
transition_type = cosine

[PresetDisableDOF]
w = 0.0

; 在 ShaderOverride 中激活:
[ShaderOverrideDOFShader]
Hash = 1234567890abcdef
preset = PresetDepthOfField      ; 这个着色器激活时自动启用景深预设

[ShaderOverrideDisableDOF]
Hash = fedcba0987654321
exclude_preset = PresetDepthOfField   ; 这个着色器激活时排除景深预设
```

**Preset 与 Key 的区别**:
- Key: 玩家手动按键触发
- Preset: 由代码逻辑 (preset/exclude_preset 命令) 自动触发
- 两者都支持过渡效果和变量设置

---

## 10. Vertex Limit Raise

### 配置

先在 `[Rendering]` 中启用:

```ini
[Rendering]
allow_buffer_resize = 1
```

### 使用方式

#### 精确方式 (推荐)

```ini
[TextureOverrideVertexLimitRaise]
Hash = c3e55ebd
override_vertex_count = 120000     ; 目标顶点数
override_byte_stride = 40          ; 每顶点字节数
; 最终缓冲区大小 = override_vertex_count × override_byte_stride = 4.8MB

; 可选: 如果缓冲区实际 stride 和游戏声明的不同
uav_byte_stride = 36
```

#### 旧版方式

```ini
[TextureOverrideVertexLimitRaiseOldWay]
Hash = e27b9d07
; 段名含 "VertexLimitRaise" 时自动扩大到 ~8.8MB (8800000 字节)
; 不需要额外参数
```

### 内部逻辑 (IniHandler.cpp:2874-2900)

1. 读取 `override_vertex_count` → 如果 > 0:
   - 必须有 `override_byte_stride`, 否则报错
   - `override_byte_width = override_byte_stride × override_vertex_count`
   - 如果设置了 `uav_byte_stride`, 还会调整 UAV 元素数
2. 如果没设 `override_vertex_count` 但段名含 "VertexLimitRaise":
   - 回退到 `override_byte_width = 8800000` (约 8.8MB, 模拟旧版 GIMI 行为)
3. 否则不覆盖缓冲区大小

**注意**: 错误的 `override_byte_stride` 会导致渲染异常或崩溃

---

## 11. ShaderRegex — 运行时汇编补丁

### 适用场景

- 不需要替换整个着色器, 只想插入/修改几行代码
- 需要跨着色器模型自动适配 (ps_4_0 + ps_5_0)
- 避免手动维护多个着色器变体

### 完整示例 (UE4 阴影修复)

```ini
[ShaderRegexUE4Shadow]
shader_model = ps_4_0 ps_5_0     ; 匹配这两种着色器模型
temps = stereo tmp1              ; 声明需要的临时寄存器 (自动分配 r 编号)
filter_index = 0                 ; 可选, 传给 ShaderOverride 的匹配值

[ShaderRegexUE4Shadow.Pattern]
mul r\d+\.xyzw, r\d+\.yyyy, cb0\[28\]\.xyzw\n
mad r\d+\.xyzw, (?P<pos_x>r\d+)\.(?P<swizzle_x>[xyzw])[xyzw]{3}, cb0\[27\]\.xyzw, r\d+\.xyzw\n
mad r\d+\.xyzw, (?P<pos_z>r\d+)\.(?P<swizzle_z>[xyzw])[xyzw]{3}, cb0\[29\]\.xyzw, r\d+\.xyzw\n
add (?P<result>r\d+)\.xyzw, r\d+\.xyzw, cb0\[30\]\.xyzw\n
div r\d+\.[xyzw]{2}, (?P=result)\.[xyzw]{4}, r\d+\.wwww\n

[ShaderRegexUE4Shadow.Pattern.Replace]
\n
// UE4 shadow correction:\n
ld_indexable(texture2d)(float,float,float,float) ${stereo}.xyzw, l(0,0,0,0), t125.xyzw\n
add ${tmp1}.x, ${pos_z}.${swizzle_z}, -${stereo}.y\n
mad ${pos_x}.${swizzle_x}, -${tmp1}.x, ${stereo}.x, ${pos_x}.${swizzle_x}\n
\n
${0}                          ; ${0} 插入原始匹配的代码

[ShaderRegexUE4Shadow.InsertDeclarations]
dcl_resource_texture2d (float,float,float,float) t125
```

### 关键机制

- **PCRE2 正则引擎**: 支持命名捕获组 `(?P<name>...)`, 反向引用 `(?P=name)`
- **多行模式**: 默认开启, `\n` 匹配换行
- **大小写不敏感**: 默认开启
- **自动分配临时寄存器**: `temps` 中声明, 系统查找空闲 r 编号
- **自动调整 dcl_temps**: 如果用了新临时寄存器, 自动更新声明
- **InsertDeclarations**: 自动检测声明是否已存在, 避免重复

### 命令列表

ShaderRegex 主段也是命令列表段, 可以在匹配时执行命令:
```ini
[ShaderRegexWithCommands]
shader_model = vs_5_0
; 命令列表内容:
x = 1.0
```

### 限制

- 只支持汇编着色器 (不支持 HLSL 直接匹配)
- 正则过于复杂可能影响加载速度
- 任何子段解析失败 → 整个 ShaderRegex 组被禁用

---

## 12. Present — 帧级操作

```ini
[Present]
; post = 帧末执行 (在 Present 调用前) — 用于绘制覆盖层
; pre = 帧初执行 (在 Present 调用后) — 用于清除/重置

; 帧初清除资源
post x = 0                          ; 重置 IniParam
post ResourceDepth = null           ; 解绑自定义资源
post clear = ResourceAccum          ; 清除累积缓冲区

; 帧末绘制
pre run = CustomShaderOverlay       ; 绘制 HUD 覆盖层

; 帧末效果
post run = CommandListPostProcess   ; 后处理
```

**边界**:
- `draw = from_caller` 在 `[Present]` 中无效 (没有 active draw call)
- IniParams 在 Present 中修改, 下一帧着色器才能看到
- `clear` 在 Present 中可能导致首帧只有一只眼被清除 (驱动 bug)

---

## 附录: 常见陷阱速查

| 陷阱 | 说明 |
|------|------|
| `handling = skip` 在 post 中无效 | skip 只在 pre 阶段设置 call_info 标记 |
| `draw = from_caller` 不在 CustomShader 的 post 中执行 | 着色器还没替换就发了 draw |
| ShaderOverride 多个段同名 Hash 不设 `allow_duplicate_hash` | 第二个段会被警告, 命令列表可能冲突 |
| TextureOverride Hash 和模糊匹配键混用 | 会报错, 二者互斥 |
| `this` 在非 checktextureoverride 上下文使用 | 返回空指针 |
| 复制命令在每次触发时都执行 | 每帧多次 draw 会多次复制, 注意性能 |
| `if` 条件中纹理过滤表达式 (`ps-t0`) | 只在有 active draw call 的上下文中有效 |
| `ps-t0` 返回值 | 0/1/filter_index/-0.0 四种, 注意 -0.0 检测 |
| `max_executions_per_frame` | 只限制 CustomShader, 不限制普通 CommandList |
| IniParams 更新延迟 | 修改后不一定立即可见于着色器, 需 CommandListFlushState |
