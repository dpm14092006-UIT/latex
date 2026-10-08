import { mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { resolve } from 'node:path'

if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Cài Pandoc từ pandoc.org/installing.html hoặc đặt PANDOC_PATH đến bản đã cài.')
const version = process.env.PANDOC_VERSION || '3.11'
if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error('Phiên bản Pandoc không hợp lệ.')
const response = await fetch(`https://api.github.com/repos/jgm/pandoc/releases/tags/${version}`, { headers: { 'User-Agent': 'VietLaTeX-Studio-setup' } })
if (!response.ok) throw new Error(`GitHub: ${response.status}`)
const release = await response.json()
const directory = resolve('tools/pandoc')
await mkdir(directory, { recursive: true })
const provenance = []
async function installAsset(pattern, output) {
const asset = release.assets.find(asset => pattern.test(asset.name))
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('Không có gói với SHA-256 được công bố.')
console.log(`Downloading ${asset.name}`)
const download = await fetch(asset.browser_download_url)
if (!download.ok) throw new Error(`Download: ${download.status}`)
const bytes = new Uint8Array(await download.arrayBuffer())
const digest = createHash('sha256').update(bytes).digest('hex')
if (`sha256:${digest}` !== asset.digest) throw new Error('SHA-256 không khớp; dừng cài đặt.')
const files = unzipSync(bytes)
const executable = Object.keys(files).find(name => /(?:^|\/)pandoc(?:\.exe)?$/.test(name))
if (!executable) throw new Error('Gói không chứa Pandoc')
await writeFile(resolve(directory, output), files[executable])
provenance.push({ version: release.tag_name, source: asset.browser_download_url, sha256: digest })
for (const [name, data] of Object.entries(files)) if (/copyright|copying|license/i.test(name)) await writeFile(resolve(directory, name.split('/').pop()), data)
}
if (process.platform === 'win32') await installAsset(/windows-x86_64\.zip$/, 'pandoc.exe')
else {
  await installAsset(/arm64-macOS\.zip$/, 'pandoc-arm64')
  await installAsset(/x86_64-macOS\.zip$/, 'pandoc-x64')
  await promisify(execFile)('lipo', ['-create', resolve(directory, 'pandoc-arm64'), resolve(directory, 'pandoc-x64'), '-output', resolve(directory, 'pandoc')])
  await chmod(resolve(directory, 'pandoc'), 0o755)
  await Promise.all(['pandoc-arm64', 'pandoc-x64', 'pandoc.exe'].map(name => rm(resolve(directory, name), { force: true })))
}
await writeFile(resolve(directory, 'provenance.json'), JSON.stringify(provenance, null, 2))
console.log(`Pandoc ready: ${directory}`)
