import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  // @genoffice/i18n, @genoffice/electron-utils and @genoffice/doc-styles ship as TS source — must be bundled
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@genoffice/i18n',
          '@genoffice/electron-utils',
          '@genoffice/doc-styles',
          '@genoffice/file-parse',
        ],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@genoffice/i18n', '@genoffice/electron-utils'] })],
  },
  renderer: {
    server: {
      port: Number(process.env.HWP_DEV_PORT) || 5179,
      strictPort: Boolean(process.env.HWP_DEV_PORT),
    },
  },
})
