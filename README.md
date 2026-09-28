# InkMark · 划词批注工作台

给 AI 改过的文本做**行内批注**的纯网页小工具。划选文字写批注，一键导出三种格式，把"哪里有问题"准确递回给 AI。

UI 按 shadcn/ui 语系构建（Tailwind CSS v4 + 设计 token，灵感来自 rareui）：中性 zinc 底、细边框、subtle 阴影、明暗双主题（顶栏切换，跟随系统偏好，localStorage 记忆）。构建产物 gzip 约 52KB。

## 功能

- **划词批注**：选中正文文字 → 停点浮出标注小点 → hover 展开撰写卡片 → 选类型（问题 / 建议 / 疑问 / 重点 / 认可）→ 写批注。批注以彩色高亮留在原文上；**草稿保护**——输入中鼠标滑出 / 误点外部不丢稿，草稿按段落记账、重选即取回（Esc 显式取消才丢弃），卡片与弹层滚动缩放跟随锚点。
- **编辑原文 + robust anchoring**：直接修改规范文本，完成后批注按引文自动重锚——quote 精确重定位（含 prefix/suffix 消歧），改掉的部分经行级 diff 位移钳到改动边界，批注永不因编辑丢失；失锚批注带可见标记（正文琥珀色波浪线 + 侧栏/弹层「失锚」徽标），引文改回来时自动清除。
- **对照视图**：贴入 AI 改稿，生成原文 vs 改稿的行级 track-changes diff（Myers 算法，超大改动自动降级）；**两侧都可划选写批注**——原文侧批注钉在被改动的行上，改稿侧批注钉在新增行上（侧栏带「改稿」标记），清除改稿时一并处理。
- **三种导出**（顶栏「导出」或 ⌘/Ctrl+S）：每条批注都带 `@start-end` 字符偏移（0-based、右端开区间，与 W3C position 选择器对齐），机器可精确定位；下载文件名以来源文档名打头（`chapter-3-批注-snippets-2026-09-28.md`），多份文档的批注文件不再混淆：
  1. **原文 + 批注**：完整原文，批注以 `【批注①·问题】……` 行内标记插在锚点后；
  2. **片段 + 批注**：逐条列出被批注的片段和对应批注；
  3. **评审引用块**：Markdown 引用格式，直接贴回聊天窗口给 AI agent。
  支持复制与下载 .md；默认不含已解决批注（可勾选包含）；「包含文件信息」开关在导出顶部标注来源文件名，多文档场景区分出处（W3C JSON 保持标准格式不受影响）。
- **W3C Web Annotation 导入 / 导出**：批注可导出为标准 Annotation JSON（TextQuoteSelector + TextPositionSelector 双选择器）；导入时自动按 quote 在目标文本里重锚（位置失配 → 全文搜索 → prefix/suffix 消歧），锚不上的明确跳过、绝不错。打开 .json 文件即可导入。
- **slop 预扫描**：内置 [anti-slop-kit](https://github.com/YuniqueCore/natural-talk) 的中英文词库（zh 169 条 / en 212 条），一键把套话候选标成红色波浪线预填批注，人工复核后解决或删除。扫描管线与 `slop_check.py` 完全对齐：代码围栏 / 行内代码 / URL / 邮箱保护、正则 flags、重叠去重先于 cluster/density 阈值升级；**评分分档同源**（w / cluster_w / density_w 权重，score = 证据权重 / 千单位，clean / light / noticeable / heavy）；**评分历史**随文档持久化（最近 20 次采样），统计卡展示环比升降与迷你趋势线。
- **文档树多选批量操作**：树内每份文档可勾选（支持全选），批量导出（弹层选格式后统一复制 / 打包 zip，同名文件自动加序号）或批量删除（二次确认）；每个条目 hover 还有单项导出按钮，无需切换文档即可导出。
- **批注管理**：侧栏列表，按类型与状态筛选，定位 / 编辑 / 解决 / 删除，全部破坏性操作二次确认。扫描后侧栏顶部展示 **slop 评分统计卡**：分档徽标（干净 / 轻微 / 明显 / 严重）+ 每千单位评分 + 类目分布，文本编辑即失效重扫。
- **响应式布局**：≥lg 桌面三栏（可拖拽调宽）；<lg 单栏 + 左右**抽屉**（文档树 / 批注栏覆盖式滑出，背板或 Esc 关闭），顶栏按钮小屏收敛为图标，撰写卡 / 弹层 / 导出弹窗全部约束在视口内，高度用 dvh 适配手机动态工具栏。`public/device-test.html` 提供三档真机尺寸的自动化交互自检页。
- **自动保存**：localStorage；也可导出 / 导入 JSON 会话（打开文件时选 .json 即导入）。
- **明暗主题**：一键切换，首屏内联脚本应用偏好，无闪烁。

## 快速开始

```bash
git clone --recurse-submodules https://github.com/YuniqueCore/inkmark.git
bun install        # 或 npm install
bun run dev        # 开发
bun run build      # 类型检查 + 构建到 dist/
bun run test       # vitest 单测（core 纯函数 + 组件逻辑）
bun run test:e2e   # Playwright screenplay 浏览器套件（用系统 Chrome）
```

> 词库来自 [natural-talk](https://github.com/YuniqueCore/natural-talk) 子模块（`skill/`），克隆时需要 `--recurse-submodules`；已克隆的仓库用 `git submodule update --init` 补齐。

## 测试

双层测试，各司其职：

- **vitest（tests/）**：core 纯函数与组件逻辑（草稿记账、IME 守卫、导出 / 导入 / 重锚）。
- **Playwright screenplay（e2e/）**：真实浏览器行为，按 Screenplay 模式分层——
  `abilities/`（驾驶页面）→ `screens/`（语义定位器契约）→ `interactions/`（原子操作）→
  `tasks/`（业务工作流）→ `questions/`(只读状态查询)，断言只出现在 `e2e/specs/`。
  重点覆盖：撰写卡在操作内部控件（横滚快捷语、输入、失焦）时的稳定性、
  批注弹层编辑态、导出弹层、文件树批量操作、手机视口抽屉互斥。

## 结构

```
src/
  core/          纯函数核心，不依赖 DOM，全部可测
    types.ts     领域类型（批注、词库 schema）
    text.ts      规范文本分块、摘录、W3C TextQuoteSelector
    anchors.ts   批注范围 → 渲染分段（扫描线）
    export.ts    三种导出格式
    diff.ts      行级 Myers diff（对照视图）
    reanchor.ts  编辑原文后的批注重锚（quote 重锚 + diff 位移兜底）
    w3c.ts       W3C Web Annotation 导入 / 导出与 robust 重锚
    slop.ts      词库扫描：保护区掩码 / 去重 / cluster / density
  ui/            DOM 层（editor / selection / sidebar / exporter / storage）
  skill/         natural-talk 子模块——词库单一来源：
                 skill/references/anti-slop-kit/scripts/data/{zh,en}.json
tests/           vitest 正反例
e2e/             Playwright screenplay 浏览器套件（abilities/tasks/questions/specs）
```

设计约束：**规范文本是唯一事实源**——批注只存 `[start, end)` 偏移；core 不碰 DOM 和存储；localStorage 是唯一 IO 边界。原文在批注过程中只读，因此偏移不会漂移（编辑原文属于将来功能，届时需要引入 robust anchoring）。

## 已知边界与路线图

- [ ] 对照视图导出独立的 diff 评审报告（当前改稿侧批注并入三种导出并带「改稿」标记）

