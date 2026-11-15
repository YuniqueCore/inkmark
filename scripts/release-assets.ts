/** Local verification only: no GitHub access, publishing, or rebuilding. */
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import * as v from 'valibot'
import {buildManifestSchema, checksums, hashFile, nativeTargets, platforms} from './artifacts.ts'
import type {BuildManifest} from './artifacts.ts'

export interface ReleaseSource {
  version: string
  commit: string
  build: number
  nsh: BuildManifest['nsh']
  run: string
}
export interface ReleaseAsset {name: string; path: string; sha256: string}

async function exactDirectory(path: string, expected: string[]): Promise<void> {
  const entries = await readdir(path, {withFileTypes: true})
  if (entries.some(entry => entry.isSymbolicLink()) || entries.map(entry => entry.name).sort().join('\n') !== [...expected].sort().join('\n')) {
    throw new Error(`Unexpected or missing artifact entries: ${path}`)
  }
}

export async function collectReleaseAssets(root: string, output: string, source: ReleaseSource): Promise<ReleaseAsset[]> {
  await exactDirectory(root, nativeTargets.map(target => platforms[target].artifact))
  const assets: ReleaseAsset[] = []
  const manifests: BuildManifest[] = []
  for (const target of nativeTargets) {
    const spec = platforms[target]
    const container = join(root, spec.artifact)
    await exactDirectory(container, [source.version])
    await exactDirectory(join(container, source.version), [target])
    const directory = join(container, source.version, target)
    const names = spec.names(source.version)
    await exactDirectory(directory, [...names, 'BUILD.json', 'SHA256SUMS'])
    const manifest = v.parse(buildManifestSchema, JSON.parse(await readFile(join(directory, 'BUILD.json'), 'utf8')))
    if (manifest.target !== target || manifest.version !== source.version || manifest.source.commit !== source.commit || manifest.source.dirty
        || manifest.nsh.version !== source.nsh.version || manifest.nsh.commit !== source.nsh.commit || manifest.signing !== spec.signing) {
      throw new Error(`Artifact provenance does not match release source: ${target}`)
    }
    if (manifest.files.map(file => file.name).sort().join('\n') !== names.sort().join('\n')) {
      throw new Error(`Incomplete or unsafe file manifest: ${target}`)
    }
    if (await readFile(join(directory, 'SHA256SUMS'), 'utf8') !== checksums(manifest.files)) {
      throw new Error(`Checksum index does not match manifest: ${target}`)
    }
    for (const file of manifest.files) {
      const path = join(directory, file.name)
      if (await hashFile(path) !== file.sha256) throw new Error(`Artifact checksum mismatch: ${file.name}`)
      assets.push({...file, path})
    }
    manifests.push(manifest)
  }
  await mkdir(output, {recursive: true})
  const index = {
    version: source.version, build: source.build,
    source: {commit: source.commit, dirty: false}, nsh: source.nsh, run: source.run,
    platforms: manifests.map(({target, signing, files}) => ({target, signing, files})),
  }
  await writeFile(join(output, 'BUILD.json'), JSON.stringify(index, null, 2) + '\n')
  assets.push({name: 'BUILD.json', path: join(output, 'BUILD.json'), sha256: await hashFile(join(output, 'BUILD.json'))})
  await writeFile(join(output, 'SHA256SUMS'), checksums(assets))
  assets.push({name: 'SHA256SUMS', path: join(output, 'SHA256SUMS'), sha256: await hashFile(join(output, 'SHA256SUMS'))})
  return assets
}

/** Uploaded assets are immutable; only empty failed-upload placeholders in drafts are disposable. */
export function planReleaseAssets(local: ReleaseAsset[], remote: {id: number; name: string; digest: string | null; state: string; size: number}[], state: 'draft' | 'published'): {upload: ReleaseAsset[]; discard: number[]} {
  const expected = new Map(local.map(asset => [asset.name, asset]))
  const seen = new Set<string>()
  const uploaded = new Set<string>()
  const discard: number[] = []
  for (const asset of remote) {
    const file = expected.get(asset.name)
    if (!file || seen.has(asset.name)) throw new Error(`Unexpected or duplicate remote asset: ${asset.name}`)
    seen.add(asset.name)
    if (state === 'draft' && asset.state === 'starter' && asset.size === 0 && asset.digest === null) discard.push(asset.id)
    else {
      if (asset.state !== 'uploaded' || asset.digest !== `sha256:${file.sha256}`) throw new Error(`Remote asset checksum/state mismatch: ${asset.name}`)
      uploaded.add(asset.name)
    }
  }
  return {upload: local.filter(asset => !uploaded.has(asset.name)), discard}
}
