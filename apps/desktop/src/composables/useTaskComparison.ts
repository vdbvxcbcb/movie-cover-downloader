import type { TaskDraft, TaskItem } from "../types/app";

// 比较目录时统一去掉结尾斜杠并转小写，避免 Windows 路径大小写差异。
function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// 统一 URL 比较格式
function normalizeComparableDetailUrl(url: string) {
  return url.trim().toLowerCase();
}

export function isSameTaskTarget(task: TaskItem, draft: TaskDraft) {
  const taskIsSelectedPhoto = Boolean(task.target.selectedImages?.length);
  const draftIsSelectedPhoto = Boolean(draft.selectedImages?.length);
  if (taskIsSelectedPhoto !== draftIsSelectedPhoto) {
    return false;
  }

  return (
    normalizeComparableDetailUrl(task.target.detailUrl) === normalizeComparableDetailUrl(draft.detailUrl) &&
    normalizeComparablePath(task.target.outputRootDir) === normalizeComparablePath(draft.outputRootDir) &&
    task.target.doubanAssetType === draft.doubanAssetType &&
    task.target.imageAspectRatio === draft.imageAspectRatio
  );
}

export function buildComparableTaskTargetKey(
  detailUrl: string,
  outputRootDir: string,
  doubanAssetType: TaskItem["target"]["doubanAssetType"],
  imageAspectRatio: TaskItem["target"]["imageAspectRatio"],
  isSelectedPhoto: boolean,
) {
  return [
    normalizeComparableDetailUrl(detailUrl),
    normalizeComparablePath(outputRootDir),
    doubanAssetType,
    imageAspectRatio,
    isSelectedPhoto ? "selected" : "auto",
  ].join("");
}

export function buildTaskTargetKey(task: TaskItem) {
  return buildComparableTaskTargetKey(
    task.target.detailUrl,
    task.target.outputRootDir,
    task.target.doubanAssetType,
    task.target.imageAspectRatio,
    Boolean(task.target.selectedImages?.length),
  );
}

export function buildDraftTargetKey(draft: TaskDraft) {
  return buildComparableTaskTargetKey(
    draft.detailUrl,
    draft.outputRootDir,
    draft.doubanAssetType,
    draft.imageAspectRatio,
    Boolean(draft.selectedImages?.length),
  );
}

export function normalizeComparablePathExport(path: string) {
  return normalizeComparablePath(path);
}
