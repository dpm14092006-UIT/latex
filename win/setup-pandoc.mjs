// Downloads the official Windows x64 Pandoc into tools/pandoc and checks the
// SHA-256 digest GitHub publishes for the release asset.
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const root = fileURLToPath(new URL('..', import.meta.url))
const version = process.env.PANDOC_VERSION || '3.11'
if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error('Phiên bản Pandoc không hợp lệ.')
const headers = { 'User-Agent': 'VietLaTeX-Studio-setup', Accept: 'application/vnd.github+json' }
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
if (token) headers.Authorization = `Bearer ${token}`
const response = await fetch(`https://api.github.com/repos/jgm/pandoc/releases/tags/${version}`, { headers, signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`GitHub: ${response.status}`)
const asset = (await response.json()).assets.find(item => /windows-x86_64\.zip$/.test(item.name))
if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('Không có gói Pandoc Windows với SHA-256 được công bố.')
console.log(`Downloading ${asset.name}`)
const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180_000) })
if (!download.ok) throw new Error(`Download: ${download.status}`)
const bytes = new Uint8Array(await download.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (`sha256:${sha256}` !== asset.digest) throw new Error('SHA-256 không khớp; dừng cài đặt.')
const files = unzipSync(bytes)
const executable = Object.keys(files).find(name => /(?:^|\/)pandoc\.exe$/i.test(name))
if (!executable) throw new Error('Gói không chứa pandoc.exe')
const directory = join(root, 'tools', 'pandoc')
await mkdir(directory, { recursive: true })
await writeFile(join(directory, 'pandoc.exe'), files[executable])
for (const [name, data] of Object.entries(files)) {
  if (/copyright|copying|license/i.test(name) && !name.endsWith('/')) await writeFile(join(directory, name.split('/').pop()), data)
}
await writeFile(join(directory, 'provenance.json'), JSON.stringify({ version, source: asset.browser_download_url, sha256 }, null, 2) + '\n')
console.log(`Pandoc ready: ${directory}`)
