import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
const executable = resolve(`.local-build/nsh/sdk/cli/nsh/bin/nsh${process.platform === 'win32' ? '.exe' : ''}`)
const child = spawnSync(executable, process.argv.slice(2), {
  stdio: 'inherit', env: {...process.env, CARGO: 'mbx', RUSTUP_TOOLCHAIN: '1.100.0'},
})
if (child.error) throw new Error(`Run bun run native:setup first: ${child.error.message}`)
process.exit(child.status ?? 1)
