import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      // Server-only modules are tested directly in Node.
      "server-only": fileURLToPath(new URL("./apps/web/src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
  },
});
