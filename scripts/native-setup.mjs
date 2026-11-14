import {readFile, writeFile, mkdir, access, rename, rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'

const manifest = JSON.parse(await readFile('native/toolchain.json', 'utf8'))
const platform = {darwin: 'macos', linux: 'linux', win32: 'windows'}[process.platform]
const arch = {arm64: 'arm64', x64: 'x86_64'}[process.arch]
const target = process.argv[2] ?? 'cli'
if (!platform || !arch || !['cli', 'android', 'ios'].includes(target)) throw new Error('Unsupported NSH SDK target')
const archive = target === 'cli' ? `nsh-${platform}-${arch}.${platform === 'windows' ? 'zip' : 'tar.gz'}` : `nsh-embed-${target}.zip`
const destination = resolve(`.local-build/nsh/sdk/${target === 'cli' ? 'cli' : `embed-${target}`}`)
const downloads = resolve(`.local-build/nsh/downloads/${manifest.version}`)
await mkdir(downloads, {recursive: true})
const file = `${downloads}/${archive}`
try { await access(file) }
catch {
  const response = await fetch(`https://github.com/longbridge/nsh/releases/download/v${manifest.version}/${archive}`)
  if (!response.ok) throw new Error(`NSH SDK download failed: ${response.status}`)
  await writeFile(`${file}.part`, new Uint8Array(await response.arrayBuffer()))
  await rename(`${file}.part`, file)
}
const digest = createHash('sha256').update(await readFile(file)).digest('hex')
if (digest !== manifest.assets[archive]) throw new Error(`NSH checksum mismatch: ${archive}`)
await rm(destination, {recursive: true, force: true})
await mkdir(destination, {recursive: true})
let command = 'tar', args = ['-xzf', file, '-C', destination]
if (archive.endsWith('.zip')) {
  if (process.platform === 'darwin') { command = 'ditto'; args = ['-xk', file, destination] }
  else if (process.platform === 'win32') {
    command = 'tar'
    args = ['-xf', file, '-C', destination]
  } else { command = 'unzip'; args = ['-q', '-o', file, '-d', destination] }
}
const result = spawnSync(command, args, {stdio: 'inherit'})
if (result.status !== 0) throw new Error(`NSH SDK extraction failed: ${result.error ?? result.status}`)
console.log(`Verified NSH ${manifest.version}: ${destination}`)
