// Page equivalents are a batching heuristic, never a prediction of PDF pagination.
export const PDF_BATCH_POLICY = { idleMs: 5000, intervalMs: 30000, maxDirtyMs: 60000, sourceCharsPerPage: 3000 }

export function estimateSourcePages(source = '') {
  return Math.max(1, Math.ceil(String(source).length / PDF_BATCH_POLICY.sourceCharsPerPage))
}

const sameFiles = (a = [], b = []) => a.length === b.length && a.every((file, i) => file.filename === b[i].filename && file.data === b[i].data)
export const sameCompileInput = (a, b) => Boolean(a && b && a.id === b.id && a.source === b.source && sameFiles(a.images, b.images) && sameFiles(a.assets, b.assets))

const cancelled = () => new DOMException('Yêu cầu PDF đã bị hủy.', 'AbortError')

export class PdfCompileScheduler {
  constructor({ compile, onState, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { compile, onState, now, setTimer, clearTimer })
    this.mode = '2'
    this.waiters = []
    this.lastStarted = -Infinity
  }

  update(input) {
    if (this.disposed) return
    const switched = this.input && this.input.id !== input.id
    const changed = !sameCompileInput(this.input, input) || this.input?.blocked !== input.blocked
    this.input = input
    if (switched || input.blocked) {
      this.active?.controller.abort()
      this.rejectWaiters(input.blocked ? new Error(input.blocked) : cancelled())
      this.forced = false
      this.fresh = false
    }
    if (switched) { this.result = null; this.lastStarted = -Infinity; this.dirtySince = null }
    if (changed) {
      this.lastChanged = this.now()
      this.dirtySince ??= this.now()
      this.failure = null
    }
    if (sameCompileInput(this.result?.input, input)) this.dirtySince = null
    this.publish()
    this.schedule()
  }

  setMode(mode) {
    this.mode = ['manual', '1', '2'].includes(mode) ? mode : '2'
    this.schedule()
  }

  publish() {
    if (this.disposed || !this.input) return
    const ready = sameCompileInput(this.result?.input, this.input)
    const error = this.input.blocked || this.failure?.error
    this.onState({
      status: this.input.blocked ? 'blocked' : this.active ? 'compiling' : error ? 'error' : ready ? 'ready' : 'dirty',
      error: typeof error === 'string' ? error : error?.message || '',
      log: this.failure?.error?.log || '', line: this.failure?.error?.line || null,
      blob: this.result?.blob || null,
      stale: Boolean(this.result && !ready),
    })
  }

  schedule() {
    this.clearTimer(this.timer)
    if (this.disposed || !this.input || this.input.blocked || this.active) return
    if (this.forced) { void this.run(); return }
    if (this.mode === 'manual' || this.failure || sameCompileInput(this.result?.input, this.input)) return
    // The editor measures manuscript pages. PDF pagination can differ, but this follows
    // the user's 1/2-page cadence more closely than guessing from LaTeX character count.
    const pagesSinceCompile = this.result
      ? Math.abs((this.input.pageCount || 1) - (this.result.input.pageCount || 1))
      : this.input.source.trim() ? Number(this.mode) : 0
    const large = pagesSinceCompile >= Number(this.mode)
    const deadline = Math.max(
      this.lastChanged + PDF_BATCH_POLICY.idleMs,
      this.lastStarted + PDF_BATCH_POLICY.intervalMs,
      large ? 0 : this.dirtySince + PDF_BATCH_POLICY.maxDirtyMs,
    )
    this.timer = this.setTimer(() => { void this.run() }, Math.max(0, deadline - this.now()))
  }

  request(input, { fresh = false } = {}) {
    if (this.disposed) return Promise.reject(cancelled())
    this.update(input)
    if (input.blocked) return Promise.reject(new Error(input.blocked))
    if (!fresh && sameCompileInput(this.result?.input, input)) return Promise.resolve(this.result.blob)
    const pending = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }))
    this.forced = true
    this.fresh ||= fresh
    this.failure = null
    this.schedule()
    return pending
  }

  async run() {
    if (this.active || this.disposed || this.input.blocked) return
    this.clearTimer(this.timer)
    const input = this.input
    const job = { input, controller: new AbortController() }
    this.active = job
    const fresh = Boolean(this.fresh)
    this.forced = false
    this.fresh = false
    this.failure = null
    this.lastStarted = this.now()
    this.publish()
    try {
      const blob = await this.compile(input.source, input.images, job.controller.signal, input.assets, fresh)
      if (job.controller.signal.aborted || this.disposed || input.id !== this.input.id) return
      this.result = { input, blob }
      if (sameCompileInput(input, this.input)) {
        this.dirtySince = null
        if (!this.fresh) {
          this.forced = false
          for (const waiter of this.waiters.splice(0)) waiter.resolve(blob)
        }
      } else {
        // Only the latest revision remains pending; typing does not restart the active job.
        this.dirtySince = this.lastChanged
        this.forced ||= this.waiters.length > 0
      }
    } catch (error) {
      if (!job.controller.signal.aborted && !this.disposed && input.id === this.input.id) {
        if (sameCompileInput(input, this.input)) {
          this.failure = { error }
          this.forced = false
          this.rejectWaiters(error)
        } else this.forced ||= this.waiters.length > 0
      }
    } finally {
      this.active = null
      this.publish()
      this.schedule()
    }
  }

  rejectWaiters(error) { for (const waiter of this.waiters.splice(0)) waiter.reject(error) }

  dispose() {
    this.disposed = true
    this.clearTimer(this.timer)
    this.active?.controller.abort()
    this.rejectWaiters(cancelled())
  }
}
