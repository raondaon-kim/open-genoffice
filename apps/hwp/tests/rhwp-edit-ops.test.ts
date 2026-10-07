/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { compileEditOps, MAX_EDIT_OPS, SET_STEP } from '../src/main/rhwp-edit-ops'
import type { EditOp } from '../src/shared/ai-contract'

const steps = (...ops: EditOp[]) => {
  const result = compileEditOps(ops)
  if (!result.ok) throw new Error(`${result.index}: ${result.error}`)
  return result.steps.map(({ opIndex, command, flags, tolerate, setText }) => ({
    opIndex,
    command,
    flags,
    ...(tolerate ? { tolerate: tolerate.source } : {}),
    ...(setText ? { setText } : {}),
  }))
}
const reject = (ops: unknown) => {
  const result = compileEditOps(ops)
  if (result.ok) throw new Error('expected rejection')
  return result
}

describe('compileEditOps — golden argv per op (spec §6 + §14)', () => {
  it('text ops', () => {
    expect(steps({ op: 'replace_phrase', find: '사업', replace: '프로젝트' })).toEqual([
      { opIndex: 0, command: 'replace-text', flags: ['--find', '사업', '--replace', '프로젝트'] },
    ])
    expect(steps({ op: 'replace_phrase', find: 'a', replace: '', occurrence: 2 })[0].flags).toEqual(
      ['--find', 'a', '--replace', '', '--occurrence', '2'],
    )
    // a template step: the chain expands it from the live document so the indentation survives
    expect(steps({ op: 'set_paragraph_text', section: 0, paragraph: 3, text: '새 본문' })).toEqual([
      {
        opIndex: 0,
        command: SET_STEP,
        flags: [],
        setText: { target: { section: 0, paragraph: 3 }, text: '새 본문' },
      },
    ])
    // clearing a paragraph is the same step with an empty text
    expect(
      steps({ op: 'set_paragraph_text', section: 0, paragraph: 3, text: '' })[0],
    ).toMatchObject({
      setText: { text: '' },
    })
    // "after paragraph 3" = insert BEFORE index 4 (§14), then fill the new paragraph
    expect(steps({ op: 'insert_paragraph_after', section: 0, paragraph: 3, text: '추가' })).toEqual(
      [
        { opIndex: 0, command: 'insert-paragraph', flags: ['--section', '0', '--para', '4'] },
        {
          opIndex: 0,
          command: 'insert-text',
          flags: ['--section', '0', '--para', '4', '--offset', '0', '--text', '추가'],
        },
      ],
    )
    expect(steps({ op: 'delete_paragraph', section: 0, paragraph: 6 })).toEqual([
      { opIndex: 0, command: 'delete-paragraph', flags: ['--section', '0', '--para', '6'] },
    ])
  })

  it('table ops', () => {
    expect(steps({ op: 'set_cell', table: 0, row: 1, col: 1, text: '900,000' })[0]).toEqual({
      opIndex: 0,
      command: 'set-cell',
      flags: ['--table', '0', '--row', '1', '--col', '1', '--text', '900,000'],
    })
    expect(steps({ op: 'insert_row', table: 0, row: 2, below: true })[0].flags).toEqual([
      '--table',
      '0',
      '--row',
      '2',
      '--below',
    ])
    expect(steps({ op: 'insert_row', table: 0, row: 2 })[0].flags).toEqual([
      '--table',
      '0',
      '--row',
      '2',
    ])
    expect(steps({ op: 'insert_col', table: 0, col: 1, right: true })[0].flags).toEqual([
      '--table',
      '0',
      '--col',
      '1',
      '--right',
    ])
    expect(steps({ op: 'delete_row', table: 0, row: 2 })[0]).toMatchObject({
      command: 'delete-row',
      flags: ['--table', '0', '--row', '2'],
    })
    expect(steps({ op: 'delete_col', table: 0, col: 0 })[0]).toMatchObject({
      command: 'delete-col',
      flags: ['--table', '0', '--col', '0'],
    })
    expect(
      steps({ op: 'merge_cells', table: 0, row: 0, col: 0, endRow: 0, endCol: 1 })[0].flags,
    ).toEqual(['--table', '0', '--row', '0', '--col', '0', '--end-row', '0', '--end-col', '1'])
    expect(steps({ op: 'split_cell', table: 0, row: 0, col: 0 })[0]).toMatchObject({
      command: 'split-cell',
    })
    expect(steps({ op: 'insert_table', section: 0, paragraph: 6, rows: 2, cols: 3 })[0]).toEqual({
      opIndex: 0,
      command: 'insert-table',
      flags: ['--rows', '2', '--cols', '3', '--section', '0', '--para', '6', '--offset', '0'],
    })
  })

  it('element ops', () => {
    expect(
      steps({ op: 'insert_footnote', section: 0, paragraph: 2, charOffset: 5, text: '각주' }),
    ).toEqual([
      {
        opIndex: 0,
        command: 'insert-footnote',
        flags: ['--section', '0', '--para', '2', '--offset', '5'],
      },
      {
        opIndex: 0,
        command: 'insert-footnote-text',
        flags: ['--section', '0', '--para', '2', '--ctrl', '0', '--text', '각주'],
      },
    ])
    expect(steps({ op: 'insert_footnote', section: 0, paragraph: 2, charOffset: 5 })).toHaveLength(
      1,
    )
    expect(
      steps({ op: 'insert_endnote', section: 0, paragraph: 2, charOffset: 0 })[0].command,
    ).toBe('insert-endnote')
    expect(
      steps({ op: 'insert_page_break', section: 0, paragraph: 3, charOffset: 0 })[0],
    ).toMatchObject({
      command: 'insert-page-break',
      flags: ['--section', '0', '--para', '3', '--offset', '0'],
    })
    expect(
      steps({ op: 'insert_column_break', section: 0, paragraph: 3, charOffset: 0 })[0].command,
    ).toBe('insert-column-break')
    // header creation is tolerated when it already exists (exit 1 "이미 … 존재")
    expect(steps({ op: 'header_text', section: 0, text: '머리말' })).toEqual([
      {
        opIndex: 0,
        command: 'insert-header-footer',
        flags: ['--header', '--section', '0'],
        tolerate: '이미',
      },
      {
        opIndex: 0,
        command: 'insert-header-footer-text',
        flags: ['--header', '--section', '0', '--text', '머리말'],
      },
    ])
    expect(steps({ op: 'footer_text', section: 0, text: '꼬리말' })[1].flags).toEqual([
      '--footer',
      '--section',
      '0',
      '--text',
      '꼬리말',
    ])
    expect(
      steps({ op: 'add_bookmark', section: 0, paragraph: 2, charOffset: 0, name: '표시' })[0],
    ).toEqual({
      opIndex: 0,
      command: 'add-bookmark',
      flags: ['--name', '표시', '--section', '0', '--para', '2', '--offset', '0'],
    })
  })

  it('field and format ops serialize JSON with only the allowed keys', () => {
    expect(
      steps({ op: 'fill_fields', data: { 회사명: '유비온', '작성자[1]': '홍길동' } })[0],
    ).toEqual({
      opIndex: 0,
      command: 'fill-fields',
      flags: ['--data', '{"회사명":"유비온","작성자[1]":"홍길동"}'],
    })
    expect(
      steps({
        op: 'apply_char_format',
        section: 0,
        paragraph: 2,
        props: { bold: true, textColor: '#ff0000', fontSize: 14 },
      })[0],
    ).toEqual({
      opIndex: 0,
      command: 'apply-char-format',
      flags: [
        '--props',
        '{"bold":true,"textColor":"#FF0000","fontSize":1400}',
        '--section',
        '0',
        '--para',
        '2',
      ],
    })
    expect(
      steps({
        op: 'apply_para_format',
        section: 0,
        paragraph: 2,
        props: { alignment: 'center', lineSpacing: 160 },
      })[0],
    ).toEqual({
      opIndex: 0,
      command: 'apply-para-format',
      flags: [
        '--props',
        '{"alignment":"center","lineSpacing":160}',
        '--section',
        '0',
        '--para',
        '2',
      ],
    })
  })

  it('numbers opIndex per source op across multi-step ops', () => {
    const result = steps(
      { op: 'replace_phrase', find: 'a', replace: 'b' },
      { op: 'set_paragraph_text', section: 0, paragraph: 1, text: 'x' },
      { op: 'delete_row', table: 0, row: 0 },
    )
    expect(result.map((s) => s.opIndex)).toEqual([0, 1, 2])
  })
})

