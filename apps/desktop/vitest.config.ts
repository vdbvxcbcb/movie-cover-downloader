import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    testTimeout: 30000, // 30 seconds for complex async tests
    include: [
      "src/**/*.{test,spec}.ts", // Include both .test.ts and .spec.ts files
      "src/**/__tests__/**/*.{test,spec}.ts", // Include __tests__ directories
    ],
    exclude: [
      // Node.js native test files (run via test:node script)
      "src/test/package-scripts.test.ts",
      "src/test/lib/**/*.test.ts",
      "src/test/components/queue/image-process/constants.test.ts",
      "src/test/components/queue/selected-photo-helpers.test.ts",
      // Migrated component tests (now in __tests__ directories)
      "src/test/components/queue/CreateTaskModal.test.ts",
      "src/test/components/queue/SelectedPhotoGrid.test.ts",
      "src/test/components/queue/SelectedPhotoPreviewModal.test.ts",
      "src/test/components/queue/SelectedPhotoCategoryTabs.test.ts",
      "src/test/components/queue/AutoDownloadStrategyPanel.test.ts",
      "src/test/components/chrome/AppTopbar.test.ts",
      // Standard exclusions
      "**/node_modules/**",
      "**/dist/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json"],
      include: [
        "src/stores/**/*.ts",
        "src/composables/**/*.ts",
        "src/components/**/*.vue",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/types/**",
        "**/node_modules/**",
        "**/dist/**",
      ],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
