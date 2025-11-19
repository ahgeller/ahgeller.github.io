import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
// For GitHub Pages root domain (username.github.io), use base: '/'
// For subpath (username.github.io/VolleyBall/), change to base: '/VolleyBall/'
export default defineConfig({
  base: '/', // Change to '/VolleyBall/' if using a subpath
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

