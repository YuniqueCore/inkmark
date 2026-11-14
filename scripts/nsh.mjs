import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
const executable = resolve(`.local-build/nsh/sdk/cli/nsh/bin/nsh${process.platform === 'win32' ? '.exe' : ''}`)
// Use mbx's official Cargo shim: CARGO=mbx recursively invokes itself for metadata.
const env = {...process.env, RUSTUP_TOOLCHAIN: '1.100.0'}
delete env.CARGO
const child = spawnSync('mise', ['exec', '--', executable, ...process.argv.slice(2)], {
  stdio: 'inherit', env,
})
if (child.error) throw new Error(`Install mise and run bun run native:setup first: ${child.error.message}`)
process.exit(child.status ?? 1)
