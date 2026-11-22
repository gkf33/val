import { defineConfig } from "vitest/config";
import path from "node:path";

// Integrationstests gegen eine echte Postgres-DB (TEST_DATABASE_URL).
// Die DB wird vor dem Lauf komplett zurückgesetzt.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/globalSetup.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
  },
});
