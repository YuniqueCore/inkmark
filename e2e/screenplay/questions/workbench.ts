/** 问题：只读状态查询，返回领域值，供 specs 断言。 */

import { BrowseTheWorkbench } from '../abilities/BrowseTheWorkbench'
import { Workbench } from '../screens/Workbench'
import { Question } from '../support/kernel'

/** 撰写卡当前是否可见 */
export const ComposerCardVisibility = () =>
  Question.about('撰写卡可见性', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.composerCard(page).isVisible()
  })

/** 标注小点当前是否可见 */
export const PinDotVisibility = () =>
  Question.about('标注小点可见性', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.pinDot(page).isVisible()
  })

/** 快捷语行是否真的可横向滚动（内容宽 > 容器宽） */
export const PhraseRowHorizontallyScrollable = () =>
  Question.about('快捷语行可横向滚动', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.phraseRow(page).evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth + 1)
  })

/** 快捷语行的横向滚动位置（0 = 未滚动） */
export const PhraseRowScrollLeft = () =>
  Question.about('快捷语行横向滚动位置', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.phraseRow(page).evaluate((el: HTMLElement) => el.scrollLeft)
  })

/** 快捷语行的渲染高度（像素，两行封顶的几何证据） */
export const PhraseRowHeight = () =>
  Question.about('快捷语行渲染高度', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.phraseRow(page).evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().height))
  })

/** 正文里的批注高亮数量 */
export const HighlightCount = () =>
  Question.about('正文批注高亮数量', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.highlights(page).count()
  })

/** 侧栏批注卡数量 */
export const SidebarCardCount = () =>
  Question.about('侧栏批注卡数量', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.sidebarCards(page).count()
  })

/** 批注弹层是否可见 */
export const PopupVisibility = () =>
  Question.about('批注弹层可见性', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return Workbench.popup(page).isVisible()
  })

/** body 上的抽屉开合状态（tree-open / sidebar-open） */
export const DrawerState = () =>
  Question.about('抽屉开合状态', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return page.evaluate(() => ({
      tree: document.body.classList.contains('tree-open'),
      sidebar: document.body.classList.contains('sidebar-open'),
    }))
  })

/** 页面是否有横向溢出 */
export const HorizontalOverflow = () =>
  Question.about('页面横向溢出', async (actor) => {
    const page = BrowseTheWorkbench.as(actor).page
    return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  })
