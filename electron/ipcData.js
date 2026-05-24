import { ipcMain } from 'electron'
import { createDataRepository } from './db.js'

export function registerDataIpc(repo = createDataRepository(), options = {}) {

  ipcMain.handle('velance:data:bootstrap', (_, { userId }) => {
    return repo.getBootstrap(userId)
  })

  ipcMain.handle('velance:data:backup:export', (_, { userId }) => {
    return repo.exportWorkspaceBackup(userId)
  })

  ipcMain.handle('velance:data:backup:restore', (_, { userId, backup }) => {
    return repo.restoreWorkspaceBackup(userId, backup)
  })

  ipcMain.handle('velance:data:sync:replaceSnapshot', (_, { userId, snapshot }) => {
    return repo.replaceSyncSnapshot(userId, snapshot)
  })

  ipcMain.handle('velance:data:sync:saveState', (_, { userId, syncState }) => {
    return repo.saveSyncState(userId, syncState)
  })

  ipcMain.handle('velance:data:settings:save', (_, { userId, settings }) => {
    return repo.saveSettings(userId, settings)
  })

  ipcMain.handle('velance:data:profile:save', (_, { userId, profile }) => {
    return repo.saveProfile(userId, profile)
  })

  ipcMain.handle('velance:data:tasks:upsert', (_, { userId, task }) => {
    return repo.upsertTask(userId, task)
  })

  ipcMain.handle('velance:data:tasks:delete', (_, { userId, taskId }) => {
    return repo.deleteTask(userId, taskId)
  })

  ipcMain.handle('velance:data:habits:upsert', (_, { userId, habit }) => {
    return repo.upsertHabit(userId, habit)
  })

  ipcMain.handle('velance:data:habits:delete', (_, { userId, habitId }) => {
    return repo.deleteHabit(userId, habitId)
  })

  ipcMain.handle('velance:data:sessions:upsert', (_, { userId, session }) => {
    return repo.upsertSession(userId, session)
  })

  ipcMain.handle('velance:data:sessions:deleteByHabit', (_, { userId, habitName }) => {
    return repo.deleteSessionsByHabit(userId, habitName)
  })

  ipcMain.handle('velance:data:sessions:delete', (_, { userId, sessionId }) => {
    return repo.deleteSession(userId, sessionId)
  })

  ipcMain.handle('velance:data:ambient:getRange', (_, { userId, dateKeys }) => {
    return repo.getAmbientRange(userId, dateKeys)
  })

  ipcMain.handle('velance:data:media:getRange', (_, { userId, dateKeys }) => {
    return repo.getMediaRange(userId, dateKeys)
  })

  ipcMain.handle('velance:data:browserEvents:getRange', (_, { userId, dateKeys }) => {
    return repo.getBrowserEventRange(userId, dateKeys)
  })

  ipcMain.handle('velance:data:tracking:getRange', (_, { userId, dateKeys }) => {
    return repo.getCombinedTrackingRange(userId, dateKeys)
  })

  ipcMain.handle('velance:data:ambient:upsert', (_, { userId, entry }) => {
    return repo.upsertAmbientEntry(userId, entry)
  })

  ipcMain.handle('velance:data:media:upsert', (_, { userId, entry }) => {
    return repo.upsertMediaEntry(userId, entry)
  })

  ipcMain.handle('velance:data:browserEvents:upsert', (_, { userId, entry }) => {
    return repo.upsertBrowserEvent(userId, entry)
  })

  ipcMain.handle('velance:data:customRules:get', (_, { userId }) => {
    return repo.getCustomRules(userId)
  })

  ipcMain.handle('velance:data:customRules:upsert', (_, { userId, matchText, rule }) => {
    return repo.upsertCustomRule(userId, matchText, rule)
  })

  ipcMain.handle('velance:data:customRules:delete', (_, { userId, matchText }) => {
    return repo.deleteCustomRule(userId, matchText)
  })

  ipcMain.handle('velance:data:insights:saveCache', (_, { userId, insights }) => {
    return repo.saveInsightCache(userId, insights)
  })

  ipcMain.handle('velance:data:insights:clearCache', (_, { userId }) => {
    return repo.clearInsightCache(userId)
  })

  ipcMain.handle('velance:data:insights:getFeedback', (_, { userId }) => {
    return repo.getInsightFeedback(userId)
  })

  ipcMain.handle('velance:data:insights:saveFeedback', (_, { userId, feedback }) => {
    return repo.saveInsightFeedback(userId, feedback)
  })

  ipcMain.handle('velance:data:migration:complete', (_, { userId }) => {
    return repo.markLegacyMigrationComplete(userId)
  })

  ipcMain.handle('velance:data:prune', (_, { userId, retentionDays }) => {
    return repo.pruneExpiredData(userId, retentionDays)
  })

  ipcMain.handle('velance:data:clearAll', (_, { userId }) => {
    return repo.clearAllUserData(userId)
  })

  ipcMain.handle('velance:data:tracking:reclassify', async (_, { userId }) => {
    return repo.reclassifyTrackingHistory(userId, {
      resolveClassificationEdgeCases: options.resolveClassificationEdgeCases,
    })
  })
}
