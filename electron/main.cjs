const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell } = require('electron')
const { existsSync, mkdirSync, readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { basename, isAbsolute, join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { APP_HOST, APP_SCHEME, createRendererProtocolHandler, isTrustedDevRendererUrl } = require('./app-protocol.cjs')
const { createWorkspaceStore } = require('./workspace-store.cjs')
const { safeExternalUrl } = require('./external-links.cjs')
const { startGoBackend } = require('./backend-client.cjs')
const { createLanSync } = require('./lan-sync.cjs')

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME.slice(0, -1),
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5176'
const DESKTOP_DIST = resolve(app.getAppPath(), 'dist')
const DESKTOP_URL = `${APP_SCHEME}//${APP_HOST}/index.html`
const usesBuiltRenderer = () => app.isPackaged || !process.env.ELECTRON_RENDERER_URL || process.argv.includes('--built-renderer') || process.env.VIETLATEX_BUILT_RENDERER === 'true' || process.env.VIETLATEX_TEST_PACKAGED_RENDERER === 'true'
let mainWindow
const compileControllers = new Map()
let workspaceStore
let backend
let backendShutdownPromise
let allowApplicationQuit = false
let quitRequested = false
let lanSync

function configureUserDataPath() {
  if (process.env.VIETLATEX_USER_DATA) {
    const configuredPath = resolve(process.env.VIETLATEX_USER_DATA)
    mkdirSync(configuredPath, { recursive: true })
    app.setPath('userData', configuredPath)
    return
  }

  const defaultPath = app.getPath('userData')
  const locationPath = join(defaultPath, 'user-data-location.json')
  let location
  try {
    location = JSON.parse(readFileSync(locationPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw new Error(`Không đọc được cấu hình vị trí dữ liệu ${locationPath}: ${error.message}`, { cause: error })
  }

  if (location?.version !== 1 || typeof location.path !== 'string' || !isAbsolute(location.path)) {
    throw new Error(`Cấu hình vị trí dữ liệu không hợp lệ: ${locationPath}`)
  }

  const configuredPath = resolve(location.path)
  mkdirSync(configuredPath, { recursive: true })
  app.setPath('userData', configuredPath)
}

try {
  configureUserDataPath()
} catch (error) {
  dialog.showErrorBox('Không mở được nơi lưu dữ liệu', error.message)
  process.exit(1)
}
let allowWindowClose = false
let startupComplete = false
let closeSavePending = false
let closeSaveTimer

app.setAppUserModelId('vn.vietlatex.studio')
Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
  { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' },
]) : null)

function trustedRendererUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (!usesBuiltRenderer()) return isTrustedDevRendererUrl(rawUrl, RENDERER_URL)
    return url.protocol === APP_SCHEME && url.host === APP_HOST && !url.username && !url.password && url.pathname === '/index.html' && !url.search && !url.hash
  } catch { return false }
}

function isTrustedSender(event) {
  const frame = event.senderFrame
  return Boolean(frame && frame === event.sender.mainFrame && trustedRendererUrl(frame.url))
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('Yêu cầu không đến từ giao diện ứng dụng.')
}

// Electron grants every permission by default. The UI only needs clipboard
// access (copy buttons, MathLive paste); deny camera, location, notifications…
const RENDERER_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])
function registerPermissionPolicy() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(RENDERER_PERMISSIONS.has(permission) && webContents === mainWindow?.webContents && trustedRendererUrl(details?.requestingUrl || webContents.getURL()))
  })
}

function registerRendererProtocol() {
  protocol.handle(APP_SCHEME.slice(0, -1), createRendererProtocolHandler({
    distDir: DESKTOP_DIST,
    fetchFile: filePath => net.fetch(pathToFileURL(filePath).href),
  }))
}

function finishWindowClose(saved) {
  if (!closeSavePending) return
  clearTimeout(closeSaveTimer)
  closeSaveTimer = undefined
  closeSavePending = false
  if (!saved) {
    quitRequested = false
    dialog.showErrorBox('Tiến trình chưa được lưu', 'Ứng dụng chưa lưu xong tiến trình nên vẫn đang mở. Hãy kiểm tra dung lượng ổ đĩa rồi thử đóng lại.')
    return
  }
  allowWindowClose = true
  if (quitRequested) { void shutdownApplication(); return }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
}

