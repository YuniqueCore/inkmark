import {test, expect} from '@playwright/test'
import {sealNativeDocument} from '../../scripts/native-document.ts'

test('native document: Windows newlines execute trusted scripts while injected scripts stay blocked', async ({page}) => {
  const source = '<!doctype html><html><head></head><body><script>\r\n' +
    'document.documentElement.dataset.ready = "审阅";\r\n</script></body></html>'
  const sealed = sealNativeDocument(source)
  // Test artifacts add their journey to a document already sealed for production.
  await page.setContent(sealNativeDocument(sealed))
  await expect(page.locator('html')).toHaveAttribute('data-ready', '审阅')
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'document.documentElement.dataset.untrusted = "executed"'
    document.body.appendChild(script)
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-untrusted')
  expect(() => sealNativeDocument('<script src="https://example.org/remote.js"></script>')).toThrow('inline')
})
