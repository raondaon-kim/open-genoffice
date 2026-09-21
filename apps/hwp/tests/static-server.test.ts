/** @vitest-environment node */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createStaticServer,
  matchRoot,
  mimeFor,
  resolveFile,
  type StaticRoot,
  type StaticServer,
} from '../src/main/static-server'

let base: string
let renderer: string
let studio: string
let outside: string
let roots: StaticRoot[]
let server: StaticServer
const WASM_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hwp-static-'))
  renderer = join(base, 'renderer')
  studio = join(base, 'studio')
  outside = join(base, 'outside')
  await mkdir(join(renderer, 'assets'), { recursive: true })
  await mkdir(join(studio, 'assets'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(renderer, 'index.html'), 'RENDERER')
  await writeFile(join(renderer, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(studio, 'index.html'), 'STUDIO')
  await writeFile(join(studio, 'rhwp_bg.wasm'), WASM_BYTES)
  await writeFile(join(studio, 'assets', 'x.js'), 'x')
  await writeFile(join(outside, 'secret.txt'), 'SECRET')
  // '/' listed first on purpose: matching must pick the longest prefix, not the first
  roots = [
    { prefix: '/', dir: renderer, spaFallback: true },
    { prefix: '/rhwp/', dir: studio, spaFallback: false },
  ]
  server = await createStaticServer({ roots })
})

afterAll(async () => {
  await server.close()
  await rm(base, { recursive: true, force: true })
})

const get = (path: string, init?: RequestInit) => fetch(`${server.origin}${path}`, init)

describe('matchRoot', () => {
  it('picks the longest matching prefix', () => {
    expect(matchRoot(roots, '/rhwp/index.html')?.dir).toBe(studio)
    expect(matchRoot(roots, '/index.html')?.dir).toBe(renderer)
  })
  it('does not treat /rhwpx as the studio prefix', () => {
    expect(matchRoot(roots, '/rhwpx/y')?.dir).toBe(renderer)
  })
})

describe('resolveFile', () => {
  it('serves index.html for a directory request', () => {
    expect(resolveFile(roots[1], '/rhwp/')).toEqual({ kind: 'file', path: join(studio, 'index.html') })
  })
  it('reports missing files under a root without SPA fallback', () => {
    expect(resolveFile(roots[1], '/rhwp/nope.js')).toEqual({ kind: 'missing' })
  })
  it('falls back to index.html under a root with SPA fallback', () => {
    expect(resolveFile(roots[0], '/some/client/route')).toEqual({
      kind: 'file',
      path: join(renderer, 'index.html'),
    })
  })
  it('never resolves to a file outside the root', () => {
    // absolute path (forbidden on Windows drive letters, stripped to a miss on POSIX)
    expect(resolveFile(roots[1], `/rhwp/${join(outside, 'secret.txt')}`).kind).not.toBe('file')
    // dot segments are stripped, so the path stays inside the root
    expect(resolveFile(roots[1], '/rhwp/../../outside/secret.txt').kind).not.toBe('file')
  })
})

describe('mimeFor', () => {
  it('knows wasm, fonts and falls back to octet-stream', () => {
    expect(mimeFor('/a/rhwp_bg.wasm')).toBe('application/wasm')
    expect(mimeFor('/a/f.woff2')).toBe('font/woff2')
    expect(mimeFor('/a/f.otf')).toBe('font/otf')
    expect(mimeFor('/a/unknown.bin')).toBe('application/octet-stream')
  })
})

describe('createStaticServer', () => {
  it('listens on a loopback http origin', () => {
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
  it('serves each root under its prefix', async () => {
    expect(await (await get('/index.html')).text()).toBe('RENDERER')
    expect(await (await get('/rhwp/index.html')).text()).toBe('STUDIO')
    expect(await (await get('/rhwp/')).text()).toBe('STUDIO')
    expect(await (await get('/assets/app.js')).text()).toBe('console.log(1)')
  })
  it('serves wasm with the application/wasm type and no-store', async () => {
    const res = await get('/rhwp/rhwp_bg.wasm')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WASM_BYTES)
  })
  it('returns 404 for missing studio files instead of index.html', async () => {
    expect((await get('/rhwp/does-not-exist.js')).status).toBe(404)
  })
  it('falls back to index.html for unknown renderer routes', async () => {
    const res = await get('/some/client/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('RENDERER')
  })
  it('rejects non-GET methods', async () => {
    expect((await get('/index.html', { method: 'POST' })).status).toBe(405)
  })
  it('answers HEAD with headers only', async () => {
    const res = await get('/rhwp/index.html', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
  it('never serves files outside a root', async () => {
    // Encoded separators and absolute paths reach the server verbatim and must
    // be refused there. Plain dot segments are collapsed by the URL parser
    // before the request leaves the client, so that form only proves the body.
    for (const path of [
      '/rhwp/..%2F..%2Foutside%2Fsecret.txt',
      `/rhwp/${encodeURIComponent(join(outside, 'secret.txt'))}`,
    ]) {
      const res = await get(path)
      expect([403, 404]).toContain(res.status)
      expect(await res.text()).not.toBe('SECRET')
    }
    const collapsed = await get('/rhwp/../../outside/secret.txt')
    expect(await collapsed.text()).not.toBe('SECRET')
  })
  it('returns 400 on malformed percent-encoding', async () => {
    expect((await get('/rhwp/%E0%A4%A')).status).toBe(400)
  })
})
