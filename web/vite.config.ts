import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

export default defineConfig({
  root: path.resolve("web"),
  plugins: [solid()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      // Preserve dev browser Origin checks while proxying to the Bun API.
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
});
