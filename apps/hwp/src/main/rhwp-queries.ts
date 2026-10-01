import { AI_QUERY_NAMES } from '../shared/ai-contract'
import type { AiQueryName } from '../shared/ai-contract'

/**
 * argv builders for the read-only rhwp queries the renderer may request on a
 * snapshot. Each builder accepts only its documented options (types and
 * ranges checked here), injects the snapshot path itself, and always asks for
 * the JSON envelope. Anything else is rejected — the renderer never chooses
 * argv, and nothing here can name a password flag or a different file.
 */

export type QueryArgsResult = { ok: true; args: string[] } | { ok: false; error: string }

export function isAiQueryName(value: unknown): value is AiQueryName {
  return typeof value === 'string' && (AI_QUERY_NAMES as readonly string[]).includes(value)
}

class ArgError extends Error {}

type Args = Record<string, unknown>

function checkAllowed(args: Args, allowed: readonly string[]): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new ArgError(`unknown argument "${key}"`)
  }
}

function optInt(
  args: Args,
  key: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ArgError(`${key} must be an integer in [${min}, ${max}]`)
  }
  return value
}

function optBool(args: Args, key: string): boolean {
  const value = args[key]
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw new ArgError(`${key} must be a boolean`)
  return value
}

function optEnum<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ArgError(`${key} must be one of ${values.join('|')}`)
  }
  return value as T
}

function optStr(args: Args, key: string, pattern?: RegExp): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new ArgError(`${key} must be a non-empty string${pattern ? ` matching ${pattern}` : ''}`)
  }
  return value
}

function reqStr(args: Args, key: string): string {
  const value = optStr(args, key)
  if (value === undefined) throw new ArgError(`${key} is required`)
  return value
}

const flag = (name: string, value: number | string | undefined): string[] =>
  value === undefined ? [] : [name, String(value)]

const BUILDERS: Record<AiQueryName, (args: Args, path: string) => string[]> = {
  explain: (args, path) => {
    checkAllowed(args, [])
    return ['explain', path, '--json']
  },
  explore: (args, path) => {
    checkAllowed(args, [])
    return ['explore', path, '--json']
  },
  export_structure: (args, path) => {
    checkAllowed(args, ['mode'])
    return [
      'export-structure',
      path,
      '--json',
      ...flag('--mode', optEnum(args, 'mode', ['auto', 'outline', 'clause'])),
    ]
  },
  export_text: (args, path) => {
    checkAllowed(args, ['page', 'maxChars'])
    return [
      'export-text',
      '--json',
      path,
      ...flag('-p', optInt(args, 'page', 0)),
      ...flag('--max-chars', optInt(args, 'maxChars', 1)),
    ]
  },
  search: (args, path) => {
    checkAllowed(args, ['query', 'ignoreCase', 'maxMatches', 'context'])
    const query = reqStr(args, 'query')
    return [
      'search',
      path,
      '--json',
      ...(optBool(args, 'ignoreCase') ? ['--ignore-case'] : []),
      ...flag('--max-matches', optInt(args, 'maxMatches', 1)),
      ...flag('--context', optInt(args, 'context', 1)),
      '--',
      query,
    ]
  },
  export_tables: (args, path) => {
    checkAllowed(args, [])
    return ['export-tables', path, '--json']
  },
  fields: (args, path) => {
    checkAllowed(args, [])
    return ['fields', path, '--json']
  },
  digest: (args, path) => {
    checkAllowed(args, ['maxChars', 'sections', 'pages'])
    return [
      'digest',
      '--json',
      path,
      ...flag('--max-chars', optInt(args, 'maxChars', 1)),
      ...(optBool(args, 'sections') ? ['--sections'] : []),
      ...flag('--pages', optStr(args, 'pages', /^\d+\.\.\d+$/)),
    ]
  },
  extract_data: (args, path) => {
    checkAllowed(args, ['kind', 'limit'])
    return [
      'extract-data',
      path,
      '--json',
      ...flag('--kind', optEnum(args, 'kind', ['date', 'amount', 'number', 'all'])),
      ...flag('--limit', optInt(args, 'limit', 1)),
    ]
  },
  word_count: (args, path) => {
    checkAllowed(args, [])
    return ['word-count', '--json', path]
  },
  verify: (args, path) => {
    checkAllowed(args, [
      'pages',
      'minPages',
      'maxPages',
      'minChars',
      'minTables',
      'tableCount',
      'contains',
      'notContains',
      'field',
      'format',
    ])
    return [
      'verify',
      path,
      '--json',
      ...flag('--expect-pages', optInt(args, 'pages', 0)),
      ...flag('--expect-min-pages', optInt(args, 'minPages', 0)),
      ...flag('--expect-max-pages', optInt(args, 'maxPages', 0)),
      ...flag('--expect-min-chars', optInt(args, 'minChars', 0)),
      ...flag('--expect-min-tables', optInt(args, 'minTables', 0)),
      ...flag('--expect-table-count', optInt(args, 'tableCount', 0)),
      ...flag('--expect-contains', optStr(args, 'contains')),
      ...flag('--expect-not-contains', optStr(args, 'notContains')),
      ...flag('--expect-field', optStr(args, 'field')),
      ...flag('--expect-format', optEnum(args, 'format', ['hwp5', 'hwpx', 'hwp3', 'hml'])),
    ]
  },
  inspect_injection: (args, path) => {
    checkAllowed(args, ['minConfidence', 'includeFields'])
    return [
      'inspect',
      'injection',
      path,
      '--json',
      ...flag('--min-confidence', optEnum(args, 'minConfidence', ['low', 'medium', 'high'])),
      ...(optBool(args, 'includeFields') ? ['--include-fields'] : []),
    ]
  },
}

export function buildQueryArgs(tool: AiQueryName, args: Args, path: string): QueryArgsResult {
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new ArgError('args must be an object')
    }
    return { ok: true, args: BUILDERS[tool](args, path) }
  } catch (err) {
    if (err instanceof ArgError) return { ok: false, error: `${tool}: ${err.message}` }
    throw err
  }
}
