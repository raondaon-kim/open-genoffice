// Copied next to upstream's vite.config.ts by tools/build-hwp-studio.mjs.
// Reuses the upstream Vite config but drops vite-plugin-pwa: the studio is
// served from a loopback origin whose port changes on every launch, so a
// service worker would only accumulate registrations and WASM caches in
// userData.
// The explicit .ts extension keeps Vite's native config loader quiet.
import base from './vite.config.ts'

type PluginLike = { name?: unknown } | null | undefined | false

const flatten = (items: unknown[]): PluginLike[] =>
  items.flatMap((item) => (Array.isArray(item) ? flatten(item) : [item as PluginLike]))

const isPwa = (plugin: PluginLike): boolean =>
  Boolean(
    plugin &&
    typeof plugin === 'object' &&
    typeof plugin.name === 'string' &&
    plugin.name.startsWith('vite-plugin-pwa'),
  )

const config = base as { plugins?: unknown[] }

export default {
  ...config,
  plugins: flatten(config.plugins ?? []).filter((plugin) => !isPwa(plugin)),
}
