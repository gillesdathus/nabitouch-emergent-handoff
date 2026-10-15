import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { clientEnvDefines } from "./src/lib/client-env.js";
import { jsxInJs } from "./jsx-in-js.js";

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const env = { ...fileEnv, ...process.env };
  const proxyTarget = env.DEV_API_PROXY || "http://127.0.0.1:8001";
  return {
    plugins: [jsxInJs(), react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    define: clientEnvDefines(env, { mode }),
    envPrefix: ["REACT_APP_"],
    build: {
      outDir: "build",
      emptyOutDir: true,
      sourcemap: false,
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: { ".js": "jsx" },
      },
    },
    server: {
      port: Number(env.PORT) || 3025,
      host: env.HOST || "localhost",
      allowedHosts: true,
      hmr: env.PORT ? { clientPort: 443, protocol: "wss" } : undefined,
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
      },
    },
  };
});
