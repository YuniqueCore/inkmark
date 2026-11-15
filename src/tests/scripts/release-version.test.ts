import {test, expect} from 'vitest'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

test('a product release advances the mobile install counter; ordinary verified rebuilds retain it and downgrade is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkmark-release-version-'))
  const script = fileURLToPath(new URL('../../../scripts/release-version.ts', import.meta.url))
  const run = (command: string, args: string[]) => spawnSync(command, args, {cwd: root, encoding: 'utf8'})
  const git = (...args: string[]) => {
    const result = run('git', args)
    expect(result.status, result.stderr).toBe(0)
  }
  const metadata = async (version: string, build: number) => {
    await writeFile(join(root, 'package.json'), JSON.stringify({version}))
    await writeFile(join(root, 'native/product.json'), JSON.stringify({name: 'InkMark', id: 'test.inkmark', build}))
  }
  const check = () => run(process.execPath, [script, 'check'])
  try {
    await mkdir(join(root, 'native'))
    await metadata('0.13.1', 14)
    git('init', '-q'); git('add', '.')
    git('-c', 'user.name=Release Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
    git('tag', 'v0.13.1')
    expect(check().status).toBe(0)
    await metadata('0.13.2', 14)
    expect(check().stderr).toContain('larger native build number')
    await metadata('0.13.2', 15)
    expect(check().status).toBe(0)
    await metadata('0.13.0', 16)
    expect(check().stderr).toContain('must not precede')
    await metadata('0.13.1', 13)
    expect(check().stderr).toContain('larger native build number')
    await metadata('0.13.2', 2_100_000_001)
    expect(check().status).not.toBe(0)
  } finally { await rm(root, {recursive: true, force: true}) }
})
