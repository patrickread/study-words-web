import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative paths so the built quiz works in a GitHub Pages subfolder.
  base: "./",
  server: {
    port: 5173,
  },
});
