import { defineConfig, loadEnv } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const enableCrossOriginIsolation = env.VITE_CROSS_ORIGIN_ISOLATION !== "false";
  
  // This variable is now correctly used in the return object
  const crossOriginHeaders = enableCrossOriginIsolation
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless", // Use credentialless to allow Razorpay
      }
    : {};

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
          globIgnores: ['**/*.wasm', '**/ort*.js', '**/ort*.mjs', '**/background.*', '**/*.mp4'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
              },
            },
            {
              urlPattern: /\.(?:woff|woff2|ttf|otf)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'fonts-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 },
              },
            },
          ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
        },
        manifest: {
          name: "Wedding Invite Generator",
          short_name: "WedInvite",
          description: "Generate beautiful Marwadi wedding invitations",
          theme_color: "#8B0000",
          background_color: "#FFF8DC",
          display: "standalone",
          orientation: "portrait",
          icons: [
            { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
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
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
          },
        },
      },
    },
    server: {
      headers: crossOriginHeaders, // Cleanly using the variable defined above
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    preview: {
      headers: crossOriginHeaders, // Applied to preview server as well
    },
  }; // <--- Fixed: Added the missing closing brace for the return object
}); // <--- Fixed: Properly closing the defineConfig function
