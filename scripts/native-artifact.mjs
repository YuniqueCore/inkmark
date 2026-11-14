import {readFile, writeFile, mkdir, copyFile, readdir, access, rm, stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

const target = process.argv[2]
if (!['macos', 'linux', 'windows', 'android', 'ios'].includes(target)) throw new Error('Unknown artifact target')
const {version} = JSON.parse(await readFile('package.json', 'utf8'))
const toolchain = JSON.parse(await readFile('native/toolchain.json', 'utf8'))
const root = `.local-build/artifacts/${version}/${target}`
const prefix = `InkMark-${version}-${target}-${process.arch}`
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8'})
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error}`)
  return result.stdout.trim()
}
function zip(source, name) { run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, `${root}/${name}`]) }
const changes = run('git', ['status', '--porcelain'])
const source = {commit: run('git', ['rev-parse', 'HEAD']), dirty: Boolean(changes)}
if (process.env.CI && source.dirty) throw new Error(`Build changed the checkout:\n${changes}`)
await rm(root, {recursive: true, force: true})
await mkdir(root, {recursive: true})
let signing
switch (target) {
  case 'macos':
    zip('.local-build/packages/desktop/InkMark.app', `${prefix}.zip`)
    signing = 'ad-hoc; not notarized'
    break
  case 'linux':
    await copyFile('native/linux/inkmark.apparmor', '.local-build/packages/desktop/InkMark/inkmark.apparmor')
    await copyFile('native/linux/README.md', '.local-build/packages/desktop/InkMark/README.md')
    run('tar', ['-czf', `${root}/${prefix}.tar.gz`, '-C', '.local-build/packages/desktop', 'InkMark'])
    signing = 'unsigned'
    break
  case 'windows':
    await copyFile('.local-build/packages/desktop/InkMark.zip', `${root}/${prefix}.zip`)
    try { await access('.local-build/packages/desktop/InkMark-setup.exe'); await copyFile('.local-build/packages/desktop/InkMark-setup.exe', `${root}/${prefix}-setup.exe`) } catch (error) { if (error.code !== 'ENOENT') throw error }
    signing = 'unsigned'
    break
  case 'android':
    await copyFile('native/android/app/build/outputs/apk/debug/app-debug.apk', `${root}/InkMark-${version}-android-debug.apk`)
    await copyFile('native/android/app/build/outputs/bundle/release/app-release.aab', `${root}/InkMark-${version}-android-unsigned.aab`)
    signing = 'APK: Android debug key; AAB: unsigned, requires release signing'
    break
  case 'ios':
    for (const [configuration, distribution] of [['Debug-iphonesimulator', 'simulator'], ['Release-iphoneos', 'unsigned']]) {
      const app = `.local-build/ios/Build/Products/${configuration}/InkMark.app`
      for (const resource of ['nsh/bundle.nshc', 'nsh/app.json', 'nsh/capabilities.json', 'Assets.car']) {
        const file = await stat(`${app}/${resource}`)
        if (!file.isFile() || file.size === 0) throw new Error(`Missing iOS application resource: ${resource}`)
      }
      zip(app, `InkMark-${version}-ios-arm64-${distribution}.zip`)
    }
    signing = 'unsigned; device installation requires an Apple identity and provisioning profile'
    break
  default: throw new Error('Unknown artifact target')
}
const files = await Promise.all((await readdir(root)).filter(name => /\.(zip|gz|apk|aab|exe)$/.test(name)).sort().map(async name => ({
  name, sha256: createHash('sha256').update(await readFile(`${root}/${name}`)).digest('hex'),
})))
await writeFile(`${root}/BUILD.json`, JSON.stringify({version, target, signing, source,
  nsh: {version: toolchain.version, commit: toolchain.commit}, files}, null, 2) + '\n')
await writeFile(`${root}/SHA256SUMS`, files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n')
console.log(`Prepared ${files.length} ${target} artifact(s) with checksums and source provenance`)
