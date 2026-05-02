import fs from "node:fs/promises";

function isFileMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export class PauseRequestedError extends Error {
  constructor() {
    super("task paused by user");
    this.name = "PauseRequestedError";
  }
}

export class CancelRequestedError extends Error {
  constructor() {
    super("task cancelled by user");
    this.name = "CancelRequestedError";
  }
}

export class FileTaskControl {
  constructor(private readonly controlFilePath?: string) {}

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
