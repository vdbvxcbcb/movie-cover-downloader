import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import LogCenterView from '../../views/LogCenterView.vue'
import { useLogs } from '../../stores/logs'
import type { LogEntry } from '../../types/app'

describe('LogCenterView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const createMockLog = (overrides: Partial<LogEntry> = {}): LogEntry => ({
    id: 1,
    timestamp: new Date().toISOString(),
    level: 'INFO',
    scope: 'general',
    message: 'Test log message',
    ...overrides,
  })

  describe('Component Rendering', () => {
    it('should render without logs', () => {
      const wrapper = mount(LogCenterView)
      expect(wrapper.exists()).toBe(true)
    })

    it('should render with logs from store', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ message: 'Log message 1' }),
        createMockLog({ id: 2, message: 'Log message 2' }),
      ])

      const wrapper = mount(LogCenterView)
      expect(wrapper.text()).toContain('Log message 1')
      expect(wrapper.text()).toContain('Log message 2')
    })

    it('should display log count', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog(),
        createMockLog({ id: 2 }),
        createMockLog({ id: 3 }),
      ])

      const wrapper = mount(LogCenterView)
      const text = wrapper.text()
      expect(text).toMatch(/\d+/)
    })
  })

  describe('Log Filtering', () => {
    it('should toggle error-only filter', async () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ id: 1, level: 'INFO', message: 'Info message' }),
        createMockLog({ id: 2, level: 'ERROR', message: 'Error message' }),
      ])

      const wrapper = mount(LogCenterView)

      // Initially both logs visible
      expect(wrapper.text()).toContain('Info message')
      expect(wrapper.text()).toContain('Error message')

      // Toggle to show only errors
      logsStore.toggleLogOnlyErrors()
      await wrapper.vm.$nextTick()

      // Should only show error logs
      const visibleLogs = logsStore.visibleLogs
      expect(visibleLogs.length).toBe(1)
      expect(visibleLogs[0]?.level).toBe('ERROR')
    })

    it('should show all logs when error filter is off', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ level: 'INFO' }),
        createMockLog({ level: 'WARN' }),
        createMockLog({ level: 'ERROR' }),
      ])

      const wrapper = mount(LogCenterView)
      expect(logsStore.visibleLogs.length).toBe(3)
      expect(wrapper.exists()).toBe(true)
    })

    it('should handle empty logs with filter on', () => {
      const logsStore = useLogs()
      logsStore.toggleLogOnlyErrors()

      const wrapper = mount(LogCenterView)
      expect(logsStore.visibleLogs.length).toBe(0)
      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Log Levels', () => {
    it('should display info level logs', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ level: 'INFO', message: 'Info log' }),
      ])

      const wrapper = mount(LogCenterView)
      expect(wrapper.text()).toContain('Info log')
    })

    it('should display warn level logs', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ level: 'WARN', message: 'Warning log' }),
      ])

      const wrapper = mount(LogCenterView)
      expect(wrapper.text()).toContain('Warning log')
    })

    it('should display error level logs', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([
        createMockLog({ level: 'ERROR', message: 'Error log' }),
      ])

      const wrapper = mount(LogCenterView)
      expect(wrapper.text()).toContain('Error log')
    })
  })

  describe('Store Integration', () => {
    it('should use logs from logs store', () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([createMockLog({ message: 'Store log' })])

      const wrapper = mount(LogCenterView)
      expect(wrapper.text()).toContain('Store log')
    })

    it('should reflect store state changes', async () => {
      const logsStore = useLogs()
      const wrapper = mount(LogCenterView)

      // Initially no logs
      expect(logsStore.logs.length).toBe(0)

      // Add logs to store
      logsStore.addLogBatch([createMockLog({ message: 'New log' })])
      await wrapper.vm.$nextTick()

      // Should reflect in component
      expect(logsStore.logs.length).toBe(1)
      expect(wrapper.text()).toContain('New log')
    })

    it('should update when logs are cleared', async () => {
      const logsStore = useLogs()
      logsStore.addLogBatch([createMockLog()])

      const wrapper = mount(LogCenterView)
      expect(logsStore.logs.length).toBe(1)

      logsStore.clearAllLogs()
      await wrapper.vm.$nextTick()

      expect(logsStore.logs.length).toBe(0)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle logs with missing fields', () => {
      const logsStore = useLogs()
      const incompleteLog = {
        id: 1,
        timestamp: new Date().toISOString(),
        level: 'INFO' as const,
        scope: 'general',
        message: '',
      }
      logsStore.addLogBatch([incompleteLog])

      const wrapper = mount(LogCenterView)
      expect(wrapper.exists()).toBe(true)
    })

    it('should handle very long log messages', () => {
      const logsStore = useLogs()
      const longMessage = 'A'.repeat(1000)
      logsStore.addLogBatch([createMockLog({ message: longMessage })])

      const wrapper = mount(LogCenterView)
      expect(wrapper.exists()).toBe(true)
      expect(wrapper.text()).toContain('A')
    })

    it('should handle rapid log additions', async () => {
      const logsStore = useLogs()
      const wrapper = mount(LogCenterView)

      for (let i = 0; i < 100; i++) {
        logsStore.addLogBatch([createMockLog({ id: i + 1, message: `Log ${i}` })])
      }
      await wrapper.vm.$nextTick()

      expect(logsStore.logs.length).toBe(100)
      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Performance', () => {
    it('should handle large number of logs efficiently', () => {
      const logsStore = useLogs()
      const manyLogs = Array.from({ length: 1000 }, (_, i) =>
        createMockLog({ id: i + 1, message: `Message ${i}` })
      )
      logsStore.addLogBatch(manyLogs)

      const wrapper = mount(LogCenterView)
      expect(wrapper.exists()).toBe(true)
      // Log store retains only 200 logs
      expect(logsStore.logs.length).toBe(200)
    })
  })
})
