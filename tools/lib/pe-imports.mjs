// Read the import table of a Windows program (PE), so a build can prove which bundled DLLs a
// program needs without relying on the DLLs that happen to be on the build machine.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** the DLL names (lowercase) a PE image imports */
export function peImports(buf) {
  if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a PE image')
  const pe = buf.readUInt32LE(0x3c)
  if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') {
    throw new Error('not a PE image')
  }
  const coff = pe + 4
  const sectionCount = buf.readUInt16LE(coff + 2)
  const optionalSize = buf.readUInt16LE(coff + 16)
  const optional = coff + 20
  const magic = buf.readUInt16LE(optional)
  const dataDirectory = optional + (magic === 0x20b ? 112 : 96)
  const importRva = buf.readUInt32LE(dataDirectory + 8)
  const sections = []
  for (let i = 0, at = optional + optionalSize; i < sectionCount; i++, at += 40) {
    sections.push({
      va: buf.readUInt32LE(at + 12),
      size: Math.max(buf.readUInt32LE(at + 8), buf.readUInt32LE(at + 16)),
      raw: buf.readUInt32LE(at + 20),
    })
  }
  const offsetOf = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + x.size)
    if (!s) throw new Error(`import table address ${rva} is outside every section`)
    return rva - s.va + s.raw
  }
  const names = []
  if (!importRva) return names
  for (let d = offsetOf(importRva); d + 20 <= buf.length; d += 20) {
    const nameRva = buf.readUInt32LE(d + 12)
    if (!nameRva) break // the all-zero descriptor ends the table
    const start = offsetOf(nameRva)
    names.push(buf.toString('latin1', start, buf.indexOf(0, start)).toLowerCase())
  }
  return names
}

/**
 * Every program file in `dir` that `start` needs, directly or through other files in `dir`
 * (lowercase names, `start` included). Imports that are not in `dir` (Windows' own DLLs) are not
 * followed and not included.
 */
export function importClosure(dir, start) {
  const inDir = new Map(
    readdirSync(dir)
      .filter((f) => /\.(dll|exe)$/i.test(f))
      .map((f) => [f.toLowerCase(), f]),
  )
  const reached = new Set()
  const todo = [start.toLowerCase()]
  while (todo.length) {
    const name = todo.pop()
    if (reached.has(name) || !inDir.has(name)) continue
    reached.add(name)
    for (const dll of peImports(readFileSync(join(dir, inDir.get(name))))) {
      if (inDir.has(dll) && !reached.has(dll)) todo.push(dll)
    }
  }
  return reached
}
