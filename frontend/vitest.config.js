import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { jsxInJs } from "./jsx-in-js.js";

export default defineConfig({
  plugins: [jsxInJs(), react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
  },
});
