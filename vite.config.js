import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const mathliveAssets = {
  name: 'mathlive-local-assets',
  buildStart() {
    mkdirSync(resolve('public/mathlive'), { recursive: true })
    cpSync(resolve('node_modules/mathlive/fonts'), resolve('public/mathlive/fonts'), { recursive: true })
  },
}

const isDesktopBuild = process.env.BUILD_DESKTOP_APP === 'true'
const desktopContentSecurityPolicy = {
  name: 'desktop-content-security-policy',
  transformIndexHtml(html) {
    if (!isDesktopBuild) return html
    const policy = "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'; frame-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob:; worker-src 'self' blob:"
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
  },
}

export default defineConfig({
  base: './',
  plugins: [mathliveAssets, tailwindcss(), react(), desktopContentSecurityPolicy],
  server: {
    watch: {
      ignored: [
        '**/release-desktop/**',
        '**/user-data/**',
        '**/artifacts/**',
        '**/build/**',
        '**/sandbox/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        headers: process.env.VIETLATEX_API_TOKEN ? { 'X-Vietlatex-Token': process.env.VIETLATEX_API_TOKEN } : {},
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        headers: process.env.VIETLATEX_API_TOKEN ? { 'X-Vietlatex-Token': process.env.VIETLATEX_API_TOKEN } : {},
      },
    },
  },
  build: {
    // MathLive is loaded only when the formula dialog opens; its 219 KB gzip bundle is intentionally kept lazy.
    chunkSizeWarningLimit: 850,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/, priority: 25 },
            { name: 'tiptap', test: /node_modules[\\/]@tiptap[\\/]/, priority: 20 },
            { name: 'prosemirror', test: /node_modules[\\/]prosemirror-[^\\/]+[\\/]/, priority: 15 },
            { name: 'mathlive', test: /node_modules[\\/]mathlive[\\/]/, priority: 10, maxSize: 450_000 },
          ],
        },
      },
    },
  },
})
