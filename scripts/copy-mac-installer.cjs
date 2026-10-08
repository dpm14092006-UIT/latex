const { copyFile, mkdir, readdir, readFile, writeFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const pkg = require('../package.json')

async function main() {
  const buildDirectory = join(tmpdir(), `VietLatexDesktopBuild-${pkg.version}`)
  const images = (await readdir(buildDirectory)).filter(name => name.endsWith('.dmg'))
  if (images.length !== 1) throw new Error(`Cần đúng một bộ cài DMG universal, tìm thấy ${images.length}.`)

  const output = join(__dirname, '..', 'release-desktop')
  const filename = `Viet-Latex-Studio-${pkg.version}-universal.dmg`
  await mkdir(output, { recursive: true })
  await copyFile(join(buildDirectory, images[0]), join(output, filename))
  const digest = createHash('sha256').update(await readFile(join(output, filename))).digest('hex')
  await writeFile(join(output, `${filename}.sha256`), `${digest}  ${filename}\n`)
  console.log(`Bộ cài macOS được sao chép đến ${join(output, filename)}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
