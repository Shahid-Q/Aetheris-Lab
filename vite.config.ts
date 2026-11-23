import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api/": "http://127.0.0.1:8787" },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ["motion/react"],
          validation: ["zod"],
          material: [
            "@mui/material/Button",
            "@mui/material/Dialog",
            "@mui/material/TextField",
            "@mui/material/Chip",
            "@mui/material/styles",
          ],
        },
      },
    },
  },
});
