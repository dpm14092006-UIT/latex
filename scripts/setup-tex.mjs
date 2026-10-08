import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm, access, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') throw new Error('Bộ TeX này dành cho macOS.')
const root = fileURLToPath(new URL('..', import.meta.url))
const directory = join(root, 'tools', 'tex')
const marker = join(directory, 'vietlatex-provenance.json')
const version = 'v2026.10'
const filename = 'TinyTeX-1-darwin-v2026.10.tar.xz'
const sha256 = 'e40c294efae81026d8cc8d12c09d2dd456d268efe7fe092410478bc1973fd40f'
const packages = ['collection-latexrecommended', 'collection-fontsrecommended', 'collection-xetex', 'multirow', 'setspace', 'natbib', 'cite', 'biblatex', 'biblatex-apa', 'biber', 'csquotes', 'ieeetran']
const fontConfig = join(directory, 'texmf-local', 'tex', 'latex', 'vietlatex')
const run = (cmd, args, env = process.env) => new Promise((done, reject) => {
  const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${cmd} thất bại (${code ?? signal}).`)))
})
async function configureFonts() {
  await mkdir(fontConfig, { recursive: true })
  await cp(join(root, 'build', 'fontspec'), fontConfig, { recursive: true })
  await run(join(directory, 'bin', 'universal-darwin', 'mktexlsr'), [])
}
try {
  const previous = JSON.parse(await readFile(marker, 'utf8'))
  if (previous.sha256 === sha256 && JSON.stringify(previous.packages) === JSON.stringify(packages)) {
    await access(join(directory, 'bin', 'universal-darwin', 'xelatex'))
    await configureFonts()
    console.log('Bundled TeX already prepared.')
    process.exit(0)
  }
} catch (error) { if (error.code !== 'ENOENT') throw error }
const staging = await mkdtemp(join(tmpdir(), 'vietlatex-tex-download-'))
try {
  const source = `https://github.com/rstudio/tinytex-releases/releases/download/${version}/${filename}`
  console.log(`Downloading ${filename}`)
  const response = await fetch(source, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Download TeX: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('SHA-256 của TeX không khớp.')
  const archive = join(staging, filename)
  await writeFile(archive, bytes)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  await run('/usr/bin/tar', ['-xf', archive, '-C', directory, '--strip-components=1'])
  const texBin = join(directory, 'bin', 'universal-darwin')
  const env = { ...process.env, PATH: `${texBin}:${process.env.PATH}` }
  await run(join(texBin, 'tlmgr'), ['option', 'repository', 'https://tlnet.yihui.org'], env)
  await run(join(texBin, 'tlmgr'), ['option', 'docfiles', '0'], env)
  await run(join(texBin, 'tlmgr'), ['option', 'srcfiles', '0'], env)
  await run(join(texBin, 'tlmgr'), ['update', '--self'], env)
  await run(join(texBin, 'tlmgr'), ['install', ...packages], env)
  await run(join(texBin, 'fmtutil-sys'), ['--byfmt', 'xelatex'], env)
  await configureFonts()
  await run('/usr/bin/lipo', [join(texBin, 'xetex'), '-verify_arch', 'x86_64', 'arm64'])
  await writeFile(marker, JSON.stringify({ version, source, sha256, packages, preparedAt: new Date().toISOString() }, null, 2) + '\n')
} finally { await rm(staging, { recursive: true, force: true }) }
console.log(`Bundled TeX ready: ${directory}`)
