import {defineConfig} from 'vitest/config'

// The host is a compile-time capability. Exercise its enabled branch separately from static web.
export default defineConfig({
  define: {__NATIVE_HOST__: 'true'},
  test: {include: ['src/tests/platform/host.test.ts']},
})
