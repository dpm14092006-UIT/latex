import { lstat, rename } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

export function applicationRecoveryPaths({ installed, backup, stamp, sameDevice }) {
  const archivedPrevious = join(backup, 'previous.app')
  if (sameDevice) return { previous: archivedPrevious, rejected: join(backup, 'rejected.app'), archivedPrevious, archiveCopyRequired: false }
  const name = basename(installed).replace(/\.app$/u, '')
  return {
    previous: join(dirname(installed), `.${name}-previous-${stamp}.app`),
    rejected: join(dirname(installed), `.${name}-rejected-${stamp}.app`),
    archivedPrevious, archiveCopyRequired: true,
  }
}

async function absent(path) {
  try { await lstat(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  throw new Error(`Đường dẫn khôi phục đã tồn tại; giữ nguyên để tránh ghi đè: ${path}`)
}

// The old bundle stays recoverable until the replacement passes verification.
// This helper never touches the workspace or launches either application.
export async function replaceApplication({ installed, staged, previous, rejected, verify }) {
  if (typeof verify !== 'function') throw new TypeError('Cần xác minh bản ứng dụng mới trước khi hoàn tất thay thế.')
  const paths = [installed, staged, previous, rejected].map(path => resolve(path))
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (paths[i] === paths[j] || paths[i].startsWith(paths[j] + sep) || paths[j].startsWith(paths[i] + sep)) {
      throw new Error('Đường dẫn ứng dụng, bản tạm và bản khôi phục phải tách biệt.')
    }
  }
  for (const path of [installed, staged]) {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Ứng dụng phải là thư mục thật: ${path}`)
  }
  await absent(previous)
  await absent(rejected)
  await rename(installed, previous)
  let replaced = false
  try {
    await rename(staged, installed)
    replaced = true
    await verify(installed)
  } catch (error) {
    try {
      if (replaced) await rename(installed, rejected)
      await rename(previous, installed)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Cập nhật thất bại và chưa khôi phục được app. Giữ bản cũ tại ${previous}; bản mới tại ${rejected}.`, { cause: rollbackError })
    }
    throw new Error(`Cập nhật thất bại; đã khôi phục ứng dụng cũ. ${error.message}`, { cause: error })
  }
}
