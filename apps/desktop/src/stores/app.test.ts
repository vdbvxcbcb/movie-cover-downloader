import test from "node:test";
import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { formatTaskProgress, getTaskProgressPercent } from "../lib/presenters";
import type { RuntimeDownloadTaskResult, RuntimeTaskProgressEvent, TaskDraft } from "../types/app";

function createWindowStub() {
  const target = new EventTarget();
  const storage = new Map<string, string>();

  return {
    setTimeout,
    clearTimeout,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
    },
    prompt() {
      return null;
    },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for store state");
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function createDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    detailUrl: "https://movie.douban.com/subject/34780991/",
    outputRootDir: "D:/cover",
    sourceHint: "auto",
    doubanAssetType: "wallpaper",
    imageCountMode: "limited",
    maxImages: 50,
    outputImageFormat: "jpg",
    requestIntervalSeconds: 1,
    ...overrides,
  };
}

function createSuccessResult(imageCount = 1): RuntimeDownloadTaskResult {
  const normalizedTitle = "Douban Title";
  const outputDir = "D:/cover/Douban Title - 2026-05-01";

  return {
    discovery: {
      source: "douban",
      detailUrl: "https://movie.douban.com/subject/34780991/",
      imagePageUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
      normalizedTitle,
      outputFolderName: `${normalizedTitle} - 2026-05-01`,
      outputDir,
      images: Array.from({ length: imageCount }, (_, index) => ({
        id: `douban-image-${index + 1}`,
        source: "douban",
        title: normalizedTitle,
        imageUrl: `https://img.example.com/douban-${index + 1}.jpg`,
        category: "still" as const,
        orientation: "horizontal" as const,
      })),
    },
    download: {
      outputDir,
      saved: Array.from({ length: imageCount }, (_, index) => ({
        sourceUrl: `https://img.example.com/douban-${index + 1}.jpg`,
        outputPath: `${outputDir}/douban-${index + 1}.jpg`,
        category: "still" as const,
        orientation: "horizontal" as const,
      })),
      source: "douban",
    },
  };
}

async function setupStore(overrides?: {
  loadState?: typeof import("../lib/runtime-bridge").runtimeBridge.loadState;
  saveState?: typeof import("../lib/runtime-bridge").runtimeBridge.saveState;
  structuredCloneImpl?: typeof globalThis.structuredClone;
}) {
  const nativeStructuredClone = globalThis.structuredClone;
  Object.assign(globalThis, {
    window: createWindowStub(),
    structuredClone:
      overrides?.structuredCloneImpl ??
      ((<T>(value: T) => JSON.parse(JSON.stringify(value)) as T) as typeof globalThis.structuredClone),
    CustomEvent: class<T> extends Event {
      detail: T;

      constructor(type: string, init: CustomEventInit<T>) {
        super(type);
        this.detail = init.detail as T;
      }
    },
  });

  const { runtimeBridge } = await import("../lib/runtime-bridge");
  let runtimeLogListener: ((entries: import("../types/app").LogEntry[]) => void) | null = null;
  let taskProgressListener: ((event: RuntimeTaskProgressEvent) => void) | null = null;
  runtimeBridge.onRuntimeLogBatch = async () => () => {};
  runtimeBridge.onRuntimeLogBatch = async (listener) => {
    runtimeLogListener = listener;
    return () => {
      runtimeLogListener = null;
    };
  };
  runtimeBridge.onTaskProgress = async (listener) => {
    taskProgressListener = listener;
    return () => {
      taskProgressListener = null;
    };
  };
  runtimeBridge.emitLog = async () => {};
  runtimeBridge.saveState = overrides?.saveState ?? (async () => {});
  runtimeBridge.loadState = overrides?.loadState ?? (async () => null);
  runtimeBridge.isNativeRuntime = () => true;
  runtimeBridge.pauseDownloadTask = async () => {};
  runtimeBridge.resumeDownloadTask = async () => {};
  runtimeBridge.clearDownloadTasks = async () => 0;
  runtimeBridge.deleteDirectoryPath = async (directoryPath: string) => directoryPath;

  const { useAppStore } = await import("./app");
  setActivePinia(createPinia());
  const appStore = useAppStore();
  await appStore.bootstrap();

  return {
    appStore,
    runtimeBridge,
    emitRuntimeLogs(entries: import("../types/app").LogEntry[]) {
      runtimeLogListener?.(entries);
    },
    emitTaskProgress(event: RuntimeTaskProgressEvent) {
      taskProgressListener?.(event);
    },
    restoreStructuredClone() {
      globalThis.structuredClone = nativeStructuredClone;
    },
  };
}

