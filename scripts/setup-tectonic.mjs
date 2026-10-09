import { mkdir, mkdtemp, writeFile, chmod, rm, copyFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Tectonic is the fallback engine for Macs without MacTeX: one binary that
// fetches TeX Live files on demand. The DMG ships a universal copy.
if (process.platform !== 'darwin') throw new Error('Tectonic chỉ được đóng gói vào bản Mac; trên Windows dùng MiKTeX hoặc TeX Live.')
const version = process.env.TECTONIC_VERSION || '0.17.0'
if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error('Phiên bản Tectonic không hợp lệ.')
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const headers = { 'User-Agent': 'VietLaTeX-Studio-setup', Accept: 'application/vnd.github+json' }
if (githubToken) headers.Authorization = `Bearer ${githubToken}`
const response = await fetch(`https://api.github.com/repos/tectonic-typesetting/tectonic/releases/tags/tectonic%40${version}`, { headers, signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`GitHub: ${response.status}`)
const release = await response.json()
const directory = resolve('tools/tectonic')
const scratch = await mkdtemp(join(tmpdir(), 'vietlatex-tectonic-'))
await mkdir(directory, { recursive: true })
const provenance = []
const run = promisify(execFile)

async function installAsset(pattern, output) {
  const asset = release.assets.find(asset => pattern.test(asset.name))
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('Không có gói Tectonic với SHA-256 được công bố.')
  console.log(`Downloading ${asset.name}`)
  const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180_000) })
  if (!download.ok) throw new Error(`Download: ${download.status}`)
  const bytes = new Uint8Array(await download.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (`sha256:${digest}` !== asset.digest) throw new Error('SHA-256 không khớp; dừng cài đặt.')
  const archive = join(scratch, asset.name)
  const unpacked = join(scratch, output)
  await writeFile(archive, bytes)
  await mkdir(unpacked)
  await run('/usr/bin/tar', ['-xzf', archive, '-C', unpacked])
  await copyFile(join(unpacked, 'tectonic'), join(scratch, `${output}.bin`))
  provenance.push({ version: release.tag_name, source: asset.browser_download_url, sha256: digest })
  return join(scratch, `${output}.bin`)
}

try {
  const arm64 = await installAsset(/-aarch64-apple-darwin\.tar\.gz$/, 'arm64')
  const x64 = await installAsset(/-x86_64-apple-darwin\.tar\.gz$/, 'x64')
  await run('/usr/bin/lipo', ['-create', arm64, x64, '-output', join(directory, 'tectonic')])
  await chmod(join(directory, 'tectonic'), 0o755)
  await writeFile(join(directory, 'LICENSE.txt'), 'Tectonic is licensed under the MIT License.\nhttps://github.com/tectonic-typesetting/tectonic/blob/master/LICENSE\n')
  await writeFile(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2))
} finally {
  await rm(scratch, { recursive: true, force: true })
}
console.log(`Tectonic ready: ${directory}`)
