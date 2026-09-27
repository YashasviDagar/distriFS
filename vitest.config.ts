import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@distrifs/shared": resolve("./packages/shared/src/index.ts"),
      "@distrifs/chunker": resolve("./packages/chunker/src/index.ts"),
      "@distrifs/db": resolve("./packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
