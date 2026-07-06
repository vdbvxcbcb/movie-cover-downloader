// 打包脚本测试：确保安装包脚本会同时构建前端、sidecar 和 Tauri。
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("package scripts", () => {
  it("桌面端 dev 和 build 前会先自动构建 sidecar", async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageJsonPath = path.resolve(__dirname, "../../package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.predev).toBe("pnpm --dir ../sidecar build");
    expect(packageJson.scripts?.prebuild).toBe("pnpm --dir ../sidecar build && pnpm --dir ../.. prepare:sidecar-bundle");
    expect(packageJson.scripts?.test).toBe("vitest run");
    expect(packageJson.scripts?.["test:unit"]).toBe("vitest run");
  });
});
