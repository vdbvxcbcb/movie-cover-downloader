// 豆瓣适配器测试：覆盖页面分类、分页解析、Cookie 和空分类错误。
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import { buildOutputFolderName, sanitizeNameSegment } from "../utils/output-folder.js";
import { fetchText, resolveRequestIntervalMs } from "./base.js";
import { classifyDoubanPhotoPage, DoubanAdapter } from "./douban.js";

// 创建测试用空日志器，避免单元测试向 stdout 输出噪声。
function createLogger(): SidecarLogger {
  return {
    // 测试中忽略 INFO 日志，避免输出影响断言阅读。
    info() {},
    // 测试中忽略 WARN 日志，适配器行为由返回值和错误断言验证。
    warn() {},
    // 测试中忽略 ERROR 日志，避免 mock 场景污染测试输出。
    error() {},
  };
}

// 创建默认豆瓣任务，并允许每个测试覆盖部分字段。
function createTask(overrides: Partial<SidecarTask> = {}): SidecarTask {
  return {
    id: "douban-task",
    detailUrl: "https://movie.douban.com/subject/34780991/",
    outputRootDir: "covers",
    sourceHint: "douban",
    doubanAssetType: "wallpaper",
    imageCountMode: "limited",
    maxImages: 10,
    outputImageFormat: "jpg",
    imageAspectRatio: "original",
    requestIntervalMs: 100,
    phase: "queued",
    attempts: 0,
    ...overrides,
  };
}

// 创建适配器测试上下文，包含运行配置、日志器和请求间隔状态。
function createContext() {
  return {
    config: {
      concurrency: 1,
      batchSize: 1,
      requestIntervalMs: 100,
      requestTimeoutMs: 15_000,
      cookieCooldownMs: 1_000,
      outputDir: "covers",
      userAgentProfile: "desktop-chrome",
      doubanCookie: undefined,
    },
    logger: createLogger(),
    cookieHeader: "dbcl2=1",
  };
}

test("输出目录片名会拒绝路径特殊片段和 Windows 保留名", () => {
  assert.equal(buildOutputFolderName("示例电影"), "示例电影");
  assert.equal(buildOutputFolderName(".."), "Untitled");
  assert.equal(buildOutputFolderName("."), "Untitled");
  assert.equal(buildOutputFolderName("CON"), "Untitled");
  assert.equal(buildOutputFolderName("海报."), "海报");
  assert.equal(sanitizeNameSegment("///"), "Untitled");
});

