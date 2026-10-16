const { contextBridge, ipcRenderer } = require('electron')
let closeFlushCallback
let pendingCloseFlush = false

ipcRenderer.on('workspace:flush-before-close', () => {
  if (closeFlushCallback) closeFlushCallback()
  else pendingCloseFlush = true
})

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  platform: process.platform,
  spelling: Object.freeze({
    load: () => ipcRenderer.invoke('spellcheck:load'),
    mutate: (action, input) => ipcRenderer.invoke('spellcheck:mutate', action, input),
    onChange: callback => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, value) => callback(value)
      ipcRenderer.on('spellcheck:changed', listener)
      return () => ipcRenderer.removeListener('spellcheck:changed', listener)
    },
  }),
  ai: Object.freeze({
    status: () => ipcRenderer.invoke('ai:status'),
    actions: () => ipcRenderer.invoke('ai:actions'),
    setKey: key => ipcRenderer.invoke('ai:set-key', String(key ?? '')),
    clearKey: () => ipcRenderer.invoke('ai:clear-key'),
    models: () => ipcRenderer.invoke('ai:models'),
    setModel: id => ipcRenderer.invoke('ai:set-model', String(id ?? '')),
    generate: request => ipcRenderer.invoke('ai:generate', { action: String(request?.action ?? ''), text: String(request?.text ?? ''), context: String(request?.context ?? '') }),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
  }),
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: workspace => ipcRenderer.invoke('workspace:save', workspace),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  onSyncTick: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    ipcRenderer.on('sync:tick', listener)
    return () => ipcRenderer.removeListener('sync:tick', listener)
  },
  configureSync: (mode, workspace, code) => ipcRenderer.invoke('sync:configure', mode, workspace, code),
  exchangeSync: workspace => ipcRenderer.invoke('sync:exchange', workspace),
  publishSyncPdf: (workspace, input, bytes) => ipcRenderer.invoke('sync:pdf-publish', workspace, input, bytes),
  getSyncPdf: (workspace, input) => ipcRenderer.invoke('sync:pdf-get', workspace, input),
  acknowledgeSync: receipt => ipcRenderer.invoke('sync:acknowledge', receipt),
  resolveSync: (id, choice, currentRev) => ipcRenderer.invoke('sync:resolve', id, choice, currentRev),
  syncInvitation: address => ipcRenderer.invoke('sync:invitation', address),
  revokeSyncPeer: id => ipcRenderer.invoke('sync:revoke', id),
  setSyncKeepAwake: enabled => ipcRenderer.invoke('sync:keep-awake', enabled === true),
  syncFirewall: (address, refresh) => ipcRenderer.invoke('sync:firewall', address, refresh === true),
  updates: Object.freeze({
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    skip: () => ipcRenderer.invoke('update:skip'),
    setAutoCheck: enabled => ipcRenderer.invoke('update:auto-check', enabled),
    openPage: () => ipcRenderer.invoke('update:open-page'),
    onStatus: callback => {
      if (typeof callback !== 'function') return () => {}
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    },
  }),
  listBackups: () => ipcRenderer.invoke('workspace:backups'),
  backupWorkspace: () => ipcRenderer.invoke('workspace:backup'),
  readBackup: id => ipcRenderer.invoke('workspace:read-backup', id),
  environment: () => ipcRenderer.invoke('system:environment'),
  openHelp: topic => ipcRenderer.invoke('system:help', topic),
  parseLatexSource: source => ipcRenderer.invoke('latex:parse-source', source),
  lookupDoi: doi => ipcRenderer.invoke('citation:doi', doi),
  convertWord: (direction, input) => ipcRenderer.invoke('word:convert', direction, input),
  onFlushBeforeClose: callback => {
    if (typeof callback !== 'function') return () => {}
    closeFlushCallback = callback
    if (pendingCloseFlush) {
      pendingCloseFlush = false
      queueMicrotask(() => { if (closeFlushCallback === callback) callback() })
    }
    return () => { if (closeFlushCallback === callback) closeFlushCallback = undefined }
  },
  completeClose: saved => ipcRenderer.send(saved ? 'workspace:close-ready' : 'workspace:close-failed'),
  compileLatex: (latex, images, id, assets, fresh) => ipcRenderer.invoke('latex:compile', latex, images, id, assets, fresh),
  cancelCompile: id => ipcRenderer.send('latex:cancel', id),
  savePdf: (bytes, filename) => ipcRenderer.invoke('file:save-pdf', bytes, filename),
}))
