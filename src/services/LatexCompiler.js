export class LatexCompiler {
  constructor({ desktopAPI = window.desktopAPI, fetchImpl = window.fetch.bind(window) } = {}) {
    this.desktopAPI = desktopAPI
    this.fetchImpl = fetchImpl
  }

  async compile(source, images, signal, assets = [], fresh = false) {
    signal?.throwIfAborted()
    if (this.desktopAPI?.compileLatex) {
      const id = crypto.randomUUID()
      const abort = () => this.desktopAPI.cancelCompile?.(id)
      signal?.addEventListener('abort', abort, { once: true })
      let result
      try { result = await this.desktopAPI.compileLatex(source, images, id, assets, fresh) }
      finally { signal?.removeEventListener('abort', abort) }
      if (signal?.aborted) throw new DOMException('Compilation cancelled.', 'AbortError')
      if (!result.ok) throw Object.assign(new Error(result.error || 'Không thể biên dịch PDF.'), { status: result.status, log: result.log, line: result.line })
      return new Blob([result.pdf], { type: 'application/pdf' })
    }

    const response = await this.fetchImpl('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex: source, images, assets, fresh }),
      signal,
    })

    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw Object.assign(new Error(result.error || 'Không thể biên dịch PDF.'), { status: response.status, log: result.log, line: result.line })
    }

    return response.blob()
  }
}
