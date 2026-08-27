type MockComponent = {
  mock: {
    calls: readonly (readonly unknown[])[]
  }
}

type ComponentPropsLookup = {
  latestCallOnly?: boolean
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function getLatestComponentProps<T extends Record<string, unknown>>(
  mockComponent: MockComponent,
  propName: keyof T,
  lookup: ComponentPropsLookup = {},
): T {
  const calls = lookup.latestCallOnly
    ? mockComponent.mock.calls.slice(-1)
    : [...mockComponent.mock.calls].reverse()

  for (const call of calls) {
    for (const arg of call) {
      if (!isObjectRecord(arg)) continue

      const candidates = isObjectRecord(arg.props) ? [arg, arg.props] : [arg]
      const props = candidates.find((candidate) => propName in candidate)
      if (props) return props as T
    }
  }

  throw new Error(`Expected mocked component props with ${String(propName)}`)
}
