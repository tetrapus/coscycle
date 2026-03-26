import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/coscycle/',
  plugins: [
    react(),
    VitePWA({ registerType: 'autoUpdate' })
  ],
})
