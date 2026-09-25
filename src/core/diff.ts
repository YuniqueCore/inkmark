/** 行级 diff（Myers O(ND)）——「原文 vs AI 改稿」对照视图的纯函数核心。
 *
 * 容量护栏：先裁掉公共前后缀，再跑 Myers；剩余部分的编辑距离超过预算时
 * 降级为「整块删除 + 整块新增」（不挂死、不爆内存），对超大改动文档仍然可用。
 */

export interface DiffRow {
  type: 'equal' | 'del' | 'add'
  /** 行内容（不含行尾换行符） */
  text: string
  /** 原文中的行起始偏移（equal / del 有值）——批注锚定用 */
  aStart: number | null
  /** 改稿中的行起始偏移（equal / add 有值） */
  bStart: number | null
}

interface Line {
  text: string
  start: number
}

function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    lines.push({ text: text.slice(start, end), start })
    start = nl === -1 ? text.length : nl + 1
  }
  return lines
}

type Op = { t: 'equal' | 'del' | 'add'; i: number; j: number }

/**
 * 标准 Myers 贪心算法（带 trace 回溯）。返回正向编辑脚本；编辑距离超过
 * maxD 时返回 null，由调用方降级。
 */
function myersCore(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((_, j) => ({ t: 'add' as const, i: 0, j }))
  if (m === 0) return a.map((_, i) => ({ t: 'del' as const, i, j: 0 }))
  const offset = n + m
  const v = new Int32Array(2 * offset + 1)
  const trace: Int32Array[] = []
  for (let d = 0; d <= offset; d++) {
    if (d > maxD) return null
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const fromDel = v[offset + k - 1]!
      const fromAdd = v[offset + k + 1]!
      let x: number
      if (k === -d || (k !== d && fromDel < fromAdd)) {
        x = fromAdd // 向下：来自 b 的插入
      } else {
        x = fromDel + 1 // 向右：a 的删除
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], a: string[], b: string[], dFinal: number, offset: number): Op[] {
  const ops: Op[] = []
  let x = a.length
  let y = b.length
  for (let d = dFinal; d > 0; d--) {
    const v = trace[d]!
    const k = x - y
    const fromDel = v[offset + k - 1]!
    const fromAdd = v[offset + k + 1]!
    const prevK = k === -d || (k !== d && fromDel < fromAdd) ? k + 1 : k - 1
    const prevX = v[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ t: 'equal', i: x - 1, j: y - 1 })
      x--
      y--
    }
    if (x === prevX) {
      ops.push({ t: 'add', i: x, j: prevY })
      y--
    } else {
      ops.push({ t: 'del', i: prevX, j: y })
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ t: 'equal', i: x - 1, j: y - 1 })
    x--
    y--
  }
  return ops.reverse()
}

/**
 * 行级 diff。空行也是一行；文本末尾的换行不产生多余的空行。
 * 等值行在两侧都出现，del 行只属于原文，add 行只属于改稿。
 */
export function diffLines(a: string, b: string): DiffRow[] {
  const al = splitLines(a)
  const bl = splitLines(b)

  // 裁掉公共前后缀，把 Myers 的工作量限制在真正改动的中部
  let pre = 0
  while (pre < al.length && pre < bl.length && al[pre]!.text === bl[pre]!.text) pre++
  let suf = 0
  while (
    suf < al.length - pre &&
    suf < bl.length - pre &&
    al[al.length - 1 - suf]!.text === bl[bl.length - 1 - suf]!.text
  )
    suf++
  const midA = al.slice(pre, al.length - suf)
  const midB = bl.slice(pre, bl.length - suf)

  // 内存预算 ≈ 4MB 的 trace：大文档自动收紧深度上限
  const maxD = Math.max(64, Math.min(1024, Math.floor(2_000_000 / (midA.length + midB.length + 2))))
  const ops = myersCore(
    midA.map((l) => l.text),
    midB.map((l) => l.text),
    maxD,
  )

  const rows: DiffRow[] = []
  const pushA = (l: Line, type: 'equal' | 'del', bLine: Line | null) => {
    rows.push({ type, text: l.text, aStart: l.start, bStart: bLine?.start ?? null })
  }
  // 前缀等值行（裁剪掉的部分要回填，否则完全相同的文本会输出空 diff）
  for (let i = 0; i < pre; i++) pushA(al[i]!, 'equal', bl[i] ?? null)
  if (ops === null) {
    for (const l of midA) pushA(l, 'del', null)
    for (const l of midB) rows.push({ type: 'add', text: l.text, aStart: null, bStart: l.start })
  } else {
    for (const op of ops) {
      if (op.t === 'equal') pushA(midA[op.i]!, 'equal', midB[op.j] ?? null)
      else if (op.t === 'del') pushA(midA[op.i]!, 'del', null)
      else rows.push({ type: 'add', text: midB[op.j]!.text, aStart: null, bStart: midB[op.j]!.start })
    }
  }
  for (let i = 0; i < suf; i++) {
    pushA(al[al.length - suf + i]!, 'equal', bl[bl.length - suf + i] ?? null)
  }
  return rows
}

/** 对照统计：新增 / 删除的行数（工具栏角标用）。 */
export function diffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const r of rows) {
    if (r.type === 'add') added++
    else if (r.type === 'del') removed++
  }
  return { added, removed }
}
