import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["src/test/**/*.test.ts"],
    exclude: [
      "src/test/package-scripts.test.ts",
      "src/test/lib/**/*.test.ts",
      "src/test/stores/**/*.test.ts",
      "src/test/components/queue/image-process/constants.test.ts",
      "src/test/components/queue/selected-photo-helpers.test.ts",
    ],
  },
});
