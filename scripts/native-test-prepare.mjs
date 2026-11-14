import {readFile, writeFile} from 'node:fs/promises'
import {sealNativeDocument} from './native-document.ts'
const journey = await readFile('native/tests/journey.js', 'utf8')
let production = await readFile('.local-build/native-web/index.html', 'utf8')
// NSH isolates its own test storage; WebView engine profiles can persist between processes.
// Reset only the test origin, before the production bootstrap creates its IndexedDB connection.
production = production.replace(/<script([^>]*type="module"[^>]*)>([\s\S]*?)<\/script>/, (_, attrs, script) => {
  const reset = `localStorage.clear(); await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('inkmark-workspace');r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Test database still in use'))});\n`
  return `<script${attrs}>${reset}${script}</script>`
})
const html = sealNativeDocument(production.replace('</body>', `<script>${journey}</script></body>`))
await writeFile('native/generated/e2e-web.ts', `export default ${JSON.stringify({html, baseUrl: 'https://inkmark-tests.localhost/'})};\n`)
const config = JSON.parse(await readFile('native/mobile/nsh.json', 'utf8'))
config.name = 'InkMarkTests'; config.id += '.tests'; delete config.capabilities.host; config.capabilities.webview.hosts = ['inkmark-tests.localhost']
await writeFile('native/tests/nsh.json', JSON.stringify(config, null, 2))
