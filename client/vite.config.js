import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/summary': 'http://127.0.0.1:3000',
      '/logs': 'http://127.0.0.1:3000',
    },
  },
})
