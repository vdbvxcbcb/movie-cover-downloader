import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("桌面端 dev 和 build 前会先自动构建 sidecar", async () => {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.predev, "pnpm --dir ../sidecar build");
  assert.equal(packageJson.scripts?.prebuild, "pnpm --dir ../sidecar build");
});
