// 图片下载服务：负责断点续传、图片格式转换、比例裁剪、保存和进度上报。
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { buildHeaders } from "../adapters/base.js";
import type { DownloadResult, DiscoveryResult, DiscoveredImage, SidecarTask } from "../shared/contracts.js";
import { emitTaskProgress, type SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";
import { buildFileName } from "../utils/output-folder.js";
import { waitFor } from "../utils/wait-for.js";
import {
  buildResumeArtifacts,
  clearResumeArtifacts,
  loadResumeMetadata,
  saveResumeMetadata,
  type ResumeMetadata,
} from "./resume-store.js";
import { PauseRequestedError, type FileTaskControl } from "./task-control.js";

// 校验最终输出格式，只允许 jpg/png，避免 sharp 或文件名生成阶段收到非法格式。
function ensureSupportedOutputImageFormat(format: string): asserts format is SidecarTask["outputImageFormat"] {
  if (format !== "jpg" && format !== "png") {
    throw new Error(`unsupported output image format: "${format}"`);
  }
}

// 先轻量读取常见图片头，只有需要裁剪或转格式时才交给 sharp 做完整解码。
function detectImageMetadata(buffer: Buffer) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      extension: ".png",
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          extension: ".jpg",
        };
      }

      if (blockLength < 2) {
        break;
      }
      offset += 2 + blockLength;
    }
  }

  if (buffer.length >= 16 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        extension: ".webp",
      };
    }

    if (chunkType === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        extension: ".webp",
      };
    }

    if (chunkType === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        extension: ".webp",
      };
    }
  }

  return { extension: undefined as string | undefined };
}

// 根据响应 Content-Type 或图片 URL 推断原始扩展名，决定是否可以直接保存原图二进制。
function inferExtension(imageUrl: string, contentType?: string | null) {
  if (contentType?.includes("image/webp")) return ".webp";
  if (contentType?.includes("image/png")) return ".png";
  if (contentType?.includes("image/jpeg")) return ".jpg";

  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".webp")) return ".webp";
  if (pathname.endsWith(".png")) return ".png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return ".jpg";

  return undefined;
}

interface NormalizedImageBuffer {
  buffer: Buffer;
  extension: ".jpg" | ".png";
  width?: number;
  height?: number;
}

// 校验图片比例策略，只允许原图、9:16、3:4 三种，和前端设置保持一致。
function ensureSupportedImageAspectRatio(aspectRatio: string): asserts aspectRatio is SidecarTask["imageAspectRatio"] {
  if (aspectRatio !== "original" && aspectRatio !== "9:16" && aspectRatio !== "3:4") {
    throw new Error(`unsupported image aspect ratio: "${aspectRatio}"`);
  }
}

// 把比例字符串转换成宽高数字，供居中裁剪算法计算目标比例。
function resolveAspectRatioSize(aspectRatio: Exclude<SidecarTask["imageAspectRatio"], "original">) {
  return aspectRatio === "3:4" ? { width: 3, height: 4 } : { width: 9, height: 16 };
}

// 固定比例下载采用居中裁剪，不放大、不拉伸，因此清晰度来自原始图片像素。
// 根据原图尺寸和目标比例计算居中裁剪区域，不放大、不拉伸，尽量保持清晰度。
function calculateCenteredCrop(width: number, height: number, aspectRatio: Exclude<SidecarTask["imageAspectRatio"], "original">) {
  const target = resolveAspectRatioSize(aspectRatio);
  const targetRatio = target.width / target.height;
  const sourceRatio = width / height;

  if (sourceRatio > targetRatio) {
    const cropWidth = Math.max(1, Math.floor(height * targetRatio));
    return {
      left: Math.max(0, Math.floor((width - cropWidth) / 2)),
      top: 0,
      width: cropWidth,
      height,
    };
  }

  const cropHeight = Math.max(1, Math.floor(width / targetRatio));
  return {
    left: 0,
    top: Math.max(0, Math.floor((height - cropHeight) / 2)),
    width,
    height: cropHeight,
  };
}

// 图片归一化负责最终格式和比例：原图模式尽量保持原始二进制，裁剪模式再用 sharp 输出。
async function normalizeImageBuffer(
  buffer: Buffer,
  targetFormat: SidecarTask["outputImageFormat"],
  imageAspectRatio: SidecarTask["imageAspectRatio"],
): Promise<NormalizedImageBuffer> {
  ensureSupportedOutputImageFormat(targetFormat);
  ensureSupportedImageAspectRatio(imageAspectRatio);

  let pipeline = sharp(buffer);
  if (imageAspectRatio !== "original") {
    const metadata = await pipeline.metadata();
    if (metadata.width && metadata.height) {
      pipeline = pipeline.extract(calculateCenteredCrop(metadata.width, metadata.height, imageAspectRatio));
    }
  }

  if (targetFormat === "png") {
    const result = await pipeline.png().toBuffer({ resolveWithObject: true });
    return {
      buffer: result.data,
      extension: ".png",
      width: result.info.width,
      height: result.info.height,
    };
  }

  const result = await pipeline
    .jpeg({
      quality: imageAspectRatio === "original" ? 92 : 100,
      chromaSubsampling: "4:4:4",
    })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    extension: ".jpg",
    width: result.info.width,
    height: result.info.height,
  };
}

