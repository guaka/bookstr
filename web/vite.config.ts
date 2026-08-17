import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// Project Pages: BASE_PATH=/bookstr/ · custom domain (books.guaka.org): BASE_PATH=/
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    fs: { allow: [path.resolve(rootDir, '..')] },
  },
  publicDir: 'public',
})
