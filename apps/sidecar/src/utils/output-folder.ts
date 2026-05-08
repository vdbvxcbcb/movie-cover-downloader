// 输出路径工具：统一生成目录名和图片文件名，避免非法文件名字符。
import path from "node:path";

// 清理目录名或文件名片段中的非法字符，避免 Windows/macOS/Linux 文件系统保存失败。
export function sanitizeNameSegment(input: string) {
  return input.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

// 生成影片输出目录名，只使用片名，便于重复任务覆盖同一输出目录。
export function buildOutputFolderName(title: string) {
  return sanitizeNameSegment(title);
}

// 把用户选择的输出根目录和影片目录名拼成最终任务输出目录。
export function buildOutputDir(rootDir: string, folderName: string) {
  return path.join(rootDir, folderName);
}

export type FileNameImageAspectRatio = "original" | "9:16" | "3:4";

export function formatDirectoryImageAspectRatio(imageAspectRatio: FileNameImageAspectRatio) {
  return imageAspectRatio === "original" ? "original" : imageAspectRatio.replace(":", "x");
}

// 把比例策略转换成文件名后缀；original 用“原图”，固定比例用 9x16/3x4。
function formatFileNameImageAspectRatio(imageAspectRatio: FileNameImageAspectRatio) {
  return imageAspectRatio === "original" ? "原图" : imageAspectRatio.replace(":", "x");
}

// 文件名包含片名、分类、尺寸、序号和比例，便于用户直接从文件系统识别来源。
// 生成最终图片文件名，包含片名、分类、尺寸、序号和比例，确保下载结果可直接识别。
export function buildFileName(
  title: string,
  category: "poster" | "still" | "wallpaper",
  width?: number,
  height?: number,
  index?: number,
  extension = ".jpg",
  imageAspectRatio: FileNameImageAspectRatio = "original",
) {
  const size = width && height ? `${width}x${height}` : "unknown";
  const ratio = formatFileNameImageAspectRatio(imageAspectRatio);
  const suffix = index && index > 1 ? ` (${index})` : "";
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  return `${sanitizeNameSegment(title)} - ${category} - ${size} - ${ratio}${suffix}${normalizedExtension}`;
}
