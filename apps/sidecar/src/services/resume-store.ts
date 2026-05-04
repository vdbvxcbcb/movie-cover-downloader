// 断点续传元数据服务：管理临时 part 文件和 JSON 元数据。
import fs from "node:fs/promises";
import path from "node:path";

export interface ResumeArtifacts {
  partPath: string;
  metadataPath: string;
}

export interface ResumeMetadata {
  taskId: string;
  imageIndex: number;
  imageUrl: string;
  partPath: string;
  metadataPath: string;
  downloadedBytes: number;
  totalBytes?: number;
  etag?: string;
  lastModified?: string;
}

const resumeRootFolderName = ".mcd-resume";

// 清理空目录时忽略“不存在”或“目录非空”等可接受错误，避免影响下载主流程。
function isIgnorableDirectoryCleanupError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST";
}

// 续传文件集中放在 .mcd-resume，下载完成后会清理，避免临时文件混入最终图片目录。
// 生成单张图片的断点续传 part 文件和 metadata 文件路径，统一放在 .mcd-resume 下。
export function buildResumeArtifacts(outputDir: string, taskId: string, imageIndex: number): ResumeArtifacts {
  const taskDir = path.join(outputDir, resumeRootFolderName, taskId);
  const fileStem = String(imageIndex);
  return {
    partPath: path.join(taskDir, `${fileStem}.part`),
    metadataPath: path.join(taskDir, `${fileStem}.json`),
  };
}

// 读取断点续传元数据；文件不存在或 JSON 损坏时返回 null，让下载重新开始。
export async function loadResumeMetadata(outputDir: string, taskId: string, imageIndex: number) {
  const artifacts = buildResumeArtifacts(outputDir, taskId, imageIndex);

  try {
    const raw = await fs.readFile(artifacts.metadataPath, "utf8");
    return JSON.parse(raw) as ResumeMetadata;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }
    throw error;
  }
}

// 写入断点续传元数据，保存已下载字节数、总大小、ETag 和 Last-Modified。
export async function saveResumeMetadata(metadata: ResumeMetadata) {
  await fs.mkdir(path.dirname(metadata.metadataPath), { recursive: true });
  await fs.writeFile(metadata.metadataPath, JSON.stringify(metadata, null, 2));
}

// 图片成功保存或续传状态不可用时清理临时文件，并尝试删除空的续传目录。
export async function clearResumeArtifacts(outputDir: string, taskId: string, imageIndex: number) {
  const artifacts = buildResumeArtifacts(outputDir, taskId, imageIndex);
  const taskDir = path.dirname(artifacts.metadataPath);
  const resumeRootDir = path.dirname(taskDir);

  await fs.rm(artifacts.partPath, { force: true });
  await fs.rm(artifacts.metadataPath, { force: true });

  for (const directoryPath of [taskDir, resumeRootDir]) {
    try {
      await fs.rmdir(directoryPath);
    } catch (error) {
      if (!isIgnorableDirectoryCleanupError(error)) {
        throw error;
      }
    }
  }
}
