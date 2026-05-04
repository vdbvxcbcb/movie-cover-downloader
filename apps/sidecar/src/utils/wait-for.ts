// 等待工具：为请求间隔和测试节流提供 Promise 封装。
// 返回一个等待指定毫秒数的 Promise，用于请求间隔、测试节流和下载流程中的暂停点。
export function waitFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
