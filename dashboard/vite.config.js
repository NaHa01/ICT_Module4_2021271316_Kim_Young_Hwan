import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api 요청을 backend(4000)로 프록시한다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
