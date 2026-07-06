// 新增任务表单校验测试：覆盖链接格式、数量限制和默认值。
import { describe, it, expect } from 'vitest'
import {
  normalizeDetailUrlsInput,
  validateTaskDraftInput,
} from '../task-draft-input'

function expectValidationFailure(result: ReturnType<typeof validateTaskDraftInput>) {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error('expected validation failure')
  }
  return result
}

describe('task-draft-input', () => {
  describe('normalizeDetailUrlsInput', () => {
    it('批量链接输入会把连续链接自动拆成逐行', () => {
      const normalized = normalizeDetailUrlsInput(
        "https://movie.douban.com/subject/36965301https://movie.douban.com/subject/34780991https://movie.douban.com/subject/36857924"
      )

      expect(normalized).toBe(
        [
          "https://movie.douban.com/subject/36965301",
          "https://movie.douban.com/subject/34780991",
          "https://movie.douban.com/subject/36857924",
        ].join("\n")
      )
    })

    it('带片名的展示行不会把片名和链接拆成两行', () => {
      const normalized = normalizeDetailUrlsInput("飞驰人生3：https://movie.douban.com/subject/37311135/")

      expect(normalized).toBe("飞驰人生3：https://movie.douban.com/subject/37311135/")
    })
  })

  describe('validateTaskDraftInput', () => {
    it('详情页链接只允许豆瓣 subject 链接', () => {
      const result = validateTaskDraftInput({
        detailUrls: "https://example.com/movie/1",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "50",
      })

      const failure = expectValidationFailure(result)
      expect(failure.message).toMatch(/不能加入队列/)
      expect(failure.message).toMatch(/不支持的链接/)
    })

    it('详情页链接接受指定形式的豆瓣 subject 链接', () => {
      const result = validateTaskDraftInput({
        detailUrls: [
          "https://movie.douban.com/subject/34780991/",
          "https://movie.douban.com/subject/1292064/",
        ].join("\n"),
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      expect(result.ok).toBe(true)
    })

    it('详情页链接接受带片名的展示行并提交纯链接', () => {
      const result = validateTaskDraftInput({
        detailUrls: [
          "飞驰人生3：https://movie.douban.com/subject/37311135/",
          "消失的人：https://movie.douban.com/subject/36965301/",
        ].join("\n"),
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.detailUrls).toEqual([
          "https://movie.douban.com/subject/37311135/",
          "https://movie.douban.com/subject/36965301/",
        ])
      }
    })

    it('详情页链接会拒绝豆瓣根站和非豆瓣链接', () => {
      const doubanResult = validateTaskDraftInput({
        detailUrls: "https://movie.douban.com/",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })
      const externalResult = validateTaskDraftInput({
        detailUrls: "https://example.org/movie/1",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      expect(doubanResult.ok).toBe(false)
      expect(externalResult.ok).toBe(false)
    })

    it('详情页链接会拒绝豆瓣非 subject 链接', () => {
      const result = validateTaskDraftInput({
        detailUrls: "https://movie.douban.com/subject/34780991/photos?type=S",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      expect(result.ok).toBe(false)
    })

    it('详情页链接会拒绝非字符串类型', () => {
      const result = validateTaskDraftInput({
        detailUrls: ["https://movie.douban.com/subject/34780991/"],
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      const failure = expectValidationFailure(result)
      expect(failure.message).toBe("不能加入队列：详情页链接（批量）必须是文本字符串。")
    })

    it('详情页链接为空时返回不能加入队列的原因', () => {
      const result = validateTaskDraftInput({
        detailUrls: "",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "10",
      })

      const failure = expectValidationFailure(result)
      expect(failure.message).toBe("不能加入队列：请填写详情页链接（批量）。")
    })

    it('数量限制填入非数值类型时返回中文警告', () => {
      const result = validateTaskDraftInput({
        detailUrls: "https://movie.douban.com/subject/34780991/",
        outputRootDir: "D:/cover",
        imageCountMode: "limited",
        maxImagesInput: "abc",
      })

      const failure = expectValidationFailure(result)
      expect(failure.message).toBe("不能加入队列：数量限制填入文本类型错误，非数值类型。")
    })

    it('无限制模式不依赖数量输入', () => {
      const result = validateTaskDraftInput({
        detailUrls: "https://movie.douban.com/subject/34780991/",
        outputRootDir: "D:/cover",
        imageCountMode: "unlimited",
        maxImagesInput: "",
      })

      expect(result.ok).toBe(true)
    })
  })
})
