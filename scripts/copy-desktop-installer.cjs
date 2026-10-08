const { copyFile, cp, mkdir, readFile, writeFile, rm } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const { join, resolve, relative, isAbsolute } = require('node:path')
const { extractFile } = require('@electron/asar')
const pkg = require('../package.json')

async function main() {
  const filename = `Viet-Latex-Studio-${pkg.version}-Setup.exe`
  const source = join(tmpdir(), `VietLatexDesktopBuild-${pkg.version}`, filename)
  const output = join(__dirname, '..', 'release-desktop')
  await mkdir(output, { recursive: true })
  const appDirectory = join(output, `VietLatex-Studio-${pkg.version}`)
  const appSource = join(tmpdir(), `VietLatexDesktopBuild-${pkg.version}`, 'win-unpacked')
  const packaged = JSON.parse(extractFile(join(appSource, 'resources', 'app.asar'), 'package.json'))
  if (packaged.version !== pkg.version) throw new Error('Packaged app version does not match source version')
  const target = resolve(appDirectory)
  const inside = relative(resolve(output), target)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('App copy target is outside release-desktop')
  // Remove the previous copy of this version so deleted source files cannot survive the update.
  await rm(target, { recursive: true, force: true })
  await cp(appSource, target, { recursive: true, force: true })
  const asarSha256 = createHash('sha256').update(await readFile(join(target, 'resources', 'app.asar'))).digest('hex')
  await writeFile(join(target, 'release-manifest.json'), JSON.stringify({ version: pkg.version, asarSha256 }, null, 2) + '\n')
  console.log(`Full app copied to ${appDirectory}`)
  if (process.argv.includes('--app-only')) return
  await copyFile(source, join(output, filename))
  const checksum = createHash('sha256').update(await readFile(join(output, filename))).digest('hex')
  await writeFile(join(output, `${filename}.sha256`), `${checksum}  ${filename}\n`)
  console.log(`Installer copied to ${join(output, filename)}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
