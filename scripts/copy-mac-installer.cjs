const { copyFile, mkdir, readdir, stat, writeFile, rename, rm } = require('node:fs/promises')
const { createReadStream } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const config = require('../electron-builder.config.cjs')
const { join } = require('node:path')
const pkg = require('../package.json')

async function main() {
  const buildDirectory = config.directories.output
  const images = (await readdir(buildDirectory)).filter(name => name === `Viet-Latex-Studio-${pkg.version}-universal.dmg`)
  if (images.length !== 1) throw new Error(`Cần đúng một bộ cài DMG universal, tìm thấy ${images.length}.`)

  const output = join(__dirname, '..', 'release-desktop')
  const filename = `Viet-Latex-Studio-${pkg.version}-universal.dmg`
  await mkdir(output, { recursive: true })
  const temporary = join(output, `.${filename}.${process.pid}.tmp`)
  try {
    await copyFile(join(buildDirectory, images[0]), temporary)
    await rename(temporary, join(output, filename))
  } finally { await rm(temporary, { force: true }) }
  const artifacts = []
  for (const name of [filename, `Viet-Latex-Studio-${pkg.version}-Mac-Build-Source.zip`]) {
    const path = join(output, name)
    let info
    try { info = await stat(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    const sha256 = hash.digest('hex')
    await writeFile(`${path}.sha256`, `${sha256}  ${name}\n`)
    artifacts.push({ filename: name, bytes: info.size, sha256 })
  }
  let sourceCommit = null, sourceWorkingTreeChanged = null
  try {
    const cwd = join(__dirname, '..')
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
    sourceWorkingTreeChanged = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim())
  } catch { /* A source ZIP can be built without a Git checkout. */ }
  await writeFile(join(output, 'manifest.json'), JSON.stringify({
    version: pkg.version, sourceCommit, sourceWorkingTreeChanged,
    platform: 'macOS', minimumSystemVersion: pkg.build.mac.minimumSystemVersion,
    architectures: ['arm64', 'x86_64'], generatedAt: new Date().toISOString(), artifacts,
  }, null, 2) + '\n')
  console.log(`Bộ cài macOS được sao chép đến ${join(output, filename)}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
