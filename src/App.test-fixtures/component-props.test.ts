import { describe, expect, it } from 'vitest'
import { getLatestComponentProps } from './component-props'

type ComponentProps = {
  onExecute: () => void
}

describe('getLatestComponentProps', () => {
  it.each([
    ['direct props argument', [{ onExecute: () => undefined }]],
    ['nested Svelte props argument', [{ props: { onExecute: () => undefined } }]],
  ])('reads the latest %s', (_description, latestCall) => {
    const mockComponent = {
      mock: {
        calls: [[{ onExecute: () => undefined }], latestCall],
      },
    }

    const props = getLatestComponentProps<ComponentProps>(mockComponent, 'onExecute')

    expect(props).toBe(
      'props' in latestCall[0]
        ? latestCall[0].props
        : latestCall[0],
    )
  })

  it('can limit extraction to the latest call', () => {
    const mockComponent = {
      mock: {
        calls: [[{ onExecute: () => undefined }], [{}]],
      },
    }

    expect(() => {
      getLatestComponentProps<ComponentProps>(mockComponent, 'onExecute', {
        latestCallOnly: true,
      })
    }).toThrow('Expected mocked component props with onExecute')
  })
})
