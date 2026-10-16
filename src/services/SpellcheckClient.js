export class SpellcheckClient {
  constructor() {
    this.worker = null
    this.pending = new Map()
    this.sequence = 0
  }
  start() {
    if (this.worker) return
    this.worker = new Worker(new URL('../workers/spellcheck.worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }) => {
      const job = this.pending.get(data.id)
      if (!job) return
      this.pending.delete(data.id); clearTimeout(job.timer)
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data)
    }
    this.worker.onerror = () => this.destroy('Không khởi động được bộ kiểm tra chính tả.')
  }
  cancel() {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new DOMException('Đã hủy', 'AbortError')) }
    this.pending.clear()
    this.worker?.postMessage({ type: 'cancel' })
  }
  request(type, input) {
    this.cancel(); this.start()
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.destroy('Kiểm tra quá thời gian; hãy thử lại.'), type === 'suggest' ? 5000 : 30_000)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ ...input, type, id, assetBase: new URL('./spellcheck/', window.location.href).href })
    })
  }
  destroy(message) {
    this.worker?.terminate(); this.worker = null
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error(message || 'Đã đóng bộ kiểm tra.')) }
    this.pending.clear()
  }
}
