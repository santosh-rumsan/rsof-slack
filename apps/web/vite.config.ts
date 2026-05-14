import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [TanStackRouterVite(), react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: parseInt(env.WEB_PORT || "5173", 10),
      proxy: {
        "/api": {
          target: env.API_URL || "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
