// 展示层工具测试：锁定进度、状态和文案格式化行为。
import test from "node:test";
import assert from "node:assert/strict";
import { describeQueueAction, describeTaskStatus, formatTaskProgress, getTaskProgressPercent } from "./presenters";
import type { TaskItem } from "../types/app";

// 创建展示层测试任务，允许按用例覆盖生命周期或下载快照。
function createTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    title: "示例电影",
    target: {
      detailUrl: "https://movie.douban.com/subject/34780991/",
      outputRootDir: "D:/cover",
      sourceHint: "douban",
      doubanAssetType: "wallpaper",
      imageCountMode: "limited",
      maxImages: 50,
      outputImageFormat: "jpg",
      imageAspectRatio: "original",
      requestIntervalSeconds: 1,
    },
    lifecycle: {
      phase: "failed",
      attempts: 1,
      updatedAt: "2026-05-01 20:00:00",
      lastError: "douban photo category is empty|title=%E7%A4%BA%E4%BE%8B%E7%94%B5%E5%BD%B1",
    },
    summary: "示例电影暂时没有壁纸",
    ...overrides,
  };
}

test("空分类任务状态显示为暂无内容而不是失败待重试", () => {
  const descriptor = describeTaskStatus(createTask());

  assert.equal(descriptor.label, "暂无内容");
  assert.equal(descriptor.tone, "neutral");
});

test("任务已完成时操作列显示完成按钮", () => {
  const descriptor = describeQueueAction(
    createTask({
      lifecycle: {
        phase: "completed",
        attempts: 1,
        updatedAt: "2026-05-01 21:20:00",
      },
    }),
  );

  assert.deepEqual(descriptor, {
    label: "完成",
    action: "none",
    disabled: true,
  });
});

test("下载数量已满的后台任务会按完成状态展示", () => {
  const task = createTask({
    lifecycle: {
      phase: "downloading",
      attempts: 1,
      updatedAt: "2026-05-02 20:08:00",
    },
    download: {
      savedCount: 10,
      targetCount: 10,
      directory: "D:/cover/Movie/still",
      files: [],
    },
    outputDirectory: "D:/cover/Movie/still",
  });

  assert.deepEqual(describeTaskStatus(task), {
    label: "已完成",
    tone: "good",
  });
  assert.deepEqual(describeQueueAction(task), {
    label: "完成",
    action: "none",
    disabled: true,
  });
});

test("下载数量已满但没有输出目录时仍不推断为完成", () => {
  const task = createTask({
    lifecycle: {
      phase: "downloading",
      attempts: 1,
      updatedAt: "2026-05-02 20:08:00",
    },
    download: {
      savedCount: 10,
      targetCount: 10,
      directory: "",
      files: [],
    },
    outputDirectory: undefined,
  });

  assert.equal(describeTaskStatus(task).label, "下载中");
  assert.equal(describeQueueAction(task).label, "暂停");
});

test("失败任务即使下载数量已满也不会被推断为完成", () => {
  const task = createTask({
    lifecycle: {
      phase: "failed",
      attempts: 1,
      updatedAt: "2026-05-02 20:08:00",
    },
    download: {
      savedCount: 10,
      targetCount: 10,
      directory: "D:/cover/Movie/still",
      files: [],
    },
    outputDirectory: "D:/cover/Movie/still",
    summary: "任务失败",
  });

  assert.equal(describeTaskStatus(task).label, "失败待重试");
  assert.equal(describeQueueAction(task).label, "重试");
});

test("未完成任务操作列保留重试按钮", () => {
  const descriptor = describeQueueAction(
    createTask({
      lifecycle: {
        phase: "failed",
        attempts: 1,
        updatedAt: "2026-05-01 21:20:00",
      },
    }),
  );

  assert.deepEqual(descriptor, {
    label: "重试",
    action: "retry",
    disabled: false,
  });
});

test("处理中任务操作列显示暂停按钮", () => {
  const descriptor = describeQueueAction(
    createTask({
      lifecycle: {
        phase: "downloading",
        attempts: 1,
        updatedAt: "2026-05-01 21:21:00",
      },
    }),
  );

  assert.deepEqual(descriptor, {
    label: "暂停",
    action: "pause",
    disabled: false,
  });
});

test("已暂停任务操作列显示继续按钮", () => {
  const descriptor = describeQueueAction(
    createTask({
      lifecycle: {
        phase: "paused",
        attempts: 1,
        updatedAt: "2026-05-01 21:22:00",
      },
    }),
  );

  assert.deepEqual(descriptor, {
    label: "继续",
    action: "resume",
    disabled: false,
  });
});

test("任务下载进度会显示已完成张数和目标张数", () => {
  const progress = formatTaskProgress(
    createTask({
      download: {
        savedCount: 7,
        targetCount: 50,
        directory: "D:/cover",
        files: [],
      },
    }),
  );

  assert.equal(progress, "7/50");
});

test("任务已拿到目标张数但还未保存图片时下载进度显示短横线加目标张数", () => {
  const progress = formatTaskProgress(
    createTask({
      download: {
        savedCount: 0,
        targetCount: 50,
        directory: "D:/cover",
        files: [],
      },
    }),
  );

  assert.equal(progress, "-/50");
});

test("任务还未拿到可下载图片总数时下载进度显示短横线", () => {
  const progress = formatTaskProgress(createTask({ download: undefined }));

  assert.equal(progress, "-");
});

test("任务下载进度百分比会按已完成张数计算", () => {
  const progressPercent = getTaskProgressPercent(
    createTask({
      download: {
        savedCount: 7,
        targetCount: 50,
        directory: "D:/cover",
        files: [],
      },
    }),
  );

  assert.equal(progressPercent, 14);
});

test("任务已拿到目标张数但还未保存图片时下载进度百分比为零", () => {
  const progressPercent = getTaskProgressPercent(
    createTask({
      download: {
        savedCount: 0,
        targetCount: 50,
        directory: "D:/cover",
        files: [],
      },
    }),
  );

  assert.equal(progressPercent, 0);
});

test("任务还未拿到目标张数时下载进度百分比为空", () => {
  const progressPercent = getTaskProgressPercent(createTask({ download: undefined }));

  assert.equal(progressPercent, null);
});
