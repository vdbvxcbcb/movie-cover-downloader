// 豆瓣适配器：解析详情页、分类页和图片列表，并识别登录/风控/空分类。
import path from "node:path";
import type { FetchedHtmlPage, SourceAdapter } from "./base.js";
import { buildHeaders, dedupeUrls, extractTitleFromHtml, fetchText, normalizeWhitespace } from "./base.js";
import type { AdapterContext } from "./base.js";
import type {
  DiscoveredImage,
  DiscoveryResult,
  DoubanPhotoDiscoveryBatchResult,
  DoubanPhotoDiscoveryCursor,
  SidecarTask,
} from "../shared/contracts.js";
import { buildOutputDir, buildOutputFolderName, formatDirectoryImageAspectRatio } from "../utils/output-folder.js";
import { createResolvedSkeleton } from "../utils/source-detector.js";

const doubanTypeMap = {
  S: { category: "still", doubanAssetType: "still", orientation: "horizontal", label: "Still" },
  R: { category: "poster", doubanAssetType: "poster", orientation: "vertical", label: "Poster" },
  W: { category: "still", doubanAssetType: "wallpaper", orientation: "horizontal", label: "Wallpaper" },
} as const;
const doubanCategoryPageSize = 30;
const maxDoubanCategoryPages = 1000;
const maxPreviewImageBytes = 1_200_000;
const doubanAssetTypeSequence: SidecarTask["doubanAssetType"][] = ["still", "poster", "wallpaper"];

type DoubanPhotoType = keyof typeof doubanTypeMap;
type DoubanPhotoPageKind = "ok" | "empty" | "auth" | "risk" | "unexpected";

interface DoubanPhotoPageClassification {
  kind: DoubanPhotoPageKind;
  reason: string;
}

type DoubanAccessClassification = "ok" | "auth" | "risk";

// 从豆瓣分类页文案里提取图片总数，用来判断是否需要继续抓分页。
function extractDoubanCategoryCount(html: string) {
  const count = html.match(/共(\d+)张/i)?.[1];
  return count ? Number(count) : null;
}

// 豆瓣分类页只暴露部分缩略图，需要根据总数推导分页 start 参数继续抓取。
// 根据分类页总数生成分页 URL 列表；豆瓣每页约 30 张，因此按 start=30 递增。
function resolveDoubanCategoryPageCount(html: string) {
  const count = extractDoubanCategoryCount(html);
  if (!count || count <= doubanCategoryPageSize) {
    return 1;
  }

  return Math.min(Math.ceil(count / doubanCategoryPageSize), maxDoubanCategoryPages);
}

function buildDoubanCategoryPageUrl(categoryUrl: string, pageIndex: number) {
  const nextUrl = new URL(categoryUrl);
  nextUrl.searchParams.set("start", String(pageIndex * doubanCategoryPageSize));
  return nextUrl.toString();
}

