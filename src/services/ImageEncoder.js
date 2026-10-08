import { MAX_DOCUMENT_IMAGE_BYTES } from './DocumentLimits.js'

const MAX_SOURCE_DIMENSION = 1800
const MAX_ATTEMPTS = 10

export class ImageEncoder {
  constructor({ bitmapFactory = globalThis.createImageBitmap, documentRef = globalThis.document, FileReaderClass = globalThis.FileReader } = {}) {
    this.bitmapFactory = bitmapFactory
    this.documentRef = documentRef
    this.FileReaderClass = FileReaderClass
  }

  async encode(file) {
    if (typeof this.bitmapFactory !== 'function') {
      throw new Error('Trình duyệt này chưa hỗ trợ xử lý hình ảnh.')
    }

    // createImageBitmap is a Window method in browsers and requires its native receiver.
    const bitmap = await this.bitmapFactory.call(globalThis, file)
    try {
      const scale = Math.min(1, MAX_SOURCE_DIMENSION / Math.max(bitmap.width, bitmap.height))
      let width = Math.max(1, Math.round(bitmap.width * scale))
      let height = Math.max(1, Math.round(bitmap.height * scale))
      let mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      let output = null
      const canvas = this.documentRef.createElement('canvas')

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Không thể khởi tạo bộ xử lý hình ảnh.')

        context.clearRect(0, 0, width, height)
        if (mime === 'image/jpeg') {
          context.fillStyle = '#fff'
          context.fillRect(0, 0, width, height)
        }
        context.drawImage(bitmap, 0, 0, width, height)

        const quality = Math.max(0.52, 0.88 - (attempt % 6) * 0.06)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, mime === 'image/jpeg' ? quality : undefined))
        if (!blob) throw new Error('Không thể chuyển đổi hình ảnh.')
        if (blob.size <= MAX_DOCUMENT_IMAGE_BYTES) {
          output = blob
          break
        }

        // Keep transparent PNGs lossless when possible, then fall back to a white-backed JPEG.
        if (mime === 'image/png' && attempt >= 2) mime = 'image/jpeg'

        const shrinkFactor = attempt < 4 ? 0.84 : 0.76
        width = Math.max(1, Math.floor(width * shrinkFactor))
        height = Math.max(1, Math.floor(height * shrinkFactor))
      }

      if (!output) {
        throw new Error('Ảnh vẫn quá lớn sau khi nén. Hãy chọn ảnh nhỏ hơn.')
      }

      return await new Promise((resolve, reject) => {
        const reader = new this.FileReaderClass()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Không đọc được tệp ảnh.'))
        reader.readAsDataURL(output)
      })
    } finally {
      bitmap.close?.()
    }
  }
}
