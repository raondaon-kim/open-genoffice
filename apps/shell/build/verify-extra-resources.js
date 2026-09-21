// electron-builder beforePack hook: extraResources are copied verbatim rather
// than bundled, and electron-builder only *warns* when a source is missing
// (fileMatcher: "file source doesn't exist"), so a module that was never built,
// a studio that was never generated or a native binary that npm did not
// install would ship as a silently broken installer. Fail the build instead,
// for exactly the sources the platform being packaged will copy.
//
// Kept out of electron-builder.cjs's top level on purpose: that module is also
// required outside packaging (tests, tools/gen-third-party-notices.mjs), on
// machines and platforms where nothing is built.
const { existsSync, readdirSync, statSync } = require('node:fs')
const { resolve } = require('node:path')

/** electron-builder's `electronPlatformName` → the config key holding that platform's options */
const PLATFORM_KEYS = { darwin: 'mac', win32: 'win', linux: 'linux' }

/** electron-builder expands these itself; there is no single path to check */
const GLOB_CHARS = /[*?{[]/

/**
 * @param {import('electron-builder').Configuration} config
 * @param {string} electronPlatformName  'darwin' | 'win32' | 'linux'
 * @param {string} baseDir  the directory relative `from` paths resolve against
 *   (electron-builder's project directory — where electron-builder.cjs lives)
 */
function verifyExtraResources(config, electronPlatformName, baseDir) {
  const platformKey = PLATFORM_KEYS[electronPlatformName]
  const platformOptions = platformKey ? config[platformKey] : undefined
  const entries = [
    ...(config.extraResources ?? []),
    ...((platformOptions && platformOptions.extraResources) || []),
  ]

  const missing = []
  for (const entry of entries) {
    const from = typeof entry === 'string' ? entry : entry.from
    if (!from || GLOB_CHARS.test(from)) continue
    const path = resolve(baseDir, from)
    if (!existsSync(path)) {
      missing.push(`${from} (not found: ${path})`)
    } else if (statSync(path).isDirectory() && readdirSync(path).length === 0) {
      missing.push(`${from} (empty directory)`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `electron-builder extraResources source missing for ${electronPlatformName}:\n` +
        missing.map((line) => `  - ${line}`).join('\n') +
        '\nBuild the modules first (npm run build:all, which includes the HWP studio ' +
        'and the rhwp CLI), or run npm ci if a node_modules path is missing.',
    )
  }
}

/** electron-builder `beforePack` entry point (context.packager.config is the resolved configuration) */
exports.default = function (context) {
  verifyExtraResources(
    context.packager.config,
    context.electronPlatformName,
    context.packager.projectDir,
  )
}

exports.verifyExtraResources = verifyExtraResources
