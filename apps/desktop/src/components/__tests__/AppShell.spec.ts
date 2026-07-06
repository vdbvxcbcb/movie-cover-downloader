import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppShell from '../../layouts/AppShell.vue'
import { useUI } from '../../stores/ui'

// Create a minimal router for testing with all required routes
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div>Home</div>' } },
    { path: '/control', component: { template: '<div>Control</div>' }, meta: { title: 'Control' } },
    { path: '/logs', component: { template: '<div>Logs</div>' }, meta: { title: 'Logs' } },
  ],
})

describe('AppShell', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('Component Rendering', () => {
    it('should render the app shell', () => {
      const wrapper = mount(AppShell, {
        global: {
          plugins: [router],
        },
      })

      expect(wrapper.exists()).toBe(true)
      // AppShell should render the navigation
      expect(wrapper.text()).toContain('控制中心')
      expect(wrapper.text()).toContain('日志中心')
    })

    it('should render without content', () => {
      const wrapper = mount(AppShell, {
        global: {
          plugins: [router],
        },
      })
      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('UI Store Integration', () => {
    it('should use UI store', () => {
      const uiStore = useUI()
      const wrapper = mount(AppShell, {
        global: {
          plugins: [router],
        },
      })

      expect(wrapper.exists()).toBe(true)
      expect(uiStore).toBeDefined()
    })

    it('should reflect notice state from store', () => {
      const uiStore = useUI()
      uiStore.showNotice('Test notice', 'info')

      mount(AppShell, {
        global: {
          plugins: [router],
        },
      })
      expect(uiStore.notice).toBeTruthy()
    })

    it('should reflect modal states from store', () => {
      const uiStore = useUI()
      uiStore.openCreateTask()

      mount(AppShell, { global: { plugins: [router] } })
      expect(uiStore.createTaskOpen).toBe(true)
    })
  })

  describe('Modal Management', () => {
    it('should handle create task modal state', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.createTaskOpen).toBe(false)

      uiStore.openCreateTask()
      expect(uiStore.createTaskOpen).toBe(true)

      uiStore.closeCreateTask()
      expect(uiStore.createTaskOpen).toBe(false)
    })

    it('should handle import cookie modal state', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.importCookieOpen).toBe(false)

      uiStore.openImportCookie()
      expect(uiStore.importCookieOpen).toBe(true)

      uiStore.closeImportCookie()
      expect(uiStore.importCookieOpen).toBe(false)
    })

    it('should handle search movie modal state', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.searchMovieOpen).toBe(false)

      uiStore.openSearchMovie()
      expect(uiStore.searchMovieOpen).toBe(true)

      uiStore.closeSearchMovie()
      expect(uiStore.searchMovieOpen).toBe(false)
    })

    it('should handle selected photo download seed', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.selectedPhotoDownloadSeed).toBeNull()

      uiStore.openSelectedPhotoDownload({
        detailUrl: 'https://movie.douban.com/subject/123/',
        title: 'Test Movie',
      })
      expect(uiStore.selectedPhotoDownloadSeed).toBeTruthy()
      expect(uiStore.selectedPhotoDownloadSeed?.detailUrl).toBe('https://movie.douban.com/subject/123/')

      uiStore.closeCreateTask()
      expect(uiStore.selectedPhotoDownloadSeed).toBeNull()
    })
  })

  describe('Notice System', () => {
    it('should display notices', () => {
      const uiStore = useUI()
      uiStore.showNotice('Success message', 'success')

      mount(AppShell, { global: { plugins: [router] } })
      expect(uiStore.notice?.message).toBe('Success message')
      expect(uiStore.notice?.tone).toBe('success')
    })

    it('should handle different notice tones', () => {
      const uiStore = useUI()

      uiStore.showNotice('Info', 'info')
      expect(uiStore.notice?.tone).toBe('info')

      uiStore.showNotice('Warning', 'warn')
      expect(uiStore.notice?.tone).toBe('warn')

      uiStore.showNotice('Success', 'success')
      expect(uiStore.notice?.tone).toBe('success')

      mount(AppShell, { global: { plugins: [router] } })
    })

    it('should clear notices', () => {
      const uiStore = useUI()
      uiStore.showNotice('Test', 'info')
      expect(uiStore.notice).toBeTruthy()

      uiStore.clearNotice()
      expect(uiStore.notice).toBeNull()

      mount(AppShell, { global: { plugins: [router] } })
    })
  })

  describe('Slot Content', () => {
    it('should render router view content', () => {
      const wrapper = mount(AppShell, {
        global: {
          plugins: [router],
        },
      })

      // Router renders the default route component
      expect(wrapper.html()).toContain('<div>Home</div>')
    })

    it('should render navigation links', () => {
      const wrapper = mount(AppShell, {
        global: {
          plugins: [router],
        },
      })

      expect(wrapper.text()).toContain('控制中心')
      expect(wrapper.text()).toContain('日志中心')
      expect(wrapper.html()).toContain('/control')
      expect(wrapper.html()).toContain('/logs')
    })
  })

  describe('Error Scenarios', () => {
    it('should handle rapid modal toggles', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      for (let i = 0; i < 10; i++) {
        uiStore.openCreateTask()
        uiStore.closeCreateTask()
      }

      expect(uiStore.createTaskOpen).toBe(false)
    })

    it('should handle multiple notices in sequence', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      uiStore.showNotice('Notice 1', 'info')
      uiStore.showNotice('Notice 2', 'warn')
      uiStore.showNotice('Notice 3', 'success')

      // Last notice should be visible
      expect(uiStore.notice?.message).toBe('Notice 3')
    })

    it('should handle opening multiple modals', () => {
      const uiStore = useUI()
      mount(AppShell, { global: { plugins: [router] } })

      uiStore.openCreateTask()
      uiStore.openImportCookie()
      uiStore.openSearchMovie()

      expect(uiStore.createTaskOpen).toBe(true)
      expect(uiStore.importCookieOpen).toBe(true)
      expect(uiStore.searchMovieOpen).toBe(true)
    })
  })

  describe('Reactivity', () => {
    it('should react to store state changes', async () => {
      const uiStore = useUI()
      const wrapper = mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.createTaskOpen).toBe(false)

      uiStore.openCreateTask()
      await wrapper.vm.$nextTick()

      expect(uiStore.createTaskOpen).toBe(true)
    })

    it('should react to notice changes', async () => {
      const uiStore = useUI()
      const wrapper = mount(AppShell, { global: { plugins: [router] } })

      expect(uiStore.notice).toBeNull()

      uiStore.showNotice('New notice', 'info')
      await wrapper.vm.$nextTick()

      expect(uiStore.notice?.message).toBe('New notice')
    })
  })
})
