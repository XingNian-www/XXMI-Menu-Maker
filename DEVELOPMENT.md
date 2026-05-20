# KeySwap GUI WebUI 开发文档

## 1. 项目定位

`index.html` 是一个纯前端单文件工具，用来把 3DMigoto / XXMI 常见的 `[Key*]` 配置转换成可视化 GUI 菜单。

它的核心工作是：

1. 在浏览器本地读取用户拖入或选择的 `.ini` / `.txt` 文件
2. 解析其中的 `[Key*]` 节和变量循环内容
3. 根据解析结果生成一个可点击的 GUI 菜单配置
4. 生成 GUI 所需的 PNG 纹理资源和 `draw_2d.hlsl`
5. 支持下载完整 ZIP 或仅下载生成后的 `.ini`

整个工具不依赖后端，不上传用户文件，所有处理都在浏览器内完成。

## 2. 文件结构

当前实现集中在一个文件里：

```text
index.html
```

文件由四部分组成：

```text
HTML 结构
CSS 样式
JavaScript 业务逻辑
内置 Shader 文本
```

主要页面区域：

```text
.app
├─ .panel-left          左侧配置区
│  ├─ ini 文件选择
│  ├─ MOD 文件夹选择（File System Access API）
│  ├─ 面板配置（含调色入口和面板背景图上传）
│  ├─ 行为配置
│  ├─ 按钮列表
│  └─ 下载按钮
├─ .panel-right         右侧预览区（面板 + INI 并排）
│  ├─ .preview-stage    面板预览
│  └─ .ini-view         生成的 INI 预览
├─ #iconPicker          Lucide 图标选择弹窗
├─ #ctxMenu             预览按钮右键菜单
├─ #draftHistory        历史暂存弹窗
├─ #imgCropper          图片裁剪弹窗
├─ #hoverInfo           面板按钮 hover 信息浮层
└─ #toast               提示条
```

## 3. 功能总览

### 3.1 输入

用户可以通过三种方式加载 ini：

1. 点击左侧文件选择区域
2. 直接拖入 `.ini` 或 `.txt` 文件
3. 在支持 File System Access API 的浏览器里选择 MOD 根目录，再选择其中任意子目录里的 `.ini`；勾选"包含 txt 文件"后也扫描 `.txt`，并立即刷新列表

入口 DOM：

```text
#iniFile
#drop
#btnOpenFolder
#folderIniSelect
```

处理函数：

```js
loadFile(file)
pickModFolder()
loadFolderFile(index)
```

文件夹模式会保存 `state.dirHandle`、`state.targetDirHandle` 和 `state.fileHandle`，用于后续写回选中 ini 所在文件夹。

### 3.2 解析

解析流程分两步：

```js
parseSections(text)
parseSwaps(sections)
```

`parseSections` 把 ini 文本拆成 section 列表。

输出结构：

```js
[
  {
    name: "KeySomething",
    lines: ["[KeySomething]", "key = ...", "$var = 0,1"]
  }
]
```

`parseSwaps` 从 section 列表中提取所有以 `Key` 开头的节。

输出结构：

```js
[
  {
    section: "KeySomething",
    key: "alt 1",
    assignments: [
      {
        variable: "$body",
        values: ["0", "1", "2"]
      }
    ],
    steps: 3
  }
]
```

### 3.3 编辑

用户可以编辑：

```text
标题
呼出键
点击修饰键
列数（默认自动推算，手动修改后锁定）
按钮间距
背景色
强调色
透明度
调色面板：按钮底色、hover 色、面板边框、按钮边框、标题投影、预览背景
预设配色 / 恢复默认配色
禁用标题文字投影
面板背景图
点击行为
是否删除原 [Key*] 节
按钮名称
按钮图标
按钮是否跳过
右键菜单（预览面板按钮）
```

基础配置会保存到 `localStorage`：

```js
const SETTINGS_KEY = "keyswap-gui-settings-v1";
```

当前文件相关草稿会保存到 `localStorage` + `IndexedDB`：

```js
const DRAFT_KEY = "keyswap-gui-drafts-v2";
const DB_NAME = "KeySwapDrafts";
```

`localStorage` 存草稿元信息，`IndexedDB` 存原 ini 文本、面板图片和按钮上传图片。历史暂存弹窗只展示最近 30 次。

### 3.4 输出

支持三种输出：

```text
只下载 ini
下载完整 ZIP
直接写入 MOD 文件夹（Chrome / Edge 等支持 File System Access API 的浏览器）
```

下载入口：

```js
#btnIni
#btnZip
#btnWriteFolder
```

核心函数：

```js
buildIni()
buildResources()
makeZip(files)
downloadBlob(blob, name)
writeGeneratedToFolder()
```

完整 ZIP 内容大致如下：

```text
<原文件名>.gui.ini
res_gui/draw_2d.hlsl
res_gui/bg.png
res_gui/title.png
res_gui/slot_01.png
res_gui/slot_hover_01.png
...
```

## 4. 全局状态

应用状态集中保存在 `state`：

