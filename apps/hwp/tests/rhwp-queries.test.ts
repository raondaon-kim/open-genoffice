/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { buildQueryArgs, isAiQueryName } from '../src/main/rhwp-queries'

const P = 'C:/snap/abc.hwpx'
const ok = (tool: Parameters<typeof buildQueryArgs>[0], args: Record<string, unknown> = {}) => {
  const built = buildQueryArgs(tool, args, P)
  if (!built.ok) throw new Error(built.error)
  return built.args
}
const fail = (tool: Parameters<typeof buildQueryArgs>[0], args: Record<string, unknown>) => {
  const built = buildQueryArgs(tool, args, P)
  if (built.ok) throw new Error(`expected rejection, got ${built.args.join(' ')}`)
  return built.error
}

describe('buildQueryArgs', () => {
  it('builds every read query with the snapshot path injected and --json', () => {
    expect(ok('explain')).toEqual(['explain', P, '--json'])
    expect(ok('explore')).toEqual(['explore', P, '--json'])
    expect(ok('export_structure')).toEqual(['export-structure', P, '--json'])
    expect(ok('export_structure', { mode: 'clause' })).toEqual([
      'export-structure',
      P,
      '--json',
      '--mode',
      'clause',
    ])
    expect(ok('export_text')).toEqual(['export-text', '--json', P])
    expect(ok('export_text', { page: 0, maxChars: 4000 })).toEqual([
      'export-text',
      '--json',
      P,
      '-p',
      '0',
      '--max-chars',
      '4000',
    ])
    expect(ok('search', { query: '사업' })).toEqual(['search', P, '--json', '--', '사업'])
    expect(ok('search', { query: '-x', ignoreCase: true, maxMatches: 5, context: 1 })).toEqual([
      'search',
      P,
      '--json',
      '--ignore-case',
      '--max-matches',
      '5',
      '--context',
      '1',
      '--',
      '-x',
    ])
    expect(ok('export_tables')).toEqual(['export-tables', P, '--json'])
    expect(ok('fields')).toEqual(['fields', P, '--json'])
    expect(ok('digest', { maxChars: 500, sections: true, pages: '0..2' })).toEqual([
      'digest',
      '--json',
      P,
      '--max-chars',
      '500',
      '--sections',
      '--pages',
      '0..2',
    ])
    expect(ok('extract_data', { kind: 'amount', limit: 10 })).toEqual([
      'extract-data',
      P,
      '--json',
      '--kind',
      'amount',
      '--limit',
      '10',
    ])
    expect(ok('word_count')).toEqual(['word-count', '--json', P])
    expect(ok('verify', { pages: 3, contains: '결재', tableCount: 2 })).toEqual([
      'verify',
      P,
      '--json',
      '--expect-pages',
      '3',
      '--expect-table-count',
      '2',
      '--expect-contains',
      '결재',
    ])
    expect(ok('inspect_injection', { minConfidence: 'medium', includeFields: true })).toEqual([
      'inspect',
      'injection',
      P,
      '--json',
      '--min-confidence',
      'medium',
      '--include-fields',
    ])
  })

  it('rejects wrong types, unknown options, out-of-range values and empty queries', () => {
    expect(fail('search', {})).toMatch(/query/)
    expect(fail('search', { query: '' })).toMatch(/query/)
    expect(fail('search', { query: 'x', maxMatches: -1 })).toMatch(/maxMatches/)
    expect(fail('export_text', { page: 1.5 })).toMatch(/page/)
    expect(fail('export_text', { page: '0' })).toMatch(/page/)
    expect(fail('export_structure', { mode: 'tree' })).toMatch(/mode/)
    expect(fail('digest', { pages: '1-3' })).toMatch(/pages/)
    expect(fail('extract_data', { kind: 'phone' })).toMatch(/kind/)
    expect(fail('inspect_injection', { minConfidence: 'sure' })).toMatch(/minConfidence/)
    expect(fail('explain', { password: 'x' })).toMatch(/unknown argument.*password/)
    expect(fail('explain', { path: '/etc/passwd' })).toMatch(/unknown argument.*path/)
  })

  it('never emits a password flag and never lets args replace the path', () => {
    for (const tool of ['explain', 'search', 'digest'] as const) {
      const built = buildQueryArgs(tool, { query: 'q', '--password-stdin': true }, P)
      expect(built.ok).toBe(false)
    }
    const args = ok('search', { query: '--password-stdin' })
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('--password-stdin'))
  })

  it('isAiQueryName narrows to the allow-list', () => {
    expect(isAiQueryName('search')).toBe(true)
    expect(isAiQueryName('ir_diff')).toBe(false)
    expect(isAiQueryName(42)).toBe(false)
  })
})
