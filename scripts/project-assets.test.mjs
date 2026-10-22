import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync, strToU8 } from 'fflate'
import { isValidBase64, safeAssetPath, validateAssets, bytesToBase64, base64ToBytes } from '../src/services/ProjectAssets.js'
import { importLatexProject, importWorkspace, readZip } from '../src/services/ArchiveService.js'

// Simulates archivers (macOS Finder, older Windows tools) that store UTF-8 names without the EFS flag.
function clearUtf8Flags(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  for (let offset = 0; offset + 4 <= archive.length; offset++) {
    const signature = view.getUint32(offset, true)
    if (signature === 0x04034b50) view.setUint16(offset + 6, view.getUint16(offset + 6, true) & ~0x800, true)
    if (signature === 0x02014b50) view.setUint16(offset + 8, view.getUint16(offset + 8, true) & ~0x800, true)
  }
  return archive
}

test('LaTeX ZIPs keep unflagged UTF-8 names and ignore Finder/Explorer metadata', async () => {
  const archive = clearUtf8Flags(zipSync({
    'Dự án/main.tex': strToU8('\\documentclass{article}\\begin{document}\\includegraphics{Hình ảnh/biểu-đồ.png}\\end{document}'),
    'Dự án/Hình ảnh/biểu-đồ.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    'Dự án/.DS_Store': new Uint8Array([0, 1, 2]),
    '__MACOSX/Dự án/._main.tex': new Uint8Array([0, 5, 22, 7]),
  }))
  const files = await readZip(new File([archive], 'project.zip'))
  assert.ok(files['Dự án/Hình ảnh/biểu-đồ.png'])
  const imported = await importLatexProject(new File([archive], 'project.zip'))
  assert.equal(imported.title, 'main')
  assert.deepEqual(imported.assets.map(asset => asset.filename), ['Hình ảnh/biểu-đồ.png'])
})

test('resource Base64 validation matches the strict backend for padding bits', () => {
  for (const value of ['aGVsbG8=', 'YQ==', 'YWI=', '', 'AAAA']) assert.equal(isValidBase64(value), true, value)
  for (const value of ['aGVsbG9=', 'YR==', 'YWJ=', 'aGVsbG8', 'YQ=\n', 'AA=A', '====']) assert.equal(isValidBase64(value), false, value)
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
  for (let length = 1; length <= bytes.length; length++) {
    const value = bytesToBase64(bytes.subarray(0, length))
    assert.equal(isValidBase64(value), true)
    assert.deepEqual(base64ToBytes(value), bytes.subarray(0, length))
  }
  assert.throws(() => validateAssets([{ filename: 'refs.bib', data: 'YR==' }]), /không hợp lệ/)
})

test('resource path validation reserves compiler filenames in nested directories', () => {
  for (const path of ['document.tex', 'Document.PDF', 'nested/document.tex', 'nested/Document.PDF']) {
    assert.equal(safeAssetPath(path), false, path)
    assert.throws(() => validateAssets([{ filename: path, data: 'YQ==' }]), /không hợp lệ/)
  }
  for (const path of ['refs.bib', 'nested/chapter.tex', 'figures/photo.pdf']) assert.equal(safeAssetPath(path), true, path)
})

test('backup imports reject damaged content and assets instead of silently salvaging them', async () => {
  const snapshot = () => ({ format: 'vietlatex-workspace', version: 1, activeProjectId: 'p', projects: [{ id: 'p', name: 'Backup', activeTaskId: 't', tasks: [{ id: 't', title: 'Keep all content', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preserved' }] }] }, assets: [] }] }] })
  const archive = value => new File([zipSync({ 'workspace.json': strToU8(JSON.stringify(value)) })], 'backup.vls')
  const original = snapshot()
  const restored = await importWorkspace(archive(original))
  assert.equal(restored.projects[0].tasks[0].document.content[0].content[0].text, 'Preserved')
  assert.equal(restored.projects[0].tasks[0].sourceTrusted, false)

  const invalidNode = snapshot()
  invalidNode.projects[0].tasks[0].document.content.push({ type: 'unsupportedNode', text: 'Must not disappear' })
  await assert.rejects(importWorkspace(archive(invalidNode)), /chưa nhập để tránh mất nội dung/)

  const invalidAsset = snapshot()
  invalidAsset.projects[0].tasks[0].assets.push({ filename: '../lost.bib', data: 'YQ==' })
  await assert.rejects(importWorkspace(archive(invalidAsset)), /không hợp lệ/)

  const invalidSource = snapshot()
  invalidSource.projects[0].tasks[0].sourceDraft = { text: 'Must not become empty' }
  await assert.rejects(importWorkspace(archive(invalidSource)), /source LaTeX không hợp lệ/)

  const oversizedReferences = snapshot()
  oversizedReferences.projects[0].tasks[0].settings = { bibliography: 'x'.repeat(500_001) }
  await assert.rejects(importWorkspace(archive(oversizedReferences)), /BibTeX/)

  const legacy = snapshot()
  legacy.projects[0].tasks[0].document.content[0] = { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Legacy heading' }] }
  const migrated = await importWorkspace(archive(legacy))
  assert.equal(migrated.projects[0].tasks[0].document.content[0].attrs.level, 3)
})
