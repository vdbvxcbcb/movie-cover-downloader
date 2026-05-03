import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DownloaderService } from "./downloader.js";
import { buildResumeArtifacts, saveResumeMetadata } from "./resume-store.js";
import { FileTaskControl } from "./task-control.js";
import type { DiscoveryResult, SidecarTask } from "../shared/contracts.js";
import type { SidecarLogger } from "../shared/logger.js";
import type { RuntimeConfig } from "../shared/runtime-config.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tm2QAAAAASUVORK5CYII=",
  "base64",
);

function createLogger() {
  const warnings: string[] = [];

  const logger: SidecarLogger = {
    info() {},
    warn(message) {
      warnings.push(message);
    },
    error() {},
  };

  return { logger, warnings };
}

function createConfig(): RuntimeConfig {
  return {
    concurrency: 1,
    batchSize: 1,
    requestIntervalMs: 0,
    requestTimeoutMs: 1_000,
    cookieCooldownMs: 1_000,
    outputDir: "covers/internal",
    userAgentProfile: "desktop-chrome",
  };
}

function createTask(): SidecarTask {
  return {
    id: "task-1",
    detailUrl: "https://movie.douban.com/subject/34780991/",
    outputRootDir: "D:/cover",
    sourceHint: "douban",
    doubanAssetType: "wallpaper",
    imageCountMode: "limited",
    maxImages: 50,
    outputImageFormat: "png",
    imageAspectRatio: "original",
    requestIntervalMs: 0,
    phase: "downloading",
    attempts: 1,
  };
}

function createDiscovery(outputDir: string): DiscoveryResult {
  return {
    source: "douban",
    detailUrl: "https://movie.douban.com/subject/34780991/",
    imagePageUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
    normalizedTitle: "Test Title",
    outputFolderName: "Test Title - 2026-05-01",
    outputDir,
    images: [
      {
        id: "bad-image",
        source: "douban",
        title: "bad image",
        imageUrl: "https://img9.doubanio.com/view/photo/m/public/p2918037215.webp",
        pageUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
        category: "still",
        orientation: "horizontal",
      },
      {
        id: "good-image",
        source: "douban",
        title: "good image",
        imageUrl: "https://img1.doubanio.com/view/photo/l/public/good.png",
        pageUrl: "https://movie.douban.com/subject/34780991/photos?type=W",
        category: "still",
        orientation: "horizontal",
      },
    ],
  };
}

