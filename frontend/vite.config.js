import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 5173,
    allowedHosts: true, // ngrok manzillari uchun
    // Ishlab chiqish paytida API so'rovlari backend'ga (Docker'da 8001-port) yo'naltiriladi
    proxy: { '/api': 'http://localhost:8001' },
  },
});
