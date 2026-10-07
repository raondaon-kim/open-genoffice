import { join } from 'node:path'

/**
 * Where the native helper binaries live. Mirrors
 * apps/sheets/src/main/sheets-main.ts resolveSidecarPath(): the shell injects
 * the path, an env var can override it, packaged builds carry each binary as an
 * extraResource under resources/native, and dev runs use the build-time
 * location — for HwpForge the platform package that `@hwpforge/mcp` pulls in
 * through optionalDependencies (never imported; declared in apps/hwp only to
 * install the binary), for the rhwp CLI apps/hwp/native/rhwp filled by
 * tools/fetch-rhwp-cli.mjs from the pinned upstream release.
 */
export type NativeBinaryName = 'hwpforge-mcp' | 'rhwp'

export interface NativeBinaryInput {
  runtimePath?: string
  envPath?: string
  isPackaged: boolean
  resourcesPath: string
  repoRoot: string
  platform: NodeJS.Platform
  arch: string
}

export function nativeExecutableName(name: NativeBinaryName, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${name}.exe` : name
}

function devPath(name: NativeBinaryName, input: NativeBinaryInput, exe: string): string {
  const target = `${input.platform}-${input.arch}`
  switch (name) {
    case 'hwpforge-mcp':
      return join(input.repoRoot, 'node_modules', '@hwpforge', `mcp-${target}`, 'bin', exe)
    case 'rhwp':
      return join(input.repoRoot, 'apps', 'hwp', 'native', 'rhwp', target, exe)
  }
}

export function resolveNativeBinary(name: NativeBinaryName, input: NativeBinaryInput): string {
  const exe = nativeExecutableName(name, input.platform)
  if (input.runtimePath) return input.runtimePath
  if (input.envPath) return input.envPath
  if (input.isPackaged) return join(input.resourcesPath, 'native', exe)
  return devPath(name, input, exe)
}
