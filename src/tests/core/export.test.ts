import {expect, test} from 'vitest'
import {exportFileName, zipEntryNames} from '../../core/export'
import {buildReviewExport} from '../../core/review-export'
import {parseRequest} from '../../platform/protocol'

test('portable review names preserve suffixes and every ZIP entry across Unicode truncation and collisions', () => {
  const date = new Date('2026-01-02T00:00:00Z')
  const names = ['a'.repeat(240) + '.md', '中'.repeat(80) + '.md', '😀'.repeat(80) + '.png', '\0/\\.md', 'a\u007fb.md', 'CON.md',
    ...Array.from({length: 12}, (_, i) => '长'.repeat(100) + i + '.md')]
  const originals = [...names]
  for (const format of ['review', 'w3c'] as const) {
    const exports = zipEntryNames(names, format, date)
    expect(new Set(exports).size).toBe(names.length)
    for (const name of [...exports, ...names.map(name => exportFileName(name, format, date))]) {
      const bytes = new TextEncoder().encode(name)
      expect(bytes.length).toBeLessThanOrEqual(255)
      expect(new TextDecoder().decode(bytes)).toBe(name)
      expect(name).toMatch(format === 'w3c' ? /-w3c-2026-01-02(?:-\d+)?\.json$/ : /-review-2026-01-02(?:-\d+)?\.md$/)
      expect(() => parseRequest(JSON.stringify({id: 'export', operation: 'files.save', file: {name, type: 'text/plain', base64: ''}}))).not.toThrow()
    }
  }
  const docs = names.map((name, i) => ({id: String(i), name, path: '', text: `Document ${i}`, annotations: [], addedAt: 0}))
  const bundle = buildReviewExport(docs, 'review', {date, includeFileInfo: true})
  expect(bundle.kind).toBe('bundle')
  if (bundle.kind !== 'bundle') throw new Error('Expected a mixed-name review archive')
  expect(Object.keys(bundle.entries)).toHaveLength(names.length)
  Object.values(bundle.entries).forEach((content, i) => expect(content).toContain(names[i]))
  expect(names).toEqual(originals)
})
