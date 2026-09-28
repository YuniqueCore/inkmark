/** 任务：业务意图层的组合。一个 Task = 一个人类可描述的工作流步骤。 */

import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Workbench } from '../screens/Workbench'
import {
  ClickPinDot,
  PickKind,
  PickPhrase,
  SelectFirstBlockText,
  SubmitAnnotation,
  TypeComment,
} from '../interactions/composer'
import { Interaction, Task } from '../support/kernel'

/** 载入示例文档并等正文渲染 */
export const OpenSampleDocument = (): Task =>
  Task.where(
    '#actor 载入示例文档',
    Interaction.where('点顶栏「示例」', async (actor) => {
      await Workbench.headerButton(BrowseTheWorkbench.as(actor).page, /载入一段带 AI 味的示例文档/).click()
    }),
    Interaction.where('等正文首块渲染', async (actor) => {
      await Workbench.firstBlock(BrowseTheWorkbench.as(actor).page).waitFor({ state: 'visible' })
    }),
  )

/** 划选正文并展开撰写卡（到「可以开始写批注」的状态） */
export const ExpandComposerFromSelection = (from = 0, to = 10): Task =>
  Task.where('#actor 划选正文并展开撰写卡', SelectFirstBlockText(from, to), ClickPinDot())

/** 划选 → 写批注 → 提交的完整链路 */
export const AnnotateFirstBlock = (options: {
  from?: number
  to?: number
  kind?: string
  phrase?: string
  comment?: string
}): Task =>
  Task.where(
    `#actor 对正文首块写一条${options.kind ?? '建议'}批注`,
    SelectFirstBlockText(options.from ?? 0, options.to ?? 10),
    ClickPinDot(),
    options.kind ? PickKind(options.kind) : Interaction.where('保持默认类型', async () => {}),
    options.phrase ? PickPhrase(options.phrase) : Interaction.where('不点快捷语', async () => {}),
    options.comment ? TypeComment(options.comment) : Interaction.where('不额外输入', async () => {}),
    SubmitAnnotation(),
  )
