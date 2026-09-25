# InkMark · 划词批注工作台

给 AI 改过的文本做**行内批注**的纯网页小工具。划选文字写批注，一键导出三种格式，把"哪里有问题"准确递回给 AI。

UI 按 shadcn/ui 语系构建（Tailwind CSS v4 + 设计 token，灵感来自 rareui）：中性 zinc 底、细边框、subtle 阴影、明暗双主题（顶栏切换，跟随系统偏好，localStorage 记忆）。构建产物 gzip 约 32KB。

## 功能

- **划词批注**：选中正文文字 → 浮动工具条 → 选类型（问题 / 建议 / 疑问 / 重点）→ 写批注。批注以彩色高亮留在原文上。
- **三种导出**（顶栏「导出」或 ⌘/Ctrl+S）：
  1. **原文 + 批注**：完整原文，批注以 `【批注①·问题】……` 行内标记插在锚点后；
  2. **片段 + 批注**：逐条列出被批注的片段和对应批注；
  3. **评审引用块**：Markdown 引用格式，直接贴回聊天窗口给 AI agent。
  支持复制与下载 .md；默认不含已解决批注（可勾选包含）。
- **slop 预扫描**：内置 [anti-slop-kit](https://github.com/chengzhi-c/natural-talk) 的中英文词库（zh 169 条 / en 212 条），一键把套话候选标成红色波浪线预填批注，人工复核后解决或删除。代码块、行内代码、URL 内不扫。
- **批注管理**：侧栏列表，按状态筛选，定位 / 编辑 / 解决 / 删除。
- **自动保存**：localStorage；也可导出 / 导入 JSON 会话（打开文件时选 .json 即导入）。
- **明暗主题**：一键切换，首屏内联脚本应用偏好，无闪烁。

## 快速开始

```bash
bun install        # 或 npm install
bun run dev        # 开发
bun run build      # 类型检查 + 构建到 dist/
bun run test       # vitest（31 个核心用例）
```

## 结构

```
src/
  core/          纯函数核心，不依赖 DOM，全部可测
    types.ts     领域类型（批注、词库 schema）
    text.ts      规范文本分块、摘录、W3C TextQuoteSelector
    anchors.ts   批注范围 → 渲染分段（扫描线）
    export.ts    三种导出格式
    slop.ts      词库扫描：保护区间 / 重叠去重 / cluster / density
  ui/            DOM 层（editor / selection / sidebar / exporter / storage）
  lexicons/      zh.json + en.json（与 anti-slop-kit 同源）
tests/           vitest 正反例
```

设计约束：**规范文本是唯一事实源**——批注只存 `[start, end)` 偏移；core 不碰 DOM 和存储；localStorage 是唯一 IO 边界。原文在批注过程中只读，因此偏移不会漂移（编辑原文属于将来功能，届时需要引入 robust anchoring）。

## 已知边界与路线图

- [ ] **Diff 对照**：原文 vs AI 改稿的 track-changes 视图，批注钉在 diff 片段上（对"审 AI 修改"最有用，v2 首项）
- [ ] 批注锚定的 W3C Web Annotation 导入 / 导出（当前只在内存中持有 quote selector）
- [ ] 跨设备会话同步（本地优先，可接任意存储）
- [ ] slop 扫描的 cluster/density 阈值目前近似移植自 slop_check.py，未覆盖全部保护条款
