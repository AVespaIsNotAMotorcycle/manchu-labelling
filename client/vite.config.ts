import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // The Host header is kept so that the API's same-origin check sees the address the browser used.
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://localhost:3001", changeOrigin: false } },
  },
});
