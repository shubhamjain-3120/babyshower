import { defineConfig, loadEnv } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["fonts/**/*", "assets/**/*"],
        workbox: {
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,html,ico,woff,woff2}'],
          navigateFallback: '/index.html',
        },
        manifest: {
          name: "Wedding Invite Generator",
          short_name: "WedInvite",
          display: "standalone",
          theme_color: "#8B0000",
          background_color: "#FFF8DC",
        },
      }),
    ],
    optimizeDeps: {
      exclude: ["@imgly/background-removal"],
    },
    build: {
      sourcemap: mode === 'development',
      rollupOptions: {
        input: {
          main: path.resolve(process.cwd(), "index.html"),
        },
      },
    },
    server: {
      // REMOVED crossOriginHeaders to fix the ReferenceError and Razorpay block
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
