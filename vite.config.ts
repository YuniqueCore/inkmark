import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import {viteSingleFile} from 'vite-plugin-singlefile'

// header 版本号单一来源：package.json（构建期注入 __APP_VERSION__）
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig(({mode}) => {
  const native = mode === 'native'
  return {
    plugins: [tailwindcss(), ...(native ? [viteSingleFile(), {
      name: 'inline-native-icon',
      transformIndexHtml: (html: string) => html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${readFileSync(new URL('./public/favicon.svg', import.meta.url)).toString('base64')}"`),
    }] : [])],
    publicDir: native ? false : 'public',
    build: native ? {outDir: '.local-build/native-web', target: ['safari16.4', 'chrome109', 'firefox115']} : {},
    define: {__APP_VERSION__: JSON.stringify(pkg.version), __NATIVE_HOST__: JSON.stringify(native)},
  }
})
