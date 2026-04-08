import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@soratani-code/notification-sdk": path.resolve(__dirname, "../../src/index.ts")
    }
  },
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/api/common': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/api/backend': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    }
  }
});
