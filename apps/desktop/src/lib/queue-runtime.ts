import { runtimeBridge } from "./runtime-bridge";
import type {
  CookieMutation,
  CookieProfile,
  DiscoveredAsset,
  QueueConfig,
  SourceHint,
  SourceSite,
  TaskItem,
  TaskRuntimeFrame,
} from "../types/app";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const timestampFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function timestampNow() {
  return timestampFormatter.format(new Date()).replace(/\//g, "-");
}

function cloneTask(task: TaskItem) {
  return structuredClone(task);
}

function sanitizeFolderSegment(input: string) {
  return input.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}


function titleFromDoubanUrl(detailUrl: string) {
  const match = detailUrl.match(/subject\/(\d+)/);
  return match ? `豆瓣条目 ${match[1]}` : "豆瓣条目";
}

function detectSource(sourceHint: SourceHint, detailUrl: string): SourceSite {
  if (sourceHint === "douban" || detailUrl.includes("movie.douban.com")) return "douban";
  throw new Error(`unsupported source url: ${detailUrl}`);
}

function resolveImagePageUrl(_source: SourceSite, detailUrl: string) {
if (/\/all_photos\/?$/i.test(detailUrl)) {
    return detailUrl.replace(/\?.*$/, "");
  }

  const subjectMatch = detailUrl.match(/(https:\/\/movie\.douban\.com\/subject\/\d+)/i);
  if (!subjectMatch) {
    return detailUrl;
  }

  return `${subjectMatch[1]}/all_photos`;
}

function deriveTitle(task: TaskItem) {
  if (task.title !== "待解析标题") {
    return task.title;
  }

  return titleFromDoubanUrl(task.target.detailUrl);
}

function buildOutputFolderName(title: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${sanitizeFolderSegment(title)} - ${date}`;
}

function buildOutputDirectory(task: TaskItem, folderName: string) {
  return `${task.target.outputRootDir.replace(/[\\/]+$/, "")}/${folderName}`;
}

function createDiscoveredAsset(
  prefix: string,
  index: number,
  source: SourceSite,
  title: string,
  category: "poster" | "still",
  orientation: "vertical" | "horizontal",
  width: number,
  height: number,
  imagePageUrl: string,
): DiscoveredAsset {
  return {
    id: `${prefix}-${index}`,
    source,
    title: `${title} ${category === "poster" ? "Poster" : "Still"} ${index}`,
    pageUrl: imagePageUrl,
    imageUrl: `${imagePageUrl}${imagePageUrl.includes("?") ? "&" : "?"}image=${prefix}-${index}`,
    category,
    orientation,
    width,
    height,
    extension: ".jpg",
  };
}

function buildDiscoverySet(source: SourceSite, title: string, imagePageUrl: string, maxImages: number) {
  const discovered = [
    createDiscoveredAsset("dbposter", 1, source, title, "poster", "vertical", 2000, 3000, imagePageUrl),
    createDiscoveredAsset("dbstill", 1, source, title, "still", "horizontal", 1920, 1080, imagePageUrl),
    createDiscoveredAsset("dbstill", 2, source, title, "still", "horizontal", 1920, 1080, imagePageUrl),
    createDiscoveredAsset("dbposter", 2, source, title, "poster", "vertical", 1500, 2250, imagePageUrl),
  ];
  const limited = discovered.slice(0, maxImages);

  return {
    discovered: limited,
    posterCount: limited.filter((asset) => asset.category === "poster").length,
    stillCount: limited.filter((asset) => asset.category === "still").length,
    verticalCount: limited.filter((asset) => asset.orientation === "vertical").length,
    horizontalCount: limited.filter((asset) => asset.orientation === "horizontal").length,
  };
}

function createFileName(task: TaskItem, asset: DiscoveredAsset, index: number) {
  const size = asset.width && asset.height ? `${asset.width}x${asset.height}` : "unknown";
  const category = asset.category === "poster" ? "poster" : "still";
  const suffix = index > 1 ? ` (${index})` : "";
  return `${sanitizeFolderSegment(task.title)} - ${category} - ${size}${suffix}${asset.extension ?? ".jpg"}`;
}

function pickActiveCookie(cookies: CookieProfile[]) {
  return cookies.find((cookie) => cookie.status === "active");
}

export async function* runTaskLifecycle(
  task: TaskItem,
  cookies: CookieProfile[],
  queueConfig: QueueConfig,
): AsyncGenerator<TaskRuntimeFrame> {
  let nextTask = cloneTask(task);
  const source = detectSource(task.target.sourceHint, task.target.detailUrl);
  const imagePageUrl = resolveImagePageUrl(source, task.target.detailUrl);
  const title = deriveTitle(task);
  const outputFolderName = buildOutputFolderName(title);
  const outputDirectory = buildOutputDirectory(task, outputFolderName);
  const confidence = 93;
  const activeCookie = pickActiveCookie(cookies);

  if (nextTask.lifecycle.phase === "queued" || nextTask.lifecycle.phase === "retrying") {
    nextTask = {
      ...nextTask,
      title,
      lifecycle: {
        ...nextTask.lifecycle,
        phase: "resolving",
        attempts: nextTask.lifecycle.attempts + 1,
        updatedAt: timestampNow(),
        cooldownUntil: undefined,
      },
      summary: "正在解析详情页并定位图片页",
    };
    yield { task: nextTask };
    await wait(220);
    await runtimeBridge.emitLog({
      level: "INFO",
      scope: "resolver",
      message: `开始解析详情页: ${task.target.detailUrl}`,
      taskId: task.id,
    });
    await runtimeBridge.emitLog({
      level: "INFO",
      scope: "resolver",
      message: `已识别站点 豆瓣，图片页: ${imagePageUrl}`,
      taskId: task.id,
    });

    nextTask = {
      ...nextTask,
      title,
      detection: {
        site: source,
        confidence,
        reason: "详情页已自动推导到 all_photos 图片页",
        detailUrl: task.target.detailUrl,
        imagePageUrl,
      },
      outputFolderName,
      outputDirectory,
      lifecycle: {
        ...nextTask.lifecycle,
        phase: "discovering",
        updatedAt: timestampNow(),
      },
      summary: "图片页已定位，正在扫描可下载图片",
    };
    yield { task: nextTask };
    await wait(180);
  }

  if (nextTask.lifecycle.phase === "discovering") {
    const discovery = buildDiscoverySet(source, title, imagePageUrl, task.target.maxImages);
    await runtimeBridge.emitLog({
      level: "INFO",
      scope: "discoverer",
      message: `已发现 ${discovery.discovered.length} 张图片: 海报 ${discovery.posterCount} / 剧照 ${discovery.stillCount}`,
      taskId: task.id,
    });

    nextTask = {
      ...nextTask,
      discovery,
      download: {
        savedCount: 0,
        targetCount: discovery.discovered.length,
        directory: outputDirectory,
        files: [],
      },
      lifecycle: {
        ...nextTask.lifecycle,
        phase: "downloading",
        updatedAt: timestampNow(),
      },
      summary: `已发现 ${discovery.discovered.length} 张图片，开始写入目标目录`,
    };
    yield { task: nextTask };
    await wait(220);
  }
  if (nextTask.lifecycle.phase === "downloading") {
    const shouldFail = source === "douban" && nextTask.title.includes("夜魔") && nextTask.lifecycle.attempts < 2;
    if (shouldFail && activeCookie) {
      const cooldownUntil = new Date(Date.now() + queueConfig.failureCooldownMs).toISOString();
      await runtimeBridge.emitLog({
        level: "WARN",
        scope: "cookie",
        message: `Cookie ${activeCookie.id} 进入冷却，原因: 豆瓣高清图返回受限页`,
        taskId: task.id,
      });
      await runtimeBridge.emitLog({
        level: "ERROR",
        scope: "downloader",
        message: `${nextTask.title} 第 ${nextTask.lifecycle.attempts} 次下载失败: 豆瓣 Cookie 返回受限页，高清图未开放`,
        taskId: task.id,
      });
      nextTask = {
        ...nextTask,
        lifecycle: {
          ...nextTask.lifecycle,
          phase: "failed",
          updatedAt: timestampNow(),
          cooldownUntil,
          lastError: "豆瓣 Cookie 返回受限页，高清图未开放",
        },
        summary:
          nextTask.lifecycle.attempts >= queueConfig.maxAttempts
            ? "已达到最大重试次数，停止继续访问图片页"
            : "下载失败，进入失败冷却队列",
      };
      const cookieMutations: CookieMutation[] = [
        {
          id: activeCookie.id,
          status: "cooling",
          failureDelta: 1,
          coolingUntil: cooldownUntil,
        },
      ];
      yield {
        task: nextTask,
        cookieMutations,
      };
      return;
    }

    const discovery = nextTask.discovery?.discovered ?? [];
    for (let index = (nextTask.download?.savedCount ?? 0); index < discovery.length; index += 1) {
      await wait(180);
      const asset = discovery[index];
      const fileName = createFileName(nextTask, asset, index + 1);
      nextTask = {
        ...nextTask,
        download: {
          savedCount: index + 1,
          targetCount: discovery.length,
          directory: outputDirectory,
          files: [...(nextTask.download?.files ?? []), fileName],
        },
        summary: `已保存 ${index + 1} / ${discovery.length} 张图片`,
      };
      await runtimeBridge.emitLog({
        level: "INFO",
        scope: "downloader",
        message: `下载成功: ${fileName}`,
        taskId: task.id,
      });
      yield { task: nextTask };
    }

    nextTask = {
      ...nextTask,
      lifecycle: {
        ...nextTask.lifecycle,
        phase: "completed",
        updatedAt: timestampNow(),
        cooldownUntil: undefined,
        lastError: undefined,
      },
      summary: "抓图完成，文件已写入自动生成目录",
    };
    yield {
      task: nextTask,
      cookieMutations: activeCookie
        ? [
            {
              id: activeCookie.id,
              successDelta: 1,
              status: "active",
              coolingUntil: null,
            },
          ]
        : undefined,
    };
  }
}