describe('compileEditOps — validation', () => {
  it('rejects malformed input with the offending index', () => {
    expect(reject('nope')).toMatchObject({ index: -1 })
    expect(reject([])).toMatchObject({ index: -1, error: expect.stringMatching(/at least one/) })
    expect(
      reject(
        Array.from({ length: MAX_EDIT_OPS + 1 }, () => ({ op: 'delete_row', table: 0, row: 0 })),
      ),
    ).toMatchObject({ index: -1, error: expect.stringMatching(/20/) })
    expect(reject([{ op: 'rm_rf' }])).toMatchObject({
      index: 0,
      error: expect.stringMatching(/unknown op/),
    })
    expect(
      reject([
        { op: 'delete_row', table: 0, row: 0 },
        { op: 'set_cell', table: 0, row: -1, col: 0, text: 'x' },
      ]),
    ).toMatchObject({ index: 1, error: expect.stringMatching(/row/) })
    expect(reject([{ op: 'set_cell', table: 0, row: 0, col: 0, text: 'a\nb' }])).toMatchObject({
      error: expect.stringMatching(/newline|tab/),
    })
    expect(
      reject([{ op: 'set_paragraph_text', section: 0, paragraph: 0, text: 'a\nb' }]),
    ).toMatchObject({ error: expect.stringMatching(/insert_paragraph_after/) })
    expect(reject([{ op: 'replace_phrase', find: '', replace: 'x' }])).toMatchObject({
      error: expect.stringMatching(/find/),
    })
    expect(
      reject([{ op: 'insert_table', section: 0, paragraph: 0, rows: 0, cols: 1 }]),
    ).toMatchObject({ error: expect.stringMatching(/rows/) })
    expect(
      reject([{ op: 'insert_table', section: 0, paragraph: 0, rows: 1, cols: 257 }]),
    ).toMatchObject({ error: expect.stringMatching(/cols/) })
    expect(
      reject([{ op: 'add_bookmark', section: 0, paragraph: 0, charOffset: 0, name: '   ' }]),
    ).toMatchObject({ error: expect.stringMatching(/name/) })
    expect(reject([{ op: 'fill_fields', data: { a: 1 } }])).toMatchObject({
      error: expect.stringMatching(/string/),
    })
    expect(reject([{ op: 'fill_fields', data: {} }])).toMatchObject({
      error: expect.stringMatching(/empty/),
    })
  })

  it('rejects unknown or malformed format props instead of letting rhwp ignore them silently', () => {
    expect(
      reject([{ op: 'apply_char_format', section: 0, paragraph: 0, props: { zzz: 1 } }]),
    ).toMatchObject({ error: expect.stringMatching(/zzz/) })
    expect(
      reject([{ op: 'apply_char_format', section: 0, paragraph: 0, props: { textColor: 'red' } }]),
    ).toMatchObject({ error: expect.stringMatching(/#rrggbb/) })
    expect(
      reject([{ op: 'apply_char_format', section: 0, paragraph: 0, props: { fontSize: 0 } }]),
    ).toMatchObject({ error: expect.stringMatching(/fontSize/) })
    expect(
      reject([{ op: 'apply_char_format', section: 0, paragraph: 0, props: {} }]),
    ).toMatchObject({ error: expect.stringMatching(/at least one/) })
    expect(
      reject([
        { op: 'apply_para_format', section: 0, paragraph: 0, props: { alignment: 'middle' } },
      ]),
    ).toMatchObject({ error: expect.stringMatching(/alignment/) })
    expect(
      reject([{ op: 'apply_para_format', section: 0, paragraph: 0, props: { lineSpacing: 10 } }]),
    ).toMatchObject({ error: expect.stringMatching(/lineSpacing/) })
  })
})

describe('delete_table', () => {
  it('compiles to rhwp edit delete-table --table N', () => {
    expect(compileEditOps([{ op: 'delete_table', table: 2 }])).toEqual({
      ok: true,
      steps: [{ opIndex: 0, command: 'delete-table', flags: ['--table', '2'] }],
    })
  })

  it('rejects a missing or negative table index', () => {
    expect(compileEditOps([{ op: 'delete_table' }])).toMatchObject({ ok: false, index: 0 })
    expect(compileEditOps([{ op: 'delete_table', table: -1 }])).toMatchObject({
      ok: false,
      index: 0,
    })
  })
})

describe('insert_paragraph_like', () => {
  const op = (over: Record<string, unknown> = {}) => ({
    op: 'insert_paragraph_like',
    section: 0,
    paragraph: 3,
    like: { section: 0, paragraph: 1 },
    text: '○ 내용',
    ...over,
  })

  it('compiles to one template step carrying coordinates and text only', () => {
    expect(compileEditOps([op()])).toEqual({
      ok: true,
      steps: [
        {
          opIndex: 0,
          command: '@like',
          flags: [],
          dynamic: {
            like: { section: 0, paragraph: 1 },
            target: { section: 0, paragraph: 3 },
            text: '○ 내용',
            depth: 0,
          },
        },
      ],
    })
  })

  it('ignores leading spaces the model typed and keeps the depth', () => {
    const result = compileEditOps([op({ text: '   ○ 내용', depth: 1 })])
    expect(result).toMatchObject({
      ok: true,
      steps: [{ dynamic: { text: '○ 내용', depth: 1 } }],
    })
  })

  it.each([
    ['empty text', { text: '   ' }],
    ['a newline', { text: '○ 가\n○ 나' }],
    ['a tab', { text: '○\t가' }],
    ['depth out of range', { depth: 4 }],
    ['depth not an integer', { depth: 1.5 }],
    ['no like', { like: undefined }],
    ['like without a paragraph', { like: { section: 0 } }],
    ['negative coordinates', { paragraph: -1 }],
  ])('rejects %s', (_label, over) => {
    expect(compileEditOps([op(over)])).toMatchObject({ ok: false, index: 0 })
  })
})

describe('style_paragraph (internal)', () => {
  const op = (over: Record<string, unknown> = {}) => ({
    op: 'style_paragraph',
    section: 0,
    paragraph: 4,
    para: {
      alignment: 'center',
      marginLeft: 100,
      indent: -300,
      spacingBefore: 200,
      lineSpacing: 150,
    },
    char: { fontSize: 14.5, bold: true },
    ...over,
  })
  const allow = { allowInternal: true }

  it('compiles to a paragraph-format step and a character-format step', () => {
    expect(compileEditOps([op()], allow)).toEqual({
      ok: true,
      steps: [
        {
          opIndex: 0,
          command: 'apply-para-format',
          flags: [
            '--props',
            '{"alignment":"center","marginLeft":100,"indent":-300,"spacingBefore":200,"lineSpacing":150}',
            '--section',
            '0',
            '--para',
            '4',
          ],
        },
        {
          opIndex: 0,
          command: 'apply-char-format',
          flags: ['--props', '{"fontSize":1450,"bold":true}', '--section', '0', '--para', '4'],
        },
      ],
    })
  })

  it('skips the step whose properties were not given', () => {
    const only = compileEditOps([op({ char: undefined })], allow)
    expect(only).toMatchObject({ ok: true, steps: [{ command: 'apply-para-format' }] })
    expect((only as { steps: unknown[] }).steps).toHaveLength(1)
  })

  it('is refused unless internal ops are allowed', () => {
    expect(compileEditOps([op()])).toMatchObject({
      ok: false,
      index: 0,
      error: expect.stringMatching(/unknown op "style_paragraph"/),
    })
  })

  it.each([
    ['no properties at all', { para: undefined, char: undefined }],
    ['an unsupported paragraph key', { para: { leftMargin: 5 } }],
    ['an unknown alignment', { para: { alignment: 'middle' } }],
    ['line spacing out of range', { para: { lineSpacing: 900 } }],
    ['a negative spacing', { para: { spacingBefore: -1 } }],
    ['a font size out of range', { char: { fontSize: 3 } }],
    ['a bold that is not a boolean', { char: { bold: 'yes' } }],
    ['an unsupported character key', { char: { italic: true } }],
  ])('rejects %s', (_label, over) => {
    expect(compileEditOps([op(over)], allow)).toMatchObject({ ok: false, index: 0 })
  })
})
