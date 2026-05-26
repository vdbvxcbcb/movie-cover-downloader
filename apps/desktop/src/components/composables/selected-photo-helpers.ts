import type {
  DoubanAssetType,
  RuntimeDoubanPhotoDiscoveryCursor,
  SelectableDoubanPhoto,
} from "../../types/app";

export const selectedPhotoAssetTypes: DoubanAssetType[] = ["still", "poster", "wallpaper"];
export const selectedPhotoRenderBatchSize = 14;
export const titlePreviewResolveConcurrency = 3;

export function pickMoreCompleteTitle(currentTitle: string, nextTitle?: string | null) {
  const normalizedNextTitle = nextTitle?.trim();
  if (!normalizedNextTitle) return currentTitle;

  const normalizedCurrentTitle = currentTitle.trim();
  if (!normalizedCurrentTitle || normalizedNextTitle.includes(normalizedCurrentTitle)) {
    return normalizedNextTitle;
  }

  return normalizedNextTitle.length > normalizedCurrentTitle.length ? normalizedNextTitle : currentTitle;
}

export function createSelectedPhotoDiscoveryState() {
  return selectedPhotoAssetTypes.reduce(
    (state, assetType) => {
      state[assetType] = { cursor: null, done: false };
      return state;
    },
    {} as Record<DoubanAssetType, { cursor: RuntimeDoubanPhotoDiscoveryCursor | null; done: boolean }>,
  );
}

export function formatSelectedPhotoCategory(photo: SelectableDoubanPhoto) {
  if (photo.doubanAssetType === "poster") return "海报";
  if (photo.doubanAssetType === "wallpaper") return "壁纸";
  return "剧照";
}
