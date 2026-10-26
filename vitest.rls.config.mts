import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["tests/rls/**/*.test.ts"], environment: "node", fileParallelism: false, testTimeout: 30000, hookTimeout: 60000 },
});
