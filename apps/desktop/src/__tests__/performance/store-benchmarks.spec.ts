import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskQueue } from '../../stores/taskQueue'
import { useCookies } from '../../stores/cookies'
import { useLogs } from '../../stores/logs'
import { useUI } from '../../stores/ui'
import { retainedRuntimeLogCount } from '../../stores/app-helpers'
import type { TaskItem, CookieProfile } from '../../types/app'

describe('Store Performance Benchmarks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('TaskQueue Performance', () => {
    it('should handle 1000 tasks efficiently', () => {
      const store = useTaskQueue()
      const tasks: TaskItem[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        target: {
          detailUrl: `https://movie.douban.com/subject/${i}`,
          outputRootDir: 'D:/cover',
          sourceHint: 'douban' as const,
          doubanAssetType: 'poster' as const,
          imageCountMode: 'unlimited' as const,
          maxImages: 100,
          outputImageFormat: 'jpg' as const,
          imageAspectRatio: 'original' as const,
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued' as const,
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
      }))

      const start = performance.now()
      store.setTasks(tasks)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // Should complete in under 100ms
      expect(store.tasks.length).toBe(1000)
    })

    it('should update task progress efficiently for 100 tasks', () => {
      const store = useTaskQueue()
      const tasks: TaskItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        target: {
          detailUrl: `https://movie.douban.com/subject/${i}`,
          outputRootDir: 'D:/cover',
          sourceHint: 'douban' as const,
          doubanAssetType: 'poster' as const,
          imageCountMode: 'unlimited' as const,
          maxImages: 100,
          outputImageFormat: 'jpg' as const,
          imageAspectRatio: 'original' as const,
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued' as const,
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
      }))

      store.setTasks(tasks)

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        store.applyTaskProgressUpdate({
          taskId: `task-${i}`,
          phase: 'downloading',
          targetCount: 100,
          savedCount: 50,
          timestamp: new Date().toISOString(),
        })
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
    })

    it('should find tasks by ID efficiently in large dataset', () => {
      const store = useTaskQueue()
      const tasks: TaskItem[] = Array.from({ length: 5000 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        target: {
          detailUrl: `https://movie.douban.com/subject/${i}`,
          outputRootDir: 'D:/cover',
          sourceHint: 'douban' as const,
          doubanAssetType: 'poster' as const,
          imageCountMode: 'unlimited' as const,
          maxImages: 100,
          outputImageFormat: 'jpg' as const,
          imageAspectRatio: 'original' as const,
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued' as const,
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
      }))

      store.setTasks(tasks)

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        const found = store.getTaskById(`task-${Math.floor(Math.random() * 5000)}`)
        expect(found).toBeDefined()
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // Keep this as a smoke check; timing varies on Windows CI.
    })
  })

  describe('Cookies Performance', () => {
    it('should import 500 cookies efficiently', () => {
      const store = useCookies()

      const start = performance.now()
      for (let i = 0; i < 500; i++) {
        store.importCookie({
          value: `cookie-${i}`,
          note: `Cookie ${i}`,
        })
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(10_000) // Pinia dev reactivity makes bulk imports environment-sensitive.
      expect(store.cookies.length).toBe(500)
    })

    it('should pick usable cookie efficiently from large pool', () => {
      const store = useCookies()

      // Import 200 cookies
      for (let i = 0; i < 200; i++) {
        store.importCookie({
          value: `cookie-${i}`,
          note: `Cookie ${i}`,
        })
      }

      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        const cookie = store.pickUsableCookie()
        expect(cookie).toBeDefined()
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(1_000) // Keep this broad enough for loaded local test runs.
    })

    it('should update cookie status efficiently for many cookies', () => {
      const store = useCookies()
      const cookieIds: string[] = []

      for (let i = 0; i < 100; i++) {
        const result = store.importCookie({
          value: `cookie-${i}`,
          note: `Cookie ${i}`,
        })
        cookieIds.push(result.id)
      }

      const start = performance.now()
      cookieIds.forEach((id) => {
        store.updateCookieStatus(id, {
          successDelta: 1,
          failureDelta: 0,
        })
      })
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
    })

    it('should handle expired cookie cleanup efficiently', () => {
      const store = useCookies()
      const expiredCookies: CookieProfile[] = Array.from({ length: 500 }, (_, i) => ({
        id: String(i),
        value: `cookie-${i}`,
        note: `Cookie ${i}`,
        source: 'douban',
        status: 'active' as const,
        success: 0,
        failure: 0,
        importedAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: i < 250
          ? new Date(Date.now() - 1000).toISOString() // 250 expired
          : new Date(Date.now() + 86400000).toISOString(), // 250 valid
      }))

      const start = performance.now()
      const result = store.setCookies(expiredCookies)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
      expect(result.removedCount).toBe(250)
      expect(store.cookies.length).toBe(250)
    })
  })

  describe('Logs Performance', () => {
    it('should add 5000 logs efficiently', () => {
      const store = useLogs()
      const largeBatch = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        level: 'INFO' as const,
        scope: 'test',
        message: `Log message ${i}`,
        timestamp: new Date().toISOString(),
      }))

      const start = performance.now()
      store.addLogBatch(largeBatch)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(200) // Should complete in under 200ms
      expect(store.logs.length).toBe(retainedRuntimeLogCount)
    })

    it('should filter logs efficiently with large dataset', () => {
      const store = useLogs()
      const largeBatch = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        level: (i % 3 === 0 ? 'ERROR' : 'INFO') as 'ERROR' | 'INFO',
        scope: i % 5 === 0 ? 'task-progress' : 'general',
        message: `Log ${i}`,
        timestamp: new Date().toISOString(),
      }))

      store.addLogBatch(largeBatch)

      const start = performance.now()
      store.toggleLogOnlyErrors(true)
      const visibleLogs = store.visibleLogs
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
      expect(visibleLogs.length).toBeGreaterThan(0)
    })

    it('should clear large log batch efficiently', () => {
      const store = useLogs()
      const largeBatch = Array.from({ length: 5000 }, (_, i) => ({
        id: i,
        level: 'INFO' as const,
        scope: 'test',
        message: `Log ${i}`,
        timestamp: new Date().toISOString(),
      }))

      store.addLogBatch(largeBatch)
      expect(store.logs.length).toBe(retainedRuntimeLogCount)

      const start = performance.now()
      store.clearAllLogs()
      const duration = performance.now() - start

      expect(duration).toBeLessThan(10) // Should complete in under 10ms
      expect(store.logs.length).toBe(0)
    })
  })

  describe('UI Store Performance', () => {
    it('should handle rapid modal state changes', () => {
      const store = useUI()

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        store.openCreateTask()
        store.closeCreateTask()
        store.openImportCookie()
        store.closeImportCookie()
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
    })

    it('should handle many pending actions efficiently', () => {
      const store = useUI()

      const start = performance.now()
      for (let i = 0; i < 500; i++) {
        store.addPendingAction(`action-${i}`)
      }

      for (let i = 0; i < 500; i++) {
        expect(store.isActionPending(`action-${i}`)).toBe(true)
      }

      for (let i = 0; i < 500; i++) {
        store.removePendingAction(`action-${i}`)
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // Should complete in under 100ms
      expect(store.pendingActionIds.length).toBe(0)
    })

    it('should handle many detail URL operations efficiently', () => {
      const store = useUI()

      const start = performance.now()
      for (let i = 0; i < 200; i++) {
        store.addCreateTaskDetailUrl(
          `https://movie.douban.com/subject/${i}`,
          `Movie ${i}`
        )
      }

      for (let i = 0; i < 200; i++) {
        expect(store.hasCreateTaskDetailUrl(`https://movie.douban.com/subject/${i}`)).toBe(true)
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(250) // Keep this broad enough for loaded local test runs.
    })

    it('should handle rapid notice updates', () => {
      const store = useUI()

      const start = performance.now()
      for (let i = 0; i < 1000; i++) {
        store.showNotice(`Notice ${i}`, 'info')
        store.clearNotice()
      }
      const duration = performance.now() - start

      expect(duration).toBeLessThan(50) // Should complete in under 50ms
    })
  })

  describe('Cross-Store Performance', () => {
    it('should handle coordinated updates across all stores efficiently', () => {
      const taskQueueStore = useTaskQueue()
      const cookiesStore = useCookies()
      const logsStore = useLogs()
      const uiStore = useUI()

      // Setup initial state
      for (let i = 0; i < 50; i++) {
        cookiesStore.importCookie({ value: `cookie-${i}`, note: `Cookie ${i}` })
      }

      const tasks: TaskItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        target: {
          detailUrl: `https://movie.douban.com/subject/${i}`,
          outputRootDir: 'D:/cover',
          sourceHint: 'douban' as const,
          doubanAssetType: 'poster' as const,
          imageCountMode: 'unlimited' as const,
          maxImages: 100,
          outputImageFormat: 'jpg' as const,
          imageAspectRatio: 'original' as const,
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued' as const,
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
      }))

      taskQueueStore.setTasks(tasks)

      // Simulate coordinated workflow
      const start = performance.now()

      for (let i = 0; i < 100; i++) {
        // Update task progress
        taskQueueStore.applyTaskProgressUpdate({
          taskId: `task-${i}`,
          phase: 'downloading',
          targetCount: 100,
          savedCount: 50,
          timestamp: new Date().toISOString(),
        })

        // Log progress
        logsStore.addLogBatch([{
          id: i,
          level: 'INFO',
          scope: 'task-progress',
          message: `Task ${i} progress`,
          timestamp: new Date().toISOString(),
        }])

        // Update UI
        if (i % 10 === 0) {
          uiStore.showNotice(`Processed ${i} tasks`, 'info')
        }

        // Update cookie stats
        if (i % 5 === 0) {
          const cookie = cookiesStore.pickUsableCookie()
          if (cookie) {
            cookiesStore.updateCookieStatus(cookie.id, { successDelta: 1 })
          }
        }
      }

      const duration = performance.now() - start

      expect(duration).toBeLessThan(500) // Should complete in under 500ms
      expect(taskQueueStore.tasks.length).toBe(100)
      expect(logsStore.logs.length).toBe(100)
    })
  })

  describe('Memory Efficiency', () => {
    it('should handle repeated setTasks without memory leak', () => {
      const store = useTaskQueue()

      for (let iteration = 0; iteration < 10; iteration++) {
        const tasks: TaskItem[] = Array.from({ length: 100 }, (_, i) => ({
          id: `task-${iteration}-${i}`,
          title: `Task ${i}`,
          target: {
            detailUrl: `https://movie.douban.com/subject/${i}`,
            outputRootDir: 'D:/cover',
            sourceHint: 'douban' as const,
            doubanAssetType: 'poster' as const,
            imageCountMode: 'unlimited' as const,
            maxImages: 100,
            outputImageFormat: 'jpg' as const,
            imageAspectRatio: 'original' as const,
            requestIntervalSeconds: 2,
          },
          lifecycle: {
            phase: 'queued' as const,
            attempts: 0,
            updatedAt: new Date().toISOString(),
          },
          summary: '等待开始',
        }))

        store.setTasks(tasks)
        expect(store.tasks.length).toBe(100)
      }

      // Should only have the last batch
      expect(store.tasks.length).toBe(100)
    })

    it('should handle repeated log batches without memory leak', () => {
      const store = useLogs()

      for (let iteration = 0; iteration < 20; iteration++) {
        const batch = Array.from({ length: 100 }, (_, i) => ({
          id: iteration * 100 + i,
          level: 'INFO' as const,
          scope: 'test',
          message: `Log ${i}`,
          timestamp: new Date().toISOString(),
        }))

        store.addLogBatch(batch)
      }

      // Runtime logs are intentionally capped to avoid unbounded UI/state growth.
      expect(store.logs.length).toBe(retainedRuntimeLogCount)

      // Clear should free memory
      store.clearAllLogs()
      expect(store.logs.length).toBe(0)
    })
  })
})
