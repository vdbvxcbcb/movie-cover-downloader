export const taskPageSize = 5;

export function resolveTaskTotalPages(totalItems: number, pageSize = taskPageSize) {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampTaskPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), totalPages);
}

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
