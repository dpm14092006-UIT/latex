export const MAX_DOCUMENT_IMAGES = 8
export const MAX_DOCUMENT_IMAGE_BYTES = 450 * 1024
export const MAX_TOTAL_DOCUMENT_IMAGE_BYTES = 3_500 * 1024
export const MAX_WORD_DOCUMENT_BYTES = 25 * 1024 * 1024
export const MAX_WORD_IMAGE_BYTES = 24 * 1024 * 1024
export const MAX_LATEX_SOURCE_BYTES = 800 * 1024

// Allow an oversized legacy/generated source to be reduced without truncating it.
export function acceptsSourceEdit(previous, next) {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(next).length
  return bytes <= MAX_LATEX_SOURCE_BYTES || bytes < encoder.encode(previous).length
}