function requestWindowFlush() {
  if (closeSavePending || !mainWindow || mainWindow.isDestroyed()) return
  closeSavePending = true
  // A crashed renderer can never answer; its unsaved state is already gone, so
  // close with what is on disk instead of leaving an unclosable window.
  if (mainWindow.webContents.isCrashed()) { finishWindowClose(true); return }
  mainWindow.webContents.send('workspace:flush-before-close')
  closeSaveTimer = setTimeout(() => finishWindowClose(false), 15_000)
  closeSaveTimer.unref?.()
}

async function shutdownApplication() {
  if (backendShutdownPromise) return backendShutdownPromise
  for (const controller of compileControllers.values()) controller.abort()
  backendShutdownPromise = Promise.resolve(backendRestartPromise).catch(() => {}).then(async () => {
    // Wait for queued workspace writes (a save can arrive after the close flush)
    // and stop every service even if one of them fails.
    const results = await Promise.allSettled([workspaceStore?.whenIdle(), lanSync?.stop(), backend?.stop()])
    for (const result of results) if (result.status === 'rejected') console.error('Không thể dừng dịch vụ sạch sẽ:', result.reason)
  }).finally(() => {
    allowApplicationQuit = true
    app.quit()
  })
  return backendShutdownPromise
}

function registerNativeActions() {
  const syncAction = action => async (event, ...args) => { assertTrustedSender(event); if (!lanSync) throw new Error('Dịch vụ đồng bộ chưa sẵn sàng.'); return lanSync[action](...args) }
  for (const [channel, action] of Object.entries({ status: 'status', configure: 'configure', exchange: 'exchange', acknowledge: 'acknowledge', resolve: 'resolve', invitation: 'invitation', revoke: 'revoke' })) ipcMain.handle(`sync:${channel}`, syncAction(action))
  ipcMain.handle('system:help', (event, topic) => {
    assertTrustedSender(event)
    const pages = { tex: process.platform === 'darwin' ? 'https://www.tug.org/mactex/' : 'https://miktex.org/download', word: 'https://pandoc.org/installing.html' }
    if (!pages[topic]) throw new Error('Trang trợ giúp không hợp lệ.')
    return shell.openExternal(pages[topic])
  })
  ipcMain.handle('workspace:backups', event => { assertTrustedSender(event); return workspaceStore.listBackups() })
  ipcMain.handle('workspace:backup', event => { assertTrustedSender(event); return workspaceStore.backup() })
  ipcMain.handle('workspace:read-backup', (event, id) => { assertTrustedSender(event); return workspaceStore.readBackup(id) })
  ipcMain.handle('system:environment', async event => {
    assertTrustedSender(event)
    return { ...await (await getBackend()).environment(), version: app.getVersion(), platform: process.platform }
  })
  ipcMain.handle('latex:clear-cache', event => { assertTrustedSender(event); return getBackend().then(client => client.clearCache()) })
  ipcMain.handle('latex:parse-source', (event, source) => { assertTrustedSender(event); return getBackend().then(client => client.parseLatexSource(source)) })
  ipcMain.handle('citation:doi', (event, doi) => { assertTrustedSender(event); return getBackend().then(client => client.lookupDoi(doi)) })
  ipcMain.handle('word:convert', (event, direction, input) => { assertTrustedSender(event); return getBackend().then(client => client.convertWord(direction, input)) })
  ipcMain.handle('workspace:load', async event => {
    assertTrustedSender(event)
    return workspaceStore.load()
  })
  ipcMain.handle('workspace:save', async (event, workspace) => {
    assertTrustedSender(event)
    return workspaceStore.save(workspace)
  })
  // ipcMain.on listeners have no caller to reject to: throwing here would be an
  // uncaught exception in the main process, so untrusted messages are ignored.
  ipcMain.on('workspace:close-ready', event => {
    if (isTrustedSender(event) && event.sender === mainWindow?.webContents) finishWindowClose(true)
  })
  ipcMain.on('workspace:close-failed', event => {
    if (isTrustedSender(event) && event.sender === mainWindow?.webContents) finishWindowClose(false)
  })
  ipcMain.on('latex:cancel', (event, id) => {
    if (isTrustedSender(event) && typeof id === 'string') compileControllers.get(id)?.abort()
  })
  ipcMain.handle('latex:compile', async (event, latex, images, id, assets, fresh) => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || id.length === 0 || id.length > 128 || compileControllers.has(id)) {
      return { ok: false, error: 'Mã yêu cầu biên dịch không hợp lệ hoặc bị trùng.' }
    }
    const controller = new AbortController()
    compileControllers.set(id, controller)
    try {
      const pdf = await (await getBackend()).compileLatex(latex, images, id, assets, fresh === true, controller.signal)
      return { ok: true, pdf }
    } catch (error) {
      return { ok: false, error: error.message || 'Không thể biên dịch PDF.', status: error.status || 500, log: error.log, line: error.line }
    } finally {
      if (compileControllers.get(id) === controller) compileControllers.delete(id)
    }
  })

  ipcMain.handle('file:save-pdf', async (event, bytes, requestedName) => {
    assertTrustedSender(event)
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength === 0 || bytes.byteLength > 75 * 1024 * 1024) {
      throw new Error('Dữ liệu PDF không hợp lệ hoặc vượt quá 75 MB.')
    }
    const name = basename(String(requestedName || 'tai-lieu.pdf').replace(/[\\/:*?"<>|]/g, '').trim() || 'tai-lieu.pdf')
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu bản PDF',
      defaultPath: join(app.getPath('documents'), name.endsWith('.pdf') ? name : `${name}.pdf`),
      filters: [{ name: 'Tài liệu PDF', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    })
    if (canceled || !filePath) return { saved: false, canceled: true }
    await writeFile(filePath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    return { saved: true }
  })
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(RENDERER_URL)
      if (response.ok) return
    } catch {
      // Keep retrying while the local Vite server starts.
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250))
  }
  throw new Error(`Máy giao diện chưa khởi động tại ${RENDERER_URL}.`)
}

