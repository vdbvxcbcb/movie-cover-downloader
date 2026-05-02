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

function isIgnorableDirectoryCleanupError(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT" || error.code === "ENOTEMPTY" || error.code === "EEXIST";
}

export function buildResumeArtifacts(outputDir: string, taskId: string, imageIndex: number): ResumeArtifacts {
  const taskDir = path.join(outputDir, resumeRootFolderName, taskId);
  const fileStem = String(imageIndex);
  return {
    partPath: path.join(taskDir, `${fileStem}.part`),
    metadataPath: path.join(taskDir, `${fileStem}.json`),
  };
}

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

export async function saveResumeMetadata(metadata: ResumeMetadata) {
  await fs.mkdir(path.dirname(metadata.metadataPath), { recursive: true });
  await fs.writeFile(metadata.metadataPath, JSON.stringify(metadata, null, 2));
}

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
