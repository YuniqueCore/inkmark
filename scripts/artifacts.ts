/** The delivery contract shared by platform packagers and GitHub Releases. */
import * as v from 'valibot'
import {valid} from 'semver'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'

export const nativeTargets = ['macos', 'linux', 'windows', 'android', 'ios'] as const
export type NativeTarget = typeof nativeTargets[number]

export const platforms: Record<NativeTarget, {artifact: string; signing: string; names: (version: string) => string[]}> = {
  macos: {
    artifact: 'InkMark-macos-arm64', signing: 'ad-hoc; not notarized',
    names: version => [`InkMark-${version}-macos-arm64.zip`],
  },
  linux: {
    artifact: 'InkMark-linux-x86_64', signing: 'unsigned',
    names: version => [`InkMark-${version}-linux-x64.tar.gz`],
  },
  windows: {
    artifact: 'InkMark-windows-x86_64', signing: 'unsigned',
    names: version => [`InkMark-${version}-windows-x64-setup.exe`, `InkMark-${version}-windows-x64.zip`],
  },
  android: {
    artifact: 'InkMark-android', signing: 'APK: Android debug key; AAB: unsigned, requires release signing',
    names: version => [`InkMark-${version}-android-debug.apk`, `InkMark-${version}-android-unsigned.aab`],
  },
  ios: {
    artifact: 'InkMark-ios-arm64', signing: 'unsigned; device installation requires an Apple identity and provisioning profile',
    names: version => [`InkMark-${version}-ios-arm64-simulator.zip`, `InkMark-${version}-ios-arm64-unsigned.zip`],
  },
}

export const commitSchema = v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/))
export const versionSchema = v.pipe(v.string(), v.check(value => valid(value) === value, 'Expected a canonical semantic version'))
export const buildManifestSchema = v.strictObject({
  version: versionSchema,
  target: v.picklist(nativeTargets),
  signing: v.string(),
  source: v.strictObject({commit: commitSchema, dirty: v.boolean()}),
  nsh: v.strictObject({version: versionSchema, commit: commitSchema}),
  files: v.array(v.strictObject({name: v.string(), sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/))})),
})
export type BuildManifest = v.InferOutput<typeof buildManifestSchema>

export function checksums(files: BuildManifest['files']): string {
  return [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(file => `${file.sha256}  ${file.name}`).join('\n') + '\n'
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}
