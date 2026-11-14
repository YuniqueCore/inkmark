import {readFile, writeFile, mkdir, copyFile, readdir, access, rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'

const target = process.argv[2]
const {version} = JSON.parse(await readFile('package.json', 'utf8'))
const toolchain = JSON.parse(await readFile('native/toolchain.json', 'utf8'))
const root = `.local-build/artifacts/${version}/${target}`
await rm(root, {recursive: true, force: true})
await mkdir(root, {recursive: true})
const prefix = `InkMark-${version}-${target}-${process.arch}`
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8'})
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error}`)
  return result.stdout.trim()
}
function zip(source, name) { run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, `${root}/${name}`]) }
let signing
switch (target) {
  case 'macos':
    zip('.local-build/packages/desktop/InkMark.app', `${prefix}.zip`)
    signing = 'ad-hoc; not notarized'
    break
  case 'linux':
    await copyFile('.local-build/packages/desktop/InkMark.tar.gz', `${root}/${prefix}.tar.gz`)
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
    zip('.local-build/ios/Build/Products/Debug-iphonesimulator/InkMark.app', `InkMark-${version}-ios-arm64-simulator.zip`)
    zip('.local-build/ios/Build/Products/Release-iphoneos/InkMark.app', `InkMark-${version}-ios-arm64-unsigned.zip`)
    signing = 'unsigned; device installation requires an Apple identity and provisioning profile'
    break
  default: throw new Error('Unknown artifact target')
}
const files = await Promise.all((await readdir(root)).filter(name => /\.(zip|gz|apk|aab|exe)$/.test(name)).sort().map(async name => ({
  name, sha256: createHash('sha256').update(await readFile(`${root}/${name}`)).digest('hex'),
})))
await writeFile(`${root}/BUILD.json`, JSON.stringify({version, target, signing, source: {
  commit: run('git', ['rev-parse', 'HEAD']), dirty: Boolean(run('git', ['status', '--porcelain'])),
}, nsh: {version: toolchain.version, commit: toolchain.commit}, files}, null, 2) + '\n')
await writeFile(`${root}/SHA256SUMS`, files.map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n')
console.log(`Prepared ${files.length} ${target} artifact(s) with checksums and source provenance`)
