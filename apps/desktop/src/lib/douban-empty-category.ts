// 豆瓣空分类错误解析工具：把 sidecar 的结构化错误转换成用户可读提示。
import type { DoubanAssetType, TaskItem } from "../types/app";

const doubanEmptyCategoryPrefix = "douban photo category is empty";

const doubanAssetTypeLabels: Record<DoubanAssetType, string> = {
  still: "剧照",
  poster: "海报",
  wallpaper: "壁纸",
};

// 把豆瓣图片分类转换成中文文案，用于空分类提示。
export function formatDoubanAssetTypeLabel(assetType: DoubanAssetType) {
  return doubanAssetTypeLabels[assetType];
}

// 判断 sidecar 错误是否表示“当前分类没有图片”。
export function isDoubanEmptyCategoryMessage(message?: string) {
  return Boolean(message?.toLowerCase().startsWith(doubanEmptyCategoryPrefix));
}

// 从结构化空分类错误中提取片名，提取失败时返回 null。
export function extractDoubanEmptyCategoryTitle(message?: string) {
  if (!isDoubanEmptyCategoryMessage(message)) {
    return null;
  }

  const match = message?.match(/\|title=([^|]+)$/i)?.[1];
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match);
  } catch {
    return match;
  }
}

// 判断任务是否因为豆瓣空分类失败，供前端展示更友好的摘要。
export function isDoubanEmptyCategoryTask(task: TaskItem) {
  return task.lifecycle.phase === "failed" && isDoubanEmptyCategoryMessage(task.lifecycle.lastError);
}
