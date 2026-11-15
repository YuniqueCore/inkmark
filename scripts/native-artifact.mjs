import {readFile, writeFile, mkdir, copyFile, readdir, rm, stat} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {checksums, hashFile, nativeTargets, platforms} from './artifacts.ts'

const target = process.argv[2]
if (!nativeTargets.includes(target)) throw new Error('Unknown artifact target')
const {version} = JSON.parse(await readFile('package.json', 'utf8'))
const toolchain = JSON.parse(await readFile('native/toolchain.json', 'utf8'))
const root = `.local-build/artifacts/${version}/${target}`
const names = platforms[target].names(version)
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
const signing = platforms[target].signing
switch (target) {
  case 'macos':
    zip('.local-build/packages/desktop/InkMark.app', names[0])
    break
  case 'linux':
    await copyFile('native/linux/inkmark.apparmor', '.local-build/packages/desktop/InkMark/inkmark.apparmor')
    await copyFile('native/linux/README.md', '.local-build/packages/desktop/InkMark/README.md')
    run('tar', ['-czf', `${root}/${names[0]}`, '-C', '.local-build/packages/desktop', 'InkMark'])
    break
  case 'windows':
    await copyFile('.local-build/packages/desktop/InkMark.zip', `${root}/${names[1]}`)
    await copyFile('.local-build/packages/desktop/InkMark-setup.exe', `${root}/${names[0]}`)
    break
  case 'android':
    await copyFile('native/android/app/build/outputs/apk/debug/app-debug.apk', `${root}/${names[0]}`)
    await copyFile('native/android/app/build/outputs/bundle/release/app-release.aab', `${root}/${names[1]}`)
    break
  case 'ios':
    for (const [configuration, index] of [['Debug-iphonesimulator', 0], ['Release-iphoneos', 1]]) {
      const app = `.local-build/ios/Build/Products/${configuration}/InkMark.app`
      for (const resource of ['nsh/bundle.nshc', 'nsh/app.json', 'nsh/capabilities.json', 'Assets.car']) {
        const file = await stat(`${app}/${resource}`)
        if (!file.isFile() || file.size === 0) throw new Error(`Missing iOS application resource: ${resource}`)
      }
      zip(app, names[index])
    }
    break
  default: throw new Error('Unknown artifact target')
}
const files = await Promise.all((await readdir(root)).filter(name => /\.(zip|gz|apk|aab|exe)$/.test(name)).sort().map(async name => ({
  name, sha256: await hashFile(`${root}/${name}`),
})))
if (files.map(file => file.name).join('\n') !== platforms[target].names(version).sort().join('\n')) throw new Error(`Incomplete ${target} application artifacts`)
await writeFile(`${root}/BUILD.json`, JSON.stringify({version, target, signing, source,
  nsh: {version: toolchain.version, commit: toolchain.commit}, files}, null, 2) + '\n')
await writeFile(`${root}/SHA256SUMS`, checksums(files))
console.log(`Prepared ${files.length} ${target} artifact(s) with checksums and source provenance`)