```js
const state = {
  fileName: "",
  fileHandle: null,
  dirHandle: null,
  targetDirHandle: null,
  folderFiles: [],
  text: "",
  sections: [],
  swaps: [],
  panelImageRgba: null,
  panelImagePreview: null,
  slotMeta: [],
  mergeMode: false,
  fabAction: "",
  swapOrder: null,
};
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `fileName` | `string` | 当前加载的文件名 |
| `fileHandle` | `FileSystemFileHandle \| null` | 文件夹模式下当前 ini 的文件句柄 |
| `dirHandle` | `FileSystemDirectoryHandle \| null` | 文件夹模式下用户选择的根目录句柄 |
| `targetDirHandle` | `FileSystemDirectoryHandle \| null` | 当前选中 ini 所在目录句柄 |
| `folderFiles` | `Array` | 根目录和子目录内可选的 ini 文件列表；勾选 `scanTxtFiles` 后包含 txt |
| `text` | `string` | 原始 ini 文本 |
| `sections` | `Array` | `parseSections` 的结果 |
| `swaps` | `Array` | `parseSwaps` 的结果 |
| `panelImageRgba` | `Uint8ClampedArray \| null` | 用户上传的面板图片，256x256 RGBA |
| `panelImagePreview` | `string \| null` | 面板图片 data URL，用于网页预览 |
| `slotMeta` | `Array` | 每个按钮的 UI 元信息 |
| `mergeMode` | `boolean` | 是否处于批量选择模式 |
| `fabAction` | `string` | 批量操作类型："merge" \| "skip" \| "reset" |
| `swapOrder` | `Array \| null` | swap 签名数组，持久化自定义排序 |

`slotMeta` 单项结构：

```js
{
  name: "Body Hair",       // 从 Key 节后缀自动派生
  skip: false,
  iconKind: "auto",
  iconName: "shirt",
  iconColor: "#ff4fb3",
  iconRgba: null,
  iconPreview: null,
}
```

### 4.1 按钮命名规则

`newSlotMeta(swap)` 从 `[Key*]` 节后缀派生名称：
- `[KeySwapBodyHair]` → 去 KeySwap → `BodyHair` → 按大小写边界拆分 → `Body Hair`
- `[Key_HairColor]` → 去 Key → `_HairColor` → 去前导下划线 → `HairColor` → `Hair Color`
- `[KeySwap]` → 无后缀 → 退回用变量名 `$body / $hair`

拆分规则：先按 `_` `-` 空格切，再在大小写边界（`aA`）处切。每段首字母大写，空格连。

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 按钮显示名和生成 ini 注释名 |
| `skip` | `boolean` | 是否跳过此按钮 |
| `iconKind` | `auto \| lucide \| upload` | 图标来源 |
| `iconName` | `string` | Lucide 图标名 |
| `iconColor` | `string` | 图标颜色 |
| `iconRgba` | `Uint8ClampedArray \| null` | 用户上传或生成后的 RGBA 图标数据 |
| `iconPreview` | `string \| null` | 图标 data URL，用于网页预览 |

### 4.2 排序持久化

`swapOrder` 存储按钮自定义排序，在面板拖拽、合并/拆分后自动更新。

```js
// 签名结构
function swapSign(sw) {
  return { s: sw.sections.join("\x01"), k: sw.key, c: sw.condition, t: sw.type || "" };
}
```

工作流程：
1. `restoreSwapOrder()` 在加载文件后，用 localStorage 中保存的 `swapOrder` 恢复排序
2. 签名通过 `Map<JSON.stringify(swapSign(sw)), index>` 匹配，签名不匹配则放弃还原
3. 面板拖拽、合并、拆分后自动 `state.swaps.map(swapSign)` 重建排序
4. `saveSettings()` 将 `swapOrder` 持久化到 localStorage

## 5. INI 解析规则

### 5.1 Section 识别

section 正则：

```js
const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
```

符合下面格式的行会被识别为 section 标题：

```ini
[KeySomething]
```

### 5.2 变量赋值识别

变量赋值正则：

```js
const ASSIGN_RE = /^\s*(\$[A-Za-z0-9_]+)\s*=\s*([^;]+?)\s*$/;
```

支持格式：

```ini
$body = 0, 1, 2
```

不支持或会被忽略的情况：

```ini
body = 0, 1       ; 没有 $ 前缀
$body = 0 ; note  ; 当前正则会排除分号后的内容
```

### 5.3 [Key*] 节筛选

所有名称以 `Key` 开头的 section 会被解析为按钮：

```js
if (!sec.name || !/^Key/i.test(sec.name)) continue;
```

### 5.4 同键合并

`parseSwaps` 会把 (key, condition) 相同的 [Key*] 节合并为一个按钮：

```ini
[KeySwapBody]
key = alt 1
$body = 0, 1

[KeySwapHair]
key = alt 1          ← 同键同条件，合并
$hair = 0, 1, 2

[KeySwapDress]
key = alt 2          ← 不同键，独立
$dress = 0, 1
```

合并后 body 和 hair 各用独立计数器 (`$gui_stepN_0`, `$gui_stepN_1`)，点一次同时递进，档位短的末尾值延续。

key 为空的节不参与合并，各自独立。

### 5.5 忽略项

解析 [Key*] 时会忽略：

```text
空行
注释行
type
condition
```

`key = ...` 会被记录到 `swap.key`，但不会作为变量循环内容。

## 6. 图标系统

### 6.1 自动推荐图标

自动图标由 `suggestIcon(swap)` 负责。

它会把 swap 中所有变量名拼起来，然后用 `KEYWORD_MAP` 匹配关键词。

例如：

```js
[/hair|bang|wig/i, "scissors", "#c98c4a"]
```

表示变量名中包含 `hair`、`bang` 或 `wig` 时，推荐 Lucide 的 `scissors` 图标，颜色为 `#c98c4a`。

