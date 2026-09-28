/** 原子交互：一步操作，不做断言、不编排流程。 */

import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Workbench } from '../screens/Workbench'
import { Interaction } from '../support/kernel'

/** 在正文第 blockIndex 段（0 起）划选拼接文本的 [from, to) 字符并派发 mouseup。
 * 用 TreeWalker 跨文本节点换算偏移：批注高亮会把段落文本切成多个节点，
 * 直接 firstChild + 偏移在同段二划选时会 IndexSizeError（曾经只敢每段划一次）。 */
export const SelectBlockText = (blockIndex: number, from: number, to: number): Interaction =>
  Interaction.where(`划选正文第 ${blockIndex + 1} 段第 ${from}–${to} 字`, async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    await page.evaluate(
      ([bi, start, end]) => {
        const blk = document.querySelectorAll('#editor .editor-blk')[bi!]!
        const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT)
        const nodes: Text[] = []
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
        const total = nodes.reduce((acc, t) => acc + (t.textContent ?? '').length, 0)
        // end 超长钳制到段长（旧行为：短文档默认选区自动收缩）
        const s = Math.min(start!, total)
        const e = Math.min(end!, total)
        if (s >= total) throw new Error(`选区起点 ${start} 超出段落长度 ${total}`)
        let acc = 0
        let startNode: Text | null = null
        let startOff = 0
        let endNode: Text | null = null
        let endOff = 0
        for (const t of nodes) {
          const len = (t.textContent ?? '').length
          if (!startNode && acc + len > s) {
            startNode = t
            startOff = s - acc
          }
          if (!endNode && acc + len >= e) {
            endNode = t
            endOff = e - acc
          }
          acc += len
        }
        if (!startNode || !endNode) throw new Error(`选区 [${start}, ${end}) 无法在段内定位`)
        const range = document.createRange()
        range.setStart(startNode, startOff)
        range.setEnd(endNode, endOff)
        const sel = getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        const r = range.getBoundingClientRect()
        blk.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.right, clientY: r.bottom }))
      },
      [blockIndex, from, to],
    )
  })

/** 在正文首块划选 [from, to) 字符（历史入口，委托通用段落选区） */
export const SelectFirstBlockText = (from: number, to: number): Interaction =>
  SelectBlockText(0, from, to)

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
