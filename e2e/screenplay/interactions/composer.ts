/** 原子交互：一步操作，不做断言、不编排流程。 */

import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Workbench } from '../screens/Workbench'
import { Interaction } from '../support/kernel'

/** 在正文首块划选 [from, to) 字符并派发 mouseup（应用据此唤起小点）。
 * 文本区间选择没有高层 API，这里是唯一的技术性 evaluate 路径。 */
export const SelectFirstBlockText = (from: number, to: number): Interaction =>
  Interaction.where(`划选正文首块第 ${from}–${to} 字`, async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    await page.evaluate(
      ([start, end]) => {
        const blk = document.querySelector('#editor .editor-blk')!
        const tn = blk.firstChild as Text
        const range = document.createRange()
        range.setStart(tn, start!)
        range.setEnd(tn, Math.min(end!, (tn.textContent ?? '').length))
        const sel = getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        const r = range.getBoundingClientRect()
        blk.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.right, clientY: r.bottom }))
      },
      [from, to],
    )
  })

/** 点击标注小点展开撰写卡（触屏等价路径） */
export const ClickPinDot = (): Interaction =>
  Interaction.where('点击标注小点展开撰写卡', async (actor) => {
    await Workbench.pinDot(BrowseTheWorkbench.as(actor).page).click()
  })

/** 点选撰写卡上的类型 chip */
export const PickKind = (kind: string): Interaction =>
  Interaction.where(`选择批注类型 ${kind}`, async (actor) => {
    await Workbench.kindChip(BrowseTheWorkbench.as(actor).page, kind).click()
  })

/** 点选一条快捷语 chip（按可见文本） */
export const PickPhrase = (phrase: string): Interaction =>
  Interaction.where(`点选快捷语「${phrase}」`, async (actor) => {
    await Workbench.phraseChips(BrowseTheWorkbench.as(actor).page).getByText(phrase, { exact: true }).click()
  })

/** 在撰写输入框输入批注语 */
export const TypeComment = (text: string): Interaction =>
  Interaction.where('输入批注语', async (actor) => {
    await Workbench.composerInput(BrowseTheWorkbench.as(actor).page).fill(text)
  })

/** 提交批注 */
export const SubmitAnnotation = (): Interaction =>
  Interaction.where('提交批注', async (actor) => {
    await Workbench.submitButton(BrowseTheWorkbench.as(actor).page).click()
  })

/** 用滚轮在快捷语行上做真实横向滚动（用户复现路径：wheel deltaX）。
 * hover 自带「位置稳定」等待，避免 pop-in 动画期间 boundingBox 漂移让滚轮落空 */
export const ScrollPhraseRowHorizontally = (deltaX = 240): Interaction =>
  Interaction.where('横向滚动快捷语行', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    const row = Workbench.phraseRow(page)
    await row.hover()
    await page.mouse.wheel(deltaX, 0)
  })

/** 用滚轮滚动正文编辑区（视口级滚动的真实路径） */
export const ScrollEditor = (deltaY = 360): Interaction =>
  Interaction.where('滚动正文编辑区', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    const block = Workbench.firstBlock(page)
    const box = await block.boundingBox()
    if (!box) throw new Error('正文不可见，无法滚动')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, deltaY)
  })

/** 让撰写输入框失焦（无鼠标副作用，等价于焦点移走） */
export const BlurComposerInput = (): Interaction =>
  Interaction.where('让批注输入框失焦', async (actor) => {
    await Workbench.composerInput(BrowseTheWorkbench.as(actor).page).evaluate((el: HTMLElement) => el.blur())
  })
