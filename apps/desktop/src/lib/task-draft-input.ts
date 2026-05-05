// 新增任务表单校验工具：规范化批量链接、数量限制和输出目录。
import type { ImageCountMode } from "../types/app";

interface TaskDraftInputValidation {
  detailUrls: unknown;
  outputRootDir: string;
  imageCountMode: ImageCountMode;
  maxImagesInput: unknown;
}

type ValidationResult =
  | {
      ok: true;
      detailUrls: string[];
      maxImages: number;
    }
  | {
      ok: false;
      message: string;
    };

const detailUrlPattern = /https?:\/\/[^\s，,。；;]+/i;

// 从一行展示文本里提取真正要处理的详情页 URL。
// 支持“片名：URL”和纯 URL 两种形式，避免显示片名影响后续校验与下载。
export function extractDetailUrlFromDisplayLine(value: string) {
  const match = value.match(detailUrlPattern);
  return match?.[0]?.trim().replace(/[)）\]】'"”’]+$/g, "") ?? "";
}

// 统一生成文本框里的展示行：有片名时显示“片名：链接”，没有片名时保留纯链接。
export function formatDetailUrlDisplayLine(detailUrl: string, title?: string | null) {
  const normalizedUrl = detailUrl.trim();
  const normalizedTitle = title?.trim();
  return normalizedTitle ? `${normalizedTitle}：${normalizedUrl}` : normalizedUrl;
}

// 去重和删除时按 URL 本身比较，并忽略末尾斜杠差异。
export function normalizeComparableDetailUrl(value: string) {
  const detailUrl = extractDetailUrlFromDisplayLine(value);
  return detailUrl.replace(/\/$/, "").toLowerCase();
}

// 规范化批量链接输入：把连续粘贴的多个 URL 拆成每行一个。
export function normalizeDetailUrlsInput(value: string) {
  return value
    .replace(/([^\s:：])(https?:\/\/)/g, "$1\n$2")
    .replace(/([^\s:：])\s+(https?:\/\/)/g, "$1\n$2")
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

// 只接受豆瓣电影 subject 详情页，拒绝豆瓣首页、其他豆瓣页面和外站链接。
function isDoubanMovieDetailUrl(url: URL) {
  if (url.protocol !== "https:" || url.hostname !== "movie.douban.com") {
    return false;
  }

  return /^\/subject\/\d+\/?$/i.test(url.pathname);
}

// 将字符串安全解析成 URL 后再校验站点和路径，解析失败会返回 false。
function isSupportedDetailUrl(detailUrl: string) {
  try {
    const url = new URL(detailUrl);
    return isDoubanMovieDetailUrl(url);
  } catch {
    return false;
  }
}

// 新增任务提交前的统一校验入口，返回可创建任务的链接列表和数量限制。
export function validateTaskDraftInput(input: TaskDraftInputValidation): ValidationResult {
  if (typeof input.detailUrls !== "string") {
    return {
      ok: false,
      message: "不能加入队列：详情页链接（批量）必须是文本字符串。",
    };
  }

  const detailUrls = normalizeDetailUrlsInput(input.detailUrls)
    .split(/\r?\n/g)
    .map((item) => extractDetailUrlFromDisplayLine(item.trim()))
    .filter(Boolean);

  if (!detailUrls.length) {
    return {
      ok: false,
      message: "不能加入队列：请填写详情页链接（批量）。",
    };
  }

  if (!input.outputRootDir.trim()) {
    return {
      ok: false,
      message: "不能加入队列：请填写输出目录。",
    };
  }

  const unsupportedDetailUrl = detailUrls.find((detailUrl) => !isSupportedDetailUrl(detailUrl));
  if (unsupportedDetailUrl) {
    return {
      ok: false,
      message: `不能加入队列：详情页链接中存在不支持的链接“${unsupportedDetailUrl}”，只能填写 https://movie.douban.com/subject/xxx 形式的链接。`,
    };
  }

  if (input.imageCountMode === "unlimited") {
    return {
      ok: true,
      detailUrls,
      maxImages: 50,
    };
  }

  if (typeof input.maxImagesInput !== "string") {
    return {
      ok: false,
      message: "不能加入队列：数量限制必须是文本数字。",
    };
  }

  const normalizedMaxImages = input.maxImagesInput.trim();
  if (!/^\d+$/.test(normalizedMaxImages)) {
    return {
      ok: false,
      message: "不能加入队列：数量限制填入文本类型错误，非数值类型。",
    };
  }

  const maxImages = Number(normalizedMaxImages);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 100) {
    return {
      ok: false,
      message: "不能加入队列：数量限制只能填 1-100 的数字。",
    };
  }

  return {
    ok: true,
    detailUrls,
    maxImages,
  };
}
