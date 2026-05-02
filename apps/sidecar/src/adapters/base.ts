import type { DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import { waitFor } from "../utils/wait-for.js";

export interface AdapterContext {
  config: RuntimeConfig;
  logger: SidecarLogger;
  cookieHeader?: string | null;
  minRequestIntervalMs?: number;
}

export interface SourceAdapter {
  source: "douban" | "impawards";
  canHandle(task: SidecarTask): boolean;
  discover(task: SidecarTask, context: AdapterContext): Promise<DiscoveryResult>;
}

export interface FetchedHtmlPage {
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
}

const userAgentPresets: Record<string, string> = {
  "desktop-chrome":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "desktop-edge":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
};

export function buildHeaders(context: AdapterContext, extraHeaders?: HeadersInit) {
  return {
    "user-agent": userAgentPresets[context.config.userAgentProfile] ?? userAgentPresets["desktop-chrome"],
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    cookie: context.cookieHeader ?? "",
    ...extraHeaders,
  };
}

export function resolveRequestIntervalMs(requestIntervalMs: number, minRequestIntervalMs = 0) {
  return Math.max(requestIntervalMs, minRequestIntervalMs);
}

async function waitForRequestInterval(context: AdapterContext) {
  // 真实 HTML 请求前等待，和图片下载共用同一任务间隔。
  await waitFor(resolveRequestIntervalMs(context.config.requestIntervalMs, context.minRequestIntervalMs));
}

export async function fetchText(url: string, context: AdapterContext): Promise<FetchedHtmlPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.config.requestTimeoutMs);

  try {
    await waitForRequestInterval(context);

    const response = await fetch(url, {
      headers: buildHeaders(context),
      signal: controller.signal,
      redirect: "follow",
    });

    const html = await response.text();
    return {
      finalUrl: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      html,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function extractTitleFromHtml(html: string) {
  const metaTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
  if (metaTitle) {
    return decodeHtml(metaTitle).trim();
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) {
    return decodeHtml(stripTags(h1)).trim();
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) {
    return decodeHtml(stripTags(title)).replace(/\s*[-|_].*$/, "").trim();
  }

  return "Untitled";
}

export function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

export function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, " ");
}

export function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function dedupeUrls(urls: string[]) {
  return [...new Set(urls)];
}

export function resolveRelativeUrl(rawUrl: string, baseUrl: string) {
  return new URL(rawUrl, baseUrl).toString();
}
