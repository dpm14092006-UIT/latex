import assert from 'node:assert/strict'
import { startGoBackendForTests } from './go-backend-test-client.mjs'

const backend = await startGoBackendForTests()
try {
  await assert.rejects(() => backend.compileLatex(''), error => error.status === 400)
  await assert.rejects(() => backend.compileLatex('x'.repeat(800 * 1024 + 1)), error => error.status === 413)

  const source = String.raw`\documentclass[12pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{Arial}
\usepackage{amsmath,amssymb}
\usepackage[margin=2.5cm]{geometry}
\begin{document}
Kiểm tra tiếng Việt trong ứng dụng desktop.
\[
\frac{x^2 + 1}{2} = \sum_{n=1}^{3} n
\]
\end{document}`

  const pdf = await backend.compileLatex(source)
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.ok(pdf.byteLength > 1000)
  console.log(`Go + XeLaTeX smoke test passed: ${pdf.byteLength} byte PDF.`)
} finally {
  await backend.close()
}