没有匹配时使用 fallback：

```js
{ name: "circle-dot", color: "#ff4fb3" }
```

### 6.2 Lucide 图标加载

图标来源分两层：

**第一层：内嵌图标**（25 个常用图标，离线可用）
```js
const BUILTIN_ICONS = { "crown": "<svg>...</svg>", ... };
const BUILTIN_ICON_NAMES = Object.keys(BUILTIN_ICONS);
```

`loadLucideSvg(name)` 优先返回内嵌 SVG，未命中再查 CDN。

**第二层：CDN 扩展**（联网时 1000+ 图标）
```js
const LUCIDE_BASE = "https://cdn.jsdelivr.net/npm/lucide-static@0.456.0/icons/";
```

图标索引来自：
```text
https://cdn.jsdelivr.net/npm/lucide-static@0.456.0/tags.json
```

缓存：
```js
let LUCIDE_INDEX = null;
const LUCIDE_CACHE = new Map();
```

`loadLucideIndex()` CDN 失败时 fallback 到 `BUILTIN_ICON_NAMES`，提示 "离线模式：仅显示常用图标"。

内嵌图标列表由 `KEYWORD_MAP` 中实际引用的所有图标 + fallback 组成（共 25 个）。

### 6.3 用户上传按钮图片

按钮图片上传入口在按钮列表里：

```text
data-act="upload"
```

处理流程：

```text
选择图片
→ openCropper(file, { size: 64 })
→ 保存到 slotMeta[index].iconRgba
→ 生成 data URL 存到 slotMeta[index].iconPreview
→ 刷新左侧缩略图和右侧面板预览
```

上传图片会参与 ZIP 资源生成，输出为：

```text
res_gui/icon_XX.png
```

### 6.4 用户上传面板图片

面板图片入口在「面板」section 内：

```text
#btnPanelImage     选择图片按钮
#btnClearPanelImage 清除面板图片按钮
#panelImageThumb   上传后显示的缩略图
```

在 `renderPreview()` 中，如果有 `state.panelImagePreview`，面板预览会显示上传的图片作为背景。

生成 ZIP 时，如果存在 `state.panelImageRgba`，则 `res_gui/bg.png` 使用上传图片；否则使用纯色背景。

## 7. PNG 资源生成

`rgbaToPng(width, height, rgba)` 通过 canvas.toDataURL 生成 PNG 字节。

### 7.1 资源尺寸

| 资源 | 尺寸 | 说明 |
|---|---|---|
| `bg.png` | `panelW × panelH` | 面板背景（圆角矩形 + 可配置边框 + 顶部强调色边框），动态匹配面板尺寸 |
| `title.png` | `(panelW-6)x48` | 标题文字图片（白色 + 可选投影，投影色可配置） |
| `slot_##.png` | `64x64` | 普通按钮（可配置底色/边框 + 图标 + 文字） |
| `slot_hover_##.png` | `64x64` | hover 按钮（同内容，背景使用 hover 色） |

`panelW` 和 `panelH` 计算公式：`padding = 16`，`slotSize = 64`，`gap` 和 `cols` 由用户配置。`renderBgRgba` 接受 `(width, height, opts)` 参数化渲染。当用户上传面板图片时，图片会缩放到面板圆角矩形区域绘制。

### 7.2 配色资源

调色面板会影响网页预览和导出 PNG：

```text
bgColor / bgAlpha       → bg.png 面板填充
accentColor             → bg.png 顶部边框
panelBorderColor        → bg.png 外边框
titleShadowColor        → title.png 标题投影
disableTitleShadow      → title.png 是否绘制投影
slotColor               → slot_##.png 背景
hoverColor              → slot_hover_##.png 背景
slotBorderColor         → slot_##.png / slot_hover_##.png 边框
previewBg               → 仅影响网页预览背景，不导出
```

内置预设在 `PALETTE_PRESETS`，默认值在 `PALETTE_DEFAULT`。

### 7.3 图片缩放规则

`openCropper(file, opts)` 会打开 1:1 裁剪弹窗，确认后返回目标尺寸 RGBA。

`dataUrlToRgba(dataUrl, size)` 用于从草稿里的 data URL 恢复可导出的 RGBA。

面板背景裁剪为 256×256，按钮图标裁剪为 64×64。导出时面板背景会缩放绘制到面板内容区。

## 8. ZIP 打包

ZIP 打包由 `makeZip(files)` 实现。

特点：

```text
不使用第三方库
store 模式
不压缩
手写 local file header
手写 central directory
手写 end of central directory
```

CRC32 由 `crc32(buf)` 计算。

文件名会统一替换反斜杠：

```js
f.name.replace(/\\/g, "/")
```

## 9. 生成 INI 的逻辑

核心函数：

```js
buildIni()
```

### 9.1 原 ini 处理

生成前会读取：

```js
const removeKeys = $("removeKeys").checked;
```

如果启用，会删除原始 ini 里的 `[Key*]` 节：

```js
secs = secs.filter(s => !s.name || !/^Key/i.test(s.name));
```

### 9.2 Present 注入

`injectPresent(sections)` 会查找原文件中的 `[Present]`。

如果存在，会在 `[Present]` 开头插入：

