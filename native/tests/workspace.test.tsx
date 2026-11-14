import {expect, open, test} from 'nsh/test'

test('native WebView: import, preview annotation, draft protection, export recovery and mixed persistence', async () => {
  const app = await open('./App.tsx')
  const stage = async (status: string) => {
    await app.waitUntil(() => app.texts().some(text => text.includes(`"status":"${status}"`) || text.includes('"status":"failed"')), {timeout: 60000})
    const result = JSON.parse(app.texts().find(text => text.includes('"status":'))!)
    expect(result.status).toBe(status)
    return result
  }
  await stage('window-close-ready')
  await app.window('main').pressClose()
  await stage('menu-close-ready')
  await app.keyboard.press('mod+q')
  const result = await stage('passed')
  expect(result).toEqual({status: 'passed', steps: [
    'native-picker-import', 'preview-selection-shared-anchor', 'draft-close-refused',
    'export-cancel-failure-retry', 'native-clipboard-image', 'indexeddb-mixed-workspace',
  ]})
}, 90000)
