import type { TaskItem } from "../types/app";
import { normalizeComparablePathExport } from "./useTaskComparison";

// 找出任务真正生成的子输出目录；如果只是输出根目录则拒绝作为删除目标。
export function getTaskGeneratedOutputDirectory(task: TaskItem) {
  const directoryPath = task.outputDirectory ?? task.download?.directory;
  if (!directoryPath) {
    return null;
  }

  if (normalizeComparablePathExport(directoryPath) === normalizeComparablePathExport(task.target.outputRootDir)) {
    return null;
  }

  return {
    directoryPath,
    rootDirectoryPath: task.target.outputRootDir,
  };
}

// 从图片完整路径中提取所在目录，用于补齐任务 outputDirectory。
export function directoryFromFilePath(filePath: string) {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (separatorIndex === -1) {
    return null;
  }

  return filePath.slice(0, separatorIndex);
}
