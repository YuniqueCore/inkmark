// @vitest-environment happy-dom
/** UI 层回归测试：批注弹层编辑态——快捷语 chips 与认可空描述保存。 */

import { beforeEach, describe, expect, it } from 'vitest'
import { AnnotationPopup } from '../src/ui/annotation-popup'
import type { Annotation, AnnotationKind } from '../src/core/types'

let el: HTMLElement
let popup: AnnotationPopup
let updated: {id: string; kind: AnnotationKind; comment: string; replacement?: string} | null

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
    onUpdate: (id, kind, comment, replacement) => {
      updated = {id, kind, comment, replacement}
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

const editInput = (): HTMLTextAreaElement => el.querySelector('.popup-edit-input') as HTMLTextAreaElement

describe('弹层编辑态快捷语', () => {
  it('非人工类型（slop）编辑：头部徽标呈现当前类型；切到建议后出现快捷语', () => {
    openEdit(ann({kind: 'slop', comment: ''}))
    // 四类人工 chips；当前类型不在清单内 → chips 无选中态，头部徽标呈现类型
    expect(el.querySelectorAll('.kind-chip').length).toBe(4)
    expect(el.querySelector('.popup-kind-badge')?.textContent).toContain('AI 味')
    expect(el.querySelectorAll('.phrase-chip').length).toBe(0)
    ;(el.querySelector('[data-kind="suggestion"]') as HTMLElement).click()
    const chips = [...el.querySelectorAll('.phrase-chip')] as HTMLElement[]
    expect(chips.length).toBeGreaterThanOrEqual(5)
    expect(chips[0]!.dataset.phrase).toBe('表述含糊，建议给出明确结论')
    chips[0]!.click()
    expect(editInput().value).toBe('表述含糊，建议给出明确结论')
    expect(chips[0]!.classList.contains('on')).toBe(true)
  })

  it('切换类型后快捷语随之更换（认可 → 疑问），头部徽标实时跟随', () => {
    openEdit(ann({kind: 'praise', comment: ''}))
    ;(el.querySelector('[data-kind="question"]') as HTMLElement).click()
    expect((el.querySelector('.phrase-chip') as HTMLElement).dataset.phrase).toBe('依据是什么？')
    const badge = el.querySelector('.popup-kind-badge') as HTMLElement
    expect(badge.textContent).toContain('疑问')
    expect(badge.style.color).toBe('var(--kind-question)')
  })

  it('认可类型空批注语可保存；问题类型空语被拦截', () => {
    openEdit(ann({kind: 'praise', comment: '论证有力'}))
    // 表单状态归 ComposerForm 所有：模拟输入 = 置值 + input 事件
    editInput().value = ''
    editInput().dispatchEvent(new Event('input', {bubbles: true}))
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated).not.toBeNull()
    expect(updated!.comment).toBe('')

    updated = null
    openEdit(ann({id: 'a2', kind: 'issue', comment: '', start: 5, end: 9}))
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated).toBeNull() // 空语未保存，编辑态保留
    expect(editInput()).toBeTruthy()
  })

  it('编辑态可写建议替换词并随保存传出；清空即撤下指令', () => {
    openEdit(ann({kind: 'suggestion', comment: '旧措辞', replacement: '旧词'}))
    const replacement = el.querySelector('[data-role="composer-replacement"]') as HTMLInputElement
    expect(replacement.value).toBe('旧词')
    replacement.value = '新词'
    replacement.dispatchEvent(new Event('input', {bubbles: true}))
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated!.replacement).toBe('新词')

    updated = null
    openEdit(ann({id: 'a3', kind: 'suggestion', comment: '再改', start: 6, end: 10}))
    ;(el.querySelector('[data-op="save"]') as HTMLElement).click()
    expect(updated!.replacement).toBeUndefined()
  })
})
