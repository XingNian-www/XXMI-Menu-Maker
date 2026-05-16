# XXMI KeySwap → GUI 菜单生成器

把 MOD 里那堆 `alt+1 切头发、alt+2 切衣服` 的快捷键，变成一个鼠标能点的浮窗菜单。

## 解决什么问题

你下载的 MOD 靠一堆组合键切换部件，记不住、按错、不知道当前切到第几档。这个工具把 MOD 的 `.ini` 拖进去，自动生成带图标的 GUI 菜单面板，进游戏呼出来点就行了。

## 在线使用

https://xingnian-www.github.io/XXMI-Menu-Maker/

## 怎么用

1. 打开 MOD 文件夹，找到主 `.ini` 文件
2. 用浏览器打开 `index.html`（或直接访问 GitHub Pages），把 `.ini` 拖进去
3. 自动识别所有按键循环，生成按钮面板预览
4. 调图标、排布局、合并/跳过/改按键，所见即所得
5. 点"下载完整 ZIP"，解压扔回 MOD 文件夹，进游戏按呼出键即可

## 特点

- 纯前端，不上传文件，离线也能用
- 自动从变量名推荐图标和颜色
- 拖拽排序、合并拆分、批量操作，全在界面上完成
- 生成完整 ZIP：INI + DDS 纹理 + HLSL 着色器

## 兼容性

适用于所有使用 3DMigoto / XXMI 框架的 MOD（原神、崩铁、鸣潮、崩坏3rd等）。

## 开发

参见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 鸣谢

- 作者 [星念](https://github.com/XingNian-www)
- 创作工具 [OpenCodeUI](https://github.com/lehhair/OpenCodeUI)
- 致谢 [lehhair](https://github.com/lehhair)
