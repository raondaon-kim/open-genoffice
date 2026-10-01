/**
 * Pinned official Codex app-server release assets (openai/codex, Apache-2.0)
 * for tools/fetch-codex.mjs. Every platform CI or packaging runs on needs an
 * entry (apps/shell/tests/codex-assets.test.ts). Bump CODEX_VERSION and every
 * digest together; digests come from the GitHub release API (`assets[].digest`).
 */
export const CODEX_VERSION = '0.159.3'

export const CODEX_ASSETS = {
  'win32-x64': {
    file: 'codex-app-server-x86_64-pc-windows-msvc.exe.zip',
    sha256: 'abfb74a8765c870674a3ea94b873b861b041dc6e3963f7433cb5b66c300abd64',
    exe: 'codex-app-server.exe',
  },
  'darwin-arm64': {
    file: 'codex-app-server-aarch64-apple-darwin.tar.gz',
    sha256: '40edf61c2c6b3429541e010409f6934c29327b4d3b03df5265cbf21b35ddbc83',
    exe: 'codex-app-server',
  },
  'darwin-x64': {
    file: 'codex-app-server-x86_64-apple-darwin.tar.gz',
    sha256: 'aa723f184f50d2502820fb89bc70a8dc1f7c92d894dd3f13d27684916ca52049',
    exe: 'codex-app-server',
  },
  // CI (ubuntu-latest) runs the fetch; Linux is not packaged, but the binary
  // backs the contract test there.
  'linux-x64': {
    file: 'codex-app-server-x86_64-unknown-linux-musl.tar.gz',
    sha256: '1d782ebee6bc65a211bf4ed87702c037d5481e145fe76cb1b07e41cf612338b8',
    exe: 'codex-app-server',
  },
  'linux-arm64': {
    file: 'codex-app-server-aarch64-unknown-linux-musl.tar.gz',
    sha256: '3c94ff57ced652c30cc850dedfd7924645c96e0ffa16e2771e8b286412af9a7a',
    exe: 'codex-app-server',
  },
}
