# KeySwap GUI WebUI 开发文档

## 1. 项目定位

`index.html` 是一个纯前端单文件工具，用来把 3DMigoto / XXMI MOD 里的 `[Key*]` 快捷键配置转换成鼠标可点击的 GUI 菜单。

核心目标是严格映射原始 Key 行为：GUI 点击一次必须等价于按下原始 INI 中同一个 `key` 一次。

## 2. 文件结构

当前项目主要文件：

```text
index.html                         单文件前端应用
README.md                          用户说明
STRICT_KEYSWAP_GUI_MAPPING.md      严格映射语义规范
测试.ini                            回归测试用样例
```

`index.html` 包含 HTML、CSS、JavaScript 和内置 `draw_2d.hlsl` 文本。

## 3. 主要流程

```text
读取 ini/txt
→ parseSections()
→ parseSwaps()
→ buildKeySlots()
→ 渲染左侧按钮列表和右侧预览
→ buildIni()
→ buildResources()
→ 下载 ZIP / 下载 ini / 写入文件夹
```

## 4. 输入方式

支持三种输入：

1. 点击文件选择区域读取 `.ini` 或 `.txt`
2. 拖入 `.ini` 或 `.txt`
3. Chrome / Edge 使用 File System Access API 选择 MOD 文件夹，再从列表里选择目标文件

相关入口：

```js
loadFile(file)
pickModFolder()
loadFolderFile(index)
```

文件夹模式会保存：

```js
state.dirHandle
state.targetDirHandle
state.fileHandle
state.folderFiles
```

## 5. INI 解析

### 5.1 parseSections

`parseSections(text)` 把 INI 拆成 section 数组，并保留原始顺序索引：

```js
{
  name: "KeySwap0",
  lines: ["[KeySwap0]", "key = 5", "..."],
  index: 12
}
```

`index` 用来处理重复 section 名。不能只用 section 名做唯一键，因为真实 INI 里可能出现重复 `[KeySwap]`。

### 5.2 parseSwaps

`parseSwaps(sections)` 只解析业务 `[Key*]` section，并跳过工具自己生成的 GUI Key：

```text
KeyGuiMenu
KeyGuiHold
KeyGuiClick
```

每个原始 `[Key*]` 会先变成独立 handler：

```js
{
  section: "KeySwap0",
  sourceIndex: 12,
  key: "5",
  condition: "$active == 1",
  type: "cycle",
  assignments: [...],
  commandLists: [...],
  entries: [...],
  rawEntries: [...]
}
```

`entries` 保留 Key body 里的原始执行顺序，包含：

```text
assign   $var = 0,1,2
run      run = CommandListFoo
raw      暂时不理解的行
```

### 5.3 buildKeySlots

`buildKeySlots(handlers)` 按原始 `key` 分组，生成 GUI slot。

一个 GUI slot 对应一个原始 key，不对应 active 变量，也不对应单个 condition。

```js
{
  keySlot: true,
  key: "5",
  handlers: [KeySwap0Handler, KeySwap00Handler],
  sections: ["KeySwap0", "KeySwap00"],
  assignments: [...],
  commandLists: [...]
}
```

同 key 下每个 handler 都保留自己的：

```text
condition
type
entries
stepVar
commandName
```

## 6. 严格映射语义

原始 INI 中同一个 `key` 可以出现在多个 `[Key*]` section 中。按下这个 key 时，所有满足各自 `condition` 的 section 都会执行。

GUI 必须保持这个行为：

```ini
if $gui_clicked == 1
  if $active == 1
    run = CommandListCycleKeySwap0
  endif
  if $black_active == 1
    run = CommandListCycleKeySwap00
  endif
endif
```

同一个 slot 内多个 handler 必须用多个独立 `if`，不能用 `elif`。

不同 slot 之间可以用 `if/elif`，因为一次点击只会命中一个 `$gui_clicked`。

## 7. Key 重写

如果用户不勾选“删 Key 节”，原始 `[Key*]` 会被重写为调用共享 CommandList：

```ini
[KeySwap0]
key = 5
condition = $active == 1
run = CommandListCycleKeySwap0
```

这样键盘快捷键和 GUI 点击共用同一份循环逻辑，避免 step 错位。

重写时会保留原 Key section 中的注释、空行和未知字段；会移除或替换这些行：

```text
key
condition
type
run
$变量赋值表
```

如果用户勾选“删 Key 节”，原始 `[Key*]` 会从输出 INI 中删除，但 GUI 仍会生成对应 CommandList。

## 8. 循环 CommandList

每个原始 handler 生成一个独立共享 CommandList：

```ini
[Constants]
global $ks_step_KeySwap0 = -1

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
endif
```

重复档位必须保留。不能根据当前变量值反推下一档。

`type = toggle` 在当前严格模式里归一为 `cycle`。原因是这里生成的是显式 step 表，`cycle` 可以覆盖 0/1 toggle 表达的状态切换。

## 9. Active 条件

`scanActiveVarsFromSections()` 会从 Key section 的 `condition` 中提取 active 相关条件，用于决定 GUI 何时渲染。

支持：

```text
$active
$active == 1
$black_active != 0
2 <= $form_active
```

反向比较会规范成 active 在左边：

