// @vitest-environment happy-dom
/** UI 层回归测试：划词标注小点 + 撰写卡片的草稿保护。
 * 回归背景：输入中鼠标滑出卡片 / 点击外部 / 按下 Esc（含输入法组合取候选）
 * 都会瞬间销毁撰写卡片，写了一半的批注随 innerHTML 清空而丢失。
 * 断言锚点：有草稿时任何「非显式取消」路径不得销毁卡片与输入内容；
 * 草稿按「文档+侧+范围」记账，重选同一段落可取回（含类型）；显式取消（Esc）才丢弃。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectionPin, type SelectionInfo } from '../src/ui/selection-pin'

const info = (over: Partial<SelectionInfo> = {}): SelectionInfo => ({
  start: 10,
  end: 22,
  rect: new DOMRect(100, 200, 120, 20),
  quoted: '被批注的原文片段',
  mouse: {x: 220, y: 220},
  forward: true,
  docId: 'doc-1',
  ...over,
})

let pin: SelectionPin
let pinEl: HTMLElement
let card: HTMLElement
let created: {info: SelectionInfo; kind: string; comment: string} | null

beforeEach(() => {
  document.body.innerHTML = ''
  created = null
  pin = new SelectionPin({
    onCreate: (i, kind, comment) => {
      created = {info: i, kind, comment}
    },
    onCopySelection: () => {},
    onDismiss: () => {},
  })
  pinEl = document.querySelector('body > button.fixed.z-50')!
  card = document.querySelector('body > div.popover-panel.z-50')!
})

afterEach(() => {
  vi.useRealTimers()
})

/** 划选 → 小点亮出（定位为已决微任务，flush 即可） */
async function showPin(over: Partial<SelectionInfo> = {}): Promise<void> {
  pin.showFor(info(over))
  await Promise.resolve()
}

/** hover 小点 → 卡片展开（placeCard 在 happy-dom 下同样走微任务） */
async function openCard(): Promise<HTMLTextAreaElement> {
  pinEl.dispatchEvent(new MouseEvent('mouseenter'))
  await Promise.resolve()
  const input = card.querySelector('#pin-composer-input') as HTMLTextAreaElement
  expect(input).toBeTruthy()
  return input
}

const type = (input: HTMLTextAreaElement, text: string): void => {
  input.value = text
  input.dispatchEvent(new Event('input', {bubbles: true}))
}

