// Bumps the app version everywhere the build reads it, then optionally commits and tags.
//   node scripts/bump-version.mjs patch|minor|major|X.Y.Z [--commit] [--dry-run]
// Pushing the resulting vX.Y.Z tag runs .github/workflows/release.yml, which publishes
// the DMG that installed apps pick up through electron/updater.cjs.
import { execFileSync } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function nextVersion(current, request) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)?.slice(1).map(Number)
  if (!parts) throw new Error(`Phiên bản hiện tại không hợp lệ: ${current}`)
  const [major, minor, patch] = parts
  if (request === 'major') return `${major + 1}.0.0`
  if (request === 'minor') return `${major}.${minor + 1}.0`
  if (request === 'patch') return `${major}.${minor}.${patch + 1}`
  const explicit = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(request ?? '')?.slice(1).map(Number)
  if (!explicit) throw new Error('Dùng: bump-version.mjs patch|minor|major|X.Y.Z [--commit] [--dry-run]')
  const [a, b, c] = explicit
  if (a < major || (a === major && (b < minor || (b === minor && c <= patch)))) throw new Error(`Phiên bản mới ${explicit.join('.')} phải lớn hơn ${current}.`)
  return explicit.join('.')
}

// Only the root entries of the lockfile carry the app version; dependencies may share the number.
export function applyVersion(pkgText, lockText, version) {
  const pkg = JSON.parse(pkgText)
  pkg.version = version
  const lock = lockText ? JSON.parse(lockText) : null
  if (lock) {
    lock.version = version
    if (lock.packages?.['']) lock.packages[''].version = version
  }
  // Keep the checkout's line endings (CRLF under core.autocrlf on Windows).
  const format = (value, original) => (JSON.stringify(value, null, 2) + '\n').replace(/\n/g, original.includes('\r\n') ? '\r\n' : '\n')
  return { pkgText: format(pkg, pkgText), lockText: lock ? format(lock, lockText) : null }
}

async function main() {
  const args = process.argv.slice(2)
  const request = args.find(arg => !arg.startsWith('--'))
  const commit = args.includes('--commit'), dryRun = args.includes('--dry-run')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim()
  if (commit && !dryRun && git('status', '--porcelain')) throw new Error('Còn thay đổi chưa commit; hãy commit trước khi tạo bản phát hành.')
  const pkgPath = join(root, 'package.json'), lockPath = join(root, 'package-lock.json')
  const pkgText = await readFile(pkgPath, 'utf8')
  const lockText = await readFile(lockPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error })
  const current = JSON.parse(pkgText).version
  const version = nextVersion(current, request)
  if (git('tag', '--list', `v${version}`)) throw new Error(`Tag v${version} đã tồn tại.`)
  console.log(`${current} -> ${version}`)
  if (dryRun) return
  const next = applyVersion(pkgText, lockText, version)
  await writeFile(pkgPath, next.pkgText)
  if (next.lockText) await writeFile(lockPath, next.lockText)
  const notes = join('docs', `UPGRADE-${version}.md`)
  const hasNotes = await access(join(root, notes)).then(() => true, () => false)
  if (!hasNotes) console.log(`Gợi ý: viết ${notes}; workflow phát hành dùng tệp này làm ghi chú hiển thị trong app.`)
  if (!commit) {
    console.log(`Tiếp theo: git commit -am "Release ${version}" && git tag v${version} && git push origin HEAD v${version}`)
    return
  }
  git('add', 'package.json', ...(next.lockText ? ['package-lock.json'] : []), ...(hasNotes ? [notes] : []))
  git('commit', '-m', `Release ${version}`)
  git('tag', '-a', `v${version}`, '-m', `Viet Latex Studio ${version}`)
  console.log(`Đã commit và tạo tag v${version}. Đẩy lên để phát hành: git push origin HEAD v${version}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
