import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/client"),
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3099",
        changeOrigin: true,
      },
      "/oauth": {
        target: "http://localhost:3099",
        changeOrigin: true,
      },
    },
  },
});