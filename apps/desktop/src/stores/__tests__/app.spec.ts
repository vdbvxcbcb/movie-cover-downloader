// Pinia 仓库测试：模拟 Tauri 桥接以验证队列状态流转。
import { describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { formatTaskProgress, formatTaskTitle, getTaskProgressPercent } from '../../lib/presenters'
import type { AppSeedState, RuntimeDownloadTaskResult, RuntimeTaskProgressEvent, TaskDraft } from '../../types/app'

// 创建测试用 window/localStorage/prompt stub，避免 Pinia store 测试依赖真实浏览器环境。
function createWindowStub() {
  const target = new EventTarget()
  const storage = new Map<string, string>()

  return {
    setTimeout,
    clearTimeout,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    localStorage: {
      // 模拟 localStorage.getItem，供浏览器降级持久化测试使用。
      getItem(key: string) {
        return storage.get(key) ?? null
      },
      // 模拟 localStorage.setItem，把测试快照写入内存 Map。
      setItem(key: string, value: string) {
        storage.set(key, value)
      },
      // 模拟 localStorage.removeItem，清理内存 Map 中的指定 key。
      removeItem(key: string) {
        storage.delete(key)
      },
    },
    // 模拟 window.prompt，避免测试过程中弹出真实输入框。
    prompt() {
      return null
    },
  }
}

// 在异步 store 测试中轮询等待条件满足，超时则让测试失败。
async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for store state')
    }

    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function releaseDeferred(release: (() => void) | null) {
  expect(release).toBeTypeOf('function')
  release?.()
}

// 创建默认任务草稿，测试可以覆盖链接、数量和输出目录。
function createDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    detailUrl: 'https://movie.douban.com/subject/34780991/',
    outputRootDir: 'D:/cover',
    sourceHint: 'auto',
    doubanAssetType: 'wallpaper',
    imageCountMode: 'limited',
    maxImages: 50,
    outputImageFormat: 'jpg',
    imageAspectRatio: 'original',
    requestIntervalSeconds: 1,
    ...overrides,
  }
}

// 构造 sidecar 成功结果，模拟真实下载完成后的返回数据。
function createSuccessResult(imageCount = 1): RuntimeDownloadTaskResult {
  const normalizedTitle = 'Douban Title'
  const outputDir = 'D:/cover/Douban Title - 2026-05-01'

  return {
    discovery: {
      source: 'douban',
      detailUrl: 'https://movie.douban.com/subject/34780991/',
      imagePageUrl: 'https://movie.douban.com/subject/34780991/photos?type=W',
      normalizedTitle,
      outputFolderName: `${normalizedTitle} - 2026-05-01`,
      outputDir,
      images: Array.from({ length: imageCount }, (_, index) => ({
        id: `douban-image-${index + 1}`,
        source: 'douban',
        title: normalizedTitle,
        imageUrl: `https://img.example.com/douban-${index + 1}.jpg`,
        category: 'still' as const,
        orientation: 'horizontal' as const,
      })),
    },
    download: {
      outputDir,
      saved: Array.from({ length: imageCount }, (_, index) => ({
        sourceUrl: `https://img.example.com/douban-${index + 1}.jpg`,
        outputPath: `${outputDir}/douban-${index + 1}.jpg`,
        category: 'still' as const,
        orientation: 'horizontal' as const,
      })),
      source: 'douban',
    },
  }
}

// 初始化 Pinia store 测试环境，并注入可控的 runtimeBridge mock。
function createPersistedSnapshot(overrides: Partial<AppSeedState> = {}): AppSeedState {
  return {
    schemaVersion: 2,
    tasks: [],
    cookies: [],
    logs: [],
    queueConfig: {
      batchSize: 4,
      concurrency: 2,
      failureCooldownMs: 10_000,
      maxAttempts: 3,
    },
    createTaskOutputRootDir: '',
    ...overrides,
  }
}

async function setupStore(overrides?: {
  loadState?: typeof import('../../lib/runtime-bridge').runtimeBridge.loadState
  saveState?: typeof import('../../lib/runtime-bridge').runtimeBridge.saveState
  structuredCloneImpl?: typeof globalThis.structuredClone
}) {
  const nativeStructuredClone = globalThis.structuredClone
  Object.assign(globalThis, {
    window: createWindowStub(),
    structuredClone:
      overrides?.structuredCloneImpl ??
      ((<T>(value: T) => JSON.parse(JSON.stringify(value)) as T) as typeof globalThis.structuredClone),
    CustomEvent: class<T> extends Event {
      detail: T

      // Node 测试环境缺少 CustomEvent，这里提供最小实现供 runtimeBridge 事件使用。
      constructor(type: string, init: CustomEventInit<T>) {
        super(type)
        this.detail = init.detail as T
      }
    },
  })

  const { runtimeBridge } = await import('../../lib/runtime-bridge')
  let runtimeLogListener: ((entries: import('../../types/app').LogEntry[]) => void) | null = null
  let taskProgressListener: ((event: RuntimeTaskProgressEvent) => void) | null = null
  runtimeBridge.onRuntimeLogBatch = vi.fn(async () => () => {})
  runtimeBridge.onRuntimeLogBatch = vi.fn(async (listener) => {
    runtimeLogListener = listener
    return () => {
      runtimeLogListener = null
    }
  })
  runtimeBridge.onTaskProgress = vi.fn(async (listener) => {
    taskProgressListener = listener
    return () => {
      taskProgressListener = null
    }
  })
  runtimeBridge.emitLog = vi.fn(async () => {})
  runtimeBridge.saveState = overrides?.saveState ?? vi.fn(async () => {})
  runtimeBridge.loadState = overrides?.loadState ?? vi.fn(async () => null)
  runtimeBridge.isNativeRuntime = vi.fn(() => true)
  runtimeBridge.pauseDownloadTask = vi.fn(async (taskId: string) => taskId)
  runtimeBridge.resumeDownloadTask = vi.fn(async (taskId: string) => taskId)
  runtimeBridge.clearDownloadTasks = vi.fn(async () => 0)
  runtimeBridge.deleteDirectoryPath = vi.fn(async (directoryPath: string) => directoryPath)
  runtimeBridge.clearDirectoryContents = vi.fn(async () => 0)

  const { useAppStore } = await import('../../stores/app')
  const { useTaskQueue } = await import('../../stores/taskQueue')
  setActivePinia(createPinia())
  const appStore = useAppStore()
  const taskQueueStore = useTaskQueue()
  await appStore.bootstrap()

  return {
    appStore,
    taskQueueStore,
    runtimeBridge,
    emitRuntimeLogs(entries: import('../../types/app').LogEntry[]) {
      runtimeLogListener?.(entries)
    },
    // 主动触发已注册的进度监听器，用来测试实时进度更新。
    emitTaskProgress(event: RuntimeTaskProgressEvent) {
      taskProgressListener?.(event)
    },
    // 测试结束后恢复原始 structuredClone，避免影响其他用例。
    restoreStructuredClone() {
      globalThis.structuredClone = nativeStructuredClone
    },
  }
}

