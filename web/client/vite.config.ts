import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Hockey Coach',
        short_name: 'Hockey Coach',
        description: 'Video analysis and event tagging for hockey coaching',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1923',
        theme_color: '#1565c0',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only cache the app shell -- never cache videos (they are streamed)
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Bump this version whenever you need to force all devices to drop
        // their old caches and install the new service worker immediately.
        // Combined with skipWaiting + clientsClaim below, a normal page reload
        // is enough -- no manual "clear site data" or app reinstall needed.
        cacheId: 'hockey-coach-v2',
        // Take over immediately on update so a fresh reload gets the new SW.
        // Without these, the updated SW stays in "waiting" state until every
        // tab is closed -- meaning an old SW with broken video caching can
        // keep running even after the user refreshes.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Video files: explicit NetworkOnly so the service worker NEVER
            // caches or buffers video bytes. HTTP Range requests (byte-range
            // seeking) must reach the Express server directly with their Range
            // header intact. Caching would break seeking on large MP4 files.
            urlPattern: /^\/videos\//,
            handler: 'NetworkOnly',
          },
          {
            // API responses: network-first
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'hockey-coach-v2-api',
              networkTimeoutSeconds: 10,
            },
          },
        ],
        // Never serve /index.html as the navigation fallback for video or API paths
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/videos\//, /^\/api\//],
      },
      devOptions: {
        // Enable PWA in dev mode so service worker registers for testing
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      'hockey-coach.dev.rockitwebhosting.net',
      'moore.tailc24dca.ts.net',
    ],
    proxy: {
      '/api': {
        target: 'http://app:4321',
        changeOrigin: true,
      },
      '/videos': {
        target: 'http://app:4321',
        changeOrigin: true,
      },
    },
  },
});
