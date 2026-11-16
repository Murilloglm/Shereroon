import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base` relativo funciona em qualquer endereço (GitHub Pages de projeto, domínio próprio,
// auto-hospedagem), porque as rotas ficam no hash (#/sala/...). O workflow do GitHub Pages
// passa VITE_BASE com o caminho exato do repositório.
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // ws: o canal de tempo real dos grupos (/api/gateway) passa pelo mesmo caminho.
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
