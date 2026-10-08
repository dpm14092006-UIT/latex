// Playwright uses literal keyboard names; map editor shortcuts to the host OS.
export const primaryKey = process.platform === 'darwin' ? 'Meta' : 'Control'
export const documentStartKey = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'
export const documentEndKey = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
