import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Mirrors `vite.config.ts`: the constant is a build-time substitution, so
    // anything importing `constants/version` throws under test without it.
    __APP_VERSION__: JSON.stringify(
      process.env.APP_VERSION ?? process.env.npm_package_version ?? "0.0.0-dev",
    ),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/renderer/src"),
      "@/styled": resolve(__dirname, "src/renderer/src/styled"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/renderer/src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