// 判断断点续传 part 文件是否不存在；不存在是正常情况，不应让下载失败。
function isFileMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// 读取已下载 part 文件大小，用于 Range 续传；没有 part 文件时返回 null。
async function readExistingPartSize(partPath: string) {
  try {
    const stat = await fs.stat(partPath);
    return stat.size;
  } catch (error) {
    if (isFileMissing(error)) {
      return null;
    }
    throw error;
  }
}

// 从 Content-Range 或 Content-Length 推断图片总字节数，便于判断续传是否已经完整。
function resolveTotalBytes(response: Response, downloadedBytes: number) {
  const contentRange = response.headers.get("content-range");
  if (contentRange) {
    const match = /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange);
    if (match) {
      const totalBytes = Number(match[1]);
      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        return totalBytes;
      }
    }
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return undefined;
  }

  return response.status === 206 ? downloadedBytes + contentLength : contentLength;
}

interface DownloadedSourceImage {
  artifacts: ReturnType<typeof buildResumeArtifacts>;
  buffer: Buffer;
}

// 下载服务负责单张图片请求、断点续传、格式/比例处理、最终保存和进度上报。
export class DownloaderService {
  // 下载服务只保存运行配置和日志器；具体任务参数由 download(...) 每次传入。
  constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: SidecarLogger,
  ) {}

  // 断点续传只在 URL 和 part 文件都匹配时复用，避免把旧任务残片写进新图片。
  private async loadUsableResumeMetadata(
    outputDir: string,
    taskId: string,
    imageIndex: number,
    imageUrl: string,
  ) {
    const artifacts = buildResumeArtifacts(outputDir, taskId, imageIndex);
    const metadata = await loadResumeMetadata(outputDir, taskId, imageIndex);
    const partSize = await readExistingPartSize(artifacts.partPath);

    if (!metadata || partSize === null || metadata.imageUrl !== imageUrl) {
      if (metadata || partSize !== null) {
        await clearResumeArtifacts(outputDir, taskId, imageIndex);
      }
      return { artifacts, metadata: null as ResumeMetadata | null };
    }

    return {
      artifacts,
      metadata: {
        ...metadata,
        partPath: artifacts.partPath,
        metadataPath: artifacts.metadataPath,
        downloadedBytes: partSize,
      },
    };
  }

  // 下载流先落到 .part 文件并持续刷新元数据，暂停或崩溃后能从已下载字节继续。
  private async writeResponseToPartFile(
    response: Response,
    metadata: ResumeMetadata,
    replacePart: boolean,
    taskControl?: FileTaskControl,
  ) {
    await fs.mkdir(path.dirname(metadata.partPath), { recursive: true });
    const totalBytes = resolveTotalBytes(response, metadata.downloadedBytes);
    let nextMetadata: ResumeMetadata = {
      ...metadata,
      downloadedBytes: replacePart ? 0 : metadata.downloadedBytes,
      totalBytes,
      etag: response.headers.get("etag") ?? metadata.etag,
      lastModified: response.headers.get("last-modified") ?? metadata.lastModified,
    };
    await saveResumeMetadata(nextMetadata);

    const fileHandle = await fs.open(metadata.partPath, replacePart ? "w" : "a");
    try {
      const reader = response.body?.getReader();
      if (!reader) {
        const chunk = Buffer.from(await response.arrayBuffer());
        if (chunk.length > 0) {
          await fileHandle.write(chunk);
          nextMetadata = {
            ...nextMetadata,
            downloadedBytes: nextMetadata.downloadedBytes + chunk.length,
          };
          await saveResumeMetadata(nextMetadata);
        }
        return nextMetadata;
      }

      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }

        const chunk = Buffer.from(value);
        await fileHandle.write(chunk);
        nextMetadata = {
          ...nextMetadata,
          downloadedBytes: nextMetadata.downloadedBytes + chunk.length,
        };
        await saveResumeMetadata(nextMetadata);
        await taskControl?.assertNotPaused();
      }

      return nextMetadata;
    } finally {
      await fileHandle.close();
    }
  }

  // 单张图片请求会自动携带 Referer、Cookie 和 Range 头，失败时清理不可用的续传状态。
  private async fetchSourceImageBuffer(
    task: SidecarTask,
    discovery: DiscoveryResult,
    image: DiscoveredImage,
    imageIndex: number,
    cookieHeader?: string | null,
    taskControl?: FileTaskControl,
    allowRangeFallback = true,
  ): Promise<DownloadedSourceImage> {
    const prepared = await this.loadUsableResumeMetadata(discovery.outputDir, task.id, imageIndex, image.imageUrl);
    const artifacts = prepared.artifacts;

    if (prepared.metadata?.totalBytes && prepared.metadata.downloadedBytes >= prepared.metadata.totalBytes) {
      return {
        artifacts,
        buffer: await fs.readFile(artifacts.partPath),
      };
    }

    const headers = new Headers(
      buildHeaders(
        {
          config: this.config,
          logger: this.logger,
          cookieHeader,
        },
        {
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          referer: image.pageUrl ?? discovery.detailUrl,
        },
      ),
    );

    if (prepared.metadata?.downloadedBytes) {
      headers.set("Range", `bytes=${prepared.metadata.downloadedBytes}-`);
      if (prepared.metadata.etag) {
        headers.set("If-Range", prepared.metadata.etag);
      } else if (prepared.metadata.lastModified) {
        headers.set("If-Range", prepared.metadata.lastModified);
      }
    }

    const response = await fetch(image.imageUrl, {
      headers,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`image request failed: ${response.status} ${response.statusText}`);
    }

    if (prepared.metadata?.downloadedBytes && response.status !== 206) {
      await clearResumeArtifacts(discovery.outputDir, task.id, imageIndex);
      if (!allowRangeFallback) {
        throw new Error("range resume fallback loop detected");
      }
      return this.fetchSourceImageBuffer(task, discovery, image, imageIndex, cookieHeader, taskControl, false);
    }

    await this.writeResponseToPartFile(
      response,
      prepared.metadata ?? {
        taskId: task.id,
        imageIndex,
        imageUrl: image.imageUrl,
        partPath: artifacts.partPath,
        metadataPath: artifacts.metadataPath,
        downloadedBytes: 0,
      },
      !prepared.metadata?.downloadedBytes,
      taskControl,
    );

    return {
      artifacts,
      buffer: await fs.readFile(artifacts.partPath),
    };
  }

  // 主下载循环按发现顺序逐张保存，保存成功后立即上报进度并写入 saved image 日志。
  async download(
    task: SidecarTask,
    discovery: DiscoveryResult,
    cookieHeader?: string | null,
    taskControl?: FileTaskControl,
  ): Promise<DownloadResult> {
    await fs.mkdir(discovery.outputDir, { recursive: true });
    ensureSupportedOutputImageFormat(task.outputImageFormat);
    ensureSupportedImageAspectRatio(task.imageAspectRatio);

    const saved = [];
    for (const [index, image] of discovery.images.entries()) {
      const imageIndex = index + 1;

      try {
        await taskControl?.assertNotPaused();

        // 每次真实图片请求前都按任务间隔等待。
        await waitFor(task.requestIntervalMs);

        const sourceImage = await this.fetchSourceImageBuffer(
          task,
          discovery,
          image,
          imageIndex,
          cookieHeader,
          taskControl,
        );
        if (sourceImage.buffer.length === 0) {
          throw new Error("image response buffer is empty");
        }

        const detectedMetadata = detectImageMetadata(sourceImage.buffer);
        const width = image.width ?? detectedMetadata.width;
        const height = image.height ?? detectedMetadata.height;
        const sourceExtension = detectedMetadata.extension ?? inferExtension(image.imageUrl);
        const targetExtension = task.outputImageFormat === "png" ? ".png" : ".jpg";
        const canKeepOriginalFormat =
          (sourceExtension === ".jpg" || sourceExtension === ".png") && sourceExtension === targetExtension;
        const finalImage =
          canKeepOriginalFormat && task.imageAspectRatio === "original"
            ? { buffer: sourceImage.buffer, extension: targetExtension, width, height }
            : await normalizeImageBuffer(sourceImage.buffer, task.outputImageFormat, task.imageAspectRatio);
        const namingCategory = task.doubanAssetType;
        const fileName = buildFileName(
          discovery.normalizedTitle,
          namingCategory,
          finalImage.width ?? width,
          finalImage.height ?? height,
          imageIndex,
          finalImage.extension,
          task.imageAspectRatio,
        );
        const outputPath = path.join(discovery.outputDir, fileName);
        await fs.writeFile(outputPath, finalImage.buffer);
        await clearResumeArtifacts(discovery.outputDir, task.id, imageIndex);

        saved.push({
          sourceUrl: image.imageUrl,
          outputPath,
          category: image.category,
          orientation: image.orientation,
          width: finalImage.width ?? width,
          height: finalImage.height ?? height,
        });
        emitTaskProgress(task.id, "downloading", discovery.images.length, saved.length);
        this.logger.info(`saved image: ${outputPath}`, task.id);
      } catch (error) {
        if (error instanceof PauseRequestedError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`skipped image: ${image.imageUrl} -> ${message}`, task.id);
      }
    }

    if (saved.length === 0) {
      throw new Error("no downloadable images were saved");
    }

    return {
      outputDir: discovery.outputDir,
      saved,
      source: discovery.source,
    };
  }
}