test("selected photo batch discovery stops before fetching the next page", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask({ doubanAssetType: "still" });
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const detailHtml = `<html><span property="v:itemreviewed">Batch Movie</span></html>`;
  const firstPageHtml = `
    <html>
      <title>å›¾ç‰‡</title>
      <div class="article"></div>
      <span>å…±60å¼ </span>
      <img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg">
      <img src="https://img1.doubanio.com/view/photo/m/public/p2.jpg">
    </html>
  `;
  const calls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.includes("/subject/34780991/photos?type=S")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=S",
        html: firstPageHtml,
      });
    }

    return createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: detailHtml,
    });
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const result = await adapter.discoverBatch(task, context, null, 1);
    assert.equal(result.images.length, 1);
    assert.equal(result.done, false);
    assert.equal(result.nextCursor?.assetIndex, 0);
    assert.equal(result.nextCursor?.pageIndex, 0);
    assert.equal(result.nextCursor?.withinPageOffset, 1);
    assert.equal(calls.some((url) => url.includes("start=30")), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("selected photo batch discovery resumes later pages without refetching first page", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask({ doubanAssetType: "still" });
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const detailHtml = `<html><span property="v:itemreviewed">Batch Movie</span></html>`;
  const firstPageHtml = `
    <html>
      <title>图片</title>
      <div class="article"></div>
      <span>共60张</span>
      <img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg">
      <img src="https://img1.doubanio.com/view/photo/m/public/p2.jpg">
    </html>
  `;
  const secondPageHtml = `
    <html>
      <title>图片</title>
      <div class="article"></div>
      <img src="https://img1.doubanio.com/view/photo/m/public/p31.jpg">
    </html>
  `;
  const calls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.includes("start=30")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=S&start=30",
        html: secondPageHtml,
      });
    }
    if (requestUrl.includes("/subject/34780991/photos?type=S")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=S",
        html: firstPageHtml,
      });
    }

    return createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: detailHtml,
    });
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const firstResult = await adapter.discoverBatch(task, context, null, 2);
    assert.equal(firstResult.nextCursor?.pageIndex, 1);
    assert.equal(firstResult.nextCursor?.pageCount, 2);

    calls.length = 0;
    const secondResult = await adapter.discoverBatch(task, context, firstResult.nextCursor, 1);
    assert.equal(secondResult.images.length, 1);
    assert.equal(secondResult.images[0]?.id, "douban-S-31");
    assert.equal(calls.some((url) => url.includes("/photos?type=S") && !url.includes("start=30")), false);
    assert.equal(calls.some((url) => url.includes("start=30")), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("selected photo batch discovery starts from requested asset type", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask({ doubanAssetType: "poster" });
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const calls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.includes("/photos?type=R")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=R",
        html: '<html><title>图片</title><div class="article"></div><img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg"></html>',
      });
    }

    return createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: '<html><span property="v:itemreviewed">Poster Movie</span></html>',
    });
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const result = await adapter.discoverBatch(task, context, null, 1);
    assert.equal(result.images[0]?.doubanAssetType, "poster");
    assert.equal(calls.some((url) => url.includes("/photos?type=S")), false);
    assert.equal(calls.some((url) => url.includes("/photos?type=R")), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

// 构造 fetch mock 返回值，模拟豆瓣 HTML、最终 URL 和 Content-Type。
function createFetchResponse(
  overrides: Partial<{
    finalUrl: string;
    status: number;
    contentType: string;
    html: string;
  }> = {},
): Response {
  const finalUrl = overrides.finalUrl ?? "https://movie.douban.com/subject/34780991/";
  const status = overrides.status ?? 200;
  const contentType = overrides.contentType ?? "text/html; charset=utf-8";
  const html = overrides.html ?? "<html></html>";

  return {
    url: finalUrl,
    status,
    headers: {
      // 只模拟测试需要的 Content-Type 读取，其他响应头统一返回 null。
      get(name: string) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    text: async () => html,
  } as unknown as Response;
}

test("豆瓣保护模式会把请求间隔提升到至少 3 秒", () => {
  assert.equal(resolveRequestIntervalMs(1000, 3000), 3000);
  assert.equal(resolveRequestIntervalMs(3200, 3000), 3200);
});

test("fetchText 在非 2xx 时仍返回结构化页面结果", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      status: 403,
      contentType: "text/html; charset=utf-8",
      html: "<html><body>blocked</body></html>",
    })) as unknown as typeof fetch;

  try {
    const page = await fetchText("https://movie.douban.com/subject/34780991/", createContext());
    assert.equal(page.finalUrl, "https://movie.douban.com/subject/34780991/");
    assert.equal(page.status, 403);
    assert.equal(page.contentType, "text/html; charset=utf-8");
    assert.equal(page.html, "<html><body>blocked</body></html>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sec.douban.com 页面会被识别为 risk", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://sec.douban.com/a",
    status: 200,
    contentType: "text/html",
    html: "<html><title>异常请求</title></html>",
  });

  assert.equal(page.kind, "risk");
});

test("包含验证码提示的页面会被识别为 risk", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    status: 200,
    contentType: "text/html",
    html: "<html><body>请输入验证码</body></html>",
  });

  assert.equal(page.kind, "risk");
});

test("包含登录提示的页面会被识别为 auth", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    status: 200,
    contentType: "text/html",
    html: "<html><body>登录后查看更多海报图片</body></html>",
  });

  assert.equal(page.kind, "auth");
});

test("合法图片页但没有图片时会被识别为 empty", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    status: 200,
    contentType: "text/html",
    html: '<html><title>图片</title><div class="article"></div><span>共0张</span></html>',
  });

  assert.equal(page.kind, "empty");
});

