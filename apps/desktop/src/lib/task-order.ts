import type { TaskItem } from "../types/app";

export function compareTaskAddedOrder(left: TaskItem, right: TaskItem) {
  const leftMatch = /^task-(\d+)-(\d+)$/.exec(left.id);
  const rightMatch = /^task-(\d+)-(\d+)$/.exec(right.id);
  const leftCreatedAt = leftMatch ? Number(leftMatch[1]) : Number.MAX_SAFE_INTEGER;
  const rightCreatedAt = rightMatch ? Number(rightMatch[1]) : Number.MAX_SAFE_INTEGER;

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  const leftSequence = leftMatch ? Number(leftMatch[2]) : Number.MAX_SAFE_INTEGER;
  const rightSequence = rightMatch ? Number(rightMatch[2]) : Number.MAX_SAFE_INTEGER;

  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  return left.id.localeCompare(right.id);
}