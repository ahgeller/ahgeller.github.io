import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

// Plugin to copy DuckDB WASM files from node_modules to public folder
const copyDuckDBFiles = () => {
  return {
    name: 'copy-duckdb-files',
    buildStart() {
      const publicDir = path.resolve(__dirname, 'public');
      const duckdbDir = path.resolve(__dirname, 'node_modules/@duckdb/duckdb-wasm/dist');
      
      if (!existsSync(publicDir)) {
        mkdirSync(publicDir, { recursive: true });
      }
      
      const files = [
        'duckdb-eh.wasm',
        'duckdb-browser-eh.worker.js'
      ];
      
      files.forEach(file => {
        const src = path.join(duckdbDir, file);
        const dest = path.join(publicDir, file);
        if (existsSync(src)) {
          try {
            copyFileSync(src, dest);
            console.log(`✅ Copied ${file} to public folder`);
          } catch (err) {
            console.warn(`⚠️ Failed to copy ${file}:`, err);
          }
        } else {
          console.warn(`⚠️ File not found: ${src}`);
        }
      });
    }
  };
};

// https://vitejs.dev/config/
// For GitHub Pages root domain (username.github.io), use base: '/'
// For subpath (username.github.io/VolleyBall/), change to base: '/VolleyBall/'
export default defineConfig({
  base: '/', // Change to '/VolleyBall/' if using a subpath
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), copyDuckDBFiles()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
  },
  worker: {
    format: "es",
  },
  assetsInclude: ["**/*.wasm"],
});

