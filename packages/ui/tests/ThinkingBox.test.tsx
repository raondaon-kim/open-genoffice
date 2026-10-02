// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThinkingBox, thinkingLabels } from '../src/ThinkingBox'

describe('thinkingLabels', () => {
  it('translates ko, en, ja, zh and zh-TW and falls back to English', () => {
    expect(thinkingLabels('ko')).toEqual({
      thinking: '생각 중…',
      show: '생각 과정 보기 ▸',
      hide: '생각 과정 접기 ▾',
    })
    expect(thinkingLabels('en').show).toBe('Show thinking ▸')
    expect(thinkingLabels('ja').thinking).toBe('考え中…')
    expect(thinkingLabels('zh').show).toBe('查看思考过程 ▸')
    expect(thinkingLabels('zh-TW').show).toBe('查看思考過程 ▸')
    expect(thinkingLabels('fr')).toEqual(thinkingLabels('en'))
    expect(thinkingLabels(undefined)).toEqual(thinkingLabels('en'))
  })
})

describe('ThinkingBox', () => {
  let container: HTMLDivElement
  let root: Root
  const labels = thinkingLabels('ko')

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const render = (text: string, live: boolean) =>
    act(() => {
      root.render(<ThinkingBox text={text} live={live} labels={labels} />)
    })

  it('draws nothing for empty or blank text', () => {
    render('', true)
    expect(container.innerHTML).toBe('')
    render('  \n ', false)
    expect(container.innerHTML).toBe('')
  })

  it('while live, shows the title and the streaming text without a toggle', () => {
    render('step one', true)
    expect(container.querySelector('.thinking-box--live')).not.toBeNull()
    expect(container.querySelector('.thinking-box__title')?.textContent).toBe('생각 중…')
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe('step one')
    expect(container.querySelector('button')).toBeNull()
  })

  it('when not live, is one collapsed line that opens and closes on click', () => {
    render('step one', false)
    const toggle = container.querySelector('button')!
    expect(toggle.textContent).toBe('생각 과정 보기 ▸')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.thinking-box__body')).toBeNull()

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('생각 과정 접기 ▾')
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe('step one')

    act(() => toggle.click())
    expect(container.querySelector('.thinking-box__body')).toBeNull()
  })

  it('shows markup in the text literally instead of interpreting it', () => {
    const hostile = '<img src=x onerror=alert(1)> [link](http://example.com) <b>bold</b>'
    render(hostile, true)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('.thinking-box__body')?.textContent).toBe(hostile)
  })
})
