// @vitest-environment happy-dom
/** UI 层回归测试：批注弹层编辑态——快捷语 chips 与认可空描述保存。 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AnnotationPopup } from '../src/ui/annotation-popup'
import type { Annotation, AnnotationKind } from '../src/core/types'

let el: HTMLElement
let popup: AnnotationPopup
let updated: {id: string; kind: AnnotationKind; comment: string} | null

const ann = (over: Partial<Annotation> = {}): Annotation => ({
  id: 'a1',
  start: 0,
  end: 4,
  kind: 'praise',
  comment: '论证有力',
  status: 'open',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

beforeEach(() => {
  document.body.innerHTML = ''
  updated = null
  popup = new AnnotationPopup({
    onUpdate: (id, kind, comment) => {
      updated = {id, kind, comment}
    },
    onDelete: () => {},
    onToggleStatus: () => {},
    onCopySnippet: () => {},
  })
  el = document.querySelector('body > div.popover-panel.z-60') as HTMLElement
  popup.setAnchorRect(new DOMRect(10, 10, 40, 16))
})

const openEdit = (a: Annotation): void => {
  popup.openFor(a.id, '被批注的正文内容。', [a], true)
}

describe('弹层编辑态快捷语', () => {
  it('非人工类型（slop）编辑：静态徽标保持当前类型可见；切到建议后出现快捷语', () => {
    openEdit(ann({kind: 'slop', comment: ''}))
    // 四类人工 chips；当前类型不在清单内 → 前置静态徽标（无 data-kind，不可切换）
    expect(el.querySelectorAll('.kind-chip').length).toBe(4)
    const badge = el.querySelector('.chip-toggle.on:not(.kind-chip)')
    expect(badge?.textContent).toContain('AI 味')
    expect(el.querySelectorAll('.phrase-chip').length).toBe(0)
    ;(el.querySelector('[data-kind="suggestion"]') as HTMLElement).click()
    const chips = [...el.querySelectorAll('.phrase-chip')] as HTMLElement[]
    expect(chips.length).toBeGreaterThanOrEqual(5)
    expect(chips[0]!.dataset.phrase).toBe('表述含糊，建议给出明确结论')
    chips[0]!.click()
    const input = el.querySelector('.popup-edit-input') as HTMLTextAreaElement
    expect(input.value).toBe('表述含糊，建议给出明确结论')
    expect(chips[0]!.classList.contains('on')).toBe(true)
  })

  it('切换类型后快捷语随之更换（认可 → 疑问）', () => {
    openEdit(ann({kind: 'praise', comment: ''}))
    ;(el.querySelector('[data-kind="question"]') as HTMLElement).click()
    expect((el.querySelector('.phrase-chip') as HTMLElement).dataset.phrase).toBe('依据是什么？')
  })

  it('认可类型空批注语可保存；问题类型空语被拦截', () => {
    openEdit(ann({kind: 'praise', comment: '论证有力'}))
    const input = el.querySelector('.popup-edit-input') as HTMLTextAreaElement
    input.value = ''
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated).not.toBeNull()
    expect(updated!.comment).toBe('')

    updated = null
    openEdit(ann({id: 'a2', kind: 'issue', comment: '', start: 5, end: 9}))
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated).toBeNull() // 空语未保存，编辑态保留
    expect(el.querySelector('.popup-edit-input')).toBeTruthy()
  })
})
