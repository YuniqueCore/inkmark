import {test, expect} from 'vitest'
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'

test('artifact delivery binds exact bytes to a clean commit and rejects unsafe or dirty rebuilds without deleting outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkmark-artifact-'))
  const script = fileURLToPath(new URL('../../../scripts/native-artifact.mjs', import.meta.url))
  const run = (command: string, args: string[]) => spawnSync(command, args, {cwd: root, encoding: 'utf8', env: {...process.env, CI: 'true'}})
  const git = (...args: string[]) => {
    const result = run('git', args)
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  try {
    await mkdir(join(root, 'native'))
    await writeFile(join(root, 'package.json'), JSON.stringify({version: '1.2.3'}))
    await writeFile(join(root, 'native/toolchain.json'), JSON.stringify({version: 'test', commit: 'fixture'}))
    await writeFile(join(root, '.gitignore'), '.local-build/\n')
    git('init', '-q'); git('add', '.')
    git('-c', 'user.name=Artifact Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
    const source = git('rev-parse', 'HEAD')
    await mkdir(join(root, '.local-build/packages/desktop'), {recursive: true})
    const bytes = Buffer.from([80, 75, 0, 255, 42])
    await writeFile(join(root, '.local-build/packages/desktop/InkMark.zip'), bytes)
    const delivered = run(process.execPath, [script, 'windows'])
    expect(delivered.status, delivered.stderr).toBe(0)
    const output = join(root, '.local-build/artifacts/1.2.3/windows')
    const build = JSON.parse(await readFile(join(output, 'BUILD.json'), 'utf8'))
    expect(build.source).toEqual({commit: source, dirty: false})
    expect(build.files).toHaveLength(1)
    const file = build.files[0]
    expect(await readFile(join(output, file.name))).toEqual(bytes)
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(await readFile(join(output, 'SHA256SUMS'), 'utf8')).toBe(`${file.sha256}  ${file.name}\n`)

    await writeFile(join(root, 'review-draft.md'), 'uncommitted source')
    const dirty = run(process.execPath, [script, 'windows'])
    expect(dirty.status).not.toBe(0)
    expect(dirty.stderr).toContain('Build changed the checkout')
    expect(await readFile(join(output, file.name))).toEqual(bytes)

    const sentinel = join(root, '.local-build/sentinel')
    await mkdir(sentinel)
    await writeFile(join(sentinel, 'keep'), 'retained')
    const traversal = run(process.execPath, [script, '../../sentinel'])
    expect(traversal.status).not.toBe(0)
    expect(traversal.stderr).toContain('Unknown artifact target')
    expect(await readFile(join(sentinel, 'keep'), 'utf8')).toBe('retained')
  } finally { await rm(root, {recursive: true, force: true}) }
})