describe('app store', () => {
  describe('persistence', () => {
    it('首次打开新增任务时输出目录保持空白', async () => {
      const { appStore } = await setupStore()

      expect(appStore.createTaskOutputRootDir).toBe('')
      expect(appStore.customCropOutputRootDir).toBe('D:/cover')

      appStore.syncCreateTaskOutputRootDir('')
      expect(appStore.createTaskOutputRootDir).toBe('')
    })

    it('已设置的新增任务输出目录会在重启后恢复', async () => {
      const savedSnapshots: AppSeedState[] = []
      const { appStore } = await setupStore({
        saveState: async (snapshot) => {
          savedSnapshots.push(snapshot)
        },
      })

      appStore.syncCreateTaskOutputRootDir('E:/movie-cover')
      await waitFor(() => savedSnapshots.length > 0)

      expect(savedSnapshots[savedSnapshots.length - 1]?.createTaskOutputRootDir).toBe('E:/movie-cover')

      const { appStore: restartedStore } = await setupStore({
        loadState: async () => createPersistedSnapshot({ createTaskOutputRootDir: 'E:/movie-cover' }),
      })

      expect(restartedStore.createTaskOutputRootDir).toBe('E:/movie-cover')
    })

    it('创建任务时会用规范化链接匹配预览封面并持久化到任务', async () => {
      const { appStore, taskQueueStore } = await setupStore()
      const detailUrl = 'https://movie.douban.com/subject/34780991/'
      const coverDataUrl = 'data:image/jpeg;base64,cover'

      appStore.upsertCreateTaskMoviePreview(detailUrl, {
        detailUrl,
        title: '示例电影',
        coverDataUrl,
      })

      await appStore.createTasks([createDraft({ detailUrl })])

      expect(taskQueueStore.tasks[0]?.coverDataUrl).toBe(coverDataUrl)
    })

    it('持久化状态加载失败后仍会完成 hydration 并允许后续保存', async () => {
      let saveCalls = 0
      const { appStore } = await setupStore({
        loadState: async () => {
          throw new Error('sqlite is busy')
        },
        saveState: async () => {
          saveCalls += 1
        },
      })

      expect(appStore.hydrated).toBe(true)

      await appStore.importCookie({
        value: 'dbcl2="repair"; ck=repair',
        note: 'repair cookie',
      })

      await waitFor(() => saveCalls > 0)
      expect(saveCalls).toBeGreaterThan(0)
    })

    it('持久化写入进行中时新的保存请求会串行排队而不是并发覆盖', async () => {
      let saveCalls = 0
      let inflight = 0
      let maxInflight = 0

      const { appStore } = await setupStore({
        saveState: async () => {
          saveCalls += 1
          inflight += 1
          maxInflight = Math.max(maxInflight, inflight)
          await new Promise((resolve) => setTimeout(resolve, 220))
          inflight -= 1
        },
      })

      const clearPromise = appStore.clearAllLogs()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await appStore.importCookie({
        value: 'dbcl2="queue"; ck=queue',
        note: 'queue cookie',
      })

      await clearPromise
      await waitFor(() => saveCalls >= 2)

      expect(maxInflight).toBe(1)
      expect(saveCalls).toBeGreaterThanOrEqual(2)
    })

    it('已恢复日志与新运行日志撞号时保存前会自动改写为唯一日志 ID', async () => {
      const savedSnapshots: import('../../types/app').AppSeedState[] = []
      const { appStore, emitRuntimeLogs } = await setupStore({
        loadState: async () => ({
          schemaVersion: 2,
          tasks: [],
          cookies: [],
          logs: [
            {
              id: 10_000,
              level: 'INFO',
              scope: 'bootstrap',
              timestamp: '2026-05-02 14:20:00',
              message: 'old log',
            },
          ],
          queueConfig: {
            batchSize: 4,
            concurrency: 2,
            failureCooldownMs: 10_000,
            maxAttempts: 3,
          },
        }),
        saveState: async (snapshot) => {
          savedSnapshots.push(snapshot)
        },
      })

      emitRuntimeLogs([
        {
          id: 10_000,
          level: 'INFO',
          scope: 'cookie',
          timestamp: '2026-05-02 14:21:00',
          message: 'new log',
        },
      ])

      await appStore.importCookie({
        value: 'dbcl2="dedupe"; ck=dedupe',
        note: 'dedupe cookie',
      })

      await waitFor(() => savedSnapshots.length > 0)
      const latestSnapshot = savedSnapshots[savedSnapshots.length - 1]!
      const logIds = latestSnapshot.logs.map((entry: import('../../types/app').LogEntry) => entry.id)

      expect(new Set(logIds).size).toBe(logIds.length)
    })

    it('持久化保存失败时会在提示中显示真实错误摘要', async () => {
      const { appStore } = await setupStore({
        saveState: async () => {
          throw new Error('写入日志失败: UNIQUE constraint failed: app_logs.id')
        },
      })

      await appStore.importCookie({
        value: 'dbcl2="broken"; ck=broken',
        note: 'broken cookie',
      })

      await waitFor(() => ((appStore.notice?.message?.includes('UNIQUE constraint failed') ?? false)))
      expect((appStore.notice?.message ?? '')).toMatch(/UNIQUE constraint failed: app_logs\.id/)
    })

    it('浏览器原生 structuredClone 遇到响应式数组时持久化仍然可以成功', async () => {
      const saveSnapshots: import('../../types/app').AppSeedState[] = []
      const { appStore, restoreStructuredClone } = await setupStore({
        structuredCloneImpl: globalThis.structuredClone,
        saveState: async (snapshot) => {
          saveSnapshots.push(snapshot)
        },
      })

      try {
        await appStore.importCookie({
          value: 'dbcl2="native"; ck=native',
          note: 'native cookie',
        })

        await waitFor(() => saveSnapshots.length > 0)
        expect((appStore.notice?.message?.includes('structuredClone') ?? false)).toBe(false)
        expect(saveSnapshots[0]?.cookies[0]?.note).toBe('native cookie')
      } finally {
        restoreStructuredClone()
      }
    })

    it('删除旧 Cookie 后再次导入不会复用同一 ID', async () => {
      const { appStore } = await setupStore()

      await appStore.importCookie({
        value: 'dbcl2="first"; ck=first',
        note: 'first cookie',
      })
      const firstId = appStore.cookies[0]?.id

      await appStore.deleteCookie(firstId!)

      await appStore.importCookie({
        value: 'dbcl2="second"; ck=second',
        note: 'second cookie',
      })
      const secondId = appStore.cookies[0]?.id

      expect(firstId).toBe('300')
      expect(secondId).not.toBe(firstId)
    })
  })

  describe('douban error handling', () => {
    it('豆瓣 empty 失败时会按抓图类型生成动态中文摘要且 Cookie 保持 active', async () => {
      const cases = [
        { assetType: 'still', expectedSummary: '示例电影暂时没有剧照' },
        { assetType: 'poster', expectedSummary: '示例电影暂时没有海报' },
        { assetType: 'wallpaper', expectedSummary: '示例电影暂时没有壁纸' },
      ] as const

      for (const testCase of cases) {
        const { appStore, runtimeBridge } = await setupStore()
        runtimeBridge.runDownloadTask = vi.fn(async () => {
          throw new Error('douban photo category is empty|title=%E7%A4%BA%E4%BE%8B%E7%94%B5%E5%BD%B1')
        })

        await appStore.importCookie({
          value: 'dbcl2="demo"; ck=hb-J',
          note: 'test cookie',
        })
        await appStore.createTasks([createDraft({ doubanAssetType: testCase.assetType })])

        await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

        expect(appStore.tasks[0]?.summary).toBe(testCase.expectedSummary)
        expect(appStore.cookies[0]?.status).toBe('active')
        expect(appStore.cookies[0]?.failure).toBe(0)
      }
    })

    it('豆瓣 risk 失败时显示中文摘要且 Cookie 进入 cooling', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('douban risk page detected')
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([createDraft()])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.summary).toBe('触发豆瓣风控，请稍后重试')
      expect(appStore.cookies[0]?.status).toBe('cooling')
      expect(appStore.cookies[0]?.failure).toBe(1)
      expect(appStore.cookies[0]?.coolingUntil).toBeTruthy()
    })

    it('豆瓣 auth 失败时显示中文摘要且 Cookie 进入 cooling', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('douban session expired, please sign in again')
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([createDraft()])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.summary).toBe('豆瓣登录状态失效，请重新导入 Cookie')
      expect(appStore.cookies[0]?.status).toBe('cooling')
      expect(appStore.cookies[0]?.failure).toBe(1)
      expect(appStore.cookies[0]?.coolingUntil).toBeTruthy()
    })

    it('豆瓣 generic 反爬失败时显示中文摘要且保持冷却判断', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('HTTP 429 from sec.douban.com captcha required')
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([createDraft()])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.summary).toBe('豆瓣访问受限，请稍后重试或重新导入 Cookie')
      expect(appStore.cookies[0]?.status).toBe('cooling')
      expect(appStore.cookies[0]?.failure).toBe(1)
    })

    it('豆瓣 generic 登录态关键词错误时显示中文摘要但不进入 cooling', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('unauthorized cookie sync failed after login redirect')
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([createDraft()])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.summary).toBe('豆瓣抓图失败，请稍后重试')
      expect(appStore.cookies[0]?.status).toBe('active')
      expect(appStore.cookies[0]?.failure).toBe(0)
      expect(appStore.cookies[0]?.coolingUntil).toBeUndefined()
    })

    it('豆瓣 unexpected 失败时显示中文摘要且 Cookie 保持 active', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('douban page structure mismatch')
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([createDraft()])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.summary).toBe('豆瓣页面结构异常，暂时无法解析')
      expect(appStore.cookies[0]?.status).toBe('active')
      expect(appStore.cookies[0]?.failure).toBe(0)
      expect(appStore.cookies[0]?.coolingUntil).toBeUndefined()
    })
  })

  describe('task scheduling', () => {
    it('豆瓣任务在保护模式下串行执行', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const started: string[] = []
      let releaseFirstDouban: (() => void) | null = null
      let secondDoubanStarted = false

      runtimeBridge.runDownloadTask = vi.fn(async (payload) => {
        started.push(payload.detailUrl)

        if (releaseFirstDouban === null) {
          await new Promise<void>((resolve) => {
            releaseFirstDouban = resolve
          })
        } else {
          secondDoubanStarted = true
        }

        return createSuccessResult()
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([
        createDraft({ detailUrl: 'https://movie.douban.com/subject/34780991/' }),
        createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' }),
      ])

      await waitFor(() => started.length >= 1)

      expect(started.length).toBe(1)
      expect(secondDoubanStarted).toBe(false)

      releaseDeferred(releaseFirstDouban)

      await waitFor(() => appStore.tasks.every((task) => task.lifecycle.phase === 'completed'))

      expect(started.length).toBe(2)
    })

    it('scheduler and task list keep FIFO order', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const oldFirstUrl = 'https://movie.douban.com/subject/34780991/'
      const oldSecondUrl = 'https://movie.douban.com/subject/1292052/'
      const newUrl = 'https://movie.douban.com/subject/1292064/'
      const started: string[] = []
      let releaseFirstTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async (payload) => {
        started.push(payload.detailUrl)

        if (payload.detailUrl === oldFirstUrl) {
          await new Promise<void>((resolve) => {
            releaseFirstTask = resolve
          })
        }

        return createSuccessResult()
      })

      await appStore.importCookie({
        value: 'dbcl2="demo"; ck=hb-J',
        note: 'test cookie',
      })
      await appStore.createTasks([
        createDraft({ detailUrl: oldFirstUrl }),
        createDraft({ detailUrl: oldSecondUrl }),
      ])

      await waitFor(() => started.length === 1)

      await appStore.createTasks([createDraft({ detailUrl: newUrl })])

      expect(appStore.tasks.map((task) => task.target.detailUrl)).toEqual([oldFirstUrl, oldSecondUrl, newUrl])

      releaseDeferred(releaseFirstTask)

      await waitFor(() => started.length === 3)

      expect(started).toEqual([oldFirstUrl, oldSecondUrl, newUrl])
    })
  })

  describe('duplicate task handling', () => {
    it('创建重复任务时能找到相同链接输出目录分类和比例的旧任务', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      runtimeBridge.runDownloadTask = vi.fn(async () => createSuccessResult())

      const draft = createDraft()
      await appStore.createTasks([draft])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')

      expect(appStore.findDuplicateTasksForDrafts([draft]).map((task) => task.id)).toEqual([appStore.tasks[0]!.id])
      expect(appStore.findDuplicateTasksForDrafts([createDraft({ outputRootDir: 'D:\\cover' })]).map((task) => task.id)).toEqual([
        appStore.tasks[0]!.id,
      ])
      expect(appStore.findDuplicateTasksForDrafts([createDraft({ imageAspectRatio: '9:16' })])).toEqual([])
    })

    it('确认覆盖重复任务时会清空旧输出目录并删除旧任务行', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const clearedDirectories: Array<{ directoryPath: string; rootDirectoryPath: string }> = []
      const started: string[] = []

      runtimeBridge.runDownloadTask = vi.fn(async (payload) => {
        started.push(payload.detailUrl)
        return createSuccessResult()
      })
      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.clearDirectoryContents = vi.fn(async (directoryPath: string, rootDirectoryPath: string) => {
        clearedDirectories.push({ directoryPath, rootDirectoryPath })
        return 1
      })

      const draft = createDraft()
      await appStore.createTasks([draft])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')

      const oldTaskId = appStore.tasks[0]!.id
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        outputDirectory: 'D:/cover/Douban Title/wallpaper/wallpaper-original',
      }

      await appStore.createTasks([draft], { replacementTaskIds: [oldTaskId] })

      expect(clearedTaskIds[clearedTaskIds.length - 1]).toEqual([oldTaskId])
      expect(clearedDirectories).toEqual([
        { directoryPath: 'D:/cover/Douban Title/wallpaper/wallpaper-original', rootDirectoryPath: 'D:/cover' },
      ])
      expect(appStore.tasks.length).toBe(1)
      expect(appStore.tasks[0]?.id).not.toBe(oldTaskId)
      expect(appStore.tasks[0]?.target.detailUrl).toBe(draft.detailUrl)
      await waitFor(() => started.length === 2)
      expect(appStore.tasks[0]?.lifecycle.phase).toBe('completed')
    })

    it('确认覆盖尚未开始的重复任务后不会再启动旧任务', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const firstUrl = 'https://movie.douban.com/subject/34780991/'
      const duplicateUrl = 'https://movie.douban.com/subject/1292052/'
      const startedTaskIds: string[] = []
      let releaseFirstTask: (() => void) | null = null

      appStore.queueConfig.concurrency = 1
      runtimeBridge.runDownloadTask = vi.fn(async (payload) => {
        startedTaskIds.push(payload.taskId)

        if (payload.detailUrl === firstUrl) {
          await new Promise<void>((resolve) => {
            releaseFirstTask = resolve
          })
        }

        return createSuccessResult()
      })

      await appStore.createTasks([createDraft({ detailUrl: firstUrl }), createDraft({ detailUrl: duplicateUrl })])
      await waitFor(() => startedTaskIds.length === 1)

      const firstTaskId = appStore.tasks.find((task) => task.target.detailUrl === firstUrl)!.id
      const oldDuplicateTaskId = appStore.tasks.find((task) => task.target.detailUrl === duplicateUrl)!.id
      await appStore.createTasks([createDraft({ detailUrl: duplicateUrl })], { replacementTaskIds: [oldDuplicateTaskId] })
      const replacementTaskId = appStore.tasks.find((task) => task.target.detailUrl === duplicateUrl)!.id

      releaseDeferred(releaseFirstTask)
      await waitFor(() => startedTaskIds.includes(replacementTaskId))
      await waitFor(() => appStore.tasks.every((task) => task.lifecycle.phase === 'completed'))

      expect(startedTaskIds.includes(oldDuplicateTaskId)).toBe(false)
      expect(appStore.tasks.map((task) => task.id)).toEqual([firstTaskId, replacementTaskId])
    })
  })

  describe('progress tracking', () => {
    it('原生任务处理中收到片名解析日志后会立即更新队列标题', async () => {
      const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult()
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitRuntimeLogs([
        {
          id: 99_001,
          level: 'INFO',
          scope: 'discoverer',
          timestamp: '2026-05-01 20:40:00',
          message: '片名已解析: 消失的人',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.title === '消失的人')
      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务发现总数后进度先显示短横线并在 task-progress 事件后实时递增', async () => {
      const { appStore, runtimeBridge, emitTaskProgress } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitTaskProgress({
        taskId: appStore.tasks[0]!.id,
        phase: 'downloading',
        targetCount: 3,
        savedCount: 0,
        timestamp: '2026-05-02 10:00:00',
      })

      await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('-/3')
      expect(getTaskProgressPercent(appStore.tasks[0]!)).toBe(0)

      emitTaskProgress({
        taskId: appStore.tasks[0]!.id,
        phase: 'downloading',
        targetCount: 3,
        savedCount: 1,
        timestamp: '2026-05-02 10:00:02',
      })

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('1/3')
      expect(getTaskProgressPercent(appStore.tasks[0]!)).toBe(33)

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务进度结构化日志到达后会立刻刷新下载进度', async () => {
      const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitRuntimeLogs([
        {
          id: 99_101,
          level: 'INFO',
          scope: 'task-progress',
          timestamp: '2026-05-02 10:00:00',
          message: JSON.stringify({
            phase: 'downloading',
            targetCount: 3,
            savedCount: 0,
          }),
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('-/3')

      emitRuntimeLogs([
        {
          id: 99_102,
          level: 'INFO',
          scope: 'task-progress',
          timestamp: '2026-05-02 10:00:02',
          message: JSON.stringify({
            phase: 'downloading',
            targetCount: 3,
            savedCount: 1,
          }),
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('1/3')

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务仅收到实时下载日志时也会逐张刷新下载进度', async () => {
      const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitRuntimeLogs([
        {
          id: 99_110,
          level: 'INFO',
          scope: 'matcher',
          timestamp: '2026-05-02 10:10:00',
          message: 'discovered 3 images from douban -> D:/cover/Douban Title - 2026-05-01/wallpaper',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('-/3')

      emitRuntimeLogs([
        {
          id: 99_111,
          level: 'INFO',
          scope: 'downloader',
          timestamp: '2026-05-02 10:10:01',
          message: 'saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-1.jpg',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('1/3')

      emitRuntimeLogs([
        {
          id: 99_112,
          level: 'INFO',
          scope: 'downloader',
          timestamp: '2026-05-02 10:10:02',
          message: 'saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-2.jpg',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 2)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('2/3')

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务收到带作用域前缀的下载日志时也会逐张刷新下载进度', async () => {
      const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitRuntimeLogs([
        {
          id: 99_115,
          level: 'INFO',
          scope: 'sidecar',
          timestamp: '2026-05-02 10:11:00',
          message: '[matcher] discovered 3 images from douban -> D:/cover/Douban Title - 2026-05-01/wallpaper',
          taskId: appStore.tasks[0]!.id,
        },
        {
          id: 99_116,
          level: 'INFO',
          scope: 'sidecar',
          timestamp: '2026-05-02 10:11:01',
          message: '[downloader] saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-1.jpg',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1)
      expect(formatTaskProgress(appStore.tasks[0]!)).toBe('1/3')

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务进度更新时会替换任务列表引用以触发表格重渲染', async () => {
      const { appStore, runtimeBridge, emitTaskProgress } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      const previousTasksReference = appStore.tasks

      emitTaskProgress({
        taskId: appStore.tasks[0]!.id,
        phase: 'downloading',
        targetCount: 3,
        savedCount: 1,
        timestamp: '2026-05-02 10:00:02',
      })

      await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1)
      expect(appStore.tasks).not.toBe(previousTasksReference)

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务进度更新时会递增表格刷新节拍', async () => {
      const { appStore, runtimeBridge, emitTaskProgress } = await setupStore()
      let resolveTask: (() => void) | null = null

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveTask = resolve
        })

        return createSuccessResult(3)
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      const previousTick = appStore.progressTick

      emitTaskProgress({
        taskId: appStore.tasks[0]!.id,
        phase: 'downloading',
        targetCount: 3,
        savedCount: 1,
        timestamp: '2026-05-02 10:00:02',
      })

      await waitFor(() => appStore.progressTick > previousTick)
      expect(appStore.progressTick).toBe(previousTick + 1)

      releaseDeferred(resolveTask)
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
    })

    it('原生任务完成后晚到的进度事件不会把状态改回下载中', async () => {
      const { appStore, runtimeBridge, emitTaskProgress, emitRuntimeLogs } = await setupStore()

      runtimeBridge.runDownloadTask = vi.fn(async () => createSuccessResult(10))

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
      const taskId = appStore.tasks[0]!.id

      emitTaskProgress({
        taskId,
        phase: 'downloading',
        targetCount: 10,
        savedCount: 10,
        timestamp: '2026-05-02 20:08:00',
      })
      emitRuntimeLogs([
        {
          id: 99_120,
          level: 'INFO',
          scope: 'downloader',
          timestamp: '2026-05-02 20:08:01',
          message: 'saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-10.jpg',
          taskId,
        },
      ])

      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(appStore.tasks[0]?.lifecycle.phase).toBe('completed')
      expect(appStore.tasks[0]?.download?.savedCount).toBe(10)
    })

    it('原生任务失败时不会把已解析片名覆盖回待解析标题', async () => {
      const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore()

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        throw new Error('douban photo category is empty|title=%E6%B6%88%E5%A4%B1%E7%9A%84%E4%BA%BA')
      })

      await appStore.createTasks([createDraft()])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      emitRuntimeLogs([
        {
          id: 99_002,
          level: 'INFO',
          scope: 'discoverer',
          timestamp: '2026-05-01 21:05:00',
          message: '片名已解析: 消失的人',
          taskId: appStore.tasks[0]!.id,
        },
      ])

      await waitFor(() => appStore.tasks[0]?.title === '消失的人')
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.title).toBe('消失的人')
      expect(appStore.tasks[0]?.summary).toBe('消失的人暂时没有壁纸')
    })

    it('原生任务空分类失败时即使未先刷新解析日志也会回填任务标题', async () => {
      const { appStore, runtimeBridge } = await setupStore()

      runtimeBridge.runDownloadTask = vi.fn(async () => {
        throw new Error('douban photo category is empty|title=%E5%AF%92%E6%88%981994%20%E5%AF%92%E6%88%B01994')
      })

      await appStore.createTasks([
        createDraft({
          detailUrl: 'https://movie.douban.com/subject/36857924/',
        }),
      ])

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'failed')

      expect(appStore.tasks[0]?.title).toBe('寒战1994 寒戰1994')
      expect(appStore.tasks[0]?.summary).toBe('寒战1994 寒戰1994暂时没有壁纸')
    })
  })

  describe('pause and resume', () => {
    it('任务可以暂停并进入 paused 状态', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      let pausedTaskId = ''

      runtimeBridge.pauseDownloadTask = vi.fn(async (taskId: string) => {
        pausedTaskId = taskId
        return taskId
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id

      appStore.tasks[0] = {
        ...appStore.tasks[0]!,
        lifecycle: {
          ...appStore.tasks[0]!.lifecycle,
          phase: 'downloading',
        },
        summary: '下载中',
      }

      await appStore.pauseTask(taskId)

      expect(pausedTaskId).toBe(taskId)
      expect(appStore.tasks[0]?.lifecycle.phase).toBe('paused')
      expect(appStore.tasks[0]?.summary).toBe('任务已暂停')
    })

    it('原生任务因用户暂停而中断时不会被覆盖成失败状态', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      let pausedTaskId = ''
      let allowPauseFailure = false

      runtimeBridge.pauseDownloadTask = vi.fn(async (taskId: string) => {
        pausedTaskId = taskId
        return taskId
      })
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await waitFor(() => allowPauseFailure)
        throw new Error('task paused by user')
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'resolving')

      const pausePromise = appStore.pauseTask(taskId)
      allowPauseFailure = true
      await pausePromise

      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'paused')

      expect(pausedTaskId).toBe(taskId)
      expect(appStore.tasks[0]?.lifecycle.phase).toBe('paused')
      expect(appStore.tasks[0]?.summary).toBe('任务已暂停')
    })

    it('任务继续后会回到 retrying 并重开队列', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      let resumedTaskId = ''
      let releaseTask: (() => void) | null = null

      runtimeBridge.resumeDownloadTask = vi.fn(async (taskId: string) => {
        resumedTaskId = taskId
        return taskId
      })
      runtimeBridge.runDownloadTask = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseTask = resolve
        })
        return createSuccessResult()
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id

      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'paused',
        },
        summary: '任务已暂停',
      }
      taskQueueStore.queueRunning = false

      await appStore.resumeTask(taskId)

      expect(resumedTaskId).toBe(taskId)
      expect(appStore.tasks[0]?.lifecycle.phase).toBe('retrying')
      expect(appStore.tasks[0]?.summary).toBe('任务继续中')
      expect(appStore.queueRunning).toBe(true)

      releaseDeferred(releaseTask)
    })
  })

  describe('task deletion', () => {
    it('删除单条任务时会调用原生后台清理对应任务和输出目录', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const deletedDirectories: string[] = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.deleteDirectoryPath = vi.fn(async (directoryPath: string) => {
        deletedDirectories.push(directoryPath)
        return directoryPath
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'queued',
        },
        outputDirectory: 'D:/cover/让子弹飞 - 2026-05-02/still',
      }
      taskQueueStore.queueRunning = false
      taskQueueStore.activeTaskIds = []

      await appStore.deleteTask(taskId)

      expect(clearedTaskIds).toEqual([[taskId]])
      expect(deletedDirectories).toEqual(['D:/cover/让子弹飞 - 2026-05-02/still'])
      expect(appStore.tasks.length).toBe(0)
    })

    it('删除早期进度任务时不会尝试删除输出根目录', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const deletedDirectories: string[] = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.deleteDirectoryPath = vi.fn(async (directoryPath: string) => {
        deletedDirectories.push(directoryPath)
        return directoryPath
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'queued',
        },
        download: {
          savedCount: 0,
          targetCount: 10,
          directory: 'D:/cover',
          files: [],
        },
      }
      taskQueueStore.queueRunning = false
      taskQueueStore.activeTaskIds = []

      await appStore.deleteTask(taskId)

      expect(clearedTaskIds).toEqual([[taskId]])
      expect(deletedDirectories).toEqual([])
      expect(appStore.tasks.length).toBe(0)
    })

    it('队列下载中不能删除单条任务', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })

      await appStore.createTasks([createDraft(), createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' })])
      const taskId = appStore.tasks[0]!.id
      const runningTaskId = appStore.tasks[1]!.id
      taskQueueStore.queueRunning = true
      taskQueueStore.activeTaskIds = [taskId, runningTaskId]
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'downloading',
        },
      }

      await appStore.deleteTask(taskId)

      expect(clearedTaskIds).toEqual([])
      expect(appStore.tasks.length).toBe(2)
    })

    it('已暂停任务可以在队列未结束时删除', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const deletedDirectories: string[] = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.deleteDirectoryPath = vi.fn(async (directoryPath: string) => {
        deletedDirectories.push(directoryPath)
        return directoryPath
      })

      await appStore.createTasks([createDraft(), createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' })])
      const taskId = appStore.tasks[0]!.id
      const runningTaskId = appStore.tasks[1]!.id
      taskQueueStore.queueRunning = true
      taskQueueStore.activeTaskIds = [taskId, runningTaskId]
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'paused',
        },
        summary: '任务已暂停',
      }
      taskQueueStore.tasks[1] = {
        ...taskQueueStore.tasks[1]!,
        lifecycle: {
          ...taskQueueStore.tasks[1]!.lifecycle,
          phase: 'downloading',
        },
      }

      await appStore.deleteTask(taskId)

      expect(clearedTaskIds).toEqual([[taskId]])
      expect(deletedDirectories).toEqual([])
      expect(appStore.tasks.length).toBe(1)
      expect(appStore.tasks[0]?.id).toBe(runningTaskId)
    })

    it('删除一个已暂停任务后仍可清空剩余已暂停任务', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const clearedRootDirectories: Array<{ directoryPath: string; rootDirectoryPath: string }> = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.clearDirectoryContents = vi.fn(async (directoryPath: string, rootDirectoryPath: string) => {
        clearedRootDirectories.push({ directoryPath, rootDirectoryPath })
        return 1
      })

      await appStore.createTasks([createDraft(), createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' })])
      const deletedTaskId = appStore.tasks[0]!.id
      const remainingTaskId = appStore.tasks[1]!.id
      taskQueueStore.queueRunning = true
      taskQueueStore.activeTaskIds = [deletedTaskId, remainingTaskId]
      taskQueueStore.tasks = taskQueueStore.tasks.map((task) => ({
        ...task,
        lifecycle: {
          ...task.lifecycle,
          phase: 'paused' as const,
        },
        summary: '任务已暂停',
      }))

      await appStore.deleteTask(deletedTaskId)
      await appStore.clearQueueTasks()

      expect(clearedTaskIds).toEqual([[deletedTaskId], [remainingTaskId]])
      expect(clearedRootDirectories).toEqual([{ directoryPath: 'D:/cover', rootDirectoryPath: 'D:/cover' }])
      expect(appStore.tasks.length).toBe(0)
      expect(taskQueueStore.queueRunning).toBe(false)
    })

    it('clear queue clears output root directories for all tasks', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const deletedDirectories: Array<{ directoryPath: string; rootDirectoryPath: string }> = []
      const clearedRootDirectories: Array<{ directoryPath: string; rootDirectoryPath: string }> = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.deleteDirectoryPath = vi.fn(async (directoryPath: string, rootDirectoryPath: string) => {
        deletedDirectories.push({ directoryPath, rootDirectoryPath })
        return directoryPath
      })
      runtimeBridge.clearDirectoryContents = vi.fn(async (directoryPath: string, rootDirectoryPath: string) => {
        clearedRootDirectories.push({ directoryPath, rootDirectoryPath })
        return 1
      })

      await appStore.createTasks([
        createDraft(),
        createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' }),
        createDraft({ detailUrl: 'https://movie.douban.com/subject/1292064/', outputRootDir: 'D:/poster' }),
      ])

      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        outputDirectory: 'D:/cover/飞驰人生3 - 2026-05-03/still',
      }
      taskQueueStore.tasks[1] = {
        ...taskQueueStore.tasks[1]!,
        download: {
          savedCount: 1,
          targetCount: 2,
          directory: 'D:/cover/让子弹飞 - 2026-05-02/still',
          files: ['still-1.jpg'],
        },
      }
      taskQueueStore.tasks[2] = {
        ...taskQueueStore.tasks[2]!,
        download: {
          savedCount: 0,
          targetCount: 0,
          directory: 'D:/poster',
          files: [],
        },
      }
      taskQueueStore.tasks = taskQueueStore.tasks.map((task) => ({
        ...task,
        lifecycle: {
          ...task.lifecycle,
          phase: 'queued' as const,
        },
      }))
      taskQueueStore.queueRunning = false
      taskQueueStore.activeTaskIds = []

      await appStore.clearQueueTasks()

      expect(clearedTaskIds.length).toBe(1)
      expect(clearedTaskIds[0]?.length).toBe(3)
      expect(deletedDirectories).toEqual([])
      expect(clearedRootDirectories).toEqual([
        { directoryPath: 'D:/cover', rootDirectoryPath: 'D:/cover' },
        { directoryPath: 'D:/poster', rootDirectoryPath: 'D:/poster' },
      ])
      expect(appStore.tasks.length).toBe(0)
      expect(taskQueueStore.queueRunning).toBe(false)
    })

    it('队列下载中不能清空全部任务', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })

      await appStore.createTasks([createDraft(), createDraft({ detailUrl: 'https://movie.douban.com/subject/1292052/' })])
      taskQueueStore.queueRunning = true
      taskQueueStore.activeTaskIds = [appStore.tasks[0]!.id]
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'downloading',
        },
      }

      await appStore.clearQueueTasks()

      expect(clearedTaskIds).toEqual([])
      expect(appStore.tasks.length).toBe(2)
    })

    it('队列只剩已暂停任务时可以清空', async () => {
      const { appStore, taskQueueStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const clearedRootDirectories: Array<{ directoryPath: string; rootDirectoryPath: string }> = []

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.clearDirectoryContents = vi.fn(async (directoryPath: string, rootDirectoryPath: string) => {
        clearedRootDirectories.push({ directoryPath, rootDirectoryPath })
        return 1
      })

      await appStore.createTasks([createDraft()])
      const taskId = appStore.tasks[0]!.id
      taskQueueStore.queueRunning = true
      taskQueueStore.activeTaskIds = [taskId]
      taskQueueStore.tasks[0] = {
        ...taskQueueStore.tasks[0]!,
        lifecycle: {
          ...taskQueueStore.tasks[0]!.lifecycle,
          phase: 'paused',
        },
        summary: '任务已暂停',
      }

      await appStore.clearQueueTasks()

      expect(clearedTaskIds).toEqual([[taskId]])
      expect(clearedRootDirectories).toEqual([{ directoryPath: 'D:/cover', rootDirectoryPath: 'D:/cover' }])
      expect(appStore.tasks.length).toBe(0)
      expect(taskQueueStore.queueRunning).toBe(false)
    })
  })

  describe('selected photo tasks', () => {
    it('selected photo tasks can replace older task with same link output category and ratio', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const selectedImage = {
        id: 'selected-1',
        source: 'douban' as const,
        title: 'selected still',
        imageUrl: 'https://img.example.com/selected-1.jpg',
        category: 'still' as const,
        doubanAssetType: 'still' as const,
        orientation: 'horizontal' as const,
      }
      const oldDraft = createDraft({
        doubanAssetType: 'still',
        selectedImages: [selectedImage],
        selectedPhotoTitle: 'Short Title',
      })
      const newDraft = createDraft({
        doubanAssetType: 'still',
        selectedImages: [selectedImage],
        selectedPhotoTitle: 'Short Title Full (2026)',
      })

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.runSelectedPhotoDownload = vi.fn(async (payload) => {
        const result = createSuccessResult(payload.selectedImages.length)
        return {
          ...result,
          discovery: {
            ...result.discovery,
            detailUrl: payload.detailUrl,
            imagePageUrl: `${payload.detailUrl}all_photos`,
            normalizedTitle: payload.selectedPhotoTitle ?? result.discovery.normalizedTitle,
            images: payload.selectedImages,
          },
        }
      })

      await appStore.createTasks([oldDraft])
      await waitFor(() => appStore.tasks[0]?.lifecycle.phase === 'completed')
      const oldTaskId = appStore.tasks[0]!.id
      await appStore.createTasks([oldDraft])
      await waitFor(() => appStore.tasks.length === 2 && appStore.tasks.every((task) => task.lifecycle.phase === 'completed'))
      const secondOldTaskId = appStore.tasks.find((task) => task.id !== oldTaskId)!.id
      const duplicateTasks = appStore.findDuplicateTasksForDrafts([newDraft])

      expect(
        appStore.findDuplicateTasksForDrafts([
          createDraft({
            doubanAssetType: 'still',
            outputRootDir: 'D:/other-cover',
            selectedImages: [selectedImage],
            selectedPhotoTitle: 'Short Title Full (2026)',
          }),
        ]),
      ).toEqual([])
      expect(
        appStore.findDuplicateTasksForDrafts([
          createDraft({
            doubanAssetType: 'still',
            imageAspectRatio: '3:4',
            selectedImages: [selectedImage],
            selectedPhotoTitle: 'Short Title Full (2026)',
          }),
        ]),
      ).toEqual([])
      expect(duplicateTasks.map((task) => task.id)).toEqual([oldTaskId, secondOldTaskId])

      await appStore.createTasks([newDraft], { replacementTaskIds: duplicateTasks.map((task) => task.id) })

      expect(clearedTaskIds[clearedTaskIds.length - 1]).toEqual([oldTaskId, secondOldTaskId])
      expect(appStore.tasks.length).toBe(1)
      expect(appStore.tasks[0]?.id).not.toBe(oldTaskId)
      expect(appStore.tasks[0]?.id).not.toBe(secondOldTaskId)
      expect(appStore.tasks[0]?.target.selectedPhotoTitle).toBe('Short Title Full (2026)')
    })

    it('selected photo tasks keep the same base title and show category across categories', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const selectedStill = {
        id: 'selected-still',
        source: 'douban' as const,
        title: 'selected still',
        imageUrl: 'https://img.example.com/selected-still.jpg',
        category: 'still' as const,
        doubanAssetType: 'still' as const,
        orientation: 'horizontal' as const,
      }
      const selectedPoster = {
        id: 'selected-poster',
        source: 'douban' as const,
        title: 'selected poster',
        imageUrl: 'https://img.example.com/selected-poster.jpg',
        category: 'poster' as const,
        doubanAssetType: 'poster' as const,
        orientation: 'vertical' as const,
      }

      runtimeBridge.runSelectedPhotoDownload = vi.fn(async (payload) => {
        const result = createSuccessResult(payload.selectedImages.length)
        const outputDir = `${payload.outputRootDir}/Shared Title/selected/${payload.doubanAssetType}/${payload.doubanAssetType}-original`
        return {
          ...result,
          discovery: {
            ...result.discovery,
            detailUrl: payload.detailUrl,
            imagePageUrl: `${payload.detailUrl}all_photos`,
            normalizedTitle: payload.selectedPhotoTitle ?? result.discovery.normalizedTitle,
            outputDir,
            images: payload.selectedImages,
          },
          download: {
            ...result.download,
            outputDir,
          },
        }
      })

      await appStore.createTasks([
        createDraft({
          doubanAssetType: 'still',
          selectedImages: [selectedStill],
          selectedPhotoTitle: 'Shared Title',
        }),
        createDraft({
          doubanAssetType: 'poster',
          selectedImages: [selectedPoster],
          selectedPhotoTitle: 'Shared Title',
        }),
      ])
      await waitFor(() => appStore.tasks.length === 2 && appStore.tasks.every((task) => task.lifecycle.phase === 'completed'))

      expect(appStore.tasks.map((task) => task.title)).toEqual(['Shared Title 选图下载', 'Shared Title 选图下载'])
      expect(appStore.tasks.map((task) => formatTaskTitle(task))).toEqual(['Shared Title 剧照 选图下载', 'Shared Title 海报 选图下载'])
      expect(appStore.tasks.map((task) => task.target.doubanAssetType)).toEqual(['still', 'poster'])
      expect(
        appStore.findDuplicateTasksForDrafts([
          createDraft({
            doubanAssetType: 'still',
            selectedImages: [selectedStill],
            selectedPhotoTitle: 'Shared Title',
          }),
        ]).map((task) => task.target.doubanAssetType),
      ).toEqual(['still'])
    })

    it('selected photo tasks replace active older task after replacement confirmation', async () => {
      const { appStore, runtimeBridge } = await setupStore()
      const clearedTaskIds: string[][] = []
      const selectedImage = {
        id: 'selected-1',
        source: 'douban' as const,
        title: 'selected still',
        imageUrl: 'https://img.example.com/selected-1.jpg',
        category: 'still' as const,
        doubanAssetType: 'still' as const,
        orientation: 'horizontal' as const,
      }
      const oldDraft = createDraft({
        doubanAssetType: 'still',
        selectedImages: [selectedImage],
        selectedPhotoTitle: 'Short Title',
      })
      const newDraft = createDraft({
        doubanAssetType: 'still',
        selectedImages: [selectedImage],
        selectedPhotoTitle: 'Short Title Full (2026)',
      })
      const startedTaskIds: string[] = []
      let releaseFirstTask: (() => void) | null = null

      runtimeBridge.clearDownloadTasks = vi.fn(async (taskIds: string[]) => {
        clearedTaskIds.push(taskIds)
        return taskIds.length
      })
      runtimeBridge.runSelectedPhotoDownload = vi.fn(async (payload) => {
        startedTaskIds.push(payload.taskId)
        if (startedTaskIds.length === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstTask = resolve
          })
        }

        const result = createSuccessResult(payload.selectedImages.length)
        return {
          ...result,
          discovery: {
            ...result.discovery,
            detailUrl: payload.detailUrl,
            imagePageUrl: `${payload.detailUrl}all_photos`,
            normalizedTitle: payload.selectedPhotoTitle ?? result.discovery.normalizedTitle,
            images: payload.selectedImages,
          },
        }
      })

      await appStore.createTasks([oldDraft])
      await waitFor(() => startedTaskIds.length === 1)
      const oldTaskId = appStore.tasks[0]!.id

      const duplicateTasks = appStore.findDuplicateTasksForDrafts([newDraft])
      expect(duplicateTasks.map((task) => task.id)).toEqual([oldTaskId])

      await appStore.createTasks([newDraft], { replacementTaskIds: [oldTaskId] })

      expect(clearedTaskIds).toEqual([[oldTaskId]])
      expect(appStore.tasks.length).toBe(1)
      expect(appStore.tasks[0]?.id).not.toBe(oldTaskId)
      expect(appStore.activeTaskIds.includes(oldTaskId)).toBe(false)

      releaseDeferred(releaseFirstTask)

      await waitFor(() => appStore.tasks.every((task) => task.lifecycle.phase === 'completed'))
    })
  })
})
