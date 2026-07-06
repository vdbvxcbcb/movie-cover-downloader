import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskQueue } from '../taskQueue'
import type { TaskItem } from '../../types/app'

describe('useTaskQueue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Task ID Generation', () => {
    it('should generate unique task IDs', () => {
      const store = useTaskQueue()
      const id1 = store.nextTaskId()
      const id2 = store.nextTaskId()

      expect(id1).toMatch(/^task-\d+-\d+$/)
      expect(id2).toMatch(/^task-\d+-\d+$/)
      expect(id1).not.toBe(id2)
    })

    it('should generate incrementing sequence numbers', () => {
      const store = useTaskQueue()
      const id1 = store.nextTaskId()
      const id2 = store.nextTaskId()

      const seq1 = Number(id1.split('-')[2])
      const seq2 = Number(id2.split('-')[2])

      expect(seq2).toBe(seq1 + 1)
    })
  })

  describe('Task Management', () => {
    it('should add tasks to the store', () => {
      const store = useTaskQueue()
      const mockTasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Test Task',
          target: {
            detailUrl: 'https://movie.douban.com/subject/123',
            outputRootDir: 'D:/cover',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2 as const,
          },
          lifecycle: {
            phase: 'queued',
            attempts: 0,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          summary: '等待开始',
        },
      ]

      store.setTasks(mockTasks)
      expect(store.tasks).toHaveLength(1)
      expect(store.tasks[0]?.id).toBe('task-1')
    })

    it('should find task by ID', () => {
      const store = useTaskQueue()
      const mockTask: TaskItem = {
        id: 'task-test-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/cover',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'queued',
          attempts: 0,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        summary: '等待开始',
      }

      store.setTasks([mockTask])
      const found = store.getTaskById('task-test-1')

      expect(found).toBeDefined()
      expect(found?.id).toBe('task-test-1')
    })

    it('should return undefined for non-existent task ID', () => {
      const store = useTaskQueue()
      const found = store.getTaskById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('Task Progress', () => {
    it('should update task progress', () => {
      const store = useTaskQueue()
      const mockTask: TaskItem = {
        id: 'task-progress-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/cover',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'downloading',
          attempts: 1,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        summary: '正在下载',
      }

      store.setTasks([mockTask])

      const updated = store.applyTaskProgressUpdate({
        taskId: 'task-progress-1',
        phase: 'downloading',
        targetCount: 10,
        savedCount: 5,
        timestamp: '2024-01-01T00:01:00.000Z',
      })

      expect(updated).toBe(true)
      expect(store.progressTick).toBeGreaterThan(0)

      const task = store.getTaskById('task-progress-1')
      expect(task?.download?.savedCount).toBe(5)
      expect(task?.download?.targetCount).toBe(10)
    })

    it('should not update progress for terminal phase tasks', () => {
      const store = useTaskQueue()
      const mockTask: TaskItem = {
        id: 'task-completed-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/cover',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'completed',
          attempts: 1,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        summary: '已完成',
      }

      store.setTasks([mockTask])

      const updated = store.applyTaskProgressUpdate({
        taskId: 'task-completed-1',
        phase: 'downloading',
        targetCount: 10,
        savedCount: 5,
        timestamp: '2024-01-01T00:01:00.000Z',
      })

      expect(updated).toBe(false)
    })
  })

  describe('Task Cooling', () => {
    it('should identify cooling tasks', () => {
      const store = useTaskQueue()
      const futureTime = new Date(Date.now() + 60000).toISOString()
      const mockTask: TaskItem = {
        id: 'task-cooling-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/cover',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'failed',
          attempts: 1,
          updatedAt: '2024-01-01T00:00:00.000Z',
          cooldownUntil: futureTime,
        },
        summary: '失败，冷却中',
      }

      expect(store.isCooling(mockTask)).toBe(true)
    })

    it('should identify non-cooling tasks', () => {
      const store = useTaskQueue()
      const pastTime = new Date(Date.now() - 60000).toISOString()
      const mockTask: TaskItem = {
        id: 'task-no-cooling-1',
        title: 'Test Task',
        target: {
          detailUrl: 'https://movie.douban.com/subject/123',
          outputRootDir: 'D:/cover',
          sourceHint: 'douban',
          doubanAssetType: 'poster',
          imageCountMode: 'unlimited',
          maxImages: 100,
          outputImageFormat: 'jpg',
          imageAspectRatio: 'original',
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'failed',
          attempts: 1,
          updatedAt: '2024-01-01T00:00:00.000Z',
          cooldownUntil: pastTime,
        },
        summary: '失败',
      }

      expect(store.isCooling(mockTask)).toBe(false)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle invalid task IDs', () => {
      const store = useTaskQueue()
      const result = store.getTaskById('')
      expect(result).toBeUndefined()
    })

    it('should handle null values gracefully', () => {
      const store = useTaskQueue()
      const result = store.getTaskById(null as any)
      expect(result).toBeUndefined()
    })

    it('should handle undefined task properties', () => {
      const store = useTaskQueue()
      const invalidTask = {
        id: 'task-1',
        // Missing required fields
      }
      // @ts-expect-error Testing invalid task
      store.setTasks([invalidTask])
      expect(store.tasks.length).toBe(1)
    })

    it('should handle empty string in applyTaskProgressUpdate', () => {
      const store = useTaskQueue()
      const mockTasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Test Task',
          target: {
            detailUrl: 'https://movie.douban.com/subject/123',
            outputRootDir: 'D:/cover',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2 as const,
          },
          lifecycle: {
            phase: 'downloading',
            attempts: 1,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          summary: '正在下载',
        },
      ]
      store.setTasks(mockTasks)

      const updated = store.applyTaskProgressUpdate({
        taskId: '',
        phase: 'downloading',
        targetCount: 10,
        savedCount: 5,
        timestamp: '2024-01-01T00:01:00.000Z',
      })
      expect(updated).toBe(false) // Should not update with empty taskId
    })

    it('should handle negative progress values', () => {
      const store = useTaskQueue()
      const mockTasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Test Task',
          target: {
            detailUrl: 'https://movie.douban.com/subject/123',
            outputRootDir: 'D:/cover',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2 as const,
          },
          lifecycle: {
            phase: 'downloading',
            attempts: 1,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          summary: '正在下载',
        },
      ]
      store.setTasks(mockTasks)

      store.applyTaskProgressUpdate({
        taskId: 'task-1',
        phase: 'downloading',
        targetCount: -5,
        savedCount: -3,
        timestamp: '2024-01-01T00:01:00.000Z',
      })
      const task = store.tasks[0]
      // Math.min(-3, -5) = -5, so savedCount is clamped to the minimum of savedCount and targetCount
      expect(task?.download?.savedCount).toBe(-5)
      expect(task?.download?.targetCount).toBe(-5)
    })

    it('should handle very large task arrays', () => {
      const store = useTaskQueue()
      const largeBatch = Array.from({ length: 10000 }, (_, i) => ({
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
          requestIntervalSeconds: 2 as const,
        },
        lifecycle: {
          phase: 'queued' as const,
          attempts: 0,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        summary: '等待开始',
      }))

      store.setTasks(largeBatch)
      expect(store.tasks.length).toBe(10000)
    })

    it('should handle duplicate task IDs', () => {
      const store = useTaskQueue()
      const mockTasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Task A',
          target: {
            detailUrl: 'https://movie.douban.com/subject/123',
            outputRootDir: 'D:/cover',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2 as const,
          },
          lifecycle: {
            phase: 'queued',
            attempts: 0,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          summary: '等待开始',
        },
        {
          id: 'task-1', // Duplicate ID
          title: 'Task B',
          target: {
            detailUrl: 'https://movie.douban.com/subject/456',
            outputRootDir: 'D:/cover',
            sourceHint: 'douban',
            doubanAssetType: 'poster',
            imageCountMode: 'unlimited',
            maxImages: 100,
            outputImageFormat: 'jpg',
            imageAspectRatio: 'original',
            requestIntervalSeconds: 2 as const,
          },
          lifecycle: {
            phase: 'queued',
            attempts: 0,
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          summary: '等待开始',
        },
      ]

      store.setTasks(mockTasks)
      expect(store.tasks.length).toBe(2) // Allows duplicates
      const found = store.getTaskById('task-1')
      expect(found?.title).toBe('Task B') // Returns last match (Map overwrites)
    })

    it('should handle missing cooldownUntil field', () => {
      const store = useTaskQueue()
      const taskWithoutCooldown = {
        id: 'task-1',
        lifecycle: {
          phase: 'failed' as const,
          attempts: 1,
          updatedAt: '2024-01-01T00:00:00.000Z',
          // cooldownUntil missing
        },
      }

      // @ts-expect-error Testing missing field
      const result = store.isCooling(taskWithoutCooldown)
      expect(result).toBe(false)
    })
  })
})
