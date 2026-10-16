const { mkdir, open, readFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { renameWithRetry, syncDirectory } = require('./workspace-store.cjs')

// Gemini assistant for the desktop app. The API key never reaches the renderer:
// it is encrypted with the OS keystore (Keychain on macOS, DPAPI on Windows) and
// sent only in a header to Google's endpoint. Prompts are fixed per action so
// the renderer can choose what to do, but not repurpose the key.
const API = 'https://generativelanguage.googleapis.com/v1beta'
const MAX_TEXT = 20_000
const MAX_CONTEXT = 8_000
const REQUEST_TIMEOUT_MS = 90_000
const KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/
const MODEL_PATTERN = /^models\/[A-Za-z0-9._-]{1,100}$/

const KEEP_LATEX = 'Giữ nguyên mọi lệnh LaTeX, công thức ($...$, \\(...\\), \\[...\\]), \\cite{...}, \\ref{...}, \\label{...} và tên riêng. Chỉ trả về kết quả, không giải thích, không bọc trong khối mã.'
const ACTIONS = {
  academic: { label: 'Viết lại văn phong học thuật', prompt: `Viết lại đoạn văn sau theo văn phong học thuật rõ ràng, giữ nguyên ngôn ngữ gốc và ý nghĩa. ${KEEP_LATEX}` },
  grammar: { label: 'Sửa ngữ pháp và chính tả', prompt: `Sửa lỗi ngữ pháp, chính tả và dấu câu trong đoạn văn sau, thay đổi ít nhất có thể, giữ nguyên ngôn ngữ gốc. ${KEEP_LATEX}` },
  'to-english': { label: 'Dịch sang tiếng Anh', prompt: `Dịch đoạn văn sau sang tiếng Anh học thuật. ${KEEP_LATEX}` },
  'to-vietnamese': { label: 'Dịch sang tiếng Việt', prompt: `Dịch đoạn văn sau sang tiếng Việt học thuật, tự nhiên. ${KEEP_LATEX}` },
  abstract: { label: 'Tóm tắt thành Abstract', prompt: `Viết một đoạn Abstract (150–250 từ) cho nội dung sau, cùng ngôn ngữ với nội dung. ${KEEP_LATEX}` },
  'explain-error': { label: 'Giải thích lỗi biên dịch', prompt: 'Giải thích ngắn gọn bằng tiếng Việt nguyên nhân lỗi XeLaTeX sau và cách sửa cụ thể. Nếu có đoạn source kèm theo, chỉ ra dòng hoặc lệnh cần sửa.' },
}

class GeminiError extends Error {}

function createGemini({ directory, safeStorage, fetch, now = Date.now, api = API }) {
  const file = join(directory, 'ai-v1.json')
  let queue = Promise.resolve()
  const controllers = new Set()
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result }

  async function read() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      if (data?.version !== 1 || typeof data.key !== 'string') return {}
      return { key: data.key, model: MODEL_PATTERN.test(data.model) ? data.model : '' }
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}
      throw error
    }
  }
  async function write(data) {
    await mkdir(directory, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify({ version: 1, ...data }) + '\n', 'utf8'); await handle.sync() } finally { await handle.close() }
    try { await renameWithRetry(temporary, file) } catch (error) { await rm(temporary, { force: true }); throw error }
    await syncDirectory(directory)
  }
  async function secret() {
    const saved = await read()
    if (!saved.key) throw new GeminiError('Chưa nhập API key Gemini. Mở Quản lý → Trợ lý AI.')
    try { return { key: safeStorage.decryptString(Buffer.from(saved.key, 'base64')), model: saved.model } }
    catch { throw new GeminiError('Không giải mã được API key (tài khoản hệ điều hành đã đổi?). Hãy nhập lại key.') }
  }

  async function call(path, key, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)
    controllers.add(controller)
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    try {
      const response = await fetch(`${api}/${path}`, {
        method, signal: combined, redirect: 'error',
        headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new GeminiError(describeFailure(response.status, data))
      return data
    } catch (error) {
      if (error instanceof GeminiError) throw error
      if (combined.aborted) throw new GeminiError(controller.signal.reason === 'timeout' ? 'Gemini không trả lời kịp; hãy thử lại.' : 'Đã hủy yêu cầu.')
      throw new GeminiError('Không kết nối được Google Gemini. Kiểm tra mạng rồi thử lại.')
    } finally { clearTimeout(timer); controllers.delete(controller) }
  }

  async function listModels(key) {
    const data = await call('models?pageSize=200', key)
    return (Array.isArray(data.models) ? data.models : [])
      .filter(model => MODEL_PATTERN.test(model?.name) && /gemini/i.test(model.name) && model.supportedGenerationMethods?.includes('generateContent') && !/embedding|image|tts|audio|live/i.test(model.name))
      .map(model => ({ id: model.name, label: typeof model.displayName === 'string' ? model.displayName.slice(0, 100) : model.name.slice(7) }))
  }

  return {
    actions: () => Object.entries(ACTIONS).map(([id, action]) => ({ id, label: action.label })),
    status: () => serialized(async () => {
      const saved = await read()
      return { provider: 'gemini', configured: Boolean(saved.key), model: saved.model || '', encryption: safeStorage.isEncryptionAvailable() }
    }),
    // Verifies the key by listing models before saving it.
    setKey: input => serialized(async () => {
      const key = typeof input === 'string' ? input.trim() : ''
      if (!KEY_PATTERN.test(key)) throw new GeminiError('API key không đúng định dạng. Sao chép lại key từ Google AI Studio.')
      if (!safeStorage.isEncryptionAvailable()) throw new GeminiError('Hệ điều hành không cung cấp kho mã hóa; không thể lưu key an toàn.')
      const models = await listModels(key)
      if (!models.length) throw new GeminiError('Key hợp lệ nhưng không có model Gemini nào dùng được.')
      const saved = await read()
      const model = models.some(item => item.id === saved.model) ? saved.model : preferredModel(models)
      await write({ key: safeStorage.encryptString(key).toString('base64'), model })
      return { configured: true, model, models }
    }),
    clearKey: () => serialized(async () => { await rm(file, { force: true }); return { configured: false, model: '' } }),
    models: async () => listModels((await secret()).key),
    setModel: id => serialized(async () => {
      if (typeof id !== 'string' || !MODEL_PATTERN.test(id)) throw new GeminiError('Model không hợp lệ.')
      const saved = await read()
      if (!saved.key) throw new GeminiError('Chưa nhập API key Gemini.')
      await write({ key: saved.key, model: id })
      return { model: id }
    }),
    generate: async ({ action, text, context } = {}) => {
      const preset = ACTIONS[action]
      if (!preset || !Object.hasOwn(ACTIONS, action)) throw new GeminiError('Thao tác AI không hợp lệ.')
      if (typeof text !== 'string' || !text.trim()) throw new GeminiError('Chưa có nội dung để gửi.')
      if (text.length > MAX_TEXT) throw new GeminiError(`Nội dung vượt ${MAX_TEXT.toLocaleString('vi-VN')} ký tự; hãy chọn đoạn ngắn hơn.`)
      const extra = typeof context === 'string' ? context.slice(0, MAX_CONTEXT) : ''
      const { key, model } = await secret()
      if (!model) throw new GeminiError('Chưa chọn model Gemini.')
      const started = now()
      const data = await call(`${model}:generateContent`, key, {
        method: 'POST',
        body: {
          systemInstruction: { parts: [{ text: preset.prompt }] },
          contents: [{ role: 'user', parts: [{ text: extra ? `${text}\n\n--- Đoạn source liên quan ---\n${extra}` : text }] }],
          generationConfig: { temperature: action === 'grammar' ? 0.1 : 0.4, maxOutputTokens: 8192 },
        },
      })
      if (data.promptFeedback?.blockReason) throw new GeminiError('Gemini từ chối xử lý nội dung này.')
      const candidate = data.candidates?.[0]
      const output = (candidate?.content?.parts || []).map(part => typeof part?.text === 'string' && !part.thought ? part.text : '').join('').trim()
      if (!output) throw new GeminiError(candidate?.finishReason === 'SAFETY' ? 'Gemini từ chối xử lý nội dung này.' : 'Gemini không trả về kết quả.')
      return { text: stripFence(output), model, truncated: candidate?.finishReason === 'MAX_TOKENS', elapsedMs: now() - started }
    },
    cancel: () => { for (const controller of controllers) controller.abort('cancel') },
    whenIdle: () => queue,
  }
}

