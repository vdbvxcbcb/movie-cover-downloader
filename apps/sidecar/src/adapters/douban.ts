// 豆瓣适配器：解析详情页、分类页和图片列表，并识别登录/风控/空分类。
import path from "node:path";
import type { FetchedHtmlPage, SourceAdapter } from "./base.js";
import { dedupeUrls, extractTitleFromHtml, fetchText, normalizeWhitespace } from "./base.js";
import type { AdapterContext } from "./base.js";
import type { DiscoveredImage, DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import { buildOutputDir, buildOutputFolderName, formatDirectoryImageAspectRatio } from "../utils/output-folder.js";
import { createResolvedSkeleton } from "../utils/source-detector.js";

const doubanTypeMap = {
  S: { category: "still", orientation: "horizontal", label: "Still" },
  R: { category: "poster", orientation: "vertical", label: "Poster" },
  W: { category: "still", orientation: "horizontal", label: "Wallpaper" },
} as const;

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
function buildDoubanCategoryPageUrls(categoryUrl: string, html: string) {
  const count = extractDoubanCategoryCount(html);
  if (!count || count <= 30) {
    return [categoryUrl];
  }

  const totalPages = Math.ceil(count / 30);
  return Array.from({ length: totalPages }, (_, index) => {
    const nextUrl = new URL(categoryUrl);
    nextUrl.searchParams.set("start", String(index * 30));
    return nextUrl.toString();
  });
}

// 把豆瓣缩略图域名升级成更清晰的大图域名，尽量保存原始质量更高的图片。
function upgradeDoubanImageUrl(imageUrl: string) {
  return imageUrl.replace(/\/view\/photo\/[a-z_]+\/public\//i, "/view/photo/l/public/");
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
      pageUrl,
      category: config.category,
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
    const pageUrls = buildDoubanCategoryPageUrls(resolved.imagePageUrl, photoPage.html);

    for (const [pageIndex, pageUrl] of pageUrls.entries()) {
      if (task.imageCountMode === "limited" && images.length >= task.maxImages) {
        break;
      }

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
      if (task.imageCountMode === "limited") {
        const remaining = task.maxImages - images.length;
        images.push(...pageImages.slice(0, Math.max(remaining, 0)));
        continue;
      }

      images.push(...pageImages);
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
