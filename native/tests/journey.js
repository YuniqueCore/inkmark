// Test artifact only: assertions and DOM selection inside the real document canvas.
// Navigation, forms, menus and buttons are operated by nsh/test outside this WebView.
(async () => {
  const q = selector => document.querySelector(selector)
  let view = null
  const post = window.nsh.postMessage.bind(window.nsh)
  window.nsh.postMessage = message => {
    if (message.startsWith('{"type":"shell.view"')) view = JSON.parse(message).view
    post(message)
  }
  const report = value => post(JSON.stringify({id: 'e2e-report', operation: 'files.save', file: {
    name: 'e2e-report.json', type: 'application/json', base64: btoa(unescape(encodeURIComponent(JSON.stringify(value)))),
  }}))
  const wait = async (predicate, label) => {
    for (let i = 0; i < 1800; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)) }
    throw new Error(`Timed out: ${label}`)
  }
  try {
    await wait(() => view?.chrome?.ready, 'workspace ready')
    if (q('header,aside,input,textarea,select,[role="dialog"]')) throw new Error('Native build contains web application controls')
    await wait(() => q('#editor')?.textContent.includes('Native review') && view.save.status === 'saved', 'native picker import')
    report({status: 'imported'})
    await wait(() => view.chrome.readingMode === 'split' && q('#markdown-preview strong'), 'native reading menu')
    const target = q('#markdown-preview strong'), range = document.createRange()
    range.selectNodeContents(target)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    const rect = range.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: rect.right, clientY: rect.bottom}))
    await wait(() => view.selection, 'native selection affordance')
    report({status: 'selected'})
    await wait(() => view.chrome.active.annotationCount === 1 && view.save.status === 'saved', 'native annotation form')
    if (!q('#editor .seg-hl') || !q('#markdown-preview .seg-hl')) throw new Error('Shared source/preview anchor missing')
    report({status: 'annotated'})
    await wait(() => view.chrome.active.kind === 'image' && view.chrome.active.annotationCount === 1 && view.save.status === 'saved', 'native image form')
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('inkmark-workspace'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const snapshot = await new Promise((resolve, reject) => { const r = db.transaction('snapshots').objectStore('snapshots').get('workspace'); r.onsuccess = () => resolve(JSON.parse(r.result)); r.onerror = () => reject(r.error) })
    db.close()
    if (snapshot.docs.length !== 2 || !snapshot.docs.every(doc => doc.annotations.length === 1)) throw new Error('Mixed workspace is incomplete')
    if (snapshot.docs[0].text !== '# Native review\r\n\r\nA **stable primitive** composes.') throw new Error('Native editing changed CRLF source bytes')
    if (!q('#image-view img').src.startsWith('data:image/png;')) throw new Error('Clipboard bitmap was not normalized')
    if (q('input,textarea,select,[role="dialog"],header,aside')) throw new Error('A web form leaked into the native canvas')
    report({status: 'passed', documents: snapshot.docs.length, annotations: snapshot.docs.map(doc => doc.annotations.length)})
  } catch (error) { report({status: 'failed', error: String(error)}) }
})()