```ini
if $active && $gui_menu
  run = CommandListGuiMenu
endif
```

如果不存在，`buildIni()` 会新建一个 `[Present]`。

### 9.3 常量生成

生成的 `[Constants]` 包含 GUI 状态变量：

```ini
global $gui_menu = 0
global $gui_hover = 0
global $gui_hovered = 0
global $gui_clicked = 0
global $gui_slot = 0
global $gui_hold = 0
global $gui_drag = 0
global $gui_ww
global $gui_wh
global $gui_cpx
global $gui_cpy
global $gui_cox
global $gui_coy
global persist $gui_mx = 0.05
global persist $gui_my = 0.20
```

每个 active slot 会额外生成一个 step 变量：

```ini
global persist $gui_step1 = 0
global persist $gui_step2 = 0
```

`active slot` 指没有被用户跳过的按钮。

### 9.4 呼出键

呼出键来自：

```text
#menuKey
```

生成：

```ini
[KeyGuiMenu]
condition = $active == 1
key = alt
type = hold
$gui_menu = 1
```

### 9.5 点击修饰键

点击修饰键由 `clickKey()` 生成。

映射关系：

| UI 值 | 生成 key |
|---|---|
| `ctrl` | `no_alt no_shift ctrl VK_LBUTTON` |
| `shift` | `no_alt shift no_ctrl VK_LBUTTON` |
| `none` | `no_ctrl no_shift no_alt VK_LBUTTON` |
| `alt` | `no_ctrl no_shift alt VK_LBUTTON` |

点击配置会用于：

```ini
[KeyGuiHold]
[KeyGuiClick]
```

### 9.6 GUI 尺寸与 slot 结构

slot 固定 `64×64`。每个按钮是一张完整图片，包含：
- 圆角矩形背景（`border-radius: 9px`）+ 3px 白色边框
- 28×28 图标靠上居中
- 按钮名称文字靠下居中（11px 粗体，自动截断）

不再分层渲染（旧：共享 slot 背景 + 独立 icon 叠加），而是直接用 canvas 合成一张图。

每按钮对应两份 PNG：`slot_##.png`（普通态，深灰底）和 `slot_hover_##.png`（悬停态，强调色底）。

列数默认由 `autoCols(activeCount)` 自动推算，目标宽高比约 3:5。

### 9.7 绘制流程

主入口：

```ini
[CommandListGuiMenu]
run = CommandListGuiDims
run = CommandListGuiBg
run = CommandListGuiSlots
```

职责：

| CommandList | 职责 |
|---|---|
| `CommandListGuiDims` | 计算窗口尺寸和鼠标坐标 |
| `CommandListGuiBg` | 绘制背景 + 标题图片，处理拖动 |
| `CommandListGuiSlots` | 遍历所有按钮位置 |
| `CommandListGuiSlot` | 根据 hover 选 slot/slot_hover 资源并绘制 |
| `CommandListGuiClick` | 根据点击按钮修改变量 |

不再有独立的图标绘制 pass——图标和文字已合成到 slot 图片中。

### 9.8 cycle 行为

当行为选择为：

```text
按 KeySwap 表循环
```

生成逻辑会使用 `$gui_stepN` 记录当前档位。

示例：

```ini
$gui_step1 = $gui_step1 + 1
if $gui_step1 >= 3
  $gui_step1 = 0
endif

if $gui_step1 == 0
  $body = 0
elif $gui_step1 == 1
  $body = 1
elif $gui_step1 == 2
  $body = 2
endif
```

如果某个变量的 values 比最大 steps 短，会使用该变量最后一个值补齐：

```js
const v = a.values[step] !== undefined ? a.values[step] : a.values[a.values.length - 1];
```

### 9.9 toggle 行为

当行为选择为：

```text
仅 0 / 1 切换（多变量同步）
```

每个变量生成：

```ini
$body = 1 - $body
```

这种模式假设变量值只在 `0` 和 `1` 之间切换。

## 10. Shader

Shader 文本内置在：

```js
const SHADER_TEXT = `...`;
```

生成 ZIP 时输出为：

```text
res_gui/draw_2d.hlsl
```

它使用 `IniParams[87]` 传递尺寸和偏移：

```hlsl
#define SIZE   IniParams[87].xy
#define OFFSET IniParams[87].zw
```

INI 中通过 `x87 y87 z87 w87` 控制绘制区域：

```ini
x87 = width / $gui_ww
y87 = height / $gui_wh
z87 = x_offset
w87 = y_offset
```

绘制命令：

```ini
[CustomShaderGuiDraw]
vs = res_gui\draw_2d.hlsl
ps = res_gui\draw_2d.hlsl
blend = ADD SRC_ALPHA INV_SRC_ALPHA
cull = none
topology = triangle_strip
run = BuiltInCommandListUnbindAllRenderTargets
o0 = set_viewport bb
draw = 4, 0
```

## 11. 渲染流程

### 11.1 总刷新

通用刷新函数：

```js
rerender()
```

它会执行：

```js
saveSettings();
renderPreview();
renderIniView();
```

`rerender()` 始终同时刷新面板预览和 INI 预览（两者并排显示，无 tab 切换）。

### 11.2 左侧按钮列表

函数：

```js
renderSwapList()
renderSlotThumb(idx)
```

`renderSwapList` 负责渲染每个 [Key*] 项。

每项包含：

