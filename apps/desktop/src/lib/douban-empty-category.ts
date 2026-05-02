import type { DoubanAssetType, TaskItem } from "../types/app";

const doubanEmptyCategoryPrefix = "douban photo category is empty";

const doubanAssetTypeLabels: Record<DoubanAssetType, string> = {
  still: "剧照",
  poster: "海报",
  wallpaper: "壁纸",
};

export function formatDoubanAssetTypeLabel(assetType: DoubanAssetType) {
  return doubanAssetTypeLabels[assetType];
}

export function isDoubanEmptyCategoryMessage(message?: string) {
  return Boolean(message?.toLowerCase().startsWith(doubanEmptyCategoryPrefix));
}

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

export function isDoubanEmptyCategoryTask(task: TaskItem) {
  return task.lifecycle.phase === "failed" && isDoubanEmptyCategoryMessage(task.lifecycle.lastError);
}
