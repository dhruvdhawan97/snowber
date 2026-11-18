import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Database tests run separately: npm run test:integration (vitest.integration.config.mts).
    exclude: ["tests/integration/**", "**/node_modules/**"],
    environment: "node",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
