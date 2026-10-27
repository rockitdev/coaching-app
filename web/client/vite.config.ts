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
        runtimeCaching: [
          {
            // API responses: network-first
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
            },
          },
        ],
        // Never precache or runtime-cache video files
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
