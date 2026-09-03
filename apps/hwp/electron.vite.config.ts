import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@genoffice/i18n'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@genoffice/i18n'] })],
  },
  renderer: {
    server: {
      port: Number(process.env.HWP_DEV_PORT) || 5177,
      strictPort: Boolean(process.env.HWP_DEV_PORT),
    },
  },
})
