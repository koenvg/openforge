export function getLatestComponentProps<T extends Record<string, unknown>>(
  mockComponent: { mock: { calls: unknown[][] } },
  propName: keyof T,
): T {
  for (const call of [...mockComponent.mock.calls].reverse()) {
    const props = call.find(
      (arg): arg is T => typeof arg === 'object' && arg !== null && propName in arg,
    )
    if (props) return props
  }

  throw new Error(`Expected mocked component props with ${String(propName)}`)
}