```text
缩略图
名称输入框
原 key 和变量数量
图标选择按钮
上传图片按钮
重置按钮
跳过按钮
```

### 11.3 面板预览

函数：

```js
renderPreview()
```

它会根据当前配置更新：

```text
面板颜色
面板边框 / 按钮底色 / hover 色 / 标题投影
面板背景图
标题
列数
间距
active slot
图标
```

面板和 INI 预览在右侧并排显示，各占一半宽度，各自独立滚动。

预览按钮带上：

```html
data-pre="index"
```

用于 hover 信息显示和右键菜单。

### 11.4 右键菜单

右键点击面板预览按钮弹出菜单，提供快捷操作：

```text
改名 → prompt()
绑定按键 → prompt() 修改 swap.key
拆分 → 将合并按钮（groups > 1）按 group 拆回多个独立按钮
跳过/取消跳过
从图标库选择 → openPicker()
上传图标 → openCropper(file, { size: 64 })
重置图标 → suggestIcon()
```

菜单由 `#ctxMenu` 渲染，显示时自动隐藏 hover 浮层并阻止重新弹出（`pointerover` 检查 `#ctxMenu` 可见状态）。

拆分菜单项仅在 `state.swaps[idx].groups.length > 1` 时显示（通过 `style.display` 动态控制）。

### 11.5 面板拖拽排序

预览面板上的按钮支持拖拽重排：

```text
dragstart → 记录 panelDragIdx，设置 dragging 类
dragover → 计算目标位置，交换 swapOrder
drop → 清理 dragging 类
```

核心函数 `panelReorder(fromIdx, tgtIdx)`：
- 仅在活跃子集（未 skip 的按钮）中排序
- 被 skip 的按钮保持原位
- 排序后更新 `state.swapOrder`

左侧按钮列表不再有 grip 拖拽（已移除），排序只通过预览面板拖拽操作。

### 11.6 面板 FAB 批量操作

右下角悬浮 + 号按钮（FAB），点击展开 3 个同尺寸渐变小圆按钮：

```text
合并 → 进入选择模式，勾选多个按钮后合并为一个
跳过 → 批量切换 skip 状态
重置图标 → 批量恢复自动图标
```

交互流程：
1. 点击 + → 展开子菜单（弹出动画，`flex-direction: row-reverse` 从右向左排列）
2. 子菜单项全部 38px 同尺寸，粉色渐变底
3. 选择一项 → `enterSelectMode(action)` → 面板 slot 显示复选框
4. 勾选 slot → 确认/取消按钮出现
5. 确认 → `doSelectConfirm()` 执行对应操作，退出选择模式

关键函数：
- `enterSelectMode(action)`：设置 `state.mergeMode = true`、`state.fabAction = action`
- `exitSelectMode()`：清理选择状态
- `doSelectConfirm()`：根据 `fabAction` 分支执行合并/跳过/重置

合并逻辑（`doSelectConfirm` case "merge"）：
- 至少选 2 个按钮
- action 和 cycle 类型不可混用
- 合并后 groups 从所有选中按钮平铺，name 为"N 合1"
- 拆分通过右键菜单"拆分"还原（见 11.4 节）

### 11.7 INI 预览

函数：

```js
renderIniView()
```

它会调用 `buildIni()`，然后做简单语法高亮。

高亮规则：

```js
section -> .k
注释 -> .c
$变量 -> .v
```

### 11.8 Hover 信息

相关函数：

```js
hoverText(idx)
positionHover(e)
showHoverInfo(e, idx)
hideHoverInfo()
```

### 11.9 调色面板

入口：

```text
#btnColorMode
#paletteSection
```

主要函数：

```js
enterColorMode()
exitColorMode()
applyPalette(values)
renderPalettePresets()
updatePaletteSwatches()
applyPreviewBg()
```

调色模式会隐藏左侧其他 section，只显示配色控制。预设按钮来自 `PALETTE_PRESETS`，恢复默认使用 `PALETTE_DEFAULT`。

`disableTitleShadow` 是复选框，影响 `renderPreview()` 的 CSS 变量和 `renderTitleRgba()` 是否绘制投影。

鼠标放到面板预览按钮上时，会显示：

```text
按钮名
原 section
原 key
循环档位数
变量和值列表
```

## 12. 事件绑定

主要事件集中在文件底部。

