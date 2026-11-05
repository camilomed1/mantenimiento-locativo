import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// In development the API runs on :3000; the proxy keeps everything same-origin
// (no CORS, and the token never leaves the page origin).
const proxy = {
  '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true },
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Mantenimiento Locativo',
        short_name: 'Mantenimiento',
        description: 'Registro de asistencia y evidencias sin conexión',
        lang: 'es-CO',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached so the app opens with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        // API calls are never cached by the service worker: offline data lives
        // in IndexedDB and the sync queue decides what to send.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'] },
});
