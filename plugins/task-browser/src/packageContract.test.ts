import { describe, expect, it } from 'vitest'
import packageJson from '../package.json'

describe('Task Browser package contract', () => {
  it('declares its built stylesheet for standalone plugin installation', () => {
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
    expect(packageJson.openforge.frontendStyles).toEqual([
      './dist/plugin-task-browser.css',
    ])
  })
})
