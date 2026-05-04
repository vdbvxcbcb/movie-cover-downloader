// 任务分页工具：根据任务总数和当前页计算可显示页面。
export const taskPageSize = 5;

// 根据任务总数计算分页总页数，至少保留 1 页以稳定分页 UI。
export function resolveTaskTotalPages(totalItems: number, pageSize = taskPageSize) {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

// 把用户输入页码限制在有效范围内，避免跳到不存在的页。
export function clampTaskPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), totalPages);
}

// 根据当前页截取列表数据，表格组件只渲染这一页任务。
export function paginateItems<T>(items: T[], currentPage: number, pageSize = taskPageSize) {
  const totalPages = resolveTaskTotalPages(items.length, pageSize);
  const resolvedPage = clampTaskPage(currentPage, totalPages);
  const start = (resolvedPage - 1) * pageSize;

  return {
    currentPage: resolvedPage,
    totalPages,
    pageItems: items.slice(start, start + pageSize),
  };
}
