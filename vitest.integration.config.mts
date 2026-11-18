import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Cross-role integration tests (Member 4): they call the real data-access layer
// against a throwaway PostgreSQL database. See tests/integration/setup.ts.
//
//   TEST_DATABASE_URL=postgresql://snowber:snowber@localhost:5432/snowber_test npm run test:integration

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/integration/setup.ts"],
    // One shared database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The DAL is server-only; in tests it runs in plain Node.
      "server-only": fileURLToPath(new URL("./tests/integration/server-only.ts", import.meta.url)),
    },
  },
});
