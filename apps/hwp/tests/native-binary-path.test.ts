/** @vitest-environment node */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nativeExecutableName, resolveNativeBinary } from '../src/main/native-binary-path'

const base = {
  isPackaged: false,
  resourcesPath: join('C:', 'app', 'resources'),
  repoRoot: join('D:', 'genoffice'),
  platform: 'win32' as NodeJS.Platform,
  arch: 'x64',
}

describe('nativeExecutableName', () => {
  it('adds .exe on win32 only', () => {
    expect(nativeExecutableName('hwpforge-mcp', 'win32')).toBe('hwpforge-mcp.exe')
    expect(nativeExecutableName('hwpforge-mcp', 'darwin')).toBe('hwpforge-mcp')
    expect(nativeExecutableName('rhwp', 'win32')).toBe('rhwp.exe')
    expect(nativeExecutableName('rhwp', 'linux')).toBe('rhwp')
  })
})

describe('resolveNativeBinary', () => {
  it('prefers the runtime-injected path over everything', () => {
    expect(
      resolveNativeBinary('hwpforge-mcp', {
        ...base,
        runtimePath: 'R',
        envPath: 'E',
        isPackaged: true,
      }),
    ).toBe('R')
  })
  it('falls back to the environment override', () => {
    expect(resolveNativeBinary('rhwp', { ...base, envPath: 'E', isPackaged: true })).toBe('E')
  })
  it('uses resources/native in packaged builds', () => {
    expect(resolveNativeBinary('hwpforge-mcp', { ...base, isPackaged: true })).toBe(
      join(base.resourcesPath, 'native', 'hwpforge-mcp.exe'),
    )
    expect(resolveNativeBinary('rhwp', { ...base, isPackaged: true, platform: 'darwin' })).toBe(
      join(base.resourcesPath, 'native', 'rhwp'),
    )
  })
  it('uses the hoisted platform package for HwpForge in dev', () => {
    expect(resolveNativeBinary('hwpforge-mcp', base)).toBe(
      join(base.repoRoot, 'node_modules', '@hwpforge', 'mcp-win32-x64', 'bin', 'hwpforge-mcp.exe'),
    )
    expect(
      resolveNativeBinary('hwpforge-mcp', { ...base, platform: 'darwin', arch: 'arm64' }),
    ).toBe(
      join(base.repoRoot, 'node_modules', '@hwpforge', 'mcp-darwin-arm64', 'bin', 'hwpforge-mcp'),
    )
  })
  it('uses apps/hwp/native/rhwp for the rhwp CLI in dev', () => {
    expect(resolveNativeBinary('rhwp', base)).toBe(
      join(base.repoRoot, 'apps', 'hwp', 'native', 'rhwp', 'win32-x64', 'rhwp.exe'),
    )
    expect(resolveNativeBinary('rhwp', { ...base, platform: 'darwin', arch: 'arm64' })).toBe(
      join(base.repoRoot, 'apps', 'hwp', 'native', 'rhwp', 'darwin-arm64', 'rhwp'),
    )
  })
  it('ignores empty strings for runtime and env overrides', () => {
    expect(
      resolveNativeBinary('rhwp', { ...base, runtimePath: '', envPath: '', isPackaged: true }),
    ).toBe(join(base.resourcesPath, 'native', 'rhwp.exe'))
  })
})
