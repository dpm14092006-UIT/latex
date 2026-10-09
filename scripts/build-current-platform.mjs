// `npm run desktop:build` builds the installer for the machine it runs on.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = { darwin: 'mac/build-mac.mjs', win32: 'win/build-win.mjs' }[process.platform]
if (!script) throw new Error('Chỉ hỗ trợ build trên macOS hoặc Windows.')
const child = spawn(process.execPath, [join(root, script), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
child.once('exit', code => { process.exitCode = code ?? 1 })