// Newest stable "flash" model: fast and inexpensive for editing tasks.
function preferredModel(models) {
  const version = id => (/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] || '0').split('.').map(Number)
  const newer = (a, b) => { const [x, y] = [version(a.id), version(b.id)]; return (y[0] - x[0]) || ((y[1] || 0) - (x[1] || 0)) }
  const stable = models.filter(model => !/preview|exp|lite|latest|\d{3,}$/i.test(model.id))
  return ([...stable.filter(model => /flash/i.test(model.id))].sort(newer)[0] || [...stable].sort(newer)[0] || models[0]).id
}

function stripFence(text) {
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text)
  return match ? match[1] : text
}

function describeFailure(status, data) {
  const reason = data?.error?.details?.find?.(item => item?.reason)?.reason || data?.error?.status || ''
  if (reason === 'API_KEY_INVALID' || status === 401) return 'API key Gemini không hợp lệ hoặc đã bị thu hồi.'
  if (status === 403) return 'Key không có quyền dùng Gemini API (kiểm tra dự án trong Google AI Studio).'
  if (status === 429) return 'Đã hết hạn mức Gemini (miễn phí hoặc trả phí). Đợi một lúc hoặc kiểm tra hạn mức trong Google AI Studio.'
  if (status === 404) return 'Model không còn khả dụng; chọn model khác.'
  if (status === 400 && /location|region/i.test(data?.error?.message || '')) return 'Gemini API chưa hỗ trợ khu vực hiện tại.'
  if (status >= 500) return 'Máy chủ Gemini đang lỗi; thử lại sau.'
  return `Gemini báo lỗi (HTTP ${status}).`
}

module.exports = { createGemini, preferredModel, GeminiError }