| 区域 | 事件 | 说明 |
|---|---|---|
| `#iniFile` | `change` | 选择 ini 文件 |
| `#drop` | `dragenter / dragover / dragleave / drop` | 拖拽加载文件 |
| `#btnOpenFolder` | `click` | 选择 MOD 文件夹 |
| `#folderIniSelect` | `change` | 加载文件夹内选中的 ini |
| 配置输入项 | `input` | 保存设置并刷新 |
| `#swapList` | `click` | 按钮列表操作代理 |
| `#swapList` | `input` | 修改按钮名 |
| `#guiGrid` | `pointerover / pointermove / pointerout` | hover 信息 |
| `#guiGrid` | `contextmenu` | 右键菜单 |
| `#btnPanelImage` | `click` | 上传面板图片 |
| `#btnClearPanelImage` | `click` | 清除面板图片 |
| `#btnColorMode` | `click` | 进入调色模式 |
| `#btnColorExit` | `click` | 退出调色模式 |
| `#palettePresets` | `click` | 应用预设配色 / 恢复默认 |
| `#previewBg` | `input` | 修改预览背景，不影响导出资源 |
| `#disableTitleShadow` | `change` | 启用 / 禁用标题投影 |
| `#btnDraftHistory` | `click` | 打开历史暂存 |
| `#draftHistoryList` | `click` | 恢复 / 删除历史暂存 |
| `#iconPicker` | `click` | 点击遮罩关闭弹窗 |
| `#pickerSearch` | `input` | 搜索 Lucide 图标 |
| `#pickerGrid` | `click` | 选择 Lucide 图标 |
| `#btnIni` | `click` | 下载 ini |
| `#btnZip` | `click` | 下载完整 ZIP |
| `#btnWriteFolder` | `click` | 直接写入 MOD 文件夹 |
| `document` | `click` | 关闭右键菜单、收起 FAB 子菜单 |
| `#ctxMenu` | `click` | 右键菜单项操作 |
| `#mergeFab` | `click` | 展开/收起 FAB 子菜单 |
| `#fabActions` | `click` | 批量操作子菜单项（合并/跳过/重置） |
| `#mergeConfirm` | `click` | 确认批量选择操作 |
| `#mergeCancel` | `click` | 取消批量选择模式 |
| `#guiGrid` | `dragstart / dragover / drop` | 面板拖拽排序 |

## 13. 典型数据流

### 13.1 加载文件到预览

```text
用户选择或拖入文件
→ loadFile(file)
→ file.text()
→ parseSections(text)
→ parseSwaps(sections)
→ state.slotMeta = state.swaps.map(newSlotMeta)
→ autoCols(activeCount) → 设置列数
→ renderSwapList()
→ rerender()
→ renderPreview()
→ renderIniView()
```

### 13.2 上传按钮图标到 ZIP

```text
点击某个按钮的上传图片
→ 选择 image/*
→ openCropper(file, { size: 64 })
→ slotMeta[index].iconRgba = rgba
→ slotMeta[index].iconPreview = dataURL
→ rerender()
→ 点击下载完整 ZIP
→ buildResources()
→ renderSlotRgba({ iconRgba, ... })
→ rgbaToPng(64, 64, mergedRgba)
→ res_gui/slot_XX.png
```

### 13.3 上传面板图片到 ZIP

```text
点击上传面板图片
→ 选择 image/*
→ openCropper(file, { size: 256 })
→ state.panelImageRgba = rgba
→ state.panelImagePreview = dataURL
→ rerender()
→ 点击下载完整 ZIP
→ buildResources()
→ rgbaToPng(256, 256, panelImageRgba)
→ res_gui/bg.png
```

### 13.4 草稿恢复

```text
拖入同一 ini 或点击历史暂存恢复
→ 读取 localStorage 草稿元信息
→ 从 IndexedDB 读取原 ini 文本、面板图片和按钮图片
→ dataUrlToRgba() 还原可导出的 RGBA
→ 恢复排序、按钮 meta、配色、行为配置
→ renderSwapList() / rerender()
```

### 13.5 下载完整 ZIP

```text
点击下载完整 ZIP
→ buildIni()
→ buildResources()
→ makeZip(files)
→ downloadBlob(blob, base + ".gui.zip")
```

### 13.6 直接写入文件夹

```text
点击选择 MOD 文件夹
→ showDirectoryPicker({ mode: "readwrite" })
→ 递归枚举根目录和子目录里的 .ini，勾选 scanTxtFiles 后包含 .txt，跳过名称以 DISABLED 开头的文件和文件夹
→ loadFolderFile(index) 读取选中的文件
→ 编辑配置
→ 点击写入文件夹
→ requestPermission({ mode: "readwrite" })
→ 写入到当前 ini 所在文件夹：<原文件名>.gui.ini
→ 写入到当前 ini 所在文件夹：res_gui/draw_2d.hlsl、bg.png、title.png、slot PNG
→ 如果原文件是 .ini，复制原文到同名 .txt，然后 removeEntry() 删除原 .ini 文件名
```

直接写入会写回当前选中 ini 所在的文件夹。扫描时会忽略任何名称以 `DISABLED` 开头的文件和文件夹（不区分大小写）。Firefox / Safari 不支持时，按钮会提示继续使用 ZIP。

扫描后会通过 `folderScanStats` 显示统计：目录数、文件数、ini/txt 数量、显示数量、忽略 `DISABLED` 数量和读取失败数量。扫描某个子目录失败时只记录错误并继续扫描其它目录。

UI 上会在文件夹入口旁提示：不要选择包含大量 ini 的大目录，否则递归扫描和下拉渲染会变卡；文件夹模式会直接写入文件夹并把原 `.ini` 改为 `.txt`，适合知道自己正在处理哪个 MOD 的用户。

`showDirectoryPicker` 使用固定 `id: FOLDER_PICKER_ID`，并把上次目录句柄以 `LAST_FOLDER_HANDLE_KEY` 存到 IndexedDB。下次选择时会把该句柄作为 `startIn`，让 Chrome / Edge 尽量从上次选择的位置打开。浏览器权限失效、站点数据被清理或 `file://` 策略变化时，仍可能回到用户目录。

## 14. 开发约定

### 14.1 修改原则

这个文件是单页工具，改动时优先保持小范围修改。

建议顺序：

