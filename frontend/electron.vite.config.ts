import { resolve } from "node:path";
/**
 * Electron-vite config for building the desktop app.
 * Used by the `dev`, `build`, and `build:*` scripts.
 *
 * Configures all three Electron processes: main, preload, and renderer.
 * `envDir` is set explicitly so `.env` files are resolved from the project root.
 */
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    envDir: resolve("."),
    define: {
      // Single source of truth for the app version: the git tag, threaded in as
      // APP_VERSION by CI. Falls back to package.json for local builds.
      __APP_VERSION__: JSON.stringify(
        process.env.APP_VERSION ??
          process.env.npm_package_version ??
          "0.0.0-dev",
      ),
    },
    // Use relative asset URLs so the renderer works under the file:// protocol
    // when the app is packaged. The standalone web build (vite.config.ts)
    // keeps the default base of "/".
    base: "./",
    server: {
      port: Number(process.env.PORT) || 3000,
    },
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": resolve("src/renderer/src"),
      },
    },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routeFileIgnorePattern: "\\.test\\.tsx$",
      }),
      react(),
    ],
  },
});
