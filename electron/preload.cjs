const { contextBridge, ipcRenderer } = require('electron')

const velanceApi = {
  startTracking: () => ipcRenderer.send('velance:start-tracking'),
  stopTracking: () => ipcRenderer.send('velance:stop-tracking'),
  onTrackingData: (callback) => {
    ipcRenderer.on('velance:tracking-data', (_, data) => callback(data))
  },
  onKeystroke: (callback) => {
    ipcRenderer.on('velance:keystroke', (_, data) => callback(data))
  },
  removeTrackingListeners: () => {
    ipcRenderer.removeAllListeners('velance:tracking-data')
    ipcRenderer.removeAllListeners('velance:keystroke')
  },
  onAmbientData: (callback) => {
    ipcRenderer.on('velance:ambient-data', (_, data) => callback(data))
  },
  removeAmbientListener: () => {
    ipcRenderer.removeAllListeners('velance:ambient-data')
  },
  onMediaData: (callback) => {
    ipcRenderer.on('velance:media-data', (_, data) => callback(data))
  },
  removeMediaListener: () => {
    ipcRenderer.removeAllListeners('velance:media-data')
  },
  flushAmbient: () => ipcRenderer.send('velance:flush-ambient'),
  onProductivityPulse: (callback) => {
    ipcRenderer.on('velance:productivity-pulse', (_, data) => callback(data))
  },
  removeProductivityPulseListener: () => {
    ipcRenderer.removeAllListeners('velance:productivity-pulse')
  },
  setTrackingUser: (userId) => ipcRenderer.send('velance:tracking:set-user', userId),
  minimizeWindow: () => ipcRenderer.send('velance:window:minimize'),
  notify: (title, body) => ipcRenderer.send('velance:notify', { title, body }),
  runtime: {
    applyPolicy: (data) => ipcRenderer.invoke('velance:runtime:apply-policy', data),
    getBrowserBridgeStatus: () => ipcRenderer.invoke('velance:runtime:browser-bridge-status'),
  },
  insights: {
    generate: (data) => ipcRenderer.invoke('velance:insights:generate', data),
  },
  ai: {
    test: (data) => ipcRenderer.invoke('velance:ai:test', data),
  },
  analysis: {
    explainDay: (data) => ipcRenderer.invoke('velance:analysis:explain-day', data),
  },
  auth: {
    loginWithGoogleSupabase: (data) => ipcRenderer.invoke('velance:auth-google-supabase', data),
  },
    data: {
        getBootstrap: (data) => ipcRenderer.invoke('velance:data:bootstrap', data),
        exportWorkspaceBackup: (data) => ipcRenderer.invoke('velance:data:backup:export', data),
        restoreWorkspaceBackup: (data) => ipcRenderer.invoke('velance:data:backup:restore', data),
        replaceSyncSnapshot: (data) => ipcRenderer.invoke('velance:data:sync:replaceSnapshot', data),
        saveSyncState: (data) => ipcRenderer.invoke('velance:data:sync:saveState', data),
        saveSettings: (data) => ipcRenderer.invoke('velance:data:settings:save', data),
    saveProfile: (data) => ipcRenderer.invoke('velance:data:profile:save', data),
    upsertTask: (data) => ipcRenderer.invoke('velance:data:tasks:upsert', data),
    deleteTask: (data) => ipcRenderer.invoke('velance:data:tasks:delete', data),
    upsertHabit: (data) => ipcRenderer.invoke('velance:data:habits:upsert', data),
    deleteHabit: (data) => ipcRenderer.invoke('velance:data:habits:delete', data),
    upsertSession: (data) => ipcRenderer.invoke('velance:data:sessions:upsert', data),
    deleteSessionsByHabit: (data) => ipcRenderer.invoke('velance:data:sessions:deleteByHabit', data),
    deleteSession: (data) => ipcRenderer.invoke('velance:data:sessions:delete', data),
    getAmbientRange: (data) => ipcRenderer.invoke('velance:data:ambient:getRange', data),
    getMediaRange: (data) => ipcRenderer.invoke('velance:data:media:getRange', data),
    getBrowserEventRange: (data) => ipcRenderer.invoke('velance:data:browserEvents:getRange', data),
    getCombinedTrackingRange: (data) => ipcRenderer.invoke('velance:data:tracking:getRange', data),
    upsertAmbientEntry: (data) => ipcRenderer.invoke('velance:data:ambient:upsert', data),
    upsertMediaEntry: (data) => ipcRenderer.invoke('velance:data:media:upsert', data),
    upsertBrowserEvent: (data) => ipcRenderer.invoke('velance:data:browserEvents:upsert', data),
    getCustomRules: (data) => ipcRenderer.invoke('velance:data:customRules:get', data),
    upsertCustomRule: (data) => ipcRenderer.invoke('velance:data:customRules:upsert', data),
    deleteCustomRule: (data) => ipcRenderer.invoke('velance:data:customRules:delete', data),
    saveInsightCache: (data) => ipcRenderer.invoke('velance:data:insights:saveCache', data),
    clearInsightCache: (data) => ipcRenderer.invoke('velance:data:insights:clearCache', data),
    getInsightFeedback: (data) => ipcRenderer.invoke('velance:data:insights:getFeedback', data),
    saveInsightFeedback: (data) => ipcRenderer.invoke('velance:data:insights:saveFeedback', data),
    markLegacyMigrationComplete: (data) => ipcRenderer.invoke('velance:data:migration:complete', data),
    pruneExpiredData: (data) => ipcRenderer.invoke('velance:data:prune', data),
    clearAll: (data) => ipcRenderer.invoke('velance:data:clearAll', data),
    reclassifyTrackingHistory: (data) => ipcRenderer.invoke('velance:data:tracking:reclassify', data),
  },
}

contextBridge.exposeInMainWorld('velance', velanceApi)