test("discover 在空分类时会把标题编码进错误消息", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask({ doubanAssetType: "wallpaper" });
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const responses = [
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: '<html><span property="v:itemreviewed">示例电影</span></html>',
    }),
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
      html: '<html><title>图片</title><div class="article"></div><span>共0张</span></html>',
    }),
  ];
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    const response = responses[fetchCalls];
    fetchCalls += 1;
    return response;
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    await assert.rejects(
      () => adapter.discover(task, context),
      /douban photo category is empty\|title=%E7%A4%BA%E4%BE%8B%E7%94%B5%E5%BD%B1/,
    );
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("合法图片页且有 doubanio 图片时会被识别为 ok", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    status: 200,
    contentType: "text/html",
    html: '<html><img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg"></html>',
  });

  assert.equal(page.kind, "ok");
});

test("非 html 响应会被识别为 unexpected", () => {
  const page = classifyDoubanPhotoPage({
    finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    status: 200,
    contentType: "application/json",
    html: "{}",
  });

  assert.equal(page.kind, "unexpected");
});

test("discover 在详情页命中 auth 时会立即止损，并按 3000ms 最小间隔执行", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask();
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let fetchCalls = 0;
  const timeoutCalls: number[] = [];

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return createFetchResponse({
      finalUrl: "https://movie.douban.com/accounts/login",
      status: 200,
      contentType: "text/html; charset=utf-8",
      html: "<html><body>请先登录</body></html>",
    });
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler, ms?: number) => {
    timeoutCalls.push(Number(ms ?? 0));
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    await assert.rejects(() => adapter.discover(task, context), /douban login required/);
    assert.equal(fetchCalls, 1);
    assert.equal(timeoutCalls.filter((ms) => ms === 3000).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("discover 在图片页命中 risk 时会立即止损，不继续后续请求", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask();
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const responses = [
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: '<html><span property="v:itemreviewed">示例电影</span></html>',
    }),
    createFetchResponse({
      finalUrl: "https://sec.douban.com/a",
      html: "<html><body>异常请求</body></html>",
    }),
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W&start=30",
      html: '<html><img src="https://img1.doubanio.com/view/photo/m/public/p2.jpg"></html>',
    }),
  ];
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    const response = responses[fetchCalls];
    fetchCalls += 1;
    return response;
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    await assert.rejects(() => adapter.discover(task, context), /douban risk page detected/);
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("discover 成功时会按豆瓣抓图类型追加输出子目录", async () => {
  const adapter = new DoubanAdapter();
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const detailHtml = '<html><span property="v:itemreviewed">示例电影</span></html>';
  const photoHtml = '<html><img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg"></html>';
  const cases = [
    { assetType: "still", imageAspectRatio: "original", expectedDir: path.join("still", "still-original"), pageType: "S" },
    { assetType: "still", imageAspectRatio: "9:16", expectedDir: path.join("still", "still-9x16"), pageType: "S" },
    { assetType: "still", imageAspectRatio: "3:4", expectedDir: path.join("still", "still-3x4"), pageType: "S" },
    { assetType: "poster", imageAspectRatio: "original", expectedDir: path.join("poster", "poster-original"), pageType: "R" },
    { assetType: "wallpaper", imageAspectRatio: "original", expectedDir: path.join("wallpaper", "wallpaper-original"), pageType: "W" },
  ] as const;

  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    for (const testCase of cases) {
      const responses = [
        createFetchResponse({
          finalUrl: "https://movie.douban.com/subject/34780991/",
          html: detailHtml,
        }),
        createFetchResponse({
          finalUrl: `https://movie.douban.com/subject/34780991/photos?type=${testCase.pageType}`,
          html: photoHtml,
        }),
      ];
      let fetchCalls = 0;

      globalThis.fetch = (async () => {
        const response = responses[fetchCalls];
        fetchCalls += 1;
        return response;
      }) as unknown as typeof fetch;

      const result = await adapter.discover(
        createTask({
          outputRootDir: "D:/cover",
          doubanAssetType: testCase.assetType,
          imageAspectRatio: testCase.imageAspectRatio,
        }),
        context,
      );

      assert.equal(
        result.outputDir,
        path.join("D:/cover", result.outputFolderName, testCase.expectedDir),
      );
      assert.equal(result.outputFolderName, "示例电影");
      assert.equal(fetchCalls, 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("选图发现会保留大图下载地址并附带可预览 data URL", async () => {
  const adapter = new DoubanAdapter();
  const context = { ...createContext(), includePreviewDataUrl: true };
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const imageBytes = new Uint8Array([1, 2, 3]);
  const photoHtml = '<html><img src="https://img1.doubanio.com/view/photo/m/public/p1.webp"></html>';
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/subject/34780991/")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/",
        html: '<html><span property="v:itemreviewed">示例电影</span></html>',
      });
    }
    if (url.includes("/photos?type=W")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
        html: photoHtml,
      });
    }

    return {
      ok: true,
      url,
      headers: {
        get(name: string) {
          return name.toLowerCase() === "content-type" ? "image/webp" : null;
        },
      },
      arrayBuffer: async () => imageBytes.buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const result = await adapter.discover(createTask({ doubanAssetType: "wallpaper" }), context);
    assert.equal(result.images[0]?.imageUrl, "https://img1.doubanio.com/view/photo/l/public/p1.webp");
    assert.equal(result.images[0]?.previewUrl, "https://img1.doubanio.com/view/photo/m/public/p1.webp");
    assert.equal(result.images[0]?.previewDataUrl, "data:image/webp;base64,AQID");
    assert.deepEqual(requests, [
      "https://movie.douban.com/subject/34780991/",
      "https://movie.douban.com/subject/34780991/photos?type=W",
      "https://img1.doubanio.com/view/photo/m/public/p1.webp",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("预览图片 Content-Length 超限时不会读取图片 body", async () => {
  const adapter = new DoubanAdapter();
  const context = { ...createContext(), includePreviewDataUrl: true };
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const photoHtml = '<html><img src="https://img1.doubanio.com/view/photo/m/public/p1.webp"></html>';
  let bodyRead = false;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/subject/34780991/")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/",
        html: '<html><span property="v:itemreviewed">示例电影</span></html>',
      });
    }
    if (url.includes("/photos?type=W")) {
      return createFetchResponse({
        finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
        html: photoHtml,
      });
    }

    return {
      ok: true,
      url,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "content-type") return "image/webp";
          if (name.toLowerCase() === "content-length") return "1200001";
          return null;
        },
      },
      arrayBuffer: async () => {
        bodyRead = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const result = await adapter.discover(createTask({ doubanAssetType: "wallpaper" }), context);
    assert.equal(result.images[0]?.previewDataUrl, undefined);
    assert.equal(bodyRead, false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("数量受限时达到目标张数后会停止继续抓取后续分页", async () => {
  const adapter = new DoubanAdapter();
  const task = createTask({
    doubanAssetType: "wallpaper",
    imageCountMode: "limited",
    maxImages: 2,
  });
  const context = createContext();
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const detailHtml = '<html><span property="v:itemreviewed">示例电影</span></html>';
  const firstPageHtml = `
    <html>
      <title>图片</title>
      <div class="article"></div>
      <span>共90张</span>
      <img src="https://img1.doubanio.com/view/photo/m/public/p1.jpg">
    </html>
  `;
  const secondPageHtml = `
    <html>
      <title>图片</title>
      <div class="article"></div>
      <img src="https://img1.doubanio.com/view/photo/m/public/p2.jpg">
    </html>
  `;
  const thirdPageHtml = `
    <html>
      <title>图片</title>
      <div class="article"></div>
      <img src="https://img1.doubanio.com/view/photo/m/public/p3.jpg">
    </html>
  `;
  const responses = [
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/",
      html: detailHtml,
    }),
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
      html: firstPageHtml,
    }),
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W&start=30",
      html: secondPageHtml,
    }),
    createFetchResponse({
      finalUrl: "https://movie.douban.com/subject/34780991/photos?type=W&start=60",
      html: thirdPageHtml,
    }),
  ];
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    const response = responses[fetchCalls];
    fetchCalls += 1;
    return response;
  }) as unknown as typeof fetch;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === "function") {
      callback();
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const result = await adapter.discover(task, context);
    assert.equal(result.images.length, 2);
    assert.equal(fetchCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
