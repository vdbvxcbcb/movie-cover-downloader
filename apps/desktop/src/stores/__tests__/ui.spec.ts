import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUI } from '../ui'

describe('useUI', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Modal States', () => {
    it('should start with all modals closed', () => {
      const store = useUI()
      expect(store.createTaskOpen).toBe(false)
      expect(store.importCookieOpen).toBe(false)
      expect(store.searchMovieOpen).toBe(false)
      expect(store.customCropOpen).toBe(false)
      expect(store.imageProcessOpen).toBe(false)
      expect(store.expiredCookiePromptOpen).toBe(false)
    })

    it('should open and close create task modal', () => {
      const store = useUI()
      store.openCreateTask()
      expect(store.createTaskOpen).toBe(true)

      store.closeCreateTask()
      expect(store.createTaskOpen).toBe(false)
    })

    it('should open and close import cookie modal', () => {
      const store = useUI()
      store.openImportCookie()
      expect(store.importCookieOpen).toBe(true)

      store.closeImportCookie()
      expect(store.importCookieOpen).toBe(false)
    })

    it('should open and close search movie modal', () => {
      const store = useUI()
      store.openSearchMovie()
      expect(store.searchMovieOpen).toBe(true)

      store.closeSearchMovie()
      expect(store.searchMovieOpen).toBe(false)
    })
  })

  describe('Notice Management', () => {
    it('should show notice', () => {
      const store = useUI()
      store.showNotice('Test message', 'success')

      expect(store.notice).toBeDefined()
      expect(store.notice?.message).toBe('Test message')
      expect(store.notice?.tone).toBe('success')
    })

    it('should clear notice', () => {
      const store = useUI()
      store.showNotice('Test message')
      expect(store.notice).toBeDefined()

      store.clearNotice()
      expect(store.notice).toBeNull()
    })

    it('should support different notice tones', () => {
      const store = useUI()

      store.showNotice('Info', 'info')
      expect(store.notice?.tone).toBe('info')

      store.showNotice('Success', 'success')
      expect(store.notice?.tone).toBe('success')

      store.showNotice('Warning', 'warn')
      expect(store.notice?.tone).toBe('warn')
    })
  })

  describe('Pending Actions', () => {
    it('should track pending actions', () => {
      const store = useUI()
      expect(store.isActionPending('test-action')).toBe(false)

      store.addPendingAction('test-action')
      expect(store.isActionPending('test-action')).toBe(true)

      store.removePendingAction('test-action')
      expect(store.isActionPending('test-action')).toBe(false)
    })

    it('should handle multiple pending actions', () => {
      const store = useUI()

      store.addPendingAction('action1')
      store.addPendingAction('action2')

      expect(store.isActionPending('action1')).toBe(true)
      expect(store.isActionPending('action2')).toBe(true)

      store.removePendingAction('action1')

      expect(store.isActionPending('action1')).toBe(false)
      expect(store.isActionPending('action2')).toBe(true)
    })

    it('should not add duplicate pending actions', () => {
      const store = useUI()

      store.addPendingAction('test')
      store.addPendingAction('test')

      expect(store.pendingActionIds.filter(id => id === 'test')).toHaveLength(1)
    })
  })

  describe('Task Detail URLs', () => {
    it('should sync create task detail URLs', () => {
      const store = useUI()
      store.syncCreateTaskDetailUrls('https://movie.douban.com/subject/123')

      expect(store.createTaskDetailUrls).toBe('https://movie.douban.com/subject/123')
    })

    it('should add detail URL', () => {
      const store = useUI()
      const result = store.addCreateTaskDetailUrl('https://movie.douban.com/subject/123', 'Test Movie')

      expect(result).toBe(true)
      expect(store.createTaskDetailUrls).toContain('https://movie.douban.com/subject/123')
    })

    it('should not add duplicate detail URL', () => {
      const store = useUI()

      store.addCreateTaskDetailUrl('https://movie.douban.com/subject/123', 'Movie 1')
      const result = store.addCreateTaskDetailUrl('https://movie.douban.com/subject/123', 'Movie 2')

      expect(result).toBe(false)
    })

    it('should remove detail URL', () => {
      const store = useUI()

      store.addCreateTaskDetailUrl('https://movie.douban.com/subject/123', 'Movie')
      expect(store.hasCreateTaskDetailUrl('https://movie.douban.com/subject/123')).toBe(true)

      store.removeCreateTaskDetailUrl('https://movie.douban.com/subject/123')
      expect(store.hasCreateTaskDetailUrl('https://movie.douban.com/subject/123')).toBe(false)
    })
  })

  describe('Output Directory', () => {
    it('should sync create task output root dir', () => {
      const store = useUI()
      const changed = store.syncCreateTaskOutputRootDir('D:/movies')

      expect(changed).toBe(true)
      expect(store.createTaskOutputRootDir).toBe('D:/movies')
    })

    it('should not report change when value is same', () => {
      const store = useUI()

      store.syncCreateTaskOutputRootDir('D:/movies')
      const changed = store.syncCreateTaskOutputRootDir('D:/movies')

      expect(changed).toBe(false)
    })

    it('should provide custom crop output root dir', () => {
      const store = useUI()

      // Default fallback
      expect(store.customCropOutputRootDir).toBe('D:/cover')

      // Uses createTaskOutputRootDir when set
      store.syncCreateTaskOutputRootDir('D:/custom')
      expect(store.customCropOutputRootDir).toBe('D:/custom')
    })
  })

  describe('Expired Cookie Prompt', () => {
    it('should show expired cookie prompt', () => {
      const store = useUI()
      store.showExpiredCookiePrompt(3, '2024-01-01T00:00:00.000Z')

      expect(store.expiredCookiePromptOpen).toBe(true)
      expect(store.expiredCookieCount).toBe(3)
      expect(store.expiredCookieExpiresAt).toBe('2024-01-01T00:00:00.000Z')
    })

    it('should close expired cookie prompt', () => {
      const store = useUI()

      store.showExpiredCookiePrompt(2)
      store.closeExpiredCookiePrompt()

      expect(store.expiredCookiePromptOpen).toBe(false)
      expect(store.expiredCookieCount).toBe(0)
      expect(store.expiredCookieExpiresAt).toBeUndefined()
    })

    it('should open login from expired prompt', () => {
      const store = useUI()

      store.showExpiredCookiePrompt(1)
      store.openLoginFromExpiredPrompt()

      expect(store.expiredCookiePromptOpen).toBe(false)
      expect(store.importCookieOpen).toBe(true)
    })
  })

  describe('Draft Management', () => {
    it('should clear create task draft', () => {
      const store = useUI()

      store.syncCreateTaskDetailUrls('https://movie.douban.com/subject/123')
      store.upsertCreateTaskMoviePreview('https://movie.douban.com/subject/123', {
        title: 'Test Movie',
      })

      store.clearCreateTaskDraft()

      expect(store.createTaskDetailUrls).toBe('')
      expect(store.selectedPhotoDownloadSeed).toBeNull()
      expect(Object.keys(store.createTaskMoviePreviews)).toHaveLength(0)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle empty notice message', () => {
      const store = useUI()
      store.showNotice('')

      expect(store.notice?.message).toBe('')
    })

    it('should handle very long notice message', () => {
      const store = useUI()
      const longMessage = 'A'.repeat(1000)
      store.showNotice(longMessage)

      expect(store.notice?.message.length).toBe(1000)
    })

    it('should handle special characters in notice', () => {
      const store = useUI()
      const specialMessage = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`'
      store.showNotice(specialMessage)

      expect(store.notice?.message).toBe(specialMessage)
    })

    it('should handle Unicode in notice', () => {
      const store = useUI()
      const unicodeMessage = '测试通知 🎉'
      store.showNotice(unicodeMessage)

      expect(store.notice?.message).toBe(unicodeMessage)
    })

    it('should handle clearing notice when none exists', () => {
      const store = useUI()
      expect(store.notice).toBeNull()

      store.clearNotice()
      expect(store.notice).toBeNull()
    })

    it('should handle multiple notice updates', () => {
      const store = useUI()

      store.showNotice('Notice 1')
      store.showNotice('Notice 2')
      store.showNotice('Notice 3')

      expect(store.notice?.message).toBe('Notice 3')
    })

    it('should handle removing non-existent pending action', () => {
      const store = useUI()
      expect(store.pendingActionIds).toHaveLength(0)

      store.removePendingAction('non-existent')
      expect(store.pendingActionIds).toHaveLength(0)
    })

    it('should handle checking non-existent pending action', () => {
      const store = useUI()
      const result = store.isActionPending('non-existent')
      expect(result).toBe(false)
    })

    it('should handle empty action ID', () => {
      const store = useUI()
      store.addPendingAction('')
      expect(store.isActionPending('')).toBe(true)

      store.removePendingAction('')
      expect(store.isActionPending('')).toBe(false)
    })

    it('should handle many pending actions', () => {
      const store = useUI()

      for (let i = 0; i < 100; i++) {
        store.addPendingAction(`action-${i}`)
      }

      expect(store.pendingActionIds.length).toBe(100)

      for (let i = 0; i < 100; i++) {
        expect(store.isActionPending(`action-${i}`)).toBe(true)
      }
    })

    it('should handle invalid URL in addCreateTaskDetailUrl', () => {
      const store = useUI()
      const result = store.addCreateTaskDetailUrl('not-a-url', 'Test')

      expect(result).toBe(true) // Still adds it
      expect(store.createTaskDetailUrls).toContain('not-a-url')
    })

    it('should handle empty URL in addCreateTaskDetailUrl', () => {
      const store = useUI()
      const result = store.addCreateTaskDetailUrl('', 'Test')

      // Empty URL returns false because it's rejected after trimming
      expect(result).toBe(false)
      expect(store.createTaskDetailUrls).toBe('')
    })

    it('should handle removing non-existent detail URL', () => {
      const store = useUI()
      store.addCreateTaskDetailUrl('https://movie.douban.com/subject/123', 'Test')

      store.removeCreateTaskDetailUrl('https://movie.douban.com/subject/456')

      expect(store.hasCreateTaskDetailUrl('https://movie.douban.com/subject/123')).toBe(true)
    })

    it('should handle empty string in syncCreateTaskDetailUrls', () => {
      const store = useUI()
      store.syncCreateTaskDetailUrls('https://movie.douban.com/subject/123')
      store.syncCreateTaskDetailUrls('')

      expect(store.createTaskDetailUrls).toBe('')
    })

    it('should handle multiple URLs separated by newlines', () => {
      const store = useUI()
      const multipleUrls = 'https://movie.douban.com/subject/1\nhttps://movie.douban.com/subject/2'
      store.syncCreateTaskDetailUrls(multipleUrls)

      expect(store.createTaskDetailUrls).toBe(multipleUrls)
    })

    it('should handle empty directory path', () => {
      const store = useUI()
      // First set a non-empty value
      store.syncCreateTaskOutputRootDir('D:/movies')

      // Then set to empty
      const changed = store.syncCreateTaskOutputRootDir('')

      expect(changed).toBe(true)
      expect(store.createTaskOutputRootDir).toBe('')
    })

    it('should handle very long directory path', () => {
      const store = useUI()
      const longPath = 'D:/' + 'folder/'.repeat(100)
      store.syncCreateTaskOutputRootDir(longPath)

      expect(store.createTaskOutputRootDir).toBe(longPath)
    })

    it('should handle Windows and Unix path styles', () => {
      const store = useUI()

      store.syncCreateTaskOutputRootDir('D:/movies')
      expect(store.createTaskOutputRootDir).toBe('D:/movies')

      store.syncCreateTaskOutputRootDir('/home/user/movies')
      expect(store.createTaskOutputRootDir).toBe('/home/user/movies')
    })

    it('should handle opening multiple modals simultaneously', () => {
      const store = useUI()

      store.openCreateTask()
      store.openImportCookie()
      store.openSearchMovie()
      store.openCustomCrop()

      expect(store.createTaskOpen).toBe(true)
      expect(store.importCookieOpen).toBe(true)
      expect(store.searchMovieOpen).toBe(true)
      expect(store.customCropOpen).toBe(true)
    })

    it('should handle rapid modal toggles', () => {
      const store = useUI()

      for (let i = 0; i < 50; i++) {
        store.openCreateTask()
        store.closeCreateTask()
      }

      expect(store.createTaskOpen).toBe(false)
    })

    it('should handle zero expired cookie count', () => {
      const store = useUI()
      store.showExpiredCookiePrompt(0)

      expect(store.expiredCookiePromptOpen).toBe(true)
      expect(store.expiredCookieCount).toBe(0)
    })

    it('should handle negative expired cookie count', () => {
      const store = useUI()
      store.showExpiredCookiePrompt(-1)

      expect(store.expiredCookieCount).toBe(-1)
    })

    it('should handle missing expiration date', () => {
      const store = useUI()
      store.showExpiredCookiePrompt(5)

      expect(store.expiredCookieExpiresAt).toBeUndefined()
    })

    it('should handle clearing draft when already empty', () => {
      const store = useUI()
      expect(store.createTaskDetailUrls).toBe('')

      store.clearCreateTaskDraft()
      expect(store.createTaskDetailUrls).toBe('')
    })

    it('should handle upsertCreateTaskMoviePreview with empty URL', () => {
      const store = useUI()
      store.upsertCreateTaskMoviePreview('', { title: 'Test' })

      // Empty URL key is rejected (returns early due to !key check)
      expect(store.createTaskMoviePreviews['']).toBeUndefined()
    })

    it('should handle getCreateTaskMoviePreview with non-existent URL', () => {
      const store = useUI()
      const preview = store.getCreateTaskMoviePreview('https://non-existent')

      expect(preview).toBeUndefined()
    })
  })
})
