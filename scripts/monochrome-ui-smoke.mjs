import { primaryKey, documentEndKey } from './platform-keys.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { createTask, createProject } from '../src/services/WorkspaceData.js'

const output = 'artifacts/monochrome-ui'
await mkdir(output, { recursive: true })
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const heading = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const sampleDocument = { type: 'doc', content: [
  heading(1, 'Đạo hàm và ứng dụng'),
  paragraph('Một cách nhìn trực quan về sự thay đổi. Ghi chú giải tích dành cho học tập và nghiên cứu.'),
  heading(2, '1. Hiểu về đạo hàm'),
  paragraph('Đạo hàm mô tả tốc độ thay đổi của một hàm số tại một điểm. Về hình học, đó là hệ số góc của tiếp tuyến với đồ thị tại điểm đang xét.'),
  { type: 'blockMath', attrs: { latex: String.raw`f\prime(x)=\lim_{h\to 0}\frac{f(x+h)-f(x)}{h}` } },
  heading(2, '2. Các quy tắc cơ bản'),
  paragraph('Ta có thể tính đạo hàm của các biểu thức phức tạp từ những quy tắc đơn giản: quy tắc tổng, quy tắc tích và quy tắc hàm hợp.'),
  heading(2, '3. Từ lý thuyết đến thực hành'),
  paragraph('Xét hàm số f(x) = x². Đây là cơ sở để khảo sát tính đơn điệu và tìm cực trị.'),
] }
const task = createTask('Đạo hàm & ứng dụng', sampleDocument)
const project = createProject('Nghiên cứu', task)
project.tasks.push(createTask('Ghi chú đại số'))
const fixture = { version: 1, projects: [project], activeProjectId: project.id, mode: 'split', activeTab: 'write', pdfMode: 'manual' }
const server = await createServer({ server: { host: '127.0.0.1', port: 5184, strictPort: true } })
await server.listen()
let browser
let initialPageCount
try {
  const browserName = process.env.UI_TEST_BROWSER || 'chromium'
  browser = await chromium.launch({ headless: true, ...(browserName === 'chromium' ? {} : { channel: browserName }) })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(data => {
    if (!localStorage.getItem('latex-workspace-v1')) {
      localStorage.setItem('latex-workspace-v1', JSON.stringify(data))
      localStorage.setItem('latex-theme', 'light')
      localStorage.setItem('latex-theme-default-migrated', '1')
    }
  }, fixture)
  await page.goto('http://127.0.0.1:5184')
  await page.locator('.tiptap .katex').first().waitFor()
  const assertGrayscaleChrome = async () => {
    const samples = await page.evaluate(() => ['.mono-root', '.mono-navigator', '.mono-brand-mark', '.mono-doc-item[aria-current="page"]', '.aurora-insights', '.aurora-workflow', '.studio-export', '.studio-views button[aria-pressed="true"]'].flatMap(selector => {
      const style = getComputedStyle(document.querySelector(selector))
      return [style.color, style.backgroundColor, style.borderTopColor, ...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(value => String(value))
    }))
    for (const sample of samples) {
      const channels = sample.match(/rgba?\((\d+), (\d+), (\d+)/)
      if (channels) assert.ok(channels[1] === channels[2] && channels[2] === channels[3], `workspace chrome must be grayscale: ${sample}`)
    }
  }
  await assertGrayscaleChrome()
  assert.equal(await page.locator('.mono-doc-item').count(), 2)
  assert.match(await page.getByLabel('Thống kê bản thảo').innerText(), /Công thức/)
  assert.equal(await page.locator('.aurora-metrics strong').nth(1).innerText(), '1')
  await page.getByRole('button', { name: 'Bước 2: Xem mã LaTeX', exact: true }).click()
  await page.locator('.cm-content').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Bước 2: Xem mã LaTeX', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Bước 3: Xem bản in PDF', exact: true }).click()
  await page.getByRole('region', { name: 'Bản PDF xem trước', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'Soạn thảo tài liệu', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Bước 1: Soạn bản thảo', exact: true }).click()
  await page.locator('.tiptap').waitFor()
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  assert.equal(await page.locator('.mono-rail').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).count(), 1)
  assert.equal(await page.locator('.mono-nav-head button').count(), 0)
  await page.getByRole('button', { name: 'Thư viện mẫu', exact: true }).click()
  const templateDialog = page.getByRole('dialog')
  for (const name of ['Báo cáo nghiên cứu khoa học', 'Bài báo nghiên cứu quốc tế', 'IEEE Journal', 'IEEE Conference']) {
    await templateDialog.getByText(name, { exact: true }).waitFor()
  }
  await templateDialog.locator('.studio-list-row').filter({ hasText: 'Báo cáo nghiên cứu khoa học' }).getByRole('button', { name: 'Dùng mẫu' }).click()
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await page.locator('.cm-content').waitFor()
  assert.match(await page.locator('.cm-content').innerText(), /\\documentclass\[12pt,a4paper\]\{report\}/)
  assert.match(await page.locator('.cm-content').innerText(), /\\chapter\{Phương pháp nghiên cứu\}/)
  const sourceEditor = page.locator('.cm-content')
  await sourceEditor.press(documentEndKey)
  assert.match(await sourceEditor.innerText(), /\\chapter\{Nội dung hiện có \(chưa sắp xếp\)\}/)
  assert.match(await sourceEditor.innerText(), /\\chapter\{Đạo hàm và ứng dụng\}/)
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  await page.waitForTimeout(150)
  initialPageCount = Number((await page.locator('.studio-page-indicator').innerText()).match(/\/\s*(\d+)/)?.[1] || 1)
  await page.screenshot({ path: `${output}/desktop.png` })
  const separator = page.getByRole('separator')
  const pane = page.getByRole('region', { name: 'Soạn thảo tài liệu' })
  const original = await pane.boundingBox()
  const handle = await separator.boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
  await page.mouse.down(); await page.mouse.move(handle.x + 65, handle.y + 100, { steps: 5 }); await page.mouse.up()
  assert.ok(Math.abs((await pane.boundingBox()).width - original.width) > 20)
  await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
  assert.equal(await page.locator('.mono-navigator').isVisible(), false)
  await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Tìm theo tên tài liệu', exact: true }).fill('đại số')
  assert.equal(await page.locator('.mono-doc-item').count(), 1)
  await page.getByRole('searchbox', { name: 'Tìm theo tên tài liệu', exact: true }).fill('')
  await page.locator('.mono-outline button').first().click()
  await page.waitForFunction(() => document.querySelector('.tiptap h1')?.contains(getSelection()?.anchorNode))
  await page.keyboard.press(`${primaryKey}+k`)
  await page.getByRole('textbox', { name: 'Tìm lệnh', exact: true }).fill('tao tai lieu')
  await page.keyboard.press('Enter')
  await page.getByRole('dialog').getByRole('textbox', { name: 'Tên tab', exact: true }).fill('Tài liệu kiểm tra')
  await page.getByRole('dialog').getByRole('button', { name: /Tạo tab/ }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Tên tài liệu"]').value === 'Tài liệu kiểm tra')
  const testDocumentText = 'Nội dung được giữ khi chuyển tài liệu. '.repeat(360)
  await page.locator('.tiptap').fill(testDocumentText)
  await page.waitForFunction(() => Number(document.querySelector('.studio-page-indicator')?.textContent.match(/\/\s*(\d+)/)?.[1] || 0) > 1)
  await page.locator('.mono-doc-item').filter({ hasText: 'Đạo hàm & ứng dụng' }).click()
  await page.waitForFunction(expected => Number(document.querySelector('.studio-page-indicator')?.textContent.match(/\/\s*(\d+)/)?.[1] || 0) === expected, initialPageCount)
  await page.locator('.mono-doc-item').filter({ hasText: 'Tài liệu kiểm tra' }).click()
  assert.match(await page.locator('.tiptap').innerText(), /Nội dung được giữ/)
  await page.waitForFunction(expected => Number(document.querySelector('.studio-page-indicator')?.textContent.match(/\/\s*(\d+)/)?.[1] || 0) > expected, initialPageCount)
  await page.getByRole('button', { name: 'Xóa tài liệu hiện tại', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận xóa', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
  await page.getByRole('button', { name: 'Đóng', exact: true }).click()
  assert.equal(await page.locator('.mono-doc-item').count(), 3)
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  await page.locator('.cm-content').waitFor()
  assert.match(await page.locator('.cm-content').innerText(), /Nội dung được giữ/)
  assert.equal(await page.getByRole('region', { name: 'Bản PDF xem trước' }).count(), 0)
  await page.screenshot({ path: `${output}/source.png` })
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  await page.locator('.mono-doc-item').filter({ hasText: 'Đạo hàm & ứng dụng' }).click()
  await page.getByRole('button', { name: 'Nền đen', exact: true }).click()
  await assertGrayscaleChrome()
  await page.mouse.move(8, 8)
  await page.waitForTimeout(220)
  const darkEditorText = await page.evaluate(() => {
    const editor = document.querySelector('.tiptap')
    const paragraph = editor?.querySelector('p')
    if (!editor || !paragraph) return null
    const pastedBlack = document.createElement('span')
    pastedBlack.setAttribute('style', 'color: rgb(0, 0, 0)')
    pastedBlack.textContent = 'contrast check'
    paragraph.append(pastedBlack)
    const result = {
      bodyText: getComputedStyle(editor).color,
      pastedText: getComputedStyle(pastedBlack).color,
      paper: getComputedStyle(document.querySelector('.studio-paper')).backgroundColor,
      pagePattern: getComputedStyle(document.querySelector('.studio-paper'), '::before').backgroundImage,
      themeButtonText: getComputedStyle(document.querySelector('[aria-label="Nền trắng"]')).color,
      themeButtonBackground: getComputedStyle(document.querySelector('[aria-label="Nền trắng"]')).backgroundColor,
      themeButtonHovered: document.querySelector('[aria-label="Nền trắng"]').matches(':hover'),
      paletteText: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    }
    pastedBlack.remove()
    return result
  })
  assert.equal(darkEditorText.paletteText, '#f2f2f2')
  assert.equal(darkEditorText.bodyText, 'rgb(242, 242, 242)')
  assert.equal(darkEditorText.pastedText, darkEditorText.bodyText)
  assert.ok(darkEditorText.pagePattern.includes(darkEditorText.paper), 'page pattern must match the dark paper color')
  assert.equal(darkEditorText.themeButtonText, darkEditorText.bodyText)
  assert.equal(darkEditorText.themeButtonHovered, false)
  assert.equal(darkEditorText.themeButtonBackground, 'rgba(0, 0, 0, 0)')
  await page.screenshot({ path: `${output}/dark.png` })
  await page.getByRole('button', { name: 'Nền trắng', exact: true }).click()
  await page.keyboard.press(`${primaryKey}+k`)
  await page.screenshot({ path: `${output}/commands.png` })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Chế độ tập trung', exact: true }).click()
  assert.equal(await page.locator('.mono-rail').count(), 0)
  await page.getByRole('button', { name: 'Mở lại giao diện', exact: true }).click()
  assert.equal(await page.locator('.mono-rail').count(), 0)
  await page.locator('.mono-doc-item').filter({ hasText: 'Ghi chú đại số' }).click()
  await page.getByRole('button', { name: 'Thư viện mẫu', exact: true }).click()
  await page.getByRole('dialog').locator('.studio-list-row').filter({ hasText: 'Bài báo nghiên cứu quốc tế' }).getByRole('button', { name: 'Dùng mẫu' }).click()
  await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
  const articleSource = page.locator('.cm-content')
  await articleSource.waitFor()
  assert.match(await articleSource.innerText(), /\\section\{Introduction\}/)
  assert.match(await articleSource.innerText(), /\\section\{Literature Review\}/)
  await articleSource.press(documentEndKey)
  assert.match(await articleSource.innerText(), /\\subsection\{Data and Sample\}/)
  assert.doesNotMatch(await articleSource.innerText(), /Nội dung hiện có \(chưa sắp xếp\)/)
  await page.getByRole('button', { name: 'Soạn + PDF', exact: true }).click()
  await page.getByRole('button', { name: 'Tham chiếu', exact: true }).click()
  await page.getByRole('button', { name: /Quản lý danh mục tài liệu tham khảo/ }).click()
  const referencesDialog = page.getByRole('dialog')
  await referencesDialog.getByRole('button', { name: /Nhập tệp \.bib \/ \.txt \/ \.ris/ }).click()
  const risFixture = `TY  - JOUR
AU  - Nguyen, An
AU  - Tran, Binh
TI  - A portable reference format
JO  - Journal of Example Studies
PY  - 2024
DO  - 10.1000/example
ER  -
TY  - CONF
AU  - Le, Chi
TI  - Importing citations safely
T2  - Proceedings of the Example Conference
PY  - 2023
ER  -`
  await referencesDialog.locator('input[type="file"]').setInputFiles({
    name: 'sample.ris', mimeType: 'application/x-research-info-systems', buffer: Buffer.from(risFixture),
  })
  await referencesDialog.getByRole('status').filter({ hasText: 'Đã thêm 2 tài liệu.' }).waitFor()
  assert.equal(await referencesDialog.locator('.cite-ref-row').count(), 2)
  await referencesDialog.getByText('A portable reference format', { exact: true }).waitFor()
  await referencesDialog.getByText('Importing citations safely', { exact: true }).waitFor()
  await referencesDialog.getByRole('tab', { name: 'Chèn trích dẫn' }).click()
  const referenceGroup = referencesDialog.getByRole('group', { name: 'Tài liệu tham khảo', exact: true })
  assert.equal(await referenceGroup.getByRole('checkbox').count(), 2)
  assert.equal(await referencesDialog.getByRole('listbox').count(), 0)
  await referencesDialog.getByRole('searchbox', { name: 'Tìm tài liệu', exact: true }).press('ArrowDown')
  await referencesDialog.getByRole('status').filter({ hasText: 'Kết quả 2 trên 2: A portable reference format' }).waitFor()
  await referencesDialog.getByRole('button', { name: 'Đóng', exact: true }).click()
  const articleEditor = page.locator('.tiptap')
  await articleEditor.click()
  await page.keyboard.press(`${primaryKey}+f`)
  const findInput = page.getByRole('textbox', { name: 'Tìm trong bản thảo', exact: true })
  await findInput.waitFor()
  assert.equal(await findInput.evaluate(element => element === document.activeElement), true, 'opening find should focus its input')
  await findInput.fill('introduction')
  await findInput.press('Enter')
  await page.getByRole('textbox', { name: 'Thay bằng', exact: true }).fill('Overview')
  await page.getByRole('button', { name: 'Thay', exact: true }).click()
  assert.match(await articleEditor.innerText(), /Overview/, 'replace should honor the case-insensitive match')
  for (const width of [1120, 901, 900, 768, 390]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `overflow ${width}`)
    if (width === 390) {
      await page.getByRole('button', { name: 'Điều hướng tài liệu', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'Thu gọn điều hướng', exact: true }).count(), 1)
      await page.screenshot({ path: `${output}/mobile-navigation.png` })
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.mono-navigator').isVisible(), false)
      await page.getByRole('button', { name: 'LaTeX', exact: true }).click()
      await page.locator('.cm-content').waitFor()
      await page.getByRole('button', { name: 'Soạn thảo', exact: true }).click()
    }
    await page.screenshot({ path: `${output}/width-${width}.png` })
  }
  assert.deepEqual(errors, [])
console.log('Monochrome UI passed: template library, RIS and citation keyboard accessibility, case-insensitive replace/focus, real workspace navigation, creation, cancel deletion, command palette, source, splitter, dark contrast, 1600/1120/901/900/768/390px; no page errors.')
} finally { await browser?.close(); await server.close() }