1. 先确认改的是 UI、解析、生成 ini、资源生成，还是下载逻辑
2. 先读相关函数，不要直接全局重写
3. 能复用现有状态就不要新建平行状态
4. 修改生成 ini 时，同步检查 `renderIniView()` 和下载结果
5. 修改资源生成时，同步检查 `buildResources()` 和 ZIP 路径
6. 修改新增配置项时，同步检查 `loadSettings()`、`saveSettings()`、`flushDraftMeta()`、`loadDraft()` 和历史暂存恢复
7. 修改文件夹写入时，同步检查 ZIP 资源路径和 `writeGeneratedToFolder()` 写入路径

### 14.2 命名约定

已有命名风格：

```text
DOM id：camelCase，例如 btnZip、viewIni
函数名：camelCase，例如 buildIni、renderPreview
常量：UPPER_SNAKE_CASE，例如 SECTION_RE、LUCIDE_BASE
状态字段：camelCase，例如 slotMeta、panelImageRgba
生成 ini 变量：$gui_xxx
生成资源名：ResourceGuiXxx
生成 CommandList：CommandListGuiXxx
```

### 14.3 不要轻易改的部分

以下部分对输出兼容性影响较大，修改前要谨慎：

```text
rgbaToPng
SHADER_TEXT
CustomShaderGuiDraw
IniParams[87]
CommandListGuiDims
CommandListGuiSlot
CommandListGuiClick
writeGeneratedToFolder
```

### 14.4 添加新配置项

添加配置项时通常需要改这些地方：

```text
HTML：新增输入控件
CSS：必要样式
loadSettings：读取本地设置
saveSettings：保存本地设置
事件绑定：input/change 后 rerender
renderPreview：如果影响预览
buildIni：如果影响生成 ini
buildResources：如果影响 ZIP 资源
flushDraftMeta / loadDraft / 历史暂存恢复：如果需要随当前文件保存
```

### 14.5 添加新资源

添加 ZIP 资源时改：

```js
buildResources()
```

如果 ini 需要引用资源，还要改：

```js
buildIni()
```

确保 ini 内路径使用双反斜杠：

```ini
filename = res_gui\xxx.png
```

ZIP 内路径使用正斜杠：

```text
res_gui/xxx.png
```

## 15. 常见开发任务

### 15.1 增加新的自动图标关键词

修改：

```js
const KEYWORD_MAP = [...]
```

示例：

```js
[/cloak|mantle/i, "shirt", "#a47bff"]
```

注意：规则从上到下匹配，越具体的规则应该放越前面。

### 15.2 改按钮尺寸

需要同时改：

```text
CSS .gui-slot
CSS .gui-slot img
renderPreview() 里的 gridTemplateColumns
buildIni() 里的 slotSize
CommandListGuiSlot 里的图标缩进和图标尺寸
buildResources() 里的 slot/icon PNG 尺寸
```

这是容易出错的改动，不建议只改 CSS。

### 15.3 改面板布局

主要看：

```js
buildIni()
renderPreview()
```

两边必须保持一致。

如果网页预览的布局和生成 ini 的布局不一致，用户看到的和游戏里显示的会不同。

### 15.4 离线 Lucide 图标

已实现混合模式：

1. 25 个常用 SVG 内嵌在 `BUILTIN_ICONS` 对象中（覆盖 `KEYWORD_MAP` 所有引用图标 + fallback）
2. `loadLucideSvg(name)` 优先返回内嵌 SVG
3. `loadLucideIndex()` CDN 失败时 fallback 到 `BUILTIN_ICON_NAMES`
4. 联网时图标选择器仍显示全量 1000+ Lucide 图标
5. 离线时自动推荐 + 图标选择器仅显示 25 个内嵌图标，提示 "离线模式"

内嵌图标列表在 `BUILTIN_ICONS` 常量中，如需增减，需同步维护。

## 16. 已知限制

### 16.1 INI 解析不是完整 INI 解析器

当前解析器只为 [Key*] 场景服务。

它不处理复杂语法，例如：

```text
多行值
转义字符
复杂注释
非 $ 开头变量
表达式里的逗号
```

### 16.2 草稿存储依赖浏览器本地数据

上传图片和当前文件草稿会存到浏览器本地 `IndexedDB`。

如果用户清理站点数据、换浏览器、无痕模式退出，历史暂存会丢失。不同浏览器对 `file://` 页面本地存储策略也可能不同。

### 16.3 Lucide 图标网络依赖

联网：全量 1000+ 图标；离线：fallback 到内嵌 25 个常用图标。
网络不可用时，上传图片功能不受影响。

### 16.4 toggle 模式只适合 0 / 1

toggle 模式生成的是：

```ini
$var = 1 - $var
```

如果变量不是 0 / 1，结果可能不符合预期。

### 16.5 预览不等于游戏内最终效果

网页预览模拟的是布局、颜色、图标和 hover 信息。

真实游戏内效果还取决于：

```text
3DMigoto / XXMI 版本
draw_2d.hlsl 是否兼容
游戏渲染分辨率
鼠标坐标变量可用性
原 mod 的变量和条件
```

## 17. 手动测试清单

改动后建议至少测试这些路径：

