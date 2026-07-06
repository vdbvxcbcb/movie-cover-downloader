// 展示层工具测试：锁定进度、状态和文案格式化行为。
import { describe, it, expect } from 'vitest'
import { describeQueueAction, describeTaskStatus, formatTaskProgress, formatTaskTitle, getTaskProgressPercent } from '../presenters'
import type { TaskItem } from '../../types/app'

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
  }
}

describe('presenters', () => {
  describe('describeTaskStatus', () => {
    it('空分类任务状态显示为暂无内容而不是失败待重试', () => {
      const descriptor = describeTaskStatus(createTask())

      expect(descriptor.label).toBe("暂无内容")
      expect(descriptor.tone).toBe("neutral")
    })

    it('下载数量已满的后台任务会按完成状态展示', () => {
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
      })

      expect(describeTaskStatus(task)).toEqual({
        label: "已完成",
        tone: "good",
      })
    })

    it('下载数量已满但没有输出目录时仍不推断为完成', () => {
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
      })

      expect(describeTaskStatus(task).label).toBe("下载中")
    })

    it('失败任务即使下载数量已满也不会被推断为完成', () => {
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
      })

      expect(describeTaskStatus(task).label).toBe("失败待重试")
    })
  })

  describe('formatTaskTitle', () => {
    it('自动下载任务标题会显示片名分类和任务模式', () => {
      expect(formatTaskTitle(createTask())).toBe("示例电影 壁纸 自动下载")
      expect(formatTaskTitle(createTask({ target: { ...createTask().target, doubanAssetType: "poster" } }))).toBe("示例电影 海报 自动下载")
    })

    it('选图下载任务标题会显示片名分类和任务模式', () => {
      expect(
        formatTaskTitle(createTask({
          title: "示例电影 选图下载",
          target: {
            ...createTask().target,
            doubanAssetType: "poster",
            selectedImages: [
              {
                id: "selected-1",
                source: "douban",
                title: "selected",
                imageUrl: "https://img1.doubanio.com/view/photo/l/public/p1.jpg",
                category: "poster",
                doubanAssetType: "poster",
                orientation: "vertical",
              },
            ],
          },
        }))
      ).toBe("示例电影 海报 选图下载")
    })
  })

  describe('describeQueueAction', () => {
    it('任务已完成时操作列显示完成按钮', () => {
      const descriptor = describeQueueAction(
        createTask({
          lifecycle: {
            phase: "completed",
            attempts: 1,
            updatedAt: "2026-05-01 21:20:00",
          },
        })
      )

      expect(descriptor).toEqual({
        label: "完成",
        action: "none",
        disabled: true,
      })
    })

    it('下载数量已满的后台任务操作列显示完成', () => {
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
      })

      expect(describeQueueAction(task)).toEqual({
        label: "完成",
        action: "none",
        disabled: true,
      })
    })

    it('下载数量已满但没有输出目录时操作列仍显示暂停', () => {
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
      })

      expect(describeQueueAction(task).label).toBe("暂停")
    })

    it('失败任务操作列保留重试按钮', () => {
      const descriptor = describeQueueAction(
        createTask({
          lifecycle: {
            phase: "failed",
            attempts: 1,
            updatedAt: "2026-05-01 21:20:00",
          },
        })
      )

      expect(descriptor).toEqual({
        label: "重试",
        action: "retry",
        disabled: false,
      })
    })

    it('失败任务即使下载数量已满也显示重试按钮', () => {
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
      })

      expect(describeQueueAction(task).label).toBe("重试")
    })

    it('待处理任务操作列显示待处理', () => {
      const descriptor = describeQueueAction(
        createTask({
          lifecycle: {
            phase: "queued",
            attempts: 0,
            updatedAt: "2026-05-01 21:19:00",
          },
        })
      )

      expect(descriptor).toEqual({
        label: "待处理",
        action: "none",
        disabled: true,
      })
    })

    it('处理中任务操作列显示暂停按钮', () => {
      const descriptor = describeQueueAction(
        createTask({
          lifecycle: {
            phase: "downloading",
            attempts: 1,
            updatedAt: "2026-05-01 21:21:00",
          },
        })
      )

      expect(descriptor).toEqual({
        label: "暂停",
        action: "pause",
        disabled: false,
      })
    })

    it('已暂停任务操作列显示继续按钮', () => {
      const descriptor = describeQueueAction(
        createTask({
          lifecycle: {
            phase: "paused",
            attempts: 1,
            updatedAt: "2026-05-01 21:22:00",
          },
        })
      )

      expect(descriptor).toEqual({
        label: "继续",
        action: "resume",
        disabled: false,
      })
    })
  })

  describe('formatTaskProgress', () => {
    it('任务下载进度会显示已完成张数和目标张数', () => {
      const progress = formatTaskProgress(
        createTask({
          download: {
            savedCount: 7,
            targetCount: 50,
            directory: "D:/cover",
            files: [],
          },
        })
      )

      expect(progress).toBe("7/50")
    })

    it('任务已拿到目标张数但还未保存图片时下载进度显示短横线加目标张数', () => {
      const progress = formatTaskProgress(
        createTask({
          download: {
            savedCount: 0,
            targetCount: 50,
            directory: "D:/cover",
            files: [],
          },
        })
      )

      expect(progress).toBe("-/50")
    })

    it('任务还未拿到可下载图片总数时下载进度显示短横线', () => {
      const progress = formatTaskProgress(createTask({ download: undefined }))

      expect(progress).toBe("-")
    })
  })

  describe('getTaskProgressPercent', () => {
    it('任务下载进度百分比会按已完成张数计算', () => {
      const progressPercent = getTaskProgressPercent(
        createTask({
          download: {
            savedCount: 7,
            targetCount: 50,
            directory: "D:/cover",
            files: [],
          },
        })
      )

      expect(progressPercent).toBe(14)
    })

    it('任务已拿到目标张数但还未保存图片时下载进度百分比为零', () => {
      const progressPercent = getTaskProgressPercent(
        createTask({
          download: {
            savedCount: 0,
            targetCount: 50,
            directory: "D:/cover",
            files: [],
          },
        })
      )

      expect(progressPercent).toBe(0)
    })

    it('任务还未拿到目标张数时下载进度百分比为空', () => {
      const progressPercent = getTaskProgressPercent(createTask({ download: undefined }))

      expect(progressPercent).toBe(null)
    })
  })
})
