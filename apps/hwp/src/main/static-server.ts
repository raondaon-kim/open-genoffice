import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, normalize, resolve, sep } from 'node:path'

/**
 * Loopback static file server shared by the hwp renderer (production) and the
 * bundled rhwp studio (always). The studio SDK rejects opaque origins
 * (file:/data:), so both are served over one http://127.0.0.1:<port> origin.
 * No Electron imports: this module is unit-tested under plain Node.
 */

export interface StaticRoot {
  /** URL prefix; must start and end with '/' — e.g. '/rhwp/' or '/' */
  prefix: string
  /** absolute directory served under prefix */
  dir: string
  /** serve dir/index.html for paths that do not exist (SPA); false → 404 */
  spaFallback: boolean
}

export interface StaticServer {
  origin: string
  close(): Promise<void>
}

export type Resolution =
  | { kind: 'file'; path: string }
  | { kind: 'forbidden' }
  | { kind: 'missing' }

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

export function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Pick the root with the longest matching prefix; null when none matches. */
export function matchRoot(roots: StaticRoot[], urlPath: string): StaticRoot | null {
  let best: StaticRoot | null = null
  for (const root of roots) {
    if (!urlPath.startsWith(root.prefix)) continue
    if (!best || root.prefix.length > best.prefix.length) best = root
  }
  return best
}

/**
 * Map a URL path to a file inside root.dir. Leading separators and '..'
 * segments are stripped and the resolved path must stay inside the root;
 * anything else is 'forbidden'. Directories resolve to their index.html.
 */
export function resolveFile(root: StaticRoot, urlPath: string): Resolution {
  const relative = normalize(urlPath.slice(root.prefix.length)).replace(/^([/\\]|\.\.)+/, '')
  const dir = resolve(root.dir)
  let filePath = resolve(dir, relative)
  if (filePath !== dir && !filePath.startsWith(dir + sep)) return { kind: 'forbidden' }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html')
  }
  if (existsSync(filePath) && statSync(filePath).isFile()) return { kind: 'file', path: filePath }
  if (root.spaFallback) {
    const index = join(dir, 'index.html')
    if (existsSync(index)) return { kind: 'file', path: index }
  }
  return { kind: 'missing' }
}

export function createStaticServer(opts: { roots: StaticRoot[] }): Promise<StaticServer> {
  const { roots } = opts
  return new Promise<StaticServer>((resolveServer, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end()
        return
      }
      let urlPath: string
      try {
        urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      } catch {
        res.writeHead(400).end()
        return
      }
      const root = matchRoot(roots, urlPath)
      if (!root) {
        res.writeHead(404).end()
        return
      }
      const resolution = resolveFile(root, urlPath)
      if (resolution.kind === 'forbidden') {
        res.writeHead(403).end()
        return
      }
      if (resolution.kind === 'missing') {
        res.writeHead(404).end()
        return
      }
      const target = resolution.path
      void readFile(target)
        .then((bytes) => {
          res.writeHead(200, {
            'content-type': mimeFor(target),
            'content-length': bytes.byteLength,
            'cache-control': 'no-store',
          })
          res.end(req.method === 'HEAD' ? undefined : bytes)
        })
        .catch(() => res.writeHead(404).end())
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      })
    })
  })
}