test("持久化状态加载失败后仍会完成 hydration 并允许后续保存", async () => {
  let saveCalls = 0;
  const { appStore } = await setupStore({
    loadState: async () => {
      throw new Error("sqlite is busy");
    },
    saveState: async () => {
      saveCalls += 1;
    },
  });

  assert.equal(appStore.hydrated, true);

  await appStore.importCookie({
    value: 'dbcl2="repair"; ck=repair',
    note: "repair cookie",
  });

  await waitFor(() => saveCalls > 0);
  assert.ok(saveCalls > 0);
});

test("持久化写入进行中时新的保存请求会串行排队而不是并发覆盖", async () => {
  let saveCalls = 0;
  let inflight = 0;
  let maxInflight = 0;

  const { appStore } = await setupStore({
    saveState: async () => {
      saveCalls += 1;
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 220));
      inflight -= 1;
    },
  });

  const clearPromise = appStore.clearAllLogs();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await appStore.importCookie({
    value: 'dbcl2="queue"; ck=queue',
    note: "queue cookie",
  });

  await clearPromise;
  await waitFor(() => saveCalls >= 2);

  assert.equal(maxInflight, 1);
  assert.ok(saveCalls >= 2);
});

test("已恢复日志与新运行日志撞号时保存前会自动改写为唯一日志 ID", async () => {
  const savedSnapshots: import("../types/app").AppSeedState[] = [];
  const { appStore, emitRuntimeLogs } = await setupStore({
    loadState: async () => ({
      schemaVersion: 2,
      tasks: [],
      cookies: [],
      logs: [
        {
          id: 10_000,
          level: "INFO",
          scope: "bootstrap",
          timestamp: "2026-05-02 14:20:00",
          message: "old log",
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
      savedSnapshots.push(snapshot);
    },
  });

  emitRuntimeLogs([
    {
      id: 10_000,
      level: "INFO",
      scope: "cookie",
      timestamp: "2026-05-02 14:21:00",
      message: "new log",
    },
  ]);

  await appStore.importCookie({
    value: 'dbcl2="dedupe"; ck=dedupe',
    note: "dedupe cookie",
  });

  await waitFor(() => savedSnapshots.length > 0);
  const latestSnapshot = savedSnapshots.at(-1)!;
  const logIds = latestSnapshot.logs.map((entry) => entry.id);

  assert.equal(new Set(logIds).size, logIds.length);
});

test("持久化保存失败时会在提示中显示真实错误摘要", async () => {
  const { appStore } = await setupStore({
    saveState: async () => {
      throw new Error("写入日志失败: UNIQUE constraint failed: app_logs.id");
    },
  });

  await appStore.importCookie({
    value: 'dbcl2="broken"; ck=broken',
    note: "broken cookie",
  });

  await waitFor(() => appStore.notice?.message?.includes("UNIQUE constraint failed"));
  assert.match(appStore.notice?.message ?? "", /UNIQUE constraint failed: app_logs\.id/);
});

test("浏览器原生 structuredClone 遇到响应式数组时持久化仍然可以成功", async () => {
  const saveSnapshots: import("../types/app").AppSeedState[] = [];
  const { appStore, restoreStructuredClone } = await setupStore({
    structuredCloneImpl: globalThis.structuredClone,
    saveState: async (snapshot) => {
      saveSnapshots.push(snapshot);
    },
  });

  try {
    await appStore.importCookie({
      value: 'dbcl2="native"; ck=native',
      note: "native cookie",
    });

    await waitFor(() => saveSnapshots.length > 0);
    assert.equal(appStore.notice?.message?.includes("structuredClone"), false);
    assert.equal(saveSnapshots[0]?.cookies[0]?.note, "native cookie");
  } finally {
    restoreStructuredClone();
  }
});

test("删除旧 Cookie 后再次导入不会复用同一 ID", async () => {
  const { appStore } = await setupStore();

  await appStore.importCookie({
    value: 'dbcl2="first"; ck=first',
    note: "first cookie",
  });
  const firstId = appStore.cookies[0]?.id;

  await appStore.deleteCookie(firstId!);

  await appStore.importCookie({
    value: 'dbcl2="second"; ck=second',
    note: "second cookie",
  });
  const secondId = appStore.cookies[0]?.id;

  assert.equal(firstId, "300");
  assert.notEqual(secondId, firstId);
});

test("豆瓣 empty 失败时会按抓图类型生成动态中文摘要且 Cookie 保持 active", async () => {
  const cases = [
    { assetType: "still", expectedSummary: "示例电影暂时没有剧照" },
    { assetType: "poster", expectedSummary: "示例电影暂时没有海报" },
    { assetType: "wallpaper", expectedSummary: "示例电影暂时没有壁纸" },
  ] as const;

  for (const testCase of cases) {
    const { appStore, runtimeBridge } = await setupStore();
    runtimeBridge.runDownloadTask = async () => {
      throw new Error("douban photo category is empty|title=%E7%A4%BA%E4%BE%8B%E7%94%B5%E5%BD%B1");
    };

    await appStore.importCookie({
      value: 'dbcl2="demo"; ck=hb-J',
      note: "test cookie",
    });
    await appStore.createTasks([createDraft({ doubanAssetType: testCase.assetType })]);

    await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

    assert.equal(appStore.tasks[0]?.summary, testCase.expectedSummary);
    assert.equal(appStore.cookies[0]?.status, "active");
    assert.equal(appStore.cookies[0]?.failure, 0);
  }
});

test("豆瓣 risk 失败时显示中文摘要且 Cookie 进入 cooling", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  runtimeBridge.runDownloadTask = async () => {
    throw new Error("douban risk page detected");
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([createDraft()]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.summary, "触发豆瓣风控，请稍后重试");
  assert.equal(appStore.cookies[0]?.status, "cooling");
  assert.equal(appStore.cookies[0]?.failure, 1);
  assert.ok(appStore.cookies[0]?.coolingUntil);
});

test("豆瓣 auth 失败时显示中文摘要且 Cookie 进入 cooling", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  runtimeBridge.runDownloadTask = async () => {
    throw new Error("douban session expired, please sign in again");
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([createDraft()]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.summary, "豆瓣登录状态失效，请重新导入 Cookie");
  assert.equal(appStore.cookies[0]?.status, "cooling");
  assert.equal(appStore.cookies[0]?.failure, 1);
  assert.ok(appStore.cookies[0]?.coolingUntil);
});

test("豆瓣 generic 反爬失败时显示中文摘要且保持冷却判断", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  runtimeBridge.runDownloadTask = async () => {
    throw new Error("HTTP 429 from sec.douban.com captcha required");
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([createDraft()]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.summary, "豆瓣访问受限，请稍后重试或重新导入 Cookie");
  assert.equal(appStore.cookies[0]?.status, "cooling");
  assert.equal(appStore.cookies[0]?.failure, 1);
});

test("豆瓣 generic 登录态关键词错误时显示中文摘要但不进入 cooling", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  runtimeBridge.runDownloadTask = async () => {
    throw new Error("unauthorized cookie sync failed after login redirect");
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([createDraft()]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.summary, "豆瓣抓图失败，请稍后重试");
  assert.equal(appStore.cookies[0]?.status, "active");
  assert.equal(appStore.cookies[0]?.failure, 0);
  assert.equal(appStore.cookies[0]?.coolingUntil, undefined);
});

test("豆瓣 unexpected 失败时显示中文摘要且 Cookie 保持 active", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  runtimeBridge.runDownloadTask = async () => {
    throw new Error("douban page structure mismatch");
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([createDraft()]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.summary, "豆瓣页面结构异常，暂时无法解析");
  assert.equal(appStore.cookies[0]?.status, "active");
  assert.equal(appStore.cookies[0]?.failure, 0);
  assert.equal(appStore.cookies[0]?.coolingUntil, undefined);
});

test("豆瓣任务在保护模式下串行执行", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  const started: string[] = [];
  let releaseFirstDouban: (() => void) | null = null;
  let secondDoubanStarted = false;

  runtimeBridge.runDownloadTask = async (payload) => {
    started.push(payload.detailUrl);

    if (releaseFirstDouban === null) {
      await new Promise<void>((resolve) => {
        releaseFirstDouban = resolve;
      });
    } else {
      secondDoubanStarted = true;
    }

    return createSuccessResult();
  };

  await appStore.importCookie({
    value: 'dbcl2="demo"; ck=hb-J',
    note: "test cookie",
  });
  await appStore.createTasks([
    createDraft({ detailUrl: "https://movie.douban.com/subject/34780991/" }),
    createDraft({ detailUrl: "https://movie.douban.com/subject/1292052/" }),
  ]);

  await waitFor(() => started.length >= 1);

  assert.equal(started.length, 1);
  assert.equal(secondDoubanStarted, false);

  releaseFirstDouban?.();

  await waitFor(() => appStore.tasks.every((task) => task.lifecycle.phase === "completed"));

  assert.equal(started.length, 2);
});

test("原生任务处理中收到片名解析日志后会立即更新队列标题", async () => {
  const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult();
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitRuntimeLogs([
    {
      id: 99_001,
      level: "INFO",
      scope: "discoverer",
      timestamp: "2026-05-01 20:40:00",
      message: "片名已解析: 消失的人",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.title === "消失的人");
  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务发现总数后进度先显示短横线并在 task-progress 事件后实时递增", async () => {
  const { appStore, runtimeBridge, emitTaskProgress } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitTaskProgress({
    taskId: appStore.tasks[0]!.id,
    phase: "downloading",
    targetCount: 3,
    savedCount: 0,
    timestamp: "2026-05-02 10:00:00",
  });

  await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "-/3");
  assert.equal(getTaskProgressPercent(appStore.tasks[0]!), 0);

  emitTaskProgress({
    taskId: appStore.tasks[0]!.id,
    phase: "downloading",
    targetCount: 3,
    savedCount: 1,
    timestamp: "2026-05-02 10:00:02",
  });

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "1/3");
  assert.equal(getTaskProgressPercent(appStore.tasks[0]!), 33);

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务进度结构化日志到达后会立刻刷新下载进度", async () => {
  const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitRuntimeLogs([
    {
      id: 99_101,
      level: "INFO",
      scope: "task-progress",
      timestamp: "2026-05-02 10:00:00",
      message: JSON.stringify({
        phase: "downloading",
        targetCount: 3,
        savedCount: 0,
      }),
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "-/3");

  emitRuntimeLogs([
    {
      id: 99_102,
      level: "INFO",
      scope: "task-progress",
      timestamp: "2026-05-02 10:00:02",
      message: JSON.stringify({
        phase: "downloading",
        targetCount: 3,
        savedCount: 1,
      }),
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "1/3");

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务仅收到实时下载日志时也会逐张刷新下载进度", async () => {
  const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitRuntimeLogs([
    {
      id: 99_110,
      level: "INFO",
      scope: "matcher",
      timestamp: "2026-05-02 10:10:00",
      message: "discovered 3 images from douban -> D:/cover/Douban Title - 2026-05-01/wallpaper",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.targetCount === 3);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "-/3");

  emitRuntimeLogs([
    {
      id: 99_111,
      level: "INFO",
      scope: "downloader",
      timestamp: "2026-05-02 10:10:01",
      message: "saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-1.jpg",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "1/3");

  emitRuntimeLogs([
    {
      id: 99_112,
      level: "INFO",
      scope: "downloader",
      timestamp: "2026-05-02 10:10:02",
      message: "saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-2.jpg",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 2);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "2/3");

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务收到带作用域前缀的下载日志时也会逐张刷新下载进度", async () => {
  const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitRuntimeLogs([
    {
      id: 99_115,
      level: "INFO",
      scope: "sidecar",
      timestamp: "2026-05-02 10:11:00",
      message: "[matcher] discovered 3 images from douban -> D:/cover/Douban Title - 2026-05-01/wallpaper",
      taskId: appStore.tasks[0]!.id,
    },
    {
      id: 99_116,
      level: "INFO",
      scope: "sidecar",
      timestamp: "2026-05-02 10:11:01",
      message: "[downloader] saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-1.jpg",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1);
  assert.equal(formatTaskProgress(appStore.tasks[0]!), "1/3");

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务进度更新时会替换任务列表引用以触发表格重渲染", async () => {
  const { appStore, runtimeBridge, emitTaskProgress } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  const previousTasksReference = appStore.tasks;

  emitTaskProgress({
    taskId: appStore.tasks[0]!.id,
    phase: "downloading",
    targetCount: 3,
    savedCount: 1,
    timestamp: "2026-05-02 10:00:02",
  });

  await waitFor(() => appStore.tasks[0]?.download?.savedCount === 1);
  assert.notStrictEqual(appStore.tasks, previousTasksReference);

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务进度更新时会递增表格刷新节拍", async () => {
  const { appStore, runtimeBridge, emitTaskProgress } = await setupStore();
  let resolveTask: (() => void) | null = null;

  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    return createSuccessResult(3);
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  const previousTick = appStore.progressTick;

  emitTaskProgress({
    taskId: appStore.tasks[0]!.id,
    phase: "downloading",
    targetCount: 3,
    savedCount: 1,
    timestamp: "2026-05-02 10:00:02",
  });

  await waitFor(() => appStore.progressTick > previousTick);
  assert.equal(appStore.progressTick, previousTick + 1);

  resolveTask?.();
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
});

test("原生任务完成后晚到的进度事件不会把状态改回下载中", async () => {
  const { appStore, runtimeBridge, emitTaskProgress, emitRuntimeLogs } = await setupStore();

  runtimeBridge.runDownloadTask = async () => createSuccessResult(10);

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "completed");
  const taskId = appStore.tasks[0]!.id;

  emitTaskProgress({
    taskId,
    phase: "downloading",
    targetCount: 10,
    savedCount: 10,
    timestamp: "2026-05-02 20:08:00",
  });
  emitRuntimeLogs([
    {
      id: 99_120,
      level: "INFO",
      scope: "downloader",
      timestamp: "2026-05-02 20:08:01",
      message: "saved image: D:/cover/Douban Title - 2026-05-01/wallpaper/douban-10.jpg",
      taskId,
    },
  ]);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(appStore.tasks[0]?.lifecycle.phase, "completed");
  assert.equal(appStore.tasks[0]?.download?.savedCount, 10);
});

test("原生任务失败时不会把已解析片名覆盖回待解析标题", async () => {
  const { appStore, runtimeBridge, emitRuntimeLogs } = await setupStore();

  runtimeBridge.runDownloadTask = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    throw new Error("douban photo category is empty|title=%E6%B6%88%E5%A4%B1%E7%9A%84%E4%BA%BA");
  };

  await appStore.createTasks([createDraft()]);
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  emitRuntimeLogs([
    {
      id: 99_002,
      level: "INFO",
      scope: "discoverer",
      timestamp: "2026-05-01 21:05:00",
      message: "片名已解析: 消失的人",
      taskId: appStore.tasks[0]!.id,
    },
  ]);

  await waitFor(() => appStore.tasks[0]?.title === "消失的人");
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.title, "消失的人");
  assert.equal(appStore.tasks[0]?.summary, "消失的人暂时没有壁纸");
});

test("原生任务空分类失败时即使未先刷新解析日志也会回填任务标题", async () => {
  const { appStore, runtimeBridge } = await setupStore();

  runtimeBridge.runDownloadTask = async () => {
    throw new Error("douban photo category is empty|title=%E5%AF%92%E6%88%981994%20%E5%AF%92%E6%88%B01994");
  };

  await appStore.createTasks([
    createDraft({
      detailUrl: "https://movie.douban.com/subject/36857924/",
    }),
  ]);

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "failed");

  assert.equal(appStore.tasks[0]?.title, "寒战1994 寒戰1994");
  assert.equal(appStore.tasks[0]?.summary, "寒战1994 寒戰1994暂时没有壁纸");
});

test("任务可以暂停并进入 paused 状态", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  let pausedTaskId = "";

  runtimeBridge.pauseDownloadTask = async (taskId: string) => {
    pausedTaskId = taskId;
  };

  await appStore.createTasks([createDraft()]);
  const taskId = appStore.tasks[0]!.id;

  appStore.tasks[0] = {
    ...appStore.tasks[0]!,
    lifecycle: {
      ...appStore.tasks[0]!.lifecycle,
      phase: "downloading",
    },
    summary: "下载中",
  };

  await appStore.pauseTask(taskId);

  assert.equal(pausedTaskId, taskId);
  assert.equal(appStore.tasks[0]?.lifecycle.phase, "paused");
  assert.equal(appStore.tasks[0]?.summary, "任务已暂停");
});

test("原生任务因用户暂停而中断时不会被覆盖成失败状态", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  let pausedTaskId = "";
  let allowPauseFailure = false;

  runtimeBridge.pauseDownloadTask = async (taskId: string) => {
    pausedTaskId = taskId;
  };
  runtimeBridge.runDownloadTask = async () => {
    await waitFor(() => allowPauseFailure);
    throw new Error("task paused by user");
  };

  await appStore.createTasks([createDraft()]);
  const taskId = appStore.tasks[0]!.id;
  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "resolving");

  const pausePromise = appStore.pauseTask(taskId);
  allowPauseFailure = true;
  await pausePromise;

  await waitFor(() => appStore.tasks[0]?.lifecycle.phase === "paused");

  assert.equal(pausedTaskId, taskId);
  assert.equal(appStore.tasks[0]?.lifecycle.phase, "paused");
  assert.equal(appStore.tasks[0]?.summary, "任务已暂停");
});

test("任务继续后会回到 retrying 并重开队列", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  let resumedTaskId = "";
  let releaseTask: (() => void) | null = null;

  runtimeBridge.resumeDownloadTask = async (taskId: string) => {
    resumedTaskId = taskId;
  };
  runtimeBridge.runDownloadTask = async () => {
    await new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    return createSuccessResult();
  };

  await appStore.createTasks([createDraft()]);
  const taskId = appStore.tasks[0]!.id;

  appStore.tasks[0] = {
    ...appStore.tasks[0]!,
    lifecycle: {
      ...appStore.tasks[0]!.lifecycle,
      phase: "paused",
    },
    summary: "任务已暂停",
  };
  appStore.queueRunning = false;

  await appStore.resumeTask(taskId);

  assert.equal(resumedTaskId, taskId);
  assert.equal(appStore.tasks[0]?.lifecycle.phase, "retrying");
  assert.equal(appStore.tasks[0]?.summary, "任务继续中");
  assert.equal(appStore.queueRunning, true);

  releaseTask?.();
});

test("删除单条任务时会调用原生后台清理对应任务和输出目录", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  const clearedTaskIds: string[][] = [];
  const deletedDirectories: string[] = [];

  runtimeBridge.clearDownloadTasks = async (taskIds: string[]) => {
    clearedTaskIds.push(taskIds);
    return taskIds.length;
  };
  runtimeBridge.deleteDirectoryPath = async (directoryPath: string) => {
    deletedDirectories.push(directoryPath);
    return directoryPath;
  };

  await appStore.createTasks([createDraft()]);
  const taskId = appStore.tasks[0]!.id;
  appStore.tasks[0] = {
    ...appStore.tasks[0]!,
    outputDirectory: "D:/cover/让子弹飞 - 2026-05-02/still",
  };

  await appStore.deleteTask(taskId);

  assert.deepEqual(clearedTaskIds, [[taskId]]);
  assert.deepEqual(deletedDirectories, ["D:/cover/让子弹飞 - 2026-05-02/still"]);
  assert.equal(appStore.tasks.length, 0);
});

test("清空队列时会调用原生后台清理并清空前端任务列表", async () => {
  const { appStore, runtimeBridge } = await setupStore();
  const clearedTaskIds: string[][] = [];

  runtimeBridge.clearDownloadTasks = async (taskIds: string[]) => {
    clearedTaskIds.push(taskIds);
    return taskIds.length;
  };

  await appStore.createTasks([
    createDraft(),
    createDraft({ detailUrl: "https://movie.douban.com/subject/1292052/" }),
  ]);

  await appStore.clearQueueTasks();

  assert.equal(clearedTaskIds.length, 1);
  assert.equal(clearedTaskIds[0]?.length, 2);
  assert.equal(appStore.tasks.length, 0);
  assert.equal(appStore.queueRunning, false);
});
