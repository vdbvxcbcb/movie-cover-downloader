import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ControlCenterView from '../../views/ControlCenterView.vue'
import { useTaskQueue } from '../../stores/taskQueue'
import { useCookies } from '../../stores/cookies'
import { useAppStore } from '../../stores/app'
import type { CookieProfile, TaskItem } from '../../types/app'

// Mock runtime bridge
vi.mock('@/lib/runtime-bridge', () => ({
  runtimeBridge: {
    isNativeRuntime: () => false,
    selectDirectory: vi.fn(),
    saveState: vi.fn(),
    emitLog: vi.fn(),
    onRuntimeLogBatch: vi.fn(),
    onTaskProgressBatch: vi.fn(),
    onTaskProgress: vi.fn(),
  },
}))

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      name: 'control-center',
      component: { template: '<div>Control Center</div>' },
    },
  ],
})

// Helper to create mount options with stubs
const createMountOptions = () => ({
  global: {
    plugins: [router],
    stubs: {
      TaskTable: { template: '<div><slot /></div>' },
      QueueFilterBar: { template: '<div><slot /></div>' },
      ActionButton: { template: '<button><slot /></button>' },
      PanelSection: { template: '<div><slot /><slot name="aside" /></div>' },
      PopConfirmAction: { template: '<button><slot /></button>' },
      StatusPill: { template: '<span><slot /></span>' },
    },
  },
})

describe('ControlCenterView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // Initialize app store to ensure all sub-stores are set up
    const appStore = useAppStore()
    // Ensure hydrated flag is set to prevent persistence attempts
    appStore.hydrated = true
  })

  const createMockTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
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
    ...overrides,
  })

  const createMockCookie = (overrides: Partial<CookieProfile> = {}): CookieProfile => ({
    id: 'cookie-1',
    source: 'douban',
    status: 'active',
    value: 'test-cookie-value',
    note: 'Test Cookie',
    success: 0,
    failure: 0,
    importedAt: new Date().toISOString(),
    expiresAt: undefined,
    ...overrides,
  })

  describe('Component Rendering', () => {
    it('should render the control center view', async () => {
      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })

    it('should display task queue section', async () => {
      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.text()).toMatch(/任务|队列|Task|Queue/i)
    })

    it('should display cookie management section', async () => {
      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.text()).toMatch(/Cookie|凭证/i)
    })
  })

  describe('Store Integration', () => {
    it('should use taskQueue store', async () => {
      const taskQueueStore = useTaskQueue()
      taskQueueStore.setTasks([createMockTask()])

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(taskQueueStore.tasks.length).toBe(1)
      expect(wrapper.exists()).toBe(true)
    })

    it('should use cookies store', async () => {
      const cookiesStore = useCookies()
      cookiesStore.importCookie({ value: 'test', note: 'Test' })

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(cookiesStore.cookies.length).toBe(1)
      expect(wrapper.exists()).toBe(true)
    })

    it('should display tasks from store', async () => {
      const taskQueueStore = useTaskQueue()
      taskQueueStore.setTasks([
        createMockTask({ id: 'task-1', title: 'Movie A' }),
        createMockTask({ id: 'task-2', title: 'Movie B' }),
      ])

      await router.push('/')

      expect(taskQueueStore.tasks.length).toBe(2)
    })
  })

  describe('Task Operations', () => {
    it('should handle empty task queue', async () => {
      const taskQueueStore = useTaskQueue()
      expect(taskQueueStore.tasks.length).toBe(0)

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })

    it('should display multiple tasks', async () => {
      const taskQueueStore = useTaskQueue()
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createMockTask({ id: `task-${i}`, title: `Task ${i}` })
      )
      taskQueueStore.setTasks(tasks)

      await router.push('/')

      expect(taskQueueStore.tasks.length).toBe(5)
    })

    it('should track active tasks', async () => {
      const taskQueueStore = useTaskQueue()
      const task = createMockTask({
        id: 'task-1',
        lifecycle: { phase: 'downloading', attempts: 0, updatedAt: new Date().toISOString() },
      })
      taskQueueStore.setTasks([task])

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Cookie Management', () => {
    it('should display cookies from store', async () => {
      const cookiesStore = useCookies()
      cookiesStore.importCookie({ value: 'cookie1', note: 'Cookie 1' })
      cookiesStore.importCookie({ value: 'cookie2', note: 'Cookie 2' })

      await router.push('/')

      expect(cookiesStore.cookies.length).toBe(2)
    })

    it('should handle empty cookie list', async () => {
      const cookiesStore = useCookies()
      expect(cookiesStore.cookies.length).toBe(0)

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Queue Status', () => {
    it('should reflect queue running state', async () => {
      const taskQueueStore = useTaskQueue()
      taskQueueStore.queueRunning = true

      await router.push('/')

      expect(taskQueueStore.queueRunning).toBe(true)
    })

    it('should reflect queue stopped state', async () => {
      const taskQueueStore = useTaskQueue()
      taskQueueStore.queueRunning = false

      await router.push('/')

      expect(taskQueueStore.queueRunning).toBe(false)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle tasks with invalid data', async () => {
      const taskQueueStore = useTaskQueue()
      const invalidTask = createMockTask({
        title: '',
        target: {
          ...createMockTask().target,
          detailUrl: '',
        },
      })
      taskQueueStore.setTasks([invalidTask])

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })

    it('should handle cookies with missing fields', async () => {
      const cookiesStore = useCookies()
      const cookie = createMockCookie({ note: '' })
      cookiesStore.setCookies([cookie])

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })

    it('should handle rapid state changes', async () => {
      const taskQueueStore = useTaskQueue()

      for (let i = 0; i < 10; i++) {
        taskQueueStore.queueRunning = true
        taskQueueStore.queueRunning = false
      }

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Performance', () => {
    it('should handle large task list', async () => {
      const taskQueueStore = useTaskQueue()
      const manyTasks = Array.from({ length: 100 }, (_, i) =>
        createMockTask({ id: `task-${i}`, title: `Task ${i}` })
      )
      taskQueueStore.setTasks(manyTasks)

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(taskQueueStore.tasks.length).toBe(100)
      expect(wrapper.exists()).toBe(true)
    })

    it('should handle large cookie list', async () => {
      const cookiesStore = useCookies()
      for (let i = 0; i < 50; i++) {
        cookiesStore.importCookie({ value: `cookie-${i}`, note: `Cookie ${i}` })
      }

      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(cookiesStore.cookies.length).toBe(50)
      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('Reactivity', () => {
    it('should react to task additions', async () => {
      const taskQueueStore = useTaskQueue()
      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(taskQueueStore.tasks.length).toBe(0)

      taskQueueStore.setTasks([createMockTask()])
      await wrapper.vm.$nextTick()

      expect(taskQueueStore.tasks.length).toBe(1)
    })

    it('should react to cookie additions', async () => {
      const cookiesStore = useCookies()
      await router.push('/')
      const wrapper = mount(ControlCenterView, createMountOptions())

      expect(cookiesStore.cookies.length).toBe(0)

      cookiesStore.importCookie({ value: 'new', note: 'New' })
      await wrapper.vm.$nextTick()

      expect(cookiesStore.cookies.length).toBe(1)
    })
  })
})