describe('SelectionPin 草稿保护', () => {
  it('有草稿时点击外部：卡片与草稿保留', async () => {
    await showPin()
    const input = await openCard()
    type(input, '写了一半的批注')
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))
    expect(card.classList.contains('hidden')).toBe(false)
    expect(
      (card.querySelector('#pin-composer-input') as HTMLTextAreaElement).value,
    ).toBe('写了一半的批注')
  })

  it('空卡片点击外部：维持「点外部关闭」', async () => {
    await showPin()
    await openCard()
    document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))
    expect(card.classList.contains('hidden')).toBe(true)
  })

  it('有草稿时鼠标滑出卡片：不触发自动收起', async () => {
    vi.useFakeTimers()
    await showPin()
    const input = await openCard()
    type(input, '输入中的内容')
    card.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(500)
    expect(card.classList.contains('hidden')).toBe(false)
    expect((card.querySelector('#pin-composer-input') as HTMLTextAreaElement).value).toBe(
      '输入中的内容',
    )
  })

  it('空卡片鼠标滑出：误触 hover 仍自动收起', async () => {
    vi.useFakeTimers()
    await showPin()
    await openCard()
    card.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(500)
    expect(card.classList.contains('hidden')).toBe(true)
  })

  it('输入法组合中的 Esc 是取消候选：卡片保留；真 Esc 才关闭', async () => {
    await showPin()
    const input = await openCard()
    type(input, '拼音输入中')
    document.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, isComposing: true}),
    )
    expect(card.classList.contains('hidden')).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    expect(card.classList.contains('hidden')).toBe(true)
  })

  it('草稿按「文档+范围」记账：划去别处再划回，草稿与类型恢复；Esc 丢弃', async () => {
    await showPin({start: 10, end: 22})
    let input = await openCard()
    type(input, 'A 段草稿')
    card.querySelector('[data-kind="praise"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))

    // 划选另一段：全新空会话
    await showPin({start: 100, end: 112})
    input = await openCard()
    expect(input.value).toBe('')
    expect(card.querySelector('.kind-chip.on')?.getAttribute('data-kind')).toBe('issue')

    // 划回原段：草稿与类型恢复
    await showPin({start: 10, end: 22})
    input = await openCard()
    expect(input.value).toBe('A 段草稿')
    expect(card.querySelector('.kind-chip.on')?.getAttribute('data-kind')).toBe('praise')

    // Esc 显式取消：草稿丢弃，划回为空
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    await showPin({start: 10, end: 22})
    input = await openCard()
    expect(input.value).toBe('')
  })

  it('提交后草稿出账：回调收到类型与内容，卡片关闭', async () => {
    await showPin()
    const input = await openCard()
    type(input, '最终意见')
    card.querySelector('[data-kind="suggestion"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    card.querySelector('[data-op="submit"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    expect(created).not.toBeNull()
    expect(created!.comment).toBe('最终意见')
    expect(created!.kind).toBe('suggestion')
    expect(card.classList.contains('hidden')).toBe(true)

    // 重选同一段：不残留旧草稿
    await showPin()
    const again = await openCard()
    expect(again.value).toBe('')
  })

  it('认可类型：空批注语可直接提交；其它类型空语被拦截', async () => {
    await showPin()
    await openCard()
    card.querySelector('[data-kind="praise"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    card.querySelector('[data-op="submit"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
    expect(created).not.toBeNull()
    expect(created!.comment).toBe('')
    expect(card.classList.contains('hidden')).toBe(true)

    // 其它类型：空批注语不提交、卡片保留
    await showPin({start: 40, end: 52})
    await openCard()
    card.querySelector('[data-op="submit"]')!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    expect(created!.comment).toBe('') // created 未被覆盖：仍是上一条
    expect(card.classList.contains('hidden')).toBe(false)
  })

  it('快捷语 chips：点击追加进批注语（on 态），再点移除', async () => {
    await showPin()
    await openCard()
    const chip = () => card.querySelector('.phrase-chip') as HTMLElement
    const label = chip().dataset.phrase!
    chip().dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
    const input = card.querySelector('#pin-composer-input') as HTMLTextAreaElement
    expect(input.value).toBe(label)
    expect(chip().classList.contains('on')).toBe(true)
    chip().dispatchEvent(new MouseEvent('click', {bubbles: true}))
    expect(input.value).toBe('')
    expect(chip().classList.contains('on')).toBe(false)
  })

  it('切换类型后快捷语 chips 随之更换', async () => {
    await showPin()
    await openCard()
    const labels = () =>
      [...card.querySelectorAll('.phrase-chip')].map((c) => (c as HTMLElement).dataset.phrase)
    const issueFirst = labels()[0]
    expect(issueFirst).toBeDefined()
    const slopChip = card.querySelector('[data-kind="slop"]') as HTMLElement | null
    expect(slopChip).toBeTruthy()
    slopChip!.dispatchEvent(new MouseEvent('click', {bubbles: true}))
    await Promise.resolve()
    expect(labels()).toContain('用词过于华丽')
    expect(labels()).not.toContain(issueFirst)
  })

  it('空范围 / 纯空白选区不唤起小点', async () => {
    await showPin({start: 5, end: 5})
    expect(pinEl.classList.contains('hidden')).toBe(true)
    await showPin({start: 5, end: 8, quoted: '   '})
    expect(pinEl.classList.contains('hidden')).toBe(true)
  })
})
