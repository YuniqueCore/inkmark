<div align="center">

[English](README.en.md) · 简体中文

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://signature4u.vercel.app/api/sign?text=InkMark&font=great-vibes&bg=transparent&fontSize=190&speed=1.4&fill=gradient&f1=e2e8f0&f2=7dd3fc" />
  <img src="https://signature4u.vercel.app/api/sign?text=InkMark&font=great-vibes&bg=transparent&fontSize=190&speed=1.4&fill=gradient&f1=0f172a&f2=0284c7" alt="InkMark" width="380" />
</picture>

**划词批注工作台** —— 给 AI 改过的文本做**行内批注**，把「哪里有问题」准确递回给 AI。

[![部署 Pages](https://github.com/YuniqueCore/inkmark/actions/workflows/deploy.yml/badge.svg)](https://github.com/YuniqueCore/inkmark/actions/workflows/deploy.yml)
[![最新发布](https://img.shields.io/github/v/release/YuniqueCore/inkmark?display_name=tag&sort=semver)](https://github.com/YuniqueCore/inkmark/releases)
![构建体积](https://img.shields.io/badge/gzip-%E2%89%8852KB-informational)

**[在线使用 →](https://yuniquecore.github.io/inkmark/)**

<img src="docs/screenshots/desktop-light.png" alt="桌面亮色主题：AI 味候选红色波浪线 + 认可/建议/疑问/重点彩色高亮，侧栏多类批注卡" width="100%" />

| 手机 · 撰写卡（快捷语两行封顶、横向滚动） | 桌面 · 暗色主题 |
| --- | --- |
| <img src="docs/screenshots/mobile-composer.png" alt="手机端：多色批注高亮与撰写卡" width="360" /> | <img src="docs/screenshots/desktop-dark.png" alt="桌面暗色主题" width="100%" /> |

</div>

---

UI 按 shadcn/ui 语系构建（Tailwind CSS v4 + 设计 token，灵感来自 rareui）：中性 zinc 底、细边框、subtle 阴影、明暗双主题（顶栏切换，跟随系统偏好，localStorage 记忆）。构建产物 gzip 约 52KB，纯前端、零后端。

## 功能

- **划词批注**：选中正文文字 → 停点浮出标注小点 → hover 展开撰写卡片 → 选类型（建议 / 疑问 / 重点 / 认可）→ 快捷批注语 chips（两行封顶、横向滚动）或直接输入，还可选填「建议替换词」，划词也能直接下达机器可执行的改写指令。批注以彩色高亮留在原文上；**草稿保护**——输入中鼠标滑出 / 误点外部不丢稿，草稿按段落记账、重选即取回（含类型与替换词，Esc 显式取消才丢弃），卡片与弹层滚动缩放跟随锚点，卡内滚动不误关。
- **搜索与批量批注（⌘F）**：VSCode 式搜索面板——输入即在正文实时描边命中（与批注底色叠加，所见即所得），Enter / ‹ › 在命中间跳转，**Aa** 切换大小写敏感、**.\*** 切换正则匹配（非法正则描红提示）；面板内嵌与划词卡同款的撰写表单（**一套组件三处复用**：划词卡 / 搜索面板 / 批注弹层编辑态），选类型、点快捷语、可选填「建议替换词」，一键给 N 处相同内容写同一条批注（可勾选跨文档，跨工作区所有文档生效）。侧栏聚合成一张卡（N 处统计 + 展开逐条编辑 / 跳转），整组一键解决 / 删除。替换词随三种导出生成机器可执行指令（`→ 替换为「…」`）。面板输入全程定向更新、不重绘节点，输入法组合不被打断。
- **编辑原文 + robust anchoring**：直接修改规范文本，完成后批注按引文自动重锚——**多策略锚定**（位置提示评分 + prefix/suffix 上下文加权消歧 + 引文被小改时按编辑距离模糊回锚，参考 Hypothesis 生产锚定并加按引文长度分级的置信度门控：短引文上下文已变宁可失锚也不错锚到别处），改不掉的经**字符级 diff** 钳到真实改动点，批注永不因编辑丢失；失锚批注带可见标记（正文琥珀色波浪线 + 侧栏/弹层「失锚」徽标），引文改回来时自动清除。
- **对照视图**：贴入 AI 改稿，生成原文 vs 改稿的行级 track-changes diff（Myers 算法，超大改动自动降级）；**两侧都可划选写批注**——原文侧批注钉在被改动的行上，改稿侧批注钉在新增行上（侧栏带「改稿」标记），清除改稿时一并处理。
- **三种导出**（顶栏「导出」或 ⌘/Ctrl+S）：每条批注都带 `@start-end` 字符偏移（0-based、右端开区间，与 W3C position 选择器对齐），机器可精确定位；下载文件名以来源文档名打头（`chapter-3-批注-snippets-2026-09-28.md`），多份文档的批注文件不再混淆：
  1. **原文 + 批注**：完整原文，批注以 `【批注①·问题】……` 行内标记插在锚点后；
  2. **片段 + 批注**：逐条列出被批注的片段和对应批注；
  3. **评审引用块**：Markdown 引用格式，直接贴回聊天窗口给 AI agent。
  支持复制与下载 .md；默认不含已解决批注（可勾选包含）；「包含文件信息」开关在导出顶部标注来源文件名，多文档场景区分出处（W3C JSON 保持标准格式不受影响）。
- **文件夹导入 + 冲突诊断树**：工作区为空时直接导入；已有文档时，同名冲突（相对路径 + 文件名）先弹**诊断树**——逐行决策「覆盖 / 重命名 / 跳过」，或用批量预设（**全部覆盖 / 覆盖未标注的 / 覆盖标注的**）；重命名插扩展名前递增（`chapter-1-1.txt`），同名同文标「无变化」跳过，取消则整次作废。**覆盖不毁批注**：原有批注按「编辑原文」同款管线重锚到新文本，弹层内预演预告重锚 / 失锚条数，先知情再确认。单文件导入走同一套诊断，无双轨逻辑。
- **W3C Web Annotation 导入 / 导出**：批注可导出为标准 Annotation JSON（TextQuoteSelector + TextPositionSelector 双选择器）；导入时自动按 quote 在目标文本里重锚（位置失配 → 全文搜索 → prefix/suffix 消歧），锚不上的明确跳过、绝不错。打开 .json 文件即可导入。
- **slop 预扫描**：内置 [anti-slop-kit](https://github.com/YuniqueCore/natural-talk) 的中英文词库（zh 169 条 / en 212 条），一键把套话候选标成红色波浪线预填批注，人工复核后解决或删除。扫描管线与 `slop_check.py` 完全对齐：代码围栏 / 行内代码 / URL / 邮箱保护、正则 flags、重叠去重先于 cluster/density 阈值升级；**评分分档同源**（w / cluster_w / density_w 权重，score = 证据权重 / 千单位，clean / light / noticeable / heavy）；**评分历史**随文档持久化（最近 20 次采样），统计卡展示环比升降与迷你趋势线。
- **文档树多选批量操作**：树内每份文档可勾选（支持全选 / **反选**），批量导出（弹层选格式后统一复制 / 打包 zip，同名文件自动加序号）或批量删除（二次确认）；每个条目 hover 还有单项导出按钮，无需切换文档即可导出。
- **批注管理**：侧栏列表，按类型与状态筛选（类型 chips 与撰写卡同一套清单——人工四类常驻，问题 / AI 味等机器类型存在时才追加，单一来源在 core `ALL_KINDS`），定位 / 编辑 / 解决 / 删除，全部破坏性操作二次确认。**卡片多选批量操作**：每张卡悬停浮现勾选框（有选中项后常驻），支持全选 / **反选** / **快速选中** selector（失锚 / 未解决 / 已解决 / 改稿侧 / 按类型），批量解决与删除（二次确认）带 toast 反馈与滑入动画；「正文只高亮当前筛选结果」为开关 toggle。扫描后侧栏顶部展示 **slop 评分统计卡**：分档徽标（干净 / 轻微 / 明显 / 严重）+ 每千单位评分 + 类目分布，文本编辑即失效重扫。
- **响应式布局**：≥lg 桌面三栏（可拖拽调宽）；<lg 单栏 + 左右**抽屉**（文档树 / 批注栏覆盖式滑出，背板或 Esc 关闭），顶栏按钮小屏收敛为图标，撰写卡 / 弹层 / 导出弹窗全部约束在视口内，高度用 dvh 适配手机动态工具栏。`public/device-test.html` 提供三档真机尺寸的自动化交互自检页。
- **自动保存**：localStorage；也可导出 / 导入 JSON 会话（打开文件时选 .json 即导入）。
- **阅读偏好（设置 + 悬浮球）**：五套主题——亮色 / **纸黄**（阅读器暖纸底）/ 暗色 / **熊猫**（深边栏浅正文）/ **熊猫·反色**（浅边栏深正文），设置里每套主题都带真实 token 上色的**缩略示意界面图**；四种**背景纹理**（纸纹 / 方格 / 横线 / 织物，参考阅读器设计）；正文字体（默认 / 宋体 / 楷体 / 等宽）与**字号**滑杆（13–22px，行距随字号缩放）。正文区右下角常驻**悬浮设置球**：闲置 40% 透明、hover 全不透明并沿 **1/4 圆弧**展开主题 / 纹理 / 字号 / 字体（悬停再弹出二级选项或滑杆，触摸点按等效），「全部设置」打开完整弹层；顶栏明暗按钮在当前主题家族内翻转极性。全部偏好即时生效、localStorage 持久化，首屏内联脚本应用，无闪烁。

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
  `tasks/`（业务工作流）→ `questions/`（只读状态查询），断言只出现在 `e2e/specs/`。
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
    reanchor.ts  编辑原文后的批注重锚（引文多策略锚定 + 字符级 diff 钳制兜底）
    quote-match.ts  引文锚定匹配（精确/模糊候选 + 上下文加权评分 + 置信度门控）
    w3c.ts       W3C Web Annotation 导入 / 导出与 robust 重锚
    import.ts    导入管线（文本 / 会话 / W3C 分类解析）
    import-conflict.ts  导入冲突判定与计划（诊断树 / 重命名 / 批量预设）
    prefs.ts     阅读偏好模型（主题 / 纹理 / 字体 / 字号，归一化与极性翻转）
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

---

<div align="center">

页首签名由 [animated-sign-4u](https://github.com/YuniqueUnic/animated-sign-4u) 的 `/api/sign` 接口实时生成（动画 SVG · 透明底 · 明暗双配色），
在编辑器里用 `?bg=transparent` 可以自己调一份 → **[signature4u.vercel.app/editor](https://signature4u.vercel.app/editor?bg=transparent)**

</div>
