import {test, expect} from 'vitest'
import {mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {checksums, hashFile, nativeTargets, platforms} from '../../../scripts/artifacts.ts'
import type {BuildManifest} from '../../../scripts/artifacts.ts'
import {collectReleaseAssets, planReleaseAssets} from '../../../scripts/release-assets.ts'

test('five platform deliveries form one verifiable release; repair preserves exact assets and refuses mixed, partial or modified inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkmark-release-'))
  const input = join(root, 'inputs')
  const output = join(root, 'release')
  const source = {version: '1.2.3', build: 7, commit: 'a'.repeat(40), nsh: {version: '0.5.1', commit: 'b'.repeat(40)}, run: 'https://github.com/example/inkmark/actions/runs/123'}
  const collect = () => collectReleaseAssets(input, output, source)
  try {
    for (const target of nativeTargets) {
      const spec = platforms[target]
      const directory = join(input, spec.artifact, source.version, target)
      await mkdir(directory, {recursive: true})
      const manifest: BuildManifest = {version: source.version, target, source: {commit: source.commit, dirty: false}, nsh: source.nsh, signing: spec.signing, files: []}
      for (const name of spec.names(source.version)) {
        await writeFile(join(directory, name), Buffer.from(`fixture ${name}\x00\xff`))
        manifest.files.push({name, sha256: await hashFile(join(directory, name))})
      }
      await writeFile(join(directory, 'BUILD.json'), JSON.stringify(manifest))
      await writeFile(join(directory, 'SHA256SUMS'), checksums(manifest.files))
    }
    const assets = await collect()
    expect(assets).toHaveLength(10)
    const index = JSON.parse(await readFile(join(output, 'BUILD.json'), 'utf8'))
    expect(index).toMatchSnapshot()
    expect(await readFile(join(output, 'SHA256SUMS'), 'utf8')).toBe(checksums(assets.filter(asset => asset.name !== 'SHA256SUMS')))
    const partial = assets.slice(0, 4).map((asset, id) => ({id, size: 100, name: asset.name, state: 'uploaded', digest: `sha256:${asset.sha256}`}))
    expect(planReleaseAssets(assets, partial, 'draft')).toEqual({upload: assets.slice(4), discard: []})
    expect(planReleaseAssets(assets, assets.map((asset, id) => ({id, size: 100, name: asset.name, state: 'uploaded', digest: `sha256:${asset.sha256}`})), 'published')).toEqual({upload: [], discard: []})
    expect(() => planReleaseAssets(assets, [...partial, partial[0]!], 'draft')).toThrow('duplicate')
    expect(() => planReleaseAssets(assets, [{...partial[0]!, digest: `sha256:${'0'.repeat(64)}`}], 'draft')).toThrow('checksum')
    expect(() => planReleaseAssets(assets, [{...partial[0]!, state: 'starter'}], 'draft')).toThrow('state')
    expect(() => planReleaseAssets(assets, [{id: 9, size: 0, name: '.env', state: 'uploaded', digest: null}], 'draft')).toThrow('Unexpected')

    const placeholder = {...partial[0]!, state: 'starter', size: 0, digest: null}
    expect(planReleaseAssets(assets, [placeholder, ...partial.slice(1)], 'draft')).toEqual({upload: [assets[0], ...assets.slice(4)], discard: [placeholder.id]})
    expect(() => planReleaseAssets(assets, [placeholder], 'published')).toThrow('state')
    expect(() => planReleaseAssets(assets, [{...placeholder, size: 100}], 'draft')).toThrow('Unfinished draft upload')

    const windows = join(input, platforms.windows.artifact, source.version, 'windows')
    const metadata = join(windows, 'BUILD.json')
    const original = await readFile(metadata, 'utf8')
    for (const change of [
      {source: {commit: source.commit, dirty: true}},
      {source: {commit: 'c'.repeat(40), dirty: false}},
      {version: '1.2.4'}, {target: 'linux'}, {signing: 'signed'},
      {nsh: {...source.nsh, version: '0.5.2'}},
    ]) {
      await writeFile(metadata, JSON.stringify({...JSON.parse(original), ...change}))
      await expect(collect()).rejects.toThrow('provenance')
    }
    await writeFile(metadata, JSON.stringify({...JSON.parse(original), files: [{name: '../.env', sha256: 'a'.repeat(64)}]}))
    await expect(collect()).rejects.toThrow('unsafe')
    await writeFile(metadata, original)
    await writeFile(join(windows, '.env'), 'fixture only, never delivered')
    await expect(collect()).rejects.toThrow('Unexpected')
    await rm(join(windows, '.env'))
    const installer = join(windows, platforms.windows.names(source.version)[0]!)
    const bytes = await readFile(installer)
    await writeFile(installer, 'modified after packaging')
    await expect(collect()).rejects.toThrow('checksum mismatch')
    await rm(installer)
    await expect(collect()).rejects.toThrow('missing artifact')
    await writeFile(installer, bytes)
    await rename(installer, join(root, 'outside'))
    await symlink(join(root, 'outside'), installer)
    await expect(collect()).rejects.toThrow('Unexpected')
    await rm(installer)
    await rename(join(root, 'outside'), installer)
    expect((await collect()).map(({name, sha256}) => ({name, sha256}))).toEqual(assets.map(({name, sha256}) => ({name, sha256})))
  } finally { await rm(root, {recursive: true, force: true}) }
})
