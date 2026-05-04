// 分页工具测试：覆盖边界页码和页数计算。
import test from "node:test";
import assert from "node:assert/strict";
import { paginateItems } from "./task-pagination";

test("分页器默认每页 5 条并返回对应页数据", () => {
  const items = Array.from({ length: 12 }, (_, index) => `task-${index + 1}`);
  const page = paginateItems(items, 2);

  assert.equal(page.totalPages, 3);
  assert.equal(page.currentPage, 2);
  assert.deepEqual(page.pageItems, ["task-6", "task-7", "task-8", "task-9", "task-10"]);
});

test("分页器在页码越界时会自动收敛到最后一页", () => {
  const items = Array.from({ length: 6 }, (_, index) => `task-${index + 1}`);
  const page = paginateItems(items, 99);

  assert.equal(page.totalPages, 2);
  assert.equal(page.currentPage, 2);
  assert.deepEqual(page.pageItems, ["task-6"]);
});
