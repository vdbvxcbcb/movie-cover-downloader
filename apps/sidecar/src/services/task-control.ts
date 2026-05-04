// 任务控制服务：通过文件信号支持暂停、继续和取消 sidecar 下载。
import fs from "node:fs/promises";

// 判断读取控制文件时的 ENOENT；没有控制文件表示当前没有暂停或取消指令。
function isFileMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// 控制错误使用专用类型，方便调度层区分“用户暂停/取消”和真实下载失败。
// 专用暂停错误：下载流程抛出后由调度器识别为用户主动暂停，而不是任务失败。
export class PauseRequestedError extends Error {
  // 固定错误消息，Tauri 会据此把任务保持在暂停状态。
  constructor() {
    super("task paused by user");
    this.name = "PauseRequestedError";
  }
}

// 专用取消错误：删除或清空任务时抛出，用来中止 sidecar 且不按普通失败处理。
export class CancelRequestedError extends Error {
  // 固定错误消息，Tauri 会据此把任务视为被删除或清空队列取消。
  constructor() {
    super("task cancelled by user");
    this.name = "CancelRequestedError";
  }
}

// 文件控制器读取 Tauri 写入的 pause/resume/cancel 文本，实现跨进程任务控制。
export class FileTaskControl {
  // controlFilePath 可选，方便测试或没有 Tauri 控制文件时复用下载逻辑。
  constructor(private readonly controlFilePath?: string) {}

  // 读取当前控制动作；没有文件时默认 resume，让下载继续执行。
  async readAction() {
    if (!this.controlFilePath) {
      return "resume";
    }

    try {
      return (await fs.readFile(this.controlFilePath, "utf8")).trim().toLowerCase() || "resume";
    } catch (error) {
      if (isFileMissing(error)) {
        return "resume";
      }
      throw error;
    }
  }

  // 下载循环在关键节点调用该方法；读到 pause/cancel 时抛出专用错误中断流程。
  async assertNotPaused() {
    const action = await this.readAction();
    if (action === "cancel") {
      throw new CancelRequestedError();
    }
    if (action === "pause") {
      throw new PauseRequestedError();
    }
  }
}
