import { MAX_DOCUMENT_IMAGE_BYTES, MAX_DOCUMENT_IMAGES, MAX_TOTAL_DOCUMENT_IMAGE_BYTES } from './DocumentLimits.js'

export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_ASSET_BYTES = 24 * 1024 * 1024
export const MAX_ASSETS = 100
export function isValidBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const payloadLength = value.length - padding
  if (!/^[A-Za-z0-9+/]*$/.test(value.slice(0, payloadLength))) return false
  if (value.slice(payloadLength) !== '='.repeat(padding)) return false
  if (padding === 2 && payloadLength % 4 !== 2) return false
  if (padding === 1 && payloadLength % 4 !== 3) return false
  if (padding) {
    const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(value[payloadLength - 1])
    if (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0) return false
  }
  return true
}

export function base64ByteLength(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(0, value.length / 4 * 3 - padding)
}

export function matchesImageSignature(mime, value) {
  if (typeof value === 'string') {
    if (mime === 'png') return value.startsWith('iVBORw0KGgo')
    if (mime === 'jpeg') return value.startsWith('/9j/')
    return false
  }
  if (!value) return false
  if (mime === 'png') return value.length >= 8 && value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47 && value[4] === 0x0d && value[5] === 0x0a && value[6] === 0x1a && value[7] === 0x0a
  if (mime === 'jpeg') return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff
  return false
}

export function validateDocumentImages(images = []) {
  if (!Array.isArray(images) || images.length > MAX_DOCUMENT_IMAGES) {
    throw Object.assign(new Error(`Danh sách hình ảnh không hợp lệ hoặc vượt quá ${MAX_DOCUMENT_IMAGES} ảnh.`), { status: 400 })
  }
  const names = new Set()
  let totalBytes = 0
  return images.map(image => {
    if (!image || typeof image.filename !== 'string' || !/^image-\d+\.(?:png|jpg)$/.test(image.filename) || names.has(image.filename.toLowerCase()) || !isValidBase64(image.data)) {
      throw Object.assign(new Error('Tệp hình ảnh đính kèm không hợp lệ.'), { status: 400 })
    }
    names.add(image.filename.toLowerCase())
    const byteLength = base64ByteLength(image.data)
    if (!byteLength || byteLength > MAX_DOCUMENT_IMAGE_BYTES) {
      throw Object.assign(new Error('Tệp hình ảnh rỗng hoặc vượt quá giới hạn 450 KB.'), { status: 413 })
    }
    totalBytes += byteLength
    if (totalBytes > MAX_TOTAL_DOCUMENT_IMAGE_BYTES) {
      throw Object.assign(new Error('Tổng dung lượng hình ảnh vượt quá 3,5 MB.'), { status: 413 })
    }
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0))
    const mime = image.filename.endsWith('.png') ? 'png' : 'jpeg'
    if (!matchesImageSignature(mime, bytes)) {
      throw Object.assign(new Error(`Định dạng của ${image.filename} không khớp với dữ liệu ảnh.`), { status: 400 })
    }
    return { filename: image.filename, bytes }
  })
}

const allowed = /\.(tex|bib|bst|sty|cls|png|jpe?g|pdf|eps|csv|txt)$/i
export function safeAssetPath(path) {
  if (typeof path !== 'string' || path.length > 200 || !path || path.includes('\\') || /[\x00-\x1f:<>"|?*]/.test(path)) return false
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false
  return allowed.test(path) && !/(?:^|\/)document\.(tex|pdf)$/i.test(path)
}
export function validateAssets(assets = []) {
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) throw new Error('Tối đa 100 tệp tài nguyên trong mỗi tài liệu.')
  const names = new Set()
  let total = 0
  return assets.map(asset => {
    if (!safeAssetPath(asset?.filename) || names.has(asset.filename.toLowerCase())) throw new Error(`Đường dẫn tài nguyên không hợp lệ hoặc trùng: ${asset?.filename || ''}`)
    if (!isValidBase64(asset.data)) throw new Error('Dữ liệu tài nguyên không hợp lệ.')
    const size = base64ByteLength(asset.data)
    if (size > MAX_ASSET_BYTES || (total += size) > MAX_TOTAL_ASSET_BYTES) throw new Error('Tài nguyên vượt giới hạn 10 MB/tệp hoặc 24 MB/tài liệu.')
    names.add(asset.filename.toLowerCase())
    return { filename: asset.filename, data: asset.data }
  })
}

export function assetBudgetError(assets = [], extraFiles = 0, extraBytes = 0) {
  if (!Array.isArray(assets) || assets.length + extraFiles > MAX_ASSETS) return `Tối đa ${MAX_ASSETS} tệp tài nguyên trong mỗi tài liệu.`
  const total = assets.reduce((sum, asset) => sum + base64ByteLength(asset?.data), extraBytes)
  if (total > MAX_TOTAL_ASSET_BYTES) return 'Tổng dung lượng tài nguyên vượt quá 24 MB.'
  return ''
}

export function validateAssetFileBatch(files, existingAssets = []) {
  if (!Array.isArray(files)) throw new Error('Danh sách tài nguyên không hợp lệ.')
  const existing = validateAssets(existingAssets)
  if (existing.length + files.length > MAX_ASSETS) throw new Error(`Tối đa ${MAX_ASSETS} tệp tài nguyên trong mỗi tài liệu.`)
  const names = new Set(existing.map(asset => asset.filename.toLowerCase()))
  let total = existing.reduce((sum, asset) => sum + base64ByteLength(asset.data), 0)
  for (const file of files) {
    if (!file || !safeAssetPath(file.name) || names.has(file.name.toLowerCase())) throw new Error(`Đường dẫn tài nguyên không hợp lệ hoặc trùng: ${file?.name || ''}`)
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ASSET_BYTES) throw new Error(`${file.name} vượt 10 MB hoặc có kích thước không hợp lệ.`)
    if ((total += file.size) > MAX_TOTAL_ASSET_BYTES) throw new Error('Tổng dung lượng tài nguyên vượt quá 24 MB.')
    names.add(file.name.toLowerCase())
  }
  return true
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
export function base64ToBytes(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)) }
