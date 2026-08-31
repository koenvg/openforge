const DESKTOP_TEST_QUERY_PARAMETER = 'openforge-desktop-test'

export function shouldEnableTerminalTestProbe(isDevelopment: boolean, url: string): boolean {
  if (!isDevelopment) return false
  try {
    return new URL(url).searchParams.get(DESKTOP_TEST_QUERY_PARAMETER) === '1'
  } catch {
    return false
  }
}
