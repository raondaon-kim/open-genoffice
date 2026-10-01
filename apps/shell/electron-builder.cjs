/**
 * electron-builder configuration (moved out of package.json "build" so the
 * auto-update feed URL can be injected at build time instead of living in
 * the repo).
 *
 * OPEN_GENOFFICE_UPDATE_URL — Open GenOffice update-channel URL (the generic
 * provider prefix that serves latest.yml / latest-mac.yml). For local release
 * builds put it in apps/shell/electron-builder.env (gitignored) — the
 * electron-builder CLI loads that file automatically.
 *
 * When the variable is unset (forks, PR smoke builds, plain local packaging)
 * the publish config is omitted: electron-builder then bakes no
 * app-update.yml into the app and in-app auto-update stays disabled.
 */

const FORK_UPDATE_URL_ENV = 'OPEN_GENOFFICE_UPDATE_URL'

function normalizeForkUpdateUrl(value) {
  if (!value) return undefined

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${FORK_UPDATE_URL_ENV} must be a valid HTTPS URL`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${FORK_UPDATE_URL_ENV} must use HTTPS`)
  }

  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (hostname === 'genspark.ai' || hostname.endsWith('.genspark.ai')) {
    throw new Error(`${FORK_UPDATE_URL_ENV} must not point to a Genspark update feed`)
  }

  return value.replace(/\/+$/, '')
}

const updateUrl = normalizeForkUpdateUrl(process.env[FORK_UPDATE_URL_ENV])
const macIdentity = process.env.OPEN_GENOFFICE_MAC_IDENTITY?.trim() || null

// extraResources are copied verbatim rather than bundled, and electron-builder
// only warns when a source is missing. build/verify-extra-resources.js
// (beforePack) fails the build instead, for the sources of the platform being
// packaged: the module `out` trees, the built rhwp studio
// (tools/build-hwp-studio.mjs), the gsk CLI tree (its nested commander path
// depends on npm's current hoisting), and the native helpers — the sheets xlsx
// sidecar, the HwpForge platform binary (npm installs only the current
// platform's optional package) and the rhwp CLI (tools/fetch-rhwp-cli.mjs).
// Note: electron-builder also copies the ROOT package.json `dependencies` into
// app.asar. HwpForge used to ride along that way (@hwpforge/mcp at the root);
// it now ships explicitly here, so that dependency must stay in apps/hwp — at
// the root it would be packaged twice.

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.sergedoub.opengenoffice',
  productName: 'Open GenOffice',
  electronVersion: '41.7.1',
  directories: {
    output: 'release',
  },
  files: ['out/**'],
  extraResources: [
    {
      from: 'build/THIRD-PARTY-NOTICES.txt',
      to: 'THIRD-PARTY-NOTICES.txt',
    },
    {
      from: '../../node_modules/electron/dist/LICENSES.chromium.html',
      to: 'LICENSES.chromium.html',
    },
    {
      from: '../docs/out',
      to: 'modules/docs',
    },
    {
      from: '../sheets/out',
      to: 'modules/sheets',
    },
    {
      from: '../slides/out',
      to: 'modules/slides',
    },
    {
      from: '../pdf/out',
      to: 'modules/pdf',
    },
    {
      from: '../hwp/out',
      to: 'modules/hwp',
    },
    {
      from: '../hwp/dist/studio',
      to: 'modules/hwp-studio',
    },
    {
      from: '../../node_modules/@genspark/cli',
      to: 'gsk/node_modules/@genspark/cli',
    },
    {
      from: '../../node_modules/@genspark/cli/node_modules/commander',
      to: 'gsk/node_modules/commander',
    },
    {
      from: '../../node_modules/ws',
      to: 'gsk/node_modules/ws',
    },
  ],
  npmRebuild: false,
  mac: {
    target: ['dmg', 'zip'],
    artifactName: 'OpenGenOffice-${version}-${arch}.${ext}',
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    identity: macIdentity,
    notarize: macIdentity ? true : false,
    extraResources: [
      {
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar',
        to: 'native/xlsx-sidecar',
      },
      {
        from: '../../node_modules/@hwpforge/mcp-darwin-arm64/bin/hwpforge-mcp',
        to: 'native/hwpforge-mcp',
      },
      {
        from: '../hwp/native/rhwp/darwin-arm64/rhwp',
        to: 'native/rhwp',
      },
      {
        // tools/fetch-codex.mjs — the official Codex app-server (stdio JSON-RPC)
        from: 'native/codex/darwin-arm64/codex-app-server',
        to: 'native/codex-app-server',
      },
    ],
  },
  win: {
    artifactName: 'OpenGenOfficeSetup-v${version}-${arch}.${ext}',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    extraResources: [
      {
        // `native:build` uses the Windows runner's default MSVC target and
        // statically links the CRT (see xlsx-engine/.cargo/config.toml).
        from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar.exe',
        to: 'native/xlsx-sidecar.exe',
      },
      {
        from: '../../node_modules/@hwpforge/mcp-win32-x64/bin/hwpforge-mcp.exe',
        to: 'native/hwpforge-mcp.exe',
      },
      {
        from: '../hwp/native/rhwp/win32-x64/rhwp.exe',
        to: 'native/rhwp.exe',
      },
      {
        from: 'native/codex/win32-x64/codex-app-server.exe',
        to: 'native/codex-app-server.exe',
      },
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  dmg: {
    sign: Boolean(macIdentity),
  },
  beforePack: 'build/verify-extra-resources.js',
  afterSign: 'build/adhoc-sign.js',
  afterAllArtifactBuild: 'build/notarize-dmg.js',
}

if (updateUrl) {
  config.publish = [
    {
      provider: 'generic',
      url: updateUrl,
      channel: 'latest',
    },
  ]
}

module.exports = config