```text
2 <= $form_active  →  $form_active >= 2
```

如果已经提取到 `$active == 0` 这类精确条件，不会再额外加入裸 `$active`，避免生成 `$active || $active == 0` 这种放宽条件。

## 10. Present 注入

`injectPresent()` 负责在 `[Present]` 中插入 GUI 渲染调用：

```ini
if $gui_menu && ($active == 1 || $black_active == 1)
  run = CommandListGuiMenu
endif
```

如果导入的是已经生成过的 INI，会先清理工具生成的简单 GUI 调用块，再插入当前新块。用户手写的其它 `[Present]` 逻辑会保留。

如果开启“修复跨角色面板”，会补充：

```ini
post $active = 0
post $black_active = 0
```

## 11. GUI 生成

`buildIni()` 当前统一走 `buildSingleIni()`。

不存在按 active 独立生成面板的路径。active 条件只用于 `[Present]` 判断 GUI 是否渲染；点击执行完全由每个 handler 的原始 `condition` 判断。

生成的主要 section：

```text
[KeyGuiMenu]             呼出菜单
[KeyGuiHold]             拖动面板
[KeyGuiClick]            点击 slot
[CommandListGuiDims]     计算窗口和鼠标坐标
[CommandListGuiMenu]     绘制入口
[CommandListGuiBg]       背景、标题、拖动
[CommandListGuiSlots]    遍历 slot
[CommandListGuiSlot]     单个 slot 绘制和 hover 检测
[CommandListGuiClick]    按 key slot 调用 handler
```

工具生成的 `KeyGui*` 不参与下一次业务 KeySwap 解析。

## 12. 资源生成

`buildResources()` 生成：

```text
res_gui/draw_2d.hlsl
res_gui/bg.png
res_gui/title.png
res_gui/slot_01.png
res_gui/slot_hover_01.png
...
```

资源数量来自当前活跃 key slot，跳过的 slot 不生成图片资源。

slot 图片是完整合成图，包含：

```text
背景
边框
图标或上传图片
按钮文字
按键提示
```

## 13. 编辑功能

用户可以编辑：

```text
标题
呼出键
点击修饰键
列数
间距
配色
面板背景图
按钮名称
按钮图标
跳过按钮
绑定按键
排序
```

右键“绑定按键”会同步更新 slot 和该 slot 下所有 handler 的 key，导出时原 `[Key*]` 也会使用新 key。

严格模式下不允许拆分同 key 多 handler slot。拆分会破坏“点击一次等价于按原 key 一次”的语义。

## 14. 暂存

基础设置保存到：

```js
localStorage: keyswap-gui-settings-v1
```

当前文件草稿保存到：

```js
localStorage: keyswap-gui-drafts-v2
IndexedDB: KeySwapDrafts / blobs
```

localStorage 保存元信息和 UI 配置；IndexedDB 保存原 INI 文本、面板图片和上传图标。

草稿恢复会校验 slot 数量和 `swapSign()`，避免错误套用到不匹配的文件。

## 15. 导出和写入

支持三种输出：

```text
只下载 ini
下载完整 ZIP
写入 MOD 文件夹
```

文件夹写入逻辑：

1. `.ini` 输入默认输出同名 `.ini`
2. 原 `.ini` 内容备份为 `.txt`
3. 如果同名 `.txt` 已存在，改用 `原名.backup-YYYYMMDD-HHMMSS.txt`
4. 写入或覆盖 `res_gui` 中的生成资源

如果输入是 `.txt`，默认生成同名 `.ini`，不改原 `.txt`。

## 16. ZIP 打包

`makeZip(files)` 使用 store 模式，无压缩，手写 ZIP 结构。

文件名使用 UTF-8 EFS 标记，支持中文文件名。

## 17. Shader

内置 shader 使用 `IniParams[87]` 传递尺寸和偏移：

```hlsl
#define SIZE   IniParams[87].xy
#define OFFSET IniParams[87].zw
```

INI 中通过 `x87/y87/z87/w87` 设置绘制参数。

## 18. 重要约束

开发时不要做这些：

1. 不要把同 key 不同 condition 的 handler 改成 `elif`
2. 不要引入 `$gui_target` 选择形态
3. 不要根据变量当前值推断下一档
4. 不要合并重复档位
5. 不要用全局 GUI 设置覆盖原始 Key section 的 `type`、`condition` 或命令顺序
6. 不要把工具生成的 `KeyGui*` 当成业务按钮
7. 不要在二次导入时重复注入 `[Present]` GUI 调用
8. 不要静默丢弃 Key body 中暂时不理解的 raw 行

## 19. 建议测试

当前项目还没有正式测试框架。修改核心逻辑后至少手动验证：

```text
测试.ini 生成 10 个 key slot
生成后再导入仍是 10 个 key slot
key = 5 同时包含 KeySwap0 和 KeySwap00
slot 内 handler 使用独立 if，不使用 elif
无 $gui_step
有 $ks_step_*
KeySwap4 和 KeySwap8 的 $headacc step 独立
$active == 0 不会变成 $active || $active == 0
重复 [KeySwap] section 能各自重写正确
右键改 key 后导出 key 同步变化
```

推荐后续新增 `tests/keyswap-generation.test.js`，把这些检查固化成 Node 测试。
