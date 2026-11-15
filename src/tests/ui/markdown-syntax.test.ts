// @vitest-environment happy-dom
import {expect, test} from 'vitest'
import {markdownSyntaxRanges} from '../../ui/markdown-syntax'
import {renderAnnotatedText} from '../../ui/render-text'

test('GFM source keeps punctuation, semantic tokens and UTF-16 anchors when annotations and search split nested syntax', () => {
  const source = '# 标题 😀\r\n\r\n正文 **粗体 _斜体_** [链接](https://example.test "标题")。\r\n\r\n- [x] 已完成\r\n- [ ] 待办\r\n\r\n> 引用\r\n\r\n---\r\n\r\n| 名称 | 状态 |\r\n| --- | --- |\r\n| 文档 | 完成 |\r\n\r\n```ts\r\nconst value = 42\r\n```\r\n\r\n[ref]: https://example.test "引用标题"\r\n\r\n转义 \\* 和 &amp; <!-- 注释 -->'
  const ranges = markdownSyntaxRanges(source)
  expect(ranges.map(({start, end, classes}) => ({text: source.slice(start, end), classes}))).toMatchSnapshot()
  for (const [index, range] of ranges.entries()) {
    expect(range.start).toBeGreaterThanOrEqual(index ? ranges[index - 1]!.end : 0)
    expect(range.end).toBeGreaterThan(range.start)
    expect(range.end).toBeLessThanOrEqual(source.length)
  }
  const start = source.indexOf('粗体')
  const end = source.indexOf('斜体') + 2
  const container = document.createElement('div')
  container.innerHTML = renderAnnotatedText(source, 0, [{id: 'review', start, end, kind: 'suggestion', comment: '确认这段重点', status: 'open', source: 'manual', createdAt: 1, updatedAt: 1}], [{start: start + 1, end: end - 1}], ranges)
  expect(container.querySelector('.seg-hl .md-syntax-strong')?.textContent).toBe('粗')
  expect(container.querySelector('.seg-hl.seg-search .md-syntax-emphasis:not(.md-syntax-mark)')?.textContent).toBe('斜')
  container.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  expect(container.textContent).toBe(source)
  expect(markdownSyntaxRanges('')).toEqual([])
  expect(markdownSyntaxRanges('普通文字 😀')).toEqual([])
})
