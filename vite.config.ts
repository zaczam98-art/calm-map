import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // TensorFlow.js가 든 Measure 청크는 현장 측정 탭을 열 때만 내려받는 지연 로딩이라 경고 한도를 올려 둔다
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
