import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En développement, l'API locale tourne sur 8765 (python backend/run.py --no-window).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
});