// 把豆瓣缩略图域名升级成更清晰的大图域名，尽量保存原始质量更高的图片。
function upgradeDoubanImageUrl(imageUrl: string) {
  return imageUrl.replace(/\/view\/photo\/[a-z_]+\/public\//i, "/view/photo/l/public/");
}

function inferPreviewContentType(imageUrl: string, contentType: string | null) {
  const normalizedContentType = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedContentType?.startsWith("image/")) {
    return normalizedContentType;
  }

  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

async function fetchPreviewDataUrl(imageUrl: string, pageUrl: string, context: AdapterContext) {
  try {
    const response = await fetch(imageUrl, {
      headers: buildHeaders(context, {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: pageUrl,
      }),
      redirect: "follow",
    });
    if (!response.ok) {
      return undefined;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxPreviewImageBytes) {
      return undefined;
    }

    const bytes = await readPreviewBytes(response);
    if (!bytes) {
      return undefined;
    }

    const contentType = inferPreviewContentType(response.url || imageUrl, response.headers.get("content-type"));
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function readPreviewBytes(response: Response) {
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxPreviewImageBytes) {
      return undefined;
    }
    return Buffer.from(bytes);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxPreviewImageBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return total === 0 ? undefined : Buffer.concat(chunks, total);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, run: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function attachPreviewDataUrls(images: DiscoveredImage[], pageUrl: string, context: AdapterContext) {
  if (!context.includePreviewDataUrl || images.length === 0) {
    return images;
  }

  return mapWithConcurrency(
    images,
    Math.max(1, context.config.concurrency),
    async (image) => {
      const previewDataUrl = await fetchPreviewDataUrl(image.previewUrl ?? image.imageUrl, pageUrl, context);
      return previewDataUrl ? { ...image, previewDataUrl } : image;
    },
  );
}

// 解析图片时优先升级到原图域名，并用 Set 去重，避免缩略图重复下载。
// 从豆瓣图片页 HTML 解析图片链接，升级大图 URL、补齐分类/方向信息并去重。
function extractDoubanImages(
  html: string,
  pageUrl: string,
  title: string,
  type: DoubanPhotoType,
  offset: number,
): DiscoveredImage[] {
  const matches = html.match(/https?:\/\/img\d+\.doubanio\.com\/view\/photo\/[a-z_]+\/public\/[^"')\s]+/gi) ?? [];
  return dedupeUrls(matches).map((imageUrl, index) => {
    const config = doubanTypeMap[type];
    return {
      id: `douban-${type}-${offset + index + 1}`,
      source: "douban",
      title: `${title} ${config.label} ${offset + index + 1}`,
      imageUrl: upgradeDoubanImageUrl(imageUrl),
      previewUrl: imageUrl,
      pageUrl,
      category: config.category,
      doubanAssetType: config.doubanAssetType,
      orientation: config.orientation,
    };
  });
}

// 从豆瓣详情页优先提取主标题；找不到时再回退到通用 HTML 标题提取。
function extractDoubanPrimaryTitle(detailHtml: string) {
  const reviewed = detailHtml.match(/property=["']v:itemreviewed["'][^>]*>([^<]+)</i)?.[1];
  if (reviewed) {
    return normalizeWhitespace(reviewed);
  }

  return normalizeWhitespace(extractTitleFromHtml(detailHtml).replace(/\s*\(豆瓣\)\s*$/i, ""));
}

// 创建分类页判断结果，统一记录状态和原因，方便失败时给前端更准确的提示。
function createPageClassification(kind: DoubanPhotoPageKind, reason: string): DoubanPhotoPageClassification {
  return { kind, reason };
}

// 判断豆瓣页面是否进入登录页或风控页，避免把异常页面误当成空图片页。
function classifyDoubanAccessPage(page: FetchedHtmlPage): DoubanAccessClassification {
  const finalUrl = page.finalUrl.toLowerCase();
  const html = page.html;

  if (finalUrl.includes("sec.douban.com")) {
    return "risk";
  }

  if (/验证码|异常请求|访问受限|稍后重试|验证你不是机器人/i.test(html)) {
    return "risk";
  }

  if (/登录后查看更多|登录后查看|豆瓣登录|扫码登录|请先登录/i.test(html)) {
    return "auth";
  }

  return "ok";
}

// 分类页状态会区分空分类、登录失效、风控和结构异常，前端据此展示不同提示。
// 综合 Content-Type、访问状态和页面结构判断图片页是否可解析、为空、需登录或被风控。
export function classifyDoubanPhotoPage(page: FetchedHtmlPage): DoubanPhotoPageClassification {
  const contentType = page.contentType.toLowerCase();
  const html = page.html;
  const accessClassification = classifyDoubanAccessPage(page);

  if (!contentType.includes("text/html")) {
    return createPageClassification("unexpected", "douban page did not return html");
  }

  if (accessClassification === "risk") {
    return createPageClassification("risk", "douban risk page detected");
  }

  if (accessClassification === "auth") {
    return createPageClassification("auth", "douban login required");
  }

  const isPhotoPage = /photos\?type=|<title[^>]*>\s*图片|class=["']article["']|共\d+张/i.test(html);
  const hasImages = extractDoubanImages(html, page.finalUrl, "title", "W", 0).length > 0;
  if (hasImages) {
    return createPageClassification("ok", "douban photo page with images");
  }

  if (isPhotoPage) {
    return createPageClassification("empty", "douban photo category is empty");
  }

  return createPageClassification("unexpected", "douban page structure mismatch");
}

// 把分类页异常转换成调度层能识别的错误消息，前端会按这些消息分类展示原因。
function throwForClassification(classification: DoubanPhotoPageClassification): never {
  throw new Error(classification.reason);
}

// 为“当前影片该分类没有图片”创建带片名的结构化错误，前端可显示成友好文案。
function createEmptyCategoryError(title: string) {
  return new Error(`douban photo category is empty|title=${encodeURIComponent(title)}`);
}

// 豆瓣适配器负责从详情页解析片名，并从剧照/海报/壁纸分类页发现图片。
export class DoubanAdapter implements SourceAdapter {
  source = "douban" as const;

  // 判断任务是否属于豆瓣；当前站点已简化为只支持 movie.douban.com。
  canHandle(task: SidecarTask) {
    return task.detailUrl.includes("movie.douban.com/subject/");
  }

  async discoverBatch(
    task: SidecarTask,
    context: AdapterContext,
    cursor: DoubanPhotoDiscoveryCursor | null,
    batchSize: number,
  ): Promise<DoubanPhotoDiscoveryBatchResult> {
    const protectedContext: AdapterContext = { ...context, minRequestIntervalMs: 3000 };
    const safeBatchSize = Math.max(1, batchSize);
    const detailSkeleton = createResolvedSkeleton(task);
    let title = cursor?.normalizedTitle;

    if (!title) {
      context.logger.info(`fetching douban detail page: ${detailSkeleton.detailUrl}`, task.id);
      const detailPage = await fetchText(detailSkeleton.detailUrl, protectedContext);
      const detailPageAccess = classifyDoubanAccessPage(detailPage);
      if (detailPageAccess === "risk") throw new Error("douban risk page detected");
      if (detailPageAccess === "auth") throw new Error("douban login required");
      title = extractDoubanPrimaryTitle(detailPage.html);
      context.logger.info(`ç‰‡åå·²è§£æž: ${title}`, task.id);
    }

    const images: DiscoveredImage[] = [];
    let assetIndex = Math.max(0, cursor?.assetIndex ?? 0);
    let pageIndex = Math.max(0, cursor?.pageIndex ?? 0);
    let withinPageOffset = Math.max(0, cursor?.withinPageOffset ?? 0);
    let lastImagePageUrl = detailSkeleton.imagePageUrl;

    while (assetIndex < doubanAssetTypeSequence.length && images.length < safeBatchSize) {
      const doubanAssetType = doubanAssetTypeSequence[assetIndex]!;
      const resolved = createResolvedSkeleton({ ...task, doubanAssetType });
      lastImagePageUrl = resolved.imagePageUrl;
      context.logger.info(`fetching douban image page: ${resolved.imagePageUrl}`, task.id);
      const firstPhotoPage = await fetchText(resolved.imagePageUrl, protectedContext);
      const pageType = new URL(resolved.imagePageUrl).searchParams.get("type") as DoubanPhotoType | null;
      if (!pageType || !(pageType in doubanTypeMap)) {
        throw new Error(`unsupported douban photo type page: ${resolved.imagePageUrl}`);
      }

      const firstPageClassification = classifyDoubanPhotoPage(firstPhotoPage);
      if (firstPageClassification.kind === "empty") {
        assetIndex += 1;
        pageIndex = 0;
        withinPageOffset = 0;
        continue;
      }
      if (firstPageClassification.kind !== "ok") {
        throwForClassification(firstPageClassification);
      }

      const pageCount = resolveDoubanCategoryPageCount(firstPhotoPage.html);
      while (pageIndex < pageCount && images.length < safeBatchSize) {
        const pageUrl =
          pageIndex === 0 && pageCount === 1
            ? resolved.imagePageUrl
            : buildDoubanCategoryPageUrl(resolved.imagePageUrl, pageIndex);
        if (pageIndex > 0) {
          context.logger.info(`fetching douban category page: ${pageUrl}`, task.id);
        }

        const pageHtml = pageIndex === 0 ? firstPhotoPage : await fetchText(pageUrl, protectedContext);
        const pageClassification = classifyDoubanPhotoPage(pageHtml);
        if (pageClassification.kind === "risk" || pageClassification.kind === "auth") {
          throwForClassification(pageClassification);
        }
        if (pageClassification.kind === "unexpected") {
          throwForClassification(pageClassification);
        }
        if (pageClassification.kind === "empty") {
          pageIndex += 1;
          withinPageOffset = 0;
          continue;
        }

        const pageImages = extractDoubanImages(
          pageHtml.html,
          pageUrl,
          title,
          pageType,
          pageIndex * doubanCategoryPageSize,
        );
        const remaining = safeBatchSize - images.length;
        const pickedWithoutPreview = pageImages.slice(withinPageOffset, withinPageOffset + remaining);
        const picked = await attachPreviewDataUrls(pickedWithoutPreview, pageUrl, protectedContext);
        images.push(...picked);
        withinPageOffset += pickedWithoutPreview.length;

        if (withinPageOffset < pageImages.length && images.length >= safeBatchSize) {
          break;
        }

        pageIndex += 1;
        withinPageOffset = 0;
      }

      if (images.length >= safeBatchSize) break;
      assetIndex += 1;
      pageIndex = 0;
      withinPageOffset = 0;
    }

    const done = assetIndex >= doubanAssetTypeSequence.length;
    const outputFolderName = cursor?.outputFolderName || buildOutputFolderName(title);
    return {
      source: "douban",
      detailUrl: detailSkeleton.detailUrl,
      imagePageUrl: lastImagePageUrl,
      normalizedTitle: title,
      outputFolderName,
      outputDir: path.join(
        buildOutputDir(task.outputRootDir, outputFolderName),
        "selected",
        `selected-${formatDirectoryImageAspectRatio(task.imageAspectRatio)}`,
      ),
      images,
      nextCursor: done
        ? null
        : {
            assetIndex,
            pageIndex,
            withinPageOffset,
            normalizedTitle: title,
            outputFolderName,
          },
      done,
    };
  }

  // 执行完整发现流程：抓详情页、解析标题、抓分类分页、限制数量并生成输出目录。
  async discover(task: SidecarTask, context: AdapterContext): Promise<DiscoveryResult> {
    const resolved = createResolvedSkeleton(task);
    if (resolved.source !== "douban") {
      throw new Error(`douban adapter cannot handle source: ${resolved.source}`);
    }

    if (!context.cookieHeader) {
      context.logger.warn("douban task is running without cookie header; high-resolution images may be limited", task.id);
    }

    const protectedContext: AdapterContext = {
      ...context,
      minRequestIntervalMs: 3000,
    };
    context.logger.info("douban protection mode enabled: minimum request interval is 3000ms", task.id);

    context.logger.info(`fetching douban detail page: ${resolved.detailUrl}`, task.id);
    const detailPage = await fetchText(resolved.detailUrl, protectedContext);
    const detailPageAccess = classifyDoubanAccessPage(detailPage);
    if (detailPageAccess === "risk") {
      throw new Error("douban risk page detected");
    }
    if (detailPageAccess === "auth") {
      throw new Error("douban login required");
    }

    context.logger.info(`fetching douban image page: ${resolved.imagePageUrl}`, task.id);
    const photoPage = await fetchText(resolved.imagePageUrl, protectedContext);

    const title = extractDoubanPrimaryTitle(detailPage.html);
    context.logger.info(`片名已解析: ${title}`, task.id);
    const pageType = new URL(resolved.imagePageUrl).searchParams.get("type") as DoubanPhotoType | null;
    if (!pageType || !(pageType in doubanTypeMap)) {
      throw new Error(`unsupported douban photo type page: ${resolved.imagePageUrl}`);
    }

    const firstPageClassification = classifyDoubanPhotoPage(photoPage);
    if (firstPageClassification.kind === "empty") {
      throw createEmptyCategoryError(title);
    }
    if (firstPageClassification.kind !== "ok") {
      throwForClassification(firstPageClassification);
    }

    const images: DiscoveredImage[] = [];
    const pageCount = resolveDoubanCategoryPageCount(photoPage.html);

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      if (task.imageCountMode === "limited" && images.length >= task.maxImages) {
        break;
      }

      const pageUrl =
        pageIndex === 0 && pageCount === 1
          ? resolved.imagePageUrl
          : buildDoubanCategoryPageUrl(resolved.imagePageUrl, pageIndex);
      if (pageIndex > 0) {
        context.logger.info(`fetching douban category page: ${pageUrl}`, task.id);
      }

      const pageHtml = pageIndex === 0 ? photoPage : await fetchText(pageUrl, protectedContext);
      const pageClassification = classifyDoubanPhotoPage(pageHtml);
      if (pageClassification.kind === "risk" || pageClassification.kind === "auth") {
        throwForClassification(pageClassification);
      }
      if (pageClassification.kind === "empty") {
        continue;
      }
      if (pageClassification.kind === "unexpected") {
        throwForClassification(pageClassification);
      }

      const pageImages = extractDoubanImages(pageHtml.html, pageUrl, title, pageType, images.length);
      const nextImagesWithoutPreview =
        task.imageCountMode === "limited"
          ? pageImages.slice(0, Math.max(task.maxImages - images.length, 0))
          : pageImages;
      const nextImages = await attachPreviewDataUrls(nextImagesWithoutPreview, pageUrl, protectedContext);

      if (nextImages.length > 0) {
        images.push(...nextImages);
        context.onImagesDiscovered?.(nextImages, {
          taskId: task.id,
          doubanAssetType: task.doubanAssetType,
          pageUrl,
          normalizedTitle: title,
        });
      }

      if (task.imageCountMode === "limited") {
        const remaining = task.maxImages - images.length;
        if (remaining <= 0) {
          break;
        }
        continue;
      }
    }

    const finalImages = task.imageCountMode === "unlimited" ? images : images.slice(0, task.maxImages);
    if (finalImages.length === 0) {
      throw createEmptyCategoryError(title);
    }

    const outputFolderName = buildOutputFolderName(title);
    const imageAspectRatioDir = `${task.doubanAssetType}-${formatDirectoryImageAspectRatio(task.imageAspectRatio)}`;
    return {
      source: "douban",
      detailUrl: resolved.detailUrl,
      imagePageUrl: resolved.imagePageUrl,
      normalizedTitle: title,
      outputFolderName,
      outputDir: path.join(buildOutputDir(task.outputRootDir, outputFolderName), task.doubanAssetType, imageAspectRatioDir),
      images: finalImages,
    };
  }
}
