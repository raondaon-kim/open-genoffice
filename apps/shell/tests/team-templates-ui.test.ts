/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamLibraryApi, TeamTemplateList } from '../src/shared/team-library-api'
import { TeamTemplateSets } from '../src/renderer/src/TeamTemplateSets'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const LIST: TeamTemplateList = {
  sets: [
    {
      path: 'Word/KOICA/',
      title: 'KOICA ODA 기술제안서',
      kind: 'Word',
      purpose: '용역 제안서',
      status: 'ok',
      hash8: '11111111',
    },
    {
      path: 'Word/보고서/',
      title: '결과 보고서',
      kind: 'Word',
      purpose: '결과 보고',
      status: 'stale-md',
      hash8: '22222222',
    },
    {
      path: 'Word/깨짐/',
      title: '깨진 것',
      kind: 'Word',
      purpose: '',
      status: 'broken',
      hash8: '33333333',
    },
  ],
  loose: [{ id: 'Word/옛 양식.docx', name: '옛 양식.docx', ext: 'docx', sizeBytes: 1, mtimeMs: 0 }],
  writable: true,
  repaired: false,
}

function fakeApi(overrides: Partial<TeamLibraryApi> = {}): TeamLibraryApi {
  return {
    templateList: vi.fn(async () => ({ ok: true as const, value: LIST })),
    templateCandidates: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          key: 'aaa',
          docs: [
            { id: 'P/공용/Word/a.docx', name: 'a.docx', mtimeMs: 0 },
            { id: 'Q/공용/Word/b.docx', name: 'b.docx', mtimeMs: 0 },
          ],
          certain: true,
        },
        {
          key: 'bbb',
          docs: [{ id: 'P/공용/Word/c.docx', name: 'c.docx', mtimeMs: 0 }],
          certain: false,
          coveredBy: 'Word/KOICA/',
        },
      ],
    })),
    templateDraft: vi.fn(async () => ({
      ok: true as const,
      value: {
        draftId: 'd1',
        markdown: '# 초안 (Word)\n',
        formHeadings: ['Ⅰ. 개요'],
        headerFooter: {},
        coverLabels: ['사업명'],
      },
    })),
    templateConfirm: vi.fn(async () => ({
      ok: false as const,
      error: 'source-words' as const,
      detail: '자카르타 보건소',
    })),
    templateRemove: vi.fn(async () => ({ ok: true as const, value: undefined })),
    templateOpen: vi.fn(async () => ({ ok: true as const, value: 'C:/x.docx' })),
    templateRebuild: vi.fn(async () => ({ ok: true as const, value: LIST })),
    useEntry: vi.fn(async () => ({ ok: true as const, value: 'C:/y.docx' })),
    ...overrides,
  } as unknown as TeamLibraryApi
}

async function render(api: TeamLibraryApi) {
  await act(async () => {
    root.render(createElement(TeamTemplateSets, { api, lang: 'ko', reloadKey: 0 }))
  })
  await act(async () => {})
}

const buttons = (label: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent === label)

describe('TeamTemplateSets', () => {
  it('shows sets with status badges, loose files and candidates', async () => {
    await render(fakeApi())
    expect(host.textContent).toContain('KOICA ODA 기술제안서')
    expect(host.textContent).toContain('md 갱신 필요')
    expect(host.textContent).toContain('깨진 템플릿')
    expect(host.textContent).toContain('정리되지 않은 파일')
    expect(host.textContent).toContain('옛 양식.docx')
    expect(host.textContent).toContain('비슷한 문서 2건')
    expect(host.textContent).toContain('이미 템플릿 있음')
    expect(host.textContent).toContain('제목을 추정함')
  })

  it('makes a template: draft, edit, confirm with the edited markdown, error with its detail', async () => {
    const api = fakeApi()
    await render(api)
    await act(async () => buttons('템플릿 만들기')[1]!.click())
    expect(api.templateDraft).toHaveBeenCalledWith({ candidateKey: 'aaa' }, undefined)
    const textarea = host.querySelector('textarea')!
    expect(textarea.value).toBe('# 초안 (Word)\n')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '# 고친 초안 (Word)\n')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => buttons('확정')[0]!.click())
    expect(api.templateConfirm).toHaveBeenCalledWith('d1', '# 고친 초안 (Word)\n')
    expect(host.textContent).toContain(
      '원본 문서의 문장이 남아 있어 확정할 수 없습니다: 자카르타 보건소',
    )
  })

  it('a loose docx can become a template', async () => {
    const api = fakeApi()
    await render(api)
    await act(async () => buttons('템플릿 만들기')[0]!.click())
    expect(api.templateDraft).toHaveBeenCalledWith({ loose: 'Word/옛 양식.docx' }, undefined)
  })

  it('다시 만들기 picks a candidate for the chosen set', async () => {
    const api = fakeApi()
    await render(api)
    await act(async () => buttons('다른 문서로 다시 만들기')[0]!.click())
    const inCandidates = [...host.querySelectorAll('section[aria-label="후보"] button')].filter(
      (b) => b.textContent === '이 문서로 다시 만들기',
    ) as HTMLButtonElement[]
    // covered candidates can be the new source too
    expect(inCandidates).toHaveLength(2)
    await act(async () => inCandidates[0]!.click())
    expect(api.templateDraft).toHaveBeenCalledWith({ candidateKey: 'aaa' }, 'Word/KOICA/')
  })

  it('delete asks first', async () => {
    const api = fakeApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await render(api)
    await act(async () => buttons('삭제')[0]!.click())
    expect(confirm).toHaveBeenCalledWith('이 템플릿을 삭제할까요? NAS 휴지통에 남습니다.')
    expect(api.templateRemove).toHaveBeenCalledWith('Word/KOICA/')
  })

  it('a read-only member sees no make, remake or delete buttons', async () => {
    await render(
      fakeApi({
        templateList: vi.fn(async () => ({
          ok: true as const,
          value: { ...LIST, writable: false },
        })),
      }),
    )
    expect(buttons('템플릿 만들기')).toHaveLength(0)
    expect(buttons('다른 문서로 다시 만들기')).toHaveLength(0)
    expect(buttons('삭제')).toHaveLength(0)
    expect(buttons('이 양식으로 작성').length).toBeGreaterThan(0)
  })
})
