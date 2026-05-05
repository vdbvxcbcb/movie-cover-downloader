// 豆瓣影片预览解析服务：只访问固定豆瓣移动端接口，用于前端显示“片名：链接”和队列封面缩略图。
import { Buffer } from "node:buffer";
import { buildHeaders, extractTitleFromHtml, fetchText, normalizeWhitespace } from "../adapters/base.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";

interface ResolveTitleOptions {
  config: RuntimeConfig;
}

interface DoubanRexxarMoviePayload {
  id?: string;
  title?: string;
  cover_url?: string;
  pic?: {
    large?: string;
    normal?: string;
  };
}

const silentLogger: SidecarLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function normalizeDoubanSubjectUrl(detailUrl: string) {
  const url = new URL(detailUrl.trim());
  if (url.protocol !== "https:" || url.hostname !== "movie.douban.com" || !/^\/subject\/\d+\/?$/i.test(url.pathname)) {
    throw new Error("unsupported douban subject url");
  }

  return url.toString();
}

function extractSubjectId(detailUrl: string) {
  const subjectId = new URL(detailUrl).pathname.match(/^\/subject\/(\d+)\/?$/i)?.[1];
  if (!subjectId) {
    throw new Error("douban subject id was not found");
  }

  return subjectId;
}

function normalizeResolvedTitle(title: string | undefined) {
  const normalized = normalizeWhitespace((title ?? "").replace(/\s*-\s*电影\s*-\s*豆瓣\s*$/i, ""));
  return normalized && normalized !== "Untitled" && normalized !== "豆瓣" ? normalized : null;
}

async function fetchCoverDataUrl(coverUrl: string | undefined, config: RuntimeConfig, subjectId: string) {
  if (!coverUrl) return undefined;

  try {
    const response = await fetch(coverUrl, {
      headers: buildHeaders(
        { config, logger: silentLogger },
        {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: `https://m.douban.com/movie/subject/${subjectId}/`,
        },
      ),
      redirect: "follow",
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

async function fetchRexxarPreview(subjectId: string, config: RuntimeConfig) {
  const response = await fetch(`https://m.douban.com/rexxar/api/v2/movie/${subjectId}`, {
    headers: buildHeaders(
      { config, logger: silentLogger },
      {
        accept: "application/json, text/plain, */*",
        referer: `https://m.douban.com/movie/subject/${subjectId}/`,
      },
    ),
    redirect: "follow",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as DoubanRexxarMoviePayload;
  const title = normalizeResolvedTitle(payload.title);
  const coverUrl = payload.pic?.normal ?? payload.cover_url ?? payload.pic?.large;
  const coverDataUrl = await fetchCoverDataUrl(coverUrl, config, subjectId);
  return {
    title,
    coverUrl,
    coverDataUrl,
  };
}

function extractMobileHtmlTitle(detailHtml: string) {
  return normalizeResolvedTitle(extractTitleFromHtml(detailHtml));
}

export async function resolveDoubanMovieTitle(detailUrl: string, options: ResolveTitleOptions) {
  const normalizedUrl = normalizeDoubanSubjectUrl(detailUrl);
  const subjectId = extractSubjectId(normalizedUrl);
  const apiPreview = await fetchRexxarPreview(subjectId, options.config);
  if (apiPreview?.title) {
    return {
      detailUrl: normalizedUrl,
      title: apiPreview.title,
      coverUrl: apiPreview.coverUrl,
      coverDataUrl: apiPreview.coverDataUrl,
    };
  }

  const mobilePage = await fetchText(`https://m.douban.com/movie/subject/${subjectId}/`, {
    config: options.config,
    logger: silentLogger,
    minRequestIntervalMs: 3000,
  });
  const htmlTitle = extractMobileHtmlTitle(mobilePage.html);
  if (!htmlTitle) {
    throw new Error("douban title was not found");
  }

  return {
    detailUrl: normalizedUrl,
    title: htmlTitle,
    coverUrl: apiPreview?.coverUrl,
    coverDataUrl: apiPreview?.coverDataUrl,
  };
}
