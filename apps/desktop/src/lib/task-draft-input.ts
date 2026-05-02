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

export function normalizeDetailUrlsInput(value: string) {
  return value
    .replace(/([^\s])(https?:\/\/)/g, "$1\n$2")
    .replace(/\s+(https?:\/\/)/g, "\n$1")
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function isDoubanMovieDetailUrl(url: URL) {
  if (url.protocol !== "https:" || url.hostname !== "movie.douban.com") {
    return false;
  }

  return /^\/subject\/\d+\/?$/i.test(url.pathname);
}

function isImpAwardsMovieDetailUrl(url: URL) {
  if (url.protocol !== "http:" || url.hostname !== "www.impawards.com") {
    return false;
  }

  return /^\/[^/]+\/[^/]+$/i.test(url.pathname);
}

function isSupportedDetailUrl(detailUrl: string) {
  try {
    const url = new URL(detailUrl);
    return isDoubanMovieDetailUrl(url) || isImpAwardsMovieDetailUrl(url);
  } catch {
    return false;
  }
}

export function validateTaskDraftInput(input: TaskDraftInputValidation): ValidationResult {
  if (typeof input.detailUrls !== "string") {
    return {
      ok: false,
      message: "不能加入队列：详情页链接（批量）必须是文本字符串。",
    };
  }

  const detailUrls = normalizeDetailUrlsInput(input.detailUrls)
    .split(/\r?\n/g)
    .map((item) => item.trim())
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
      message: `不能加入队列：详情页链接中存在不支持的链接“${unsupportedDetailUrl}”，只能填写 https://movie.douban.com/subject/xxx 或 http://www.impawards.com/xxx/xxx 形式的链接。`,
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
