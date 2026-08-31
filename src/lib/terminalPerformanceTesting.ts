import { createTerminalPerformanceTrace } from '@openforge-app/terminal-runtime'
import { shouldEnableTerminalTestProbe } from './desktopTestMode'

export function createTerminalPerformanceTestTrace(isDevelopment: boolean, url: string) {
  return shouldEnableTerminalTestProbe(isDevelopment, url)
    ? createTerminalPerformanceTrace()
    : undefined
}
