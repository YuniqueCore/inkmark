/** 撰写卡稳定性：操作卡片内部控件（滚动快捷语、输入、失焦）时卡片必须稳定存在。
 * 回归背景：横向滚动快捷语行会触发 document 捕获阶段的 scroll 监听，
 * 把「选区已交给输入框」的展开态误判为失效而整卡消失。 */

import { expect, test } from '../screenplay/fixtures/screenplay'
import { BrowseTheWorkbench } from '../screenplay/abilities/BrowseTheWorkbench'
import {
  BlurComposerInput,
  ClickPinDot,
  PickPhrase,
  ScrollEditor,
  ScrollPhraseRowHorizontally,
} from '../screenplay/interactions/composer'
import { ResizeViewport } from '../screenplay/interactions/workspace'
import {
  ComposerCardVisibility,
  HighlightCount,
  PhraseRowHeight,
  PhraseRowHorizontallyScrollable,
  PhraseRowScrollLeft,
  PinDotVisibility,
  SidebarCardCount,
} from '../screenplay/questions/workbench'
import { AnnotateFirstBlock, ExpandComposerFromSelection, OpenSampleDocument } from '../screenplay/tasks/workbench'

test.describe('撰写卡稳定性', () => {
  test.beforeEach(async ({ actor }) => {
    await actor.attemptsTo(OpenSampleDocument())
  })

  test('横向滚动快捷语行：卡片稳定存在且真的滚动了', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection())
    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)
    await expect(await actor.asks(PhraseRowHorizontallyScrollable())).toBe(true)

    await actor.attemptsTo(ScrollPhraseRowHorizontally())

    // 合成器滚动（threaded scrolling）下 scrollLeft 有延迟，按状态轮询
    await expect.poll(() => actor.asks(PhraseRowScrollLeft())).toBeGreaterThan(0)
    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)
  })

  test('快捷语区纵向封顶两行', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection())
    // 建议类 15 条短语；两行（28px chip × 2 + 4px 行距）内必须放下
    expect(await actor.asks(PhraseRowHeight())).toBeLessThanOrEqual(62)
  })

  test('聚焦空卡时滚动正文：卡片保留为写作面板、小点退场', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection())
    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)

    // 矮视口保证正文可滚；滚轮滚动不产生 mousedown，走的是重锚定路径
    await actor.attemptsTo(ResizeViewport(1280, 480), ScrollEditor())

    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)
    await expect(await actor.asks(PinDotVisibility())).toBe(false)
  })

  test('失焦且无草稿：视口滚动仍按原语义关闭', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection())
    await actor.attemptsTo(BlurComposerInput(), ResizeViewport(1000, 600))
    await expect.poll(() => actor.asks(ComposerCardVisibility())).toBe(false)
  })

  test('快捷语点击写入批注语、再点移除（可逆）', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection(), PickPhrase('句式空洞'))
    const input = BrowseTheWorkbench.as(actor).page.locator('#pin-composer-input')
    await expect(input).toHaveValue('句式空洞')
    await actor.attemptsTo(PickPhrase('句式空洞'))
    await expect(input).toHaveValue('')
  })

  test('完整链路：划选 → 快捷语 → 提交 → 正文高亮与侧栏条目', async ({ actor }) => {
    await actor.attemptsTo(
      AnnotateFirstBlock({ kind: 'suggestion', phrase: '句式空洞', comment: '给具体一点' }),
    )
    await expect.poll(() => actor.asks(HighlightCount())).toBe(1)
    await expect.poll(() => actor.asks(SidebarCardCount())).toBe(1)
  })

  test('空卡重复点小点保持展开；Esc 关闭', async ({ actor }) => {
    await actor.attemptsTo(ExpandComposerFromSelection())
    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)
    await actor.attemptsTo(ClickPinDot()) // 重复点击不重建、保持展开
    await expect(await actor.asks(ComposerCardVisibility())).toBe(true)
    await BrowseTheWorkbench.as(actor).page.keyboard.press('Escape')
    await expect(await actor.asks(ComposerCardVisibility())).toBe(false)
  })
})
