import path from "node:path";

export function sanitizeNameSegment(input: string) {
  return input.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildOutputFolderName(title: string, date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return `${sanitizeNameSegment(title)} - ${isoDate}`;
}

export function buildOutputDir(rootDir: string, folderName: string) {
  return path.join(rootDir, folderName);
}

export type FileNameImageAspectRatio = "original" | "9:16" | "3:4";

function formatFileNameImageAspectRatio(imageAspectRatio: FileNameImageAspectRatio) {
  return imageAspectRatio === "original" ? "原图" : imageAspectRatio.replace(":", "x");
}

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
