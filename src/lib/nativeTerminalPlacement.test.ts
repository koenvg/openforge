import { afterEach, expect, it, vi } from 'vitest'
import { NativeTerminalPlacement } from './nativeTerminalPlacement'

const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
afterEach(() => {
  document.body.replaceChildren()
  if (original) Object.defineProperty(document, 'elementFromPoint', original)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

it('hides native content behind retained panes, transparent ancestors, or DOM overlays', () => {
  const pane = document.createElement('div'), element = document.createElement('div')
  document.body.append(pane)
  pane.append(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 600, 400))
  const hit = vi.fn((): HTMLElement => element)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit })
  const placement = new NativeTerminalPlacement(element, () => {})
  expect(placement.read(true).visible).toBe(true)
  hit.mockReturnValue(document.body)
  expect(placement.read(true).visible).toBe(false)
  hit.mockReturnValue(element)
  pane.style.opacity = '0'
  expect(placement.read(true).visible).toBe(false)
  pane.style.opacity = '1'
  pane.setAttribute('aria-hidden', 'true')
  expect(placement.read(true).visible).toBe(false)
  pane.removeAttribute('aria-hidden')
  expect(placement.read(true).visible).toBe(true)
})
