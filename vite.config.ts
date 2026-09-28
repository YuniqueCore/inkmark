import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// header 版本号单一来源：package.json（构建期注入 __APP_VERSION__）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  plugins: [tailwindcss()],
  define: {__APP_VERSION__: JSON.stringify(pkg.version)},
})
