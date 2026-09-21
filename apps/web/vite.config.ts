import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api': { target: 'http://localhost:3000', rewrite: (p: string) => p.replace(/^\/api/, '') },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` sirve la versión compilada (con service worker) para probar el modo sin conexión.
  preview: { port: 4173, proxy },
});
