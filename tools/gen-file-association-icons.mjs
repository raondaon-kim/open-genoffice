/**
 * Generates the per-file-type document icons that electron-builder bakes into
 * the OS file associations (apps/shell/electron-builder.cjs fileAssociations
 * `icon` field): <type>.icns for the macOS CFBundleDocumentTypes entry and
 * <type>.ico for the NSIS DefaultIcon registry value.
 *
 * Source of truth is the shell renderer's file-type tiles
 * (apps/shell/src/renderer/src/assets/file-*.svg) so Finder/Explorer show the
 * same visual language as the in-app recent-files list. The SVGs are
 * rasterized with the system Chrome via Playwright (transparent background),
 * then packed with `iconutil` (icns, on a macOS host; elsewhere a hand-rolled
 * PNG-entry ICNS container) and a hand-rolled PNG-entry ICO container.
 *
 * Regenerate after changing any file-*.svg:
 *   node tools/gen-file-association-icons.mjs [type ...]
 * With type names (e.g. `hwp`) only those icons are rewritten.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgDir = join(root, 'apps/shell/src/renderer/src/assets')
const outDir = join(root, 'apps/shell/build')

// One icon per visual type; associations for xlsm/xls/csv/markdown reuse
// these via the fileAssociations `icon` field.
const TYPES = {
  docx: 'file-docx.svg',
  xlsx: 'file-xlsx.svg',
  pptx: 'file-pptx.svg',
  pdf: 'file-pdf.svg',
  md: 'file-md.svg',
  html: 'file-html.svg',
  hwp: 'file-hwp.svg',
}

// macOS icons carry the standard app-icon grid margin (824/1024 content, same
// treatment as build/icon-mac.png) so they sit at the same optical size as
// neighboring icons in Finder. Windows icons are conventionally full-bleed.
const MAC_CONTENT_RATIO = 824 / 1024
// canvas px -> .iconset entry names (16..1024 covers all @1x/@2x slots below)
const MAC_CANVAS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
// [.iconset entry name, canvas px, ICNS OSType of the same slot]
const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16, 'icp4'],
  ['icon_16x16@2x.png', 32, 'ic11'],
  ['icon_32x32.png', 32, 'icp5'],
  ['icon_32x32@2x.png', 64, 'ic12'],
  ['icon_128x128.png', 128, 'ic07'],
  ['icon_128x128@2x.png', 256, 'ic13'],
  ['icon_256x256.png', 256, 'ic08'],
  ['icon_256x256@2x.png', 512, 'ic14'],
  ['icon_512x512.png', 512, 'ic09'],
  ['icon_512x512@2x.png', 1024, 'ic10'],
]
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** ICO container with PNG-compressed entries (supported since Vista). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o) // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

/** ICNS container with PNG entries (what iconutil writes for these slots). */
function buildIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

async function renderPng(page, svgDataUrl, canvasSize, contentSize) {
  await page.setViewportSize({ width: canvasSize, height: canvasSize })
  await page.setContent(
    `<body style="margin:0"><div style="width:${canvasSize}px;height:${canvasSize}px;display:flex;align-items:center;justify-content:center">` +
      `<img src="${svgDataUrl}" style="width:${contentSize}px;height:${contentSize}px"></div></body>`,
  )
  return page.screenshot({ omitBackground: true })
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const tmp = mkdtempSync(join(tmpdir(), 'genoffice-file-icons-'))

try {
  const only = process.argv.slice(2)
  for (const name of only) if (!TYPES[name]) throw new Error(`unknown icon type: ${name}`)
  for (const [type, svgName] of Object.entries(TYPES)) {
    if (only.length > 0 && !only.includes(type)) continue
    const svg = readFileSync(join(svgDir, svgName))
    const dataUrl = `data:image/svg+xml;base64,${svg.toString('base64')}`

    const macPngs = new Map()
    for (const size of MAC_CANVAS_SIZES) {
      macPngs.set(size, await renderPng(page, dataUrl, size, Math.round(size * MAC_CONTENT_RATIO)))
    }
    if (process.platform === 'darwin') {
      const iconset = join(tmp, `${type}.iconset`)
      mkdirSync(iconset, { recursive: true })
      for (const [name, size] of ICONSET_ENTRIES) {
        writeFileSync(join(iconset, name), macPngs.get(size))
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(outDir, `${type}.icns`)])
    } else {
      const icns = ICONSET_ENTRIES.map(([, size, osType]) => ({
        type: osType,
        png: macPngs.get(size),
      }))
      writeFileSync(join(outDir, `${type}.icns`), buildIcns(icns))
    }

    const winEntries = []
    for (const size of WIN_SIZES) {
      winEntries.push({ size, png: await renderPng(page, dataUrl, size, size) })
    }
    writeFileSync(join(outDir, `${type}.ico`), buildIco(winEntries))

    console.log(`generated ${type}.icns + ${type}.ico`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
  await browser.close()
}
