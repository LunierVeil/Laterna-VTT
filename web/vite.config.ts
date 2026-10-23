import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Локально - localhost, в compose - http://server:8000
  const target = env.VITE_API_TARGET || "http://localhost:8000";
  const wsTarget = target.replace(/^http/, "ws");

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/ws": { target: wsTarget, ws: true },
      },
    },
  };
});
