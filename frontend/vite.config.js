import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["fonts/**/*", "assets/**/*"],
      workbox: {
        // Only precache essential small files - skip large assets
        globPatterns: ['**/*.{js,css,html,ico,woff,woff2}'],
        // Exclude large files from precaching
        globIgnores: ['**/*.wasm', '**/ort*.js', '**/ort*.mjs', '**/background.*', '**/*.mp4'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        // Runtime caching for images and fonts
        runtimeCaching: [
          {
            // Cache images with a Cache First strategy
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            // Cache fonts with a Cache First strategy
            urlPattern: /\.(?:woff|woff2|ttf|otf)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
              },
            },
          },
          {
            // Network First for API calls - try network, fall back to cache
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
        // Offline fallback - navigateFallback for SPA
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
          {
            src: "/assets/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/assets/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  // Exclude @imgly/background-removal from dep optimization - it uses web workers
  // that are incompatible with Vite's optimizer
  optimizeDeps: {
    exclude: ["@imgly/background-removal"],
  },
  // Build optimizations for production
  build: {
    // Generate source maps for production debugging (can be disabled for smaller builds)
    sourcemap: mode === 'development',
    // Chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    // Required for SharedArrayBuffer (needed by FFmpeg.wasm)
    // Using 'credentialless' for COEP to allow loading FFmpeg from unpkg CDN
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
}));
