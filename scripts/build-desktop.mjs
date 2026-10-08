import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export async function buildDesktop() {
  for (const args of [
    [join(root, 'scripts/build-backend.mjs')],
    [join(root, 'node_modules/vite/bin/vite.js'), 'build'],
  ]) {
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root, env: { ...process.env, BUILD_DESKTOP_APP: 'true' },
        stdio: 'inherit',
      })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? done() : reject(new Error(`Desktop build failed (${code})`)))
    })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop()
}
