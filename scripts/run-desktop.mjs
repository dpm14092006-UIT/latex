import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { buildDesktop } from './build-desktop.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
// Rebuild before every launch so source changes cannot leave the user on an old renderer.
await buildDesktop()
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(require('electron'), ['.', '--built-renderer'], {
  cwd: root, env, detached: true, stdio: 'ignore',
})
await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject) })
child.unref()
