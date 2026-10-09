// Copies the NSIS installer to release-desktop/win with a SHA-256 file (read by
// electron/updater.cjs) and a manifest.
const { copyFile, mkdir, rename, rm, stat, writeFile } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const config = require('./electron-builder.config.cjs')
const pkg = require('../package.json')

async function main() {
  const filename = `Viet-Latex-Studio-${pkg.version}-Setup.exe`
  const output = join(__dirname, '..', 'release-desktop', 'win')
  await mkdir(output, { recursive: true })
  const temporary = join(output, `.${filename}.${process.pid}.tmp`)
  try {
    await copyFile(join(config.directories.output, filename), temporary)
    await rename(temporary, join(output, filename))
  } finally { await rm(temporary, { force: true }) }
  const path = join(output, filename)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  await writeFile(`${path}.sha256`, `${sha256}  ${filename}\n`)
  let sourceCommit = null
  try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(__dirname, '..'), encoding: 'utf8' }).trim() } catch { /* built outside a Git checkout */ }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({
    version: pkg.version, sourceCommit, platform: 'Windows', architectures: ['x64'], generatedAt: new Date().toISOString(),
    artifacts: [{ filename, bytes: (await stat(path)).size, sha256 }],
  }, null, 2) + '\n')
  console.log(`Bộ cài Windows: ${path}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
