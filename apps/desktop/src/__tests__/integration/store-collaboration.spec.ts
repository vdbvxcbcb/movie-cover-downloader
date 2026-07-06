import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskQueue } from '../../stores/taskQueue'
import { useCookies } from '../../stores/cookies'
import { useUI } from '../../stores/ui'
import { useLogs } from '../../stores/logs'
import type { TaskItem } from '../../types/app'

describe('Store Collaboration - Integration Tests', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Task Creation Flow', () => {
    it('should coordinate UI, TaskQueue, and Cookies stores when creating a task', () => {
      const uiStore = useUI()
      const taskQueueStore = useTaskQueue()
      const cookiesStore = useCookies()

      // Step 1: User opens create task modal (UI store)
      uiStore.openCreateTask()
      expect(uiStore.createTaskOpen).toBe(true)

      // Step 2: User adds task URLs (UI store)
      const url = 'https://movie.douban.com/subject/123'
      uiStore.addCreateTaskDetailUrl(url, 'Test Movie')
      expect(uiStore.hasCreateTaskDetailUrl(url)).toBe(true)

      // Step 3: User sets output directory (UI store)
      uiStore.syncCreateTaskOutputRootDir('D:/movies')
      expect(uiStore.createTaskOutputRootDir).toBe('D:/movies')

      // Step 4: Import cookie (Cookies store)
      cookiesStore.importCookie({
        value: 'test-cookie',
        note: 'Test Cookie',
      })
      expect(cookiesStore.cookies).toHaveLength(1)

      // Step 5: Create task (TaskQueue store)
      const mockTask: TaskItem = {
        id: taskQueueStore.nextTaskId(),
        title: 'Test Movie',
        target: {
          detailUrl: url,
          outputRootDir: uiStore.createTaskOutputRootDir,
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued',
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
        outputDirectory: undefined,
        coverUrl: undefined,
        coverDataUrl: undefined,
      }

      taskQueueStore.setTasks([mockTask])
      expect(taskQueueStore.tasks).toHaveLength(1)

      // Step 6: Close modal and clear draft (UI store)
      uiStore.closeCreateTask()
      uiStore.clearCreateTaskDraft()
      expect(uiStore.createTaskOpen).toBe(false)
      expect(uiStore.createTaskDetailUrls).toBe('')
    })
  })

  describe('Cookie Rotation Flow', () => {
    it('should coordinate Cookies and TaskQueue stores during cookie rotation', () => {
      const cookiesStore = useCookies()
      const taskQueueStore = useTaskQueue()

      // Import multiple cookies
      const cookie1 = cookiesStore.importCookie({ value: 'cookie1', note: 'Cookie 1' })
      const cookie2 = cookiesStore.importCookie({ value: 'cookie2', note: 'Cookie 2' })
      const cookie3 = cookiesStore.importCookie({ value: 'cookie3', note: 'Cookie 3' })

      expect(cookiesStore.cookies).toHaveLength(3)

      // Create task with first cookie
      const task: TaskItem = {
        id: 'task-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/movies',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'downloading',
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '下载中',
      }

      taskQueueStore.setTasks([task])

      // First cookie fails, update status
      cookiesStore.updateCookieStatus(cookie1.id, {
        status: 'cooling',
        failureDelta: 1,
      })

      const coolingCookie = cookiesStore.cookies.find(c => c.id === cookie1.id)
      expect(coolingCookie?.status).toBe('cooling')

      // Pick next usable cookie
      const nextCookie = cookiesStore.pickUsableCookie()
      expect(nextCookie?.id).not.toBe(cookie1.id)
      expect([cookie2.id, cookie3.id]).toContain(nextCookie?.id)
    })
  })

  describe('Task Progress and Logging Flow', () => {
    it('should coordinate TaskQueue and Logs stores during task execution', () => {
      const taskQueueStore = useTaskQueue()
      const logsStore = useLogs()

      // Create a task
      const task: TaskItem = {
        id: 'task-1',
        title: 'Test Movie',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/movies',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued',
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
        outputDirectory: undefined,
        coverUrl: undefined,
        coverDataUrl: undefined,
      }

      taskQueueStore.setTasks([task])

      // Log task start
      logsStore.addLogBatch([{
        id: 1,
        level: 'INFO',
        scope: 'task',
        message: 'Task started: Test Movie',
        timestamp: new Date().toISOString(),
      }])

      // Update task progress
      taskQueueStore.applyTaskProgressUpdate({
        taskId: 'task-1',
        phase: 'downloading',
        targetCount: 10,
        savedCount: 5,
        timestamp: new Date().toISOString(),
      })

      const updatedTask = taskQueueStore.getTaskById('task-1')
      expect(updatedTask?.download?.savedCount).toBe(5)
      expect(updatedTask?.download?.targetCount).toBe(10)

      // Log progress
      logsStore.addLogBatch([{
        id: 2,
        level: 'INFO',
        scope: 'task-progress',
        message: 'Progress: 5/10',
        timestamp: new Date().toISOString(),
      }])

      // Task completes
      taskQueueStore.applyTaskProgressUpdate({
        taskId: 'task-1',
        phase: 'completed',
        targetCount: 10,
        savedCount: 10,
        timestamp: new Date().toISOString(),
      })
      const currentTask = taskQueueStore.getTaskById('task-1')
      if (currentTask) {
        taskQueueStore.replaceTask({
          ...currentTask,
          lifecycle: { phase: 'completed', attempts: 0, updatedAt: new Date().toISOString() },
          summary: '已完成',
        })
      }

      // Log completion
      logsStore.addLogBatch([{
        id: 3,
        level: 'INFO',
        scope: 'task',
        message: 'Task completed: Test Movie',
        timestamp: new Date().toISOString(),
      }])

      expect(logsStore.logs.length).toBe(3)

      const completedTask = taskQueueStore.getTaskById('task-1')
      expect(completedTask?.lifecycle.phase).toBe('completed')
    })
  })

  describe('Error Handling Flow', () => {
    it('should coordinate all stores when a task fails', () => {
      const taskQueueStore = useTaskQueue()
      const cookiesStore = useCookies()
      const logsStore = useLogs()
      const uiStore = useUI()

      // Setup: Create cookie and task
      const cookie = cookiesStore.importCookie({ value: 'test', note: 'Test' })

      const task: TaskItem = {
        id: 'task-1',
        title: 'Test Movie',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/movies',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'downloading',
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '下载中',
      }

      taskQueueStore.setTasks([task])

      // Task fails
      const currentFailedTask = taskQueueStore.getTaskById('task-1')
      if (currentFailedTask) {
        taskQueueStore.replaceTask({
          ...currentFailedTask,
          lifecycle: { phase: 'failed', attempts: 1, updatedAt: new Date().toISOString() },
          summary: '失败',
        })
      }

      // Update cookie failure count
      cookiesStore.updateCookieStatus(cookie.id, {
        failureDelta: 1,
      })

      // Log error
      logsStore.addLogBatch([{
        id: 1,
        level: 'ERROR',
        scope: 'task',
        message: 'Task failed: Test Movie - Network error',
        timestamp: new Date().toISOString(),
      }])

      // Show notice to user
      uiStore.showNotice('Task failed: Test Movie', 'warn')

      // Verify all stores updated correctly
      const failedTask = taskQueueStore.getTaskById('task-1')
      expect(failedTask?.lifecycle.phase).toBe('failed')
      expect(failedTask?.lifecycle.attempts).toBe(1)

      const updatedCookie = cookiesStore.cookies.find(c => c.id === cookie.id)
      expect(updatedCookie?.failure).toBe(1)

      expect(logsStore.logs.length).toBe(1)
      expect(logsStore.logs[0]?.level).toBe('ERROR')

      expect(uiStore.notice?.tone).toBe('warn')
    })
  })

  describe('Queue Control Flow', () => {
    it('should coordinate TaskQueue and UI stores during queue operations', () => {
      const taskQueueStore = useTaskQueue()
      const uiStore = useUI()

      // Create multiple tasks
      const tasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Movie 1',
          target: {
            detailUrl: 'https://movie.douban.com/subject/1',
            outputRootDir: 'D:/movies',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2,
          },
          lifecycle: { phase: 'queued', attempts: 0, updatedAt: new Date().toISOString() },
          summary: '等待开始',
          outputDirectory: undefined,
          coverUrl: undefined,
          coverDataUrl: undefined,
        },
        {
          id: 'task-2',
          title: 'Movie 2',
          target: {
            detailUrl: 'https://movie.douban.com/subject/2',
            outputRootDir: 'D:/movies',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2,
          },
          lifecycle: { phase: 'queued', attempts: 0, updatedAt: new Date().toISOString() },
          summary: '等待开始',
          outputDirectory: undefined,
          coverUrl: undefined,
          coverDataUrl: undefined,
        },
      ]

      taskQueueStore.setTasks(tasks)

      // Start queue
      uiStore.addPendingAction('queue.start')
      taskQueueStore.queueRunning = true

      expect(taskQueueStore.queueRunning).toBe(true)
      expect(uiStore.isActionPending('queue.start')).toBe(true)

      uiStore.removePendingAction('queue.start')

      // Stop queue
      uiStore.addPendingAction('queue.stop')
      taskQueueStore.queueRunning = false

      expect(taskQueueStore.queueRunning).toBe(false)
      expect(uiStore.isActionPending('queue.stop')).toBe(true)

      uiStore.removePendingAction('queue.stop')
    })
  })

  describe('Batch Operations Flow', () => {
    it('should handle batch task operations across stores', () => {
      const taskQueueStore = useTaskQueue()
      const cookiesStore = useCookies()
      const logsStore = useLogs()

      // Import multiple cookies
      cookiesStore.importCookie({ value: 'cookie1', note: 'Cookie 1' })
      cookiesStore.importCookie({ value: 'cookie2', note: 'Cookie 2' })

      // Create multiple tasks
      const tasks: TaskItem[] = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i + 1}`,
        title: `Movie ${i + 1}`,
        target: {
          detailUrl: `https://movie.douban.com/subject/${i + 1}`,
          outputRootDir: 'D:/movies',
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
      expect(taskQueueStore.tasks).toHaveLength(5)

      // Log batch operation
      logsStore.addLogBatch(
        tasks.map((task, i) => ({
          id: i + 1,
          level: 'INFO' as const,
          scope: 'batch',
          message: `Task created: ${task.title}`,
          timestamp: new Date().toISOString(),
        }))
      )

      expect(logsStore.logs.length).toBe(5)

      // Verify all tasks created
      expect(tasks.every(t => t.lifecycle.phase === 'queued')).toBe(true)
    })
  })

  describe('Complete User Workflow', () => {
    it('should simulate a complete user workflow from start to finish', () => {
      const uiStore = useUI()
      const taskQueueStore = useTaskQueue()
      const cookiesStore = useCookies()
      const logsStore = useLogs()

      // 1. User imports a cookie
      uiStore.openImportCookie()
      const cookie = cookiesStore.importCookie({ value: 'user-cookie', note: 'My Cookie' })
      uiStore.closeImportCookie()
      uiStore.showNotice('Cookie imported successfully', 'success')

      expect(cookiesStore.cookies).toHaveLength(1)

      // 2. User creates a task
      uiStore.openCreateTask()
      const url = 'https://movie.douban.com/subject/12345'
      uiStore.addCreateTaskDetailUrl(url, 'My Favorite Movie')
      uiStore.syncCreateTaskOutputRootDir('D:/MyMovies')

      const taskId = taskQueueStore.nextTaskId()
      const task: TaskItem = {
        id: taskId,
        title: 'My Favorite Movie',
        target: {
          detailUrl: url,
          outputRootDir: 'D:/MyMovies',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2,
        },
        lifecycle: {
          phase: 'queued',
          attempts: 0,
          updatedAt: new Date().toISOString(),
        },
        summary: '等待开始',
      }

      taskQueueStore.setTasks([task])
      uiStore.closeCreateTask()
      uiStore.clearCreateTaskDraft()

      logsStore.addLogBatch([{
        id: 1,
        level: 'INFO',
        scope: 'task',
        message: 'Task created: My Favorite Movie',
        timestamp: new Date().toISOString(),
      }])

      // 3. User starts the queue
      taskQueueStore.queueRunning = true
      expect(taskQueueStore.queueRunning).toBe(true)

      // 4. Task executes and completes
      taskQueueStore.applyTaskProgressUpdate({
        taskId,
        phase: 'completed',
        targetCount: 50,
        savedCount: 50,
        timestamp: new Date().toISOString(),
      })
      cookiesStore.updateCookieStatus(cookie.id, { successDelta: 1 })

      const completingTask = taskQueueStore.getTaskById(taskId)
      if (completingTask) {
        taskQueueStore.replaceTask({
          ...completingTask,
          lifecycle: { phase: 'completed', attempts: 0, updatedAt: new Date().toISOString() },
          summary: '已完成',
        })
      }

      logsStore.addLogBatch([{
        id: 2,
        level: 'INFO',
        scope: 'task',
        message: 'Task completed: My Favorite Movie',
        timestamp: new Date().toISOString(),
      }])

      uiStore.showNotice('Task completed successfully', 'success')

      // Verify final state
      const completedTask = taskQueueStore.getTaskById(taskId)
      expect(completedTask?.lifecycle.phase).toBe('completed')
      expect(completedTask?.download?.savedCount).toBe(50)

      const usedCookie = cookiesStore.cookies.find(c => c.id === cookie.id)
      expect(usedCookie?.success).toBe(1)

      expect(logsStore.logs.length).toBe(2)
      expect(uiStore.notice?.message).toBe('Task completed successfully')
    })
  })
})