async function createMainWindow() {
  allowWindowClose = false
  closeSavePending = false
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize
  const minWidth = Math.min(940, workAreaWidth)
  const minHeight = Math.min(660, workAreaHeight)
  mainWindow = new BrowserWindow({
    width: Math.max(minWidth, Math.min(1460, Math.round(workAreaWidth * 0.94))),
    height: Math.max(minHeight, Math.min(980, Math.round(workAreaHeight * 0.92))),
    minWidth,
    minHeight,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f2',
    title: `Viết & Công thức — ${app.getVersion()}`,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.on('page-title-updated', event => event.preventDefault())
  mainWindow.once('ready-to-show', () => { if (process.env.VIETLATEX_TEST_HIDE_WINDOW !== 'true') mainWindow?.show() })
  mainWindow.on('close', event => {
    if (allowWindowClose) return
    event.preventDefault()
    requestWindowFlush()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeExternalUrl(url)
    if (externalUrl) void shell.openExternal(externalUrl).catch(() => {})
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!trustedRendererUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!trustedRendererUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('render-process-gone', () => { if (closeSavePending) finishWindowClose(true) })
  // Registered before loading so a window closed or failing during load is released.
  const createdWindow = mainWindow
  createdWindow.on('closed', () => { if (mainWindow === createdWindow) mainWindow = null })
  try {
    if (usesBuiltRenderer()) await createdWindow.loadURL(DESKTOP_URL)
    else {
      await waitForRenderer()
      await createdWindow.loadURL(RENDERER_URL)
      createdWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } catch (error) {
    // The UI never loaded, so nothing can answer the close flush; without this the
    // blank window (and a quit after the startup error) waits 15 s and stays open.
    if (mainWindow === createdWindow) allowWindowClose = true
    throw error
  }
}

function goBackendExecutable() {
  const executable = process.platform === 'win32' ? 'vietlatex-backend.exe' : 'vietlatex-backend'
  if (app.isPackaged) return join(process.resourcesPath, 'backend', executable)
  return join(app.getAppPath(), 'build', 'backend', executable)
}

async function startBackend() {
  // Dev only: `go run` sidesteps Windows Application Control blocking a
  // freshly built unsigned backend binary.
  if (!app.isPackaged && process.env.VIETLATEX_DEV_BACKEND === 'go-run') {
    backend = await startGoBackend({
      executable: 'go',
      args: ['-C', 'backend', 'run', './cmd/vietlatex-backend', '--listen=127.0.0.1:0'],
      cwd: app.getAppPath(),
      appPath: app.getAppPath(),
    })
    return
  }
  const executable = goBackendExecutable()
  if (!existsSync(executable)) {
    throw new Error(`Không tìm thấy backend Go: ${executable}. Hãy chạy npm run backend:build rồi mở lại ứng dụng.`)
  }
  backend = await startGoBackend({
    executable,
    cwd: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    appPath: app.getAppPath(),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  })
}

const BACKEND_RESTART_LIMIT = 3
const BACKEND_RESTART_WINDOW_MS = 60_000
const backendRestartTimes = []
let backendRestartPromise

async function getBackend() {
  if (backend && !backend.exitInfo) return backend
  if (backendShutdownPromise || allowApplicationQuit) throw new Error('Ứng dụng đang thoát; backend biên dịch không còn hoạt động.')
  if (backendRestartPromise) return backendRestartPromise
  const now = Date.now()
  while (backendRestartTimes.length && now - backendRestartTimes[0] > BACKEND_RESTART_WINDOW_MS) backendRestartTimes.shift()
  if (backendRestartTimes.length >= BACKEND_RESTART_LIMIT) {
    throw new Error('Backend biên dịch liên tục bị dừng (3 lần trong 60 giây). Hãy khởi động lại ứng dụng.')
  }
  backendRestartTimes.push(now)
  console.error('Backend Go đã dừng', backend?.exitInfo, '- đang khởi động lại.')
  backendRestartPromise = startBackend().then(() => backend).finally(() => { backendRestartPromise = undefined })
  return backendRestartPromise
}

const hasSingleInstance = app.requestSingleInstanceLock()
if (!hasSingleInstance) app.quit()
else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    try {
      registerRendererProtocol()
      // Start the Go backend alongside the window; the first compile waits for it.
      backendRestartPromise = startBackend().then(() => backend).finally(() => { backendRestartPromise = undefined })
      backendRestartPromise.catch(error => {
        console.error('Không khởi động được backend Go:', error)
        dialog.showErrorBox('Chưa khởi động được bộ biên dịch', `${error.message}

Bạn vẫn có thể soạn thảo; biên dịch PDF sẽ thử khởi động lại backend.`)
      })
      workspaceStore = createWorkspaceStore(app)
      lanSync = createLanSync({ directory: app.getPath('userData'), appPath: app.getAppPath() })
      try { await lanSync.init() } catch (error) {
        console.error('Không mở được hồ sơ đồng bộ:', error)
        lanSync = null
        dialog.showErrorBox('Đồng bộ chưa sẵn sàng', `${error.message}\nDữ liệu tài liệu vẫn được giữ trên máy.`)
      }
      registerNativeActions()
      registerPermissionPolicy()
      startupComplete = true
      await createMainWindow()
    } catch (error) {
      dialog.showErrorBox('Không thể mở Viết & Công Thức', error.message || 'Lỗi khởi động ứng dụng.')
      app.quit()
    }
  })
  // macOS emits 'activate' on first launch too, possibly while startup is still
  // awaiting the sync profile (no IPC handlers yet, second window), or during quit.
  app.on('activate', () => { if (startupComplete && !backendShutdownPromise && BrowserWindow.getAllWindows().length === 0) createMainWindow().catch(error => dialog.showErrorBox('Không thể mở ứng dụng', error.message)) })
  app.on('before-quit', event => {
    if (allowApplicationQuit) return
    event.preventDefault()
    if (backendShutdownPromise) return
    quitRequested = true
    if (mainWindow && !mainWindow.isDestroyed() && !allowWindowClose) requestWindowFlush()
    else void shutdownApplication()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
