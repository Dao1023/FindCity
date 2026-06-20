import { defineConfig } from "vite";

export default defineConfig({
  root: "viz",
  base: "./",
  publicDir: "../out",
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
