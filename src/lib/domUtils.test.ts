import { describe, it, expect, afterEach } from 'vitest'
import { isInputFocused } from './domUtils'

describe('isInputFocused', () => {
  let element: HTMLElement

  afterEach(() => {
    element?.remove()
  })

  it('returns true when an input is focused', () => {
    element = document.createElement('input')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a textarea is focused', () => {
    element = document.createElement('textarea')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })

  it('returns true when a select element is focused', () => {
    element = document.createElement('select')
    document.body.appendChild(element)
    element.focus()
    expect(isInputFocused()).toBe(true)
  })
})