test("单张坏图返回空内容时会跳过它并继续保存其他图片", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger, warnings } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("p2918037215.webp")) {
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: {
          "content-type": "image/webp",
        },
      });
    }

    return new Response(onePixelPng, {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    });
  };

  try {
    const result = await downloader.download(createTask(), createDiscovery(tempDir));

    assert.equal(result.saved.length, 1);
    assert.match(result.saved[0]!.sourceUrl, /good\.png$/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /skipped image/i);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("全部图片都不可下载时会给出明确失败原因", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger, warnings } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(new Uint8Array(0), {
      status: 200,
      headers: {
        "content-type": "image/webp",
      },
    });

  try {
    await assert.rejects(
      () => downloader.download(createTask(), createDiscovery(tempDir)),
      /no downloadable images were saved/i,
    );

    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /skipped image/i);
    assert.match(warnings[1]!, /skipped image/i);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("豆瓣壁纸任务会按 wallpaper 写入文件名而不是 still", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(onePixelPng, {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    });

  try {
    const discovery = createDiscovery(tempDir);
    discovery.images = [discovery.images[0]!];
    const result = await downloader.download(createTask(), discovery);

    assert.equal(result.saved.length, 1);
    assert.match(path.basename(result.saved[0]!.outputPath), /Test Title - wallpaper - 1x1 - 原图\.png$/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("存在 part 文件时会带 Range 请求续传当前图片", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;
  const discovery = createDiscovery(tempDir);
  discovery.images = [{ ...discovery.images[1]!, width: 1, height: 1 }];

  const artifacts = buildResumeArtifacts(tempDir, "task-1", 1);
  const partialBuffer = onePixelPng.subarray(0, 12);
  await fs.mkdir(path.dirname(artifacts.partPath), { recursive: true });
  await fs.writeFile(artifacts.partPath, partialBuffer);
  await saveResumeMetadata({
    taskId: "task-1",
    imageIndex: 1,
    imageUrl: discovery.images[0]!.imageUrl,
    partPath: artifacts.partPath,
    metadataPath: artifacts.metadataPath,
    downloadedBytes: partialBuffer.length,
    etag: "\"resume-ok\"",
  });

  const seenRanges: Array<string | null> = [];
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    seenRanges.push(headers.get("Range"));

    return new Response(onePixelPng.subarray(partialBuffer.length), {
      status: 206,
      headers: {
        "content-type": "image/png",
        "content-length": String(onePixelPng.length - partialBuffer.length),
        "content-range": `bytes ${partialBuffer.length}-${onePixelPng.length - 1}/${onePixelPng.length}`,
        etag: "\"resume-ok\"",
      },
    });
  };

  try {
    const result = await downloader.download(createTask(), discovery);

    assert.deepEqual(seenRanges, [`bytes=${partialBuffer.length}-`]);
    assert.equal(result.saved.length, 1);
    await assert.rejects(() => fs.stat(artifacts.partPath), /ENOENT/);
    await assert.rejects(() => fs.stat(artifacts.metadataPath), /ENOENT/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("图片成功保存后会清理空的断点续传目录", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;
  const discovery = createDiscovery(tempDir);
  discovery.images = [{ ...discovery.images[1]!, width: 1, height: 1 }];

  globalThis.fetch = async () =>
    new Response(onePixelPng, {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    });

  try {
    const result = await downloader.download(createTask(), discovery);

    assert.equal(result.saved.length, 1);
    await assert.rejects(() => fs.stat(path.join(tempDir, ".mcd-resume")), /ENOENT/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("源站不支持 Range 时只会丢弃当前 part 并重下当前图片", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;
  const discovery = createDiscovery(tempDir);
  discovery.images = [{ ...discovery.images[1]!, width: 1, height: 1 }];

  const artifacts = buildResumeArtifacts(tempDir, "task-1", 1);
  const partialBuffer = onePixelPng.subarray(0, 10);
  await fs.mkdir(path.dirname(artifacts.partPath), { recursive: true });
  await fs.writeFile(artifacts.partPath, partialBuffer);
  await saveResumeMetadata({
    taskId: "task-1",
    imageIndex: 1,
    imageUrl: discovery.images[0]!.imageUrl,
    partPath: artifacts.partPath,
    metadataPath: artifacts.metadataPath,
    downloadedBytes: partialBuffer.length,
    etag: "\"range-miss\"",
  });

  const seenRanges: Array<string | null> = [];
  let attempt = 0;
  globalThis.fetch = async (_input, init) => {
    attempt += 1;
    const headers = new Headers(init?.headers);
    seenRanges.push(headers.get("Range"));

    return new Response(onePixelPng, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(onePixelPng.length),
        etag: "\"range-miss\"",
      },
    });
  };

  try {
    const result = await downloader.download(createTask(), discovery);

    assert.equal(attempt, 2);
    assert.deepEqual(seenRanges, [`bytes=${partialBuffer.length}-`, null]);
    assert.equal(result.saved.length, 1);
    await assert.rejects(() => fs.stat(artifacts.partPath), /ENOENT/);
    await assert.rejects(() => fs.stat(artifacts.metadataPath), /ENOENT/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("暂停后会保留当前 part 文件并在继续时带 Range 恢复下载", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;
  const discovery = createDiscovery(tempDir);
  discovery.images = [{ ...discovery.images[1]!, width: 1, height: 1 }];

  const controlFilePath = path.join(tempDir, "task-control.txt");
  await fs.writeFile(controlFilePath, "resume");
  const taskControl = new FileTaskControl(controlFilePath);
  const firstChunk = onePixelPng.subarray(0, 12);
  const remainingChunk = onePixelPng.subarray(12);
  const seenRanges: Array<string | null> = [];
  let fetchAttempt = 0;

  globalThis.fetch = async (_input, init) => {
    fetchAttempt += 1;
    const headers = new Headers(init?.headers);
    seenRanges.push(headers.get("Range"));

    if (fetchAttempt === 1) {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(firstChunk);
            void fs.writeFile(controlFilePath, "pause");
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": String(onePixelPng.length),
            etag: "\"pause-resume\"",
          },
        },
      );
    }

    return new Response(remainingChunk, {
      status: 206,
      headers: {
        "content-type": "image/png",
        "content-length": String(remainingChunk.length),
        "content-range": `bytes ${firstChunk.length}-${onePixelPng.length - 1}/${onePixelPng.length}`,
        etag: "\"pause-resume\"",
      },
    });
  };

  try {
    await assert.rejects(
      () => downloader.download(createTask(), discovery, undefined, taskControl),
      /task paused by user/i,
    );

    const artifacts = buildResumeArtifacts(tempDir, "task-1", 1);
    assert.equal((await fs.stat(artifacts.partPath)).size, firstChunk.length);

    await fs.writeFile(controlFilePath, "resume");
    const result = await downloader.download(createTask(), discovery, undefined, taskControl);

    assert.equal(result.saved.length, 1);
    assert.deepEqual(seenRanges, [null, `bytes=${firstChunk.length}-`]);
    await assert.rejects(() => fs.stat(artifacts.partPath), /ENOENT/);
    await assert.rejects(() => fs.stat(artifacts.metadataPath), /ENOENT/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("选择图片比例时只裁剪不放大缩放", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcd-downloader-ratio-"));
  const { logger } = createLogger();
  const downloader = new DownloaderService(createConfig(), logger);
  const originalFetch = globalThis.fetch;
  const sourceBuffer = await sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: "#4dd4c6",
    },
  })
    .jpeg({ quality: 100 })
    .toBuffer();

  globalThis.fetch = async () =>
    new Response(new Uint8Array(sourceBuffer), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
      },
    });

  try {
    const discovery = createDiscovery(tempDir);
    discovery.images = [discovery.images[1]!];
    const result = await downloader.download(
      {
        ...createTask(),
        outputImageFormat: "jpg",
        imageAspectRatio: "9:16",
      },
      discovery,
    );
    const metadata = await sharp(result.saved[0]!.outputPath).metadata();

    assert.equal(metadata.width, 506);
    assert.equal(metadata.height, 900);
    assert.equal(result.saved[0]!.width, 506);
    assert.equal(result.saved[0]!.height, 900);
    assert.match(path.basename(result.saved[0]!.outputPath), /Test Title - wallpaper - 506x900 - 9x16\.jpg$/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});