# LaTeX 论文伴随笔记

LaTeX Paper Notes 是一个本地优先的 VS Code 扩展：在论文 LaTeX 中选中完整句子、段落或陈列公式，扩展会插入稳定的语义标记，把笔记保存为结构化 JSON，并生成可双向跳转的批注论文 PDF 与独立笔记 PDF。

[English README](README.md)

## 功能

- 初始化前展示根文件、编译引擎、受管源码树以及每一项文件改动，只有确认后才写入。
- 支持一个主文件及递归 `\input`、`\include`、`\subfile`、`\import`、`\subimport` 和字面量 `\InputIfFileExists` 子文件。
- 可在任一已确认的受管子文件中从选区添加笔记。
- 支持感想、例子、疑问、待修改、翻译五类固定条目，以及项目级可复用的自定义类型；旧 LaTeX 笔记块无损保留。
- 生成正常论文、批注论文和独立笔记 PDF，稳定目标保持为 `pnote.main.<id>` 与 `note.main.<id>`。
- 内置连续滚动 PDF.js 阅读器、搜索、前进后退历史和 SyncTeX 正反向定位。
- 无遥测、无云同步、无后台网络请求。

“翻译”只供手工填写，不联网、不调用翻译 API。自定义类型可以统一改名和换色，所有引用会同步更新。v0.4 仍不支持直接在 PDF 选中文字添加笔记，请从 LaTeX 源码选区创建。

## 环境要求

- Windows 桌面版 VS Code 1.114 及以上。
- TeX Live 或 MiKTeX，并具备所选论文引擎、用于笔记的 XeLaTeX 或 LuaLaTeX、`makeindex`、`synctex`、`kpsewhich`。
- TeX 包：`hyperref`、`xr-hyper`、`ctex`、`tcolorbox`、`imakeidx`。

`latexmk` 建议安装但不再是硬依赖；如果 MiKTeX 的 `latexmk` 因缺少 Perl 无法启动，内置构建器会自动改用 LaTeX 引擎直接构建。LaTeX Workshop 也只是可选推荐项。

## 安装

1. 获取 `latex-paper-notes-0.4.0.vsix` 和 SHA-256 文件。
2. 在 VS Code 执行“Extensions: Install from VSIX...”并选择 VSIX。
3. 安装后由你手动执行一次“Developer: Reload Window”。

也可执行：

```powershell
code --install-extension .\latex-paper-notes-0.4.0.vsix
```

## 一键初始化

1. 在 VS Code 打开论文所在文件夹；一个工作区文件夹对应一篇论文。
2. 执行“论文笔记：初始化论文笔记项目”。
3. 确认根文件。扩展会参考 `% !TeX root`、当前活动文件以及同时包含 `\documentclass` 与 `\begin{document}` 的候选。
4. 确认论文引擎和笔记引擎。
5. 检查递归源码树、警告以及所有“创建/修改”文件。
6. 点击“初始化”。

主文件会备份为 `<root>.paper-notes.bak`。插入的集成块有明确边界并使用 `\IfFileExists`；即使删除整个 `notes/`，正常论文仍能编译，笔记命令自动退化为空命令。重复初始化不会产生重复内容。

## 日常使用

1. 在任一受管 `.tex` 中选中完整句子、段落或完整陈列公式环境。
2. 右键“为选区添加论文笔记”，或按 `Ctrl+Alt+N`。
3. 输入标题，并确认类似 `introduction:sensor-calibration` 的稳定英文语义 ID。
4. 在右侧面板编辑结构化条目。切换笔记、关闭面板、构建和扩展退出前都会刷新待保存内容。
5. 点击“快速编译”生成正常论文、笔记 PDF 和批注论文。新项目的“完整构建”使用同一内置可靠流程；迁移项目仍可保留原来的大型脚本。

源码只会增加成对标记：

```tex
\PaperNoteBegin{introduction:sensor-calibration}
Selected paper text.
\PaperNoteEnd{introduction:sensor-calibration}
```

正常 PDF 不显示颜色和编号；批注 PDF 将整个选区显示为蓝色，并在末尾显示 `[N#]`。

## 跳转

- 批注论文 `[N#]` → 笔记 PDF 对应位置。
- 笔记 PDF 页码链接 → 批注论文原文目标。
- 笔记 PDF 编辑链接 → VS Code 中对应的结构化笔记。
- 面板“定位源码” → 选中对应标记之间的 LaTeX，包括子文件。
- “从光标定位批注 PDF” → SyncTeX 正向定位。
- 在批注 PDF 非链接位置 `Ctrl+单击` → SyncTeX 反向定位到工作区内源码。

部分外部 PDF 阅读器会限制跨文件链接，因此笔记 PDF 同时保留论文页码和原文摘录作为回退。

## 数据、诊断与恢复

`notes/paper-notes.json` 是 schema v4 的权威数据；`notes/main_notes.tex` 是确定性生成文件，不应手工修改。两者都适合 Git 跟踪。PDF、SyncTeX、LaTeX 辅助文件、`notes/build/`、`node_modules/`、`dist/` 和 VSIX 会被忽略。

所有项目路径必须是项目内的相对 POSIX 路径；绝对路径、`..` 越界和解析到工作区外的符号链接会被拒绝。机器上的可执行文件位置只保存在 VS Code 用户设置。

- “论文笔记项目诊断”：只检查工具和 TeX 包，不自动安装。
- 同时安装 TeX Live 与 MiKTeX 时，诊断会选择一套完整且一致的工具目录；正式构建也会把配置的引擎路径明确传给 `latexmk`，并将该目录置于构建子进程 `PATH` 最前面。
- “重新扫描受管 LaTeX 文件”：确认后才接受新依赖；`.fls` 新发现也必须确认。
- “验证论文笔记标记”：检查缺端、嵌套、重叠、跨文件重复 ID、孤立标记和孤立 JSON。
- “重新关联孤立笔记”：可用手工选区或最多三个候选；模糊候选绝不静默采用。
- “修复论文笔记集成”：只修复有边界的集成块，不改论文内容。
- 事务保存保留 `.last-good`；迁移会按原 schema 保留备份，例如 `notes/legacy/paper-notes.schema3.bak.json`。

## v0.2 迁移

打开 schema v1/v2/v3 项目会无损升级到 v4：笔记 ID、时间、内容、摘录、定位器和 PDF 目标名称均保持不变。未修改的 v0.3 或 v0.4 beta 项目样式会先备份再自动升级；手工修改过的样式不会被静默覆盖。现有构建脚本会迁移为 `legacy-script` 模式，因此原有私有补充材料流程不受影响。详见 [MIGRATION.md](MIGRATION.md)。

## 隐私与范围

公开 VSIX 不包含论文、笔记数据库、本机路径、凭据或研究 PDF。所有本地进程均用参数数组和 `shell: false` 启动；不受信任工作区禁用写入与构建。

本版只管理主论文；补充材料管理、PDF 选区添加、表格/图片对象批注、实时协作与云同步不在 v0.4 范围内。

许可证：MIT。
