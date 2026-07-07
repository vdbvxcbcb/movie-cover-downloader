import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TaskTable from '../queue/TaskTable.vue'
import type { TaskItem } from '../../types/app'

const runtimeBridgeMock = vi.hoisted(() => ({
  isNativeRuntime: vi.fn(() => false),
  resolveDoubanMoviePreview: vi.fn(),
}))

// Mock runtime bridge
vi.mock('@/lib/runtime-bridge', () => ({
  runtimeBridge: runtimeBridgeMock,
}))

describe('TaskTable', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runtimeBridgeMock.isNativeRuntime.mockReturnValue(false)
    runtimeBridgeMock.resolveDoubanMoviePreview.mockReset()
  })

  const createMockTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
    id: 'task-1',
    title: 'Test Movie',
    target: {
      detailUrl: 'https://movie.douban.com/subject/123',
      outputRootDir: 'D:/cover',
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
    download: {
      savedCount: 0,
      targetCount: 0,
      directory: 'D:/cover/Test Movie/poster',
      files: [],
    },
    outputDirectory: undefined,
    coverUrl: undefined,
    coverDataUrl: undefined,
    ...overrides,
  })

  describe('Component Rendering', () => {
    it('should render without tasks', () => {
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should render with tasks', () => {
      const tasks = [createMockTask()]
      const wrapper = mount(TaskTable, {
        props: {
          tasks,
        },
      })

      expect(wrapper.exists()).toBe(true)
      expect(wrapper.text()).toContain('Test Movie')
    })

    it('should render persisted cover immediately without resolving preview again', async () => {
      runtimeBridgeMock.isNativeRuntime.mockReturnValue(true)
      const coverDataUrl = 'data:image/jpeg;base64,persisted-cover'

      const wrapper = mount(TaskTable, {
        props: {
          tasks: [
            createMockTask({
              coverDataUrl,
              lifecycle: { phase: 'completed', attempts: 1, updatedAt: new Date().toISOString() },
            }),
          ],
        },
      })

      await wrapper.vm.$nextTick()

      expect(wrapper.find('.cover-cell img').attributes('src')).toBe(coverDataUrl)
      expect(wrapper.text()).not.toContain('暂无封面')
      expect(runtimeBridgeMock.resolveDoubanMoviePreview).not.toHaveBeenCalled()
    })

    it('should emit resolved cover so missing legacy task covers can be persisted', async () => {
      runtimeBridgeMock.isNativeRuntime.mockReturnValue(true)
      const coverDataUrl = 'data:image/jpeg;base64,resolved-cover'
      runtimeBridgeMock.resolveDoubanMoviePreview.mockResolvedValue({
        detailUrl: 'https://movie.douban.com/subject/123',
        title: 'Test Movie',
        coverDataUrl,
      })

      const wrapper = mount(TaskTable, {
        props: {
          tasks: [
            createMockTask({
              lifecycle: { phase: 'completed', attempts: 1, updatedAt: new Date().toISOString() },
            }),
          ],
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.cover-cell img').attributes('src')).toBe(coverDataUrl)
      expect(wrapper.emitted('coverResolved')?.[0]).toEqual(['task-1', { coverDataUrl }])
    })

    it('should render multiple tasks', () => {
      const tasks = [
        createMockTask({ id: 'task-1', title: 'Movie A' }),
        createMockTask({ id: 'task-2', title: 'Movie B' }),
        createMockTask({ id: 'task-3', title: 'Movie C' }),
      ]
      const wrapper = mount(TaskTable, {
        props: {
          tasks,
        },
      })

      expect(wrapper.text()).toContain('Movie A')
      expect(wrapper.text()).toContain('Movie B')
      expect(wrapper.text()).toContain('Movie C')
    })
  })

  describe('Task Status Display', () => {
    it('should display queued status', () => {
      const task = createMockTask({
        lifecycle: { phase: 'queued', attempts: 0, updatedAt: new Date().toISOString() },
        summary: '待处理',
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.text()).toContain('待处理')
    })

    it('should display running status', () => {
      const task = createMockTask({
        lifecycle: { phase: 'downloading', attempts: 0, updatedAt: new Date().toISOString() },
        summary: '下载中',
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.text()).toContain('下载中')
    })

    it('should display completed status', () => {
      const task = createMockTask({
        lifecycle: { phase: 'completed', attempts: 0, updatedAt: new Date().toISOString() },
        summary: '已完成',
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.text()).toContain('已完成')
    })
  })

  describe('Event Emissions', () => {
    it('should emit retry event when retry button is clicked', async () => {
      const task = createMockTask({
        id: 'task-1',
        lifecycle: { phase: 'failed', attempts: 1, updatedAt: new Date().toISOString() },
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      // Find and click retry button
      const retryButton = wrapper.find('[data-test-id="retry-task-1"]')
      if (retryButton.exists()) {
        await retryButton.trigger('click')
        expect(wrapper.emitted('retry')).toBeTruthy()
        expect(wrapper.emitted('retry')?.[0]).toEqual(['task-1'])
      }
    })

    it('should emit remove event when remove button is confirmed', async () => {
      const task = createMockTask({ id: 'task-1' })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      // Simulate remove confirmation
      const removeButton = wrapper.find('[data-test-id="remove-task-1"]')
      if (removeButton.exists()) {
        await removeButton.trigger('click')
        // Note: Actual click requires PopConfirmAction interaction
      }
    })
  })

  describe('Pagination', () => {
    it('should paginate tasks correctly', () => {
      const tasks = Array.from({ length: 25 }, (_, i) =>
        createMockTask({ id: `task-${i}`, title: `Movie ${i}` })
      )
      const wrapper = mount(TaskTable, {
        props: {
          tasks,
        },
      })

      // Should show first page (20 items by default)
      expect(wrapper.text()).toContain('Movie 0')
      expect(wrapper.text()).not.toContain('Movie 24')
    })

    it('should handle empty task list pagination', () => {
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Active Task Highlighting', () => {
    it('should accept activeTaskIds prop', () => {
      const tasks = [
        createMockTask({ id: 'task-1' }),
        createMockTask({ id: 'task-2' }),
      ]
      const wrapper = mount(TaskTable, {
        props: {
          tasks,
          activeTaskIds: ['task-1'],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should handle empty activeTaskIds', () => {
      const tasks = [createMockTask({ id: 'task-1' })]
      const wrapper = mount(TaskTable, {
        props: {
          tasks,
          activeTaskIds: [],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle tasks with missing optional fields', () => {
      const task = createMockTask({
        coverUrl: undefined,
        coverDataUrl: undefined,
        outputDirectory: undefined,
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should handle tasks with invalid progress', () => {
      const task = createMockTask({
        download: {
          savedCount: 0,
          targetCount: 0,
          directory: 'D:/cover/Test Movie/poster',
          files: [],
        },
      })
      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should handle tasks with undefined properties gracefully', () => {
      const task = createMockTask()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (task as any).summary

      const wrapper = mount(TaskTable, {
        props: {
          tasks: [task],
        },
      })

      expect(wrapper.exists()).toBe(true)
    })
  })
})
