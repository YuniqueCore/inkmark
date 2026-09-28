import { defineConfig } from '@playwright/test'

/** 浏览器端 screenplay 套件：真实 Chromium（系统 Chrome）+ 本地 dev server。
 * 复用已起的服务器（reuseExistingServer）便于本地迭代；CI 上自动拉起。 */
export default defineConfig({
  testDir: 'e2e/specs',
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5188',
    channel: 'chrome',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run dev --port 5188 --strictPort',
    url: 'http://localhost:5188',
    reuseExistingServer: true,
    timeout: 20_000,
  },
})
