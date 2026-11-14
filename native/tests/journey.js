// Runs only in the test artifact, inside the platform's real WebView. No production test API.
(async () => {
  const steps = []
  const q = selector => document.querySelector(selector)
  const wait = async (predicate, label) => {
    for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)) }
    throw new Error(`Timed out: ${label}; ${document.body.innerText.slice(-800)}`)
  }
  const click = selector => { const element = q(selector); if (!element) throw new Error(`Missing ${selector}`); element.click() }
  const button = label => {
    const element = [...document.querySelectorAll('button,[role="menuitem"]')].find(e => e.textContent.trim() === label)
    if (!element) throw new Error(`Missing button: ${label}`)
    element.click()
  }
  const input = (selector, value) => { const element = q(selector); element.value = value; element.dispatchEvent(new Event('input', {bubbles: true})) }
  const report = value => window.nsh.postMessage(JSON.stringify({id: 'e2e-report', operation: 'files.save', file: {
    name: 'e2e-report.json', type: 'application/json', base64: btoa(unescape(encodeURIComponent(JSON.stringify(value)))),
  }}))
  const saved = () => q('#save-text')?.textContent === '已保存'
  const nextCloseRequest = () => new Promise(resolve => {
    const receive = event => {
      if (typeof event.data !== 'string' || !event.data.startsWith('inkmark:prepare-close:')) return
      window.removeEventListener('message', receive)
      resolve()
    }
    window.addEventListener('message', receive)
  })
  try {
    await wait(() => q('#btn-import') && saved(), 'workspace ready')
    click('#btn-import'); click('[data-menu-id="files"]')
    await wait(() => q('#editor')?.textContent.includes('Native review'), 'native file import')
    steps.push('native-picker-import')
    button('分栏')
    await wait(() => q('#markdown-preview strong'), 'Markdown preview')
    const target = q('#markdown-preview strong')
    const range = document.createRange(); range.selectNodeContents(target)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    const rect = range.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: rect.right, clientY: rect.bottom}))
    await wait(() => q('#selection-pin') && !q('#selection-pin').classList.contains('hidden') && q('#selection-pin').getBoundingClientRect().width > 0, 'selection pin')
    click('#selection-pin')
    await wait(() => q('[data-role="composer-comment"]'), 'annotation composer')
    input('[data-role="composer-comment"]', 'Native WebView review')
    button('添加批注')
    await wait(() => q('#sidebar')?.textContent.includes('Native WebView review') && saved(), 'persist annotation')
    if (!q('#editor .seg-hl') || !q('#markdown-preview .seg-hl')) throw new Error('Shared source/preview anchor missing')
    steps.push('preview-selection-shared-anchor')
    click('#btn-edit'); input('#edit-source', 'unsaved draft')
    const windowClose = nextCloseRequest()
    report({status: 'window-close-ready'})
    await windowClose
    await wait(() => document.body.innerText.includes('请先'), 'draft close refusal')
    if (q('#edit-source').value !== 'unsaved draft' || document.body.inert) throw new Error('Close lost or locked draft')
    click('[data-op="cancel-edit-text"]')
    click('#btn-search')
    input('[data-sp-composer] [data-role="composer-comment"]', 'Unsubmitted batch review')
    const menuClose = nextCloseRequest()
    report({status: 'menu-close-ready'})
    await menuClose
    await wait(() => !document.body.inert, 'menu close refusal')
    if (document.body.inert || q('[data-sp-composer] [data-role="composer-comment"]').value !== 'Unsubmitted batch review') throw new Error('Batch draft lost or locked')
    click('#sp-close')
    steps.push('draft-close-refused')
    click('#btn-export'); click('#export-modal [data-tab="w3c"]')
    const exported = JSON.parse(q('#export-preview').value)
    if (exported.length !== 1 || !JSON.stringify(exported).includes('Native WebView review')) throw new Error('Wrong export')
    click('#export-modal [data-op="download"]')
    await wait(() => !q('#export-modal [data-op="download"]').disabled, 'cancelled export settled')
    click('#export-modal [data-op="download"]')
    await wait(() => document.body.innerText.includes('Test disk unavailable'), 'failed export feedback')
    click('#export-modal [data-op="download"]')
    await wait(() => document.body.innerText.includes('文件已保存'), 'successful export feedback')
    click('#export-modal [data-op="close"]')
    steps.push('export-cancel-failure-retry')
    click('#btn-import'); click('[data-menu-id="image-paste"]')
    await wait(() => q('#image-view img')?.naturalWidth > 0 && saved(), 'clipboard image import')
    if (!q('#image-view img').src.startsWith('data:image/png;')) throw new Error('Bitmap clipboard was not normalized')
    if (!q('#btn-edit').disabled) throw new Error('Image entered text editor')
    steps.push('native-clipboard-image')
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('inkmark-workspace'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const snapshot = await new Promise((resolve, reject) => { const r = db.transaction('snapshots').objectStore('snapshots').get('workspace'); r.onsuccess = () => resolve(JSON.parse(r.result)); r.onerror = () => reject(r.error) })
    db.close()
    if (snapshot.docs.length !== 2 || !snapshot.docs.some(doc => doc.annotations.length === 1)) throw new Error('IndexedDB snapshot incomplete')
    steps.push('indexeddb-mixed-workspace')
    report({status: 'passed', steps})
  } catch (error) { report({status: 'failed', steps, error: String(error)}) }
})()