1. 选择一个包含 `[Key*]` 的 ini
2. 左侧能识别出正确数量的按钮
3. 列数自动推算合理，手动修改后锁定
4. 切换 skip 后列数自动重算（未手动锁定时）
5. 修改标题后，右侧面板标题同步变化
6. 修改列数和间距后，面板布局同步变化
7. 鼠标悬停预览按钮，能显示变量和值
8. 右键预览按钮，弹出菜单各项功能正常
9. 上传按钮图片后，左侧缩略图和右侧预览同步变化
10. 上传面板图片后，右侧面板背景同步变化，缩略图显示
11. 清除面板图片后恢复纯色背景
12. 点击跳过某按钮后，预览和 ini 都不再包含该按钮
13. 点击「只下载 ini」能下载 `.gui.ini`
14. 点击「下载完整 ZIP」能下载 `.gui.zip`
15. ZIP 中包含 `res_gui/draw_2d.hlsl`
16. ZIP 中包含 `bg.png`、`slot_##.png`、`slot_hover_##.png` 和 shader
17. 切换 cycle / toggle 后，生成 ini 中的点击逻辑符合预期
18. 勾选 / 取消「删除原 [Key*] 节」后，生成 ini 符合预期
19. 右键预览按钮改名，左侧列表同步更新
20. 右键「绑定按键」弹出 prompt，修改后预览和 INI 同步
21. 面板预览和 INI 预览并排正常渲染
22. FAB + 号按钮展开/收起子菜单正常，子菜单 3 个按钮可点击
23. 进入批量选择模式后 slot 显示复选框，确认/取消按钮正常工作
24. 批量合并 2+ 按钮后，合并按钮 groups > 1，"拆分"菜单项可见
25. 右键拆分合并按钮后，恢复为独立按钮，groups 各为 1
26. 面板拖拽排序后 skip 按钮保持原位，活跃按钮顺序可保存
27. 面板背景 PNG 分辨率随 panelW × panelH 变化，不再固定 256x256
28. 调色面板能进入/退出，预设配色和恢复默认能即时刷新预览
29. 禁用标题文字投影后，网页预览和导出 `title.png` 都不绘制投影
30. 上传按钮图和面板图后，刷新并恢复草稿，导出 ZIP 仍包含对应图片效果
31. Chrome / Edge 下选择 MOD 根目录后，能递归列出子目录里的 ini，并忽略 `DISABLED*` 文件/文件夹
32. 点击写入文件夹后，在选中 ini 所在文件夹生成 `.gui.ini` 和 `res_gui/*`，原 `.ini` 变为 `.txt`

## 18. 快速定位表

| 想改什么 | 先看哪里 |
|---|---|
| 文件加载 | `loadFile`、`parseSections`、`parseSwaps` |
| 文件夹读写 | `pickModFolder`、`loadFolderFile`、`writeGeneratedToFolder` |
| [Key*] 解析规则 | `parseSwaps`、`ASSIGN_RE`（含同键同条件合并） |
| 自动图标 | `KEYWORD_MAP`、`suggestIcon` |
| 内嵌图标 | `BUILTIN_ICONS`、`loadLucideSvg` |
| 图标选择器 | `openPicker`、`renderPickerGrid` |
| 离线图标 fallback | `loadLucideIndex`、`BUILTIN_ICON_NAMES` |
| 按钮列表 | `renderSwapList`、`renderSlotThumb` |
| 面板预览 | `renderPreview` |
| 调色面板 | `PALETTE_DEFAULT`、`PALETTE_PRESETS`、`applyPalette`、`renderPalettePresets` |
| 右键菜单 | `#ctxMenu`、`ctxTargetIdx`、`case "rename"/"key"/"split"/"skip"/"picker"/"upload"/"reset"` |
| hover 信息 | `hoverText`、`showHoverInfo`、`positionHover` |
| 自动列数 | `autoCols`、`colsManual` |
| INI 预览 | `renderIniView` |
| INI 生成 | `buildIni` |
| ZIP 资源 | `buildResources`、`renderSlotRgba` |
| PNG 输出 | `rgbaToPng` |
| slot 图片合成 | `renderSlotRgba`（canvas: 圆角矩形 + 边框 + 图标 + 文字） |
| 面板背景 | `renderBgRgba(width, height, opts)`（参数化尺寸，不再硬编码 256x256） |
| 标题图片 | `renderTitleRgba`（48px 高，白字 + 可选投影） |
| FAB 批量操作 | `enterSelectMode`、`exitSelectMode`、`doSelectConfirm` |
| 面板拖拽排序 | `panelReorder`、`swapOrder`、`swapSign` |
| 持久化排序 | `restoreSwapOrder`、`saveSettings` |
| 图片 RGBA | `openCropper`、`dataUrlToRgba` |
| ZIP 打包 | `makeZip` |
| 下载 | `downloadBlob`、`#btnIni`、`#btnZip` 事件 |
| 面板图片 | `#btnPanelImage`、`state.panelImageRgba`、`state.panelImagePreview` |
| localStorage 持久化 | `loadSettings`、`saveSettings`、`flushDraftMeta` |
| IndexedDB 草稿图片 | `dbOpen`、`dbGet`、`dbPut`、`dataUrlToRgba` |

## 19. 维护建议

如果后续功能继续增加，建议优先拆分为这些模块：

```text
parser.js        INI 解析
generator.js     INI 生成
resources.js     PNG、图片、ZIP
icons.js         Lucide 和图标推荐
state.js         应用状态
ui.js            渲染和事件绑定
shader.js        内置 shader 文本
```

当前规模下，单文件仍然能维护。只要继续保持函数边界清楚，不把生成 ini、资源生成和 UI 事件塞进同一个函数里，就还算稳。
