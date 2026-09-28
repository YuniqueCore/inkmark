import { defineConfig } from 'vitest/config'

/** vitest 只负责 tests/ 下的单元/组件测试；浏览器端 screenplay 套件在 e2e/，由 Playwright 运行。 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
