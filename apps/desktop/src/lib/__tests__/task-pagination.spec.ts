// 分页工具测试：覆盖边界页码和页数计算。
import { describe, it, expect } from 'vitest'
import { paginateItems } from '../task-pagination'

describe('task-pagination', () => {
  describe('paginateItems', () => {
    it('分页器默认每页 5 条并返回对应页数据', () => {
      const items = Array.from({ length: 12 }, (_, index) => `task-${index + 1}`)
      const page = paginateItems(items, 2)

      expect(page.totalPages).toBe(3)
      expect(page.currentPage).toBe(2)
      expect(page.pageItems).toEqual(["task-6", "task-7", "task-8", "task-9", "task-10"])
    })

    it('分页器在页码越界时会自动收敛到最后一页', () => {
      const items = Array.from({ length: 6 }, (_, index) => `task-${index + 1}`)
      const page = paginateItems(items, 99)

      expect(page.totalPages).toBe(2)
      expect(page.currentPage).toBe(2)
      expect(page.pageItems).toEqual(["task-6"])
    })
  })
})
