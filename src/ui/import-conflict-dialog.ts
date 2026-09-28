/** 导入冲突诊断树：同名冲突逐行决策（覆盖 / 重命名 / 跳过）+ 批量预设。
 *
 * Promise<ImportRow[] | null>；null = 取消（整次导入作废，一件不进）。
 * 行动变更经 core 纯函数（setRowAction / applyPreset）定稿，重命名落点自动重排。
 * 覆盖行预演重锚（编辑原文同款管线）：徽标预告重锚 / 失锚条数，先知情再确认。
 */

import {
  applyPreset,
  setRowAction,
  type ConflictPreset,
  type ImportPlan,
  type ImportRow,
} from '../core/import-conflict'
import { reanchorAnnotations } from '../core/reanchor'
import { escapeHtml } from '../core/text'
import type { DocItem } from '../core/types'
import { icon } from './icons'

export function importConflictDialog(plan: ImportPlan, existing: DocItem[]): Promise<ImportRow[] | null> {
  return new Promise((resolve) => {
    let rows = plan.rows
    // 重锚预演按行序缓存（finalize 保持行序与长度，索引恒定）
    const previews = rows.map((r) =>
      r.existing ? reanchorAnnotations(r.existing.text, r.incoming.text, r.existing.annotations) : null,
    )

    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-100 bg-black/50 backdrop-blur-[2px]'
    const panel = document.createElement('div')
    panel.className =
      'fixed left-1/2 top-1/2 z-101 flex max-h-[86vh] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-2xl'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.setAttribute('aria-label', '导入冲突诊断')
    panel.style.animation = 'pop-in 0.14s ease-out'
    panel.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">${icon('file', 'size-4')}</div>
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold leading-snug tracking-tight">发现 ${conflictCount()} 个同名冲突</h2>
          <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">覆盖会保留原有批注并重锚到新文本；重命名两版并存；拿不准就先跳过。</p>
        </div>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-1.5" data-role="presets"></div>
      <div class="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border" data-role="tree"></div>
      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="min-w-0 truncate text-xs text-muted-foreground" data-role="summary"></span>
        <span class="flex shrink-0 gap-2">
          <button class="btn btn-outline btn-sm" data-op="cancel">取消</button>
          <button class="btn btn-default btn-sm" data-op="confirm">确认导入</button>
        </span>
      </div>`

    const treeEl = panel.querySelector('[data-role="tree"]') as HTMLElement
    const presetsEl = panel.querySelector('[data-role="presets"]') as HTMLElement
    const summaryEl = panel.querySelector('[data-role="summary"]') as HTMLElement

    const PRESETS: Array<{preset: ConflictPreset; label: string; title: string}> = [
      {preset: 'overwrite-all', label: '全部覆盖', title: '所有冲突行一律覆盖（无变化行除外）'},
      {preset: 'overwrite-unannotated', label: '覆盖未标注的', title: '只覆盖没有批注的文档，有批注的保持原决策'},
      {preset: 'overwrite-annotated', label: '覆盖标注的', title: '只覆盖带批注的文档（批注将重锚到新文本），其余保持原决策'},
    ]

    const count = (action: ImportRow['action']): number => rows.filter((r) => r.action === action).length
    function conflictCount(): number {
      return rows.filter((r) => r.existing && r.action !== 'identical').length
    }

    function render(): void {
      presetsEl.innerHTML = PRESETS.map(
        (p, i) =>
          `<button class="btn btn-outline btn-sm h-7 px-2 text-xs" data-preset="${i}" title="${escapeHtml(p.title)}">${p.label}</button>`,
      ).join('')
      presetsEl.querySelectorAll('[data-preset]').forEach((btn) =>
        btn.addEventListener('click', () => {
          rows = applyPreset(rows, existing, PRESETS[Number((btn as HTMLElement).dataset.preset)]!.preset)
          render()
        }),
      )
      renderTree()
      renderSummary()
    }

    function renderTree(): void {
      // 按相对路径分组（诊断树只呈现有决策的行；无冲突文件在底部汇总说明）
      const groups = new Map<string, Array<{row: ImportRow; index: number}>>()
      rows.forEach((row, index) => {
        if (!row.existing) return
        const list = groups.get(row.incoming.path) ?? []
        list.push({row, index})
        groups.set(row.incoming.path, list)
      })
      const sections = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, items]) => {
          const body = items
            .map(({row, index}) => {
              const name = escapeHtml(row.incoming.name)
              const preview = previews[index]
              if (row.action === 'identical') {
                return `
                  <div class="flex items-center gap-2 px-3 py-2 text-sm" data-row="${index}">
                    <span class="min-w-0 truncate">${name}</span>
                    <span class="badge bg-secondary text-secondary-foreground">无变化</span>
                    <span class="ml-auto shrink-0 text-xs text-muted-foreground">内容相同，将跳过</span>
                  </div>`
              }
              const renameHint =
                row.action === 'rename' && row.renameTo
                  ? `<span class="shrink-0 text-xs text-muted-foreground">→ ${escapeHtml(row.renameTo)}</span>`
                  : ''
              const badges: string[] = []
              const annCount = row.existing!.annotations.length
              if (annCount > 0) badges.push(`<span class="badge bg-secondary text-secondary-foreground">批注 ${annCount}</span>`)
              if (row.action === 'overwrite' && preview && (preview.moved > 0 || preview.clamped > 0)) {
                badges.push(
                  preview.clamped > 0
                    ? `<span class="badge border-amber-500/40 text-amber-600 dark:text-amber-400">重锚 ${preview.moved} · 失锚 ${preview.clamped}</span>`
                    : `<span class="badge bg-secondary text-secondary-foreground">重锚 ${preview.moved}</span>`,
                )
              }
              const seg = (action: string, label: string) =>
                `<button class="seg-opt ${row.action === action ? 'on' : ''}" data-action="${action}">${label}</button>`
              return `
                <div class="flex items-center gap-2 border-t px-3 py-2 text-sm first:border-t-0" data-row="${index}">
                  <span class="min-w-0 truncate">${name}</span>
                  ${renameHint}
                  <span class="flex shrink-0 gap-1">${badges.join('')}</span>
                  <span class="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border p-0.5" data-role="actions">
                    ${seg('overwrite', '覆盖')}${seg('rename', '重命名')}${seg('skip', '跳过')}
                  </span>
                </div>`
            })
            .join('')
          return `
            <div class="px-3 pt-2.5 pb-1 text-xs font-medium text-muted-foreground">
              ${icon('folder', 'size-3.5 inline align-[-2px]')} ${escapeHtml(path === '' ? '（根目录）' : path + '/')}
            </div>
            ${body}`
        })
      treeEl.innerHTML =
        sections.join('') ||
        `<div class="px-3 py-6 text-center text-sm text-muted-foreground">没有冲突文件</div>`
      treeEl.querySelectorAll('[data-row]').forEach((el) => {
        const index = Number((el as HTMLElement).dataset.row)
        el.querySelectorAll('[data-action]').forEach((btn) =>
          btn.addEventListener('click', () => {
            rows = setRowAction(rows, existing, index, (btn as HTMLElement).dataset.action as ImportRow['action'])
            render()
          }),
        )
      })
    }

    function renderSummary(): void {
      const direct = count('direct')
      const parts = [
        count('overwrite') > 0 ? `覆盖 ${count('overwrite')}` : '',
        count('rename') > 0 ? `重命名 ${count('rename')}` : '',
        count('skip') > 0 ? `跳过 ${count('skip')}` : '',
        count('identical') > 0 ? `无变化 ${count('identical')}` : '',
        direct > 0 ? `直接导入 ${direct}` : '',
      ].filter(Boolean)
      summaryEl.textContent = parts.length > 0 ? parts.join(' · ') : '没有可导入的冲突文件'
      ;(panel.querySelector('[data-op="confirm"]') as HTMLButtonElement).disabled =
        rows.every((r) => r.action === 'skip' || r.action === 'identical')
    }

    const finish = (result: ImportRow[] | null) => {
      overlay.remove()
      panel.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      // 捕获阶段阻断：避免 Esc 同时收起底下的浮层
      e.stopPropagation()
      if (e.key === 'Escape') finish(null)
    }

    overlay.addEventListener('mousedown', () => finish(null))
    panel.querySelector('[data-op="cancel"]')?.addEventListener('click', () => finish(null))
    panel.querySelector('[data-op="confirm"]')?.addEventListener('click', () => finish(rows))
    document.addEventListener('keydown', onKey, true)

    document.body.append(overlay, panel)
    render()
  })
}
