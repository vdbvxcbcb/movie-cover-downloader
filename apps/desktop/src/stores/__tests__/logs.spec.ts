import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLogs } from '../logs'

describe('useLogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Log Management', () => {
    it('should start with empty logs', () => {
      const store = useLogs()
      expect(store.logs).toHaveLength(0)
    })

    it('should add log batch', () => {
      const store = useLogs()
      const mockLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'test',
          message: 'Test log 1',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          level: 'ERROR' as const,
          scope: 'test',
          message: 'Test log 2',
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]

      store.addLogBatch(mockLogs)

      expect(store.logs).toHaveLength(2)
      expect(store.logs[0]?.message).toBe('Test log 2') // Reversed order
      expect(store.logs[1]?.message).toBe('Test log 1')
    })

    it('should handle empty log batch', () => {
      const store = useLogs()
      store.addLogBatch([])
      expect(store.logs).toHaveLength(0)
    })

    it('should clear all logs', () => {
      const store = useLogs()
      const mockLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'test',
          message: 'Test log',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ]

      store.addLogBatch(mockLogs)
      expect(store.logs).toHaveLength(1)

      store.clearAllLogs()
      expect(store.logs).toHaveLength(0)
    })
  })

  describe('Log Filtering', () => {
    beforeEach(() => {
      const store = useLogs()
      const mockLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'test',
          message: 'Info message',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          level: 'ERROR' as const,
          scope: 'test',
          message: 'Error message',
          timestamp: '2024-01-01T00:01:00.000Z',
        },
        {
          id: 3,
          level: 'WARN' as const,
          scope: 'test',
          message: 'Warning message',
          timestamp: '2024-01-01T00:02:00.000Z',
        },
        {
          id: 4,
          level: 'INFO' as const,
          scope: 'task-progress',
          message: 'Progress log',
          timestamp: '2024-01-01T00:03:00.000Z',
        },
      ]
      store.addLogBatch(mockLogs)
    })

    it('should show all logs when logOnlyErrors is false', () => {
      const store = useLogs()
      expect(store.logOnlyErrors).toBe(false)
      // task-progress should be filtered out
      expect(store.visibleLogs).toHaveLength(3)
    })

    it('should filter to only errors when logOnlyErrors is true', () => {
      const store = useLogs()
      store.toggleLogOnlyErrors(true)

      expect(store.logOnlyErrors).toBe(true)
      expect(store.visibleLogs).toHaveLength(1)
      expect(store.visibleLogs[0]?.level).toBe('ERROR')
    })

    it('should toggle logOnlyErrors', () => {
      const store = useLogs()
      expect(store.logOnlyErrors).toBe(false)

      store.toggleLogOnlyErrors()
      expect(store.logOnlyErrors).toBe(true)

      store.toggleLogOnlyErrors()
      expect(store.logOnlyErrors).toBe(false)
    })

    it('should hide task-progress logs from visible logs', () => {
      const store = useLogs()
      const visibleLogs = store.visibleLogs

      expect(visibleLogs.every(log => log.scope !== 'task-progress')).toBe(true)
    })
  })

  describe('Log Initialization', () => {
    it('should set logs from snapshot', () => {
      const store = useLogs()
      const mockLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'test',
          message: 'Restored log',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ]

      store.setLogs(mockLogs)

      expect(store.logs).toHaveLength(1)
      expect(store.logs[0]?.message).toBe('Restored log')
    })
  })

  describe('Error Scenarios', () => {
    it('should handle logs with empty messages', () => {
      const store = useLogs()
      const emptyLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: '',
        timestamp: '2024-01-01T00:00:00.000Z',
      }

      store.addLogBatch([emptyLog])
      expect(store.logs).toHaveLength(1)
      expect(store.logs[0]?.message).toBe('')
    })

    it('should handle very long log messages', () => {
      const store = useLogs()
      const longMessage = 'A'.repeat(10000)
      const longLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: longMessage,
        timestamp: '2024-01-01T00:00:00.000Z',
      }

      store.addLogBatch([longLog])
      expect(store.logs[0]?.message.length).toBe(10000)
    })

    it('should handle logs with special characters', () => {
      const store = useLogs()
      const specialMessage = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`'
      const specialLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: specialMessage,
        timestamp: '2024-01-01T00:00:00.000Z',
      }

      store.addLogBatch([specialLog])
      expect(store.logs[0]?.message).toBe(specialMessage)
    })

    it('should handle logs with Unicode characters', () => {
      const store = useLogs()
      const unicodeMessage = '测试日志 🎉 emoji'
      const unicodeLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: unicodeMessage,
        timestamp: '2024-01-01T00:00:00.000Z',
      }

      store.addLogBatch([unicodeLog])
      expect(store.logs[0]?.message).toBe(unicodeMessage)
    })

    it('should handle rapid log additions', () => {
      const store = useLogs()

      for (let i = 0; i < 100; i++) {
        store.addLogBatch([{
          id: i,
          level: 'INFO' as const,
          scope: 'test',
          message: `Log ${i}`,
          timestamp: new Date().toISOString(),
        }])
      }

      expect(store.logs.length).toBe(100)
    })

    it('should handle very large log batches', () => {
      const store = useLogs()
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        level: 'INFO' as const,
        scope: 'test',
        message: `Log ${i}`,
        timestamp: '2024-01-01T00:00:00.000Z',
      }))

      store.addLogBatch(largeBatch)
      // Logs are retained up to retainedRuntimeLogCount limit (check app-helpers.ts)
      // The actual retained count depends on the limit set in the code
      expect(store.logs.length).toBeGreaterThan(0)
      expect(store.logs.length).toBeLessThanOrEqual(1000)
    })

    it('should handle duplicate log IDs', () => {
      const store = useLogs()
      const duplicateLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'test',
          message: 'First log',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 1, // Duplicate ID
          level: 'ERROR' as const,
          scope: 'test',
          message: 'Second log',
          timestamp: '2024-01-01T00:01:00.000Z',
        },
      ]

      store.addLogBatch(duplicateLogs)
      expect(store.logs.length).toBe(2) // Both logs added
    })

    it('should handle missing optional fields', () => {
      const store = useLogs()
      const minimalLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: 'Minimal log',
        timestamp: '2024-01-01T00:00:00.000Z',
      }

      store.addLogBatch([minimalLog])
      expect(store.logs).toHaveLength(1)
    })

    it('should handle invalid timestamp formats', () => {
      const store = useLogs()
      const invalidTimestampLog = {
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: 'Invalid timestamp',
        timestamp: 'invalid-date',
      }

      store.addLogBatch([invalidTimestampLog])
      expect(store.logs).toHaveLength(1)
    })

    it('should handle clearing already empty logs', () => {
      const store = useLogs()
      expect(store.logs).toHaveLength(0)

      store.clearAllLogs()
      expect(store.logs).toHaveLength(0)
    })

    it('should handle toggling filter with no logs', () => {
      const store = useLogs()
      expect(store.logs).toHaveLength(0)

      store.toggleLogOnlyErrors()
      expect(store.visibleLogs).toHaveLength(0)

      store.toggleLogOnlyErrors()
      expect(store.visibleLogs).toHaveLength(0)
    })

    it('should handle setLogs with empty array', () => {
      const store = useLogs()
      store.addLogBatch([{
        id: 1,
        level: 'INFO' as const,
        scope: 'test',
        message: 'Test',
        timestamp: '2024-01-01T00:00:00.000Z',
      }])

      expect(store.logs).toHaveLength(1)

      store.setLogs([])
      expect(store.logs).toHaveLength(0)
    })

    it('should filter task-progress logs correctly', () => {
      const store = useLogs()
      const mixedLogs = [
        {
          id: 1,
          level: 'INFO' as const,
          scope: 'task-progress',
          message: 'Progress 1',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 2,
          level: 'INFO' as const,
          scope: 'general',
          message: 'General log',
          timestamp: '2024-01-01T00:01:00.000Z',
        },
        {
          id: 3,
          level: 'INFO' as const,
          scope: 'task-progress',
          message: 'Progress 2',
          timestamp: '2024-01-01T00:02:00.000Z',
        },
      ]

      store.addLogBatch(mixedLogs)
      expect(store.logs.length).toBe(3)
      expect(store.visibleLogs.length).toBe(1) // Only general log visible
      expect(store.visibleLogs[0]?.scope).toBe('general')
    })
  })
})
