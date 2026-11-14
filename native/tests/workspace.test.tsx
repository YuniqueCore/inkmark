import {expect, open, test} from 'nsh/test'

test('native WebView: import, preview annotation, draft protection, export recovery and mixed persistence', async () => {
  const app = await open('./App.tsx')
  await app.waitUntil(() => app.texts().some(text => text.includes('"status":')), {timeout: 60000})
  const result = JSON.parse(app.texts().find(text => text.includes('"status":'))!)
  expect(result).toEqual({status: 'passed', steps: [
    'native-picker-import', 'preview-selection-shared-anchor', 'draft-close-refused',
    'export-cancel-failure-retry', 'native-clipboard-image', 'indexeddb-mixed-workspace',
  ]})
}, 90000)
