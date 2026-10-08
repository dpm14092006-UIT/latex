import { unzip, zip, strToU8, strFromU8 } from 'fflate'
import { sanitizeWorkspace } from './WorkspaceData.js'
import { sanitizeFormulaTemplates, sanitizeDocumentTemplates } from './DocumentData.js'
import { validateAssets, validateDocumentImages, safeAssetPath, bytesToBase64, base64ToBytes, base64ByteLength, MAX_ASSET_BYTES, MAX_TOTAL_ASSET_BYTES, MAX_ASSETS } from './ProjectAssets.js'

const MAX_ARCHIVE = 128 * 1024 * 1024
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
export function zipFiles(files) {
  return new Promise((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)))
}
export async function readZip(file, maxBytes = MAX_TOTAL_ASSET_BYTES) {
  if (file.size > Math.min(MAX_ARCHIVE, maxBytes + 1024 * 1024)) throw new Error('Gói ZIP vượt giới hạn dung lượng.')
  const data = new Uint8Array(await file.arrayBuffer())
  // Inspect central directory sizes before inflation to reject zip bombs, duplicates and encrypted/symlink entries.
  const view = new DataView(data.buffer)
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === data.length) { end = i; break }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('ZIP không hợp lệ hoặc có nhiều phần.')
  const count = view.getUint16(end + 10, true)
  if (count > 300 || count === 65535) throw new Error('ZIP có quá nhiều tệp.')
  let offset = view.getUint32(end + 16, true), total = 0
  const names = new Set(), sizes = new Map()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Mục lục ZIP không hợp lệ.')
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true)
    if (offset + 46 + length + extra + comment > end) throw new Error('ZIP bị cắt ngắn.')
    const name = strFromU8(data.subarray(offset + 46, offset + 46 + length))
    const size = view.getUint32(offset + 24, true)
    if (view.getUint16(offset + 8, true) & 1 || ((view.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP chứa tệp mã hóa hoặc liên kết không được hỗ trợ.')
    if (size > maxBytes || (total += size) > maxBytes || names.has(name.toLowerCase())) throw new Error('ZIP vượt dung lượng giải nén hoặc có tên tệp trùng.')
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.') || name.includes(':') || /[\x00-\x1f]/.test(name)) throw new Error('Đường dẫn ZIP không an toàn.')
    names.add(name.toLowerCase()); sizes.set(name, size); offset += 46 + length + extra + comment
  }
  return new Promise((resolve, reject) => unzip(data, { filter: entry => entry.originalSize <= maxBytes }, (error, files) => {
    if (error) return reject(error)
    if (Object.keys(files).length !== sizes.size || Object.entries(files).some(([name, bytes]) => sizes.get(name) !== bytes.length)) return reject(new Error('Kích thước hoặc danh sách tệp ZIP không khớp.'))
    resolve(files)
  }))
}
export async function exportWorkspace(snapshot) {
  const encoded = strToU8(JSON.stringify({ ...snapshot, format: 'vietlatex-workspace', version: 1, exportedAt: new Date().toISOString() }))
  if (encoded.length > MAX_ARCHIVE) throw new Error('Workspace vượt 128 MB.')
  const archive = await zipFiles({ 'workspace.json': encoded })
  if (archive.length > MAX_ARCHIVE) throw new Error('Gói workspace nén vượt 128 MB.')
  downloadBlob(new Blob([archive], { type: 'application/zip' }), `VietLaTeX-${new Date().toISOString().slice(0, 10)}.vls`)
}
export async function importWorkspace(file) {
  const files = await readZip(file, MAX_ARCHIVE)
  if (!files['workspace.json']) throw new Error('Không tìm thấy workspace.json trong gói sao lưu.')
  const raw = JSON.parse(strFromU8(files['workspace.json']))
  if (raw.format !== 'vietlatex-workspace' || raw.version !== 1) throw new Error('Phiên bản gói sao lưu chưa được hỗ trợ.')
  const workspace = sanitizeWorkspace(raw)
  if (!workspace || workspace.projects.length !== raw.projects.length || workspace.projects.some((p, i) => p.tasks.length !== raw.projects[i].tasks.length)) throw new Error('Gói sao lưu có tài liệu không hợp lệ; chưa nhập để tránh mất nội dung.')
  const importedWorkspace = {
    ...workspace,
    projects: workspace.projects.map(project => ({
      ...project,
      tasks: project.tasks.map(task => ({ ...task, sourceTrusted: false })),
    })),
  }
  return { ...importedWorkspace, customTemplates: sanitizeFormulaTemplates(raw.customTemplates), documentTemplates: sanitizeDocumentTemplates(raw.documentTemplates) }
}
export async function importLatexProject(file) {
  const files = await readZip(file, MAX_TOTAL_ASSET_BYTES + 800 * 1024)
  const sources = Object.keys(files).filter(name => /\.tex$/i.test(name))
  const roots = sources.filter(name => /\\documentclass\b/.test(strFromU8(files[name])))
  const main = roots.length === 1 ? roots[0] : sources.length === 1 ? sources[0] : null
  if (!main) throw new Error('Gói cần có đúng một tệp chính chứa \\documentclass để xác định tài liệu.')
  const prefix = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : ''
  const assets = []
  for (const [path, data] of Object.entries(files)) {
    if (path === main || path.endsWith('/')) continue
    if (!path.startsWith(prefix)) {
      if (safeAssetPath(path)) throw new Error(`Tài nguyên nằm ngoài thư mục của tệp chính: ${path}. Hãy đặt tệp này cùng thư mục hoặc trong thư mục con rồi nén lại.`)
      continue
    }
    const filename = path.slice(prefix.length)
    if (!safeAssetPath(filename)) throw new Error(`Không hỗ trợ tài nguyên: ${filename}`)
    if (data.length > MAX_ASSET_BYTES) throw new Error(`Tệp quá lớn: ${filename}`)
    assets.push({ filename, data: bytesToBase64(data) })
  }
  if (files[main].length > 800 * 1024) throw new Error('Source chính vượt 800 KB.')
  return { latex: strFromU8(files[main]), assets: validateAssets(assets), title: main.split('/').pop().replace(/\.tex$/i, '') }
}
export async function exportLatexProject(latex, images, assets, title) {
  if (typeof latex !== 'string') throw new Error('Source LaTeX không hợp lệ.')
  const source = strToU8(latex)
  if (source.length > 800 * 1024) throw new Error('Source vượt 800 KB.')
  const validatedAssets = validateAssets(assets)
  const validatedImages = validateDocumentImages(images)
  if (validatedAssets.length + validatedImages.length > MAX_ASSETS) throw new Error(`Gói ZIP LaTeX tối đa ${MAX_ASSETS} tệp tài nguyên và ảnh.`)
  const resourceBytes = validatedAssets.reduce((sum, asset) => sum + base64ByteLength(asset.data), 0)
    + validatedImages.reduce((sum, image) => sum + image.bytes.length, 0)
  if (resourceBytes > MAX_TOTAL_ASSET_BYTES) throw new Error('Tổng ảnh và tài nguyên trong gói ZIP LaTeX vượt quá 24 MB.')
  const files = { 'main.tex': source }
  const names = new Set(['main.tex'])
  for (const asset of validatedAssets) {
    const normalizedName = asset.filename.toLowerCase()
    if (names.has(normalizedName)) throw new Error(`Tài nguyên main.tex trùng với source chính: ${asset.filename}`)
    names.add(normalizedName)
    files[asset.filename] = base64ToBytes(asset.data)
  }
  for (const image of validatedImages) {
    const normalizedName = image.filename.toLowerCase()
    if (names.has(normalizedName)) throw new Error(`Tên ảnh trùng tài nguyên: ${image.filename}`)
    names.add(normalizedName)
    files[image.filename] = image.bytes
  }
  const data = await zipFiles(files)
  downloadBlob(new Blob([data], { type: 'application/zip' }), `${String(title || 'tai-lieu').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')}-latex.zip`)
}
