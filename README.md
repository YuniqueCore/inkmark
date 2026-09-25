# InkMark · 划词批注工作台

给 AI 改过的文本做**行内批注**的纯网页小工具。划选文字写批注，一键导出三种格式，把"哪里有问题"准确递回给 AI。

UI 按 shadcn/ui 语系构建（Tailwind CSS v4 + 设计 token，灵感来自 rareui）：中性 zinc 底、细边框、subtle 阴影、明暗双主题（顶栏切换，跟随系统偏好，localStorage 记忆）。构建产物 gzip 约 40KB。

## 功能

- **划词批注**：选中正文文字 → 浮动工具条 → 选类型（问题 / 建议 / 疑问 / 重点 / 认可）→ 写批注。批注以彩色高亮留在原文上。
- **对照视图**：贴入 AI 改稿，生成原文 vs 改稿的行级 track-changes diff（Myers 算法，超大改动自动降级）；批注钉在被改动的原文行上，"哪里被改了、哪里有意见"一眼对齐。
- **三种导出**（顶栏「导出」或 ⌘/Ctrl+S）：
  1. **原文 + 批注**：完整原文，批注以 `【批注①·问题】……` 行内标记插在锚点后；
  2. **片段 + 批注**：逐条列出被批注的片段和对应批注；
  3. **评审引用块**：Markdown 引用格式，直接贴回聊天窗口给 AI agent。
  支持复制与下载 .md；默认不含已解决批注（可勾选包含）。
- **W3C Web Annotation 导入 / 导出**：批注可导出为标准 Annotation JSON（TextQuoteSelector + TextPositionSelector 双选择器）；导入时自动按 quote 在目标文本里重锚（位置失配 → 全文搜索 → prefix/suffix 消歧），锚不上的明确跳过、绝不错锚。打开 .json 文件即可导入。
- **slop 预扫描**：内置 [anti-slop-kit](https://github.com/YuniqueCore/natural-talk) 的中英文词库（zh 169 条 / en 212 条），一键把套话候选标成红色波浪线预填批注，人工复核后解决或删除。扫描管线与 `slop_check.py` 完全对齐：代码围栏 / 行内代码 / URL / 邮箱保护、正则 flags、重叠去重先于 cluster/density 阈值升级。
- **批注管理**：侧栏列表，按类型与状态筛选，定位 / 编辑 / 解决 / 删除，全部破坏性操作二次确认。
- **自动保存**：localStorage；也可导出 / 导入 JSON 会话（打开文件时选 .json 即导入）。
- **明暗主题**：一键切换，首屏内联脚本应用偏好，无闪烁。

## 快速开始

```bash
git clone --recurse-submodules https://github.com/YuniqueCore/inkmark.git
bun install        # 或 npm install
bun run dev        # 开发
bun run build      # 类型检查 + 构建到 dist/
bun run test       # vitest（32 个核心用例）
```

> 词库来自 [natural-talk](https://github.com/YuniqueCore/natural-talk) 子模块（`skill/`），克隆时需要 `--recurse-submodules`；已克隆的仓库用 `git submodule update --init` 补齐。

## 结构

```
src/
  core/          纯函数核心，不依赖 DOM，全部可测
    types.ts     领域类型（批注、词库 schema）
    text.ts      规范文本分块、摘录、W3C TextQuoteSelector
    anchors.ts   批注范围 → 渲染分段（扫描线）
    export.ts    三种导出格式
    diff.ts      行级 Myers diff（对照视图）
    w3c.ts       W3C Web Annotation 导入 / 导出与 robust 重锚
    slop.ts      词库扫描：保护区掩码 / 去重 / cluster / density
  ui/            DOM 层（editor / selection / sidebar / exporter / storage）
  skill/         natural-talk 子模块——词库单一来源：
                 skill/references/anti-slop-kit/scripts/data/{zh,en}.json
tests/           vitest 正反例
```

设计约束：**规范文本是唯一事实源**——批注只存 `[start, end)` 偏移；core 不碰 DOM 和存储；localStorage 是唯一 IO 边界。原文在批注过程中只读，因此偏移不会漂移（编辑原文属于将来功能，届时需要引入 robust anchoring）。

## 已知边界与路线图

- [ ] **编辑原文 + robust anchoring**：当前原文只读；放开编辑需要 quote 重锚（W3C 导入路径已实现，可复用）
- [ ] **对照视图下给新增行写批注**：当前批注只锚定原文，改稿新增行暂只读（需要把锚定模型扩展到双文档）
- [ ] slop 扫描的评分分档（slop_check.py 的 score / band）：当前只产出候选批注，不打分

