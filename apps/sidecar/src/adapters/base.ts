// 站点适配器基础工具：封装请求头、HTML 抓取、标题解析和 URL 去重。
import type { DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import { waitFor } from "../utils/wait-for.js";

// 适配器上下文：把运行配置、日志器、Cookie 和请求间隔状态集中传给站点适配器。
export interface AdapterContext {
  config: RuntimeConfig;
  logger: SidecarLogger;
  cookieHeader?: string | null;
  minRequestIntervalMs?: number;
}

// 站点适配器接口：每个站点只需要声明能否处理任务，以及如何发现图片。
export interface SourceAdapter {
  source: "douban";
  canHandle(task: SidecarTask): boolean;
  discover(task: SidecarTask, context: AdapterContext): Promise<DiscoveryResult>;
}

// HTML 请求结果结构，保留最终 URL、Content-Type 和正文，方便判断跳转、风控和页面类型。
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

// 请求头集中构造，确保所有站点请求都带统一 UA、语言和可选 Cookie。
export function buildHeaders(context: AdapterContext, extraHeaders?: HeadersInit) {
  return {
    "user-agent": userAgentPresets[context.config.userAgentProfile] ?? userAgentPresets["desktop-chrome"],
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    cookie: context.cookieHeader ?? "",
    ...extraHeaders,
  };
}

// 计算真正使用的请求间隔，保证不低于适配器指定的最小间隔。
export function resolveRequestIntervalMs(requestIntervalMs: number, minRequestIntervalMs = 0) {
  return Math.max(requestIntervalMs, minRequestIntervalMs);
}

// 根据上下文里的 lastRequestAt 节流请求，避免连续访问同一站点过快。
async function waitForRequestInterval(context: AdapterContext) {
  // 真实 HTML 请求前等待，和图片下载共用同一任务间隔。
  await waitFor(resolveRequestIntervalMs(context.config.requestIntervalMs, context.minRequestIntervalMs));
}

// HTML 请求在这里统一处理间隔、重定向、状态码和响应文本。
// 抓取 HTML 文本的统一入口：负责等待间隔、设置请求头、处理 HTTP 错误和记录时间。
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

// 从 meta、h1、title 里按优先级提取页面标题，作为片名解析兜底。
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

// 把连续空白压缩成单个空格，避免标题或文案里混入换行和多余缩进。
export function normalizeWhitespace(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

// 去掉 HTML 标签，只保留文本内容，用于标题和页面片段解析。
export function stripTags(input: string) {
  return input.replace(/<[^>]+>/g, " ");
}

// 解码常见 HTML 实体，保证片名和日志里显示正常字符。
export function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// URL 去重工具，保留首次出现顺序，避免同一张图片重复下载。
export function dedupeUrls(urls: string[]) {
  return [...new Set(urls)];
}

// 把相对链接转换成绝对链接；解析失败时返回 null，调用方可安全跳过。
export function resolveRelativeUrl(rawUrl: string, baseUrl: string) {
  return new URL(rawUrl, baseUrl).toString();
}
